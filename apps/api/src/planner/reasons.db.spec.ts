import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { mapAmenities } from '../osm/tag-mapping';
import { CoverageSnapshot } from './coverage-snapshot';
import { ItineraryRequest, Night, planItinerary } from './itinerary';
import { loadReasons, REASON_SOURCES } from './reasons';
import { COMPONENTS, loadScoring } from './scoring';

// CAMP-245 — "why this one", over a REAL PostgreSQL, through `planItinerary`.
//
// reasons.spec.ts takes the function apart. This is the other half of the
// card: that what reaches the PLAN is read from the stored row of the campsite
// the plan chose — the jsonb the importer and the context job wrote, the
// smallint of the rating — and not from a stand-in. A value changed IN THE
// TABLE changes the sentence in the plan; a key deleted from the jsonb
// removes the reason; a campsite the table holds only a position for comes
// back with an empty list.
//
// 🔴 THE CORPUS DOES NOT SHARE A FIELD WITH WHAT IT MEASURES. The campsites
// are PLACED on a meridian by arithmetic written out here (a degree of
// latitude is a fixed number of metres on the sphere), their amenities are
// written by the importer's own mapper from OSM tags, and every expected
// sentence below is typed. Nothing is read back from the module under test.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP. Needs
// CAMP_TEST_DATABASE_URL (locally) or CI_DATABASE_URL (CI): any PostGIS
// database you may CREATE DATABASE in. This file creates its own `camp245_*`
// database and drops it.

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
  dbName = `camp245_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  // Only the columns the planner's queries read, with the types the real
  // table has (the precedent of itinerary.db.spec.ts).
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
// The fixture
//
// One corridor, due north on the meridian 10°E from 40°N to 44°N, four days:
// three nights, at the even cuts 111.2, 222.4 and 333.6 km. Every campsite is
// ON the meridian, so "along" is a difference of latitude.
//
//   rich      cut 1   every amenity yes, five stars, all four surroundings
//   partial   cut 2   electricity yes; a supermarket at 900 m and a lake at
//                     2 500 m (too far to be a reason); no rating
//   bare      cut 3   nothing but a position: every amenity `unknown` (the
//                     importer's own spelling), no rating, an empty context
//   d1/d2/d3  ±25 km  no tags, no context: worse than the campsite on the
//                     cut at every night, so the chosen three are the three
//                     above, by construction
// ---------------------------------------------------------------------------

const R = 6_371_008.8;
/** Metres in a degree of latitude on that sphere: 111 195.08. */
const DEGREE_M = (R * Math.PI) / 180;
const LAT0 = 40;
const LON = 10;
const EVEN_KM = DEGREE_M / 1000; // 111.195 km: four degrees in four days

const FULL_TAGS = { power_supply: 'yes', sanitary_dump_station: 'yes' };

async function put(
  slug: string,
  alongKm: number,
  over: {
    tags?: Record<string, string>;
    stars?: number;
    context?: unknown;
  } = {},
): Promise<void> {
  await db.query(
    `INSERT INTO camping_spots (slug, country, region, amenities, location, stars, context)
     VALUES ($1, 'FR', 'Region', $2::jsonb,
             ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6::jsonb)`,
    [
      slug,
      JSON.stringify(mapAmenities(over.tags ?? {})),
      LON,
      LAT0 + (alongKm * 1000) / DEGREE_M,
      over.stars ?? null,
      JSON.stringify(over.context ?? {}),
    ],
  );
}

async function buildFixture(): Promise<void> {
  // Anchor on the PRODUCER: if the mapper stopped writing these, the table
  // above would be a fiction.
  expect(mapAmenities(FULL_TAGS).electricity).toBe('yes');
  expect(mapAmenities(FULL_TAGS).greyWater).toBe('yes');
  expect(mapAmenities({}).electricity).toBe('unknown');
  expect(mapAmenities({}).greyWater).toBe('unknown');

  await put('rich', EVEN_KM, {
    tags: FULL_TAGS,
    stars: 5,
    context: {
      water: { m: 346, kind: 'river', name: 'Le Loing' },
      supermarket: { m: 137, name: 'E.Leclerc' },
      station: { m: 948, name: 'Moret-sur-Loing' },
      town: { m: 640, name: 'Moret' },
      at: { lat: 48.38, lon: 2.8 },
    },
  });
  await put('partial', 2 * EVEN_KM, {
    tags: { power_supply: 'yes' },
    context: {
      supermarket: { m: 900 },
      water: { m: 2500, kind: 'lake' },
      elevation: 85,
    },
  });
  await put('bare', 3 * EVEN_KM);
  for (const k of [1, 2, 3]) {
    await put(`d${k}-minus`, k * EVEN_KM - 25);
    await put(`d${k}-plus`, k * EVEN_KM + 25);
  }
}

const REQ: ItineraryRequest = {
  from: [LON, LAT0],
  to: [LON, LAT0 + 4],
  days: 4,
  band: { minM: 60_000, maxM: 160_000 },
  bufferM: 30_000,
};

async function nights(
  deps?: Parameters<typeof planItinerary>[2],
): Promise<Night[]> {
  const r = await planItinerary(db, REQ, deps);
  if (r.status !== 'ok') throw new Error(`not ok: ${JSON.stringify(r)}`);
  return r.days.flatMap((d) => (d.night ? [d.night] : []));
}

/** The one reason with that field, from a night. */
const reasonOf = (n: Night, field: string) =>
  n.reasons.find((r) => r.field === field);

/**
 * Runs `change` against one campsite's row, plans, and puts the row back —
 * whatever the plan does. The row's three columns are read first, so what is
 * restored is what was there, not what this file believes was there.
 */
async function withRow<T>(
  slug: string,
  change: string,
  params: unknown[],
  then: () => Promise<T>,
): Promise<T> {
  const before = (
    await db.query(
      `SELECT amenities, stars, context FROM camping_spots WHERE slug = $1`,
      [slug],
    )
  ).rows[0];
  expect(before).toBeDefined();
  try {
    const res = await db.query(
      `UPDATE camping_spots SET ${change} WHERE slug = $1`,
      [slug, ...params],
    );
    // The change applied to exactly the row it was written for.
    expect(res.rowCount).toBe(1);
    return await then();
  } finally {
    await db.query(
      `UPDATE camping_spots SET amenities = $2::jsonb, stars = $3, context = $4::jsonb
        WHERE slug = $1`,
      [
        slug,
        JSON.stringify(before.amenities),
        before.stars,
        JSON.stringify(before.context),
      ],
    );
  }
}

const RICH = [
  {
    field: 'electricity',
    value: 'yes',
    unit: null,
    weighed: true,
    text: 'Our database records electricity at this campsite',
  },
  {
    field: 'greyWater',
    value: 'yes',
    unit: null,
    weighed: true,
    text: 'Our database records grey-water disposal at this campsite',
  },
  {
    field: 'stars',
    value: 5,
    unit: 'stars',
    weighed: true,
    text: '5-star official classification',
  },
  {
    field: 'context.water',
    value: 346,
    unit: 'm',
    kind: 'river',
    name: 'Le Loing',
    weighed: false,
    text: 'River (Le Loing) 346 m away in a straight line',
  },
  {
    field: 'context.supermarket',
    value: 137,
    unit: 'm',
    name: 'E.Leclerc',
    weighed: false,
    text: 'Supermarket (E.Leclerc) 137 m away in a straight line',
  },
  {
    field: 'context.station',
    value: 948,
    unit: 'm',
    name: 'Moret-sur-Loing',
    weighed: false,
    text: 'Railway station (Moret-sur-Loing) 948 m away in a straight line',
  },
  {
    field: 'context.town',
    value: 640,
    unit: 'm',
    name: 'Moret',
    weighed: false,
    text: 'Town (Moret) 640 m away in a straight line',
  },
];

const without = (field: string) => RICH.filter((r) => r.field !== field);

describe('the plan carries its reasons, read from the row of the campsite it chose', () => {
  it('anchor: three nights, and they are rich, partial and bare', async () => {
    expect((await nights()).map((n) => n.slug)).toEqual([
      'rich',
      'partial',
      'bare',
    ]);
  });

  it('night 1: the seven reasons, from the stored jsonb, rating and context', async () => {
    const [n1] = await nights();
    expect(n1.reasons).toEqual(RICH);
  });

  it('night 2: only what that row holds — electricity and a supermarket 900 m away; the lake at 2 500 m is not close, and there is no rating', async () => {
    const n2 = (await nights())[1];
    expect(n2.reasons).toEqual([
      {
        field: 'electricity',
        value: 'yes',
        unit: null,
        weighed: true,
        text: 'Our database records electricity at this campsite',
      },
      {
        field: 'context.supermarket',
        value: 900,
        unit: 'm',
        weighed: false,
        text: 'Supermarket 900 m away in a straight line',
      },
    ]);
  });

  it('🔴 night 3: a campsite the table holds only a position for comes back with NO reasons', async () => {
    // Anchor: the row really is bare, in the importer's own spelling.
    const row = (
      await db.query(
        `SELECT amenities, stars, context FROM camping_spots WHERE slug = 'bare'`,
      )
    ).rows[0];
    expect(row.stars).toBeNull();
    expect(row.context).toEqual({});
    expect(Object.values(row.amenities).every((v) => v === 'unknown')).toBe(
      true,
    );
    const n3 = (await nights())[2];
    expect(n3.slug).toBe('bare');
    expect(n3.reasons).toEqual([]);
  });

  it('the three nights each carry the reasons of THEIR row, not a neighbour’s', async () => {
    const [n1, n2, n3] = await nights();
    expect(n1.reasons.map((r) => r.field)).toHaveLength(7);
    expect(n2.reasons.map((r) => r.field)).toEqual([
      'electricity',
      'context.supermarket',
    ]);
    expect(n3.reasons).toHaveLength(0);
    // Same field, two rows, two answers.
    expect(reasonOf(n1, 'context.supermarket')?.value).toBe(137);
    expect(reasonOf(n2, 'context.supermarket')?.value).toBe(900);
  });

  it('one input, one answer: twice over the same table, the same text', async () => {
    const a = JSON.stringify(await nights());
    const b = JSON.stringify(await nights());
    expect(a).toBe(b);
    expect(JSON.parse(a)).toHaveLength(3);
  });
});

describe('🔴 a value changed in the TABLE changes the sentence in the plan', () => {
  it('a distance: 346 m becomes 640 m', async () => {
    const text = await withRow(
      'rich',
      `context = jsonb_set(context, '{water,m}', '640')`,
      [],
      async () => reasonOf((await nights())[0], 'context.water')?.text,
    );
    expect(text).toBe('River (Le Loing) 640 m away in a straight line');
  });

  it('a distance past a kilometre is said in kilometres: 1 500 m station is 1.5 km', async () => {
    const text = await withRow(
      'rich',
      `context = jsonb_set(context, '{station,m}', '1500')`,
      [],
      async () => reasonOf((await nights())[0], 'context.station')?.text,
    );
    expect(text).toBe(
      'Railway station (Moret-sur-Loing) 1.5 km away in a straight line',
    );
  });

  it('the kind of water: a river becomes a lake', async () => {
    const text = await withRow(
      'rich',
      `context = jsonb_set(context, '{water,kind}', '"lake"')`,
      [],
      async () => reasonOf((await nights())[0], 'context.water')?.text,
    );
    expect(text).toBe('Lake (Le Loing) 346 m away in a straight line');
  });

  it('the rating: five stars become four', async () => {
    const text = await withRow('rich', 'stars = 4', [], async () => {
      return reasonOf((await nights())[0], 'stars')?.text;
    });
    expect(text).toBe('4-star official classification');
  });

  it('and the unchanged table says what it said: the change is the only difference', async () => {
    expect(reasonOf((await nights())[0], 'context.water')?.text).toBe(
      'River (Le Loing) 346 m away in a straight line',
    );
    expect(reasonOf((await nights())[0], 'stars')?.text).toBe(
      '5-star official classification',
    );
  });

  it('a distance moved beyond the radius: the reason leaves the list, it does not stay with a long number', async () => {
    const reasons = await withRow(
      'rich',
      `context = jsonb_set(context, '{supermarket,m}', '4200')`,
      [],
      async () => (await nights())[0].reasons,
    );
    expect(reasons).toEqual(without('context.supermarket'));
  });
});

describe('🔴 a field deleted from the TABLE removes its reason — it does not leave one with an empty number', () => {
  const deletions: Array<[string, string]> = [
    ['electricity', `amenities = amenities - 'electricity'`],
    ['greyWater', `amenities = amenities - 'greyWater'`],
    ['stars', 'stars = NULL'],
    ['context.water', `context = context - 'water'`],
    ['context.supermarket', `context = context - 'supermarket'`],
    ['context.station', `context = context - 'station'`],
    ['context.town', `context = context - 'town'`],
  ];

  it.each(deletions)(
    '%s: gone, and the other six untouched',
    async (field, change) => {
      const reasons = await withRow(
        'rich',
        change,
        [],
        async () => (await nights())[0].reasons,
      );
      expect(reasons).toEqual(without(field));
    },
  );

  it.each([
    [
      'electricity',
      `amenities = jsonb_set(amenities, '{electricity}', '"unknown"')`,
    ],
    [
      'electricity',
      `amenities = jsonb_set(amenities, '{electricity}', '"no"')`,
    ],
    [
      'greyWater',
      `amenities = jsonb_set(amenities, '{greyWater}', '"unknown"')`,
    ],
    ['context.water', `context = jsonb_set(context, '{water}', '{}')`],
    [
      'context.water',
      `context = jsonb_set(context, '{water}', '{"kind": "river", "m": null}')`,
    ],
    [
      'context.town',
      `context = jsonb_set(context, '{town}', '{"name": "Moret"}')`,
    ],
    ['context.station', `context = jsonb_set(context, '{station}', '"oops"')`],
    [
      'context.supermarket',
      `context = jsonb_set(context, '{supermarket}', '{"m": "137"}')`,
    ],
  ])(
    '%s written as a blank or a shell (%s): no reason, and the rest untouched',
    async (field, change) => {
      const reasons = await withRow(
        'rich',
        change,
        [],
        async () => (await nights())[0].reasons,
      );
      expect(reasons).toEqual(without(field));
    },
  );

  it.each([`'null'`, `'[]'`, `'"oops"'`, `'42'`, `'{}'`])(
    'a context column that holds %s instead of an object: the three that do not stand on it remain, the plan still stands',
    async (value) => {
      const got = await withRow(
        'rich',
        `context = ${value}::jsonb`,
        [],
        async () => nights(),
      );
      expect(got.map((n) => n.slug)).toEqual(['rich', 'partial', 'bare']);
      expect(got[0].reasons.map((r) => r.field)).toEqual([
        'electricity',
        'greyWater',
        'stars',
      ]);
    },
  );

  it('🔴 one damaged record costs one record: a corrupt context on night 2 leaves nights 1 and 3 exactly as they were', async () => {
    const got = await withRow(
      'partial',
      `context = '"garbage"'::jsonb`,
      [],
      async () => nights(),
    );
    expect(got[0].reasons).toEqual(RICH);
    expect(got[1].reasons.map((r) => r.field)).toEqual(['electricity']);
    expect(got[2].reasons).toEqual([]);
  });
});

describe('the reasons follow the configuration the plan is handed', () => {
  const real = (): CoverageSnapshot =>
    JSON.parse(readFileSync(join(__dirname, 'coverage.snapshot.json'), 'utf8'));

  it('other sources, other reasons: the planner reads the config it is given, not a constant', async () => {
    const onlyElectricity = loadReasons(
      REASON_SOURCES.filter((s) => s.field === 'electricity'),
      real(),
    );
    const [n1] = await nights({ reasons: onlyElectricity });
    expect(n1.reasons.map((r) => r.field)).toEqual(['electricity']);
  });

  it('`weighed` follows the weights the plan ran with: no weight on electricity, and it is not weighed', async () => {
    const noElectricity = loadScoring(
      COMPONENTS.map((c) =>
        c.id === 'electricity'
          ? { ...c, weight: 0 }
          : c.id === 'distance_fit'
            ? { ...c, weight: c.weight + 0.1 }
            : c,
      ),
      real(),
    );
    const [n1] = await nights({ scoring: noElectricity });
    // Anchor: the same night was chosen, so this is the same record.
    expect(n1.slug).toBe('rich');
    expect(reasonOf(n1, 'electricity')?.weighed).toBe(false);
    expect(reasonOf(n1, 'greyWater')?.weighed).toBe(true);
  });
});
