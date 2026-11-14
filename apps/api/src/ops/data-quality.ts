// CAMP-522 — how good the data is, one line per MEASURE, each with the
// query that produced it and the denominator it is a share of.
//
//   node dist/ops/data-quality.js          # DATABASE_URL, prints markdown
//   node dist/ops/data-quality.js --sql    # prints a psql script instead
//
// Against production, read-only, before the build is deployed there:
//
//   node dist/ops/data-quality.js --sql \
//     | ssh camptribe "sudo -u postgres psql -At -d camptribe"
//
// 🔴 WHY THIS EXISTS. An outside analyst asked five questions on
// 12.11.2026 that we could not answer on the spot: how many of the
// 63 307 are campsites and not rows, how many are duplicates, how many
// are gone, how many cameras work. A first partner will ask the same
// five. `data-inventory.ts` (CAMP-508) says WHAT we hold, per entity;
// this says how far each of those can be trusted. The two do not share
// a line: a count of rows appears here only as somebody's denominator.
//
// 🔴 NO NUMBER IS WRITTEN IN THIS FILE. Every measure is a query that
// returns `n` and `of` FROM ONE SCAN — so a share cannot be printed
// against a denominator that was counted at another moment or under
// another predicate — and the text printed beside the number is the
// text that ran, because both are `Measure.sql`.
//
// 🔴 A THRESHOLD IS A DEFINITION, NOT A MEASUREMENT, and each one is
// named below with its reason. It is visible in the printed query, so a
// reader who disagrees with "14 days" can see that it is 14 days.
//
// 🔴 WHAT WE CANNOT MEASURE IS LISTED, NOT LEFT OUT (`NOT_MEASURED`).
// The card asks for "confirmed coordinates" and "closed places". No
// column records either. A dashboard that silently drops the two
// hardest questions reads as if they had been answered.

import 'dotenv/config';
import { Client } from 'pg';
import { RULES } from '../datatourisme/match';
import { isSecondarySql, notSecondarySql } from '../spots/links';
import { publishedCountrySql } from '../spots/unpublished-countries';

/** The nine things the card asks for, in its order, and one it implies. */
export const GROUPS = [
  ['unique', 'Unique objects, not rows'],
  ['coordinates', 'Coordinates somebody else confirms'],
  ['duplicates', 'Duplicates'],
  ['closed', 'Closed and inactive places'],
  ['current', 'Sources that are current'],
  ['dated', 'Records that carry the date of their last change'],
  ['contradictions', 'Contradictions between sources'],
  ['licences', 'Licences'],
  ['filled', 'Key attributes filled in'],
  ['cameras', 'Cameras that work'],
] as const;

export type Group = (typeof GROUPS)[number][0];

export type Measure = {
  /** Stable name, for a test or a script to pick the line by. */
  key: string;
  group: Group;
  /** What ONE counted thing in `n` is. */
  what: string;
  /** What ONE counted thing in `of` is — the population `n` is a share of. */
  of: string;
  /**
   * Returns rows of (`label`, `n`, `of`). `label` is NULL for a measure
   * with one line and names the line for a measure that is broken down
   * (by source, by licence, by attribute). Printed verbatim.
   */
  sql: string;
};

/**
 * A row's source has to have seen it this recently for the row to count
 * as current. The OpenStreetMap import runs weekly; two cycles, so that
 * one late run does not turn the whole table "stale" for a day.
 */
export const CURRENT_DAYS = 14;

/** A record nobody has edited in this long is old. A year: one season. */
export const OLD_DAYS = 365;

/** A camera whose newest frame is older than this is not "working". */
export const CAMERA_HOURS = 24;

/**
 * The matcher's own "one campsite's footprint" (datatourisme/match.ts),
 * imported — a second number here would be a second opinion about what
 * "the same place" means.
 */
const SAME_SPOT_METRES = RULES.sameSpotMetres;

/**
 * 🔴 DEGREES, AND ONLY TO LET THE SPATIAL INDEX IN. `location` is
 * geometry in EPSG:4326, so `ST_DWithin` on it measures degrees, and a
 * degree of longitude is 111 km at the equator and 34 km at 72°N, the
 * top of the EU. 150 m is therefore at most 150 / 34 000 = 0.0044°; the
 * prefilter is rounded UP from that, and the real test beside it is
 * `ST_DistanceSphere`, in metres. A tighter prefilter would silently
 * lose Finnish pairs.
 */
