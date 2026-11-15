import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import type { ParsedSpot } from './parse';
import {
  GONE_SQL,
  HELD_SQL,
  TOUCH_SQL,
  applyRefresh,
  planRefresh,
  type Held,
} from './refresh';

// CAMP-528 — the refresh against a REAL database.
//
// 🔴 The questions are all about what is left in the rows afterwards:
// did `last_seen_at` move, was anything inserted or deleted, did an OSM
// row get touched, did <lastmod> follow a mere re-dating. None of that
// is visible in the SQL text; it is read back from the table.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP. Needs
// CAMP_TEST_DATABASE_URL (locally) or CI_DATABASE_URL (CI). The suite
// creates its own `camp528t_*` database and drops it.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(180_000);

let admin: Client;
let db: Client;
let dbName: string;

type Runner = { up(q: QueryRunner): Promise<void> };

async function migrateAll(client: Client) {
  const dir = join(__dirname, '..', 'migrations');
  const runner = {
    query: async (sql: string, params?: unknown[]) =>
      (await client.query(sql, params)).rows,
  } as unknown as QueryRunner;
  await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await client.query(
    'CREATE TABLE IF NOT EXISTS migrations (id serial PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL)',
  );
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort()) {
    const mod = await import(join(dir, file));
    const Migration = Object.values(mod).find(
      (v): v is new () => Runner =>
        typeof v === 'function' && /\d{13}$/.test(v.name),
    );
    if (!Migration) throw new Error(`no migration class in ${file}`);
    await new Migration().up(runner);
  }
}

const LOADED = '2026-09-24T10:39:06.000Z';
const ref = (k: string) => `https://data.datatourisme.fr/13/test-${k}`;

async function dtRow(k: string, over: { missing?: string } = {}) {
  const r = await db.query<{ id: string }>(
    `INSERT INTO camping_spots
       (name, country, region, slug, type, location, description,
        description_lang, stars, website, sources, last_seen_at, missing_since)
     VALUES ($1, 'FR', 'Var', $2, 'paid',
             ST_SetSRID(ST_MakePoint(5.2, 45.1), 4326), 'Au bord du lac.',
             'fr', 3, 'https://example.test', $3::jsonb, $4, $5)
     RETURNING id`,
    [
      `Camping ${k}`,
      `camping-528-${k}`,
      JSON.stringify([
        {
          id: 'datatourisme',
          ref: ref(k),
          updatedAt: '2026-09-01',
          fields: ['stars'],
        },
      ]),
      LOADED,
      over.missing ?? null,
    ],
  );
  return r.rows[0].id;
}

const spot = (k: string, over: Partial<ParsedSpot> = {}): ParsedSpot => ({
  ref: ref(k),
  name: `Camping ${k}`,
  lat: 45.1,
  lon: 5.2,
  stars: 3,
  description: 'Au bord du lac.',
  address: null,
  postcode: null,
  commune: null,
  website: 'https://example.test',
  updatedAt: '2026-09-01',
  accessibilityMarks: [],
  ...over,
});

async function read(id: string) {
  const r = await db.query(
    `SELECT name, description, stars::int AS stars, website, last_seen_at,
            missing_since, content_changed_at, sources, slug, region,
            ST_Y(location::geometry) AS lat, owner_overrides
       FROM camping_spots WHERE id = $1`,
    [id],
  );
  expect(r.rowCount).toBe(1);
  return r.rows[0];
}

const heldRows = async () =>
  (await db.query<Held>(HELD_SQL)).rows.map((h) => ({
    ...h,
    lat: Number(h.lat),
    lon: Number(h.lon),
  }));

const ids: Record<string, string> = {};
let osmId: string;
let osmBefore: string;
const RUN = new Date('2026-11-13T05:00:00.000Z');

