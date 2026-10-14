import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { RoutePoi1790572800000 } from '../migrations/1790572800000-RoutePoi';
import { RoutePoiFacilities1791400000000 } from '../migrations/1791400000000-RoutePoiFacilities';
import { ACCESS_EXCLUDED, isAccessExcluded } from './route-poi';
import { ensureStagingColumns, exportedTags } from './route-poi-export';
import {
  resolveTriState,
  resolveVerbatim,
  TRISTATE_FACILITIES,
} from './route-poi-facilities';
import { buildRoutePoiInsertSql, EU_SQL_LIST } from './route-poi-sql';

// CAMP-119 — the import statement, run against a REAL PostgreSQL.
//
// 🔴 WHY A DATABASE, WHEN EVERY OTHER SPEC IN THIS DIRECTORY ASSERTS THE
// SHAPE OF A STRING. The house has a name for what a string test cannot
// do: "asserting the shape is not asserting the value". That an absent
// `toilets` tag comes out as 'unknown' and not 'no' is a statement about
// what PostgreSQL returns, and `expect(sql).toContain("THEN 'unknown'")`
// is satisfied by a CASE whose branches are in the wrong order.
//
// This runs the exact text `load-route-poi.ts` runs (buildRoutePoiInsertSql
// is imported, not copied) over rows staged the way ogr2ogr stages them,
// and reads the answer back.
//
// 🔴 IT TOUCHES NOTHING THAT IS NOT ITS OWN. Everything happens in a
// schema created for this process and dropped afterwards; the connection's
// search_path puts that schema first, so `osm_route_poi` here is the
// spec's table and never the real one, whichever database the URL names.
// PostGIS is the only thing taken from `public`.
//
// The database is CI_DATABASE_URL, else DATABASE_URL, else local dev —
// and an unreachable one is a FAILING spec, not a skipped one: a skip
// reads as "passed" in a summary, which is the failure this guards.

jest.setTimeout(120_000);

const URL =
  process.env.CI_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://localhost:5432/camptribe_dev';

const SCHEMA = `camp119_spec_${process.pid}`;

type Tags = Record<string, string>;

interface Fixture {
  id: string;
  /** WKT in EPSG:4326, promoted to MULTI the way ogr2ogr does it. */
  wkt: string;
  tags: Tags;
}

// A box over Slovenia: every fixture below sits inside it, and
// `ne_admin1` (below) says so.
const RING =
  'LINESTRING(14.0 46.0, 14.1 46.0, 14.1 46.1, 14.0 46.1, 14.0 46.0)';
const POLYGON =
  'POLYGON((14.0 46.0, 14.1 46.0, 14.1 46.1, 14.0 46.1, 14.0 46.0))';
// A C-shape whose centroid is OUTSIDE it, so "which twin won" is visible
// in where the stored point is.
const C_RING =
  'LINESTRING(15.0 46.0, 15.3 46.0, 15.3 46.3, 15.0 46.3, 15.0 46.25, 15.25 46.25, 15.25 46.05, 15.0 46.05, 15.0 46.0)';
const C_POLYGON =
  'POLYGON((15.0 46.0, 15.3 46.0, 15.3 46.3, 15.0 46.3, 15.0 46.25, 15.25 46.25, 15.25 46.05, 15.0 46.05, 15.0 46.0))';

let n = 0;
const pt = (id: string, tags: Tags): Fixture => {
  // Spread the points out so no two share a location: a fixture should
  // never be able to pass by colliding with another.
  n += 1;
  return {
    id,
    wkt: `POINT(${13.5 + (n % 30) * 0.1} ${45.5 + Math.floor(n / 30) * 0.1})`,
    tags,
  };
};

const REST = { highway: 'rest_area' };

/**
 * One row per case, with the answer written out BY HAND. The expectations
 * are not computed from `resolveTriState` — that would make the test a
 * restatement of the code it checks.
 */