const PREFILTER_DEGREES = SAME_SPOT_METRES / 30000;

/** A row its source still has. */
const live = (a: string) => `${a}.missing_since IS NULL`;

/**
 * One campsite: a row its source still has, and not the hidden second
 * copy of a campsite another row is already carrying. The same predicate
 * every read query on the site uses (`notSecondarySql`), imported.
 */
const unique = (a: string) => `${live(a)} AND ${notSecondarySql(a)}`;

/** The first source of a row — the one that created it. */
const sourceId = (a: string) =>
  `coalesce(${a}.sources->0->>'id', 'no source recorded')`;

/**
 * When the SOURCE says the record last changed.
 *
 * 🔴 NOT `sources[].updatedAt` FOR OPENSTREETMAP. The OSM importer
 * writes the IMPORT timestamp there (osm/import-spots.ts, `$9`), so on
 * those rows it says "we fetched this last week" for a campsite nobody
 * has touched since 2012. The date of the edit is `osm_record_edited_at`
 * (CAMP-255), and it is NULL where the extract did not carry one.
 * DATAtourisme has no such column; its `updatedAt` IS the publisher's.
 */
const changedAt = (a: string) =>
  `CASE WHEN ${sourceId(a)} = 'osm' THEN ${a}.osm_record_edited_at ` +
  `ELSE (${a}.sources->0->>'updatedAt')::timestamptz END`;

/** A live link between two rows their sources both still have. */
const LIVE_PAIRS = `spot_links l
  JOIN camping_spots p ON p.id = l.primary_id
  JOIN camping_spots x ON x.id = l.secondary_id
 WHERE l.unlinked_at IS NULL AND ${live('p')} AND ${live('x')}
   AND ${sourceId('p')} <> ${sourceId('x')}`;

/** A website, wherever the importer put it: DATAtourisme in a column, OSM in `contact`. */
const website = (a: string) =>
  `coalesce(${a}.website, ${a}.contact->>'website')`;

/**
 * The host of a website with the scheme and a leading `www.` dropped, so
 * the same site written two ways is one domain. (No sample address here:
 * the attribution sweep reads every host in production code as a source.)
 */
const domain = (a: string) =>
  `substring(lower(${website(a)}) from '^(?:https?://)?(?:www\\.)?([^/:?#]+)')`;

/**
 * 🔴 THE LICENCE OF A SOURCE WE HAVE NOT READ IS NOT GUESSED. A source
 * id that is not in this table is printed as "no licence on file", with
 * its id and its rows — so a third importer shows up on the dashboard
 * as a question the day it lands, instead of being counted under
 * somebody else's licence or dropped from the total.
 */
export const LICENCES: Readonly<Record<string, string>> = {
  osm: 'Open Database License (ODbL) 1.0',
  datatourisme: 'Licence Ouverte 2.0 (Etalab)',
};

const licenceCase = (expr: string) =>
  `CASE ${expr} ` +
  Object.entries(LICENCES)
    .map(([id, name]) => `WHEN '${id}' THEN '${name} — ${id}' `)
    .join('') +
  `ELSE 'no licence on file — ' || coalesce(${expr}, 'no source recorded') END`;

/**
 * The attributes a reader chooses a campsite by.
 *
 * 🔴 "FILLED" IS ASKED OF THE CAMPSITE, NOT OF THE ROW. A campsite two
 * sources describe is one page that prints both rows (CAMP-144): for a
 * French campsite the stars and the description usually live in the
 * hidden DATAtourisme row. Asking the visible row alone would report
 * them empty on a page that shows them.
 *
 * `s` is the campsite's own row and `x` each row folded into it.
 */
