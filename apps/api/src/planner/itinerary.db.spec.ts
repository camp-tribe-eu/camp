import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { mapAmenities } from '../osm/tag-mapping';
import { CoverageSnapshot } from './coverage-snapshot';
import { Corridor, CorridorProvider, straightCorridor } from './corridor';
import {
  ItineraryRequest,
  MAX_BUFFER_M,
  MAX_DAYS,
  planItinerary,
} from './itinerary';
import { measureTrips, problemsOf } from './measure-itinerary';
import {
  COMPONENTS,
  ComponentDef,
  loadMeasuredScoring,
  loadScoring,
} from './scoring';

// CAMP-46 — the itinerary over a REAL PostgreSQL: the corridor rule, the
// stage-1 columns, the position of each campsite on the line, the dynamic
// programme and the scoring, in the order a request meets them.
//
// 🔴 THE CORPUS DOES NOT SHARE A FIELD WITH WHAT IT MEASURES. The campsites
// are PLACED, by construction, on the meridian of a corridor — "93 km along,
// 0 km to the side" is a statement about where the row was put, written here
// with the closed-form spherical triangle (`onMeridian`), not read back from
// `corridor.ts`. The one distance asked of the result — how far apart the
// nights are — is read from PostGIS (`ST_Distance` on a geography, a spheroid
// where the code under test uses a sphere), not from the code's own
// arithmetic. Amenities are written by the importer's own mapper from tags.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP. Needs CAMP_TEST_DATABASE_URL
// (locally) or CI_DATABASE_URL (CI): any PostGIS database you may CREATE
// DATABASE in. This file creates its own `camp46_*` database and drops it.

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
  dbName = `camp46_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  // Only the columns the planner's queries read, with the types the real
  // table has (the precedent of hard-constraints.db.spec.ts).
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

// ---------------------------------------------------------------------------
// Placing campsites
// ---------------------------------------------------------------------------

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
/** Metres in a degree of arc on that sphere: 111 195.08. */
const DEGREE_M = (R * Math.PI) / 180;

/**
 * [lon, lat] of the point `alongKm` along the meridian `lon0` from latitude
 * `lat0`, and `eastKm` to the east of it, measured the way the corridor
 * measures: perpendicular to the great circle.
 *
 * The right spherical triangle with the pole N, the foot F on the meridian
 * and the point P: FP = xt is the offset, NF = 90° − φf, and so
 *   sin φ = sin φf · cos xt        tan Δλ = tan xt / cos φf.
 * Written out here, not borrowed from corridor.ts.
 */
function onMeridian(
  lon0: number,
  lat0: number,
  alongKm: number,
  eastKm = 0,
): [number, number] {
  const phiF = rad(lat0 + (alongKm * 1000) / DEGREE_M);
  if (eastKm === 0) return [lon0, deg(phiF)];
  const xt = (eastKm * 1000) / R;
  return [
    lon0 + deg(Math.atan(Math.tan(xt) / Math.cos(phiF))),
    deg(Math.asin(Math.sin(phiF) * Math.cos(xt))),
  ];
}

interface Spot {
  slug: string;
  country?: string;
  tags?: Record<string, string>;
  stars?: number;
  lon: number;
  lat: number;
}

async function put(s: Spot): Promise<void> {
  await db.query(
    `INSERT INTO camping_spots (slug, country, region, amenities, location, stars)
     VALUES ($1, $2, 'Region', $3::jsonb,
             ST_SetSRID(ST_MakePoint($4, $5), 4326), $6)`,
    [
      s.slug,
      s.country ?? 'HR',
      JSON.stringify(mapAmenities(s.tags ?? {})),
      s.lon,
      s.lat,
      s.stars ?? null,
    ],
  );
}

/** Every corridor below is six degrees due north: 667 170.48 m. */
const LAT0 = 40;
const LAT1 = 46;
const LENGTH_M = 667_170.48;
const EVEN_M = LENGTH_M / 7; // 95 310.07 m

const corridorOf = (lon: number) => ({
  from: [lon, LAT0] as [number, number],
  to: [lon, LAT1] as [number, number],
});

const FULL = { power_supply: 'yes', sanitary_dump_station: 'yes' };

/** A campsite `alongKm` along corridor `lon`, `eastKm` beside it. */
async function putAt(
  lon: number,
  slug: string,
  alongKm: number,
  over: Partial<Spot> & { eastKm?: number } = {},
): Promise<void> {
  const { eastKm, ...rest } = over;
  const [x, y] = onMeridian(lon, LAT0, alongKm, eastKm ?? 0);
  await put({ slug, lon: x, lat: y, ...rest });
}

// ---------------------------------------------------------------------------
// The fixture, as a table. Corridors are on different meridians, 10° apart
// (about 850 km), so none sees another's rows.
//
//   lon 10  THE CLEAN CASE. Seven days, six nights at k × 95.31 km.
//           gold-1..6   on the even cuts, 0 km beside the line, every
//                       amenity yes, five stars: the best night there is
//                       for each k, so they are THE answer, by construction
//           plain-1..6  on the even cuts, no tags, no stars
//           near-k-/+   25 km before and after each cut, no tags (12)
//           out-east    50 km beside the line, at the third cut, every
//                       amenity yes: outside the 30 km corridor, never seen
//           in the corridor: 6 + 6 + 12 = 24
//
//   lon 20  THE TRAP. The only land in 118..340 km is one town: ten campsites
//           within 4 km, every amenity, five stars, midway between two even
//           cuts (190.6 and 285.9) so that it is the best night for two of
//           them.
//           f-20 .. f-100, f-118 and f-340 .. f-660, no tags:     6 + 17
//           town-01..10   236.0 .. 239.6 km                          10
//           in the corridor: 33
//
//   lon 30  NEEDS. One night, 333.6 km out.
//           n-no    on the cut, power_supply=no
//           n-unk   10 km past it, no tags
//           n-yes   80 km before it, power_supply=yes
//
//   lon 40  COUNTRIES. c-hr on the cut (HR), c-it 10 km past it (IT).
//
//   lon 50  ONE OFF THE LINE: one-off at (50.1, 43.0), the point whose
//           position the corridor spec pins: 333 590.08 m along, 8 132.29 m
//           to the side.
//
//   lon 60  A CHAIN THAT RUNS OUT. d-20 .. d-200, every 20 km, no tags (10).
//
//   lon 70  WEIGHTS. One night. w-near on the cut, no tags; w-power 30 km
//           past it, power_supply=yes.
//
//   lon 90  BESIDE THE LINE. One night. b-on is on the line, 1 km past the
//           cut; a-beside is ON the cut, 20 km to the side. No tags. By
//           distance along the line alone a-beside is the nearer; by
//           distance from the cut b-on is (1 km against 20).
//
//   lon 100 THE EVEN SPLIT. No tags anywhere, so only position counts.
//           cut-1..6 on the even cuts; off-k-minus and off-k-plus 25 km
//           either side of each cut. The answer is cut-1..6 by
//           construction: distance 0 from its cut is the most any night can
//           be worth, and nothing here has an amenity to offset it.
// ---------------------------------------------------------------------------

async function buildFixture(): Promise<void> {
  // Anchor on the PRODUCER: if the mapper stopped reading these tags the
  // table above would be a fiction.
  expect(mapAmenities(FULL).electricity).toBe('yes');
  expect(mapAmenities(FULL).greyWater).toBe('yes');
  expect(mapAmenities({ power_supply: 'no' }).electricity).toBe('no');
  expect(mapAmenities({}).electricity).toBe('unknown');

  const evenKm = EVEN_M / 1000;

  for (let k = 1; k <= 6; k++) {
    await putAt(10, `gold-${k}`, k * evenKm, { tags: FULL, stars: 5 });
    await putAt(10, `plain-${k}`, k * evenKm);
    await putAt(10, `near-${k}-minus`, k * evenKm - 25);
    await putAt(10, `near-${k}-plus`, k * evenKm + 25);
  }
  await putAt(10, 'out-east', 3 * evenKm, { tags: FULL, eastKm: 50 });

  for (const km of [20, 40, 60, 80, 100, 118]) {
    await putAt(20, `f-${km}`, km);
  }
  for (let km = 340; km <= 660; km += 20) await putAt(20, `f-${km}`, km);
  for (let i = 0; i < 10; i++) {
    await putAt(20, `town-${String(i + 1).padStart(2, '0')}`, 236 + i * 0.4, {
      tags: FULL,
      stars: 5,
    });
  }

  await putAt(30, 'n-no', LENGTH_M / 2000, { tags: { power_supply: 'no' } });
  await putAt(30, 'n-unk', LENGTH_M / 2000 + 10);
  await putAt(30, 'n-yes', LENGTH_M / 2000 - 80, {
    tags: { power_supply: 'yes' },
  });

  await putAt(40, 'c-hr', LENGTH_M / 2000, { country: 'HR' });
  await putAt(40, 'c-it', LENGTH_M / 2000 + 10, { country: 'IT' });

  await put({ slug: 'one-off', lon: 50.1, lat: 43 });

  for (let km = 20; km <= 200; km += 20) await putAt(60, `d-${km}`, km);

  await putAt(90, 'b-on', LENGTH_M / 2000 + 1);
  await putAt(90, 'a-beside', LENGTH_M / 2000, { eastKm: 20 });

  for (let k = 1; k <= 6; k++) {
    await putAt(100, `cut-${k}`, k * evenKm);
    await putAt(100, `off-${k}-minus`, k * evenKm - 25);
    await putAt(100, `off-${k}-plus`, k * evenKm + 25);
  }

  await putAt(70, 'w-near', LENGTH_M / 2000);
  await putAt(70, 'w-power', LENGTH_M / 2000 + 30, {
    tags: { power_supply: 'yes' },
  });
}

// ---------------------------------------------------------------------------
// Reading results
// ---------------------------------------------------------------------------

const BAND = { minM: 60_000, maxM: 120_000 };

const week = (lon: number, over: Partial<ItineraryRequest> = {}) =>
  ({
    ...corridorOf(lon),
    days: 7,
    band: BAND,
    bufferM: 30_000,
    ...over,
  }) as ItineraryRequest;

async function plan(
  req: ItineraryRequest,
  deps?: Parameters<typeof planItinerary>[2],
) {
  return planItinerary(db, req, deps);
}

/** The delivered nights' slugs, or a failure that shows the outcome. */
async function nightsOf(
  req: ItineraryRequest,
  deps?: Parameters<typeof planItinerary>[2],
): Promise<string[]> {
  const r = await plan(req, deps);
  if (r.status !== 'ok') throw new Error(`not ok: ${JSON.stringify(r)}`);
  return r.days.flatMap((d) => (d.night ? [d.night.slug] : []));
}

/**
 * The smallest distance between ANY two of these campsites, in metres, read
 * from PostGIS: a geography on the spheroid. Not from `corridor.ts`.
 */
async function minGapM(slugs: string[]): Promise<number> {
  const r = await db.query(
    `SELECT min(ST_Distance(a.location::geography, b.location::geography)) AS m
       FROM camping_spots a JOIN camping_spots b ON a.slug < b.slug
      WHERE a.slug = ANY($1) AND b.slug = ANY($1)`,
    [slugs],
  );
  const m = r.rows[0].m;
  if (m === null) throw new Error(`no pair among ${JSON.stringify(slugs)}`);
  return Number(m);
}

// ---------------------------------------------------------------------------

describe('seven days over 667 km: the clean case', () => {
  const req = week(10);

  it('anchors: the corridor is 667 170 m, the even run 95 310 m, and 24 campsites are in it', async () => {
    const r = await plan(req);
    if (r.status !== 'ok') throw new Error(`not ok: ${JSON.stringify(r)}`);
    expect(r.lengthM).toBeCloseTo(LENGTH_M, 0);
    expect(EVEN_M).toBeCloseTo(95_310.07, 1);
    // 6 gold + 6 plain + 12 near; out-east is 50 km to the side of a 30 km corridor.
    expect(r.candidates).toBe(24);
  });

  it('places six nights: gold-1 .. gold-6, the best campsite at each even cut', async () => {
    expect(await nightsOf(req)).toEqual([
      'gold-1',
      'gold-2',
      'gold-3',
      'gold-4',
      'gold-5',
      'gold-6',
    ]);
  });

  it('seven days, the last of them ending at B with no night', async () => {
    const r = await plan(req);
    if (r.status !== 'ok') throw new Error('not ok');
    expect(r.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.days.map((d) => d.night === null)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it('every run is 95 310.07 m and they add up to the corridor', async () => {
    const r = await plan(req);
    if (r.status !== 'ok') throw new Error('not ok');
    for (const d of r.days) expect(d.runM).toBeCloseTo(95_310.07, 0);
    const sum = r.days.reduce((s, d) => s + d.runM, 0);
    expect(sum).toBeCloseTo(r.lengthM, 6);
  });

  it('🔴 no two nights are closer than 94 000 m: the smallest gap, from PostGIS', async () => {
    const slugs = await nightsOf(req);
    expect(slugs).toHaveLength(6);
    expect(await minGapM(slugs)).toBeGreaterThanOrEqual(94_000);
  });

  it('what is shown of a night is what was recorded: the amenities, five stars, where it is', async () => {
    const r = await plan({ ...req, needs: ['electricity', 'greyWater'] });
    if (r.status !== 'ok') throw new Error('not ok');
    const n = r.days[0].night;
    expect(n?.slug).toBe('gold-1');
    expect(n?.country).toBe('HR');
    expect(n?.stars).toBe(5);
    expect(n?.amenities.electricity).toBe('yes');
    expect(n?.needs).toEqual([
      { key: 'electricity', state: 'yes' },
      { key: 'greyWater', state: 'yes' },
    ]);
    expect(n?.lon).toBeCloseTo(10, 9);
    expect(n?.offsetM).toBeLessThan(1);
    // 0.75 for being on the cut, 0.1 + 0.1 for the two hook-ups, 0.05 for
    // five stars: the most a night can be worth.
    expect(n?.score).toBeCloseTo(1, 6);
  });

  it('a campsite outside the corridor is never a night, however good', async () => {
    expect(await nightsOf(req)).not.toContain('out-east');
  });
});

describe('🔴 one input, one answer', () => {
  it('twice over the same table: the same text, byte for byte', async () => {
    const a = JSON.stringify(await plan(week(10)));
    const b = JSON.stringify(await plan(week(10)));
    expect(a).toBe(b);
    // Anchor: it was an answer, not two identical refusals.
    expect(JSON.parse(a).status).toBe('ok');
  });

  it('the trap too, which has real ties between near-identical campsites', async () => {
    const a = JSON.stringify(await plan(week(20)));
    const b = JSON.stringify(await plan(week(20)));
    expect(a).toBe(b);
    expect(JSON.parse(a).status).toBe('ok');
  });
});

describe('🔴 seven days, six stops in one place', () => {
  // Between 120 and 340 km there is one town and nothing else: ten campsites
  // within 4 km of each other, every amenity, five stars — each worth far
  // more than any filler. A programme that could put two nights in the town
  // would. The runs are at least 60 km, so it can put one.
  const req = week(20);

  it('anchors: the town and the fillers are all candidates (33), and the town is on the answer', async () => {
    const r = await plan(req);
    if (r.status !== 'ok') throw new Error(`not ok: ${JSON.stringify(r)}`);
    expect(r.candidates).toBe(33);
    const slugs = r.days.flatMap((d) => (d.night ? [d.night.slug] : []));
    expect(slugs.filter((s) => s.startsWith('town-'))).toHaveLength(1);
  });

  it('uses exactly one campsite of the town', async () => {
    const slugs = await nightsOf(req);
    expect(slugs.filter((s) => s.startsWith('town-'))).toHaveLength(1);
    expect(slugs).toHaveLength(6);
  });

  it('no two nights are closer than 59 400 m: 60 km less what the spheroid takes off, from PostGIS', async () => {
    const slugs = await nightsOf(req);
    expect(await minGapM(slugs)).toBeGreaterThanOrEqual(59_400);
  });
});

describe('a refusal says what it is', () => {
  it('two days over 667 km cannot be done in runs of at most 120 km, and no campsite is asked', async () => {
    // A database that throws when touched: the band is checked first.
    const untouchable = {
      query: () => {
        throw new Error('the database was asked');
      },
    };
    const r = await planItinerary(untouchable, week(10, { days: 2 }));
    expect(r).toMatchObject({
      status: 'infeasible',
      reason: 'band',
      measure: 'straight',
      daysAsked: 2,
      reachM: { minM: 120_000, maxM: 240_000 },
    });
    if (r.status !== 'infeasible' || r.reason !== 'band') throw new Error();
    expect(r.lengthM).toBeCloseTo(LENGTH_M, 0);
  });

  it('campsites that do not chain across the corridor: three nights placed, the fourth has nowhere to go', async () => {
    // Land only to 200 km: ten campsites. A chain of 60-km runs reaches
    // 60, 120, 180 and then 240, where there is nothing.
    const r = await plan(week(60));
    expect(r).toEqual({
      status: 'infeasible',
      reason: 'no-chain',
      measure: 'straight',
      lengthM: expect.closeTo(LENGTH_M, 0),
      daysAsked: 7,
      candidates: 10,
      reachedNights: 3,
    });
  });

  it('a round trip has no direction to cut, and the database is not asked', async () => {
    const untouchable = {
      query: () => {
        throw new Error('the database was asked');
      },
    };
    const r = await planItinerary(untouchable, {
      ...week(10),
      to: [10, LAT0],
    });
    expect(r).toEqual({ status: 'unsupported', reason: 'round-trip' });
  });

  it('a corridor with no campsite in it is a refusal with the number zero, not a made-up route', async () => {
    const r = await plan(week(80));
    expect(r).toMatchObject({
      status: 'infeasible',
      reason: 'no-chain',
      candidates: 0,
      reachedNights: 0,
    });
  });
});

describe('only what is recorded as `no` is turned away', () => {
  // One night, 333.6 km out, runs 300..400 km.
  const one = (over: Partial<ItineraryRequest> = {}) =>
    week(30, { days: 2, band: { minM: 300_000, maxM: 400_000 }, ...over });

  it('without a need: the campsite on the cut wins, whatever it says about power', async () => {
    const r = await plan(one());
    if (r.status !== 'ok') throw new Error('not ok');
    expect(r.candidates).toBe(3);
    expect(r.days[0].night?.slug).toBe('n-no');
  });

  it('asked for electricity: the recorded `no` is out, the unknown stays and says so', async () => {
    const r = await plan(one({ needs: ['electricity'] }));
    if (r.status !== 'ok') throw new Error('not ok');
    expect(r.candidates).toBe(2);
    expect(r.days[0].night?.slug).toBe('n-unk');
    expect(r.days[0].night?.needs).toEqual([
      { key: 'electricity', state: 'unknown' },
    ]);
  });

  it('a request for a country keeps to it', async () => {
    const hr = await plan(
      week(40, { days: 2, band: { minM: 300_000, maxM: 400_000 } }),
    );
    if (hr.status !== 'ok') throw new Error('not ok');
    expect(hr.candidates).toBe(2);
    expect(hr.days[0].night?.slug).toBe('c-hr');
    const it_ = await plan(
      week(40, {
        days: 2,
        band: { minM: 300_000, maxM: 400_000 },
        countries: ['it'],
      }),
    );
    if (it_.status !== 'ok') throw new Error('not ok');
    expect(it_.candidates).toBe(1);
    expect(it_.days[0].night?.slug).toBe('c-it');
  });
});

describe('the side of the line counts, not only the distance along it', () => {
  it('1 km past the cut on the line beats ON the cut 20 km beside it', async () => {
    const r = await plan(
      week(90, { days: 2, band: { minM: 300_000, maxM: 400_000 } }),
    );
    if (r.status !== 'ok') throw new Error(`not ok: ${JSON.stringify(r)}`);
    expect(r.candidates).toBe(2);
    expect(r.days[0].night?.slug).toBe('b-on');
  });
});

describe('the even split: with nothing to choose on but place, the nights are on the cuts', () => {
  it('anchors: 18 campsites in the corridor, none with an amenity or a rating', async () => {
    const r = await plan(week(100));
    if (r.status !== 'ok') throw new Error(`not ok: ${JSON.stringify(r)}`);
    expect(r.candidates).toBe(18);
    expect(r.days.flatMap((d) => (d.night ? [d.night.stars] : []))).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('cut-1 .. cut-6: night k is on the k-th cut, not the first one', async () => {
    expect(await nightsOf(week(100))).toEqual([
      'cut-1',
      'cut-2',
      'cut-3',
      'cut-4',
      'cut-5',
      'cut-6',
    ]);
  });

  it('and each is worth 0.775: 0.75 for the cut, 0.025 for an unrated one at the middle of the scale', async () => {
    const r = await plan(week(100));
    if (r.status !== 'ok') throw new Error('not ok');
    for (const d of r.days.slice(0, 6)) {
      expect(d.night?.score).toBeCloseTo(0.775, 6);
    }
  });
});

describe('where a night is, as the table has it', () => {
  it('a campsite 0.1° east of the meridian, at 43°N: 333 590.08 m along, 8 132.29 m beside it', async () => {
    const r = await plan(
      week(50, { days: 2, band: { minM: 100_000, maxM: 600_000 } }),
    );
    if (r.status !== 'ok') throw new Error(`not ok: ${JSON.stringify(r)}`);
    const n = r.days[0].night;
    expect(n?.slug).toBe('one-off');
    expect(n?.alongM).toBeCloseTo(333_590.08, 0);
    expect(n?.offsetM).toBeCloseTo(8_132.29, 0);
    expect(r.days[0].runM).toBeCloseTo(333_590.08, 0);
    expect(r.days[1].runM).toBeCloseTo(333_580.4, 0);
  });
});

describe('🔴 distances are straight lines, and say so', () => {
  it('every day, and the outcome, carry the word', async () => {
    const r = await plan(week(10));
    if (r.status !== 'ok') throw new Error('not ok');
    expect(r.measure).toBe('straight');
    for (const d of r.days) expect(d.measure).toBe('straight');
  });

  it('a refusal carries it too', async () => {
    const r = await plan(week(60));
    if (r.status !== 'infeasible') throw new Error('not infeasible');
    expect(r.measure).toBe('straight');
  });

  it('the outcome has exactly these members, and no time among them', async () => {
    const r = await plan(week(10));
    if (r.status !== 'ok') throw new Error('not ok');
    expect(Object.keys(r).sort()).toEqual([
      'candidates',
      'days',
      'lengthM',
      'measure',
      'status',
    ]);
    expect(Object.keys(r.days[0]).sort()).toEqual([
      'day',
      'measure',
      'night',
      'runM',
    ]);
    expect(Object.keys(r.days[0].night ?? {}).sort()).toEqual([
      'alongM',
      'amenities',
      'country',
      'lat',
      'lon',
      'needs',
      'offsetM',
      'score',
      'slug',
      'stars',
    ]);
  });
});

describe('🔴 the seam: another source of distances, the same planner', () => {
  // What a router-backed provider would be, in miniature: the same line, but
  // every distance 1.5 times as long, and the word 'road'.
  const road: CorridorProvider = async (r) => {
    const base: Corridor = await straightCorridor(r);
    return {
      line: base.line,
      metres: base.metres * 1.5,
      measure: 'road' as unknown as 'straight',
      locate: (p) => {
        const at = base.locate(p);
        return { along: at.along * 1.5, offset: at.offset };
      },
    };
  };
  const wide = { minM: 90_000, maxM: 180_000 };

  it('the nights follow the other source: the same six, every run 1.5 times as long', async () => {
    const r = await plan(week(10, { band: wide }), { corridor: road });
    if (r.status !== 'ok') throw new Error(`not ok: ${JSON.stringify(r)}`);
    expect(r.days.flatMap((d) => (d.night ? [d.night.slug] : []))).toEqual([
      'gold-1',
      'gold-2',
      'gold-3',
      'gold-4',
      'gold-5',
      'gold-6',
    ]);
    expect(r.lengthM).toBeCloseTo(1_000_755.72, 0);
    for (const d of r.days) expect(d.runM).toBeCloseTo(142_965.1, 0);
  });

  it('and the word comes from the source, not from this file', async () => {
    const r = await plan(week(10, { band: wide }), { corridor: road });
    if (r.status !== 'ok') throw new Error('not ok');
    expect(r.measure).toBe('road');
    for (const d of r.days) expect(d.measure).toBe('road');
  });

  it('the band is read in the source’s own metres: the straight band refuses the stretched corridor', async () => {
    // 1 000 756 m in seven runs of at most 120 000 m cannot be done.
    const r = await plan(week(10), { corridor: road });
    expect(r).toMatchObject({ status: 'infeasible', reason: 'band' });
  });
});

describe('the weights are the ones handed over', () => {
  // One night, 333.6 km out. w-near is on the cut; w-power is 30 km past it
  // and has a recorded electric hook-up. The shipped weights say the hook-up
  // is worth more than 30 km of a 333 km tolerance; a re-weighing the
  // coverage rule PERMITS (no weight on electricity) says it is not.
  const one = week(70, { days: 2, band: { minM: 300_000, maxM: 400_000 } });
  const snapshot = JSON.parse(
    readFileSync(join(__dirname, 'coverage.snapshot.json'), 'utf8'),
  ) as CoverageSnapshot;
  const reweigh = (w: Record<string, number>): ComponentDef[] =>
    COMPONENTS.map((c) => ({ ...c, weight: w[c.id] }));

  it('the shipped weights: the hook-up wins', async () => {
    expect(await nightsOf(one)).toEqual(['w-power']);
    expect(await nightsOf(one, { scoring: loadMeasuredScoring() })).toEqual([
      'w-power',
    ]);
  });

  it('weights with nothing on electricity: the campsite on the cut wins', async () => {
    const other = loadScoring(
      reweigh({
        distance_fit: 0.9,
        electricity: 0,
        greyWater: 0.05,
        stars: 0.05,
      }),
      snapshot,
    );
    expect(await nightsOf(one, { scoring: other })).toEqual(['w-near']);
  });
});

describe('a request that is not a question throws', () => {
  it.each([
    ['no days', { days: 0 }, /days/],
    ['half a day', { days: 1.5 }, /days/],
    ['more days than the page allows', { days: MAX_DAYS + 1 }, /days/],
    ['zero minM', { band: { minM: 0, maxM: 120_000 } }, /minM/],
    ['maxM below minM', { band: { minM: 120_000, maxM: 60_000 } }, /maxM/],
    ['no band', { band: undefined }, /minM/],
    ['no buffer', { bufferM: 0 }, /bufferM/],
    [
      'a corridor wider than routes/near ever looks',
      { bufferM: 60_001 },
      /bufferM must be at most 60000/,
    ],
    ['a place that is not a place', { from: [10, 99] }, /not a \[lon, lat\]/],
    ['an amenity we do not record', { needs: ['wifii'] }, /needs/],
    ['an empty list of countries', { countries: [] }, /countries/],
    ['a country outside the Union', { countries: ['us'] }, /countries/],
  ])('%s', async (_, over, msg) => {
    await expect(
      plan({ ...week(10), ...over } as unknown as ItineraryRequest),
    ).rejects.toThrow(msg);
  });
});

describe('the measuring script, against this table', () => {
  // measure-itinerary.ts reads the gap between nights from PostGIS and exits 1
  // on a gap below the band. Its own SQL runs here, on rows with known places.
  it('measures the clean case: six real nights, a gap read from PostGIS, nothing wrong', async () => {
    const [t] = await measureTrips(
      db,
      [{ name: 'clean', from: [10, 40], to: [10, 46] }],
      2,
    );
    expect(t.status).toBe('ok');
    expect(t.nights).toEqual([
      'gold-1',
      'gold-2',
      'gold-3',
      'gold-4',
      'gold-5',
      'gold-6',
    ]);
    expect(t.ms).toHaveLength(2);
    // Runs of 0.5 to 1.5 of 95.3 km: a floor of 47 655 m.
    expect(t.minM).toBeCloseTo(47_655.04, 0);
    expect(t.minGapM).toBeGreaterThanOrEqual(94_000);
    expect(problemsOf({ trips: [t], dp: [] })).toEqual([]);
  });

  it('a trip with no campsite under it is a refusal, and a run of nothing else is a failure', async () => {
    const [t] = await measureTrips(
      db,
      [{ name: 'empty', from: [80, 40], to: [80, 46] }],
      1,
    );
    expect(t.status).toBe('infeasible');
    expect(t.reason).toBe('no-chain');
    expect(t.candidates).toBe(0);
    expect(problemsOf({ trips: [t], dp: [] })).toHaveLength(1);
  });
});

describe('the widest corridor allowed is allowed', () => {
  it('60 000 m to either side is the edge, and it plans', async () => {
    expect(MAX_BUFFER_M).toBe(60_000);
    const r = await plan(week(10, { bufferM: MAX_BUFFER_M }));
    expect(r.status).toBe('ok');
  });
});

describe('the page and the planner agree on how many days', () => {
  it('MAX_DAYS is the one apps/web/src/lib/plan.ts has', () => {
    const page = readFileSync(
      join(__dirname, '../../../web/src/lib/plan.ts'),
      'utf8',
    );
    const m = /export const MAX_DAYS = (\d+);/.exec(page);
    // Anchor: the page still declares it where this reads.
    expect(m).not.toBeNull();
    expect(MAX_DAYS).toBe(Number(m?.[1]));
  });
});
