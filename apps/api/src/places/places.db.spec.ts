/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { PlacesModule } from './places.module';
import { PlacesService } from './places.service';

// CAMP-456 — `GET /places/suggest` and `GET /places/campsite/:slug` over a REAL
// PostgreSQL, through the real controller, service and Nest's wiring.
//
// 🔴 THE CORPUS DOES NOT SHARE A FIELD WITH WHAT IT MEASURES. Every place,
// region and campsite below is a row written by hand in this file, at
// coordinates chosen here; the five "countries" are boxes drawn here. "Antrim is
// outside the Union" is a fact of the box named GB, not of anything the service
// read back from the table it is checking. The expected answers are written out
// as literals, not computed by the code under test.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP (the same convention as the
// planner's other DB specs): CAMP_TEST_DATABASE_URL, or CI_DATABASE_URL in CI.
// This file creates its own `camp456_*` database and drops it.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;
let app: INestApplication;
let base: string;
let dataSource: DataSource;
let service: PlacesService;

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp456_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
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
    CREATE TABLE ne_admin1 (
      ogc_fid serial PRIMARY KEY,
      geom geometry(MultiPolygon, 4326),
      name varchar(44), name_en varchar(47), admin varchar(36),
      iso_a2 varchar(2), iso_3166_2 varchar(8), type_en varchar(27));
    CREATE INDEX ne_admin1_geom_gist ON ne_admin1 USING gist (geom);
    CREATE TABLE osm_ctx_place (
      ogc_fid serial PRIMARY KEY, id varchar, name varchar, place varchar,
      geom geometry(MultiPoint, 4326));`);
  await build();

  const moduleRef = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'postgres',
        url: url.toString(),
        entities: [],
        synchronize: false,
      }),
      PlacesModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0);
  base = await app.getUrl();
  dataSource = app.get(DataSource);
  service = app.get(PlacesService);
});

afterAll(async () => {
  await app?.close();
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

// ---------------------------------------------------------------------------
// The corpus, by hand
// ---------------------------------------------------------------------------

/** [west, south, east, north], degrees: one box per "country". */
const BOXES: Array<
  [iso: string, name: string, box: [number, number, number, number]]
> = [
  ['HR', 'Hrvatska', [13.0, 42.0, 19.5, 46.0]],
  ['SI', 'Slovenija', [13.0, 46.0, 16.6, 47.4]],
  ['AX', 'Åland', [19.5, 59.8, 21.0, 60.6]],
  ['GB', 'Antrim county', [-8.0, 50.0, 2.0, 59.0]],
  ['CY', 'Lefkosia', [32.0, 34.5, 34.7, 35.7]],
  // A second HR region whose local and English names BOTH start with "kvar": one
  // place, two spellings — typing the shared start must give it once.
  ['HR', 'Kvarner', [14.0, 44.5, 15.0, 45.5]],
];

/** Places: [name, place, lon, lat]. */
const PLACES: Array<[string, string, number, number]> = [
  ['Antwerpen', 'city', 14.0, 45.0], // in the HR box on purpose: the country comes from the BOX, not the name
  ['Antibor', 'town', 14.5, 45.2],
  ['Ant', 'village', 15.0, 44.0],
  ['Antrim', 'town', -6.2, 54.7], // GB: outside the Union
  ['Antalya-Cyprus', 'village', 33.0, 35.0], // CY: hidden by the owner's decision
  ['Antlers on Åland', 'village', 20.0, 60.0], // AX: Finland
  ['Žabljak', 'village', 15.5, 44.5],
  ['Saint-Tropez', 'town', 14.8, 44.8],
  ['Hamlet of Ant', 'hamlet', 15.1, 44.1], // not city|town|village: never offered
  ['Offshore Hr', 'village', 14.0, 41.9], // 0.1° south of the HR box: a coastal row, nearest polygon is HR
  ['Offshore Gb', 'village', -8.5, 52.0], // 0.5° west of the GB box: nearest polygon is GB, a non-member
];

async function build(): Promise<void> {
  for (const [iso, name, [w, s, e, n]] of BOXES) {
    await db.query(
      `INSERT INTO ne_admin1 (geom, name, name_en, admin, iso_a2)
       VALUES (ST_Multi(ST_MakeEnvelope($1, $2, $3, $4, 4326)), $5, $6, $5, $7)`,
      [
        w,
        s,
        e,
        n,
        name,
        { Hrvatska: 'Croatia', Kvarner: 'Kvarner Bay' }[name] ?? name,
        iso,
      ],
    );
  }
  // A region with a local name and an English one, drawn as the HR box above:
  // typing either finds it, and it is ONE suggestion, not two.
  for (const [name, place, lon, lat] of PLACES) {
    await db.query(
      `INSERT INTO osm_ctx_place (id, name, place, geom)
       VALUES ($1, $2, $3, ST_Multi(ST_SetSRID(ST_MakePoint($4, $5), 4326)))`,
      [`n${name}`, name, place, lon, lat],
    );
  }
  const camp = async (
    slug: string,
    name: string | null,
    country: string,
    region: string | null,
    lon: number,
    lat: number,
    missing = false,
  ) =>
    (
      await db.query(
        `INSERT INTO camping_spots (slug, name, country, region, location, missing_since)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7)
         RETURNING id`,
        [slug, name, country, region, lon, lat, missing ? new Date() : null],
      )
    ).rows[0].id as string;

  await camp('camping-ant', 'Camping Ant', 'HR', 'Zadar', 15.2, 44.2);
  await camp('plain-camp', 'Plain Camp Antelope', 'HR', 'Zadar', 15.3, 44.3);
  await camp('gone-ant', 'Gone Ant', 'HR', 'Zadar', 15.4, 44.4, true);
  await camp('nameless-ant', null, 'HR', 'Zadar', 15.5, 44.1);
  await camp('no-region-ant', 'Ant Without Region', 'HR', null, 15.6, 44.1);
  await camp('cy-ant', 'Cyprus Ant Camp', 'CY', 'Larnaca', 33.1, 35.1);
  // A campsite is often two rows: the OSM primary has no name, the tourist
  // office's secondary does. The page, the map and the search call it by the
  // secondary's name — and the secondary is never offered as a place of its own.
  const primary = await camp('linked-primary', null, 'HR', 'Zadar', 15.7, 44.2);
  const secondary = await camp(
    'linked-secondary',
    'Antonia Linked Camp',
    'HR',
    'Zadar',
    15.7,
    44.2,
  );
  await db.query(
    `INSERT INTO spot_links (primary_id, secondary_id) VALUES ($1, $2)`,
    [primary, secondary],
  );
}

const suggest = async (q: unknown, limit?: unknown) => {
  const res = await fetch(`${base}/places/suggest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q, limit }),
  });
  return { status: res.status, body: (await res.json()) as any };
};

