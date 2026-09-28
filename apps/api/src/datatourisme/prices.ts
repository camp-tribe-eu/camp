// CAMP-147: prices out of the DATAtourisme JSON-LD feed.
//
// 🔴 A different file from parse.ts, and not for tidiness. parse.ts reads
// the regional CSV exports from data.gouv.fr, which carry no price column
// at all — that is why the feed was set up in the first place (CAMP-128).
// Nothing here is a port of anything there.
//
// 🔴 Every shape below was read off the real 810 MB archive on
// 28.09.2026 with a full pass over all 129 594 objects. That matters more
// than usual here, because the card that ordered this work exists to
// correct a sample of fourteen records that overstated price coverage by
// half.
//
// What the full pass found:
//
//     objects                                    129 594
//     campsites (@type CampingAndCaravanning)      9 590
//     ├─ carrying an offers block                  6 962
//     ├─ carrying schema:priceSpecification        4 360
//     ├─ carrying textPriceSpecification             407
//     └─ carrying a price WE CAN STORE             3 433
//
//     tariff lines stored                         13 122
//     ├─ with a validity period                    6 890
//     └─ with none                                 6 232
//
// 🔴 3 433, not 4 459 — and not 3 689 either. THREE counts were in
// circulation and only one of them is the answer to the question the
// card asks, so here are all three with what each measures:
//
//     4 459  campsites carrying a price BLOCK of either kind: the union
//            of `priceSpecification` (4 360) and `textPriceSpecification`
//            (407), overlapping on 308.
//     3 689  campsites carrying a numeric-LOOKING value anywhere,
//            ignoring whether it has a currency and whether the range
//            runs the right way.
//     3 433  campsites carrying a price THIS PARSER WILL STORE. <— the
//            one that matches what a reader can be shown.
//
// The step from 3 689 to 3 433 is 256 campsites whose only figures had
// no currency beside them or ran from a higher number to a lower one.
// The step from 4 459 to 3 689 is two things that are not numbers:
//
//   - 671 campsites carry price specifications with no amount anywhere.
//     Their specifications hold `"schema:priceCurrency": "EUR"`, a name,
//     sometimes a pricing policy — and no figure. A currency is not a
//     price.
//   - the 407 prose records are prose BY DEFINITION, and the same card
//     forbids turning them into numbers.
//
// So the count of campsites we can state a price for is 3 433 of 9 590
// — 35.8%, not 46%. Every figure above comes from one command:
//
//     npx ts-node src/datatourisme/import-prices.ts <feed.zip> --report
//
// which reconciles by construction: 13 122 stored + 2 404 dropped is
// the 15 526 specifications the feed contains, itemised by reason.

/** A JSON-LD node, as it arrives. Nothing is trusted to be a given type. */
export type JsonLdNode = Record<string, unknown>;

/**
 * One line of a campsite's price list.
 *
 * `label` is the operator's own words and is never parsed for a number;
 * see the note on `textPriceNotes` below, which is the same rule at the
 * other end of the file.
 */
export type ParsedTariff = {
  /** The specification's URI in the source. Unique within one campsite. */
  ref: string;
  /** WHAT is priced — `BarePitch`, `CamperPitch`, `TouristTax`… */
  offer: string | null;
  /** HOW it is charged — `Overnight`, `PerWeek`, `PerAnimal`… */
  mode: string | null;
  /** WHO it applies to — `BaseRateFullRate`, `ChildRate`, `Free`… */
  policy: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  currency: string;
  /** ISO date, or null when the source states no season. */
  validFrom: string | null;
  validUntil: string | null;
  /** The operator's own words, verbatim. Never translated, never parsed. */
  label: string | null;
  labelLang: string | null;
};

/** A price the source states in prose. Carried as text or not at all. */
export type TextPriceNote = {
  text: string;
  lang: string;
};

