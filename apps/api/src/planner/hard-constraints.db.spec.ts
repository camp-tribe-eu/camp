import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { EU_MEMBER_STATES } from '../osm/eu';
import { AMENITY_KEYS, mapAmenities } from '../osm/tag-mapping';
import { CoverageSnapshot } from './coverage-snapshot';
import {
  HARD,
  HardRequest,
  HardRule,
  hardWhere,
  LonLat,
} from './hard-constraints';
import {
  COMPONENTS,
  ComponentDef,
  loadMeasuredScoring,
  loadScoring,
} from './scoring';
import {
  format,
  measureConstraints,
  Measurement,
  problemsOf,
  sourceCountryReport,
} from './measure-constraints';
import { selectCandidates, shortlist, ShortlistRequest } from './shortlist';

// CAMP-246 — stage 1 (hard constraints) and stage 2 (scoring) over a REAL
// PostgreSQL, because every rule here is a statement about what PostgreSQL
// does with a missing jsonb key, a malformed correction, a geography
// distance and a link somebody undid. A test of the SHAPE of the SQL is
// satisfied by a query that gets any of them wrong.
//
// 🔴 THE CORPUS DOES NOT SHARE A FIELD WITH WHAT IT MEASURES. Amenity states
// are written by the importer's own mapper from OSM tags (`mapAmenities`),
// and the expected lists below are written from the TAGS in the table, not
// read back from the column the rule filters on. Corridor membership is by
// construction (a point placed 7.8 km from the line IS 7.8 km from it) and
// the one property test compares against plain ST_DWithin, which is the
// definition.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP. Needs CAMP_TEST_DATABASE_URL
// (locally) or CI_DATABASE_URL (CI): any PostGIS database you may CREATE
// DATABASE in. This file creates its own `camp246_*` database and drops it.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp246_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  // Only the columns the planner's queries read, with the types the real
  // table has (the precedent of planner.db.spec.ts).
  await db.query(`
    CREATE TYPE camping_spots_type_enum AS ENUM
      ('free', 'paid', 'wild', 'camper_stop', 'rv_park');
    CREATE TABLE camping_spots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar, country varchar NOT NULL, region varchar,
      slug varchar NOT NULL UNIQUE,
      type camping_spots_type_enum NOT NULL DEFAULT 'paid',
      amenities jsonb NOT NULL DEFAULT '{}',
      location geometry(Point, 4326) NOT NULL,
      owner_overrides jsonb NOT NULL DEFAULT '{}',
      stars smallint,
      missing_since timestamptz);
    CREATE TABLE spot_links (
      primary_id uuid NOT NULL, secondary_id uuid NOT NULL,
      unlinked_at timestamptz, created_at timestamptz DEFAULT now());
    CREATE INDEX camping_spots_location_gist ON camping_spots USING gist (location);`);
  await buildFixture();
});

