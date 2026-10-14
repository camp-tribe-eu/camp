// CAMP-119: the facility tags a stopping place carries, and what the
// database says about a tag nobody wrote.
//
// No Nest imports, no database: pure builders over constants, so a spec
// can run them. The same reason route-poi-sql.ts gives.
//
// ── THREE STATES, AND THE THIRD IS A VALUE ───────────────────────────────
//
// `camping_spots.amenities` already settled this (tag-mapping.ts, CAMP-27):
// a shower is `yes`, `no` or `unknown`, and "missing is not no — it is
// nobody wrote it down". A filter built on a collapsed boolean tells a
// driver that 16 807 of 16 817 rest areas have no fee, when what OSM holds
// is `fee=yes` on TEN of them and no statement at all on the rest.
//
// So every facility column on `osm_route_poi` is NOT NULL and says one of
// the three words — never NULL, never an empty string — and the column
// DEFAULT is 'unknown', so a row nobody has re-imported yet is not
// mistaken for a row that was read and found to say "no".
//
// 🔴 THE VOCABULARY IS THE CAMPSITES' ONE, BY IMPORT AND NOT BY COPY.
// `TRUTHY` and `FALSY` are tag-mapping.ts's own sets: `toilets=designated`
// reads as yes on a campsite and on a rest area, `toilets=private` as no
// on both. Two lists of "what counts as yes" would drift, and the page
// would then say one thing about a toilet at a campsite and another about
// the same tag at a service area.
//
// 🔴 EXCEPT `fee`, AND THE EXCEPTION IS THE POINT OF THE CARD.
// TRUTHY/FALSY describe AVAILABILITY. `fee=private` through FALSY is "no
// fee", which turns a nonsense value into the claim "this is free" — the
// one claim this card refuses to make from thin data. `fee` accepts only
// the plain yes/no spellings and everything else (`donation`, `interval`,
// `customers`, `conditional`) is `unknown`, which is what we know.
//
// ── AND FOUR TAGS ARE NOT YES/NO AT ALL ──────────────────────────────────
//
// `access`, `hgv`, `maxheight`, `maxlength` carry a value ("customers",
// "destination", "3.5", "11'6\"", "default"). Collapsing them to a
// boolean would throw away the only information they have, so they are
// stored as OSM wrote them — lower-cased and trimmed, the same stance the
// opening_hours column takes ("verbatim and untranslated") — and the word
// `unknown` stands where the tag is absent.
//
// `maxheight` is `unknown` on every rest area in the EU-27 extract
// (measured 25.09.2026: 0 of 16 817) and on 99.8% of fuel stations; the
// column exists so the day that changes there is nothing to build.

import { FALSY, TRUTHY } from './tag-mapping';

/** The three words. Same spelling as `AmenityValue` in tag-mapping.ts. */
export const FACILITY_STATES = ['yes', 'no', 'unknown'] as const;
export type FacilityState = (typeof FACILITY_STATES)[number];

/** The word for "nobody wrote it down". Not 'no'. Not NULL. */
export const UNKNOWN: FacilityState = 'unknown';

export interface Vocabulary {
  yes: ReadonlySet<string>;
  no: ReadonlySet<string>;
}

/** What an AVAILABILITY tag means — shared with campsite amenities. */
const AVAILABILITY: Vocabulary = { yes: TRUTHY, no: FALSY };

/** What a CHARGE tag means. Deliberately narrower — see the header. */
const CHARGE: Vocabulary = {
  yes: new Set(['yes', 'true', '1']),
  no: new Set(['no', 'false', '0']),
};

/**
 * The yes/no/unknown columns, in table order. Each is both the OSM key
 * (the column ogr2ogr builds in the staging table) and the column on
 * `osm_route_poi`.
 */
export const TRISTATE_FACILITIES = [
  { column: 'toilets', vocabulary: AVAILABILITY },
  { column: 'shower', vocabulary: AVAILABILITY },
  { column: 'drinking_water', vocabulary: AVAILABILITY },
  { column: 'sanitary_dump_station', vocabulary: AVAILABILITY },
  { column: 'fee', vocabulary: CHARGE },
] as const;

/** The value-carrying columns. `unknown` when the tag is absent. */
export const VERBATIM_FACILITIES = [
  'access',
  'hgv',
  'maxheight',
  'maxlength',
] as const;

export const TRISTATE_COLUMNS: readonly string[] = TRISTATE_FACILITIES.map(
  (f) => f.column,
);

/** Every column this card added, in the order the INSERT writes them. */
export const FACILITY_COLUMNS: readonly string[] = [
  ...TRISTATE_COLUMNS,
  ...VERBATIM_FACILITIES,
];

/**
 * The OSM keys the loader reads off a staging row for this card — what
 * the export must carry. Exactly the columns: a tag and its column share
 * a name, which is what keeps "is it in the export" a one-line question.
 */