/**
 * Why a price specification was refused.
 *
 * 🔴 Every refusal is reportable, and that is not bookkeeping. A parser
 * that silently drops 8% of its input looks identical to one that reads
 * all of it, and the only symptom is a coverage number nobody can
 * explain six months later. `import-prices.ts --report` prints these,
 * so the gap between "specifications in the feed" and "tariffs stored"
 * is always itemised.
 */
export type RejectReason =
  | 'no-ref'
  | 'no-amount'
  | 'no-currency'
  | 'range-backwards'
  | 'period-backwards'
  | 'lang-tag-too-long'
  | 'duplicate-ref';

export type RejectSink = (reason: RejectReason) => void;

/**
 * 🔴 The width of `spot_tariffs.label_lang`, repeated here on purpose.
 *
 * Review proved the cost of not having it: `fr-Latn-FR-x-private` is a
 * valid BCP 47 tag, this file accepted it, and Postgres answered `value
 * too long for type character varying(8)`. That error arrives mid-INSERT
 * inside the import's single transaction, so ONE record with an unusual
 * language tag rolled back all 12 402 rows and the weekly import wrote
 * nothing at all.
 *
 * The parser is where a record can be dropped for one record's worth of
 * cost. Everything below that refuses a value refuses it HERE, and the
 * report counts it — which is the same rule `range-backwards` already
 * stated and which was simply never applied to the other two columns.
 */
export const MAX_LANG_TAG = 8;

export type ParsedPrices = {
  /** The POI's URI — the same `ref` the campsite import stores. */
  ref: string;
  /** Licence Ouverte: the day the source last changed this record. */
  updatedAt: string;
  tariffs: ParsedTariff[];
  /** Prose prices, verbatim. NEVER promoted into `tariffs`. */
  textNotes: TextPriceNote[];
};

/**
 * 🔴 The type filter, and the trap it exists for.
 *
 * A campsite in this feed carries SIX types at once:
 *
 *     schema:Accommodation, schema:LodgingBusiness, Accommodation,
 *     CampingAndCaravanning, PlaceOfInterest, PointOfInterest
 *
 * Filtering on `schema:LodgingBusiness` drags every hotel in the country
 * in with it. `CampingAndCaravanning` is the one that means a campsite.
 *
 * 🔴 And it must be the TOP-LEVEL @type, not the string anywhere in the
 * file. Measured: over a 462-object slice, 219 files contain the string
 * and 27 are campsites. The other 192 carry it inside
 * `hasReview[].hasReviewValue.isCompliantWith[]` — a review recording
 * which classification scheme it was issued under. A grep-shaped filter
 * would have over-selected eightfold and imported prices for museums.
 */
export function isCampsiteNode(node: JsonLdNode): boolean {
  return asList(node['@type']).some((t) => t === 'CampingAndCaravanning');
}