const names = (items: any[]) =>
  items.map((i) => `${i.kind}:${i.name}:${i.country}`);

// ---------------------------------------------------------------------------

describe('GET /places/suggest', () => {
  it('"ant" gives the city, a town, the village — each with its kind and ITS country, from the box it sits in', async () => {
    const { status, body } = await suggest('ant');
    expect(status).toBe(200);
    const got = names(body.items);
    expect(got).toContain('city:Antwerpen:hr');
    expect(got).toContain('town:Antibor:hr');
    expect(got).toContain('village:Ant:hr');
  });

  it('🔴 every item carries kind, name, country and finite coordinates inside the sphere', async () => {
    const { body } = await suggest('ant');
    expect(body.items.length).toBeGreaterThan(3);
    for (const i of body.items) {
      expect(['city', 'town', 'village', 'region', 'campsite']).toContain(
        i.kind,
      );
      expect(typeof i.name).toBe('string');
      expect(i.country).toMatch(/^[a-z]{2}$/);
      expect(Math.abs(i.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(i.lon)).toBeLessThanOrEqual(180);
    }
  });

  it('coordinates are the ones written into the row, to the digit', async () => {
    const { body } = await suggest('antibor');
    expect(body.items[0]).toMatchObject({
      kind: 'town',
      name: 'Antibor',
      lat: 45.2,
      lon: 14.5,
    });
  });

  it('🔴 outside the Union is not offered: a GB town, a hidden Cyprus place and a Cyprus campsite never appear', async () => {
    const all = names((await suggest('ant', 10)).body.items).join(' | ');
    expect(all).not.toContain('Antrim');
    expect(all).not.toContain('Antalya');
    expect(all).not.toContain('Cyprus Ant Camp');
    // And typed on its own, the result is empty, not "the nearest thing".
    expect((await suggest('antrim')).body.items).toEqual([]);
    expect((await suggest('antalya')).body.items).toEqual([]);
  });

  it('🔴 a place inside no polygon belongs to the NEAREST one: a coastal row is offered, one nearer a non-member is not', async () => {
    expect(names((await suggest('offshore hr')).body.items)).toEqual([
      'village:Offshore Hr:hr',
    ]);
    expect((await suggest('offshore gb')).body.items).toEqual([]);
  });

  it('Åland is Finland: the source writes AX, the answer says fi', async () => {
    const { body } = await suggest('antlers');
    expect(names(body.items)).toEqual(['village:Antlers on Åland:fi']);
  });

  it('🔴 a hamlet is not a city, town or village: never offered, however well the name matches', async () => {
    expect(names((await suggest('hamlet')).body.items)).toEqual([]);
  });

  it('🔴 diacritics fold both ways: "zab" finds Žabljak, "žab" too, and "saint tropez" finds Saint-Tropez', async () => {
    expect(names((await suggest('zab')).body.items)).toEqual([
      'village:Žabljak:hr',
    ]);
    expect(names((await suggest('žab')).body.items)).toEqual([
      'village:Žabljak:hr',
    ]);
    expect(names((await suggest('saint tropez')).body.items)).toEqual([
      'town:Saint-Tropez:hr',
    ]);
    expect(names((await suggest('SAINT-TRO')).body.items)).toEqual([
      'town:Saint-Tropez:hr',
    ]);
  });

  it('a word in the middle of a name matches at the START of that word, never mid-word, and ranks after names that start with the text', async () => {
    expect(names((await suggest('antelope')).body.items)).toEqual([
      'campsite:Plain Camp Antelope:hr',
    ]);
    // Mid-word: "elope" is inside "Antelope", and that is not a match.
    expect((await suggest('elope')).body.items).toEqual([]);
    const both = names((await suggest('ant', 10)).body.items);
    const leaders = [
      'city:Antwerpen:hr',
      'town:Antibor:hr',
      'village:Ant:hr',
      'campsite:Antonia Linked Camp:hr',
    ];
    const followers = [
      'campsite:Camping Ant:hr',
      'campsite:Plain Camp Antelope:hr',
    ];
    for (const l of leaders) expect(both).toContain(l);
    for (const f of followers) {
      expect(both).toContain(f);
      for (const l of leaders)
        expect(both.indexOf(f)).toBeGreaterThan(both.indexOf(l));
    }
  });

  it('🔴 campsites: unpublished are never offered — gone, nameless, region-less, hidden country', async () => {
    const got = names((await suggest('ant', 10)).body.items).filter((n) =>
      n.startsWith('campsite'),
    );
    expect(got).toContain('campsite:Camping Ant:hr');
    for (const bad of ['Gone Ant', 'Ant Without Region', 'Cyprus Ant Camp']) {
      expect(got.join('|')).not.toContain(bad);
    }
  });

  it('🔴 a campsite named only by its linked secondary is offered by that name, and the secondary is not offered on its own', async () => {
    const { body } = await suggest('antonia');
    expect(names(body.items)).toEqual(['campsite:Antonia Linked Camp:hr']);
    expect(body.items[0].slug).toBe('linked-primary');
    expect(body.items[0].path).toBe('/camping/hr/zadar/linked-primary');
  });

  it('a campsite carries its slug and the page address; others carry neither', async () => {
    const { body } = await suggest('camping ant');
    const camp = body.items.find((i: any) => i.kind === 'campsite');
    expect(camp).toMatchObject({
      slug: 'camping-ant',
      path: '/camping/hr/zadar/camping-ant',
    });
    const place = (await suggest('antibor')).body.items[0];
    expect(place).not.toHaveProperty('slug');
    expect(place).not.toHaveProperty('path');
  });

  it('🔴 a region with a local name and an English one is ONE suggestion, whichever the reader typed', async () => {
    const local = names((await suggest('hrva')).body.items);
    const english = names((await suggest('croa')).body.items);
    expect(local).toEqual(['region:Hrvatska:hr']);
    expect(english).toEqual(['region:Croatia:hr']);
    // "Hrvatska" and "Croatia" share a point: asking for both words' prefixes never returns the pair.
    const both = (await suggest('hrvatska')).body.items.filter(
      (i: any) => i.kind === 'region',
    );
    expect(both).toHaveLength(1);
  });

  it('🔴 a region whose two names both match the text is ONE suggestion, shown under the local one', async () => {
    const regions = (await suggest('kvar')).body.items.filter(
      (i: any) => i.kind === 'region',
    );
    expect(names(regions)).toEqual(['region:Kvarner:hr']);
    // The English spelling alone finds it too, and shows the English spelling it was typed in.
    const english = (await suggest('kvarner bay')).body.items.filter(
      (i: any) => i.kind === 'region',
    );
    expect(names(english)).toEqual(['region:Kvarner Bay:hr']);
  });

  it('🔴 a region whose two names are the same word is still ONE suggestion', async () => {
    const regions = (await suggest('aland')).body.items.filter(
      (i: any) => i.kind === 'region',
    );
    expect(names(regions)).toEqual(['region:Åland:fi']);
  });

  it('the United Kingdom and Cyprus regions are not offered either', async () => {
    expect((await suggest('antrim county')).body.items).toEqual([]);
    expect((await suggest('lefkosia')).body.items).toEqual([]);
  });

  it('limit is honoured, and the same query twice gives the same answer', async () => {
    const two = (await suggest('ant', 2)).body.items;
    expect(two).toHaveLength(2);
    expect((await suggest('ant', 2)).body.items).toEqual(two);
  });

  it('🔴 the answer is a 400 with a code, never a 500, for every malformed request', async () => {
    const cases: Array<[string, string]> = [
      ['', 'query_too_short'],
      ['ab', 'query_too_short'],
      ['%%%', 'query_too_short'],
      ['%_%', 'query_too_short'],
      ['a'.repeat(61), 'query_too_long'],
    ];
    for (const [q, code] of cases) {
      const r = await suggest(q);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe(code);
    }
    for (const limit of [0, 11, -1, 'x', '3', 1.5, 999, null, [3]]) {
      const r = await suggest('ant', limit);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('limit_invalid');
    }
    // Nothing, a bare string, an array, a number, or not JSON at all: 400, never 500.
    for (const raw of ['', '"ant"', '["ant"]', '5', '{']) {
      const res = await fetch(`${base}/places/suggest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: raw,
      });
      expect([400, 500]).toContain(res.status);
      expect(res.status).toBe(400);
    }
    for (const q of [undefined, null, 5, ['ant', 'ant'], { q: 'ant' }]) {
      const r = await suggest(q);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('query_missing');
    }
    // And the old way of asking, in the address, is not a way: the typed letters never go there.
    const get = await fetch(`${base}/places/suggest?q=ant`);
    expect(get.status).toBe(404);
  });

  it('wildcard characters are punctuation, not patterns: "ant%" asks for "ant", and "%%%" asks for nothing', async () => {
    const plain = names((await suggest('ant')).body.items);
    expect(plain.length).toBeGreaterThan(3);
    expect(names((await suggest('ant%')).body.items)).toEqual(plain);
    expect(names((await suggest('a_nt')).body.items)).toEqual(
      names((await suggest('ant')).body.items),
    );
  });

  it('🔴 a new campsite appears in the suggestions only after the index is rebuilt, and in by-slug at once', async () => {
    await db.query(
      `INSERT INTO camping_spots (slug, name, country, region, location)
       VALUES ('fresh-ant', 'Freshant Camp', 'HR', 'Zadar', ST_SetSRID(ST_MakePoint(15.9, 44.9), 4326))`,
    );
    expect((await suggest('freshant')).body.items).toEqual([]);
    const direct = await fetch(`${base}/places/campsite/fresh-ant`);
    expect(direct.status).toBe(200);
    service.invalidate();
    expect(names((await suggest('freshant')).body.items)).toEqual([
      'campsite:Freshant Camp:hr',
    ]);
  });
});

describe('GET /places/campsite/:slug', () => {
  const get = async (slug: string) => {
    const res = await fetch(`${base}/places/campsite/${slug}`);
    return { status: res.status, body: (await res.json()) as any };
  };

  it('a published campsite: name, country, coordinates and the page address', async () => {
    const { status, body } = await get('camping-ant');
    expect(status).toBe(200);
    expect(body).toEqual({
      kind: 'campsite',
      name: 'Camping Ant',
      country: 'hr',
      lat: 44.2,
      lon: 15.2,
      slug: 'camping-ant',
      path: '/camping/hr/zadar/camping-ant',
    });
  });

  it('a campsite named only by its secondary is found under its own slug', async () => {
    expect((await get('linked-primary')).body.name).toBe('Antonia Linked Camp');
  });

  it('🔴 404 with a code for: unknown, gone, hidden country, secondary, nameless, region-less', async () => {
    for (const slug of [
      'nope',
      'gone-ant',
      'cy-ant',
      'linked-secondary',
      'nameless-ant',
      'no-region-ant',
    ]) {
      const r = await get(slug);
      expect(r.status).toBe(404);
      expect(r.body.code).toBe('unknown_campsite');
    }
  });

  it('🔴 a slug that is not a slug never reaches the database: 404, not 500', async () => {
    const seen: string[] = [];
    const real = dataSource.createQueryRunner.bind(dataSource);
    const spy = jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockImplementation((...args) => {
        seen.push('runner');
        return real(...args);
      });
    try {
      for (const slug of [
        '..%2Fetc',
        'UPPER',
        'a%20b',
        '-x',
        'x'.repeat(201),
        '%00',
      ]) {
        const r = await get(slug);
        expect(r.status).toBe(404);
      }
      expect(seen).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('what the database is told', () => {
  it('🔴 every read is inside a READ ONLY transaction, and nothing in the request writes', async () => {
    const seen: string[] = [];
    const real = dataSource.createQueryRunner.bind(dataSource);
    // A fresh index would read all tables once; a warm one only resolves countries.
    service.invalidate();
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
      expect((await suggest('ant')).status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expect(seen.length).toBeGreaterThan(4);
    // Each transaction starts READ ONLY and ends; none writes.
    const begins = seen.filter((s) => s.startsWith('BEGIN'));
    expect(begins.length).toBeGreaterThanOrEqual(2);
    for (const b of begins)
      expect(b).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(seen.filter((s) => s.startsWith('COMMIT'))).toHaveLength(
      begins.length,
    );
    expect(
      seen.filter((s) =>
        /^(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP|ALTER|COPY|GRANT)\b/i.test(
          s,
        ),
      ),
    ).toEqual([]);
    // The text the reader typed is never part of a statement: it only ever
    // reached the in-memory index, and the country lookup carries coordinates.
    expect(seen.join('\n').toLowerCase()).not.toContain("'ant'");
  });

  it('the server really refuses a write in that transaction', async () => {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await expect(
      db.query(`INSERT INTO osm_ctx_place (name, place) VALUES ('x', 'town')`),
    ).rejects.toMatchObject({ code: '25006' });
    await db.query('ROLLBACK');
  });

  it('🔴 a failed index build is not remembered: the next request tries again and succeeds', async () => {
    service.invalidate();
    const real = dataSource.createQueryRunner.bind(dataSource);
    let once = true;
    const spy = jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockImplementation((...args) => {
        if (once) {
          once = false;
          throw new Error('pool exhausted');
        }
        return real(...args);
      });
    try {
      expect((await suggest('ant')).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect((await suggest('ant')).status).toBe(200);
  });
});
