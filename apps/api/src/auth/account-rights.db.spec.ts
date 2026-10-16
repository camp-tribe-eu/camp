import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { DevMailbox, MailMessage, MailSender } from './mail';
import { WarningsService } from '../warnings/warnings.service';
import { AccountRightsService } from './account-rights.service';
import { AccountService, MAILER } from './account.service';

// CAMP-229 (3/3) — export (GDPR 15) and erasure (GDPR 17), against a REAL
// PostgreSQL and the REAL application.
//
// 🔴 THE SCREEN'S PROMISES ARE TESTED, NOT THE FUNCTIONS THAT KEEP THEM. The
// delete screen says: access ends at once; nothing is chosen for you; the
// photos are dealt with as you chose; what stays has no name in it; you can get
// back in for thirty days with the same password and not after. Each of those is
// a sentence about what a stranger or the owner can observe over HTTP and what
// the database holds afterwards, so every one is asserted that way: the app is
// the whole `AppModule` on a database built by every migration in order, the
// calls are real HTTP, and the state afterwards is read with SQL the service
// did not write.
//
// 🔴 EVERY "DOES NOT CONTAIN" HAS A "DOES CONTAIN" BESIDE IT. A search that
// finds nothing is green when the file is empty, when the table is the wrong
// one, and when the query is broken. So the archive is searched for the
// person's own trip name AND for their address before it is searched for the
// password hash, and the database is searched for the address before the purge
// (where it MUST be found) and after it (where it must not).
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP. Needs CAMP_TEST_DATABASE_URL
// (locally) or CI_DATABASE_URL (CI sets it). This file creates its own
// `camp229gdpr_*` database and drops it; it touches nothing in the one you name.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;
let app: INestApplication;
let base: string;

const box = new DevMailbox(() => undefined);
const sender: MailSender = {
  async send(m: MailMessage) {
    await box.send(m);
  },
};
const WEB = 'https://site.example';

/** Same reason as `account.db.spec.ts`: this file must not reach the internet. */
const noWarnings = {
  onModuleInit: () => undefined,
  onModuleDestroy: () => undefined,
  current: () => ({}),
  callsLastCycle: () => 0,
};

async function migrateEverything(client: Client): Promise<void> {
  await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await client.query(
    'CREATE TABLE IF NOT EXISTS migrations (id serial PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL)',
  );
  const dir = join(__dirname, '..', 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  const runner = {
    query: async (sql: string, params?: unknown[]) =>
      (await client.query(sql, params)).rows,
  } as unknown as QueryRunner;
  for (const file of files) {
    const mod = await import(join(dir, file));
    const Migration = Object.values(mod).find(
      (v): v is new () => { up(q: QueryRunner): Promise<void> } =>
        typeof v === 'function' && /\d{13}$/.test(v.name),
    );
    if (!Migration) throw new Error(`no migration class in ${file}`);
    await new Migration().up(runner);
  }
}

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'CI sets CI_DATABASE_URL. This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp229gdpr_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await migrateEverything(db);

  process.env.DATABASE_URL = url.toString();
  process.env.TRUST_PROXY_CLIENT_IP = '1';
  const { AppModule } = await import('../app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue({ sender, webBase: WEB })
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
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
});

afterEach(() => jest.restoreAllMocks());

let callers = 0;
const nextCaller = () => `198.51.100.${(callers++ % 250) + 1}`;

type Reply = { status: number; text: string; json: any; headers: Headers };

async function send(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<Reply> {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      connection: 'close',
      'cf-connecting-ip': nextCaller(),
      ...headers,
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, text, json, headers: res.headers };
}

const auth = (token?: string): Record<string, string> =>
  token ? { authorization: `Bearer ${token}` } : {};
const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) => send('POST', path, body, headers);
const get = (
  path: string,
  token?: string,
  headers: Record<string, string> = {},
) => send('GET', path, undefined, { ...auth(token), ...headers });

const rights = () => app.get(AccountRightsService);
const accounts = () => app.get(AccountService);

const PASSWORD = 'a long enough password';
let counter = 0;
const unique = () => `rights${++counter}.${process.pid}@example.com`;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

type Person = { email: string; token: string; id: string };

/** A real account, made through the real sign-up route. */
async function person(): Promise<Person> {
  const email = unique();
  const res = await post('/auth/signup', { email, password: PASSWORD });
  expect(res.status).toBe(201);
  await accounts().drain();
  const id = (await db.query('SELECT id FROM users WHERE email = $1', [email]))
    .rows[0].id;
  return { email, token: res.json.token, id };
}

let spotId: string;
async function aSpot(): Promise<string> {
  if (spotId) return spotId;
  const type = (
    await db.query(
      `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'camping_spots_type_enum' ORDER BY enumsortorder LIMIT 1`,
    )
  ).rows[0].enumlabel;
  spotId = (
    await db.query(
      `INSERT INTO camping_spots (name, country, slug, type, location)
       VALUES ('Test spot', 'FR', $1, $2, ST_SetSRID(ST_MakePoint(2, 48), 4326))
       RETURNING id`,
      [`test-spot-${process.pid}`, type],
    )
  ).rows[0].id;
  return spotId;
}

