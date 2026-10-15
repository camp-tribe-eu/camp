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
// stored as OSM wrote them — ASCII-lower-cased and trimmed of blanks (see
// the section below for what both words mean), the same stance the
// opening_hours column takes ("verbatim and untranslated") — and the word
// `unknown` stands where the tag is absent.
//
// `maxheight` is `unknown` on every rest area in the EU-27 extract
// (measured 25.09.2026: 0 of 16 817) and on 99.8% of fuel stations; the
// column exists so the day that changes there is nothing to build.

// ── CAMP-258: `lpg`, AND WHY IT IS NOT ONE OF THE NINE ───────────────────
//
// `lpg` says whether a place sells LPG (autogas) — `fuel:lpg=yes|no` on an
// `amenity=fuel` object. It is a third group beside the five yes/no/unknown
// facilities and the four verbatim ones, and it is kept OUT of them on
// purpose, for three reasons that each have a spec:
//
//   1. THE TAG IS NOT THE COLUMN. Every CAMP-119 column is read from the
//      OSM key of the same name; this one is read from `fuel:lpg` and
//      written as `lpg`, because a colon in a column name is a quoting
//      accident waiting for a query that forgets it. `LPG.tag` and
//      `LPG.column` are two words, and the INSERT reads `s."fuel:lpg"`.
//   2. IT IS NOT A STOPPING-PLACE FACILITY. TRISTATE_COLUMNS is the five
//      things a route page prints on a rest area, and route-services.spec.ts
//      asserts the page's field list equals it. A sixth entry would make the
//      page "decide by omission" about LPG on a service area.
//   3. THE ORACLE. count-rest-stops.mjs counts FACILITY_TAGS on the raw
//      extracts for the stopping kinds; `fuel:lpg` on a rest area is a
//      number nobody asked for.
//
// The vocabulary is the campsites' one, for the reason given above. Measured
// on the 27 raw extracts, 15.10.2026, over the 118 726 distinct
// `amenity=fuel` objects: `yes` 18 081, `no` 3 010, absent 97 621, and 14
// objects with some other word (`only` 5, `FIXME` 4, `fixme` 1, `retail`,
// `forest`, `surface`, `yes ACME, Dish`) — all of which read as `unknown`,
// which is what we know about them. `unknown` is never `no`: 82% of fuel
// stations say nothing about LPG, and a filter that treated them as "no LPG"
// would hide four in five stations that may well sell it.

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

/**
 * CAMP-258: whether a place sells LPG. The OSM key and the column are NOT
 * the same word — see the section above.
 */
export const LPG = {
  column: 'lpg',
  tag: 'fuel:lpg',
  vocabulary: AVAILABILITY,
} as const;

/**
 * CAMP-258: whether a gas cylinder can be swapped here. Written `yes` for any
 * object that carries the `gas_exchange` rule (`shop=gas`) — whatever KIND it
 * ended up with — and `unknown` for everything else. It reads no tag of its
 * own (the export already carries `shop`), so there is no `tag` here and the
 * expression lives in route-poi-sql.ts beside the rule it is derived from.
 * See STORED_ONLY_KINDS in route-poi.ts for why a column AND a kind.
 */
export const CYLINDER_SWAP = { column: 'cylinder_swap' } as const;

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

/**
 * 🔴 CAMP-258: EVERY facility-shaped column the INSERT writes — CAMP-119's
 * nine, then `lpg` and `cylinder_swap`. The INSERT, its SELECT list and its ON CONFLICT list
 * are all built from this one, so a column added to one of them and not to
 * the others is not a thing that can be typed.
 */
export const ROW_FACILITY_COLUMNS: readonly string[] = [
  ...FACILITY_COLUMNS,
  LPG.column,
  CYLINDER_SWAP.column,
];

/**
 * The OSM keys the INSERT reads for those columns beyond the nine: `fuel:lpg`,
 * not `lpg`. (`cylinder_swap` reads `shop`, which the export carries for the
 * classifier.)
 */
export const ROW_FACILITY_TAGS: readonly string[] = [...FACILITY_TAGS, LPG.tag];