/** JSON-LD writes single values and arrays interchangeably. */
function asList(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * A `kb:` vocabulary token, without its prefix.
 *
 * The node is `{"@id": "kb:BarePitch", "@type": [...], "rdfs:label": {…}}`.
 * We keep the token and not the label: the label is seven languages deep
 * and the token is the stable identity. Every one of the 51 tokens in
 * the feed carries an English label and none of them disagrees with
 * itself across 129 594 objects, so the reader-facing wording is a
 * lookup and not a translation of ours (web/src/lib/tariffs.ts).
 */
function vocabToken(nodes: unknown): string | null {
  for (const n of asList(nodes)) {
    if (typeof n === 'string') return n.replace(/^kb:/, '') || null;
    if (n && typeof n === 'object') {
      const id = (n as JsonLdNode)['@id'];
      if (typeof id === 'string') return id.replace(/^kb:/, '') || null;
    }
  }
  return null;
}

/**
 * A money amount, or null.
 *
 * 🔴 Deliberately strict, and `Number()` is not used. `Number('')` is 0,
 * `Number(' ')` is 0 and `Number([])` is 0 — three ways for a missing
 * price to become a free campsite. `Number('12 €')` is NaN, which is
 * right, but `Number('1e3')` is 1000, which is not a price anybody
 * wrote. So the string must LOOK like a decimal number and nothing else.
 *
 * 🔴 A comma is accepted as the decimal separator because the feed is
 * French and `"13,50"` means thirteen euros fifty. A thousands separator
 * is NOT accepted: `"1,500"` is genuinely ambiguous between 1.5 and
 * 1500, and guessing wrong by a factor of a thousand on a price is the
 * worst available outcome. It is refused, and the report counts it.
 *
 * 🔴 Negative is refused. `"-1"` appears four times in the feed and
 * `"-5"` once; whatever they mean, they are not prices.
 *
 * 🔴 And `"2.7999999523162841796875"` is refused, which is the case that
 * justifies the whole rule. It appears four times: 2.80 put through a
 * 32-bit float upstream and printed back at full precision. A tolerant
 * parser accepts it happily and the page then prints twenty-two
 * significant figures at a reader deciding where to sleep. Two decimals
 * or it is not a price we will repeat.
 *
 * Measured over the whole feed, the strict rule refuses nine values a
 * tolerant `parseFloat` would have taken, and all nine are one of those
 * three shapes.
 */
export function parseAmount(value: unknown): number | null {
  for (const raw of asList(value)) {
    if (typeof raw === 'number') {
      return Number.isFinite(raw) && raw >= 0 ? raw : null;
    }
    if (typeof raw !== 'string') continue;
    const s = raw.trim();
    // One optional decimal separator, digits either side. Nothing else:
    // no exponent, no currency sign, no thousands grouping, no sign.
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(s)) continue;
    // 🔴 No second `Number.isFinite(n) && n >= 0` here, and its removal
    // is the point rather than tidying. It was there, and mutation
    // testing showed that breaking it changed nothing: the pattern above
    // admits no minus sign and no exponent, so on this path the check
    // could never be false. A guard that cannot fail is not a guard —
    // it is a claim the tests appear to cover and do not. The live
    // negative check is the numeric branch above, which now has a test.
    return Number(s.replace(',', '.'));
  }
  return null;
}

/**
 * ISO date, or null.
 *
 * The feed writes `"2026-04-01"`. Anything else — an empty string, a
 * French `01/04/2026`, a full timestamp — is refused rather than
 * coerced, because a validity period is the field this card is about and
 * a date read wrongly is worse than no date at all.
 */
export function parseIsoDate(value: unknown): string | null {
  for (const raw of asList(value)) {
    if (typeof raw !== 'string') continue;
    const s = raw.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) continue;
    // Rejects 2026-02-31, which matches the pattern and is not a day.
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;
    if (d.toISOString().slice(0, 10) !== s) continue;
    return s;
  }
  return null;
}

/**
 * The first language-tagged string of a `{"fr": ["…"]}` map.
 *
 * 🔴 Returns the LANGUAGE with the text, always. The pair is what the
 * page renders into a `lang` attribute; a string that arrives without
 * its language is dropped, because labelling French prose as English is
 * the failure this returns a tuple to prevent.
 *
 * French first where both exist, because these strings are the
 * operator's own and the French one is the original. An English value in
 * this feed is the tourist office's own translation, not ours — but the
 * original is what we quote.
 */
export function firstLangString(
  value: unknown,
): { text: string; lang: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const map = value as Record<string, unknown>;
  const langs = Object.keys(map);
  const ordered = [
    ...langs.filter((l) => l === 'fr'),
    ...langs.filter((l) => l !== 'fr'),
  ];
  for (const lang of ordered) {
    if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/.test(lang)) continue;
    for (const candidate of asList(map[lang])) {
      if (typeof candidate !== 'string') continue;
      const text = candidate.trim();
      if (text) return { text, lang: lang.toLowerCase() };
    }
  }
  return null;
}