async function seedTrip(userId: string, name: string) {
  const spot = await aSpot();
  const trip = (
    await db.query(
      `INSERT INTO trips (user_id, name, start_date, end_date)
       VALUES ($1, $2, '2026-07-01', '2026-07-09') RETURNING id`,
      [userId, name],
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO trip_stops (trip_id, camping_spot_id, sequence, arrival_date)
     VALUES ($1, $2, 1, '2026-07-02')`,
    [trip, spot],
  );
  return trip as string;
}

async function seedPhoto(
  userId: string,
  o: {
    status: 'pending' | 'approved' | 'rejected';
    credit?: string | null;
    source?: 'owner' | 'community';
    reason?: string | null;
  },
) {
  const spot = await aSpot();
  return (
    await db.query(
      `INSERT INTO photo_submissions
         (camping_spot_id, submitted_by_id, storage_key, source, shot_on,
          licence_publish, licence_sublicense, licence_attribution_name,
          status, rejection_reason, reviewed_at)
       VALUES ($1, $2, $3, $4, '2026-06-15', true, true, $5, $6, $7,
               CASE WHEN $8::boolean THEN now() END)
       RETURNING id`,
      [
        spot,
        userId,
        // 🔴 No id of the person inside the key: a key that named them would make
        // a "kept, unlinked" photo identify them through its own path.
        `photos/${++counter}-${Math.random().toString(36).slice(2)}.jpg`,
        o.source ?? 'owner',
        o.credit ?? null,
        o.status,
        o.reason ?? null,
        o.status !== 'pending',
      ],
    )
  ).rows[0].id as string;
}

async function seedReview(
  userId: string,
  o: {
    status: 'pending' | 'approved' | 'rejected';
    body: string;
    reason?: string;
  },
) {
  const spot = await aSpot();
  return (
    await db.query(
      `INSERT INTO reviews (camping_spot_id, author_id, rating, body, status,
                            rejection_reason, reviewed_at)
       VALUES ($1, $2, 4, $3, $4, $5, CASE WHEN $6::boolean THEN now() END)
       RETURNING id`,
      [
        spot,
        userId,
        o.body,
        o.status,
        o.reason ?? null,
        o.status !== 'pending',
      ],
    )
  ).rows[0].id as string;
}

const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.query(sql, params)).rows[0].n);

/**
 * Hold every archive build open until `release()`, so that the "preparing"
 * state can be observed over HTTP instead of being inferred.
 */
function holdBuilds() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const original = (AccountRightsService.prototype as any).assemble;
  const spy = jest
    .spyOn(rights() as any, 'assemble')
    .mockImplementation(async function (...args: unknown[]) {
      await gate;
      return original.apply(rights(), args);
    });
  return { release, spy };
}

/** Ask for an archive and wait until it has been built. */
async function readyArchive(p: Person) {
  const res = await post('/account/export', {}, auth(p.token));
  expect(res.status).toBe(202);
  await rights().drain();
}

const goodDelete = (over: Record<string, unknown> = {}) => ({
  password: PASSWORD,
  photos: 'keep-anonymous',
  understood: true,
  ...over,
});

// ── export ───────────────────────────────────────────────────────────────

describe('🔴 the export (Art. 15): a file that opens', () => {
  it('is asked for, is "preparing", and is then a JSON file with this person in it', async () => {
    const p = await person();
    await db.query(
      `UPDATE users SET display_name = 'Anna Testova' WHERE id = $1`,
      [p.id],
    );
    await seedTrip(p.id, 'Alps in six days');
    await seedPhoto(p.id, { status: 'approved', credit: 'Anna T.' });
    await seedPhoto(p.id, {
      status: 'rejected',
      reason: 'The campsite itself is not in the photo',
    });
    await seedReview(p.id, {
      status: 'approved',
      body: 'Quiet, clean, shaded.',
    });

    const hold = holdBuilds();
    const asked = await post('/account/export', {}, auth(p.token));
    expect(asked.status).toBe(202);
    expect(asked.json.status).toBe('preparing');

    // The state is REAL, not a spinner: the build has been started and is held
    // open, and everything a page can ask says "preparing".
    const mid = await get('/account/export', p.token);
    expect(mid.status).toBe(200);
    expect(mid.json.status).toBe('preparing');
    expect((await get('/account/export/file', p.token)).status).toBe(404);

    hold.release();
    await rights().drain();

    const done = await get('/account/export', p.token);
    expect(done.json.status).toBe('ready');
    // Valid for 24 hours — the number the screen promises — give or take the
    // seconds the test took.
    const left = Date.parse(done.json.expiresAt) - Date.now();
    expect(left).toBeGreaterThan(24 * 3600_000 - 60_000);
    expect(left).toBeLessThanOrEqual(24 * 3600_000);

    const file = await get('/account/export/file', p.token);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    );
    expect(file.headers.get('content-disposition')).toMatch(
      /^attachment; filename="camptribe-data-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(file.headers.get('cache-control')).toBe('no-store');

    // 🔴 IT OPENS: the body is parsed here, by a JSON parser that has never
    // heard of this service, and what comes out is this person's data.
    const data = JSON.parse(file.text);
    expect(data.about.format).toBe('camptribe-data-export');
    expect(data.account.email).toBe(p.email);
    expect(data.account.displayName).toBe('Anna Testova');
    expect(data.trips).toHaveLength(1);
    expect(data.trips[0].name).toBe('Alps in six days');
    expect(data.trips[0].startDate).toBe('2026-07-01');
    expect(data.trips[0].stops).toEqual([
      expect.objectContaining({ sequence: 1, arrivalDate: '2026-07-02' }),
    ]);
    expect(data.photos.map((x: any) => x.status).sort()).toEqual([
      'approved',
      'rejected',
    ]);
    expect(
      data.photos.find((x: any) => x.status === 'approved').creditedAs,
    ).toBe('Anna T.');
    expect(
      data.photos.find((x: any) => x.status === 'rejected').rejectionReason,
    ).toBe('The campsite itself is not in the photo');
    expect(data.reviews).toEqual([
      expect.objectContaining({ body: 'Quiet, clean, shaded.', rating: 4 }),
    ]);
    // Every instant is ISO 8601 with its zone.
    expect(data.account.emailConfirmedAt ?? data.account.createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].createdAt).toMatch(/Z$/);
  });

  it('carries no secret: not the password hash, nor the hash of a session or a link', async () => {
    const p = await person();
    await seedTrip(p.id, 'Marker trip');
    await post('/auth/forgot', { email: p.email });
    await accounts().drain();
    await readyArchive(p);
    const text = (await get('/account/export/file', p.token)).text;

    // The control first: this really is the archive of this person.
    expect(text).toContain(p.email);
    expect(text).toContain('Marker trip');

    const secrets = [
      (
        await db.query('SELECT password_hash h FROM users WHERE id = $1', [
          p.id,
        ])
      ).rows[0].h,
      p.token,
      sha256(p.token),
      ...(
        await db.query('SELECT token_hash h FROM sessions WHERE user_id = $1', [
          p.id,
        ])
      ).rows.map((r) => r.h),
      ...(
        await db.query(
          'SELECT token_hash h FROM auth_tokens WHERE user_id = $1',
          [p.id],
        )
      ).rows.map((r) => r.h),
    ];
    // At least a hash, a session and a link were really there to be leaked.
    expect(secrets.length).toBeGreaterThanOrEqual(5);
    for (const s of secrets) expect(text).not.toContain(s);
    expect(text).not.toMatch(/passwordHash|password_hash|token_?hash/i);
  });

  it('holds nobody else: another person’s data is not in this archive', async () => {
    const a = await person();
    const b = await person();
    await seedTrip(a.id, 'Trip of A');
    await seedTrip(b.id, 'Trip of B');
    await seedPhoto(b.id, { status: 'approved', credit: 'Bee Credit' });
    await readyArchive(a);
    const text = (await get('/account/export/file', a.token)).text;
    expect(text).toContain('Trip of A');
    expect(text).not.toContain('Trip of B');
    expect(text).not.toContain('Bee Credit');
    expect(text).not.toContain(b.email);
    expect(text).not.toContain(b.id);
    // …and B, who never asked, has no archive to download at all.
    expect((await get('/account/export/file', b.token)).status).toBe(404);
    expect((await get('/account/export', b.token)).json).toEqual({
      status: 'none',
    });
  });

  // 🔴 THE ARCHIVE KEEPS UP WITH THE SCHEMA. A column added to one of these
  // tables next month is personal data we hold unless somebody decides
  // otherwise, and the export is where "we forgot" becomes a breach of Art. 15.
  // The two lists below are written by hand: a column that is in neither fails
  // here, and so does one that is in both.
  it('accounts for every column of every table that holds a person’s data', async () => {
    const included: Record<string, string[]> = {
      users: [
        'email',
        'display_name',
        'created_at',
        'email_verified_at',
        'marketing_consent_at',
      ],
      sessions: ['created_at', 'expires_at'],
      auth_tokens: ['kind', 'created_at', 'expires_at', 'used_at'],
      trips: ['id', 'name', 'start_date', 'end_date', 'created_at'],
      trip_stops: ['sequence', 'camping_spot_id', 'arrival_date'],
      photo_submissions: [
        'id',
        'camping_spot_id',
        'source',
        'shot_on',
        'licence_publish',
        'licence_sublicense',
        'licence_attribution_name',
        'status',
        'rejection_reason',
        'reviewed_at',
        'created_at',
      ],
      reviews: [
        'id',
        'camping_spot_id',
        'rating',
        'body',
        'stayed_on',
        'status',
        'rejection_reason',
        'reviewed_at',
        'created_at',
      ],
    };
    // Left out ON PURPOSE, each with its reason.
    const left: Record<string, string[]> = {
      users: [
        'id', // internal key
        'password_hash', // a secret, not the person's data
        'deleted_at', // null for any account that can ask for an archive
      ],
      sessions: ['id', 'user_id', 'token_hash'], // keys and a secret
      auth_tokens: ['id', 'user_id', 'token_hash'],
      trips: ['user_id'], // the archive IS the user
      trip_stops: ['id', 'trip_id'], // nested under the trip
      photo_submissions: [
        'submitted_by_id', // the archive IS the user
        'storage_key', // internal object key
        'reviewed_by_directus_id', // a moderator's id, not this person's
      ],
      reviews: ['author_id', 'reviewed_by_directus_id'],
    };
    for (const table of Object.keys(included)) {
      const cols = (
        await db.query(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1`,
          [table],
        )
      ).rows.map((r) => r.column_name as string);
      expect(cols.length).toBeGreaterThan(0);
      expect([...included[table], ...left[table]].sort()).toEqual(cols.sort());
    }
  });

  it('answers 401, with one body, to a caller who is nobody — on all three routes', async () => {
    const bodies: unknown[] = [];
    for (const [method, path] of [
      ['POST', '/account/export'],
      ['GET', '/account/export'],
      ['GET', '/account/export/file'],
    ] as const) {
      for (const token of [undefined, 'not-a-token', 'x'.repeat(43)]) {
        const r =
          method === 'POST'
            ? await post(path, {}, auth(token))
            : await get(path, token);
        expect(r.status).toBe(401);
        bodies.push(r.json);
      }
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(bodies[0]).toEqual({
      code: 'no_session',
      message: 'You are not signed in.',
    });
  });

  it('starts ONE build when asked twice at once', async () => {
    const p = await person();
    const hold = holdBuilds();
    const [x, y] = await Promise.all([
      post('/account/export', {}, auth(p.token)),
      post('/account/export', {}, auth(p.token)),
    ]);
    expect([x.status, y.status]).toEqual([202, 202]);
    expect(x.json.status).toBe('preparing');
    expect(y.json.status).toBe('preparing');
    hold.release();
    await rights().drain();
    expect(hold.spy).toHaveBeenCalledTimes(1);
    expect((await get('/account/export', p.token)).json.status).toBe('ready');
  });

  it('says "failed" when the build fails, hands out no file, and lets the person ask again', async () => {
    const p = await person();
    jest
      .spyOn(rights() as any, 'assemble')
      .mockRejectedValueOnce(new Error('boom: ' + p.email));
    const errors = jest
      .spyOn((rights() as any).log, 'error')
      .mockImplementation(() => undefined);
    await post('/account/export', {}, auth(p.token));
    await rights().drain();
    expect((await get('/account/export', p.token)).json.status).toBe('failed');
    expect((await get('/account/export/file', p.token)).status).toBe(404);
    // The log names the class of the error, never its message (it could carry a value).
    expect(JSON.stringify(errors.mock.calls)).not.toContain(p.email);

    await readyArchive(p);
    expect((await get('/account/export', p.token)).json.status).toBe('ready');
    expect((await get('/account/export/file', p.token)).status).toBe(200);
  });

  it('calls a build nobody is working on "failed" after ten minutes, and lets a new request replace it', async () => {
    const p = await person();
    await db.query(
      `INSERT INTO data_exports (user_id, status, requested_at)
       VALUES ($1, 'preparing', now() - interval '11 minutes')`,
      [p.id],
    );
    expect((await get('/account/export', p.token)).json.status).toBe('failed');
    await readyArchive(p);
    expect((await get('/account/export', p.token)).json.status).toBe('ready');

    // And 9 minutes is still "in progress": a fresh request returns it and starts nothing.
    const q = await person();
    await db.query(
      `INSERT INTO data_exports (user_id, status, requested_at)
       VALUES ($1, 'preparing', now() - interval '9 minutes')`,
      [q.id],
    );
    const spy = jest.spyOn(rights() as any, 'assemble');
    const again = await post('/account/export', {}, auth(q.token));
    await rights().drain();
    expect(again.json.status).toBe('preparing');
    expect(spy).not.toHaveBeenCalled();
  });

  it('gives an archive for 24 hours and not a minute longer — in the answer and in the file', async () => {
    const p = await person();
    await readyArchive(p);
    await db.query(
      `UPDATE data_exports SET expires_at = now() - interval '1 second' WHERE user_id = $1`,
      [p.id],
    );
    expect((await get('/account/export', p.token)).json).toEqual({
      status: 'none',
    });
    expect((await get('/account/export/file', p.token)).status).toBe(404);
    // The sweep then removes the row, so nothing is kept past the day.
    expect(await rights().purge()).toEqual(
      expect.objectContaining({ exports: 1 }),
    );
    expect(
      await count('SELECT count(*) n FROM data_exports WHERE user_id = $1', [
        p.id,
      ]),
    ).toBe(0);
  });

  it('lets an old build neither overwrite a newer archive nor write into nothing', async () => {
    const p = await person();
    const gate: { release: () => void } = { release: () => undefined };
    const first = new Promise<void>((r) => (gate.release = r));
    const spy = jest
      .spyOn(rights() as any, 'assemble')
      .mockImplementationOnce(async () => {
        await first;
        return { who: 'the old build' };
      })
      .mockImplementationOnce(async () => ({ who: 'the new build' }));

    await post('/account/export', {}, auth(p.token));
    // The first build is "stale" (11 minutes), so a second request replaces it.
    await db.query(
      `UPDATE data_exports SET requested_at = now() - interval '11 minutes' WHERE user_id = $1`,
      [p.id],
    );
    await post('/account/export', {}, auth(p.token));
    // Let the NEW build finish while the old one is still held.
    await new Promise((r) => setTimeout(r, 200));
    expect(
      JSON.parse((await get('/account/export/file', p.token)).text).who,
    ).toBe('the new build');

    gate.release();
    await rights().drain();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse((await get('/account/export/file', p.token)).text).who,
    ).toBe('the new build');
  });
});

