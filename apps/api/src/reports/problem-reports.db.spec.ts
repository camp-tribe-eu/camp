import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { MAILER } from '../auth/account.service';
import { DevMailbox, MailMessage, MailSender } from '../auth/mail';
import { WarningsService } from '../warnings/warnings.service';
import { REPORT_LIMIT } from '../throttle';
import { LIMITS, PROBLEM_KINDS } from './problem-reports.rules';

// «Report a problem» — against the REAL table and the REAL application.
//
// Everything the endpoint promises is about rows that end up in Postgres and
// rows that do not; a mock would see neither. The same bench as
// `consent.db.spec.ts`: its own database `campreport_<pid>_<time>`, every
// migration, cleaned up after itself.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP. Needs CAMP_TEST_DATABASE_URL
// (locally) or CI_DATABASE_URL.
//
// 🔴 THE TWO MUTATIONS THE CARD NAMES are both caught here as well as in the
// rules spec: drop the kind check in `parseReport` and "an unknown kind is
// refused" goes red (the table's CHECK then turns the insert into a 500);
// make `contact` required there and "without a contact" goes red.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;
let app: INestApplication;
let base: string;
let spotId: string;

const SLUG = 'camping-report-test';
const PATH = '/camping/hr/istria/camping-report-test';

const box = new DevMailbox(() => undefined);
const sender: MailSender = {
  async send(m: MailMessage) {
    await box.send(m);
  },
};

const noWarnings = {
  onModuleInit: () => undefined,
  onModuleDestroy: () => undefined,
  current: () => ({}),
  callsLastCycle: () => 0,
};

type Runner = {
  up(q: QueryRunner): Promise<void>;
  down(q: QueryRunner): Promise<void>;
};