const CASES: {
  fixture: Fixture;
  expectKind: string;
  expect: Record<string, string>;
}[] = [
  {
    // the card, row one: nothing written, so nothing is claimed
    fixture: pt('n2', { ...REST }),
    expectKind: 'rest_area',
    expect: {
      toilets: 'unknown',
      shower: 'unknown',
      drinking_water: 'unknown',
      sanitary_dump_station: 'unknown',
      fee: 'unknown',
      access: 'unknown',
      hgv: 'unknown',
      maxheight: 'unknown',
      maxlength: 'unknown',
    },
  },
  {
    fixture: pt('n1', {
      ...REST,
      toilets: 'yes',
      fee: 'no',
      drinking_water: 'yes',
      access: 'yes',
      hgv: 'designated',
      maxlength: '12',
    }),
    expectKind: 'rest_area',
    expect: {
      toilets: 'yes',
      fee: 'no',
      drinking_water: 'yes',
      shower: 'unknown',
      sanitary_dump_station: 'unknown',
      access: 'yes',
      hgv: 'designated',
      maxheight: 'unknown',
      maxlength: '12',
    },
  },
  {
    // a written "no" is a no — it is a statement, and it must survive
    fixture: pt('n3', { ...REST, toilets: 'no', shower: 'no' }),
    expectKind: 'rest_area',
    expect: { toilets: 'no', shower: 'no', fee: 'unknown' },
  },
  {
    // an empty or blank value is nobody having written anything
    fixture: pt('n4', { ...REST, toilets: '', shower: '   ' }),
    expectKind: 'rest_area',
    expect: { toilets: 'unknown', shower: 'unknown' },
  },
  {
    // a value nobody has met is NOT a no
    fixture: pt('n5', {
      ...REST,
      toilets: 'maybe',
      fee: 'donation',
      drinking_water: 'fixme',
    }),
    expectKind: 'rest_area',
    expect: { toilets: 'unknown', fee: 'unknown', drinking_water: 'unknown' },
  },
  {
    fixture: pt('n6', {
      ...REST,
      toilets: 'YES ',
      shower: 'yes;no',
      drinking_water: 'no;',
      fee: 'YES',
    }),
    expectKind: 'rest_area',
    expect: {
      toilets: 'yes',
      shower: 'yes',
      drinking_water: 'no',
      fee: 'yes',
    },
  },
  {
    // the campsite vocabulary for availability, the narrow one for fee
    fixture: pt('n7', {
      ...REST,
      toilets: 'designated',
      shower: 'private',
      fee: 'private',
      sanitary_dump_station: 'public',
      drinking_water: 'customers',
    }),
    expectKind: 'rest_area',
    expect: {
      toilets: 'yes',
      shower: 'no',
      fee: 'unknown',
      sanitary_dump_station: 'yes',
      drinking_water: 'yes',
    },
  },
  {
    fixture: pt('n9', { ...REST, access: 'Customers' }),
    expectKind: 'rest_area',
    expect: { access: 'customers' },
  },
  {
    fixture: pt('n14', { ...REST, maxheight: ' 3.5 ', hgv: 'Designated' }),
    expectKind: 'rest_area',
    expect: { maxheight: '3.5', hgv: 'designated', maxlength: 'unknown' },
  },
  {
    // 🔴 CAMP-119 review: a value that is ONLY a blank of some kind is
    // nobody having written anything, whichever blank it is. Before the
    // fix `maxheight='\t'` was stored as a column holding a lone TAB —
    // `btrim()` strips U+0020 and nothing else, and the CHECK beside it
    // is the same expression.
    fixture: pt('n18', {
      ...REST,
      maxheight: '\t',
      hgv: '\n',
      maxlength: '\u00a0',
      access: '\u2028',
      toilets: '\tyes',
      shower: 'yes\u00a0',
      fee: '\u2003no',
      drinking_water: '\ufeffyes\ufeff',
    }),
    expectKind: 'rest_area',
    expect: {
      maxheight: 'unknown',
      hgv: 'unknown',
      maxlength: 'unknown',
      access: 'unknown',
      toilets: 'yes',
      shower: 'yes',
      fee: 'no',
      drinking_water: 'yes',
    },
  },
  {
    fixture: pt('n10', { highway: 'services', toilets: 'yes', shower: 'yes' }),
    expectKind: 'service_area',
    expect: { toilets: 'yes', shower: 'yes', fee: 'unknown' },
  },
  {
    // legacy first: the fuel station it was before CAMP-119
    fixture: pt('n11', { highway: 'services', amenity: 'fuel' }),
    expectKind: 'fuel',
    expect: { toilets: 'unknown' },
  },
  {
    // the older kinds get the same columns, read the same way
    fixture: pt('n15', { amenity: 'fuel', toilets: 'yes' }),
    expectKind: 'fuel',
    expect: { toilets: 'yes' },
  },
  {
    // `dump` is the amenity; the KEY on it is a facility of that row
    fixture: pt('n12', { amenity: 'sanitary_dump_station', fee: 'yes' }),
    expectKind: 'dump',
    expect: { fee: 'yes', sanitary_dump_station: 'unknown' },
  },
];

/**
 * 🔴 THE ACCESS FILTER AND THE ACCESS COLUMN MUST READ ONE VALUE
 * (CAMP-119 review, the worst of the six).
 *
 * The filter compared the RAW tag to the excluded list while the column
 * was written as `lower(btrim(...))`, so `access='Private'` was published
 * with a column that read `private`. Hand-written: raw value → what the
 * column says, or null when no row may exist. The excluded words are
 * private / no / employees / permit; a `;` list is excluded when ANY part
 * is one (see ACCESS_EXCLUDED in route-poi.ts for why).
 */