// ── deletion ─────────────────────────────────────────────────────────────

describe('🔴 deleting: access ends in THE SAME REQUEST', () => {
  it('the token that asked is a dead token the moment the answer arrives', async () => {
    const p = await person();
    // The control: before, the token opens the account, the export routes and the cabinet.
    expect((await get('/auth/me', p.token)).status).toBe(200);
    expect((await get('/account/export', p.token)).status).toBe(200);

    const res = await post('/account/delete', goodDelete(), auth(p.token));
    expect(res.status).toBe(200);
    expect(res.json.deleted).toBe(true);

    // The SAME token, the very next request — not thirty days later.
    const me = await get('/auth/me', p.token);
    expect(me.status).toBe(401);
    expect(me.json.code).toBe('no_session');
    expect((await get('/account/export', p.token)).status).toBe(401);
    expect(
      (await post('/account/delete', goodDelete(), auth(p.token))).status,
    ).toBe(401);
    expect(
      await count('SELECT count(*) n FROM sessions WHERE user_id = $1', [p.id]),
    ).toBe(0);
  });

  it('closes EVERY session of the account, not just the one that asked', async () => {
    const p = await person();
    const other = await post('/auth/login', {
      email: p.email,
      password: PASSWORD,
    });
    expect(other.status).toBe(200);
    expect((await get('/auth/me', other.json.token)).status).toBe(200);
    await post('/account/delete', goodDelete(), auth(p.token));
    expect((await get('/auth/me', other.json.token)).status).toBe(401);
  });

  it('answers with the last day it can be undone: 30 days from now', async () => {
    const p = await person();
    const before = Date.now();
    const res = await post('/account/delete', goodDelete(), auth(p.token));
    const until = Date.parse(res.json.restorableUntil);
    expect(until - before).toBeGreaterThan(30 * 86_400_000 - 5_000);
    expect(until - Date.now()).toBeLessThanOrEqual(30 * 86_400_000);
  });
});