export const ATTRIBUTES: readonly (readonly [string, (a: string) => string])[] =
  [
    ['name', (a) => `${a}.name IS NOT NULL`],
    ['region', (a) => `${a}.region IS NOT NULL`],
    ['website', (a) => `${website(a)} IS NOT NULL`],
    ['phone', (a) => `${a}.contact ? 'phone'`],
    ['email', (a) => `${a}.contact ? 'email'`],
    ['opening hours', (a) => `${a}.contact ? 'openingHours'`],
    ['description', (a) => `${a}.description IS NOT NULL`],
    ['stars', (a) => `${a}.stars IS NOT NULL`],
    // 🔴 "yes" or "no" — an answer. An OSM row stores every amenity as
    // "unknown", a full object that answers nothing (see detail-query.ts).
    [
      'any amenity answered',
      (a) =>
        `jsonb_path_exists(${a}.amenities, '$.* ? (@ == "yes" || @ == "no")')`,
    ],
    [
      'electricity answered',
      (a) => `${a}.amenities->>'electricity' IN ('yes', 'no')`,
    ],
    [
      'drinking water answered',
      (a) => `${a}.amenities->>'water' IN ('yes', 'no')`,
    ],
    ['toilets answered', (a) => `${a}.amenities->>'toilets' IN ('yes', 'no')`],
    ['showers answered', (a) => `${a}.amenities->>'shower' IN ('yes', 'no')`],
    ['overnight stay answered', (a) => `${a}.overnight_status <> 'unknown'`],
    // The outline is not here: it is `position_with_an_outline`, and one
    // fact under two definitions would be a contradiction of our own.
    [
      'a published tariff',
      (a) => `EXISTS (SELECT 1 FROM spot_tariffs t WHERE t.spot_id = ${a}.id)`,
    ],
  ];

const attributeSql = (): string => {
  const cols = ATTRIBUTES.map(
    ([, has], i) => `(${has('s')} OR coalesce(f.a${i}, false)) AS a${i}`,
  ).join(', ');
  const folded = ATTRIBUTES.map(
    ([, has], i) => `bool_or(${has('x')}) AS a${i}`,
  ).join(', ');
  const values = ATTRIBUTES.map(
    ([label], i) => `('${label}', site.a${i})`,
  ).join(', ');
  return `WITH site AS (
    SELECT ${cols}
      FROM camping_spots s
      LEFT JOIN LATERAL (
        SELECT ${folded}
          FROM spot_links l JOIN camping_spots x ON x.id = l.secondary_id
         WHERE l.primary_id = s.id AND l.unlinked_at IS NULL AND ${live('x')}
      ) f ON true
     WHERE ${unique('s')})
    SELECT v.label, count(*) FILTER (WHERE v.has) AS n, count(*) AS of
      FROM site CROSS JOIN LATERAL (VALUES ${values}) v(label, has)
     GROUP BY v.label ORDER BY v.label`;
};

const one = (s: string): string => s.replace(/\s+/g, ' ').trim();

const CAMPSITES =
  'campsites (rows the source still has, second copies folded in)';