export const FACILITY_TAGS: readonly string[] = FACILITY_COLUMNS;

// ── the JavaScript half ──────────────────────────────────────────────────
//
// 🔴 A SECOND IMPLEMENTATION, ON PURPOSE. The SQL below is what runs on
// 2.2 million rows; this is what a spec and the sampling check compare it
// to. Two implementations of one rule only help when they are made to
// disagree out loud — route-poi-facilities.spec.ts runs the same inputs
// through BOTH, against a real PostgreSQL, and fails if they differ.

/**
 * One tag value → a state. Mirrors `triStateSql` and tag-mapping.ts's
 * `readValueRule`: a semicolon list is read part by part, ANY yes wins,
 * and it is a no only if EVERY part is.
 */
export function resolveTriState(
  raw: string | null | undefined,
  vocabulary: Vocabulary,
): FacilityState {
  if (raw === null || raw === undefined) return UNKNOWN;
  const text = raw.trim();
  if (text === '') return UNKNOWN;
  const parts = text
    .toLowerCase()
    .split(/\s*;\s*/)
    .filter((p) => p.length > 0);
  if (parts.some((p) => vocabulary.yes.has(p))) return 'yes';
  if (parts.length > 0 && parts.every((p) => vocabulary.no.has(p))) return 'no';
  return UNKNOWN;
}

/** One value-carrying tag → what the column holds. */
export function resolveVerbatim(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return UNKNOWN;
  const text = raw.trim().toLowerCase();
  return text === '' ? UNKNOWN : text;
}

// ── the SQL half ─────────────────────────────────────────────────────────

/**
 * A closed list of plain words, quoted. Nothing here comes from a
 * request, but this repository is public and a SQL string assembled by
 * concatenation is one careless edit from being the thing that does.
 */
function sqlWords(words: ReadonlySet<string>): string {
  const sorted = [...words].sort();
  for (const w of sorted) {
    if (!/^[a-z0-9_]+$/.test(w)) {
      throw new Error(
        `route-poi-facilities: unsafe vocabulary word ${JSON.stringify(w)}`,
      );
    }
  }
  return `ARRAY[${sorted.map((w) => `'${w}'`).join(', ')}]::text[]`;
}

function safeColumn(column: string): string {
  if (!/^[a-z_]+$/.test(column)) {
    throw new Error(
      `route-poi-facilities: unsafe column ${JSON.stringify(column)}`,
    );
  }
  return column;
}

/**
 * The SQL for one yes/no/unknown column.
 *
 * 🔴 `cardinality(...) > 0` before the no-list test, found by the
 * database spec on its first run: an EMPTY array is contained in every
 * array, so a value of `;` — no parts at all — came out as 'no' from SQL
 * and as 'unknown' from the JavaScript twin. Nobody has written that tag
 * (it is the one failure of this rule that would be invisible), and the
 * second implementation existed to say so.
 *
 * 🔴 The first branch is the card. A tag that is absent, empty or only
 * whitespace is 'unknown' — and so is the ELSE, so a spelling nobody has
 * met stays a statement about what we know and not a guess at what the
 * mapper meant. There is no path in this expression that returns 'no'
 * for the absence of a value.
 */
export function triStateSql(
  column: string,
  vocabulary: Vocabulary,
  alias = 's',
): string {
  const col = `${alias}."${safeColumn(column)}"`;
  // array_remove: `no;` is [no, ''] before it and [no] after, which is
  // what `resolveTriState` and tag-mapping.ts's splitValues both read.
  const parts = `array_remove(regexp_split_to_array(lower(btrim(${col})), '\\s*;\\s*'), '')`;
  return `CASE
              WHEN nullif(btrim(${col}), '') IS NULL THEN '${UNKNOWN}'
              WHEN ${parts} && ${sqlWords(vocabulary.yes)} THEN 'yes'
              WHEN cardinality(${parts}) > 0
               AND ${parts} <@ ${sqlWords(vocabulary.no)} THEN 'no'
              ELSE '${UNKNOWN}'
            END`;
}

/** The SQL for one value-carrying column. */
export function verbatimSql(column: string, alias = 's'): string {
  const col = `${alias}."${safeColumn(column)}"`;
  return `coalesce(lower(nullif(btrim(${col}), '')), '${UNKNOWN}')`;
}

/** `expr AS column` for every facility column, in INSERT order. */
export function facilitySelectSql(alias = 's'): string {
  const tri = TRISTATE_FACILITIES.map(
    (f) => `${triStateSql(f.column, f.vocabulary, alias)} AS ${f.column}`,
  );
  const verbatim = VERBATIM_FACILITIES.map(
    (c) => `${verbatimSql(c, alias)} AS ${c}`,
  );
  return [...tri, ...verbatim].join(',\n           ');
}
