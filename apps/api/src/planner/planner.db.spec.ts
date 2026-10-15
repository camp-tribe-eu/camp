import { Client } from 'pg';
import { AMENITY_KEYS, mapAmenities } from '../osm/tag-mapping';
import { loadPool } from './ablate-scoring';
import { measureCoverage, queryHash, SQL } from './measure-coverage';
import { plannerPopulationSql } from './population';
import { CONTEXT_KEYS } from './reasons';
import { BEGIN_READ_ONLY, inReadOnlyTransaction, Queryable } from './read-only';

// CAMP-262 — the measuring SQL, against a REAL PostgreSQL.
//
// 🔴 WHY A DATABASE. The coverage table is the thing the weights are held
// to, and it is nothing but a statement about what PostgreSQL returns for
// four things this codebase gets subtly wrong: a key missing from a jsonb
// object (which is not the string "unknown"), a rating that lives on a row
// the page hides, a link somebody undid, and a secondary whose primary has
// gone. A test that checks the SHAPE of the SQL is satisfied by a query
// that gets any of them wrong.
//
// 🔴 THE CORPUS DOES NOT SHARE A FIELD WITH WHAT IT MEASURES. The amenity
// column is written by the importer's own mapper from OSM tags
// (`mapAmenities`), and every expected figure below is counted from the TAGS
// in the fixture table, not from what the column ended up holding. Expected
// values read back from the measured column would agree with a wrong query.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP. Needs
// CAMP_TEST_DATABASE_URL (locally) or CI_DATABASE_URL (CI sets it): any
// PostGIS database you may CREATE DATABASE in. This file creates its own
// `camp262_*` database and drops it; it reads and writes nothing in the one
// you name.

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
  dbName = `camp262_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  // Only the columns the planner's queries read, with the types the real
  // table has (the precedent of overnight.db.spec.ts and context-sql.spec.ts).
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
      unlinked_at timestamptz, created_at timestamptz DEFAULT now());`);
});

