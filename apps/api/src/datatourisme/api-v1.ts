// CAMP-181: read DATAtourisme from the v1 API instead of the Diffuseur feed.
//
// 🔴 WHY THIS FILE EXISTS, and why it is a translation layer rather than a
// second parser. The Diffuseur platform stopped issuing new feeds on
// 1 October 2026 and closes entirely in October 2027. Our one feed
// (`camptribe-campings-fr`) keeps running until then, so this is not an
// emergency — but it cannot be changed or recreated, and France is more
// than a third of the campsites we hold.
//
// Everything below was MEASURED against the live API on 04.10.2026, not
// read from documentation. The documentation of this source has already
// been wrong once (CAMP-163, four errors in EDO's metadata), so the rule
// stands: check, do not quote.
//
//     base                       https://api.datatourisme.fr/v1/catalog
//     auth                       x-api-key header
//     whole catalogue            487 501 objects
//     type=CampingAndCaravanning 9 438
//     pagination                 cursor in meta.next
//
// 🔴 THE TRAP. The default response carries NONE of what we come here
// for — no tariffs, no stars, eleven thin fields. Worse, asking for them
// by the names our own parser uses returns almost nothing:
//
//     fields=hasPricingOffer  ->  objects with a single key, `uuid`
//
// The feed's `hasPricingOffer` lives here under `offers`. Anyone who
// builds the query from `prices.ts` vocabulary gets an empty answer and
// concludes the API has no prices. It has them; `fields=*` returns 21
// fields and the tariffs are inside.
//
// 🔴 AND THE TRAP BEHIND THAT ONE. Having the right KEYS is not having
// the right SHAPES. Review of the first version of this file found that
// every French tariff lost the operator's own wording, silently, while
// its price survived — so nothing looked broken. The API writes language
// maps as `{"@fr": "Forfait…"}` and `firstLangString` only accepts
// `{"fr": ["Forfait…"]}`; measured, `'@fr'` fails its tag pattern and
// returns null. `textPriceSpecification` — 407 records of operator prose
// — went to zero the same way. `langMap` below is that fix, and the
// round-trip tests assert the WORDS arrive, not just the numbers.

import { createHash } from 'node:crypto';
import { isCampsiteNode, type JsonLdNode } from './prices';

/** The catalogue endpoint. */
export const CATALOG_URL = 'https://api.datatourisme.fr/v1/catalog';

/** The ontology class our campsites carry, in the feed and in the API alike. */
export const CAMPSITE_TYPE = 'CampingAndCaravanning';

/**
 * 🔴 `*`, and not a list of names.
 *
 * Measured: `fields=hasPricingOffer` and `fields=hasPricingOffer,hasReview`
 * both return objects holding only `uuid`. The API does not accept the
 * ontology property names at this level, and it says so by answering
 * emptily rather than by erroring — the quietest possible failure.
 */
export const CATALOG_FIELDS = '*';

/**
 * How many objects to ask for at once.
 *
 * 🔴 Deliberately below what the API allowed on 04.10.2026. DATAtourisme
 * has an open announcement — «Abaissement du nombre maximum d'objets lors
 * des appels à l'API» — which lowers this ceiling, and the announcement
 * sits behind the owner's Diffuseur login. Until it is read, a number we
 * picked ourselves is honest and a number we read off today's limit is a
 * guess with a date on it.
 */
export const CATALOG_PAGE_SIZE = 50;

/**
 * A ceiling on the walk, so a bad cursor cannot spin forever.
 *
 * 9 438 campsites at 50 a page is 189 pages. A thousand leaves room for
 * the catalogue to quadruple and is still a bound.
 */
export const MAX_CATALOG_PAGES = 1000;

/** One page as the API returns it. */
export interface CatalogPage {
  objects: Record<string, unknown>[];
  meta: { total: number; page: number; page_size: number; next?: string };
}