/** `"EUR"` and `"Eur"` are the same currency; 97 records shout the second. */
function currencyOf(value: unknown): string | null {
  for (const raw of asList(value)) {
    if (typeof raw !== 'string') continue;
    const s = raw.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(s)) return s;
  }
  return null;
}

/**
 * One `schema:priceSpecification` node, or null if it states no number.
 *
 * 🔴 Returning null for a numberless specification is the point, not an
 * edge case. 1 264 of the feed's 15 526 specifications hold a currency,
 * a name and no amount at all, and they are the single largest reason
 * the card's "4 459 campsites with a real price" is really 3 433.
 */
export function parsePriceSpec(
  spec: JsonLdNode,
  reject: RejectSink = () => undefined,
): ParsedTariff | null {
  const ref = spec['@id'];
  if (typeof ref !== 'string' || !ref) {
    reject('no-ref');
    return null;
  }

  const min = parseAmount(spec['schema:minPrice']);
  const max = parseAmount(spec['schema:maxPrice']);
  // `schema:price` is a single figure — 721 of them. It is neither a
  // floor nor a ceiling, it is the price, so it becomes both ends of a
  // range of one and the page prints "€13.50" rather than "from €13.50".
  const exact = parseAmount(spec['schema:price']);

  let minPrice = min;
  let maxPrice = max;
  if (minPrice === null && maxPrice === null && exact !== null) {
    minPrice = exact;
    maxPrice = exact;
  }
  if (minPrice === null && maxPrice === null) {
    reject('no-amount');
    return null;
  }
  // 🔴 A range that runs backwards is a typo at the source and would
  // print as "from €90 to €19". Refused here as well as by the CHECK
  // constraint, so the import report can count it instead of the
  // transaction failing on it.
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    reject('range-backwards');
    return null;
  }

  const currency = currencyOf(spec['schema:priceCurrency']);
  // 🔴 No default to EUR. An amount whose currency we invented is a
  // number presented as a fact about money, and the feed is not
  // exclusively French forever. 14 770 of 15 526 specifications state
  // one; the rest are refused and counted.
  if (!currency) {
    reject('no-currency');
    return null;
  }

  const period = asList(spec['appliesOnPeriod'])[0] as JsonLdNode | undefined;
  const validFrom = period ? parseIsoDate(period.startDate) : null;
  const validUntil = period ? parseIsoDate(period.endDate) : null;
  // 🔴 A season that runs backwards, refused for the same reason a
  // backwards price is — and this one was missed, which review proved
  // end to end: `spot_tariffs_period_ordered` fired mid-INSERT, the
  // single transaction rolled back, and 0 of 12 402 rows were written by
  // a weekly import that had nothing else wrong with it.
  //
  // Every CHECK constraint on the table now has its twin here. A
  // constraint is the floor under a bug, not the place to discover one:
  // reaching it costs the whole run, refusing here costs one record.
  if (validFrom !== null && validUntil !== null && validFrom > validUntil) {
    reject('period-backwards');
    return null;
  }

  const label = firstLangString(spec['name']);
  // 🔴 The label is dropped, the PRICE is not. A language tag we cannot
  // store is a reason to lose one sentence of the operator's prose, not
  // a reason to lose the tariff it describes — and never a reason to
  // store the text with no language, which is the other CHECK
  // constraint and which would have a screen reader read French aloud
  // in English.
  const labelFits = label !== null && label.lang.length <= MAX_LANG_TAG;
  if (label !== null && !labelFits) reject('lang-tag-too-long');

  return {
    ref,
    offer: vocabToken(spec['hasPricingOffer']),
    mode: vocabToken(spec['hasPricingMode']),
    policy: vocabToken(spec['hasEligiblePolicy']),
    minPrice,
    maxPrice,
    currency,
    validFrom,
    validUntil,
    label: labelFits ? label.text : null,
    labelLang: labelFits ? label.lang : null,
  };
}

