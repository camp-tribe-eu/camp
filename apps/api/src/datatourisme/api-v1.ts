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

import { createHash } from 'node:crypto';
import type { JsonLdNode } from './prices';

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

/** One page as the API returns it. */
export interface CatalogPage {
  objects: Record<string, unknown>[];
  meta: { total: number; page: number; page_size: number; next?: string };
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
 * So the ref is content-addressed: the same tariff text at the same
 * campsite yields the same ref on every refresh, and two genuinely
 * different lines under one campsite cannot collide. It is NOT a
 * DATAtourisme identifier and must never be shown or exported as one —
 * hence the `camptribe:` marker, which makes that obvious in a database
 * row as well as here.
 */
export function tariffRef(poiUri: string, spec: Record<string, unknown>): string {
  const canonical = JSON.stringify([
    poiUri,
    spec.name ?? null,
    spec.minPrice ?? null,
    spec.maxPrice ?? null,
    spec.priceCurrency ?? null,
    spec.appliesOnPeriod ?? null,
    spec.hasPricingOffer ?? null,
    spec.hasPricingMode ?? null,
  ]);
  const digest = createHash('sha256').update(canonical).digest('hex');
  return `camptribe:${poiUri}#${digest.slice(0, 16)}`;
}

/** JSON-LD writes single values and arrays interchangeably; so does the API. */
function asList(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
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

/**
 * One API object as the shape `prices.ts` already consumes.
 *
 * The leaf vocabulary did not change — `hasPricingOffer`,
 * `textPriceSpecification`, `minPrice`, `maxPrice` are all still there.
 * What changed is depth and prefixes, so this is a re-nesting rather
 * than a new parser, and `prices.ts` stays untouched:
 *
 *     API                                    feed / prices.ts
 *     type                                   @type
 *     uri                                    @id
 *     offers[].priceSpecification[]          offers[]['schema:priceSpecification'][]
 *     …minPrice / …maxPrice                  schema:minPrice / schema:maxPrice
 *     …hasPricingOffer[].key                 hasPricingOffer[]['@id']
 *     (nothing)                              @id on each tariff — minted above
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
        // return null — the tariff vanished with no error anywhere, which
        // is exactly the quiet loss this module exists to prevent. The
        // list comes from grepping prices.ts for `spec['schema:…']`, not
        // from memory; if that file grows a key, this breaks loudly in
        // the round-trip test below rather than dropping rows.
        'schema:minPrice': asList(s.minPrice),
        'schema:maxPrice': asList(s.maxPrice),
        'schema:price': asList(s.price),
        'schema:priceCurrency': s.priceCurrency,
        hasPricingOffer: vocabNode(s.hasPricingOffer),
        hasPricingMode: vocabNode(s.hasPricingMode),
        hasEligiblePolicy: vocabNode(s.hasEligiblePolicy),
      };
    });
    return { ...o, 'schema:priceSpecification': specs };
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
  let seen = 0;
  let pages = 0;

  while (url) {
    const res = await fetchImpl(url, { headers: { 'x-api-key': apiKey } });
    if (!res.ok) {
      throw new Error(
        `DATAtourisme catalogue answered HTTP ${res.status} on page ${pages + 1} after ${seen} objects`,
      );
    }
    const page = (await res.json()) as CatalogPage;
    pages += 1;

    for (const obj of page.objects ?? []) {
      const node = toFeedNode(obj);
      if (node) {
        seen += 1;
        yield node;
      }
    }

    url = page.meta?.next;
  }

  if (seen === 0) {
    // 🔴 Zero objects is a failure, not an empty catalogue. Measured
    // today: 9 438 campsites. A run that walks the cursor and returns
    // nothing has hit a changed filter, a revoked key or a renamed type,
    // and the one thing it must not do is let an importer write that
    // emptiness over what we already hold.
    throw new Error(
      `DATAtourisme catalogue returned no campsites across ${pages} page(s) — refusing to report an empty import`,
    );
  }
}