const ACCESS_CASES: readonly (readonly [string, string | null])[] = [
  // the canonical spellings, which the old filter also caught
  ['private', null],
  ['no', null],
  ['employees', null],
  ['permit', null],
  // the same words, spelled the way strangers type them
  ['Private', null],
  ['PRIVATE', null],
  ['private ', null],
  [' No ', null],
  ['\tprivate', null],
  ['employees\n', null],
  ['\u00a0permit\u00a0', null],
  ['\u2028no\u2029', null],
  ['\ufeffprivate', null],
  // a list that names an excluded value — the five live rows' shapes
  ['private;customers', null],
  ['customers;private', null],
  ['delivery;private', null],
  ['no;yes', null],
  ['students;employees', null],
  ['Customers; Private ', null],
  ['customers\u00a0;\u00a0Permit', null],
  // what stays: nothing excluded in it
  ['customers', 'customers'],
  ['Customers', 'customers'],
  ['yes', 'yes'],
  ['permissive', 'permissive'],
  ['destination', 'destination'],
  ['delivery', 'delivery'],
  ['students', 'students'],
  ['customers;visitors;members', 'customers;visitors;members'],
  [' Customers ; Visitors ', 'customers ; visitors'],
  // a word that merely CONTAINS an excluded one is not that word
  ['privateer', 'privateer'],
  ['not_private', 'not_private'],
  ['no_entry', 'no_entry'],
  ['private road', 'private road'],
  // nothing was written: the column says so, and the place is kept
  ['', 'unknown'],
  ['   ', 'unknown'],
  ['\t', 'unknown'],
  [';', ';'],
  // characters that look like blanks and are not: no trimming, no match
  ['\u0085private', '\u0085private'],
  ['private\u200b', 'private\u200b'],
  ['\u180eno', '\u180eno'],
];

/** Rows that must produce NO row at all. */
const NOT_STORED: Fixture[] = [
  pt('n8', { ...REST, access: 'private' }),
  pt('n16', { highway: 'rest_area', access: 'no' }),
  pt('n13', { highway: 'bus_stop' }),
  pt('n17', { amenity: 'bench' }),
];

// 🔴 THE CLASS OF BLANKS, WRITTEN OUT BY HAND (CAMP-119 review).
//
// JavaScript's `trim()` strips 25 code points. PostgreSQL's `btrim(text)`
// strips ONE (U+0020), and `\s` in its regular expressions is whatever
// the database's locale says: on camptribe_dev U+FEFF is not a space to it
// and U+00A0 is, and under COLLATE "C" U+00A0 is not either. This spec
// used to feed both sides three kinds of blank and nothing else, so
// narrowing the JavaScript to a plain space left every test green.
//
// This list is NOT imported from the module that defines the set: a list
// read from the code it checks cannot disagree with it. The sweep of the
// whole BMP in route-poi-facilities.spec.ts is what ties this list to the
// engine; this one ties it to the database.
const BLANKS: readonly string[] = [
  '\u0009', // TAB
  '\u000a', // LF
  '\u000b', // VT
  '\u000c', // FF
  '\u000d', // CR
  '\u0020', // SPACE
  '\u00a0', // NBSP
  '\u1680', // OGHAM SPACE MARK
  '\u2000',
  '\u2001',
  '\u2002',
  '\u2003',
  '\u2004',
  '\u2005',
  '\u2006',
  '\u2007',
  '\u2008',
  '\u2009',
  '\u200a',
  '\u2028', // LINE SEPARATOR
  '\u2029', // PARAGRAPH SEPARATOR
  '\u202f', // NARROW NBSP
  '\u205f',
  '\u3000', // IDEOGRAPHIC SPACE
  '\ufeff', // BOM / ZERO WIDTH NO-BREAK SPACE
];

// …and the characters that LOOK like blanks and are not: JavaScript does
// not trim them, so neither may the database. Overreach is a defect too —
// it would make `yes` out of a value that says something else.
const NOT_BLANKS: readonly string[] = [
  '\u0085', // NEL — a space to some libc locales, not to JavaScript
  '\u180e', // MONGOLIAN VOWEL SEPARATOR — was Zs until Unicode 6.3
  '\u200b', // ZERO WIDTH SPACE
  '\u2060', // WORD JOINER
  '\u00ad', // SOFT HYPHEN
];

/** Every value a blank can frame: before, after, both, alone, around `;`. */
const framed = (word: string, other: string): string[] => [
  ...BLANKS.flatMap((b) => [
    `${b}${word}`,
    `${word}${b}`,
    `${b}${word}${b}`,
    `${other}${b};${b}${other}`,
    `${word}${b};${other}`,
    `${b}${b}${word}${b}${b}`,
  ]),
  ...BLANKS,
  ...NOT_BLANKS.flatMap((b) => [
    `${b}${word}`,
    `${word}${b}`,
    `${other}${b};${b}${other}`,
  ]),
];

