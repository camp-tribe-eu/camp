import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { MAILER } from '../auth/account.service';
import { DevMailbox, MailMessage, MailSender } from '../auth/mail';
import { WarningsService } from '../warnings/warnings.service';
import { EventsService } from './events.service';

// CAMP-504 — запис подій, проти СПРАВЖНЬОЇ бази й СПРАВЖНЬОГО застосунку.
// Усе, що обіцяє запис, — про рядки в Postgres і про рядки, яких там не
// має бути; макет не побачив би жодного. Власна база `campevents_<pid>_<ms>`,
// усі міграції, прибирає за собою. Відсутня база — ПАДІННЯ, не пропуск.
//
// 🔴 ЧОТИРИ МУТАЦІЇ, кожна має почервоніти тут:
//   1. прибрати відсікання ботів (`isBot` → false)       → «Googlebot…»
//   2. прибрати дедуплікацію (`seen` → false)            → «повтор…»
//   3. дозволити URL у параметрі редиректу               → «чужий URL…»
//   4. записати повний referrer замість класу            → «клас, не referrer»

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(120_000);

let admin: Client;
let db: Client;
let dbName: string;
let app: INestApplication;
let base: string;
let spotId: string;

const SLUG = 'camping-events-test';
const SITE = 'https://camping-events.example/welcome';
const NO_SITE = 'camping-events-no-site';
const BAD_SITE = 'camping-events-bad-site';

const HUMAN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const GOOGLEBOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

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

async function migrations(): Promise<Runner[]> {
  const dir = join(__dirname, '..', 'migrations');
  const out: Runner[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort()) {
    const mod = await import(join(dir, file));
    const Migration = Object.values(mod).find(
      (v): v is new () => Runner =>
        typeof v === 'function' && /\d{13}$/.test(v.name),
    );
    if (!Migration) throw new Error(`no migration class in ${file}`);
    out.push(new Migration());
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
  dbName = `campevents_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.query(
    'CREATE TABLE IF NOT EXISTS migrations (id serial PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL)',
  );
  for (const m of await migrations()) await m.up(runnerOf(db));

  const insert = async (slug: string, website: string | null) =>
    (
      await db.query(
        `INSERT INTO camping_spots (name, country, region, slug, type, website, location)
         VALUES ($1, 'hr', 'Istria', $2, 'paid', $3,
                 ST_SetSRID(ST_MakePoint(13.9, 45.1), 4326)) RETURNING id`,
        [slug, slug, website],
      )
    ).rows[0].id as string;
  spotId = await insert(SLUG, SITE);
  await insert(NO_SITE, null);
  await insert(BAD_SITE, 'javascript:alert(1)');

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

let callers = 0;
const nextVisitor = () => `203.0.113.${(callers++ % 250) + 1}`;

async function send(
  path: string,
  body: unknown,
  opts: { ip?: string; ua?: string } = {},
) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      connection: 'close',
      'cf-connecting-ip': opts.ip ?? nextVisitor(),
      'user-agent': opts.ua ?? HUMAN_UA,
    },
    body: JSON.stringify(body),
  });
}

const total = async (event: string) =>
  Number(
    (
      await db.query(
        `SELECT COALESCE(sum(n), 0) AS n FROM spot_event_daily
          WHERE camping_spot_id = $1 AND event = $2`,
        [spotId, event],
      )
    ).rows[0].n,
  );

describe('схема: людини в таблицях немає', () => {
  const columns = async (table: string) =>
    (
      await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = $1 ORDER BY ordinal_position`,
        [table],
      )
    ).rows.map((r) => r.column_name as string);

  it('точні списки колонок', async () => {
    expect(await columns('spot_event_daily')).toEqual([
      'day',
      'camping_spot_id',
      'event',
      'source',
      'n',
    ]);
    expect(await columns('zero_result_search_daily')).toEqual([
      'day',
      'surface',
      'filters',
      'n',
    ]);
  });

  it('жодна колонка не скидається на IP, хеш, агента, реферер, запит, сесію', async () => {
    const all = [
      ...(await columns('spot_event_daily')),
      ...(await columns('zero_result_search_daily')),
    ];
    expect(all.length).toBe(9);
    for (const c of all)
      expect(c).not.toMatch(
        /ip|hash|agent|ua$|referr|query|text|session|cookie|user/i,
      );
  });

  it('таблиці не зареєстровані в Directus', async () => {
    const has = (
      await db.query(`SELECT to_regclass('public.directus_collections') AS t`)
    ).rows[0].t;
    // У сценарній базі Directus немає взагалі; а в коді його конфігурації
    // жодна з наших таблиць не названа (див. також apps/cms/configure.mjs).
    expect(has).toBeNull();
    const cms = readFileSync(
      join(__dirname, '..', '..', '..', 'cms', 'configure.mjs'),
      'utf8',
    );
    expect(cms).not.toMatch(/spot_event_daily|zero_result_search_daily/);
  });
});