/**
 * 🔴 Prose prices, carried as prose. This function returns STRINGS and
 * has no way to return a number, which is the whole design.
 *
 * 407 records state the price in words:
 *
 *     "Stationnement gratuit"
 *     "Tarif Mobilhome à partir de 450 € / semaine"
 *     "adulte à partir de 13ans supplémentaire : 5.5€/nuit
 *      enfant de 5 à 12ans : 3.5€/nuit …"
 *
 * Every one of them contains a figure a regular expression would be glad
 * to extract, and every extraction would be an invention: "450 € /
 * semaine" is not the campsite's price, it is the price of one kind of
 * mobile home for one week, and the sentence around it is what says so.
 * The card forbids the extraction outright. So the text is shown as the
 * source wrote it, marked as the source's own words, or it is not shown.
 */
export function textPriceNotes(node: JsonLdNode): TextPriceNote[] {
  const out: TextPriceNote[] = [];
  const seen = new Set<string>();
  for (const offer of asList(node.offers)) {
    if (!offer || typeof offer !== 'object') continue;
    const o = offer as JsonLdNode;
    // Measured: the key sits on the OFFER, never on the specification,
    // and never with a `schema:` prefix. Both spellings are read anyway
    // — the cost is one line and the feed is somebody else's.
    for (const key of [
      'textPriceSpecification',
      'schema:textPriceSpecification',
    ]) {
      for (const raw of asList(o[key])) {
        const got = firstLangString(raw);
        if (!got) continue;
        const dedupe = `${got.lang}\u0000${got.text}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        out.push(got);
      }
    }
  }
  return out;
}

/**
 * Everything CAMP-147 wants out of one POI, or null if it is not a
 * campsite or the licence will not let us use it.
 *
 * 🔴 A record with no `lastUpdate` is refused, exactly as parse.ts
 * refuses one. Licence Ouverte 2.0 requires the reuse to state the
 * source AND the date it last updated the information; a price with no
 * date is the case where that matters most, because the reader is using
 * it to decide what a night will cost them.
 */
export function parsePrices(
  node: JsonLdNode,
  reject: RejectSink = () => undefined,
): ParsedPrices | null {
  if (!isCampsiteNode(node)) return null;

  const ref = node['@id'];
  if (typeof ref !== 'string' || !ref) return null;

  const updatedAt =
    parseIsoDate(node.lastUpdate) ??
    parseIsoDate(
      typeof node.lastUpdateDatatourisme === 'string'
        ? node.lastUpdateDatatourisme.slice(0, 10)
        : null,
    );
  if (!updatedAt) return null;

  const tariffs: ParsedTariff[] = [];
  const seenRefs = new Set<string>();
  for (const offer of asList(node.offers)) {
    if (!offer || typeof offer !== 'object') continue;
    for (const spec of asList(
      (offer as JsonLdNode)['schema:priceSpecification'],
    )) {
      if (!spec || typeof spec !== 'object') continue;
      const tariff = parsePriceSpec(spec as JsonLdNode, reject);
      if (!tariff) continue;
      // The unique index is (spot, source, ref). Measured: a URI never
      // repeats within one campsite in the whole feed — but the importer
      // must not be the thing that discovers it stopped being true.
      //
      // 🔴 Counted, not dropped in silence. This file's own doctrine is
      // that a parser which silently discards input is indistinguishable
      // from one that reads all of it; this was the one refusal that did
      // not obey it. Note it dedupes within ONE node — the same URI
      // arriving on a SECOND POI that maps to the same campsite is a
      // different problem and is handled in import-prices.ts, where the
      // spot id is known.
      if (seenRefs.has(tariff.ref)) {
        reject('duplicate-ref');
        continue;
      }
      seenRefs.add(tariff.ref);
      tariffs.push(tariff);
    }
  }

  return { ref, updatedAt, tariffs, textNotes: textPriceNotes(node) };
}