/**
 * The same question asked of the SQL filter and of `isAccessExcluded` over
 * every spelling this spec can generate — each excluded word, in three
 * cases, framed by every blank, and as one part of a `;` list. The table
 * above is the hand-written half; this is the half that ties the SQL to the
 * JavaScript rule (and, through route-poi-facilities.spec.ts, to the
 * raw-extract counter that runs the same rule).
 */
const ACCESS_GENERATED: readonly string[] = Array.from(
  new Set(
    ACCESS_EXCLUDED.flatMap((word) => [
      word,
      word.toUpperCase(),
      `${word[0].toUpperCase()}${word.slice(1)}`,
      ...BLANKS.flatMap((b) => [
        `${b}${word}`,
        `${word}${b}`,
        `${b}${word}${b}`,
        `customers${b};${b}${word}`,
        `${word}${b};${b}customers`,
        `customers${b};${b}visitors`,
      ]),
      ...NOT_BLANKS.flatMap((b) => [`${b}${word}`, `${word}${b}`]),
    ]),
  ),
);

// Raw values for the two-implementations check. Chosen to include every
// shape that has gone wrong in OSM data: blanks, case, lists, trailing
// separators, and words that only mean something for a different tag.
const RAW_VALUES: string[] = Array.from(
  new Set([
    'yes',
    'no',
    'YES',
    'No',
    ' yes ',
    'true',
    'false',
    '1',
    '0',
    'designated',
    'limited',
    'customers',
    'public',
    'permissive',
    'private',
    'none',
    'maybe',
    'unknown',
    'fixme',
    'donation',
    'separate',
    'outside',
    'hot',
    '?',
    'yes;no',
    'no;yes',
    'no;no',
    'no;',
    ';no',
    ';',
    'yes ; no',
    'no;maybe',
    'conditional',
    'interval',
    'free',
    'paid',
    'grey_water',
    // the whole class of blanks around a word that means yes, one that
    // means no, and a `;` list — the CAMP-119 review's 18 disagreements
    ...framed('yes', 'no'),
    ...framed('no', 'yes'),
    // 🔴 case: PostgreSQL's lower() follows the database's locale
    // (lower('İ') is 'i' here and 'İ' under COLLATE "C"), JavaScript's
    // follows Unicode SpecialCasing ('i' + U+0307). Both sides now fold
    // ASCII only, so none of these can read as a word either side knows.
    'DESİGNATED',
    'YESİ',
    'NO\u0130',
    'İ',
    'ΑΣ',
    'ÉYES',
    'yes\u212a',
    'ſes',
  ]),
);