describe('рахунок = числу дій', () => {
  it('N різних відвідувачів дають N, і кожна подія окремо', async () => {
    const before = {
      view: await total('spot_view'),
      phone: await total('phone_click'),
    };
    for (let i = 0; i < 5; i++) {
      const r = await send('/events', { event: 'spot_view', slug: SLUG });
      expect(r.status).toBe(202);
    }
    for (let i = 0; i < 2; i++)
      expect(
        (await send('/events', { event: 'phone_click', slug: SLUG })).status,
      ).toBe(202);
    expect((await total('spot_view')) - before.view).toBe(5);
    expect((await total('phone_click')) - before.phone).toBe(2);
    // Один рядок на день, а не п'ять.
    const r = await db.query(
      `SELECT count(*)::int AS c FROM spot_event_daily
        WHERE camping_spot_id = $1 AND event = 'spot_view' AND source = 'direct'`,
      [spotId],
    );
    expect(r.rows[0].c).toBe(1);
  });

  it('повтор тієї ж дії тим самим відвідувачем за добу не подвоює', async () => {
    const before = await total('coords_copy');
    const me = { ip: '192.0.2.77', ua: HUMAN_UA };
    for (let i = 0; i < 4; i++)
      await send('/events', { event: 'coords_copy', slug: SLUG }, me);
    expect((await total('coords_copy')) - before).toBe(1);
    // Інший браузер з тієї ж адреси — інший відвідувач.
    await send(
      '/events',
      { event: 'coords_copy', slug: SLUG },
      { ...me, ua: HUMAN_UA + ' X' },
    );
    expect((await total('coords_copy')) - before).toBe(2);
    // Інша подія того ж відвідувача — інша подія.
    await send('/events', { event: 'gpx_download', slug: SLUG }, me);
    expect(await total('gpx_download')).toBeGreaterThanOrEqual(1);
  });

  it('Googlebot не потрапляє в статистику (і порожній UA теж)', async () => {
    const before = await total('spot_view');
    for (const ua of [GOOGLEBOT_UA, '', 'curl/8.4.0']) {
      const r = await send(
        '/events',
        { event: 'spot_view', slug: SLUG },
        { ua },
      );
      expect(r.status).toBe(202);
    }
    expect(await total('spot_view')).toBe(before);
  });

  it('невідомий кемпінг, невідома подія й подія лише для сервера — нічого не пишуть', async () => {
    const before = (
      await db.query('SELECT count(*)::int c FROM spot_event_daily')
    ).rows[0].c;
    expect(
      (await send('/events', { event: 'spot_view', slug: 'no-such' })).status,
    ).toBe(202);
    expect((await send('/events', { event: 'nope', slug: SLUG })).status).toBe(
      400,
    );
    expect(
      (await send('/events', { event: 'route_inclusion', slug: SLUG })).status,
    ).toBe(400);
    expect(
      (await send('/events', { event: 'website_click', slug: SLUG })).status,
    ).toBe(400);
    expect(
      (
        await send('/events', {
          event: 'spot_view',
          slug: "x'; DROP TABLE camping_spots;--",
        })
      ).status,
    ).toBe(400);
    expect(
      (await db.query('SELECT count(*)::int c FROM spot_event_daily')).rows[0]
        .c,
    ).toBe(before);
  });

  it('кемпінги з маршруту: один раз на відвідувача, боти не рахуються', async () => {
    const svc = app.get(EventsService);
    const before = await total('route_inclusion');
    const v = { ip: '192.0.2.200', userAgent: HUMAN_UA };
    expect(await svc.recordRouteInclusion([SLUG, NO_SITE], v)).toBe(2);
    expect(await svc.recordRouteInclusion([SLUG, NO_SITE], v)).toBe(0);
    expect(
      await svc.recordRouteInclusion([SLUG], {
        ip: '192.0.2.201',
        userAgent: GOOGLEBOT_UA,
      }),
    ).toBe(0);
    expect((await total('route_inclusion')) - before).toBe(1);
  });
});