const osmText = async () =>
  (
    await db.query(
      `SELECT md5(s::text) AS h FROM camping_spots s WHERE id = $1`,
      [osmId],
    )
  ).rows[0].h as string;

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp528t_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await migrateAll(db);

  // Ballast, so that one gone row out of many stays under the 5% limit.
  for (let i = 0; i < 30; i++) ids[`b${i}`] = await dtRow(`b${i}`);
  ids.same = await dtRow('same');
  ids.redated = await dtRow('redated');
  ids.changed = await dtRow('changed');
  ids.gone = await dtRow('gone');
  ids.folded = await dtRow('folded');
  ids.back = await dtRow('back', { missing: '2026-10-01T00:00:00Z' });

  // 🔴 An OSM row that ALSO carries a datatourisme source entry — the
  // shape `import.ts` produces when it merges. The refresh must not see
  // it as its own, whatever its `sources` say.
  const osm = await db.query<{ id: string }>(
    `INSERT INTO camping_spots
       (name, country, region, slug, type, location, osm_ref, sources, last_seen_at)
     VALUES ('Camping OSM', 'FR', 'Var', 'camping-528-osm', 'paid',
             ST_SetSRID(ST_MakePoint(5.2, 45.1), 4326), 'way/528', $1::jsonb, $2)
     RETURNING id`,
    [
      JSON.stringify([
        {
          id: 'datatourisme',
          ref: ref('same'),
          updatedAt: '2026-09-01',
          fields: [],
        },
      ]),
      LOADED,
    ],
  );
  osmId = osm.rows[0].id;
  await db.query(
    `INSERT INTO spot_links (primary_id, secondary_id, metres, name_similarity, rule)
     VALUES ($1, $2, 10, 1, 'test')`,
    [osmId, ids.folded],
  );
  osmBefore = await osmText();

  const parsed = [
    ...Array.from({ length: 30 }, (_, i) => spot(`b${i}`)),
    spot('same'),
    spot('redated', { updatedAt: '2026-11-10' }),
    spot('changed', {
      updatedAt: '2026-11-11',
      name: 'Camping Renommé',
      description: null,
      stars: null,
      website: 'https://autre.test',
      lat: 46.0,
    }),
    spot('back'),
    spot('brand-new'),
  ];
  const p = planRefresh(await heldRows(), parsed);
  expect(p.refusal).toBeNull();
  await applyRefresh(db, p, RUN);
});

afterAll(async () => {
  await db?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin?.end();
});