export const MEASURES: readonly Measure[] = (
  [
    {
      key: 'unique_campsites',
      group: 'unique',
      what: CAMPSITES,
      of: 'rows in camping_spots, everything ever imported',
      sql: `SELECT NULL AS label, count(*) FILTER (WHERE ${unique('s')}) AS n,
                   count(*) AS of
              FROM camping_spots s`,
    },
    {
      // What the site's own count says (`/spots/summary`): a campsite
      // with no region has no URL, and one country is held and not shown.
      key: 'campsites_with_a_page',
      group: 'unique',
      what: 'campsites that have a page on the site: also a region, and a country we publish',
      of: 'rows in camping_spots, everything ever imported',
      sql: `SELECT NULL AS label,
                   count(*) FILTER (WHERE ${unique('s')} AND s.region IS NOT NULL
                                      AND ${publishedCountrySql('s')}) AS n,
                   count(*) AS of
              FROM camping_spots s`,
    },
    {
      // 🔴 "CONFIRMED" HERE MEANS ONE THING ONLY: a second, independent
      // publisher put the same campsite in the same place, and the
      // matcher joined the two rows. It does not mean anybody went.
      key: 'position_given_by_two_sources',
      group: 'coordinates',
      what: 'campsites two independent sources place at the same spot',
      of: CAMPSITES,
      sql: `SELECT NULL AS label,
                   count(*) FILTER (WHERE EXISTS (
                     SELECT 1 FROM spot_links l JOIN camping_spots x ON x.id = l.secondary_id
                      WHERE l.primary_id = s.id AND l.unlinked_at IS NULL AND ${live('x')}
                        AND ${sourceId('x')} <> ${sourceId('s')})) AS n,
                   count(*) AS of
              FROM camping_spots s WHERE ${unique('s')}`,
    },
    {
      key: 'position_with_an_outline',
      group: 'coordinates',
      what: 'campsites whose ground is drawn as an outline in OpenStreetMap, not only a point',
      of: CAMPSITES,
      sql: `SELECT NULL AS label, count(*) FILTER (WHERE s.outline IS NOT NULL) AS n,
                   count(*) AS of
              FROM camping_spots s WHERE ${unique('s')}`,
    },
    {
      key: 'duplicate_rows_folded',
      group: 'duplicates',
      what: 'rows recognised as a second copy of a campsite and folded into its page',
      of: 'rows the source still has',
      sql: `SELECT NULL AS label, count(*) FILTER (WHERE ${isSecondarySql('s')}) AS n,
                   count(*) AS of
              FROM camping_spots s WHERE ${live('s')}`,
    },
    {
      // 🔴 SUSPECTED, NOT PROVEN, AND NARROW ON PURPOSE. The same name
      // (case aside) within one campsite's footprint, both on the site
      // as separate pages. "Camping municipal" twice in one village is
      // in here and may be two campsites; a duplicate under two
      // spellings is not in here at all. It is a floor a person can
      // work through, not the number of duplicates.
      key: 'duplicate_suspects_still_separate',
      group: 'duplicates',
      what: `campsites shown as their own page with another of the same name within ${SAME_SPOT_METRES} m`,
      of: CAMPSITES,
      sql: `SELECT NULL AS label,
                   count(*) FILTER (WHERE EXISTS (
                     SELECT 1 FROM camping_spots b
                      WHERE b.id <> s.id AND ${unique('b')}
                        AND lower(b.name) = lower(s.name)
                        AND ST_DWithin(b.location, s.location, ${PREFILTER_DEGREES})
                        AND ST_DistanceSphere(b.location, s.location) <= ${SAME_SPOT_METRES})) AS n,
                   count(*) AS of
              FROM camping_spots s WHERE ${unique('s')}`,
    },
    {
      // The only closure signal we hold: the weekly import no longer
      // finds the object and stamps `missing_since`. See NOT_MEASURED.
      key: 'rows_gone_from_their_source',
      group: 'closed',
      what: 'rows the source no longer has (deleted or retagged there); none of them is shown',
      of: 'rows in camping_spots, everything ever imported',
      sql: `SELECT NULL AS label, count(*) FILTER (WHERE s.missing_since IS NOT NULL) AS n,
                   count(*) AS of
              FROM camping_spots s`,
    },
    {
      key: 'rows_seen_by_their_source_lately',
      group: 'current',
      what: `rows whose source confirmed them in the last ${CURRENT_DAYS} days (last_seen_at)`,
      of: 'rows the source still has, per source',
      sql: `SELECT ${sourceId('s')} AS label,
                   count(*) FILTER (WHERE s.last_seen_at >= now() - interval '${CURRENT_DAYS} days') AS n,
                   count(*) AS of
              FROM camping_spots s WHERE ${live('s')}
             GROUP BY 1 ORDER BY 1`,
    },
    {
      key: 'tariffs_past_their_validity',
      group: 'current',
      what: 'campsite tariffs whose stated validity has ended',
      of: 'campsite tariffs that state an end of validity',
      sql: `SELECT NULL AS label, count(*) FILTER (WHERE t.valid_until < current_date) AS n,
                   count(*) AS of
              FROM spot_tariffs t WHERE t.valid_until IS NOT NULL`,
    },
    {
      key: 'rows_with_a_date_of_last_change',
      group: 'dated',
      what: 'rows for which the source states when the record last changed',
      of: 'rows the source still has, per source',
      sql: `SELECT ${sourceId('s')} AS label,
                   count(*) FILTER (WHERE ${changedAt('s')} IS NOT NULL) AS n,
                   count(*) AS of
              FROM camping_spots s WHERE ${live('s')}
             GROUP BY 1 ORDER BY 1`,
    },
    {
      key: 'rows_changed_within_a_year',
      group: 'dated',
      what: `rows the source changed in the last ${OLD_DAYS} days`,
      of: 'rows the source still has and dates, per source',
      sql: `SELECT ${sourceId('s')} AS label,
                   count(*) FILTER (WHERE ${changedAt('s')} >= now() - interval '${OLD_DAYS} days') AS n,
                   count(*) AS of
              FROM camping_spots s WHERE ${live('s')} AND ${changedAt('s')} IS NOT NULL
             GROUP BY 1 ORDER BY 1`,
    },
    {
      key: 'pairs_further_apart_than_one_site',
      group: 'contradictions',
      what: `joined pairs whose two sources place the campsite more than ${SAME_SPOT_METRES} m apart`,
      of: 'pairs of rows from two sources joined as one campsite',
      sql: `SELECT NULL AS label, count(*) FILTER (WHERE l.metres > ${SAME_SPOT_METRES}) AS n,
                   count(*) AS of
              FROM ${LIVE_PAIRS}`,
    },
    {
      key: 'pairs_naming_different_websites',
      group: 'contradictions',
      what: 'joined pairs whose two sources name different website domains',
      of: 'joined pairs in which both sources name a website',
      sql: `SELECT NULL AS label, count(*) FILTER (WHERE ${domain('p')} <> ${domain('x')}) AS n,
                   count(*) AS of
              FROM ${LIVE_PAIRS}
               AND ${website('p')} IS NOT NULL AND ${website('x')} IS NOT NULL`,
    },
    {
      key: 'pairs_giving_different_stars',
      group: 'contradictions',
      what: 'joined pairs whose two sources give different star ratings',
      of: 'joined pairs in which both sources give a star rating',
      sql: `SELECT NULL AS label, count(*) FILTER (WHERE p.stars <> x.stars) AS n,
                   count(*) AS of
              FROM ${LIVE_PAIRS}
               AND p.stars IS NOT NULL AND x.stars IS NOT NULL`,
    },
    {
      // 🔴 LEFT JOIN: a row with an empty `sources` array is counted,
      // under "no source recorded", not dropped by the unnest.
      key: 'rows_by_licence',
      group: 'licences',
      what: 'rows carrying facts under this licence',
      of: 'rows in camping_spots, everything ever imported',
      sql: `SELECT ${licenceCase(`e.src->>'id'`)} AS label, count(*) AS n,
                   (SELECT count(*) FROM camping_spots) AS of
              FROM camping_spots s
              LEFT JOIN LATERAL jsonb_array_elements(s.sources) e(src) ON true
             GROUP BY 1 ORDER BY 1`,
    },
    {
      key: 'campsites_with_the_attribute',
      group: 'filled',
      what: 'campsites for which we hold this attribute, from any source of theirs',
      of: CAMPSITES,
      sql: attributeSql(),
    },
    {
      // 🔴 "WORKS" IS THE AGE OF THE NEWEST FRAME, as the provider
      // reports it — not that the row exists. We do not open the image.
      key: 'cameras_with_a_recent_frame',
      group: 'cameras',
      what: `webcams whose newest frame is under ${CAMERA_HOURS} hours old`,
      of: 'webcams we hold',
      sql: `SELECT NULL AS label,
                   count(*) FILTER (WHERE w.last_frame_at >= now() - interval '${CAMERA_HOURS} hours') AS n,
                   count(*) AS of
              FROM webcams w`,
    },
  ] satisfies Measure[]
).map((m) => ({ ...m, sql: one(m.sql) }));