describe('🔴 deleting: nothing is chosen, and nothing is done on a wrong or missing answer', () => {
  async function untouched(p: Person) {
    expect((await get('/auth/me', p.token)).status).toBe(200);
    const u = (
      await db.query('SELECT deleted_at FROM users WHERE id = $1', [p.id])
    ).rows[0];
    expect(u.deleted_at).toBeNull();
    expect(
      await count('SELECT count(*) n FROM sessions WHERE user_id = $1', [p.id]),
    ).toBeGreaterThan(0);
  }

  it.each([
    ['no photo choice at all', { photos: undefined }, 'photo_choice_required'],
    ['an empty one', { photos: '' }, 'photo_choice_required'],
    ['one that is not an option', { photos: 'both' }, 'photo_choice_required'],
    ['a boolean', { photos: true }, 'photo_choice_required'],
    ['null', { photos: null }, 'photo_choice_required'],
    ['no confirmation', { understood: undefined }, 'confirmation_required'],
    ['"true" as a string', { understood: 'true' }, 'confirmation_required'],
    ['1', { understood: 1 }, 'confirmation_required'],
    ['false', { understood: false }, 'confirmation_required'],
    ['no password', { password: undefined }, 'password_required'],
    ['an empty password', { password: '' }, 'password_required'],
    ['a password that is not text', { password: 12345 }, 'password_required'],
  ])('%s is a 400 (%s) and changes nothing', async (_name, over, code) => {
    const p = await person();
    await seedPhoto(p.id, { status: 'approved' });
    const res = await post('/account/delete', goodDelete(over), auth(p.token));
    expect(res.status).toBe(400);
    expect(res.json.code).toBe(code);
    await untouched(p);
    expect(
      await count(
        'SELECT count(*) n FROM photo_submissions WHERE submitted_by_id = $1',
        [p.id],
      ),
    ).toBe(1);
  });

  it('an empty object and an array are the same 400, for the choice that is missing first; a body that is no object is a 400 too', async () => {
    const p = await person();
    for (const body of [{}, []]) {
      const res = await post('/account/delete', body, auth(p.token));
      expect(res.status).toBe(400);
      expect(res.json.code).toBe('photo_choice_required');
    }
    // These never reach the handler: the JSON parser refuses a bare string,
    // number or null. Refused is all that matters here — and nothing happened.
    for (const body of ['delete me', 42, null]) {
      const res = await post('/account/delete', body, auth(p.token));
      expect(res.status).toBe(400);
    }
    await untouched(p);
  });

  it('a wrong password is a 403 — not a 401 that the page would read as "signed out" — and changes nothing', async () => {
    const p = await person();
    await seedTrip(p.id, 'stays');
    const res = await post(
      '/account/delete',
      goodDelete({ password: 'a different long password' }),
      auth(p.token),
    );
    expect(res.status).toBe(403);
    expect(res.json.code).toBe('wrong_password');
    await untouched(p);
    expect(
      await count('SELECT count(*) n FROM trips WHERE user_id = $1', [p.id]),
    ).toBe(1);
  });

  it('a stranger is a 401 with the same body as every other door', async () => {
    const res = await post('/account/delete', goodDelete(), {});
    expect(res.status).toBe(401);
    expect(res.json).toEqual({
      code: 'no_session',
      message: 'You are not signed in.',
    });
  });

  it('each of the two answers is accepted, and they are the only two', async () => {
    for (const photos of ['delete', 'keep-anonymous']) {
      const p = await person();
      const res = await post(
        '/account/delete',
        goodDelete({ photos }),
        auth(p.token),
      );
      expect(res.status).toBe(200);
    }
  });
});