afterAll(async () => {
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

interface Spot {
  slug: string;
  country: string;
  region?: string | null;
  /** OSM tags, run through the importer's own mapper. */
  tags?: Record<string, string>;
  /** Bypasses the mapper: a row written before an amenity existed. */
  rawAmenities?: Record<string, string>;
  stars?: number;
  /** The computed surroundings, as the column holds them (CAMP-245). */
  context?: unknown;
  missing?: boolean;
  lon?: number;
  lat?: number;
}

async function put(s: Spot): Promise<string> {
  const amenities = s.rawAmenities ?? mapAmenities(s.tags ?? {});
  const res = await db.query(
    `INSERT INTO camping_spots
       (slug, country, region, amenities, location, stars, missing_since, context)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7,
             CASE WHEN $8::boolean THEN now() ELSE NULL END, $9::jsonb)
     RETURNING id`,
    [
      s.slug,
      s.country,
      s.region === undefined ? 'Region' : s.region,
      JSON.stringify(amenities),
      s.lon ?? 14,
      s.lat ?? 45,
      s.stars ?? null,
      s.missing ?? false,
      JSON.stringify(s.context ?? {}),
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

const reset = () =>
  db.query('TRUNCATE camping_spots, spot_links RESTART IDENTITY');

describe('measureCoverage', () => {
  // The fixture, as a table. "in" rows are the planner's population.
  //
  // slug          cc  tags                                       stars  why
  // p1-both       FR  power_supply=yes, sanitary_dump_station=yes   4   in
  // p2-merged     DE  power_supply=yes                              -   in; its rating (5) sits on s1
  // p3-no         FR  power_supply=no, sanitary_dump_station=no     2   in
  // p4-empty      DE  (no tags)                                     -   in
  // p5-legacy     FR  amenities = {} — the keys do not exist        -   in
  // p6-el         DE  power_supply=yes                              -   in
  // p7-dump       FR  sanitary_dump_station=yes                     -   in; a link to s2 was undone
  // s2-undone     DE  (no tags)                                     3   in: its link is undone, so it is its own page
  // s3-orphan     FR  power_supply=no                               -   in: secondary of a MISSING primary, so shown
  // x1-missing    FR  power_supply=yes                              5   out: missing_since is set
  // x2-noregion   DE  power_supply=yes                              5   out: no region, no page
  // s1-hidden     DE  (no tags)                                     5   out: live secondary of p2
  //
  // CAMP-245, the surroundings (context). A feature is known when it holds a
  // NUMBER under `m`:
  //   p1-both     water 50 (lake), town 1200, supermarket 300, station 400
  //   p2-merged   water 10 (sea) only
  //   p3-no       every feature is a shell: water {}, town {m: null},
  //               supermarket "oops", station {m: "5"} — none is known
  //   p6-el       town {m: 0} — a distance of zero is a distance
  //   x1-missing, s1-hidden  all four, but they are outside the population
  //   the rest    {}
  const POPULATION = [
    'p1-both',
    'p2-merged',
    'p3-no',
    'p4-empty',
    'p5-legacy',
    'p6-el',
    'p7-dump',
    's2-undone',
    's3-orphan',
  ];

  beforeAll(async () => {
    await reset();
    // Anchor on the PRODUCER: if the mapper stopped reading these tags the
    // table above would be a fiction, and every count below would be
    // measuring that instead.
    expect(mapAmenities({ power_supply: 'yes' }).electricity).toBe('yes');
    expect(mapAmenities({ power_supply: 'no' }).electricity).toBe('no');
    expect(mapAmenities({}).electricity).toBe('unknown');
    expect(mapAmenities({ sanitary_dump_station: 'yes' }).greyWater).toBe(
      'yes',
    );

    const both = { power_supply: 'yes', sanitary_dump_station: 'yes' };
    const ALL_FOUR = {
      water: { m: 50, kind: 'lake' },
      town: { m: 1200 },
      supermarket: { m: 300 },
      station: { m: 400 },
    };
    await put({
      slug: 'p1-both',
      country: 'FR',
      tags: both,
      stars: 4,
      context: ALL_FOUR,
    });
    const p2 = await put({
      slug: 'p2-merged',
      country: 'DE',
      tags: { power_supply: 'yes' },
      context: { water: { m: 10, kind: 'sea' } },
    });
    await put({
      slug: 'p3-no',
      country: 'FR',
      tags: { power_supply: 'no', sanitary_dump_station: 'no' },
      stars: 2,
      context: {
        water: {},
        town: { m: null },
        supermarket: 'oops',
        station: { m: '5' },
      },
    });
    await put({ slug: 'p4-empty', country: 'DE' });
    await put({ slug: 'p5-legacy', country: 'FR', rawAmenities: {} });
    await put({
      slug: 'p6-el',
      country: 'DE',
      tags: { power_supply: 'yes' },
      context: { town: { m: 0 } },
    });
    const p7 = await put({
      slug: 'p7-dump',
      country: 'FR',
      tags: { sanitary_dump_station: 'yes' },
    });
    const s2 = await put({ slug: 's2-undone', country: 'DE', stars: 3 });
    const x1 = await put({
      slug: 'x1-missing',
      country: 'FR',
      tags: { power_supply: 'yes' },
      stars: 5,
      missing: true,
      context: ALL_FOUR,
    });
    const s3 = await put({
      slug: 's3-orphan',
      country: 'FR',
      tags: { power_supply: 'no' },
    });
    await put({
      slug: 'x2-noregion',
      country: 'DE',
      region: null,
      tags: { power_supply: 'yes' },
      stars: 5,
    });
    const s1 = await put({
      slug: 's1-hidden',
      country: 'DE',
      stars: 5,
      context: ALL_FOUR,
    });
    await link(p2, s1);
    await link(p7, s2, true);
    await link(x1, s3);
  });

  const slugsInPopulation = async () =>
    (
      await db.query(
        `SELECT s.slug FROM camping_spots s WHERE ${plannerPopulationSql('s')}
          ORDER BY s.slug`,
      )
    ).rows.map((r) => r.slug);

  it('the population is exactly the campsites with a page', async () => {
    expect(await slugsInPopulation()).toEqual([...POPULATION].sort());
  });

  // One test per condition, so a query that drops one names the row that
  // came back.
  it('leaves out a campsite OSM has stopped mentioning', async () => {
    expect(await slugsInPopulation()).not.toContain('x1-missing');
  });

  it('leaves out a campsite with no region, which has no URL', async () => {
    expect(await slugsInPopulation()).not.toContain('x2-noregion');
  });

  it('leaves out a secondary that a live link hides', async () => {
    expect(await slugsInPopulation()).not.toContain('s1-hidden');
  });

  it('keeps a secondary whose link was undone, and one whose primary is gone', async () => {
    const slugs = await slugsInPopulation();
    expect(slugs).toContain('s2-undone');
    expect(slugs).toContain('s3-orphan');
  });

  it('counts each input over that population, from the tags in the table above', async () => {
    const snap = await measureCoverage(db);
    // Anchor: nine rows, so the shares below are about the population above
    // and not about whatever else the database holds.
    expect(snap.population.n).toBe(POPULATION.length);
    expect(snap.fields.location).toEqual({ known: 9 });
    // electricity: yes = p1, p2, p6; no = p3, s3. p4, p5 (key missing), p7, s2 unknown.
    expect(snap.fields.electricity).toEqual({ known: 5, yes: 3 });
    // greyWater: yes = p1, p7; no = p3.
    expect(snap.fields.greyWater).toEqual({ known: 3, yes: 2 });
  });

  it('a key missing from the jsonb is unknown, the same as the word', async () => {
    // p5-legacy has {} and p4-empty has every key set to "unknown". If the
    // query counted a missing key as known, electricity would be 6.
    const snap = await measureCoverage(db);
    const shown = (
      await db.query(
        `SELECT slug, amenities ->> 'electricity' AS e FROM camping_spots
          WHERE slug IN ('p4-empty', 'p5-legacy') ORDER BY slug`,
      )
    ).rows;
    expect(shown).toEqual([
      { slug: 'p4-empty', e: 'unknown' },
      { slug: 'p5-legacy', e: null },
    ]);
    expect(snap.fields.electricity.known).toBe(5);
  });

  it('reads stars the way the page does, through the live link', async () => {
    const snap = await measureCoverage(db);
    // p1 (own 4), p2 (5, carried by its hidden secondary), p3 (own 2), s2 (own 3).
    expect(snap.fields.stars).toEqual({ known: 4 });
    // The raw column on the visible rows would say three: p2 is the row that
    // tells the two readings apart.
    const raw = await db.query(
      `SELECT count(stars)::int AS n FROM camping_spots s WHERE ${plannerPopulationSql('s')}`,
    );
    expect(raw.rows[0].n).toBe(3);
    expect(snap.evidence.starsOwnRow).toBe(3);
    // x1's rating (5) belongs to a missing campsite and s3 to nobody: neither counts.
    expect(snap.evidence.starsMean).toBeCloseTo((4 + 5 + 2 + 3) / 4, 12);
  });

  it('does not read through a link that was undone', async () => {
    // p7 had s2 (rating 3) linked, then undone. p7 must not inherit it:
    // 4 known, not 5, and p7 is not among the rated.
    const snap = await measureCoverage(db);
    expect(snap.fields.stars.known).toBe(4);
    expect(snap.evidence.starsKnownByCountry).toEqual({ FR: 2, DE: 2 });
  });

  it('carries every amenity the importer writes, in the importer’s order, then the surroundings', async () => {
    const snap = await measureCoverage(db);
    const keys = Object.keys(snap.fields);
    expect(keys).toEqual([
      'location',
      'stars',
      ...AMENITY_KEYS,
      'context.water',
      'context.supermarket',
      'context.station',
      'context.town',
    ]);
    expect(snap.fields.laundry).toEqual({ known: 0, yes: 0 });
  });

  it('🔴 counts a surrounding as known when the row holds a NUMBER for its distance — from the JSON in the table above', async () => {
    const snap = await measureCoverage(db);
    // water: p1, p2. p3's `{}` is a shell and p4's absent key is nothing.
    expect(snap.fields['context.water']).toEqual({ known: 2 });
    // town: p1 (1200) and p6 (0 — a distance of zero is one). p3's null is not.
    expect(snap.fields['context.town']).toEqual({ known: 2 });
    // supermarket: p1 alone. p3's "oops" is a string where an object goes.
    expect(snap.fields['context.supermarket']).toEqual({ known: 1 });
    // station: p1 alone. p3's {m: "5"} holds a string, not a number.
    expect(snap.fields['context.station']).toEqual({ known: 1 });
  });

  it('counts the surroundings of the population only: a missing campsite and a hidden secondary hold all four and are not in it', async () => {
    const outside = await db.query(
      `SELECT count(*)::int AS n FROM camping_spots
        WHERE slug IN ('x1-missing', 's1-hidden')
          AND jsonb_typeof(context -> 'water' -> 'm') = 'number'`,
    );
    // Anchor: they do hold a water distance, so a count that included them
    // would have said 3, not 2.
    expect(outside.rows[0].n).toBe(2);
    expect((await measureCoverage(db)).fields['context.water'].known).toBe(2);
  });

  it('`water` is still the amenity: the surrounding does not overwrite it', async () => {
    const snap = await measureCoverage(db);
    expect(snap.fields.water).toEqual({ known: 0, yes: 0 });
    expect(snap.fields['context.water'].known).toBe(2);
  });

  it('stamps the snapshot with the hash of the SQL that produced it', async () => {
    const snap = await measureCoverage(db);
    expect(snap.queryHash).toBe(queryHash());
    expect(snap.queryHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changing any of the SQL changes the hash', () => {
    // The hash must be sensitive to each statement, or it vouches for text
    // it never read.
    const real = queryHash();
    for (const key of Object.keys(SQL) as Array<keyof typeof SQL>) {
      const original = SQL[key];
      SQL[key] = original + ' ';
      const changed = queryHash();
      SQL[key] = original;
      expect(changed).not.toBe(real);
    }
    expect(queryHash()).toBe(real);
  });

  it('the hash also reads the context keys the sources are counted by: a new key is a new table', () => {
    const real = queryHash();
    CONTEXT_KEYS.push('shop' as never);
    try {
      expect(queryHash()).not.toBe(real);
    } finally {
      CONTEXT_KEYS.pop();
    }
    expect(queryHash()).toBe(real);
  });

  it('refuses to measure a population that carries an owner override', async () => {
    await db.query(
      `UPDATE camping_spots SET owner_overrides = '{"amenities":{"wifi":"yes"}}'
        WHERE slug = 'p4-empty'`,
    );
    try {
      await expect(measureCoverage(db)).rejects.toThrow(/owner_overrides/);
    } finally {
      await db.query(
        `UPDATE camping_spots SET owner_overrides = '{}' WHERE slug = 'p4-empty'`,
      );
    }
    // And it is only that override: put back, the measurement works again.
    await expect(measureCoverage(db)).resolves.toMatchObject({
      population: { n: POPULATION.length },
    });
  });

  it('refuses to measure an empty population', async () => {
    await db.query('BEGIN');
    try {
      await db.query('DELETE FROM camping_spots');
      await expect(measureCoverage(db)).rejects.toThrow(/population is empty/);
    } finally {
      await db.query('ROLLBACK');
    }
  });
});

describe('inReadOnlyTransaction', () => {
  it('measures inside a transaction the server will not let write', async () => {
    const seen: string[] = [];
    const spy: Queryable = {
      query: async (sql, params) => {
        const res = await db.query(sql, params);
        // Ask the server, from the same connection, what it thinks the
        // transaction is — after every statement of the measurement.
        if (sql !== BEGIN_READ_ONLY && sql !== 'COMMIT') {
          seen.push(
            (await db.query('SHOW transaction_read_only')).rows[0]
              .transaction_read_only,
          );
        }
        return res;
      },
    };
    await inReadOnlyTransaction(spy, () => measureCoverage(spy));
    expect(seen.length).toBeGreaterThanOrEqual(3); // anchor: it did look
    expect(new Set(seen)).toEqual(new Set(['on']));
  });

  it('turns a write into an error, and leaves the connection usable', async () => {
    await expect(
      inReadOnlyTransaction(db, () =>
        db.query(`UPDATE camping_spots SET name = 'changed'`),
      ),
    ).rejects.toThrow(/read-only transaction/);
    // Rolled back, not left aborted.
    expect((await db.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
  });
});

describe('loadPool', () => {
  const HERE = { name: 'test', lon: 14, lat: 45, radiusM: 30_000 };

  beforeAll(async () => {
    await reset();
    // Twenty-five campsites in a line east of the target, 0.01 degrees of
    // longitude apart: about 790 m each at this latitude, so the farthest is
    // near 19 km — most of the way to the 30 km radius and no further.
    for (let i = 0; i < 25; i++) {
      await put({
        slug: `line-${String(i).padStart(2, '0')}`,
        country: 'HR',
        lon: 14 + i * 0.01,
        tags: i === 3 ? { power_supply: 'yes' } : {},
      });
    }
    // Outside the radius, and inside it but unpublishable.
    await put({ slug: 'too-far', country: 'HR', lon: 15 });
    await put({ slug: 'gone', country: 'HR', lon: 14.05, missing: true });
    const host = await put({ slug: 'hosted', country: 'HR', lon: 14.2 });
    const guest = await put({
      slug: 'guest',
      country: 'HR',
      lon: 14.2,
      stars: 4,
    });
    await link(host, guest);
  });

  it('returns the published campsites in range, with distances in METRES', async () => {
    const pool = await loadPool(db, HERE);
    // 25 on the line + 'hosted' (its secondary is hidden); not too-far, not gone.
    expect(pool.map((c) => c.slug).sort()).toEqual(
      [
        ...Array.from(
          { length: 25 },
          (_, i) => `line-${String(i).padStart(2, '0')}`,
        ),
        'hosted',
      ].sort(),
    );
    const byslug = Object.fromEntries(pool.map((c) => [c.slug, c.distanceM]));
    expect(byslug['line-00']).toBeLessThan(1);
    // 0.10 degrees of longitude at 45 degrees north is about 7.9 km.
    expect(byslug['line-10']).toBeGreaterThan(7_800);
    expect(byslug['line-10']).toBeLessThan(7_950);
  });

  it('carries the amenities and the rating the way the page reads them', async () => {
    const pool = await loadPool(db, HERE);
    const by = Object.fromEntries(pool.map((c) => [c.slug, c]));
    expect(by['line-03'].amenities.electricity).toBe('yes');
    expect(by['line-04'].amenities.electricity).toBe('unknown');
    // Its rating lives on the hidden secondary.
    expect(by['hosted'].stars).toBe(4);
    expect(by['line-00'].stars).toBeNull();
  });
});