/**
 * What the card asks for and no column answers. Printed on the
 * dashboard under its group, in the place the number would have been.
 */
export const NOT_MEASURED: readonly {
  key: string;
  group: Group;
  what: string;
  why: string;
}[] = [
  {
    key: 'position_checked_on_the_ground',
    group: 'coordinates',
    what: 'campsites whose position somebody checked on the ground',
    why: 'Not measured: no table records a visit or a check of a position. The two measures above are agreement between publishers, not verification.',
  },
  {
    key: 'closed_while_still_in_the_source',
    group: 'closed',
    what: 'campsites that have closed while their source still lists them',
    why: 'Not measured: we hold no closure flag of our own. A closed campsite leaves the site only when its source deletes it.',
  },
];

export type Line = {
  key: string;
  group: Group;
  /** NULL for a measure with a single line. */
  label: string | null;
  what: string;
  ofWhat: string;
  n: number;
  of: number;
  sql: string;
};

export type Failure = {
  key: string;
  group: Group;
  what: string;
  sql: string;
  /** The database's own words. */
  error: string;
};

export type Report = {
  measuredAt: string;
  database: string;
  /** The card's headings, in its order: `[group, title]`. */
  groups: typeof GROUPS;
  lines: Line[];
  failures: Failure[];
  notMeasured: typeof NOT_MEASURED;
};

type Queryable = { query: (sql: string) => Promise<{ rows: unknown[] }> };

/** A count as postgres hands it over (bigint arrives as a string). */
function count(v: unknown): number {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new Error(`not a count: ${JSON.stringify(v)}`);
  }
  return n;
}