async function migrations(): Promise<Array<{ file: string; m: Runner }>> {
  const dir = join(__dirname, '..', 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  const out: Array<{ file: string; m: Runner }> = [];
  for (const file of files) {
    const mod = await import(join(dir, file));
    const Migration = Object.values(mod).find(
      (v): v is new () => Runner =>
        typeof v === 'function' && /\d{13}$/.test(v.name),
    );
    if (!Migration) throw new Error(`no migration class in ${file}`);
    out.push({ file, m: new Migration() });
  }
  return out;
}

const runnerOf = (client: Client) =>
  ({
    query: async (sql: string, params?: unknown[]) =>
      (await client.query(sql, params)).rows,
  }) as unknown as QueryRunner;

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `campreport_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.query(
    'CREATE TABLE IF NOT EXISTS migrations (id serial PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL)',
  );
  for (const { m } of await migrations()) await m.up(runnerOf(db));

  // One campsite to report about. Region "Istria" so the page address is
  // `/camping/hr/istria/…`, which is what the moderator will click.
  const seeded = await db.query(
    `INSERT INTO camping_spots (name, country, region, slug, type, location)
     VALUES ('Camping Report Test', 'hr', 'Istria', $1, 'paid',
             ST_SetSRID(ST_MakePoint(13.9, 45.1), 4326))
     RETURNING id`,
    [SLUG],
  );
  spotId = seeded.rows[0].id;

  process.env.DATABASE_URL = url.toString();
  process.env.TRUST_PROXY_CLIENT_IP = '1';
  const { AppModule } = await import('../app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue({ sender, webBase: 'https://site.example' })
    .overrideProvider(WarningsService)
    .useValue(noWarnings)
    .compile();
  app = moduleRef.createNestApplication();
  await app.listen(0);
  base = await app.getUrl();
});

afterAll(async () => {
  await app?.close();
  await db?.end();
  if (admin) {
    if (dbName)
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
});

// Each test is a different caller unless it says otherwise, so the rate limit
// under test in one place is not what another test trips over.
let callers = 0;
const nextCaller = () => `198.51.100.${(callers++ % 250) + 1}`;

type Reply = { status: number; json: any };

async function post(body: unknown, caller = nextCaller()): Promise<Reply> {
  const res = await fetch(`${base}/problem-reports`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      connection: 'close',
      'cf-connecting-ip': caller,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json };
}

const GOOD = {
  slug: SLUG,
  kind: 'closed',
  description: 'Closed since 2024; the gate is chained and the sign is gone.',
};

const rows = async () =>
  (await db.query('SELECT * FROM problem_reports ORDER BY created_at')).rows;
const count = async () =>
  Number(
    (await db.query('SELECT count(*) FROM problem_reports')).rows[0].count,
  );

describe('a report is stored', () => {
  it('🔴 WITHOUT a contact — accepted, and the row says so with NULL', async () => {
    const before = await count();
    const res = await post(GOOD);
    expect(res.status).toBe(201);
    expect(res.json).toEqual({ ok: true });

    const all = await rows();
    expect(all.length).toBe(before + 1);
    const row = all[all.length - 1];
    expect(row.contact).toBeNull();
    expect(row.kind).toBe('closed');
    expect(row.description).toBe(GOOD.description);
    expect(row.camping_spot_id).toBe(spotId);
    expect(row.spot_path).toBe(PATH);
    expect(row.status).toBe('new');
    expect(row.created_at).toBeInstanceOf(Date);
    expect(Date.now() - row.created_at.getTime()).toBeLessThan(60_000);
  });

  it('WITH a contact — accepted, and the contact is kept as typed', async () => {
    const res = await post({ ...GOOD, contact: 'owner@example.com' });
    expect(res.status).toBe(201);
    const row = (await rows()).pop();
    expect(row.contact).toBe('owner@example.com');
  });

  it('the answer carries no id and nothing from the row — there is nothing to probe', async () => {
    const res = await post(GOOD);
    expect(Object.keys(res.json)).toEqual(['ok']);
  });
});

describe('🔴 a report is refused, and nothing is written', () => {
  it('for a campsite that does not exist — 404', async () => {
    const before = await count();
    const res = await post({ ...GOOD, slug: 'camping-that-never-was' });
    expect(res.status).toBe(404);
    expect(res.json.code).toBe('unknown_campsite');
    expect(await count()).toBe(before);
  });

  it('for a description over the limit — 400 naming the field', async () => {
    const before = await count();
    const res = await post({
      ...GOOD,
      description: 'x'.repeat(LIMITS.description + 1),
    });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('invalid_report');
    expect(res.json.errors).toEqual([
      expect.objectContaining({ field: 'description', code: 'too_long' }),
    ]);
    expect(await count()).toBe(before);
  });

  it('and a description AT the limit is stored — the limit is where it says', async () => {
    const res = await post({
      ...GOOD,
      description: 'x'.repeat(LIMITS.description),
    });
    expect(res.status).toBe(201);
    expect((await rows()).pop().description).toHaveLength(LIMITS.description);
  });

  it('🔴 for a kind we do not offer — 400, before the table ever sees it', async () => {
    const before = await count();
    const res = await post({ ...GOOD, kind: 'spam' });
    expect(res.status).toBe(400);
    expect(res.json.errors).toEqual([
      expect.objectContaining({ field: 'kind', code: 'unknown' }),
    ]);
    expect(await count()).toBe(before);
  });

  it('for a body carrying a field we did not ask for — 400, not a silent drop', async () => {
    const before = await count();
    const res = await post({ ...GOOD, userAgent: 'Mozilla/5.0' });
    expect(res.status).toBe(400);
    expect(res.json.errors).toEqual([
      expect.objectContaining({ field: 'body', code: 'unknown_field' }),
    ]);
    expect(await count()).toBe(before);
  });

  it('for a body that is not an object — 400, not a 500', async () => {
    const res = await post('just a string');
    expect(res.status).toBe(400);
  });
});

describe('🔴 what the table can hold, read back from Postgres', () => {
  it('has exactly the declared columns — no IP, no browser string, no user', async () => {
    const cols = (
      await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'problem_reports' ORDER BY ordinal_position`,
      )
    ).rows.map((r) => r.column_name);
    expect(cols).toEqual([
      'id',
      'camping_spot_id',
      'spot_path',
      'kind',
      'description',
      'contact',
      'status',
      'resolution_note',
      'reviewed_at',
      'reviewed_by_directus_id',
      'created_at',
    ]);
  });

  it('refuses a kind outside the list even when code is bypassed', async () => {
    await expect(
      db.query(
        `INSERT INTO problem_reports (camping_spot_id, spot_path, kind, description)
         VALUES ($1, $2, 'spam', 'direct insert')`,
        [spotId, PATH],
      ),
    ).rejects.toThrow(/problem_reports_kind/);
  });

  it('refuses a description over the limit even when code is bypassed', async () => {
    await expect(
      db.query(
        `INSERT INTO problem_reports (camping_spot_id, spot_path, kind, description)
         VALUES ($1, $2, 'other', $3)`,
        [spotId, PATH, 'y'.repeat(LIMITS.description + 1)],
      ),
    ).rejects.toThrow(/problem_reports_description_length/);
  });

  it('every kind the API offers is a kind the table takes', async () => {
    for (const kind of PROBLEM_KINDS) {
      const res = await post({ ...GOOD, kind });
      expect(`${kind}: ${res.status}`).toBe(`${kind}: 201`);
    }
  });

  it('a report goes with its campsite when the campsite goes (ON DELETE CASCADE)', async () => {
    const other = await db.query(
      `INSERT INTO camping_spots (name, country, region, slug, type, location)
       VALUES ('Gone Soon', 'hr', 'Istria', 'camping-gone-soon', 'paid',
               ST_SetSRID(ST_MakePoint(13.8, 45.2), 4326)) RETURNING id`,
    );
    const res = await post({ ...GOOD, slug: 'camping-gone-soon' });
    expect(res.status).toBe(201);
    const mine = async () =>
      Number(
        (
          await db.query(
            'SELECT count(*) FROM problem_reports WHERE camping_spot_id = $1',
            [other.rows[0].id],
          )
        ).rows[0].count,
      );
    expect(await mine()).toBe(1);
    await db.query('DELETE FROM camping_spots WHERE id = $1', [
      other.rows[0].id,
    ]);
    expect(await mine()).toBe(0);
  });
});