afterAll(async () => {
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

interface Spot {
  slug: string;
  country?: string;
  region?: string | null;
  /** OSM tags, run through the importer's own mapper. */
  tags?: Record<string, string>;
  /** Bypasses the mapper: a row written before an amenity existed. */
  rawAmenities?: Record<string, string>;
  /** Bypasses everything: the jsonb text as stored, however wrong. */
  amenitiesJson?: string;
  /** The owner's corrections, as the jsonb text stored. */
  overrides?: string;
  lon: number;
  lat: number;
  missing?: boolean;
  stars?: number;
}

async function put(s: Spot): Promise<string> {
  const amenities =
    s.amenitiesJson ??
    JSON.stringify(s.rawAmenities ?? mapAmenities(s.tags ?? {}));
  const res = await db.query(
    `INSERT INTO camping_spots
       (slug, country, region, amenities, owner_overrides, location, missing_since, stars)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb,
             ST_SetSRID(ST_MakePoint($6, $7), 4326),
             CASE WHEN $8::boolean THEN now() ELSE NULL END, $9)
     RETURNING id`,
    [
      s.slug,
      s.country ?? 'HR',
      s.region === undefined ? 'Region' : s.region,
      amenities,
      s.overrides ?? '{}',
      s.lon,
      s.lat,
      s.missing ?? false,
      s.stars ?? null,
    ],
  );
  return res.rows[0].id;
}

const link = (primary: string, secondary: string, undone = false) =>
  db.query(
    `INSERT INTO spot_links (primary_id, secondary_id, unlinked_at)
     VALUES ($1, $2, CASE WHEN $3::boolean THEN now() ELSE NULL END)`,
    [primary, secondary, undone],
  );

// ---------------------------------------------------------------------------
// The fixture, as a table.
//
// The corridor runs north along the meridian 14°E from 45°N to 46°N
// (about 111 km), 30 km to either side. Its target stop is the middle,
// (14, 45.5). One degree of longitude at 45.5°N is about 78 km, so a
// longitude offset of 0.1° is 7.8 km and of 0.5° is 39 km — the distances
// below are those, by construction, not read back from PostGIS.
//
// AMENITY ROWS, all inside the corridor, along latitude 45.5 (electricity):
//   el-no        0 km    power_supply=no                       a recorded no
//   el-yes       2 km    power_supply=yes
//   el-unk       5 km    no tags: every amenity `unknown`
//   el-legacy    7 km    amenities = {}: the keys do not exist (older rows)
//   el-maybe     9 km    {"electricity":"maybe"}: not one of the three words
//   el-array    12 km    amenities is the jsonb array []
//   el-scalar   14 km    amenities is the jsonb string "yes"
//   el-over-yes 16 km    power_supply=no, the OWNER corrected it to yes
//   el-over-no  19 km    power_supply=yes, the OWNER corrected it to no
//   el-over-bad 21 km    power_supply=no; the correction {"amenities":"yes"} is not an object
//   el-over-arr 23 km    no tags; the correction {"amenities":[1,2]} is not an object
// Other amenities, lat 45.6 and 45.4: dog-yes dog-no grey-yes grey-no,
// and both-yes (power_supply=yes AND dog=yes).
//
// PAGE ROWS (lat 45.3): pg-ok, pg-missing (missing_since), pg-noregion,
// pg-hidden (a live secondary of pg-ok), pg-undone (its link was undone).
//
// COUNTRY ROWS (lat 45.7): cc-fi FI, cc-ax AX, cc-gr GR, cc-se SE, cc-ch CH.
//
// CORRIDOR ROWS (no tags):
//   co-in-7km       (14.10, 45.80)  beside the line          in
//   co-out-39km     (14.50, 45.50)  beside the line          OUT
//   co-start-in     (14.00, 44.82)  20 km before the start   in
//   co-end-in       (14.00, 46.18)  20 km past the end       in
//   co-end-out      (14.00, 46.45)  50 km past the end       OUT
//   co-bbox-corner  (14.37, 46.25)  INSIDE the line's bounding box, 40 km
//                                   from its end: a bounding box alone keeps it
//   co-edge-in      (14.38, 45.50)  29.6 km from the line    in
//   co-edge-out     (14.40, 45.50)  31.2 km from the line    OUT
// ---------------------------------------------------------------------------

const LINE: LonLat[] = [
  [14, 45],
  [14, 46],
];
const TARGET: LonLat = [14, 45.5];
const REQ: HardRequest = { line: LINE, bufferM: 30_000 };
const SHORT: ShortlistRequest = { ...REQ, target: TARGET, toleranceM: 40_000 };

async function buildFixture(): Promise<void> {
  // Anchor on the PRODUCER: if the mapper stopped reading these tags the
  // table above would be a fiction, and every expectation below would be
  // about that instead.
  expect(mapAmenities({ power_supply: 'yes' }).electricity).toBe('yes');
  expect(mapAmenities({ power_supply: 'no' }).electricity).toBe('no');
  expect(mapAmenities({}).electricity).toBe('unknown');
  expect(mapAmenities({ dog: 'yes' }).dogFriendly).toBe('yes');
  expect(mapAmenities({ dog: 'no' }).dogFriendly).toBe('no');
  expect(mapAmenities({ sanitary_dump_station: 'yes' }).greyWater).toBe('yes');
  expect(mapAmenities({ sanitary_dump_station: 'no' }).greyWater).toBe('no');

  const at = (km: number) => 14 + km / 78; // longitude, at 45.5°N
  const el = (slug: string, km: number, extra: Partial<Spot> = {}) =>
    put({ slug, lon: at(km), lat: 45.5, ...extra });

  await el('el-no', 0, { tags: { power_supply: 'no' } });
  await el('el-yes', 2, { tags: { power_supply: 'yes' } });
  await el('el-unk', 5);
  await el('el-legacy', 7, { rawAmenities: {} });
  await el('el-maybe', 9, { rawAmenities: { electricity: 'maybe' } });
  await el('el-array', 12, { amenitiesJson: '[]' });
  await el('el-scalar', 14, { amenitiesJson: '"yes"' });
  await el('el-over-yes', 16, {
    tags: { power_supply: 'no' },
    overrides: '{"amenities":{"electricity":"yes"}}',
  });
  await el('el-over-no', 19, {
    tags: { power_supply: 'yes' },
    overrides: '{"amenities":{"electricity":"no"}}',
  });
  await el('el-over-bad', 21, {
    tags: { power_supply: 'no' },
    overrides: '{"amenities":"yes"}',
  });
  await el('el-over-arr', 23, { overrides: '{"amenities":[1,2]}' });

  await put({ slug: 'dog-yes', lon: 14, lat: 45.6, tags: { dog: 'yes' } });
  await put({ slug: 'dog-no', lon: 14.01, lat: 45.6, tags: { dog: 'no' } });
  await put({
    slug: 'grey-yes',
    lon: 14,
    lat: 45.4,
    tags: { sanitary_dump_station: 'yes' },
  });
  await put({
    slug: 'grey-no',
    lon: 14.01,
    lat: 45.4,
    tags: { sanitary_dump_station: 'no' },
  });
  await put({
    slug: 'both-yes',
    lon: 14.02,
    lat: 45.6,
    tags: { power_supply: 'yes', dog: 'yes' },
  });

  const ok = await put({ slug: 'pg-ok', lon: 14, lat: 45.3 });
  await put({ slug: 'pg-missing', lon: 14.01, lat: 45.3, missing: true });
  await put({ slug: 'pg-noregion', lon: 14.02, lat: 45.3, region: null });
  const hidden = await put({ slug: 'pg-hidden', lon: 14.03, lat: 45.3 });
  const undone = await put({ slug: 'pg-undone', lon: 14.04, lat: 45.3 });
  await link(ok, hidden);
  await link(ok, undone, true);

  const cc = (slug: string, country: string, i: number) =>
    put({ slug, country, lon: 14 + i * 0.01, lat: 45.7 });
  await cc('cc-fi', 'FI', 0);
  await cc('cc-ax', 'AX', 1);
  await cc('cc-gr', 'GR', 2);
  await cc('cc-se', 'SE', 3);
  await cc('cc-ch', 'CH', 4);

  await put({ slug: 'co-in-7km', lon: 14.1, lat: 45.8 });
  await put({ slug: 'co-out-39km', lon: 14.5, lat: 45.5 });
  await put({ slug: 'co-start-in', lon: 14, lat: 44.82 });
  await put({ slug: 'co-end-in', lon: 14, lat: 46.18 });
  await put({ slug: 'co-end-out', lon: 14, lat: 46.45 });
  await put({ slug: 'co-bbox-corner', lon: 14.37, lat: 46.25 });
  await put({ slug: 'co-edge-in', lon: 14.38, lat: 45.5 });
  await put({ slug: 'co-edge-out', lon: 14.4, lat: 45.5 });

  // Stage 2's own corner of the map, far from everything above: a disc of
  // 10 km around (16, 47), and in it exactly these three.
  //   sc-no  at the target, power_supply=no
  //   sc-a   0.4 km east, nothing recorded
  //   sc-b   6 km east, power_supply=yes and sanitary_dump_station=yes
  // and a second disc of 10 km around (18, 47), for a near-tie the weights decide:
  //   sc-y   1.0 km east, no rating
  //   sc-x   1.5 km east, five stars
  const lon47 = (km: number) => 16 + km / 76; // at 47°N: 1° of longitude is ~76 km
  await put({ slug: 'sc-no', lon: 16, lat: 47, tags: { power_supply: 'no' } });
  await put({ slug: 'sc-a', lon: lon47(0.4), lat: 47 });
  await put({
    slug: 'sc-b',
    lon: lon47(6),
    lat: 47,
    tags: { power_supply: 'yes', sanitary_dump_station: 'yes' },
  });
  await put({ slug: 'sc-y', lon: 18 + 1 / 76, lat: 47 });
  await put({ slug: 'sc-x', lon: 18 + 1.5 / 76, lat: 47, stars: 5 });
}

const slugsOf = (rows: Array<{ slug: string }>, prefix = ''): string[] =>
  rows
    .map((r) => r.slug)
    .filter((s) => s.startsWith(prefix))
    .sort();

const run = async (req: ShortlistRequest) => shortlist(db, req);

// ---------------------------------------------------------------------------

describe('the card’s test: a recorded no is absent, an unknown is present and marked', () => {
  const need = (...keys: HardRequest['needs'] & string[]) =>
    ({ ...SHORT, needs: keys }) as ShortlistRequest;

  it('anchors: the three records hold yes, no and unknown — as the mapper wrote them', async () => {
    const rows = (
      await db.query(
        `SELECT slug, amenities ->> 'electricity' AS e FROM camping_spots
          WHERE slug IN ('el-yes', 'el-no', 'el-unk') ORDER BY slug`,
      )
    ).rows;
    expect(rows).toEqual([
      { slug: 'el-no', e: 'no' },
      { slug: 'el-unk', e: 'unknown' },
      { slug: 'el-yes', e: 'yes' },
    ]);
  });

  it('electricity required: the no is gone, the yes and the unknown stay, the unknown is marked', async () => {
    const out = (await run(need('electricity'))).filter((r) =>
      ['el-yes', 'el-no', 'el-unk'].includes(r.slug),
    );
    expect(slugsOf(out)).toEqual(['el-unk', 'el-yes']);
    const by = Object.fromEntries(out.map((r) => [r.slug, r.needs]));
    expect(by['el-yes']).toEqual([{ key: 'electricity', state: 'yes' }]);
    expect(by['el-unk']).toEqual([{ key: 'electricity', state: 'unknown' }]);
  });

  it('without the filter the no OUTRANKS the unknown that stays — rejected, not sunk', async () => {
    // el-no is nearer than el-unk and neither earns the electricity bonus,
    // so the score puts the no first. That is exactly the failure a score
    // alone cannot fix: its absence below is the filter's doing.
    const free = (await run(SHORT)).filter((r) => r.slug.startsWith('el-'));
    const order = free.map((r) => r.slug);
    expect(order.indexOf('el-no')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('el-no')).toBeLessThan(order.indexOf('el-unk'));
    const asked = await run(need('electricity'));
    expect(slugsOf(asked)).not.toContain('el-no');
    expect(slugsOf(asked)).toContain('el-unk');
  });

  it('the requirement is the reader’s: with none, a no is simply a campsite', async () => {
    expect(slugsOf(await run(SHORT))).toEqual(
      expect.arrayContaining(['el-no', 'el-over-no', 'dog-no', 'grey-no']),
    );
  });

  it('dogFriendly: the key travels as a parameter, so this is not an electricity filter', async () => {
    const out = await run(need('dogFriendly'));
    const slugs = slugsOf(out);
    expect(slugs).not.toContain('dog-no');
    expect(slugs).toContain('dog-yes');
    // Unknown for dogs — and a no for electricity, which must NOT matter here.
    expect(slugs).toContain('el-no');
    const dog = Object.fromEntries(out.map((r) => [r.slug, r.needs]));
    expect(dog['dog-yes']).toEqual([{ key: 'dogFriendly', state: 'yes' }]);
    expect(dog['el-no']).toEqual([{ key: 'dogFriendly', state: 'unknown' }]);
  });

  it('greyWater: the same, for a third key', async () => {
    const out = await run(need('greyWater'));
    expect(slugsOf(out)).not.toContain('grey-no');
    expect(slugsOf(out)).toEqual(
      expect.arrayContaining(['grey-yes', 'el-unk']),
    );
  });

  it('several requirements: each rejects its own no, and a yes on one with an unknown on the other stays', async () => {
    const out = await run(need('electricity', 'dogFriendly'));
    const slugs = slugsOf(out);
    expect(slugs).not.toContain('el-no'); // no electricity
    expect(slugs).not.toContain('dog-no'); // no dogs
    expect(slugs).toContain('both-yes');
    expect(slugs).toContain('el-yes'); // yes electricity, dogs unknown
    const by = Object.fromEntries(out.map((r) => [r.slug, r.needs]));
    expect(by['el-yes']).toEqual([
      { key: 'electricity', state: 'yes' },
      { key: 'dogFriendly', state: 'unknown' },
    ]);
  });

  it('every amenity at once: only the campsites that RECORD a no on one of them go', async () => {
    const all = await run({ ...SHORT, needs: AMENITY_KEYS });
    const slugs = slugsOf(all);
    for (const gone of ['el-no', 'dog-no', 'grey-no', 'el-over-no']) {
      expect(slugs).not.toContain(gone);
    }
    // el-unk knows nothing about any of the ten: it stays, ten times unknown.
    const unk = all.find((r) => r.slug === 'el-unk');
    expect(unk?.needs).toHaveLength(AMENITY_KEYS.length);
    expect(unk?.needs.every((n) => n.state === 'unknown')).toBe(true);
  });

  it('an amenity nobody recorded in a readable way is unknown, never a no, and never an error', async () => {
    const out = await run(need('electricity'));
    const by = Object.fromEntries(out.map((r) => [r.slug, r.needs]));
    for (const slug of ['el-legacy', 'el-maybe', 'el-array', 'el-scalar']) {
      expect(by[slug]).toEqual([{ key: 'electricity', state: 'unknown' }]);
    }
  });

  it('one corrupted record costs one record, not the result', async () => {
    const out = await run(need('electricity'));
    // The array and the scalar are the corrupt ones; everything else is
    // still here: 4 unreadable + the rest of the corridor's campsites.
    expect(slugsOf(out)).toEqual(
      expect.arrayContaining(['el-array', 'el-scalar', 'el-yes', 'pg-ok']),
    );
  });

  it('refuses an amenity it does not know instead of filtering nothing', async () => {
    await expect(run(need('electrcity' as never))).rejects.toThrow(
      /not an amenity we record/,
    );
  });
});

describe('the owner’s corrections win, in both directions', () => {
  const asked: ShortlistRequest = { ...SHORT, needs: ['electricity'] };

  it('an imported no that the owner corrected to yes is NOT rejected, and reads yes', async () => {
    const r = (await run(asked)).find((x) => x.slug === 'el-over-yes');
    expect(r?.needs).toEqual([{ key: 'electricity', state: 'yes' }]);
  });

  it('an imported yes that the owner corrected to no IS rejected', async () => {
    expect(slugsOf(await run(asked))).not.toContain('el-over-no');
  });

  it('a correction that is not an object is ignored: the imported no still rejects', async () => {
    expect(slugsOf(await run(asked))).not.toContain('el-over-bad');
  });

  it('…and a correction that is not an object does not break an unknown', async () => {
    const r = (await run(asked)).find((x) => x.slug === 'el-over-arr');
    expect(r?.needs).toEqual([{ key: 'electricity', state: 'unknown' }]);
  });

  it('the candidate carries the corrected amenities, not the imported ones', async () => {
    const r = (await selectCandidates(db, asked)).find(
      (x) => x.slug === 'el-over-yes',
    );
    expect(r?.amenities.electricity).toBe('yes');
  });
});

describe('page: a stop has to lead to a page', () => {
  it('a missing campsite, one with no region and a hidden secondary are not suggested', async () => {
    const slugs = slugsOf(await run(SHORT), 'pg-');
    expect(slugs).toEqual(['pg-ok', 'pg-undone']);
  });

  it('a secondary whose link was undone is its own page again', async () => {
    expect(slugsOf(await run(SHORT))).toContain('pg-undone');
  });
});

describe('country: the project’s scope, spelled the way the SOURCE spells it', () => {
  const cc = async (countries?: string[]) =>
    slugsOf(await run({ ...SHORT, countries }), 'cc-');

  it('by default, the whole Union — Åland included, which the source codes AX — and not Switzerland', async () => {
    expect(await cc()).toEqual(['cc-ax', 'cc-fi', 'cc-gr', 'cc-se']);
  });

  it('Finland brings Åland with it', async () => {
    expect(await cc(['FI'])).toEqual(['cc-ax', 'cc-fi']);
  });

  it('Greece as the EU spells it, EL, finds the campsites the source codes GR', async () => {
    expect(await cc(['EL'])).toEqual(['cc-gr']);
  });

  it('Sweden is Sweden only', async () => {
    expect(await cc(['SE'])).toEqual(['cc-se']);
  });

  it('refuses a country outside the Union', async () => {
    await expect(cc(['CH'])).rejects.toThrow(/not an EU member state/);
  });
});

describe('corridor: geography, in metres', () => {
  const co = async (req: Partial<ShortlistRequest> = {}) =>
    slugsOf(await run({ ...SHORT, ...req }), 'co-');

  it('keeps what lies within the buffer of the line — beside it and past either end — and nothing else', async () => {
    expect(await co()).toEqual([
      'co-edge-in',
      'co-end-in',
      'co-in-7km',
      'co-start-in',
    ]);
  });

  it('a campsite inside the line’s bounding box but 40 km from the line is out', async () => {
    expect(await co()).not.toContain('co-bbox-corner');
  });

  it('is exact at the edge: 29.6 km in, 31.2 km out', async () => {
    const slugs = await co();
    expect(slugs).toContain('co-edge-in');
    expect(slugs).not.toContain('co-edge-out');
  });

  it('a wider buffer takes more, a narrower one fewer', async () => {
    expect(await co({ bufferM: 45_000 })).toEqual(
      expect.arrayContaining(['co-out-39km', 'co-edge-out']),
    );
    expect(await co({ bufferM: 10_000 })).toEqual(['co-in-7km']);
  });

  it('one point is a disc around it', async () => {
    const slugs = slugsOf(
      await run({
        ...SHORT,
        line: [[16, 47]],
        target: [16, 47],
        bufferM: 10_000,
      }),
    );
    expect(slugs).toEqual(['sc-a', 'sc-b', 'sc-no']);
  });

  it('a line of two equal points is that disc too, not an error', async () => {
    const slugs = slugsOf(
      await run({
        ...SHORT,
        line: [
          [16, 47],
          [16, 47],
        ],
        target: [16, 47],
        bufferM: 10_000,
      }),
    );
    expect(slugs).toEqual(['sc-a', 'sc-b', 'sc-no']);
  });

  it('the distance it returns is in METRES: 0.1° of longitude at 45.5°N is about 7.8 km', async () => {
    const rows = await selectCandidates(db, {
      ...SHORT,
      target: [14, 45.5],
    });
    const by = Object.fromEntries(rows.map((r) => [r.slug, r.distanceM]));
    // el-yes sits 2 km east of the target by construction; el-over-yes 16 km.
    expect(by['el-no']).toBeLessThan(1);
    expect(by['el-yes']).toBeGreaterThan(1_900);
    expect(by['el-yes']).toBeLessThan(2_100);
    expect(by['el-over-yes']).toBeGreaterThan(15_500);
    expect(by['el-over-yes']).toBeLessThan(16_500);
  });
});

describe('the prefilter is lossless: the index box never drops what the exact distance keeps', () => {
  // The oracle is plain ST_DWithin — the definition — with no box.
  //
  // 🔴 WHY THERE ARE ROUTES HERE THAT RUN EAST–WEST. This property used to
  // run one line, and that line went north (10°E→24°E while climbing from 50
  // to 66°N). On it the great-circle arc never rises above its own vertices,
  // so a box built from the VERTICES alone is exactly big enough and the test
  // could not fail. ST_DWithin on a geography measures to the great-circle
  // ARC, and between two points at the same latitude that arc bows toward the
  // pole: Madrid→Thessaloniki climbs from 40.6°N to 41.5°N half-way. A box
  // from the vertices cut 249 of 370 campsites from that route, and this
  // test stayed green. Review changed the fixture and it went red.
  //
  // So each route says whether it bows, and the test PROVES the fixture
  // reaches the path it checks: a bowing route must put campsites, that the
  // exact distance keeps, outside the box the two ends alone would give.
  const corridor = HARD.find((r) => r.id === 'corridor') as HardRule;

  const R = 6_371_008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const deg = (r: number) => (r * 180) / Math.PI;
  const unit = ([lon, lat]: LonLat): [number, number, number] => [
    Math.cos(rad(lat)) * Math.cos(rad(lon)),
    Math.cos(rad(lat)) * Math.sin(rad(lon)),
    Math.sin(rad(lat)),
  ];
  /** The point a fraction t of the way along the great-circle arc a→b: SLERP. */
  function along(a: LonLat, b: LonLat, t: number): LonLat {
    const va = unit(a);
    const vb = unit(b);
    const w = Math.acos(
      Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]),
    );
    const k1 = Math.sin((1 - t) * w) / Math.sin(w);
    const k2 = Math.sin(t * w) / Math.sin(w);
    const x = va.map((c, i) => k1 * c + k2 * vb[i]);
    return [
      deg(Math.atan2(x[1], x[0])),
      deg(Math.atan2(x[2], Math.hypot(x[0], x[1]))),
    ];
  }
  /** `d` metres from `p` on `bearing` (degrees), on the sphere. */
  function destination(p: LonLat, bearing: number, d: number): LonLat {
    const φ1 = rad(p[1]);
    const θ = rad(bearing);
    const δ = d / R;
    const φ2 = Math.asin(
      Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
    );
    const λ2 =
      rad(p[0]) +
      Math.atan2(
        Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
        Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
      );
    return [deg(λ2), deg(φ2)];
  }

  interface Route {
    name: string;
    line: LonLat[];
    bufferM: number;
    /** `region`: scattered over a block of Europe. `arc`: round the route itself. */
    scatter: 'region' | 'arc';
    /** The great-circle arc rises above its ends: the box must follow it. */
    bows: boolean;
  }
  const ROUTES: Route[] = [
    {
      name: 'north-east at 50–66°N, where a degree of longitude is short',
      line: [
        [10, 50],
        [20, 58],
        [24, 66],
      ],
      bufferM: 60_000,
      scatter: 'region',
      bows: false,
    },
    {
      name: 'Madrid → Thessaloniki, due east, 2 800 km',
      line: [
        [-3.7038, 40.4168],
        [22.9444, 40.6401],
      ],
      bufferM: 30_000,
      scatter: 'arc',
      bows: true,
    },
    {
      name: 'Dublin → Warsaw, east, a little south',
      line: [
        [-6.2603, 53.3498],
        [21.0122, 52.2297],
      ],
      bufferM: 30_000,
      scatter: 'arc',
      bows: true,
    },
    {
      // A road is a polyline; each leg is its own arc, and here both bow.
      name: 'Madrid → Thessaloniki → Vinaròs, out and back, two bowing legs',
      line: [
        [-3.7038, 40.4168],
        [22.9444, 40.6401],
        [0.4753, 40.47],
      ],
      bufferM: 30_000,
      scatter: 'arc',
      bows: true,
    },
    {
      name: 'Lyon → Barcelona, south-west: nearly a meridian, nothing to bow',
      line: [
        [4.8357, 45.764],
        [2.1734, 41.3851],
      ],
      bufferM: 30_000,
      scatter: 'arc',
      bows: false,
    },
  ];

  const count = async (): Promise<number> =>
    (await db.query('SELECT count(*)::int AS n FROM camping_spots')).rows[0].n;

  describe.each(ROUTES.map((r) => [r.name, r] as const))('%s', (_n, route) => {
    beforeAll(async () => {
      await db.query('BEGIN');
      await db.query('DELETE FROM camping_spots');
      let seed = 246 + route.line.length;
      const rnd = () => {
        seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
        return seed / 4_294_967_296;
      };
      for (let i = 0; i < 600; i++) {
        let at: LonLat;
        if (route.scatter === 'region') {
          at = [6 + rnd() * 22, 48 + rnd() * 20];
        } else {
          // A point on a random leg's arc, pushed up to 2.5 buffers off it
          // in a random direction: about 40% land inside, and the half-way
          // part of each leg — where the arc is furthest from its ends — is
          // as thick as any other.
          const leg = Math.floor(rnd() * (route.line.length - 1));
          const p = along(route.line[leg], route.line[leg + 1], rnd());
          at = destination(p, rnd() * 360, rnd() * 2.5 * route.bufferM);
        }
        await put({
          slug: `rnd-${String(i).padStart(3, '0')}`,
          lon: at[0],
          lat: at[1],
        });
      }
    });
    afterAll(async () => {
      await db.query('ROLLBACK');
    });

    it('returns exactly the set plain ST_DWithin returns', async () => {
      const exactRows = (
        await db.query(
          `SELECT slug, ST_Y(s.location) AS lat FROM camping_spots s
            WHERE ST_DWithin(s.location::geography,
                    ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326)::geography, $2)
            ORDER BY slug`,
          [
            JSON.stringify({ type: 'LineString', coordinates: route.line }),
            route.bufferM,
          ],
        )
      ).rows as Array<{ slug: string; lat: number }>;
      const exact = exactRows.map((r) => r.slug);
      const req: HardRequest = { line: route.line, bufferM: route.bufferM };
      const { where, params } = hardWhere(req, 's', 0, [corridor]);
      const viaRule = (
        await db.query(
          `SELECT slug FROM camping_spots s WHERE ${where} ORDER BY slug`,
          params,
        )
      ).rows.map((r) => r.slug);

      // Anchor: the corridor takes SOME of the 600 and not all of them, or
      // equality of two sets says nothing.
      expect(await count()).toBe(600);
      expect(exact.length).toBeGreaterThan(40);
      expect(exact.length).toBeLessThan(560);

      // Anchor: the fixture REACHES the path this test is about. Campsites
      // the exact distance keeps, but that lie beyond the box the two ends
      // would give, are what a vertex-only box loses. A bowing route has
      // them; a test that cannot see any proves nothing about the bow.
      const dLat = route.bufferM / 110_000;
      const top = Math.max(...route.line.map((p) => p[1])) + dLat;
      const bottom = Math.min(...route.line.map((p) => p[1])) - dLat;
      const beyondTheEnds = exactRows.filter(
        (r) => r.lat > top || r.lat < bottom,
      ).length;
      if (route.bows) expect(beyondTheEnds).toBeGreaterThan(10);

      expect(viaRule).toEqual(exact);
    });
  });
});