/** JSON-LD writes single values and arrays interchangeably; so does the API. */
function asList(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * JSON-LD keywords, which look like language tags and are not.
 *
 * `@id` is two letters and would sail through an `[A-Za-z]{2,3}` test, so
 * the pattern alone is not enough — an object holding `@id` must never be
 * mistaken for a language map and rewritten.
 */
const JSONLD_KEYWORDS = new Set([
  '@id',
  '@type',
  '@value',
  '@language',
  '@context',
  '@graph',
  '@list',
  '@set',
  '@none',
]);

const LANG_TAG = /^@([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)$/;

/**
 * `{"@fr": "Forfait"}` as `{"fr": ["Forfait"]}`, which is the only shape
 * `firstLangString` accepts.
 *
 * Returns the value untouched unless EVERY key is a language tag and none
 * is a JSON-LD keyword — a half-match is more likely our misreading than
 * a language map, and quietly rewriting it would be the same class of
 * mistake this function exists to undo.
 */
export function langMap(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return value;
  if (entries.some(([k]) => JSONLD_KEYWORDS.has(k) || !LANG_TAG.test(k))) {
    return value;
  }
  const out: Record<string, unknown[]> = {};
  for (const [k, v] of entries) out[LANG_TAG.exec(k)![1]] = asList(v);
  return out;
}

/**
 * A vocabulary node in the shape `vocabToken()` reads.
 *
 * The feed writes `{"@id": "kb:BarePitch"}`; the API writes
 * `{"key": "BarePitch", "label": {…}}`. Measured on the live sample, the
 * tokens themselves are THE SAME vocabulary — `BarePitch`,
 * `BungalowRental`, `CamperServicePoint` all appear verbatim — so this
 * only restores the shape, it does not translate meaning.
 *
 * ⚠️ That comparison was 20 campsites, which is a first look and not a
 * census. The full token set of both sides must be compared before the
 * feed is switched off; the card carries that as its own step.
 */
function vocabNode(value: unknown): unknown[] {
  return asList(value).map((v) => {
    if (v && typeof v === 'object' && 'key' in v) {
      const key = (v as { key: unknown }).key;
      if (typeof key === 'string') return { '@id': key };
    }
    return v;
  });
}

/** The bare token out of either shape, sorted, for the identity below. */
function tokenOf(value: unknown): string[] {
  return asList(value)
    .map((v) => {
      if (typeof v === 'string') return v.replace(/^kb:/, '');
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        const t = typeof o.key === 'string' ? o.key : o['@id'];
        if (typeof t === 'string') return t.replace(/^kb:/, '');
      }
      return null;
    })
    .filter((t): t is string => !!t)
    .sort();
}

/** JSON with every object's keys in a fixed order, at every depth. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const body = Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * A stable identity for one tariff line.
 *
 * 🔴 WE MINT THIS. The API does not.
 *
 * Measured on 20 live campsites: 35 `priceSpecification` nodes, and
 * **none** of them carries `@id`, `id`, `uri`, `uuid` or `identifier`.
 * The feed gives every tariff an `@id`, `prices.ts` uses it as the ref
 * AND as the duplicate key, and it rejects a tariff without one
 * (`reject('no-ref')`). Fed the API's shape untouched, we would drop
 * every tariff in France and the tests would show nothing wrong, because
 * the loss is a rejection, not a crash.
 *
 * 🔴 TWO WAYS THE FIRST VERSION GOT THIS WRONG, both found in review and
 * both reproduced before being fixed:
 *
 * 1. It hashed `JSON.stringify` of the raw nodes, so the ref moved when
 *    the API returned the same data with its keys in another order
 *    (`{startDate,endDate}` against `{endDate,startDate}`), and moved
 *    again when a vocabulary node merely gained a translation. A ref that
 *    drifts is worse than no ref: `import-prices.ts` upserts without
 *    deleting, so the page ends up printing one tariff twice.
 * 2. It left `price` and `hasEligiblePolicy` out of the hash although
 *    `prices.ts` reads both — so a €12 line and a €30 line at one
 *    campsite COLLIDED, and the second was discarded as a duplicate.
 *
 * So the identity is built from normalised, order-independent parts: the
 * vocabulary TOKENS rather than their labels, every priced field the
 * parser reads, and the French name, which is the source language here
 * and does not churn when another translation is added.
 *
 * It is NOT a DATAtourisme identifier and must never be shown or exported
 * as one — hence the `camptribe:` marker, which makes that obvious in a
 * database row as well as here.
 */
export function tariffRef(
  poiUri: string,
  spec: Record<string, unknown>,
): string {
  const name = langMap(spec.name);
  const fr =
    name && typeof name === 'object' && !Array.isArray(name)
      ? ((name as Record<string, unknown>).fr ?? null)
      : null;
  const digest = createHash('sha256')
    .update(
      canonical({
        poi: poiUri,
        // Only the French wording. Other translations arrive and leave
        // over time and none of them changes which tariff this is.
        name: fr,
        minPrice: asList(spec.minPrice),
        maxPrice: asList(spec.maxPrice),
        price: asList(spec.price),
        currency: spec.priceCurrency ?? null,
        period: asList(spec.appliesOnPeriod),
        offer: tokenOf(spec.hasPricingOffer),
        mode: tokenOf(spec.hasPricingMode),
        policy: tokenOf(spec.hasEligiblePolicy),
      }),
    )
    .digest('hex');
  return `camptribe:${poiUri}#${digest.slice(0, 16)}`;
}

/**
 * One API object as the shape `prices.ts` already consumes.
 *
 * The leaf vocabulary did not change — `hasPricingOffer`,
 * `textPriceSpecification`, `minPrice`, `maxPrice` are all still there.
 * What changed is depth, prefixes and the language-map spelling, so this
 * is a re-nesting rather than a new parser, and `prices.ts` stays
 * untouched:
 *
 *     API                                 feed / prices.ts
 *     type                                @type
 *     uri                                 @id
 *     offers[].priceSpecification[]       offers[]['schema:priceSpecification']
 *     …minPrice / maxPrice / price        schema:minPrice / maxPrice / price
 *     …priceCurrency                      schema:priceCurrency
 *     …hasPricingOffer[].key              hasPricingOffer[]['@id']
 *     {"@fr": "x"}                        {"fr": ["x"]}
 *     (nothing)                           @id on each tariff — minted above
 *
 * `textPriceSpecification` sits on the OFFER in both — measured, not
 * assumed: one occurrence on an offer and none on a specification across
 * the live sample.
 *
 * `lastUpdate` and `lastUpdateDatatourisme` carry the same names on both
 * sides and are passed through: Licence Ouverte 2.0 requires the date of
 * the last update beside every record, and a node without one is dropped
 * by `prices.ts` rather than shown undated.
 */
export function toFeedNode(obj: Record<string, unknown>): JsonLdNode | null {
  const uri = obj.uri;
  if (typeof uri !== 'string' || !uri) return null;

  const offers = asList(obj.offers).map((offer) => {
    const o = (offer ?? {}) as Record<string, unknown>;
    const specs = asList(o.priceSpecification).map((spec) => {
      const s = (spec ?? {}) as Record<string, unknown>;
      return {
        ...s,
        '@id': tariffRef(uri, s),
        // 🔴 Every `schema:` key the parser reads, and the list is
        // exhaustive on purpose. Prefixing only the two obvious ones
        // (min and max) made `parsePriceSpec` answer `no-currency` and
        // return null — the tariff vanished with no error anywhere.
        'schema:minPrice': asList(s.minPrice),
        'schema:maxPrice': asList(s.maxPrice),
        'schema:price': asList(s.price),
        'schema:priceCurrency': s.priceCurrency,
        name: langMap(s.name),
        additionalInformation: langMap(s.additionalInformation),
        hasPricingOffer: vocabNode(s.hasPricingOffer),
        hasPricingMode: vocabNode(s.hasPricingMode),
        hasEligiblePolicy: vocabNode(s.hasEligiblePolicy),
      };
    });
    return {
      ...o,
      'schema:priceSpecification': specs,
      textPriceSpecification: langMap(o.textPriceSpecification),
    };
  });

  return {
    ...obj,
    '@id': uri,
    '@type': asList(obj.type),
    offers,
  };
}

/** The query for one page, or the cursor URL the previous page handed us. */
export function catalogUrl(cursor?: string): string {
  if (cursor) return cursor;
  const url = new URL(CATALOG_URL);
  url.searchParams.set('type', CAMPSITE_TYPE);
  url.searchParams.set('fields', CATALOG_FIELDS);
  url.searchParams.set('page_size', String(CATALOG_PAGE_SIZE));
  return url.toString();
}

/**
 * Every campsite the API holds, page by page.
 *
 * 🔴 Stops on `meta.next` being absent, never on a page coming back
 * empty. An empty page in the middle of a cursor walk is a fault, not an
 * ending — treating it as the end is how a silent half-import looks like
 * a successful one. A short page with a cursor still following it is
 * normal and keeps going.
 */
export async function* catalogNodes(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<JsonLdNode> {
  let url: string | undefined = catalogUrl();
  let campsites = 0;
  let pages = 0;
  // 🔴 A cursor that points at its own page is a loop with no exit, and
  // review produced one: `meta.next` echoing the current URL ran 2 001
  // requests before being killed by hand. The server decides where we go
  // next, so the bound has to live on this side.
  const visited = new Set<string>();

  while (url) {
    if (visited.has(url)) {
      throw new Error(
        `DATAtourisme catalogue sent us back to a page we already read, after ${pages} page(s) — refusing to loop`,
      );
    }
    visited.add(url);
    if (pages >= MAX_CATALOG_PAGES) {
      throw new Error(
        `DATAtourisme catalogue went past ${MAX_CATALOG_PAGES} pages — refusing to keep walking`,
      );
    }

    const res = await fetchImpl(url, { headers: { 'x-api-key': apiKey } });
    if (!res.ok) {
      throw new Error(
        `DATAtourisme catalogue answered HTTP ${res.status} on page ${pages + 1} after ${campsites} campsites`,
      );
    }
    const page = (await res.json()) as CatalogPage;
    pages += 1;

    for (const obj of page.objects ?? []) {
      const node = toFeedNode(obj);
      if (!node) continue;
      // 🔴 Count CAMPSITES, not objects. The first version counted
      // anything carrying a `uri`, so a renamed ontology class — 50
      // objects typed `CampingAndCaravanningSite` — walked straight
      // through, yielded 50 nodes that `isCampsiteNode` then rejected,
      // and raised nothing at all. The guard below promised to catch
      // exactly that while measuring the wrong thing.
      if (isCampsiteNode(node)) campsites += 1;
      yield node;
    }

    url = page.meta?.next;
  }

  if (campsites === 0) {
    // 🔴 Zero is a failure, not an empty catalogue. Measured today:
    // 9 438 campsites. A run that walks the cursor and finds none has hit
    // a changed filter, a revoked key or a renamed type, and the one
    // thing it must not do is let an importer write that emptiness over
    // what we already hold.
    throw new Error(
      `DATAtourisme catalogue returned no campsites across ${pages} page(s) — refusing to report an empty import`,
    );
  }
}