describe('🔴 the rate limit — the spam guard, measured on the running app', () => {
  it(`one caller gets ${REPORT_LIMIT.limit} in the window and the next is 429`, async () => {
    const caller = '203.0.113.77';
    const statuses: number[] = [];
    for (let i = 0; i < REPORT_LIMIT.limit; i++) {
      statuses.push((await post(GOOD, caller)).status);
    }
    expect(statuses).toEqual(Array(REPORT_LIMIT.limit).fill(201));
    const before = await count();
    const sixth = await post(GOOD, caller);
    expect(sixth.status).toBe(429);
    expect(await count()).toBe(before);
  });

  it('a spent bucket is this caller’s, not everyone’s', async () => {
    const res = await post(GOOD, '203.0.113.78');
    expect(res.status).toBe(201);
  });

  it('and reading a campsite page does not spend it — the bucket is its own', async () => {
    const caller = '203.0.113.79';
    for (let i = 0; i < REPORT_LIMIT.limit + 2; i++) {
      const res = await fetch(`${base}/spots/countries`, {
        headers: { 'cf-connecting-ip': caller, connection: 'close' },
      });
      expect(res.status).toBe(200);
    }
    expect((await post(GOOD, caller)).status).toBe(201);
  });

  it('a refused report still counts — a flood of garbage is still a flood', async () => {
    const caller = '203.0.113.80';
    for (let i = 0; i < REPORT_LIMIT.limit; i++) {
      expect((await post({ ...GOOD, kind: 'spam' }, caller)).status).toBe(400);
    }
    expect((await post(GOOD, caller)).status).toBe(429);
  });
});

describe('there is no way to read reports over HTTP', () => {
  it('GET /problem-reports is not a route', async () => {
    const res = await fetch(`${base}/problem-reports`, {
      headers: { 'cf-connecting-ip': nextCaller(), connection: 'close' },
    });
    expect(res.status).toBe(404);
  });
});