describe('the corridor can use the index on location', () => {
  // The `&&` box is the reason the rule has two halves: ST_DWithin on a
  // geography cast cannot use a geometry index, so without the box every
  // request reads every campsite. With sequential scans switched off, the
  // planner takes an index if there is ANY way to, and says so.
  const corridor = HARD.find((r) => r.id === 'corridor') as HardRule;

  const plan = async (where: string, params: unknown[]): Promise<string> => {
    await db.query('BEGIN');
    try {
      await db.query('SET LOCAL enable_seqscan = off');
      const r = await db.query(
        `EXPLAIN SELECT slug FROM camping_spots s WHERE ${where}`,
        params,
      );
      return r.rows.map((x) => x['QUERY PLAN']).join('\n');
    } finally {
      await db.query('ROLLBACK');
    }
  };

  it('the planner reaches for camping_spots_location_gist', async () => {
    const { where, params } = hardWhere(REQ, 's', 0, [corridor]);
    expect(await plan(where, params)).toMatch(
      /Index Scan using camping_spots_location_gist|Bitmap Index Scan on camping_spots_location_gist/,
    );
  });

  it('and does NOT with the exact distance alone — so the test can tell the two apart', async () => {
    const plain = await plan(
      `ST_DWithin(s.location::geography,
         ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326)::geography, $2::float8)`,
      [JSON.stringify({ type: 'LineString', coordinates: LINE }), 30_000],
    );
    expect(plain).not.toMatch(/camping_spots_location_gist/);
  });
});