// ── WHAT A BLANK IS, AND WHAT "LOWER-CASE" MEANS — ONE ANSWER, BOTH SIDES ─
//
// 🔴 CAMP-119 review, defect 1: the two implementations disagreed on a TAB.
// JavaScript's `trim()` strips 25 code points; PostgreSQL's `btrim(text)`
// strips exactly one (U+0020). `toilets='\tyes'` was `yes` to the
// JavaScript and `unknown` in the table, and the spec that exists to make
// the two disagree out loud fed them three kinds of blank and nothing
// else — narrowing the JavaScript to a plain space left every test green.
//
// 🔴 WHICH SIDE MOVED, AND WHY. The database moved to JavaScript's
// definition, not the other way round, for three reasons:
//   1. The generous reading is the safe one. `access='\tprivate'` is a
//      private place with a stray character. The narrow reading stores it
//      under the name `\tprivate`, which is not in the excluded list, and
//      PUBLISHES it. Trimming more can only drop a row that said "not
//      you"; it cannot make a row appear.
//   2. `scripts/osm-pipeline/count-rest-stops.mjs` — the oracle the import
//      is reconciled against — reads the raw extracts with `trim()`. Moving
//      the database to the same set is what lets the two count one thing.
//   3. A mapper who typed a tab before `yes` meant yes.
//
// 🔴 THE SET IS WRITTEN OUT, NOT LEFT TO EACH ENGINE. `\s` in a PostgreSQL
// regular expression is whatever the database's locale says: measured on
// camptribe_dev, U+FEFF is not a space to it and U+00A0 is, and under
// COLLATE "C" U+00A0 is not either — so an import run on another machine
// could split a list differently. The 25 code points below are the ones
// `trim()` and `\s` mean in JavaScript (the spec sweeps all 1 114 112 code
// points to prove it, so an engine whose table moves turns this red), and
// the SQL is built from this list and not from `\s`.
//
// 🔴 `lower()` IS ASCII-ONLY ON BOTH SIDES, FOR THE SAME REASON. PostgreSQL
// folds by the database's locale: `lower('İ')` is `i` here and `İ` under
// COLLATE "C"; JavaScript folds by Unicode SpecialCasing, where it is `i`
// plus U+0307. No two of those agree. Every word this module compares to
// is ASCII (`yes`, `designated`, `private`), so only an ASCII letter can
// change an answer — and a value in another script is kept as written
// instead of being re-spelled by whichever machine ran the import.

/** The code points `String.prototype.trim` strips — and `\s` matches. */
export const BLANK_CODE_POINTS: readonly number[] = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680, 0x2000,
  0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009,
  0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];

/** `rest;of;the;list` is read part by part, around a `;` of any blanks. */
const SEPARATOR = /\s*;\s*/;

/** An ASCII-only `toLowerCase`: see the note above on why not Unicode. */
export function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

/**
 * What a tag value IS, before anything reads it: blanks off both ends,
 * ASCII letters folded. Empty for a tag nobody wrote. The SQL twin is
 * `normalisedSql`, and `access` is read through it too — filter and
 * column must see one value.
 */
export function normaliseTag(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  return asciiLower(raw.trim());
}

/** A `;` list as its parts; none for a tag nobody wrote, or for `;`. */
export function tagParts(raw: string | null | undefined): string[] {
  return normaliseTag(raw)
    .split(SEPARATOR)
    .filter((p) => p.length > 0);
}

// ── the JavaScript half ──────────────────────────────────────────────────
//
// 🔴 A SECOND IMPLEMENTATION, ON PURPOSE. The SQL below is what runs on
// 2.2 million rows; this is what a spec and the sampling check compare it
// to. Two implementations of one rule only help when they are made to
// disagree out loud — route-poi-sql.db.spec.ts runs the same inputs
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
  const parts = tagParts(raw);
  if (parts.length === 0) return UNKNOWN;
  if (parts.some((p) => vocabulary.yes.has(p))) return 'yes';
  if (parts.every((p) => vocabulary.no.has(p))) return 'no';
  return UNKNOWN;
}