describe('🔴 deleting: what happens to the photos is what was chosen', () => {
  async function photoPerson() {
    const p = await person();
    const ids = [
      await seedPhoto(p.id, {
        status: 'approved',
        credit: 'Anna T.',
        source: 'owner',
      }),
      await seedPhoto(p.id, { status: 'pending', credit: 'Anna T.' }),
      await seedPhoto(p.id, {
        status: 'rejected',
        credit: 'Anna T.',
        reason: 'Not the campsite',
      }),
    ];
    return { p, ids };
  }
  const rowsOf = async (ids: string[]) =>
    (
      await db.query(
        `SELECT submitted_by_id, licence_attribution_name, source,
                licence_publish, licence_sublicense, status
           FROM photo_submissions WHERE id = ANY($1)`,
        [ids],
      )
    ).rows;

  it('"delete the photos too" removes every photo row of the person', async () => {
    const { p, ids } = await photoPerson();
    // The control: the three rows are there to be removed.
    expect(await rowsOf(ids)).toHaveLength(3);
    const res = await post(
      '/account/delete',
      goodDelete({ photos: 'delete' }),
      auth(p.token),
    );
    expect(res.status).toBe(200);
    expect(await rowsOf(ids)).toHaveLength(0);
  });

  it('"keep, remove my name" keeps all of them, unlinked, uncredited, and credited to the community', async () => {
    const { p, ids } = await photoPerson();
    const res = await post(
      '/account/delete',
      goodDelete({ photos: 'keep-anonymous' }),
      auth(p.token),
    );
    expect(res.status).toBe(200);
    const rows = await rowsOf(ids);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.submitted_by_id).toBeNull();
      expect(r.licence_attribution_name).toBeNull();
      expect(r.source).toBe('community');
      // The licence is a contract about the file, not personal data: it stays.
      expect(r.licence_publish).toBe(true);
      expect(r.licence_sublicense).toBe(true);
    }
    expect(rows.map((r) => r.status).sort()).toEqual([
      'approved',
      'pending',
      'rejected',
    ]);
  });

  it('does not touch anybody else’s photos', async () => {
    const { p } = await photoPerson();
    const other = await person();
    const otherId = await seedPhoto(other.id, {
      status: 'approved',
      credit: 'Bee Credit',
    });
    await post(
      '/account/delete',
      goodDelete({ photos: 'delete' }),
      auth(p.token),
    );
    expect(await rowsOf([otherId])).toEqual([
      expect.objectContaining({
        submitted_by_id: other.id,
        licence_attribution_name: 'Bee Credit',
        source: 'owner',
      }),
    ]);
  });

  it('removes the person’s reviews whichever way the photos went', async () => {
    for (const photos of ['delete', 'keep-anonymous']) {
      const p = await person();
      const body = `my own words ${photos}`;
      await seedReview(p.id, { status: 'approved', body });
      expect(
        await count('SELECT count(*) n FROM reviews WHERE body = $1', [body]),
      ).toBe(1);
      await post('/account/delete', goodDelete({ photos }), auth(p.token));
      expect(
        await count('SELECT count(*) n FROM reviews WHERE body = $1', [body]),
      ).toBe(0);
    }
  });
});