describe('every declared rule, on a campsite that is only unknown', () => {
  // The CAMP-246 rule as a property of the LIST, so a rule added tomorrow
  // meets it without anyone remembering to write the test: el-unk is
  // published, in scope, inside the corridor, and every one of its ten
  // amenities is `unknown`. No rule may reject it.
  const ALL: HardRequest = { ...REQ, needs: AMENITY_KEYS };

  it.each(HARD.map((r) => [r.id, r] as const))(
    '%s does not reject it',
    async (_id, rule) => {
      const { where, params } = hardWhere(ALL, 's', 1, [rule]);
      const r = await db.query(
        `SELECT 1 FROM camping_spots s WHERE s.slug = $1 AND ${where}`,
        ['el-unk', ...params],
      );
      expect(r.rowCount).toBe(1);
    },
  );

  it('and the same row passes all of them together', async () => {
    const out = await selectCandidates(db, { ...SHORT, needs: AMENITY_KEYS });
    expect(slugsOf(out)).toContain('el-unk');
  });
});

describe('no rule is dead: each rejects something and keeps something', () => {
  const ASKING: Record<string, HardRequest> = {
    page: REQ,
    country: { ...REQ, countries: ['FI'] },
    corridor: REQ,
    needs: { ...REQ, needs: ['electricity'] },
  };

  it.each(HARD.map((r) => [r.id, r] as const))('%s', async (id, rule) => {
    const { where, params } = hardWhere(ASKING[id], 's', 0, [rule]);
    const r = await db.query(
      `SELECT count(*) FILTER (WHERE coalesce(${where}, false))::int AS kept,
                count(*) FILTER (WHERE NOT coalesce(${where}, false))::int AS rejected
           FROM camping_spots s`,
      params,
    );
    expect(r.rows[0].rejected).toBeGreaterThan(0);
    expect(r.rows[0].kept).toBeGreaterThan(0);
  });
});