/** One value-carrying tag → what the column holds. */
export function resolveVerbatim(raw: string | null | undefined): string {
  const text = normaliseTag(raw);
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

const hex4 = (codePoint: number) => codePoint.toString(16).padStart(4, '0');

/**
 * The blanks as the text of a SQL string constant: `E'\u0009\u000a…'`.
 * Escapes and not the characters, so no invisible character sits in this
 * file, in a log line or in a diff.
 */
export const BLANKS_SQL = `E'${BLANK_CODE_POINTS.map((c) => `\\u${hex4(c)}`).join('')}'`;

/** The same blanks as a regular-expression bracket: `[\u0009…]`. */
const BLANK_CLASS_SQL = `[${BLANK_CODE_POINTS.map((c) => `\\u${hex4(c)}`).join('')}]`;

/** `[blanks]*;[blanks]*` as a SQL constant — the SQL twin of SEPARATOR. */
export const SEPARATOR_SQL = `E'${BLANK_CLASS_SQL}*;${BLANK_CLASS_SQL}*'`;

const ASCII_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** `btrim` with the blanks above — `btrim(x)` alone strips U+0020 only. */
export function trimSql(expr: string): string {
  return `btrim(${expr}, ${BLANKS_SQL})`;
}

/**
 * The SQL twin of `normaliseTag`: blanks off both ends, ASCII letters
 * folded, NULL stays NULL. `translate`, not `lower()`: `lower()` follows
 * the database's locale (see the note above).
 */
export function normalisedSql(expr: string): string {
  return `translate(${trimSql(expr)}, '${ASCII_UPPER}', '${ASCII_UPPER.toLowerCase()}')`;
}

/**
 * The SQL twin of `tagParts`: the parts of a `;` list, none of them
 * empty. NULL for a NULL tag.
 *
 * `array_remove`: `no;` is [no, ''] before it and [no] after, which is
 * what `tagParts` and tag-mapping.ts's splitValues both read.
 */
export function tagPartsSql(expr: string): string {
  return `array_remove(regexp_split_to_array(${normalisedSql(expr)}, ${SEPARATOR_SQL}), '')`;
}

function safeColumn(column: string): string {
  // `fuel:lpg` is a staging column too (ogr2ogr keeps the colon, as it does
  // for `contact:phone`), so one `:` between two words is allowed — and
  // nothing else: the whole point of the check is that a quote cannot get in.
  if (!/^[a-z_]+(:[a-z_]+)?$/.test(column)) {
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
  const parts = tagPartsSql(col);
  return `CASE
              WHEN nullif(${trimSql(col)}, '') IS NULL THEN '${UNKNOWN}'
              WHEN ${parts} && ${sqlWords(vocabulary.yes)} THEN 'yes'
              WHEN cardinality(${parts}) > 0
               AND ${parts} <@ ${sqlWords(vocabulary.no)} THEN 'no'
              ELSE '${UNKNOWN}'
            END`;
}

/** The SQL for one value-carrying column. */
export function verbatimSql(column: string, alias = 's'): string {
  const col = `${alias}."${safeColumn(column)}"`;
  return `coalesce(nullif(${normalisedSql(col)}, ''), '${UNKNOWN}')`;
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

/**
 * CAMP-258: `<tri-state of fuel:lpg> AS lpg`. The staging column is read
 * under its OSM key (`s."fuel:lpg"`) and written under the table's name.
 */
export function lpgSelectSql(alias = 's'): string {
  return `${triStateSql(LPG.tag, LPG.vocabulary, alias)} AS ${LPG.column}`;
}

/**
 * 🔴 CAMP-258: THE ONE FAILURE OF `lpg` THAT CANNOT BE SEEN FROM A TABLE.
 *
 * If `fuel:lpg` never reaches the staging table — the export dropped it, the
 * INSERT reads another name — every fuel station says `unknown`, and
 * `unknown` is a legitimate answer for 82% of them, so nothing looks wrong.
 * The tell is a fuel population in which NOTHING says `yes`: in the 27
 * extracts 18 081 of 118 726 fuel objects do. The loader asks this inside
 * its transaction and rolls back on an answer.
 *
 * 🔴 THE FLOOR, AND WHAT IT RESTS ON — IN ROWS, NOT OBJECTS. A scratch load
 * of one small country can truthfully hold no LPG station, so the guard does
 * not speak below 1 000 fuel ROWS. The unit matters: the older kinds are not
 * folded, so a closed-way fuel station is two rows, and the table holds 154 183
 * `fuel` rows for about 116 600 objects. Measured 15.10.2026 on camptribe_dev
 * after the full load, per country: Malta 100 rows, Luxembourg 280, Cyprus 458,
 * Estonia 890 and Latvia 925 are BELOW the floor — for those, a single-country
 * load is not guarded at all, and that is a limit of this check, not a finding
 * about them. From Slovenia (1 110 rows, 186 of them `yes`) up, every country
 * has at least 5 `yes` rows (Ireland and Denmark, the thinnest, have exactly
 * 5 of 2 308 and 2 515), so a population past the floor with none is not a
 * finding about Europe. The full 27-country load is the case this is for.
 */
export const LPG_GUARD_MIN_FUEL_ROWS = 1000;

/** One line of LPG_SUMMARY_SQL's answer: Postgres hands counts back as text. */
export interface LpgSummaryRow {
  state: string;
  rows: string;
  objects: string;
}

/**
 * The failure message when `fuel:lpg` did not arrive, or null. Takes what
 * LPG_SUMMARY_SQL returned, so a spec can run the same SQL against a real
 * table and feed the same function.
 */
export function lpgArrivalError(
  summary: readonly LpgSummaryRow[],
): string | null {
  const fuelRows = summary.reduce((sum, r) => sum + Number(r.rows), 0);
  const yes = Number(summary.find((r) => r.state === 'yes')?.rows ?? 0);
  if (fuelRows < LPG_GUARD_MIN_FUEL_ROWS || yes > 0) return null;
  return (
    `${fuelRows} fuel rows and not one says lpg=yes — \`fuel:lpg\` did not ` +
    `reach the table (scripts/osm-pipeline/export-rpoi.json, or the INSERT ` +
    `reads another name). This is a failure, not "no LPG in Europe".`
  );
}