describe('🔴 deleting: what stays has no name in it', () => {
  const tables = async () =>
    (
      await db.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            AND table_name NOT IN ('spatial_ref_sys', 'migrations')`,
      )
    ).rows.map((r) => r.table_name as string);

  /** How many rows, anywhere in the database, mention `needle` — as the row's own text. */
  async function mentions(needle: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of await tables()) {
      const n = await count(
        `SELECT count(*) n FROM "${t}" x WHERE x::text ILIKE $1`,
        [`%${needle}%`],
      );
      if (n > 0) out[t] = n;
    }
    return out;
  }

  it('keeps ONLY the rejections, with their reason and date, and nothing that points at the person', async () => {
    const p = await person();
    await seedPhoto(p.id, { status: 'approved', credit: 'Anna T.' });
    await seedPhoto(p.id, { status: 'pending' });
    await seedPhoto(p.id, {
      status: 'rejected',
      reason: 'Not the campsite',
    });
    await seedReview(p.id, {
      status: 'rejected',
      body: 'spam spam',
      reason: 'Advertising',
    });
    await seedReview(p.id, { status: 'approved', body: 'fine place' });

    const before = await count('SELECT count(*) n FROM moderation_log');
    await post(
      '/account/delete',
      goodDelete({ photos: 'delete' }),
      auth(p.token),
    );
    const kept = (
      await db.query(
        `SELECT kind, outcome, reason, decided_at IS NOT NULL AS decided,
                camping_spot_id
           FROM moderation_log ORDER BY kind`,
      )
    ).rows.slice(before);
    // Exactly the two rejections — not the approved, not the pending.
    expect(kept.map((r) => [r.kind, r.outcome, r.reason]).sort()).toEqual([
      ['photo', 'rejected', 'Not the campsite'],
      ['review', 'rejected', 'Advertising'],
    ]);
    expect(kept.every((r) => r.decided)).toBe(true);
  });

  it('the log has no column that could name a person, and refuses anything but a rejection', async () => {
    const cols = (
      await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'moderation_log' ORDER BY column_name`,
      )
    ).rows.map((r) => r.column_name);
    // Written out, not read back: adding a column that identifies somebody
    // (user, author, address, a hash of one) fails here and must be argued for.
    expect(cols).toEqual([
      'camping_spot_id',
      'decided_at',
      'id',
      'kind',
      'outcome',
      'reason',
      'recorded_at',
      'submitted_at',
    ]);
    await expect(
      db.query(
        `INSERT INTO moderation_log (kind, outcome) VALUES ('photo', 'approved')`,
      ),
    ).rejects.toThrow(/moderation_log_outcome/);
  });

  it('after the window, nothing in the whole database mentions the person — and before it, the address is there to be found', async () => {
    const p = await person();
    await db.query(
      `UPDATE users SET display_name = 'Zofia Wrobel' WHERE id = $1`,
      [p.id],
    );
    await seedTrip(p.id, 'ZofiaTrip-' + p.id.slice(0, 8));
    const kept = [
      await seedPhoto(p.id, {
        status: 'rejected',
        credit: 'Zofia W.',
        reason: 'blurred',
      }),
      await seedPhoto(p.id, { status: 'approved', credit: 'Zofia W.' }),
    ];
    await seedReview(p.id, {
      status: 'rejected',
      body: 'Zofia says no',
      reason: 'x',
    });
    await readyArchive(p);
    await post('/auth/forgot', { email: p.email });
    await accounts().drain();

    const needles = [p.email, p.id, 'Zofia', p.token];
    // CONTROL: the search finds each of them while the person is here.
    for (const n of needles.slice(0, 3))
      expect(Object.keys(await mentions(n))).not.toEqual([]);

    await post(
      '/account/delete',
      goodDelete({ photos: 'keep-anonymous' }),
      auth(p.token),
    );
    // Inside the window the account row is still there, so the address still is.
    expect(Object.keys(await mentions(p.email))).toEqual(['users']);
    // …but none of the people's other data is: not the trip's owner link in the
    // archive, not the credit, not the review.
    expect(await mentions('Zofia W.')).toEqual({});
    expect(await mentions('Zofia says no')).toEqual({});

    await db.query(
      `UPDATE users SET deleted_at = now() - interval '31 days' WHERE id = $1`,
      [p.id],
    );
    const purged = await rights().purge();
    expect(purged.accounts).toBeGreaterThanOrEqual(1);
    for (const n of needles) expect(await mentions(n)).toEqual({});
    // And the kept photos are still there, with no one behind them.
    expect(
      await count(
        `SELECT count(*) n FROM photo_submissions WHERE id = ANY($1)`,
        [kept],
      ),
    ).toBe(2);
  });

  it('removes a ready archive with the account: a person’s data is not left in a file', async () => {
    const p = await person();
    await readyArchive(p);
    expect(
      await count('SELECT count(*) n FROM data_exports WHERE user_id = $1', [
        p.id,
      ]),
    ).toBe(1);
    await post('/account/delete', goodDelete(), auth(p.token));
    expect(
      await count('SELECT count(*) n FROM data_exports WHERE user_id = $1', [
        p.id,
      ]),
    ).toBe(0);
  });
});