describe('stage 2 comes after stage 1, and reads its weights from the configuration', () => {
  const disc: ShortlistRequest = {
    line: [[16, 47]],
    target: [16, 47],
    bufferM: 10_000,
    toleranceM: 10_000,
  };

  /** Every field fully known, so the coverage rule lets any weights through. */
  const fullTable = (): CoverageSnapshot => ({
    measuredAt: 'test',
    population: { n: 100 },
    queryHash: 'test',
    fields: Object.fromEntries(
      ['location', 'electricity', 'greyWater', 'stars'].map((k) => [
        k,
        { known: 100 },
      ]),
    ),
    evidence: { starsMean: 3, starsOwnRow: 0, starsKnownByCountry: {} },
  });
  const reweigh = (w: Record<string, number>): ComponentDef[] =>
    COMPONENTS.map((c) => ({ ...c, weight: w[c.id] }));

  it('anchors: the disc holds exactly the three campsites the order below is about', async () => {
    expect(slugsOf(await selectCandidates(db, disc))).toEqual([
      'sc-a',
      'sc-b',
      'sc-no',
    ]);
  });

  it('a rejected campsite does not reach the ranking: it cannot outscore anything', async () => {
    // sc-no is AT the target and scores best on distance; without the
    // requirement it is first. With it, it is not in the list at all.
    const free = await run(disc);
    expect(free[0].slug).toBe('sc-no');
    const asked = await run({ ...disc, needs: ['electricity'] });
    expect(asked.map((r) => r.slug)).toEqual(['sc-a', 'sc-b']);
    expect(asked.find((r) => r.slug === 'sc-b')?.needs).toEqual([
      { key: 'electricity', state: 'yes' },
    ]);
    expect(asked.find((r) => r.slug === 'sc-a')?.needs).toEqual([
      { key: 'electricity', state: 'unknown' },
    ]);
  });

  it('the shipped weights put the near, bare campsite above the far, well-equipped one', async () => {
    const out = await run({ ...disc, needs: ['electricity'] });
    expect(out.map((r) => r.slug)).toEqual(['sc-a', 'sc-b']);
    expect(out[0].score).toBeGreaterThan(out[1].score);
  });

  it('other weights, same campsites: the order changes, because the weights are READ from the configuration', async () => {
    const flipped = loadScoring(
      reweigh({
        distance_fit: 0.1,
        electricity: 0.4,
        greyWater: 0.4,
        stars: 0.1,
      }),
      fullTable(),
    );
    const out = await shortlist(
      db,
      { ...disc, needs: ['electricity'] },
      flipped,
    );
    expect(out.map((r) => r.slug)).toEqual(['sc-b', 'sc-a']);
    // And the shipped configuration, handed over explicitly, is the default.
    const shipped = await shortlist(
      db,
      { ...disc, needs: ['electricity'] },
      loadMeasuredScoring(),
    );
    expect(shipped.map((r) => r.slug)).toEqual(['sc-a', 'sc-b']);
  });

  it('a weight on a field the data cannot carry is refused before any ordering', () => {
    const table = fullTable();
    table.fields.electricity.known = 30; // 30% known
    expect(() =>
      loadScoring(
        reweigh({
          distance_fit: 0.1,
          electricity: 0.7,
          greyWater: 0.1,
          stars: 0.1,
        }),
        table,
      ),
    ).toThrow(/electricity: weight 0.7 on "electricity", known for only 30.0%/);
  });

  describe('a near-tie that the weights decide', () => {
    // sc-y is 1.0 km from the target and unrated; sc-x is 1.5 km and has five
    // stars. Distance fit is 0.90 against 0.85, and the rating is worth
    // 0.5 more to sc-x than the neutral middle gives sc-y. The shipped
    // weights say the half-kilometre matters more; a re-weighing that the
    // coverage rule PERMITS (distance 0.7, the three bonuses 0.1 each) says
    // the stars do. Same two campsites, two honest orders.
    const tie: ShortlistRequest = {
      line: [[18, 47]],
      target: [18, 47],
      bufferM: 10_000,
      toleranceM: 10_000,
    };

    it('anchors: the two are in the disc, and the stars came through the page’s own reading', async () => {
      const rows = await selectCandidates(db, tie);
      expect(slugsOf(rows)).toEqual(['sc-x', 'sc-y']);
      const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
      expect(by['sc-x'].stars).toBe(5);
      expect(by['sc-y'].stars).toBeNull();
      expect(by['sc-y'].distanceM).toBeLessThan(by['sc-x'].distanceM);
    });

    it('the shipped weights: the nearer one first', async () => {
      expect((await run(tie)).map((r) => r.slug)).toEqual(['sc-y', 'sc-x']);
    });

    it('a permitted re-weighing, loaded against the REAL coverage table: the rated one first', async () => {
      const permitted = loadScoring(
        reweigh({
          distance_fit: 0.7,
          electricity: 0.1,
          greyWater: 0.1,
          stars: 0.1,
        }),
        JSON.parse(
          readFileSync(join(__dirname, 'coverage.snapshot.json'), 'utf8'),
        ) as CoverageSnapshot,
      );
      expect((await shortlist(db, tie, permitted)).map((r) => r.slug)).toEqual([
        'sc-x',
        'sc-y',
      ]);
    });
  });

  it('is best first, and one input gives one order', async () => {
    const a = await run(SHORT);
    const b = await run(SHORT);
    expect(a.map((r) => r.slug)).toEqual(b.map((r) => r.slug));
    for (let i = 1; i < a.length; i++) {
      expect(a[i - 1].score).toBeGreaterThanOrEqual(a[i].score);
      if (a[i - 1].score === a[i].score) {
        expect(a[i - 1].slug < a[i].slug).toBe(true);
      }
    }
    // Anchor: there is an order to check.
    expect(a.length).toBeGreaterThan(20);
  });
});