describe('джерело: клас, не referrer', () => {
  it('клас, не referrer: у базі лише одне зі слів, а рядка немає ніде', async () => {
    const SECRET = 'jane-doe-secret-query';
    const cases: Array<[string | undefined, string]> = [
      [`https://www.google.com/search?q=${SECRET}`, 'organic'],
      [`https://chatgpt.com/c/${SECRET}`, 'ai'],
      [`https://perplexity.ai/search/${SECRET}`, 'ai'],
      [undefined, 'direct'],
      [`https://blog.example/post?u=${SECRET}`, 'other'],
    ];
    for (const [ref, want] of cases) {
      const ip = nextVisitor();
      await send('/events', { event: 'spot_view', slug: SLUG, ref }, { ip });
      const got = (
        await db.query(
          `SELECT DISTINCT source FROM spot_event_daily WHERE camping_spot_id=$1 AND event='spot_view'`,
          [spotId],
        )
      ).rows.map((r) => r.source);
      expect(got).toContain(want);
    }
    const dump = JSON.stringify(
      (await db.query('SELECT * FROM spot_event_daily')).rows,
    );
    expect(dump).not.toContain(SECRET);
    expect(dump).not.toContain('google.com');
    const sources = (
      await db.query('SELECT DISTINCT source FROM spot_event_daily')
    ).rows.map((r) => r.source);
    for (const s of sources)
      expect(['organic', 'ai', 'direct', 'other']).toContain(s);
  });
});

describe('/out/:slug — не відкритий редирект', () => {
  const go = (path: string, ua = HUMAN_UA, ip = nextVisitor()) =>
    fetch(`${base}${path}`, {
      redirect: 'manual',
      headers: {
        'user-agent': ua,
        'cf-connecting-ip': ip,
        connection: 'close',
      },
    });

  it('веде на адресу З БАЗИ і лічить клік', async () => {
    const before = await total('website_click');
    const r = await go(`/out/${SLUG}`);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(SITE);
    expect((await total('website_click')) - before).toBe(1);
  });

  it('чужий URL у параметрі запиту ігнорується: Location лишається адресою з бази', async () => {
    const evil = 'https://evil.example/phish';
    for (const q of [
      'url',
      'to',
      'next',
      'redirect',
      'u',
      'target',
      'dest',
      'website',
    ]) {
      const r = await go(`/out/${SLUG}?${q}=${encodeURIComponent(evil)}`);
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe(SITE);
    }
  });

  it('чужий URL замість slug — 404, не перехід', async () => {
    for (const p of [
      '/out/https://evil.example',
      '/out/%2F%2Fevil.example',
      '/out/..%2F..%2Fevil.example',
      `/out/${NO_SITE}`,
      `/out/${BAD_SITE}`,
      '/out/no-such',
    ]) {
      const r = await go(p);
      expect(r.status).toBe(404);
      expect(r.headers.get('location')).toBeNull();
    }
  });

  it('бот проходить, але не рахується; людина двічі — один клік', async () => {
    const before = await total('website_click');
    expect((await go(`/out/${SLUG}`, GOOGLEBOT_UA)).status).toBe(302);
    expect(await total('website_click')).toBe(before);
    const ip = '192.0.2.150';
    await go(`/out/${SLUG}`, HUMAN_UA, ip);
    await go(`/out/${SLUG}`, HUMAN_UA, ip);
    expect((await total('website_click')) - before).toBe(1);
  });
});

describe('пошуки з нульовим результатом', () => {
  const zeroRows = async () =>
    (
      await db.query(
        'SELECT surface, filters, n FROM zero_result_search_daily ORDER BY filters',
      )
    ).rows;

  it('пишуться канонічно, з фільтрами; порядок не має значення', async () => {
    expect(
      (
        await send('/events/zero', {
          surface: 'map',
          filters: ['overnight', 'amenity:shower', 'type:paid', 'type:free'],
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await send('/events/zero', {
          surface: 'map',
          filters: ['type:free', 'type:paid', 'amenity:shower', 'overnight'],
        })
      ).status,
    ).toBe(202);
    expect(
      (await send('/events/zero', { surface: 'search', filters: [] })).status,
    ).toBe(202);
    const rows = await zeroRows();
    expect(rows).toContainEqual({
      surface: 'map',
      filters: 'type:free,paid|amenity:shower|overnight',
      n: 2,
    });
    expect(rows).toContainEqual({ surface: 'search', filters: '', n: 1 });
  });

  it('текст, якого немає в закритому переліку, відхиляється і не пишеться', async () => {
    const before = (await zeroRows()).length;
    for (const filters of [
      ['Jane Doe'],
      ['amenity:jane'],
      ['type:'],
      'free',
      [1],
    ]) {
      expect(
        (await send('/events/zero', { surface: 'map', filters })).status,
      ).toBe(400);
    }
    expect(
      (await send('/events/zero', { surface: 'x', filters: [] })).status,
    ).toBe(400);
    expect((await zeroRows()).length).toBe(before);
  });

  it('бот не рахується', async () => {
    const before = JSON.stringify(await zeroRows());
    await send(
      '/events/zero',
      { surface: 'map', filters: ['wifi'] },
      { ua: GOOGLEBOT_UA },
    );
    expect(JSON.stringify(await zeroRows())).toBe(before);
  });
});