describe('DATAtourisme refresh against a real table (CAMP-528)', () => {
  it('🔴 a record seen again gets this run as last_seen_at — the column the freshness guard reads', async () => {
    const r = await read(ids.same);
    expect(r.last_seen_at.toISOString()).toBe(RUN.toISOString());
    expect(r.content_changed_at).toBeNull();
    const guard = await db.query(
      `SELECT max(last_seen_at) AS m FROM camping_spots
        WHERE osm_ref IS NULL AND sources @> '[{"id":"datatourisme"}]'`,
    );
    expect(guard.rows[0].m.toISOString()).toBe(RUN.toISOString());
  });

  it('🔴 a re-dated record carries the new source date and <lastmod> does NOT move', async () => {
    const r = await read(ids.redated);
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]).toMatchObject({
      ref: ref('redated'),
      updatedAt: '2026-11-10',
    });
    expect(r.content_changed_at).toBeNull();
  });

  it('🔴 a changed record mirrors the source, and only then <lastmod> moves', async () => {
    const r = await read(ids.changed);
    expect(r).toMatchObject({
      name: 'Camping Renommé',
      description: null,
      stars: null,
      website: 'https://autre.test',
    });
    expect(r.content_changed_at.toISOString()).toBe(RUN.toISOString());
    expect(r.sources[0].updatedAt).toBe('2026-11-11');
  });

  it('🔴 the point, the slug and the region never move', async () => {
    const r = await read(ids.changed);
    expect(Number(r.lat)).toBeCloseTo(45.1, 6);
    expect(r.slug).toBe('camping-528-changed');
    expect(r.region).toBe('Var');
  });

  it('🔴 an absent record is stamped missing — and is still a row', async () => {
    const r = await read(ids.gone);
    expect(r.missing_since.toISOString()).toBe(RUN.toISOString());
    expect(r.last_seen_at.toISOString()).toBe(LOADED);
  });

  it('🔴 an absent record folded into a live OSM page is NOT stamped', async () => {
    const r = await read(ids.folded);
    expect(r.missing_since).toBeNull();
  });

  // 🔴 The plan already keeps folded rows out of `gone`; this asks the
  // SQL on its own, because the plan is computed from a read made before
  // the transaction and a link can appear in between.
  it('🔴 GONE_SQL itself refuses a folded row, even when handed its id', async () => {
    const r = await db.query(GONE_SQL, [RUN, [ids.folded]]);
    expect(r.rowCount).toBe(0);
    expect((await read(ids.folded)).missing_since).toBeNull();
  });

  it('🔴 TOUCH_SQL itself refuses an OSM row, even when handed its id', async () => {
    const r = await db.query(TOUCH_SQL, [RUN, [osmId]]);
    expect(r.rowCount).toBe(0);
    expect(await osmText()).toBe(osmBefore);
  });

  it('a record that came back is un-stamped', async () => {
    const r = await read(ids.back);
    expect(r.missing_since).toBeNull();
    expect(r.last_seen_at.toISOString()).toBe(RUN.toISOString());
  });

  it('🔴 nothing is inserted and nothing is deleted', async () => {
    const n = await db.query(`SELECT count(*)::int AS n FROM camping_spots`);
    expect(n.rows[0].n).toBe(37); // 30 ballast + 6 named + 1 OSM
    const fresh = await db.query(
      `SELECT count(*)::int AS n FROM camping_spots WHERE sources @> $1::jsonb`,
      [JSON.stringify([{ ref: ref('brand-new') }])],
    );
    expect(fresh.rows[0].n).toBe(0);
  });

  it('🔴 an OSM row is byte-identical afterwards, even one carrying a datatourisme entry', async () => {
    expect(await osmText()).toBe(osmBefore);
  });

  it('🔴 a second run with the same files changes nothing but the stamp', async () => {
    const before = await db.query(
      `SELECT md5(string_agg(md5((to_jsonb(s) - 'last_seen_at')::text), '' ORDER BY id)) AS h
         FROM camping_spots s`,
    );
    const parsed = [
      ...Array.from({ length: 30 }, (_, i) => spot(`b${i}`)),
      spot('same'),
      spot('redated', { updatedAt: '2026-11-10' }),
      spot('changed', {
        updatedAt: '2026-11-11',
        name: 'Camping Renommé',
        description: null,
        stars: null,
        website: 'https://autre.test',
        lat: 46.0,
      }),
      spot('back'),
      spot('brand-new'),
    ];
    const p = planRefresh(await heldRows(), parsed);
    expect(p.seen.filter((s) => s.dateChanged || s.contentChanged)).toEqual([]);
    expect(p.gone).toEqual([]);
    const again = new Date('2026-11-20T05:00:00.000Z');
    const w = await applyRefresh(db, p, again);
    expect(w).toMatchObject({
      updated: 0,
      contentChanged: 0,
      stamped: 0,
      touched: 34,
    });
    const after = await db.query(
      `SELECT md5(string_agg(md5((to_jsonb(s) - 'last_seen_at')::text), '' ORDER BY id)) AS h
         FROM camping_spots s`,
    );
    expect(after.rows[0].h).toBe(before.rows[0].h);
    expect((await read(ids.same)).last_seen_at.toISOString()).toBe(
      again.toISOString(),
    );
  });

  it('🔴 a refused plan writes nothing at all', async () => {
    const before = await db.query(
      `SELECT md5(string_agg(md5(s::text), '' ORDER BY id)) AS h FROM camping_spots s`,
    );
    const p = planRefresh(await heldRows(), [spot('same')]);
    expect(p.refusal).toMatch(/stamped missing/);
    await expect(applyRefresh(db, p, new Date())).rejects.toThrow(
      /stamped missing/,
    );
    const after = await db.query(
      `SELECT md5(string_agg(md5(s::text), '' ORDER BY id)) AS h FROM camping_spots s`,
    );
    expect(after.rows[0].h).toBe(before.rows[0].h);
  });

  it('--no-mark-missing stamps the seen and leaves the absent alone', async () => {
    const p = planRefresh(await heldRows(), [spot('same')], {
      markMissing: false,
    });
    expect(p.refusal).toBeNull();
    const at = new Date('2026-11-27T05:00:00.000Z');
    const w = await applyRefresh(db, p, at, { markMissing: false });
    expect(w).toMatchObject({ touched: 1, stamped: 0 });
    expect((await read(ids.b0)).missing_since).toBeNull();
    expect((await read(ids.same)).last_seen_at.toISOString()).toBe(
      at.toISOString(),
    );
  });

  // 🔴 The queries are taken from the script that ships, not copied, and
  // run against a real table: the claim "each source is read apart" is
  // about what PostgreSQL returns. Before CAMP-528 one unfiltered
  // max(last_seen_at) let weekly OSM hide 50 days of DATAtourisme.
  it('🔴 the freshness guard reads the two sources apart — neither hides the other', async () => {
    const script = pathToFileURL(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'scripts',
        'ci',
        'check-data-freshness.mjs',
      ),
    ).href;
    type Src = { table: string; card: string };
    const mod = (await import(script)) as {
      DB_SOURCES: readonly Src[];
      probeSql: (s: Src) => string;
    };
    const probe = async (card: string) => {
      const src = mod.DB_SOURCES.find(
        (x) => x.table === 'camping_spots' && x.card === card,
      ) as Src;
      const [rows, stamp] = Object.values(
        (await db.query(mod.probeSql(src))).rows[0] as Record<string, string>,
      );
      return { rows: Number(rows), stamp };
    };
    // OSM is far fresher than anything DATAtourisme has…
    await db.query(
      `UPDATE camping_spots SET last_seen_at = '2027-01-01T00:00:00Z' WHERE id = $1`,
      [osmId],
    );
    // …and the DATAtourisme row still reports its own last run, over its own 36 rows.
    expect(await probe('CAMP-528')).toEqual({
      rows: 36,
      stamp: '2026-11-27T05:00:00Z',
    });
    expect(await probe('CAMP-28')).toEqual({
      rows: 1,
      stamp: '2027-01-01T00:00:00Z',
    });
    // And the other way round: a stale OSM is not rescued by DATAtourisme.
    await db.query(
      `UPDATE camping_spots SET last_seen_at = '2026-01-01T00:00:00Z' WHERE id = $1`,
      [osmId],
    );
    expect((await probe('CAMP-28')).stamp).toBe('2026-01-01T00:00:00Z');
  });
});