describe('measure-constraints: the counts the report prints, on a table whose answers are known', () => {
  // By construction (see the table at the top): 39 rows in all. Unpublishable
  // are pg-missing, pg-noregion and pg-hidden (3). Outside the Union is
  // cc-ch (1). Of the 35 left, 26 lie within 30 km of the line: the other
  // nine are four corridor rows that are out and the five `sc-*` rows,
  // which sit in other corners of the map.
  const JOURNEY = [{ name: 'fixture', line: LINE, bufferM: 30_000 }];
  let m: Measurement;

  beforeAll(async () => {
    m = await measureConstraints(db, JOURNEY);
  });

  it('anchors: the table has the 39 rows it is written with', async () => {
    const r = await db.query('SELECT count(*)::int AS n FROM camping_spots');
    expect(r.rows[0].n).toBe(39);
  });

  it('counts what each rule rejects, alone and in sequence', () => {
    expect(m.total).toBe(39);
    expect(m.alone).toEqual({ page: 3, country: 1 });
    expect(m.afterPage).toBe(36);
    expect(m.afterCountry).toBe(35);
    expect(m.journeys).toHaveLength(1);
    expect(m.journeys[0].pool).toBe(35);
    expect(m.journeys[0].inCorridor).toBe(26);
  });

  it('counts the three states of each amenity over the corridor, from the tags', () => {
    const el = m.journeys[0].needs.find((n) => n.key === 'electricity');
    // yes: el-yes, el-over-yes (the owner's yes), both-yes. no: el-no,
    // el-over-no (the owner's no), el-over-bad (a correction that is not an
    // object leaves the imported no). Everything else of the 26 is unknown.
    expect(el).toEqual({ key: 'electricity', yes: 3, no: 3, unknown: 20 });
    // Electricity is 3 and 3, which cannot tell a swap of the two apart; dogs
    // are not: yes = dog-yes and both-yes, no = dog-no.
    expect(m.journeys[0].needs.find((n) => n.key === 'dogFriendly')).toEqual({
      key: 'dogFriendly',
      yes: 2,
      no: 1,
      unknown: 23,
    });
    for (const n of m.journeys[0].needs) {
      expect(n.yes + n.no + n.unknown).toBe(26);
    }
  });

  it('counts the whole scope, not only a corridor', () => {
    const el = m.eu.find((n) => n.key === 'electricity');
    // The whole scope is the 35; the sc-* rows add sc-b (yes) and sc-no (no).
    expect(el?.yes).toBe(4);
    expect(el?.no).toBe(4);
    expect(el!.yes + el!.no + el!.unknown).toBe(35);
    expect(m.eu.find((n) => n.key === 'dogFriendly')).toEqual({
      key: 'dogFriendly',
      yes: 2,
      no: 1,
      unknown: 32,
    });
  });

  it('lists the country codes the source ACTUALLY holds, and flags the one outside the Union', async () => {
    const codes = await sourceCountryReport(db);
    expect(codes.rows.map((r) => r.code).sort()).toEqual([
      'ax',
      'ch',
      'fi',
      'gr',
      'hr',
      'se',
    ]);
    expect(codes.outOfScope).toEqual([{ code: 'ch', n: 1 }]);
    // Åland is IN the scope, and shown as written other than the member's own code.
    expect(codes.subdivisions).toEqual([{ code: 'ax', n: 1 }]);
    // Four member states have a campsite here (hr, fi — with Åland —, gr,
    // se); every other member is reported as having none.
    expect(codes.membersWithNone).toEqual(
      EU_MEMBER_STATES.filter((m) => !['fi', 'gr', 'hr', 'se'].includes(m)),
    );
  });

  it('turns that into a problem, in words, rather than a number nobody reads', () => {
    expect(problemsOf(m).join('\n')).toMatch(
      /source country code "ch" \(1 campsites\) is outside the scope/,
    );
  });

  it('is clean once the source is: Åland alone is not a problem', async () => {
    await db.query('BEGIN');
    try {
      await db.query(`DELETE FROM camping_spots WHERE slug = 'cc-ch'`);
      const clean = await measureConstraints(db, JOURNEY);
      expect(problemsOf(clean)).toEqual([]);
      expect(clean.alone.country).toBe(0);
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('prints those numbers, in the columns it labels', () => {
    const text = format(m, 'test');
    // The row for dogs over the corridor: yes 2, no 1, unknown 23; rejected
    // as `no` is 1 of 26 (3.8%); rejected as `not yes` is 24 of 26 (92.3%).
    expect(text).toMatch(/dogFriendly\s+2\s+1\s+23\s+1\s+3\.8%\s+24\s+92\.3%/);
    expect(text).toMatch(/fixture {2}\(buffer 30 km\): 35 -> corridor 26/);
    // The buffer printed is the journey's own, not a constant of the report.
    expect(
      format(
        { ...m, journeys: [{ ...m.journeys[0], bufferM: 45_000 }] },
        'test',
      ),
    ).toMatch(/\(buffer 45 km\)/);
    expect(text).toMatch(/rejects 9 \(25\.7%\)/); // 9 of the 35, not of the 39
    expect(text).toMatch(/page\s+3\s+7\.7%/);
    expect(text).toMatch(/outside the scope: CH 1;/);
    expect(text).toMatch(/written other than the member's own code: AX 1/);
  });

  it('calls a rule that rejects nothing, or everything, by its name', () => {
    expect(problemsOf({ ...m, alone: { page: 0, country: 0 } })).toContain(
      'page: rejects nothing',
    );
    expect(problemsOf({ ...m, afterPage: 0 })).toContain(
      'page: rejects everything',
    );
    expect(problemsOf({ ...m, afterCountry: 0 })).toContain(
      'country: rejects everything',
    );
    const wide = { ...m.journeys[0], inCorridor: m.journeys[0].pool };
    expect(problemsOf({ ...m, journeys: [wide] })).toContain(
      'fixture: the corridor rejects nothing',
    );
    const empty = { ...m.journeys[0], inCorridor: 0 };
    expect(problemsOf({ ...m, journeys: [empty] })).toContain(
      'fixture: the corridor is empty',
    );
  });
});
