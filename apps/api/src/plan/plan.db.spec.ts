/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { mapAmenities } from '../osm/tag-mapping';
import { PlanModule } from './plan.module';

// CAMP-391 — `POST /plan` over a REAL PostgreSQL, through the real controller,
// the real service and Nest's own wiring (`PlanModule` + `TypeOrmModule`): the
// request goes in as JSON over a socket and comes out as JSON.
//
// 🔴 THE CORPUS DOES NOT SHARE A FIELD WITH WHAT IT MEASURES (the rule of
// itinerary.db.spec.ts, kept). The campsites are PLACED on a meridian with a
// closed-form spherical triangle written out below, so "the third night falls
// 250 km along" is a statement about where the row was put, not something read
// back from corridor.ts. The country boundaries are four boxes drawn by hand
// in this file: which side of an edge a point is on is a fact of the numbers
// here, not of the route-POI importer's SQL that the service reuses. The one
// distance asked of the answer — how long the trip is — is read from PostGIS
// on a spheroid, where the code under test uses a sphere.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP (the same convention as the
// planner's other DB specs): CAMP_TEST_DATABASE_URL, or CI_DATABASE_URL in CI.
// This file creates its own `camp391_*` database and drops it.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;
let app: INestApplication;
let base: string;
let dataSource: DataSource;

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp391_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  // Only the columns the planner's queries read, with the types the real
  // tables have (the precedent of itinerary.db.spec.ts), plus `ne_admin1`,
  // which the country check reads.
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
      context jsonb NOT NULL DEFAULT '{}',
      sources jsonb NOT NULL DEFAULT '[]',
      missing_since timestamptz);
    CREATE TABLE spot_links (
      primary_id uuid NOT NULL, secondary_id uuid NOT NULL,
      unlinked_at timestamptz, created_at timestamptz DEFAULT now());
    CREATE INDEX camping_spots_location_gist ON camping_spots USING gist (location);
    CREATE TABLE ne_admin1 (
      ogc_fid serial PRIMARY KEY,
      geom geometry(MultiPolygon, 4326),
      name varchar(44), name_en varchar(47), admin varchar(36),
      iso_a2 varchar(2), iso_3166_2 varchar(8), type_en varchar(27));
    CREATE INDEX ne_admin1_geom_gist ON ne_admin1 USING gist (geom);`);
  await buildFixture();

  const moduleRef = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'postgres',
        url: url.toString(),
        entities: [],
        synchronize: false,
      }),
      PlanModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0);
  base = await app.getUrl();
  dataSource = app.get(DataSource);
});

afterAll(async () => {
  await app?.close();
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

// ---------------------------------------------------------------------------
// The countries: four boxes, by hand
// ---------------------------------------------------------------------------

/** [west, south, east, north], degrees. */
const BOXES: Array<[string, string, [number, number, number, number]]> = [
  // Two members, side by side, the corridors below run through the first.
  ['HR', 'Croatia', [13.0, 42.0, 19.5, 46.6]],
  ['SI', 'Slovenia', [13.0, 46.6, 16.6, 47.4]],
  // Åland, which the source writes `AX` and which is Finland.
  ['AX', 'Åland', [19.5, 59.8, 21.0, 60.6]],
  // Two that are not in the Union.
  ['CH', 'Switzerland', [5.0, 45.8, 10.0, 47.8]],
  ['GB', 'United Kingdom', [-8.0, 50.0, 2.0, 59.0]],
];

async function drawCountries(): Promise<void> {
  for (const [iso, admin1, [w, s, e, n]] of BOXES) {
    await db.query(
      `INSERT INTO ne_admin1 (geom, name, name_en, admin, iso_a2)
       VALUES (ST_Multi(ST_MakeEnvelope($1, $2, $3, $4, 4326)), $5, $5, $5, $6)`,
      [w, s, e, n, admin1, iso],
    );
  }
}

// ---------------------------------------------------------------------------
// Placing campsites
// ---------------------------------------------------------------------------

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
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
  const phiF = rad(lat0) + (alongKm * 1000) / R;
  if (eastKm === 0) return [lon0, deg(phiF)];
  const xt = (eastKm * 1000) / R;
  return [
    lon0 + deg(Math.atan(Math.tan(xt) / Math.cos(phiF))),
    deg(Math.asin(Math.sin(phiF) * Math.cos(xt))),
  ];
}

interface Spot {
  slug: string;
  sources?: unknown[];
  name?: string | null;
  tags?: Record<string, string>;
  stars?: number;
  lon: number;
  lat: number;
}

async function put(s: Spot): Promise<void> {
  await db.query(
    `INSERT INTO camping_spots (slug, name, country, region, amenities, location, stars, sources)
     VALUES ($1, $2, 'HR', 'Region', $3::jsonb,
             ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7::jsonb)`,
    [
      s.slug,
      s.name === undefined ? `Camp ${s.slug}` : s.name,
      JSON.stringify(mapAmenities(s.tags ?? {})),
      s.lon,
      s.lat,
      s.stars ?? null,
      JSON.stringify(s.sources ?? []),
    ],
  );
}

async function putAt(
  lon: number,
  lat0: number,
  slug: string,
  alongKm: number,
  over: Partial<Spot> & { eastKm?: number } = {},
): Promise<void> {
  const { eastKm, ...rest } = over;
  const [x, y] = onMeridian(lon, lat0, alongKm, eastKm ?? 0);
  await put({ slug, lon: x, lat: y, ...rest });
}

/**
 * Three degrees due north from 43°N on 15°E: 333 585 m of arc, in four days.
 * The even day is 83.4 km and the band the entry derives is 0.5 to 1.5 of it.
 */
const LON = 15;
const LAT0 = 43;
const LAT1 = 46;
const LENGTH_KM = (3 * DEGREE_M) / 1000;
const EVEN_KM = LENGTH_KM / 4;

const FULL = { power_supply: 'yes', sanitary_dump_station: 'yes' };

// ---------------------------------------------------------------------------
// The fixture
//
//   lon 15  THE PLAN. Four days, three nights, 43°N to 46°N.
//           gold-1..3   on the even cuts, every amenity yes, five stars,
//                       named: the best night there is for each k
//           plain-1..3  on the even cuts, no tags
//           near-k-/+   25 km before and after each cut, no tags (6)
//           in the corridor: 3 + 3 + 6 = 12
//
//   lon 16  A NIGHT NOBODY NAMED. 43°N to 45°N, two days, one night. The
//           only campsite there is on the cut, and has no name.
//
//   lon 17  OPEN WATER: nothing at all along 43°N to 45°N.
//
//   lon 18  THE WIDTH OF THE CORRIDOR. 43°N to 46°N, four days. At each cut
//           side-k is 20 km to the east (inside 30 km) and wide-k is 40 km to
//           the east (outside it). Only the first three can be nights.
//
//   lon 14  A CAMPSITE THAT IS TWO ROWS. 43°N to 45°N, two days, one night. The
//           only candidate is `linked-primary` (OSM: no name, no stars) at the
//           cut, with a hidden secondary beside it (DATAtourisme: a name and
//           4 stars). The night's name, stars and CREDIT come through the link.
//
//   lon 19  A SECONDARY THAT GIVES NOTHING THE PLAN SHOWS. The same shape, but
//           the primary has its own name (and the owner's correction of it) and
//           the secondary only a website: its source is not credited for what
//           was not used.
//
//   lon 13.5 A LINK THAT WAS WITHDRAWN. A primary with nothing, and a secondary
//           (far away) with a name and stars that is no longer linked to it.
//
// And the boundaries: HR and SI (members), AX (Åland, Finland), CH and GB
// (not members) — four boxes, above.
// ---------------------------------------------------------------------------

async function buildFixture(): Promise<void> {
  // Anchor on the PRODUCER: if the mapper stopped reading these tags the
  // table above would be a fiction.
  expect(mapAmenities(FULL).electricity).toBe('yes');
  expect(mapAmenities(FULL).greyWater).toBe('yes');

  await drawCountries();
  for (let k = 1; k <= 3; k++) {
    await putAt(LON, LAT0, `gold-${k}`, k * EVEN_KM, {
      tags: FULL,
      stars: 5,
      name: `Gold ${k}`,
      // As the importers write them (`id`, `ref`, `updatedAt`, `fields`): two
      // sources on the first, one on the others, so a night's list is its own.
      sources:
        k === 1
          ? [
              {
                id: 'osm',
                ref: 'n1',
                updatedAt: '2026-10-19',
                fields: ['name'],
              },
              {
                id: 'datatourisme',
                ref: 'https://data.datatourisme.fr/28/gold',
                updatedAt: '2005-08-24',
                fields: ['stars'],
              },
            ]
          : [
              {
                id: 'osm',
                ref: `n${k}`,
                updatedAt: '2026-10-19',
                fields: ['name'],
              },
            ],
    });
    await putAt(LON, LAT0, `plain-${k}`, k * EVEN_KM);
    await putAt(LON, LAT0, `near-${k}-minus`, k * EVEN_KM - 25);
    await putAt(LON, LAT0, `near-${k}-plus`, k * EVEN_KM + 25);
  }
  await putAt(16, LAT0, 'nameless', (2 * DEGREE_M) / 2000, { name: null });
  await putLinked();
  for (let k = 1; k <= 3; k++) {
    await putAt(18, LAT0, `side-${k}`, k * EVEN_KM, { eastKm: 20 });
    await putAt(18, LAT0, `wide-${k}`, k * EVEN_KM, { eastKm: 40 });
  }
}

const OSM = (ref: string) => ({
  id: 'osm',
  ref,
  updatedAt: '2026-10-19',
  fields: ['name', 'location', 'amenities'],
});

/** A primary and the secondary linked behind it, as the matcher leaves them. */
async function putLinked(): Promise<void> {
  const row = async (
    slug: string,
    lon: number,
    name: string | null,
    stars: number | null,
    sources: unknown[],
    overrides: Record<string, unknown> = {},
    lat = LAT0,
  ): Promise<string> => {
    const [x, y] = onMeridian(lon, lat, DEGREE_M / 1000);
    const r = await db.query(
      `INSERT INTO camping_spots (slug, name, country, region, location, stars, sources, owner_overrides)
       VALUES ($1, $2, 'HR', 'Region', ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6::jsonb, $7::jsonb)
       RETURNING id`,
      [
        slug,
        name,
        x,
        y,
        stars,
        JSON.stringify(sources),
        JSON.stringify(overrides),
      ],
    );
    return r.rows[0].id as string;
  };
  const link = (primary: string, secondary: string, unlinked = false) =>
    db.query(
      `INSERT INTO spot_links (primary_id, secondary_id, unlinked_at)
       VALUES ($1, $2, ${unlinked ? 'now()' : 'NULL'})`,
      [primary, secondary],
    );

  const p1 = await row('linked-primary', 14, null, null, [OSM('n10')]);
  const s1 = await row('linked-secondary', 14, 'Linked Name', 4, [
    {
      id: 'datatourisme',
      ref: 'https://data.datatourisme.fr/28/linked',
      updatedAt: '2005-08-24',
      fields: ['stars', 'name', 'website', 'location'],
    },
  ]);
  await link(p1, s1);

  // The owner has corrected the name (CAMP-86): the page shows the correction.
  const p2 = await row('plain-primary', 19, 'Own Name', null, [OSM('n20')], {
    name: 'Owner Name',
  });
  const s2 = await row('plain-secondary', 19, null, null, [
    {
      id: 'datatourisme',
      ref: 'https://data.datatourisme.fr/28/plain',
      updatedAt: '2011-02-03',
      fields: ['website'],
    },
  ]);
  await link(p2, s2);

  // A link that was undone: the matcher withdrew it (`unlinked_at`), so the
  // other row is a stranger again and lends this one nothing. It lies far from
  // the corridor, so it is not a candidate either.
  const p3 = await row('unlinked-primary', 13.5, null, null, [OSM('n30')]);
  const s3 = await row(
    'unlinked-secondary',
    13.5,
    'Withdrawn Name',
    3,
    [
      {
        id: 'datatourisme',
        ref: 'https://data.datatourisme.fr/28/gone',
        updatedAt: '2009-09-09',
        fields: ['stars', 'name'],
      },
    ],
    {},
    LAT0 + 4,
  );
  await link(p3, s3, true);
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

interface Reply {
  status: number;
  text: string;
  json: any;
}

async function ask(body: unknown): Promise<Reply> {
  const res = await fetch(base + '/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

const point = (lon: number, lat: number) => ({ lat, lon });

const PLAN_LON15 = {
  from: point(LON, LAT0),
  to: point(LON, LAT1),
  days: 4,
};

describe('🔴 a trip with real coordinates comes back as a plan', () => {
  let r: Reply;
  beforeAll(async () => {
    r = await ask(PLAN_LON15);
  });

  it('is 200 and ok', () => {
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('ok');
  });

  it('has four days, three nights, and the last day ends at B', () => {
    expect(r.json.days.map((d: any) => d.day)).toEqual([1, 2, 3, 4]);
    expect(r.json.days.map((d: any) => d.night?.slug ?? null)).toEqual([
      'gold-1',
      'gold-2',
      'gold-3',
      null,
    ]);
  });

  it('each night is named and links to its own page', () => {
    const nights = r.json.days.flatMap((d: any) => (d.night ? [d.night] : []));
    expect(nights.map((n: any) => [n.name, n.path])).toEqual([
      ['Gold 1', '/camping/hr/region/gold-1'],
      ['Gold 2', '/camping/hr/region/gold-2'],
      ['Gold 3', '/camping/hr/region/gold-3'],
    ]);
  });

  it('🔴 each night carries WHO gave the record and WHEN — the two things a licence asks to print beside it', () => {
    const nights = r.json.days.flatMap((d: any) => (d.night ? [d.night] : []));
    expect(nights.map((n: any) => n.sources)).toEqual([
      [
        { id: 'osm', updatedAt: '2026-10-19' },
        { id: 'datatourisme', updatedAt: '2005-08-24' },
      ],
      [{ id: 'osm', updatedAt: '2026-10-19' }],
      [{ id: 'osm', updatedAt: '2026-10-19' }],
    ]);
  });

  it('says WHY each night: the recorded amenities and stars, flagged as weighed', () => {
    const night = r.json.days[0].night;
    expect(
      night.reasons.map((x: any) => [x.field, x.value, x.weighed]),
    ).toEqual(
      expect.arrayContaining([
        ['electricity', 'yes', true],
        ['greyWater', 'yes', true],
        ['stars', 5, true],
      ]),
    );
    expect(night.amenities).toMatchObject({
      electricity: 'yes',
      greyWater: 'yes',
    });
    expect(night.stars).toBe(5);
    // …and where it was meant to fall, which is most of the ranking.
    expect(night.targetAlongM).toBeCloseTo(EVEN_KM * 1000, -2);
    expect(night.fromTargetM).toBeLessThan(100);
  });

  it('says what the ranking used, from the weights the plan was made with', () => {
    expect(r.json.ranking).toEqual([
      { id: 'distance_fit', weight: 0.75 },
      { id: 'electricity', weight: 0.1 },
      { id: 'greyWater', weight: 0.1 },
      { id: 'stars', weight: 0.05 },
    ]);
  });

  it('counts the campsites the nights were chosen from: the twelve in the corridor', () => {
    expect(r.json.candidates).toBe(12);
  });

  it('🔴 the length is the straight line, read back from PostGIS on the spheroid', async () => {
    const pg = await db.query(
      `SELECT ST_Distance(
         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
         ST_SetSRID(ST_MakePoint($1, $3), 4326)::geography) AS m`,
      [LON, LAT0, LAT1],
    );
    const spheroid = Number(pg.rows[0].m);
    expect(r.json.measure).toBe('straight');
    expect(Math.abs(r.json.lengthM / spheroid - 1)).toBeLessThan(0.005);
    // The days add up to the trip.
    const sum = r.json.days.reduce((a: number, d: any) => a + d.runM, 0);
    expect(sum).toBeCloseTo(r.json.lengthM, 3);
  });

  it('is the same bytes twice', async () => {
    expect((await ask(PLAN_LON15)).text).toBe(r.text);
  });

  it('🔴 and no key anywhere names a road or a time at the wheel', () => {
    const keys: string[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (typeof v === 'object' && v !== null) {
        for (const [k, x] of Object.entries(v)) {
          keys.push(k);
          walk(x);
        }
      }
    };
    walk(r.json);
    expect(keys.length).toBeGreaterThan(40);
    expect(
      keys.filter((k) =>
        /road|driv|hour|minute|second|duration|speed|eta$|travel/i.test(k),
      ),
    ).toEqual([]);
    // The raw text too: a word that is not a key is still a promise.
    expect(r.text).not.toMatch(/road|driv(e|ing)|hours?\b|minutes?\b/i);
  });
});

describe('🔴 the corridor is 30 km to either side of the line, and the answer says how far each night is', () => {
  it('a campsite 20 km beside the line is a night, one 40 km beside it is not even a candidate', async () => {
    const r = await ask({
      from: point(18, LAT0),
      to: point(18, LAT1),
      days: 4,
    });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('ok');
    expect(r.json.candidates).toBe(3);
    const nights = r.json.days.flatMap((d: any) => (d.night ? [d.night] : []));
    expect(nights.map((n: any) => n.slug)).toEqual([
      'side-1',
      'side-2',
      'side-3',
    ]);
    // 20 km to the side, as it was placed — not read back from the code.
    for (const n of nights) expect(n.offsetM / 1000).toBeCloseTo(20, 0);
  });
});

describe('🔴 a campsite that is two rows is read through its link, and credited for what was taken from it', () => {
  it('the name and the stars come from the secondary, and so does the credit — with its date', async () => {
    const r = await ask({ from: point(14, LAT0), to: point(14, 45), days: 2 });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('ok');
    const night = r.json.days[0].night;
    expect(night.slug).toBe('linked-primary');
    expect(night.name).toBe('Linked Name');
    expect(night.stars).toBe(4);
    expect(
      night.reasons.map((x: any) => [x.field, x.value, x.weighed]),
    ).toEqual(expect.arrayContaining([['stars', 4, true]]));
    expect(night.sources).toEqual([
      { id: 'osm', updatedAt: '2026-10-19' },
      { id: 'datatourisme', updatedAt: '2005-08-24' },
    ]);
  });

  it('a secondary that gave nothing the plan shows is not credited', async () => {
    const r = await ask({ from: point(19, LAT0), to: point(19, 45), days: 2 });
    expect(r.status).toBe(200);
    const night = r.json.days[0].night;
    expect(night.slug).toBe('plain-primary');
    expect(night.sources).toEqual([{ id: 'osm', updatedAt: '2026-10-19' }]);
  });

  it("the owner's correction of the name wins over the record's own, as it does on the page", async () => {
    const r = await ask({ from: point(19, LAT0), to: point(19, 45), days: 2 });
    expect(r.json.days[0].night.name).toBe('Owner Name');
  });

  it('a link that was withdrawn lends nothing, and credits nothing', async () => {
    const r = await ask({
      from: point(13.5, LAT0),
      to: point(13.5, 45),
      days: 2,
    });
    expect(r.status).toBe(200);
    const night = r.json.days[0].night;
    expect(night.slug).toBe('unlinked-primary');
    expect(night.name).toBeNull();
    expect(night.stars).toBeNull();
    expect(night.sources).toEqual([{ id: 'osm', updatedAt: '2026-10-19' }]);
  });

  it('the hidden secondary is never a night of its own', async () => {
    const r = await ask({ from: point(14, LAT0), to: point(14, 45), days: 2 });
    expect(r.json.candidates).toBe(1);
  });
});

describe('a night that has no name keeps its place', () => {
  it('is unnamed in the answer, and still has a page', async () => {
    const r = await ask({ from: point(16, LAT0), to: point(16, 45), days: 2 });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('ok');
    expect(r.json.days[0].night).toMatchObject({
      slug: 'nameless',
      name: null,
      path: '/camping/hr/region/nameless',
    });
  });
});

describe('🔴 a refusal that is an answer: 200, not an error', () => {
  it('open water has no chain of campsites to follow', async () => {
    const r = await ask({ from: point(17, LAT0), to: point(17, 45), days: 4 });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      status: 'infeasible',
      reason: 'no-chain',
      measure: 'straight',
      lengthM: expect.any(Number),
      daysAsked: 4,
      candidates: 0,
      reachedNights: 0,
    });
  });

  it('a round trip has no direction to cut', async () => {
    const r = await ask({
      from: point(LON, LAT0),
      to: point(LON, LAT0),
      days: 4,
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ status: 'unsupported', reason: 'round-trip' });
  });

  it('🔴 two points a hair apart are one place: the same answer as an equal pair, not a 500', async () => {
    // 46.0569 and 46.0569000000001 are different numbers: the corridor refuses
    // to draw an arc between points 1e-8 m apart, and that was an Error → 500.
    const slip = await ask({
      from: point(LON, LAT0),
      to: point(LON, LAT0 + 1e-13),
      days: 4,
    });
    expect(slip.status).toBe(200);
    expect(slip.json).toEqual({ status: 'unsupported', reason: 'round-trip' });
    // Under a metre (0.44 m) is the same place too.
    const under = await ask({
      from: point(LON, LAT0),
      to: point(LON, LAT0 + 4e-6),
      days: 4,
    });
    expect(under.json).toEqual({ status: 'unsupported', reason: 'round-trip' });
  });

  it('two metres apart are two places: a plan is attempted — and is refused for want of campsites, not crashed', async () => {
    const r = await ask({
      from: point(LON, LAT0),
      to: point(LON, LAT0 + 2e-5),
      days: 4,
    });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('infeasible');
    expect(r.json.reason).toBe('no-chain');
  });

  it('one day is a plan with no nights: the whole trip is the run', async () => {
    const r = await ask({
      from: point(LON, LAT0),
      to: point(LON, LAT1),
      days: 1,
    });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('ok');
    expect(r.json.days).toHaveLength(1);
    expect(r.json.days[0].night).toBeNull();
    expect(r.json.days[0].runM).toBeCloseTo(r.json.lengthM, 3);
  });
});

describe('🔴 outside the Union is a 400 that names the point', () => {
  const problems = (r: Reply) =>
    r.json.errors.map((e: any) => `${e.field}:${e.code}`);

  it('the start, a box that is the United Kingdom', async () => {
    const r = await ask({
      from: point(-0.12, 51.5),
      to: point(LON, LAT1),
      days: 4,
    });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('invalid_plan_request');
    expect(problems(r)).toEqual(['from:outside_union']);
  });

  it('the end, a box that is Switzerland', async () => {
    const r = await ask({
      from: point(LON, LAT0),
      to: point(8.54, 47.37),
      days: 4,
    });
    expect(r.status).toBe(400);
    expect(problems(r)).toEqual(['to:outside_union']);
  });

  it('both ends, both named, in the order of the form', async () => {
    const r = await ask({
      from: point(8.54, 47.37),
      to: point(-0.12, 51.5),
      days: 4,
    });
    expect(r.status).toBe(400);
    expect(problems(r)).toEqual(['from:outside_union', 'to:outside_union']);
    expect(r.json.message).toMatch(/2 things/);
  });

  it('open sea off a member is still that member: the nearest polygon decides, as it does for the importer', async () => {
    // 300 m south of the Croatian box.
    const r = await ask({
      from: point(15, 41.9973),
      to: point(15, 44),
      days: 3,
    });
    expect(r.status).toBe(200);
  });

  it('…and open sea off a stranger is that stranger', async () => {
    // 300 m north of the British box.
    const r = await ask({
      from: point(-3, 59.0027),
      to: point(LON, LAT1),
      days: 4,
    });
    expect(r.status).toBe(400);
    expect(problems(r)).toEqual(['from:outside_union']);
  });

  it('Åland is Finland, written `AX` by the source: inside', async () => {
    const r = await ask({
      from: point(20.2, 60.1),
      to: point(20.2, 60.5),
      days: 2,
    });
    expect(r.status).toBe(200);
  });

  it('a second member state is inside too', async () => {
    const r = await ask({
      from: point(15, 46.8),
      to: point(15, 46.9),
      days: 2,
    });
    expect(r.status).toBe(200);
  });
});

describe('🔴 the entry stores nothing', () => {
  /** Every statement a request sends on its connection, in order. */
  async function recorded(body: unknown): Promise<string[]> {
    const seen: string[] = [];
    const real = dataSource.createQueryRunner.bind(dataSource);
    const spy = jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockImplementation((...args) => {
        const runner = real(...args);
        const query = runner.query.bind(runner);
        runner.query = ((sql: string, params?: unknown[]) => {
          seen.push(sql.replace(/\s+/g, ' ').trim());
          return query(sql, params);
        }) as typeof runner.query;
        return runner;
      });
    try {
      await ask(body);
    } finally {
      spy.mockRestore();
    }
    return seen;
  }

  it('the first thing the connection is told is READ ONLY, and the last is the end of the transaction', async () => {
    const seen = await recorded(PLAN_LON15);
    expect(seen[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(seen[seen.length - 1]).toBe('COMMIT');
  });

  it('then the timeout, as a value written out here', async () => {
    const seen = await recorded(PLAN_LON15);
    expect(seen[1]).toBe('SET LOCAL statement_timeout = 10000');
  });

  it('and not one statement in the whole request writes, creates or drops anything', async () => {
    const seen = await recorded(PLAN_LON15);
    expect(seen.length).toBeGreaterThan(4);
    expect(
      seen.filter((s) =>
        /^(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP|ALTER|COPY|GRANT)\b/i.test(
          s,
        ),
      ),
    ).toEqual([]);
  });

  it('a refused request is a transaction too, ended, and the pool is not starved by it', async () => {
    const seen = await recorded({
      from: point(8.54, 47.37),
      to: point(LON, LAT1),
      days: 4,
    });
    expect(seen[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(seen[seen.length - 1]).toBe('COMMIT');
    // The pool took the connection back: the next request is not starved.
    expect((await ask(PLAN_LON15)).status).toBe(200);
  });

  it('🔴 a statement the database cancels is a 503 that says to try again — and the connection is rolled back and given back', async () => {
    const seen: string[] = [];
    const real = dataSource.createQueryRunner.bind(dataSource);
    const spy = jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockImplementation((...args) => {
        const runner = real(...args);
        const query = runner.query.bind(runner);
        runner.query = ((sql: string, params?: unknown[]) => {
          seen.push(sql.replace(/\s+/g, ' ').trim());
          // The corridor read, the statement a stuck plan would be stuck in.
          if (/FROM camping_spots s/.test(sql)) {
            return Promise.reject(
              Object.assign(
                new Error('canceling statement due to statement timeout'),
                { code: '57014' },
              ),
            );
          }
          return query(sql, params);
        }) as typeof runner.query;
        return runner;
      });
    let r: Reply;
    try {
      r = await ask(PLAN_LON15);
    } finally {
      spy.mockRestore();
    }
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ code: 'planner_busy' });
    // Not the database's message, and not a stack.
    expect(r.text).not.toMatch(/statement timeout|camping_spots/);
    expect(seen[seen.length - 1]).toBe('ROLLBACK');
    // …and the pool is whole: the next request is a plan.
    expect((await ask(PLAN_LON15)).status).toBe(200);
  });

  it("the server really refuses a write in that transaction (so the sentence above is Postgres' and not ours)", async () => {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await expect(
      db.query(`INSERT INTO camping_spots (slug, country, location)
                VALUES ('x', 'HR', ST_SetSRID(ST_MakePoint(1, 1), 4326))`),
    ).rejects.toMatchObject({ code: '25006' });
    await db.query('ROLLBACK');
  });

  it('and a cancelled statement is code 57014, which is what the service turns into a 503', async () => {
    await db.query('BEGIN');
    await db.query('SET LOCAL statement_timeout = 50');
    await expect(db.query('SELECT pg_sleep(2)')).rejects.toMatchObject({
      code: '57014',
    });
    await db.query('ROLLBACK');
  });
});