/**
 * Run every measure on one connection the caller owns.
 *
 * 🔴 ONE SNAPSHOT. `REPEATABLE READ` so every line is the table at the
 * same instant: an import landing between two measures would otherwise
 * print a numerator from before it against a population from after.
 * `READ ONLY` because this is pointed at production.
 *
 * 🔴 ONE BROKEN MEASURE COSTS ONE MEASURE. Each runs under its own
 * SAVEPOINT; a query that fails or times out is reported by name in
 * `failures`, with the database's message, and the rest still print.
 * It is never turned into a zero.
 */
export async function measure(
  db: Queryable,
  measures: readonly Measure[] = MEASURES,
  timeoutMs = 20_000,
): Promise<Report> {
  const lines: Line[] = [];
  const failures: Failure[] = [];
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await db.query(`SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`);
    const stamp = (
      await db.query(
        `SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at,
                current_database() AS db`,
      )
    ).rows[0] as { at: string; db: string };
    for (const m of measures) {
      await db.query('SAVEPOINT m');
      try {
        const rows = (await db.query(m.sql)).rows as Record<string, unknown>[];
        // Parse the whole measure before keeping any of it: half a
        // breakdown reads as a complete one.
        const parsed = rows.map((r) => ({
          key: m.key,
          group: m.group,
          label:
            r.label === null || r.label === undefined ? null : String(r.label),
          what: m.what,
          ofWhat: m.of,
          n: count(r.n),
          of: count(r.of),
          sql: m.sql,
        }));
        // 🔴 NO ROWS IS AN EMPTY POPULATION, NOT A FAILURE AND NOT A GAP.
        // An aggregate without GROUP BY always answers one row; only a
        // breakdown can answer none, and it does so exactly when there
        // is nothing to break down (no campsite carries a date at all,
        // say). That is "0 of 0" — printed, so the measure does not
        // vanish from the page, and never turned into a share.
        if (parsed.length === 0) {
          parsed.push({
            key: m.key,
            group: m.group,
            label: null,
            what: m.what,
            ofWhat: m.of,
            n: 0,
            of: 0,
            sql: m.sql,
          });
        }
        lines.push(...parsed);
        await db.query('RELEASE SAVEPOINT m');
      } catch (e) {
        await db.query('ROLLBACK TO SAVEPOINT m');
        failures.push({
          key: m.key,
          group: m.group,
          what: m.what,
          sql: m.sql,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return {
      measuredAt: stamp.at,
      database: stamp.db,
      groups: GROUPS,
      lines,
      failures,
      notMeasured: NOT_MEASURED,
    };
  } finally {
    await db.query('ROLLBACK');
  }
}

const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/**
 * The same measures as a psql script, for a database this build is not
 * deployed on yet. Read-only, one snapshot, a timeout per statement.
 * Prints `key | label | n | of`.
 */
export function qualitySql(
  measures: readonly Measure[] = MEASURES,
  timeoutMs = 20_000,
): string {
  return [
    // psql's own savepoint per statement: one failing measure prints its
    // error and the rest still run, as in \`measure()\`.
    '\\set ON_ERROR_ROLLBACK on',
    'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;',
    `SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)};`,
    `SELECT format('measured %s UTC on database %s', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'), current_database());`,
    ...measures.map(
      (m) =>
        `SELECT ${lit(m.key)}, coalesce(q.label, ''), q.n, q.of FROM (${m.sql}) q;`,
    ),
    'ROLLBACK;',
  ].join('\n');
}

/** `n` of `of` as a percentage, or NULL when there is nothing to divide by. */
export function share(n: number, of: number): string | null {
  return of > 0 ? `${((100 * n) / of).toFixed(1)}%` : null;
}

async function main(): Promise<void> {
  if (process.argv.includes('--sql')) {
    console.log(qualitySql());
    return;
  }
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev',
  });
  await client.connect();
  try {
    const r = await measure(client);
    console.log(`measured ${r.measuredAt} on database ${r.database}`);
    for (const l of r.lines) {
      console.log(
        `| ${l.key} | ${l.label ?? ''} | ${l.n} | ${l.of} | ${share(l.n, l.of) ?? 'nothing to divide by'} | \`${l.sql}\` |`,
      );
    }
    for (const f of r.failures) {
      console.log(`| ${f.key} | NOT MEASURED: ${f.error} | \`${f.sql}\` |`);
    }
    for (const x of r.notMeasured) console.log(`| ${x.key} | ${x.why} |`);
    if (r.failures.length > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