describe('🔴 deleting: thirty days to come back, with the same password, and not after', () => {
  async function deletedPerson() {
    const p = await person();
    await seedTrip(p.id, 'will be here when I come back');
    await post('/account/delete', goodDelete(), auth(p.token));
    return p;
  }

  it('signing in with the same password restores the account and SAYS SO', async () => {
    const p = await deletedPerson();
    expect(
      (await db.query('SELECT deleted_at FROM users WHERE id = $1', [p.id]))
        .rows[0].deleted_at,
    ).not.toBeNull();

    const res = await post('/auth/login', {
      email: p.email,
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.json.restored).toBe(true);
    expect((await get('/auth/me', res.json.token)).json.email).toBe(p.email);
    expect(
      (await db.query('SELECT deleted_at FROM users WHERE id = $1', [p.id]))
        .rows[0].deleted_at,
    ).toBeNull();
    // The trip was waiting.
    expect(
      await count('SELECT count(*) n FROM trips WHERE user_id = $1', [p.id]),
    ).toBe(1);

    // An ordinary sign-in afterwards does not claim to have restored anything.
    const again = await post('/auth/login', {
      email: p.email,
      password: PASSWORD,
    });
    expect(again.status).toBe(200);
    expect('restored' in again.json).toBe(false);
  });

  it('an ordinary account signing in says nothing about restoring', async () => {
    const p = await person();
    const res = await post('/auth/login', {
      email: p.email,
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    expect('restored' in res.json).toBe(false);
  });

  it('a wrong password does not restore, and says what it always says', async () => {
    const p = await deletedPerson();
    const res = await post('/auth/login', {
      email: p.email,
      password: 'not the right one at all',
    });
    expect(res.status).toBe(401);
    expect(
      (await db.query('SELECT deleted_at FROM users WHERE id = $1', [p.id]))
        .rows[0].deleted_at,
    ).not.toBeNull();
  });

  // The boundary, with minutes: the window is 30 × 24 × 60 = 43 200 of them.
  it.each([
    ['one minute inside the window', 43_200 - 1, 200],
    ['one minute after it', 43_200 + 1, 401],
    ['31 days', 31 * 24 * 60, 401],
  ])('%s', async (_name, ageMinutes, status) => {
    const p = await deletedPerson();
    await db.query(
      `UPDATE users SET deleted_at = now() - make_interval(mins => $2) WHERE id = $1`,
      [p.id, ageMinutes],
    );
    const res = await post('/auth/login', {
      email: p.email,
      password: PASSWORD,
    });
    expect(res.status).toBe(status);
    const stillDeleted =
      (await db.query('SELECT deleted_at FROM users WHERE id = $1', [p.id]))
        .rows[0].deleted_at !== null;
    // A refused sign-in leaves the account marked; an accepted one clears it.
    expect(stillDeleted).toBe(status === 401);
  });

  it('a reset link is NOT a way back: no letter is sent for an account being deleted, and the answer is the same', async () => {
    const alive = await person();
    const gone = await deletedPerson();
    const ra = await post('/auth/forgot', { email: alive.email });
    const rg = await post('/auth/forgot', { email: gone.email });
    await accounts().drain();
    // Same status and same bytes: asking tells nobody that the account is being deleted.
    expect(rg.status).toBe(ra.status);
    expect(rg.text).toBe(ra.text);
    // The control: the letter DOES go for the account that is alive.
    expect(
      box.sent.filter(
        (m) => m.to === alive.email && m.kind === 'reset_password',
      ),
    ).toHaveLength(1);
    expect(
      box.sent.filter(
        (m) => m.to === gone.email && m.kind === 'reset_password',
      ),
    ).toHaveLength(0);
  });

  it('a link sent before the deletion is dead after it', async () => {
    const p = await person();
    await post('/auth/forgot', { email: p.email });
    await accounts().drain();
    const letter = box.sent
      .filter((m) => m.to === p.email && m.kind === 'reset_password')
      .pop()!;
    const token = new URL(
      /https?:\/\/\S+/.exec(letter.text)![0],
    ).searchParams.get('t');
    await post('/account/delete', goodDelete(), auth(p.token));
    const res = await post('/auth/reset-password', {
      token,
      password: 'a brand new long password',
    });
    expect(res.status).toBe(410);
    // And the password did not change: the old one still restores.
    const back = await post('/auth/login', {
      email: p.email,
      password: PASSWORD,
    });
    expect(back.status).toBe(200);
  });

  it('keeps the address reserved for the window, and frees it after the purge', async () => {
    const p = await deletedPerson();
    const during = await post('/auth/signup', {
      email: p.email,
      password: PASSWORD,
    });
    expect(during.status).toBe(409);
    await db.query(
      `UPDATE users SET deleted_at = now() - interval '31 days' WHERE id = $1`,
      [p.id],
    );
    await rights().purge();
    const after = await post('/auth/signup', {
      email: p.email,
      password: PASSWORD,
    });
    expect(after.status).toBe(201);
  });

  it('is done once when asked twice at once', async () => {
    const p = await person();
    await seedPhoto(p.id, { status: 'rejected', reason: 'twice?' });
    const [a, b] = await Promise.all([
      post('/account/delete', goodDelete({ photos: 'delete' }), auth(p.token)),
      post('/account/delete', goodDelete({ photos: 'delete' }), auth(p.token)),
    ]);
    expect([a.status, b.status].sort()).toEqual(expect.arrayContaining([200]));
    for (const r of [a, b]) expect([200, 401]).toContain(r.status);
    expect(
      await count(
        `SELECT count(*) n FROM moderation_log WHERE reason = 'twice?'`,
      ),
    ).toBe(1);
  });
});

describe('the purge', () => {
  it('erases accounts past the window with everything that hangs off them, and only those', async () => {
    // Whatever earlier tests left past the window is erased first, so the count
    // below is this test's own.
    await rights().purge();
    const old = await person();
    const recent = await person();
    const alive = await person();
    for (const p of [old, recent, alive]) {
      await seedTrip(p.id, 'trip of ' + p.id);
      await readyArchive(p);
    }
    await db.query(
      `UPDATE users SET deleted_at = now() - interval '31 days' WHERE id = $1`,
      [old.id],
    );
    await db.query(
      `UPDATE users SET deleted_at = now() - interval '29 days' WHERE id = $1`,
      [recent.id],
    );
    const out = await rights().purge();
    expect(out.accounts).toBe(1);
    const has = (id: string) =>
      count('SELECT count(*) n FROM users WHERE id = $1', [id]);
    expect([
      await has(old.id),
      await has(recent.id),
      await has(alive.id),
    ]).toEqual([0, 1, 1]);
    // Their trips and stops went with the account (ON DELETE CASCADE)…
    expect(
      await count('SELECT count(*) n FROM trips WHERE user_id = $1', [old.id]),
    ).toBe(0);
    expect(
      await count('SELECT count(*) n FROM trips WHERE user_id = $1', [
        recent.id,
      ]),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*) n FROM trip_stops s
          WHERE NOT EXISTS (SELECT 1 FROM trips t WHERE t.id = s.trip_id)`,
      ),
    ).toBe(0);
    // …and so did the archive, which still had a day to run.
    expect(
      await count('SELECT count(*) n FROM data_exports WHERE user_id = $1', [
        old.id,
      ]),
    ).toBe(0);
  });

  it('runs when the API starts, so a process that was down over the deadline catches up', async () => {
    const p = await person();
    await db.query(
      `UPDATE users SET deleted_at = now() - interval '40 days' WHERE id = $1`,
      [p.id],
    );
    const svc = rights();
    svc.onApplicationBootstrap();
    try {
      for (let i = 0; i < 50; i++) {
        if (
          (await count('SELECT count(*) n FROM users WHERE id = $1', [
            p.id,
          ])) === 0
        )
          break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(
        await count('SELECT count(*) n FROM users WHERE id = $1', [p.id]),
      ).toBe(0);
    } finally {
      svc.onModuleDestroy();
    }
  });
});

describe('🔴 deleting is counted in the sign-in bucket', () => {
  it('ten wrong passwords at /account/delete, and the eleventh call is 429 — even with the right one', async () => {
    const p = await person();
    const pin = { 'cf-connecting-ip': '203.0.113.201' };
    for (let i = 0; i < 10; i++) {
      const r = await post(
        '/account/delete',
        goodDelete({ password: 'wrong wrong wrong ' + i }),
        { ...auth(p.token), ...pin },
      );
      expect(r.status).toBe(403);
    }
    const eleventh = await post('/account/delete', goodDelete(), {
      ...auth(p.token),
      ...pin,
    });
    expect(eleventh.status).toBe(429);
    // Refused by the limiter, so nothing was deleted.
    expect((await get('/auth/me', p.token)).status).toBe(200);
  });

  it('shares its counter with /auth/login, so the two together are ten, not twenty', async () => {
    const p = await person();
    const pin = { 'cf-connecting-ip': '203.0.113.202' };
    for (let i = 0; i < 6; i++)
      expect(
        (
          await post(
            '/auth/login',
            { email: p.email, password: 'nope nope nope' },
            pin,
          )
        ).status,
      ).toBe(401);
    for (let i = 0; i < 4; i++)
      expect(
        (
          await post(
            '/account/delete',
            goodDelete({ password: 'nope nope nope' }),
            { ...auth(p.token), ...pin },
          )
        ).status,
      ).toBe(403);
    expect(
      (await post('/auth/login', { email: p.email, password: PASSWORD }, pin))
        .status,
    ).toBe(429);
  });

  it('does not put the export routes in it: polling for a status is ordinary traffic', async () => {
    const p = await person();
    const pin = { 'cf-connecting-ip': '203.0.113.203' };
    for (let i = 0; i < 25; i++)
      expect((await get('/account/export', p.token, pin)).status).toBe(200);
  });
});