describe('the import statement, against a real PostgreSQL', () => {
  let db: Client;
  const insert = (runAt: string) =>
    db.query(buildRoutePoiInsertSql(), [runAt, ACCESS_EXCLUDED, EU_SQL_LIST]);
  const rowOf = async (ref: string) =>
    (await db.query('SELECT * FROM osm_route_poi WHERE osm_ref = $1', [ref]))
      .rows[0];

  const stage = async (f: Fixture) => {
    const cols = Object.keys(f.tags);
    const names = ['id', 'geom', ...cols.map((c) => `"${c}"`)].join(', ');
    const holders = [
      '$1',
      'ST_Multi(ST_GeomFromText($2, 4326))',
      ...cols.map((_, i) => `$${i + 3}`),
    ].join(', ');
    await db.query(
      `INSERT INTO osm_route_poi_staging (${names}) VALUES (${holders})`,
      [f.id, f.wkt, ...cols.map((c) => f.tags[c])],
    );
  };

  beforeAll(async () => {
    db = new Client({ connectionString: URL });
    await db.connect();
    await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
    await db.query(`CREATE SCHEMA ${SCHEMA}`);
    // The spec's schema FIRST. A table created or read below is this
    // spec's own, and the real `osm_route_poi` is never in reach.
    await db.query(`SET search_path = ${SCHEMA}, public`);

    // The real migrations, not a copy of what they make.
    const qr = {
      query: (sql: string) => db.query(sql),
    } as unknown as QueryRunner;
    await new RoutePoi1790572800000().up(qr);
    await new RoutePoiFacilities1791400000000().up(qr);

    await db.query(
      `CREATE TABLE ne_admin1 (geom geometry(MultiPolygon, 4326), iso_a2 text, admin text)`,
    );
    await db.query(
      `INSERT INTO ne_admin1
       VALUES (ST_Multi(ST_MakeEnvelope(13, 45, 17, 47, 4326)), 'SI', 'Slovenia')`,
    );

    // The staging table has a column for every tag the export carries —
    // taken from the file osmium is given, so a tag dropped from it is a
    // column missing here and the INSERT fails naming it.
    const tagColumns = exportedTags()
      .map((t) => `"${t}" text`)
      .join(', ');
    await db.query(
      `CREATE TABLE osm_route_poi_staging (id text, geom geometry, ${tagColumns})`,
    );

    for (const c of CASES) await stage(c.fixture);
    for (const f of NOT_STORED) await stage(f);

    // ── the closed-way twins (CAMP-253) ──
    // a ring (`w100`) and the polygon built from it (`a200` = way 100 × 2)
    await stage({ id: 'w100', wkt: RING, tags: { ...REST, toilets: 'yes' } });
    await stage({
      id: 'a200',
      wkt: POLYGON,
      tags: { ...REST, toilets: 'yes' },
    });
    // an area whose line never came: way 150, and relation 150
    await stage({ id: 'a300', wkt: POLYGON, tags: { ...REST } });
    await stage({ id: 'a301', wkt: POLYGON, tags: { ...REST } });
    // a C-shape: its centroid is outside it, so the stored point shows
    // which twin the point was taken from
    await stage({ id: 'w500', wkt: C_RING, tags: { highway: 'services' } });
    await stage({ id: 'a1000', wkt: C_POLYGON, tags: { highway: 'services' } });
    // a dump station is folded too: it is the number the card asks for
    await stage({
      id: 'w600',
      wkt: RING,
      tags: { amenity: 'sanitary_dump_station' },
    });
    await stage({
      id: 'a1200',
      wkt: POLYGON,
      tags: { amenity: 'sanitary_dump_station' },
    });
    // the OLDER kinds are left as they were written: both twins stay
    await stage({ id: 'w400', wkt: RING, tags: { amenity: 'fuel' } });
    await stage({ id: 'a800', wkt: POLYGON, tags: { amenity: 'fuel' } });

    // ── the two-implementations check: one row per raw value ──
    let i = 0;
    for (const raw of RAW_VALUES) {
      i += 1;
      for (const column of ['toilets', 'fee']) {
        await stage({
          id: `n9${column === 'fee' ? 2 : 1}${String(i).padStart(3, '0')}`,
          wkt: `POINT(${16 + (i % 20) * 0.05} ${46.4 + (column === 'fee' ? 0.3 : 0)})`,
          tags: { ...REST, [column]: raw },
        });
      }
    }

    // ── the verbatim differential: one row per raw value, `maxheight` ──
    // (no filter stands in front of this column, so every row is stored)
    i = 0;
    for (const raw of RAW_VALUES) {
      i += 1;
      await stage({
        id: `n93${String(i).padStart(3, '0')}`,
        wkt: `POINT(${16 + (i % 20) * 0.05} 46.8)`,
        tags: { ...REST, maxheight: raw },
      });
    }

    // ── the access filter: one rest area per hand-written case ──
    i = 0;
    for (const [raw] of ACCESS_CASES) {
      i += 1;
      await stage({
        id: `n95${String(i).padStart(3, '0')}`,
        wkt: `POINT(${13.2 + (i % 30) * 0.1} 46.9)`,
        tags: { ...REST, access: raw },
      });
    }

    // ── the access filter, generated: one rest area per spelling ──
    i = 0;
    for (const raw of ACCESS_GENERATED) {
      i += 1;
      await stage({
        id: `n96${String(i).padStart(4, '0')}`,
        wkt: `POINT(${13.2 + (i % 35) * 0.1} 46.95)`,
        tags: { ...REST, access: raw },
      });
    }

    await insert(new Date().toISOString());
  });

  afterAll(async () => {
    if (!db) return;
    await db.query('RESET search_path');
    await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await db.end();
  });

  describe('a tag nobody wrote', () => {
    // 🔴 MUTATION: make an absent tag 'no' — the first branch of
    // triStateSql, or its ELSE. This is the card.
    it('is unknown, in every column, and never no', async () => {
      const row = await rowOf('n2');
      for (const column of [
        'toilets',
        'shower',
        'drinking_water',
        'sanitary_dump_station',
        'fee',
        'access',
        'hgv',
        'maxheight',
        'maxlength',
      ]) {
        expect(`${column}=${row[column]}`).toBe(`${column}=unknown`);
      }
    });

    it.each(CASES.map((c) => [c.fixture.id, c] as const))(
      'row %s says exactly what its tags say',
      async (_id, c) => {
        const row = await rowOf(c.fixture.id);
        expect(row).toBeDefined();
        expect(row.kind).toBe(c.expectKind);
        for (const [column, want] of Object.entries(c.expect)) {
          expect(`${column}=${row[column]}`).toBe(`${column}=${want}`);
        }
      },
    );

    it('is never NULL and never an empty string anywhere in the table', async () => {
      const bad = await db.query(
        `SELECT osm_ref FROM osm_route_poi
          WHERE toilets IS NULL OR shower IS NULL OR drinking_water IS NULL
             OR sanitary_dump_station IS NULL OR fee IS NULL
             OR access IS NULL OR hgv IS NULL OR maxheight IS NULL
             OR maxlength IS NULL
             OR btrim(access) = '' OR btrim(hgv) = ''
             OR btrim(maxheight) = '' OR btrim(maxlength) = ''`,
      );
      expect(bad.rows).toEqual([]);
    });
  });

  describe('which objects become rows', () => {
    // 🔴 MUTATION: drop the access filter, or apply it to the legacy kinds
    // only. A rest area behind a barrier is not somewhere a stranger stops.
    it('leaves out a private or no-access rest area, and what is not ours', async () => {
      for (const f of NOT_STORED) expect(await rowOf(f.id)).toBeUndefined();
    });
  });

  describe('a closed way arrives twice', () => {
    // 🔴 MUTATION: DISTINCT ON (s.id) instead of the canonical ref. Both
    // twins become rows and every closed-way rest area is counted twice.
    it('is one row for a stopping place, keyed on the way itself', async () => {
      const twins = await db.query(
        `SELECT osm_ref FROM osm_route_poi WHERE osm_ref IN ('w100', 'a200')`,
      );
      expect(twins.rows.map((r) => r.osm_ref)).toEqual(['w100']);
    });

    // 🔴 MUTATION: `a` → `w` by swapping the letter. a300 is way 150, not
    // way 300; a301 is RELATION 150.
    it('maps an area id back to its way or relation, and not by the letter', async () => {
      expect(await rowOf('w150')).toBeDefined();
      expect(await rowOf('r150')).toBeDefined();
      expect(await rowOf('w300')).toBeUndefined();
      expect(await rowOf('a300')).toBeUndefined();
      expect(await rowOf('a301')).toBeUndefined();
    });

    // 🔴 MUTATION: drop `(s.id LIKE 'a%') DESC` from the ORDER BY. The line
    // wins ties, and its point sits on the ring — not inside the shape.
    it('takes the point from the polygon, so it lies INSIDE the shape', async () => {
      const r = await db.query(
        `SELECT ST_Intersects(location, ST_GeomFromText($1, 4326)) AS inside,
                ST_Intersects(location, ST_Boundary(ST_GeomFromText($1, 4326))) AS on_ring
           FROM osm_route_poi WHERE osm_ref = 'w500'`,
        [C_POLYGON],
      );
      expect(r.rows).toEqual([{ inside: true, on_ring: false }]);
    });

    // 🔴 MUTATION: take `dump` out of CANONICAL_REF_KINDS. Its count would
    // go back to counting every closed-way dump station twice — the very
    // number this card was asked to make reproducible.
    it('folds a dump station too, so its count is a count of objects', async () => {
      const twins = await db.query(
        `SELECT osm_ref, kind FROM osm_route_poi WHERE osm_ref IN ('w600', 'a1200')`,
      );
      expect(twins.rows).toEqual([{ osm_ref: 'w600', kind: 'dump' }]);
    });

    // 🔴 MUTATION: fold the older kinds as well. That re-keys 37 576 fuel
    // points whose prices are joined on `osm_ref`, with no foreign key to
    // say so — a decision with a cost, and not this card's.
    it('leaves the older kinds exactly as osmium wrote them', async () => {
      const twins = await db.query(
        `SELECT osm_ref FROM osm_route_poi WHERE osm_ref IN ('w400', 'a800') ORDER BY 1`,
      );
      expect(twins.rows.map((r) => r.osm_ref)).toEqual(['a800', 'w400']);
    });
  });

  describe('the SQL and the JavaScript twin agree', () => {
    // 🔴 Two implementations of one rule, made to disagree out loud. The
    // expectations in CASES above are written by hand; these are the
    // other half — every awkward value that has appeared in OSM, through
    // BOTH, for the availability vocabulary and the narrower fee one.
    it.each(['toilets', 'fee'])(
      'give the same answer for every raw value in %s',
      async (column) => {
        const vocabulary = TRISTATE_FACILITIES.find(
          (f) => f.column === column,
        )!.vocabulary;
        const rows = await db.query(
          `SELECT ${column} AS state FROM osm_route_poi WHERE osm_ref LIKE $1 ORDER BY osm_ref`,
          [`n9${column === 'fee' ? 2 : 1}%`],
        );
        expect(rows.rows).toHaveLength(RAW_VALUES.length);
        const disagreements = rows.rows
          .map((r, i) => ({
            raw: RAW_VALUES[i],
            sql: r.state as string,
            js: resolveTriState(RAW_VALUES[i], vocabulary) as string,
          }))
          .filter((d) => d.sql !== d.js);
        expect(disagreements).toEqual([]);
      },
    );
  });

  describe('the verbatim columns and the JavaScript twin agree', () => {
    // 🔴 Nobody compared `verbatimSql` with `resolveVerbatim` at all — the
    // differential above covered the two yes/no/unknown columns only.
    it('give the same answer for every raw value in maxheight', async () => {
      const rows = await db.query(
        `SELECT maxheight AS stored FROM osm_route_poi WHERE osm_ref LIKE 'n93%' ORDER BY osm_ref`,
      );
      expect(rows.rows).toHaveLength(RAW_VALUES.length);
      const disagreements = rows.rows
        .map((r, k) => ({
          raw: RAW_VALUES[k],
          sql: r.stored as string,
          js: resolveVerbatim(RAW_VALUES[k]),
        }))
        .filter((d) => d.sql !== d.js);
      expect(disagreements).toEqual([]);
    });
  });

  describe('the access filter reads what the access column stores', () => {
    // 🔴 MUTATION: compare the RAW value to the excluded list again
    // (`s.access <> ALL ($2)`) — the old filter. `Private` is published
    // and its own column says `private`.
    it.each(ACCESS_CASES.map((c, k) => [c[0], c[1], k + 1] as const))(
      'access %j is stored as %j',
      async (_raw, stored, k) => {
        const row = await rowOf(`n95${String(k).padStart(3, '0')}`);
        if (stored === null) {
          expect(row).toBeUndefined();
        } else {
          expect(row).toBeDefined();
          expect(row.access).toBe(stored);
        }
      },
    );

    // 🔴 MUTATION: read a list as excluded only when every part is, or stop
    // trimming at the first blank that is not U+0020 — either way the SQL
    // and `isAccessExcluded` part ways on some spelling below.
    it('keeps out exactly the rows isAccessExcluded says to keep out', async () => {
      const rows = await db.query(
        `SELECT osm_ref, access FROM osm_route_poi WHERE osm_ref LIKE 'n96%'`,
      );
      const stored = new Map<string, string>(
        rows.rows.map((r) => [r.osm_ref as string, r.access as string]),
      );
      const wrong: string[] = [];
      let kept = 0;
      ACCESS_GENERATED.forEach((raw, k) => {
        const ref = `n96${String(k + 1).padStart(4, '0')}`;
        const excluded = isAccessExcluded(raw);
        if (stored.has(ref) === excluded) wrong.push(`${JSON.stringify(raw)}`);
        else if (stored.has(ref)) {
          kept += 1;
          if (stored.get(ref) !== resolveVerbatim(raw))
            wrong.push(`${JSON.stringify(raw)} stored as ${stored.get(ref)}`);
        }
      });
      expect(wrong).toEqual([]);
      // both outcomes occur, so agreement is not agreement on "everything"
      expect(kept).toBeGreaterThan(50);
      expect(ACCESS_GENERATED.length - kept).toBeGreaterThan(100);
    });

    // The invariant the table above is an instance of, asked of EVERY row
    // in the table: nothing stored says an excluded word as a part of its
    // own access column. Whatever the staging held, this is what the filter
    // and the column must never disagree on.
    it('stores no row whose access column names an excluded value', async () => {
      const blank = `[${BLANKS.join('')}]*`;
      const bad = await db.query(
        `SELECT osm_ref, access FROM osm_route_poi
          WHERE regexp_split_to_array(access, $2) && $1::text[]`,
        [ACCESS_EXCLUDED, `${blank};${blank}`],
      );
      expect(bad.rows).toEqual([]);
    });
  });

  describe('a second run', () => {
    // 🔴 MUTATION: leave the facility columns out of ON CONFLICT … DO
    // UPDATE. The first import would be right and every later one would
    // keep what it first wrote — a toilet OSM removed would stay.
    it('rewrites the facility columns, so a tag removed upstream becomes unknown', async () => {
      const before = (
        await db.query('SELECT count(*)::int AS n FROM osm_route_poi')
      ).rows[0].n;
      expect((await rowOf('n1')).toilets).toBe('yes');

      await db.query(
        `UPDATE osm_route_poi_staging SET toilets = NULL WHERE id = 'n1'`,
      );
      await db.query(
        `UPDATE osm_route_poi_staging SET toilets = 'no' WHERE id = 'n6'`,
      );
      await insert(new Date(Date.now() + 1000).toISOString());

      expect((await rowOf('n1')).toilets).toBe('unknown');
      expect((await rowOf('n6')).toilets).toBe('no');
      const after = (
        await db.query('SELECT count(*)::int AS n FROM osm_route_poi')
      ).rows[0].n;
      expect(after).toBe(before);
    });
  });

  describe('a staging table that lacks a column', () => {
    // A small extract has no `maxheight` on any feature, so ogr2ogr never
    // makes the column and the INSERT would die on it for a good file.
    //
    // 🔴 MUTATION: delete the ALTER in ensureStagingColumns — the next
    // run of a one-country scratch load fails on "column does not exist".
    // 🔴 MUTATION: add every column the SQL reads, whether or not the export
    // lists it — then a dropped `toilets` becomes a column of 'unknown'
    // that reads as a finding.
    it('adds what the export carries and never invents what it does not', async () => {
      await db.query(`CREATE TABLE staging_probe (id text, "toilets" text)`);
      const added = await ensureStagingColumns(
        db,
        ['toilets', 'maxheight', 'contact:phone'],
        'staging_probe',
      );
      expect(added).toEqual(['maxheight', 'contact:phone']);
      const cols = await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'staging_probe' AND table_schema = current_schema()
          ORDER BY column_name`,
      );
      expect(cols.rows.map((r) => r.column_name)).toEqual([
        'contact:phone',
        'id',
        'maxheight',
        'toilets',
      ]);
      // …and a second call has nothing left to add
      expect(
        await ensureStagingColumns(
          db,
          ['toilets', 'maxheight'],
          'staging_probe',
        ),
      ).toEqual([]);
    });

    it('refuses a table or tag name it cannot safely quote', async () => {
      await expect(
        ensureStagingColumns(db, ['x'], 'staging; DROP TABLE camping_spots'),
      ).rejects.toThrow(/unsafe table name/);
      await expect(
        ensureStagingColumns(
          db,
          ['x"; DROP TABLE camping_spots; --'],
          'staging_probe',
        ),
      ).rejects.toThrow(/unsafe tag name/);
    });
  });

  describe('the table itself', () => {
    // 🔴 MUTATION: drop NOT NULL, or the DEFAULT, from the migration. A row
    // nobody has re-imported yet must say 'unknown', not NULL and not 'no'.
    it('says unknown for a row inserted without any facility column', async () => {
      await db.query(
        `INSERT INTO osm_route_poi (osm_ref, kind, location, country)
         VALUES ('n999999', 'fuel', ST_SetSRID(ST_MakePoint(14, 46), 4326), 'si')`,
      );
      const row = await rowOf('n999999');
      for (const column of [
        'toilets',
        'shower',
        'drinking_water',
        'sanitary_dump_station',
        'fee',
        'access',
        'hgv',
        'maxheight',
        'maxlength',
      ]) {
        expect(`${column}=${row[column]}`).toBe(`${column}=unknown`);
      }
    });

    // 🔴 MUTATION: remove the CHECKs, or NOT NULL from any one column.
    // The database would then take any word, and `maybe` in a column read
    // as yes/no/unknown is a lie — and a NULL is the gap this card exists
    // to close. NOT NULL is the ONLY guard on the verbatim columns: a NULL
    // passes `CHECK (btrim(x) <> '')`, because NULL is not false.
    it.each([
      ['toilets', "'maybe'"],
      ['shower', "'maybe'"],
      ['drinking_water', "'maybe'"],
      ['sanitary_dump_station', "'maybe'"],
      ['fee', "'donation'"],
      ...['access', 'hgv', 'maxheight', 'maxlength'].map((column) => [
        column,
        "'  '",
      ]),
      ...[
        'toilets',
        'shower',
        'drinking_water',
        'sanitary_dump_station',
        'fee',
        'access',
        'hgv',
        'maxheight',
        'maxlength',
      ].map((column) => [column, 'NULL']),
    ])('refuses %s = %s', async (column, value) => {
      await expect(
        db.query(
          `INSERT INTO osm_route_poi (osm_ref, kind, location, country, ${column})
           VALUES ('n888888', 'fuel', ST_SetSRID(ST_MakePoint(14, 46), 4326), 'si', ${value})`,
        ),
      ).rejects.toThrow(/violates (check|not-null) constraint/);
    });

    // 🔴 MUTATION: put `btrim(x) <> ''` back in the migration's CHECK — the
    // one expression that strips U+0020 and nothing else. A column holding
    // a lone TAB passed it: `maxheight='\t'` was STORED, and the migration's
    // header promises the empty string cannot be. This is the second lock,
    // and it is tested apart from the loader: the loader is one writer and
    // not the only one.
    it.each(
      ['access', 'hgv', 'maxheight', 'maxlength'].flatMap((column) =>
        BLANKS.map(
          (blank) =>
            [
              column,
              blank.codePointAt(0)!.toString(16).padStart(4, '0'),
              blank,
            ] as const,
        ),
      ),
    )('refuses %s made only of U+%s', async (column, _hex, blank) => {
      for (const value of [blank, `${blank}${blank}`, ` ${blank} `]) {
        await expect(
          db.query(
            `INSERT INTO osm_route_poi (osm_ref, kind, location, country, ${column})
             VALUES ('n888888', 'fuel', ST_SetSRID(ST_MakePoint(14, 46), 4326), 'si', $1)`,
            [value],
          ),
        ).rejects.toThrow(/violates check constraint/);
      }
    });

    // …and the lock is not a wall: a value with something in it is kept,
    // and so is one made of characters that only LOOK like blanks.
    it.each(['\u0085', '\u200b', '\u180e', '3.5', ' 3.5\t'])(
      'accepts a verbatim value of %j',
      async (value) => {
        await db.query(
          `INSERT INTO osm_route_poi (osm_ref, kind, location, country, maxheight)
           VALUES ('n777777', 'fuel', ST_SetSRID(ST_MakePoint(14, 46), 4326), 'si', $1)`,
          [value],
        );
        await db.query(`DELETE FROM osm_route_poi WHERE osm_ref = 'n777777'`);
      },
    );
  });
});
