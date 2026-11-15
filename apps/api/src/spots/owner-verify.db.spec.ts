import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import type { DataSource, QueryRunner } from 'typeorm';
import { DevMailbox, MailMessage, MailSender } from '../auth/mail';
import { MAILER } from '../auth/account.service';
import { WarningsService } from '../warnings/warnings.service';
import { SpotClaimService } from './spot-claim.service';

// CAMP-505 — самоверифікація власника по домену пошти, проти СПРАВЖНЬОЇ
// PostgreSQL і СПРАВЖНЬОГО застосунку.
//
// 🔴 ЧОМУ ВЕСЬ ЗАСТОСУНОК І ВЕСЬ ЛАНЦЮГ МІГРАЦІЙ. Кожна обіцянка картки — про
// те, що сторонній бачить по HTTP і що база відмовляється тримати:
// «збіг домену → підтверджено», «gmail → ні», «повторне посилання → ні»,
// «токен у базі не сирий», «відповідь однакова». Тест, що збирає
// контролер руками, відповідає на інше питання. Тож: усі міграції по
// порядку на скретч-базі, потім `AppModule` — той самий глобальний
// throttle, ті самі middleware і контролери. Підміняється лише ПОШТА, і то
// на записувач того самого інтерфейсу: потік під тестом цього не знає.
//
// A MISSING DATABASE IS A FAILURE, NOT A SKIP. Потрібен
// CAMP_TEST_DATABASE_URL (локально) або CI_DATABASE_URL: будь-яка PostGIS
// база, де можна CREATE DATABASE. Файл створює власну `camp505_*` і
// видаляє її; у названій базі нічого не чіпає.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(180_000);

let admin: Client;
let db: Client;
let dbName: string;
let app: INestApplication;
let base: string;

/** Листи, які бачив записувач, і важіль, щоб його уповільнити. */
const box = new DevMailbox(() => undefined);
let latencyMs = 0;
const sender: MailSender = {
  async send(m: MailMessage) {
    if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
    await box.send(m);
  },
};

/** Куди ведуть листи. Виписано, не імпортовано: це оракул. */
const WEB = 'https://site.example';

// `AppModule` стартує опитувач метеотривог, а той першим ділом тягне 27
// стрічок по HTTPS. Тут про власників: інтернету не чіпаємо.
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
  dbName = `camp505_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await migrateEverything(db);

  process.env.DATABASE_URL = url.toString();
  // Кожен запит приносить власну адресу викликача, тож ліміт рахує його
  // окремо; тести ПРО ліміт тримають одну адресу.
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

let callers = 0;
const nextCaller = () => `203.0.113.${(callers++ % 250) + 1}`;

type Reply = { status: number; text: string; json: any };

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
    /* не JSON */
  }
  return { status: res.status, text, json };
}

const auth = (token?: string): Record<string, string> =>
  token ? { authorization: `Bearer ${token}` } : {};
const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) => send('POST', path, body, headers);

const settle = () => app.get(SpotClaimService).drain();

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

let counter = 0;
const uniq = () => `${process.pid}x${++counter}`;

/** Справжня реєстрація: токен сесії приходить одразу. */
async function account(): Promise<{ token: string; id: string }> {
  const email = `owner.${uniq()}@example.com`;
  const res = await post('/auth/signup', {
    email,
    password: 'a long enough password',
  });
  expect(res.status).toBe(201);
  const id = (await db.query('SELECT id FROM users WHERE email = $1', [email]))
    .rows[0].id;
  return { token: res.json.token as string, id };
}

/**
 * `ageDays` — скільки днів тому наші дані про кемпінг востаннє змінились
 * (`content_changed_at`). За замовчуванням 60: старше за поріг у 30 днів, тож
 * тести про ІНШІ правила не впираються в правило віку. `null` — невідомо.
 */
async function spot(
  slug: string,
  website: string | null,
  contact: Record<string, unknown> | null,
  ageDays: number | null = 60,
): Promise<string> {
  const r = await db.query(
    `INSERT INTO camping_spots
       (osm_ref, country, region, slug, name, type, amenities, location,
        website, contact, content_changed_at)
     VALUES ($1, 'DE', 'Bayern', $1, $2, 'paid'::camping_spots_type_enum, '{}',
             ST_SetSRID(ST_MakePoint(11, 48), 4326), $3, $4,
             CASE WHEN $5::int IS NULL THEN NULL
                  ELSE now() - ($5::int * interval '1 day') END)
     RETURNING id`,
    [slug, `Camping ${slug}`, website, contact, ageDays],
  );
  return r.rows[0].id;
}

/** Домен, якого ще ніхто в цій базі не згадував: інакше він «спільний». */
const dom = (prefix: string) => `${prefix}${uniq()}.de`;

const lettersTo = (to: string) =>
  box.sent.filter((m) => m.to === to && m.kind === 'claim_owner_link');

/** Сирий токен із листа: те, що відправить клік людини. */
const tokenIn = (m: MailMessage): string =>
  new URL(/https?:\/\/\S+/.exec(m.text)![0]).searchParams.get('t')!;

async function ask(token: string | undefined, slug: string, email: unknown) {
  const res = await post('/spot-claims/by-email', { slug, email }, auth(token));
  await settle();
  return res;
}

const confirm = (token: string | undefined, t: unknown) =>
  post('/spot-claims/by-email/confirm', { token: t }, auth(token));

const rowsFor = async (spotId: string) =>
  (
    await db.query('SELECT * FROM spot_claims WHERE camping_spot_id = $1', [
      spotId,
    ])
  ).rows;

// ── збіг домену → підтверджено ──────────────────────────────────────────

describe('домен пошти збігається з доменом сайту кемпінгу', () => {
  it('🔴 лист іде на введену адресу, клік підтверджує, грант записано', async () => {
    const u = await account();
    const slug = `alpen-${uniq()}`;
    const d = dom('alpenblick-camping');
    const spotId = await spot(slug, `https://www.${d}/`, {});
    const to = `chef.${uniq()}@mail.${d}`;

    const res = await ask(u.token, slug, to);
    expect(res.status).toBe(202);

    const letters = lettersTo(to);
    expect(letters).toHaveLength(1);
    // Посилання — з налаштування, фіксований шлях, один параметр.
    const link = new URL(/https?:\/\/\S+/.exec(letters[0].text)![0]);
    expect(link.origin).toBe(WEB);
    expect(link.pathname).toBe('/account/claim/confirm');
    expect([...link.searchParams.keys()]).toEqual(['t']);

    const ok = await confirm(u.token, tokenIn(letters[0]));
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({
      confirmed: true,
      slug,
      name: `Camping ${slug}`,
    });

    const [row] = await rowsFor(spotId);
    expect(row.user_id).toBe(u.id);
    expect(row.used_at).not.toBeNull();
    expect(row.method).toBe('link');
    expect(row.basis).toBe('website-domain');

    // Це справжній грант: той самий, що читає кабінет власника.
    const mine = await send('GET', '/owner/listings', undefined, auth(u.token));
    expect(mine.status).toBe(200);
    expect(mine.json.listings.map((l: { slug: string }) => l.slug)).toContain(
      slug,
    );
  });

  it('🔴 адреса, що дослівно є в контактах (на не-поштовику), теж проходить; інша скринька того ж домену — ні', async () => {
    const u = await account();
    const slug = `listed-${uniq()}`;
    const listed = `booking.${uniq()}@reservierung-partner.eu`;
    const spotId = await spot(slug, null, { email: listed });

    await ask(u.token, slug, listed.toUpperCase());
    expect(lettersTo(listed)).toHaveLength(1);

    const other = `anyone.${uniq()}@reservierung-partner.eu`;
    await ask(u.token, slug, other);
    expect(lettersTo(other)).toHaveLength(0);
    expect((await rowsFor(spotId)).map((r) => r.basis)).toEqual([
      'listed-email',
    ]);
  });
});

describe('🔴 що НЕ підтверджує автоматично', () => {
  it('gmail — ні, навіть коли це дослівно контакт із бази й домен «сайту»', async () => {
    const u = await account();
    const slug = `gmail-${uniq()}`;
    const addr = `camp.${uniq()}@gmail.com`;
    const spotId = await spot(slug, 'https://gmail.com', { email: addr });
    await ask(u.token, slug, addr);
    expect(lettersTo(addr)).toHaveLength(0);
    expect(await rowsFor(spotId)).toHaveLength(0);
  });

  it.each(['outlook.com', 'gmx.de', 'orange.fr', 'web.de', 'yahoo.com.br'])(
    'поштовик %s — ні',
    async (domain) => {
      const u = await account();
      const slug = `free-${uniq()}`;
      const addr = `camp.${uniq()}@${domain}`;
      const spotId = await spot(slug, `https://${domain}`, { email: addr });
      await ask(u.token, slug, addr);
      expect(lettersTo(addr)).toHaveLength(0);
      expect(await rowsFor(spotId)).toHaveLength(0);
    },
  );

  it('чужий домен — ні', async () => {
    const u = await account();
    const slug = `foreign-${uniq()}`;
    const spotId = await spot(slug, `https://www.${dom('alpen')}`, {});
    const to = `chef.${uniq()}@some-other-company.de`;
    await ask(u.token, slug, to);
    expect(lettersTo(to)).toHaveLength(0);
    expect(await rowsFor(spotId)).toHaveLength(0);
  });

  it.each([
    (d: string) => `evil-${d}`,
    (d: string) => `${d}.evil.com`,
    (d: string) => d.replace(/\.de$/, '.com'),
  ])('схожий домен — ні (не за підрядком)', async (look) => {
    const u = await account();
    const slug = `lookalike-${uniq()}`;
    const d = dom('alpenblick-camping');
    const spotId = await spot(slug, `https://www.${d}`, {});
    const to = `chef.${uniq()}@${look(d)}`;
    await ask(u.token, slug, to);
    expect(lettersTo(to)).toHaveLength(0);
    expect(await rowsFor(spotId)).toHaveLength(0);
  });

  it('кемпінг без сайту й без контакту — нікому', async () => {
    const u = await account();
    const slug = `bare-${uniq()}`;
    const spotId = await spot(slug, null, {});
    const to = `chef.${uniq()}@${dom('alpenblick-camping')}`;
    await ask(u.token, slug, to);
    expect(lettersTo(to)).toHaveLength(0);
    expect(await rowsFor(spotId)).toHaveLength(0);
  });

  it('вже підтверджений кемпінг не шле листів нікому', async () => {
    const owner = await account();
    const other = await account();
    const slug = `taken-${uniq()}`;
    const spotId = await spot(slug, 'https://www.taken-camping.de', {});
    const first = `a.${uniq()}@taken-camping.de`;
    await ask(owner.token, slug, first);
    await confirm(owner.token, tokenIn(lettersTo(first)[0]));

    const second = `b.${uniq()}@taken-camping.de`;
    await ask(other.token, slug, second);
    expect(lettersTo(second)).toHaveLength(0);
    expect((await rowsFor(spotId)).filter((r) => r.used_at)).toHaveLength(1);
  });
});

// ── посилання ───────────────────────────────────────────────────────────

describe('посилання: одноразове, з терміном, лише для того, хто почав', () => {
  async function pending() {
    const u = await account();
    const slug = `link-${uniq()}`;
    const d = dom('linkcamp');
    const spotId = await spot(slug, `https://www.${d}`, {});
    const to = `chef.${uniq()}@${d}`;
    await ask(u.token, slug, to);
    const token = tokenIn(lettersTo(to)[0]);
    return { u, slug, spotId, to, token };
  }

  it('🔴 повторне використання — ні', async () => {
    const p = await pending();
    expect((await confirm(p.u.token, p.token)).status).toBe(200);
    const again = await confirm(p.u.token, p.token);
    expect(again.status).toBe(400);
    expect(again.json.code).toBe('link_invalid');
  });

  it('🔴 прострочене — ні, і нічого не записано', async () => {
    const p = await pending();
    await db.query(
      `UPDATE spot_claims SET expires_at = now() - interval '1 second'
        WHERE camping_spot_id = $1`,
      [p.spotId],
    );
    const res = await confirm(p.u.token, p.token);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('link_invalid');
    expect((await rowsFor(p.spotId)).filter((r) => r.used_at)).toHaveLength(0);
  });

  it('живе рівно годину', async () => {
    const p = await pending();
    const [row] = await rowsFor(p.spotId);
    const life =
      new Date(row.expires_at).getTime() - new Date(row.created_at).getTime();
    expect(life).toBeGreaterThan(59 * 60_000);
    expect(life).toBeLessThanOrEqual(60 * 60_000 + 5_000);
  });

  it('🔴 чужий акаунт — ні, і посилання лишається живим для того, хто почав', async () => {
    const p = await pending();
    const stranger = await account();
    const res = await confirm(stranger.token, p.token);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('link_invalid');
    expect((await rowsFor(p.spotId)).filter((r) => r.used_at)).toHaveLength(0);
    expect((await confirm(p.u.token, p.token)).status).toBe(200);
  });

  it('🔴 без сесії — 401, і нічого не підтверджено', async () => {
    const p = await pending();
    expect((await confirm(undefined, p.token)).status).toBe(401);
    expect((await ask(undefined, p.slug, p.to)).status).toBe(401);
    expect((await rowsFor(p.spotId)).filter((r) => r.used_at)).toHaveLength(0);
  });

  it('🔴 відкриття посилання (GET) нічого не підтверджує: такого маршруту немає', async () => {
    const p = await pending();
    const res = await send(
      'GET',
      `/spot-claims/by-email/confirm?t=${p.token}`,
      undefined,
      auth(p.u.token),
    );
    expect(res.status).toBe(404);
    expect((await rowsFor(p.spotId)).filter((r) => r.used_at)).toHaveLength(0);
  });

  it.each([
    undefined,
    null,
    '',
    'short',
    'x'.repeat(500),
    42,
    ['a'],
    {},
    `${'A'.repeat(43)}'; DROP TABLE users;--`,
  ])('сміття замість токена %j — ні, а не 500', async (junk) => {
    const u = await account();
    const res = await confirm(u.token, junk);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('link_invalid');
  });

  it('🔴 два кліки під блокуванням рядка: виграє рівно один (UPDATE один, а не SELECT і UPDATE)', async () => {
    const p = await pending();
    const id = (await rowsFor(p.spotId))[0].id as string;
    // Рядок тримає ДРУГЕ з'єднання. Обидва кліки доходять до бази й стоять
    // у черзі на блокуванні; лише коли обидва вже чекають, блокування
    // знімається. Без цього тест залежав би від того, чи два запити збігом
    // обставин перетнуться, — і мутація «SELECT, потім UPDATE» його
    // переживала (рецензія PR #586).
    const holderUrl = new URL(ADMIN_URL!);
    holderUrl.pathname = `/${dbName}`;
    const holder = new Client({ connectionString: holderUrl.toString() });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        'SELECT id FROM spot_claims WHERE id = $1 FOR UPDATE',
        [id],
      );
      const a = confirm(p.u.token, p.token);
      const b = confirm(p.u.token, p.token);
      for (let i = 0; i < 100; i++) {
        const waiting = await db.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        if (waiting.rows[0].n >= 2) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const waiting = await db.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      expect(waiting.rows[0].n).toBeGreaterThanOrEqual(2);
      await holder.query('COMMIT');
      const [ra, rb] = await Promise.all([a, b]);
      expect([ra.status, rb.status].sort()).toEqual([200, 400]);
    } finally {
      await holder.end();
    }
    expect((await rowsFor(p.spotId)).filter((r) => r.used_at)).toHaveLength(1);
  });

  it('🔴 два акаунти, два посилання на один кемпінг: підтверджений лишається один', async () => {
    const slug = `race-${uniq()}`;
    const spotId = await spot(slug, 'https://www.racecamp.de', {});
    const u1 = await account();
    const u2 = await account();
    const a = `a.${uniq()}@racecamp.de`;
    const b = `b.${uniq()}@racecamp.de`;
    await ask(u1.token, slug, a);
    await ask(u2.token, slug, b);
    const [r1, r2] = await Promise.all([
      confirm(u1.token, tokenIn(lettersTo(a)[0])),
      confirm(u2.token, tokenIn(lettersTo(b)[0])),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 400]);
    expect((await rowsFor(spotId)).filter((r) => r.used_at)).toHaveLength(1);
  });
});

describe('🔴 токен у базі не сирий', () => {
  it('у жодній колонці немає токена, а code_hash — це sha256 від нього', async () => {
    const u = await account();
    const slug = `hash-${uniq()}`;
    const spotId = await spot(slug, 'https://www.hashcamp.de', {});
    const to = `chef.${uniq()}@hashcamp.de`;
    await ask(u.token, slug, to);
    const token = tokenIn(lettersTo(to)[0]);

    const [row] = await rowsFor(spotId);
    expect(row.code_hash).toBe(sha256(token));
    for (const v of Object.values(row)) expect(String(v)).not.toContain(token);
    // Повного дампа таблиці теж: адреса не лежить ніде, лише маска.
    const dump = JSON.stringify(
      (await db.query('SELECT * FROM spot_claims')).rows,
    );
    expect(dump).not.toContain(token);
    expect(dump).not.toContain(to);
    expect(row.sent_to_masked).toMatch(/^c\*\*\*@h\*\*\*\.de$/);
  });
});

// ── без перелічення ─────────────────────────────────────────────────────

describe('🔴 відповідь однакова: є кемпінг чи ні, збігся домен чи ні', () => {
  it('однакові статус і тіло для збігу, чужого домену, поштовика, невідомого кемпінгу, зайнятого кемпінгу й вичерпаної межі', async () => {
    const u = await account();
    const slug = `same-${uniq()}`;
    await spot(slug, 'https://www.samecamp.de', {});

    const replies: Reply[] = [];
    // збіг
    replies.push(await ask(u.token, slug, `a.${uniq()}@samecamp.de`));
    // чужий домен
    replies.push(await ask(u.token, slug, `b.${uniq()}@elsewhere.de`));
    // поштовик
    replies.push(await ask(u.token, slug, `c.${uniq()}@gmail.com`));
    // немає такого кемпінгу
    replies.push(
      await ask(u.token, `no-such-${uniq()}`, `d.${uniq()}@samecamp.de`),
    );

    // зайнятий кемпінг
    const owner = await account();
    const takenSlug = `same-taken-${uniq()}`;
    await spot(takenSlug, 'https://www.takencamp.de', {});
    const first = `e.${uniq()}@takencamp.de`;
    await ask(owner.token, takenSlug, first);
    await confirm(owner.token, tokenIn(lettersTo(first)[0]));
    replies.push(await ask(u.token, takenSlug, `f.${uniq()}@takencamp.de`));

    // вичерпана межа на кемпінг: три листи, четвертий мовчки не йде
    const floodSlug = `same-flood-${uniq()}`;
    await spot(floodSlug, 'https://www.floodcamp.de', {});
    for (let i = 0; i < 3; i++)
      await ask(u.token, floodSlug, `g${i}.${uniq()}@floodcamp.de`);
    const over = `g9.${uniq()}@floodcamp.de`;
    replies.push(await ask(u.token, floodSlug, over));
    expect(lettersTo(over)).toHaveLength(0);

    expect(new Set(replies.map((r) => r.status))).toEqual(new Set([202]));
    expect(new Set(replies.map((r) => r.text)).size).toBe(1);
  });

  it('вичерпана межа на АДРЕСУ теж мовчки: четверта спроба тією самою адресою листа не шле', async () => {
    const u = await account();
    // Чотири РІЗНІ кемпінги з одним доменом: межа «3 на кемпінг» не має
    // шансу спрацювати, тож три листи зупиняє саме межа на адресу.
    const to = `chef.${uniq()}@addrcamp.de`;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const slug = `addr-${uniq()}`;
      // Адреса дослівно в контактах чотирьох кемпінгів: цей шлях не залежить
      // від того, що домен `addrcamp.de` спільний.
      await spot(slug, null, { email: to });
      statuses.push((await ask(u.token, slug, to)).status);
    }
    expect(statuses).toEqual([202, 202, 202, 202]);
    expect(lettersTo(to)).toHaveLength(3);
  });

  it('межа на акаунт: після десяти заявок за добу лист не йде', async () => {
    const u = await account();
    for (let i = 0; i < 10; i++) {
      const slug = `user-${uniq()}`;
      const id = await spot(slug, null, {});
      await db.query(
        `INSERT INTO spot_claims (camping_spot_id, user_id, code_hash, sent_to_masked, expires_at)
         VALUES ($1, $2, repeat('a', 64), 'a***@b***.de', now() + interval '1 hour')`,
        [id, u.id],
      );
    }
    const slug = `user-over-${uniq()}`;
    await spot(slug, 'https://www.usercamp.de', {});
    const to = `chef.${uniq()}@usercamp.de`;
    expect((await ask(u.token, slug, to)).status).toBe(202);
    expect(lettersTo(to)).toHaveLength(0);
  });

  it('🔴 лист не затримує відповідь: збіг відповідає не повільніше за промах', async () => {
    const u = await account();
    // Кожен «збіг» — на власному кемпінгу: інакше межа «3 на кемпінг»
    // мовчки скасувала б лист, і вимірювали б промах, названий збігом.
    const slugs: string[] = [];
    const hits: string[] = [];
    for (let i = 0; i < 7; i++) {
      const slug = `time-${uniq()}`;
      const addr = `h${i}.${uniq()}@timecamp.de`;
      await spot(slug, null, { email: addr });
      slugs.push(slug);
      hits.push(addr);
    }
    const before = box.sent.length;
    latencyMs = 200;
    try {
      const hit: number[] = [];
      const miss: number[] = [];
      for (let i = 0; i < 7; i++) {
        let t = performance.now();
        await post(
          '/spot-claims/by-email',
          { slug: slugs[i], email: hits[i] },
          auth(u.token),
        );
        hit.push(performance.now() - t);
        t = performance.now();
        await post(
          '/spot-claims/by-email',
          { slug: slugs[i], email: `m${i}.${uniq()}@elsewhere.de` },
          auth(u.token),
        );
        miss.push(performance.now() - t);
      }
      await settle();
      // Доказ, що вимірювали справжні збіги: сім листів справді пішли.
      expect(
        box.sent.slice(before).filter((m) => m.kind === 'claim_owner_link'),
      ).toHaveLength(7);
      const median = (xs: number[]) =>
        [...xs].sort((a, b) => a - b)[xs.length >> 1];
      expect(median(hit) - median(miss)).toBeLessThan(latencyMs / 2);
    } finally {
      latencyMs = 0;
    }
  });
});

// ── межі й захист ───────────────────────────────────────────────────────

describe('захист', () => {
  it('🔴 ліміт на IP: з однієї адреси викликача одинадцятий запит за вікно — 429', async () => {
    const u = await account();
    const slug = `ip-${uniq()}`;
    await spot(slug, 'https://www.ipcamp.de', {});
    const same = { 'cf-connecting-ip': '198.51.100.77', ...auth(u.token) };
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await post(
        '/spot-claims/by-email',
        { slug, email: `ip${i}.${uniq()}@elsewhere.de` },
        same,
      );
      statuses.push(r.status);
    }
    await settle();
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(202));
    expect(statuses[10]).toBe(429);
  });

  it('🔴 посилання в листі будується з налаштування, а не із заголовків запиту', async () => {
    const u = await account();
    const slug = `host-${uniq()}`;
    await spot(slug, 'https://www.hostcamp.de', {});
    const to = `chef.${uniq()}@hostcamp.de`;
    await post(
      '/spot-claims/by-email',
      { slug, email: to },
      {
        ...auth(u.token),
        host: 'evil.example',
        'x-forwarded-host': 'evil.example',
        origin: 'https://evil.example',
      },
    );
    await settle();
    const link = /https?:\/\/\S+/.exec(lettersTo(to)[0].text)![0];
    expect(link.startsWith(`${WEB}/account/claim/confirm?t=`)).toBe(true);
    expect(lettersTo(to)[0].html).not.toContain('evil.example');
  });

  it('🔴 введена адреса з двома одержувачами не йде нікому', async () => {
    const u = await account();
    const slug = `inj-${uniq()}`;
    await spot(slug, 'https://www.injcamp.de', {});
    const claimLetters = () =>
      box.sent.filter((m) => m.kind === 'claim_owner_link').length;
    const before = claimLetters();
    for (const bad of [
      `a@injcamp.de, evil@x.de`,
      `a@injcamp.de\r\nBcc: evil@x.de`,
      `"a"@injcamp.de`,
      `Name <a@injcamp.de>`,
    ]) {
      const res = await ask(u.token, slug, bad);
      expect(res.status).toBe(400);
      expect(res.json.code).toBe('bad_email');
    }
    expect(claimLetters()).toBe(before);
  });

  it('🔴 ні введена адреса, ні токен не потрапляють у журнал застосунку', async () => {
    const lines: string[] = [];
    const spies = (['log', 'error', 'warn', 'debug', 'verbose'] as const).map(
      (level) =>
        jest
          .spyOn(Logger.prototype, level)
          .mockImplementation((...args: unknown[]) => {
            lines.push(args.map(String).join(' '));
          }),
    );
    const out = jest.spyOn(process.stdout, 'write').mockImplementation(((
      chunk: unknown,
    ) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    try {
      const u = await account();
      const slug = `logs-${uniq()}`;
      await spot(slug, 'https://www.logscamp.de', {});
      const hit = `chef.${uniq()}@logscamp.de`;
      const miss = `chef.${uniq()}@elsewhere.de`;
      await ask(u.token, slug, hit);
      await ask(u.token, slug, miss);
      await confirm(u.token, tokenIn(lettersTo(hit)[0]));
      const all = lines.join('\n');
      expect(all).not.toContain(hit);
      expect(all).not.toContain(miss);
      expect(all).not.toContain(tokenIn(lettersTo(hit)[0]));
      // Журнал не порожній з іншої причини: причина мовчазної відмови там є.
      expect(all).toContain('owner link not sent: no-match');
    } finally {
      for (const s of spies) s.mockRestore();
      out.mockRestore();
    }
  });

  it('лист не називає заявника й каже «нічого не робіть» першим', async () => {
    const u = await account();
    const slug = `words-${uniq()}`;
    await spot(slug, 'https://www.wordscamp.de', {});
    const to = `chef.${uniq()}@wordscamp.de`;
    await ask(u.token, slug, to);
    const m = lettersTo(to)[0];
    expect(m.text).toContain('If that was not you or your team: do nothing');
    expect(m.text).toContain(`Camping ${slug}`);
    const [acct] = (
      await db.query('SELECT email FROM users WHERE id = $1', [u.id])
    ).rows;
    expect(m.text).not.toContain(acct.email);
    expect(m.html).not.toContain(acct.email);
  });
});

describe('код з OSM-пошти (CAMP-51) і посилання не чіпають одне одного', () => {
  it('🔴 хибний код не палить спроб рядка-посилання і не підтверджує його', async () => {
    const u = await account();
    const slug = `iso-${uniq()}`;
    const spotId = await spot(slug, 'https://www.isocamp.de', {});
    const to = `chef.${uniq()}@isocamp.de`;
    await ask(u.token, slug, to);

    const res = await post(
      '/spot-claims/confirm',
      { slug, code: 'AAAAAAAA' },
      auth(u.token),
    );
    expect(res.status).toBe(404);
    expect(res.json.code).toBe('no_pending');
    const [row] = await rowsFor(spotId);
    expect(row.attempts).toBe(0);
    expect(row.used_at).toBeNull();
  });
});

describe('пошта не налаштована', () => {
  it('🔴 503 для всіх однаково, і в базу нічого не пишеться', async () => {
    const shim = {
      query: async (sql: string, params?: unknown[]) =>
        (await db.query(sql, params)).rows,
    } as unknown as DataSource;
    const svc = new SpotClaimService(shim, null);
    const u = await account();
    const before = (await db.query('SELECT count(*)::int n FROM spot_claims'))
      .rows[0].n;
    expect(await svc.startByEmail('whatever', u.id, 'a@samecamp.de')).toEqual({
      ok: false,
      why: 'mail-unavailable',
    });
    const after = (await db.query('SELECT count(*)::int n FROM spot_claims'))
      .rows[0].n;
    expect(after).toBe(before);
  });
});

describe('схема', () => {
  it('🔴 база не пропускає «по посиланню» без підстави і підставу без посилання', async () => {
    const u = await account();
    const spotId = await spot(`ck-${uniq()}`, null, {});
    const ins = (method: string, basis: string | null) =>
      db.query(
        `INSERT INTO spot_claims (camping_spot_id, user_id, code_hash, sent_to_masked, expires_at, method, basis)
         VALUES ($1, $2, $3, 'a***@b***.de', now() + interval '1 hour', $4, $5)`,
        [spotId, u.id, sha256(uniq()), method, basis],
      );
    await expect(ins('link', null)).rejects.toThrow(
      /spot_claims_basis_iff_link/,
    );
    await expect(ins('osm_code', 'website-domain')).rejects.toThrow(
      /spot_claims_basis_iff_link/,
    );
    await expect(ins('link', 'because')).rejects.toThrow(
      /spot_claims_basis_known/,
    );
    await expect(ins('telepathy', null)).rejects.toThrow(
      /spot_claims_method_known/,
    );
    await expect(ins('link', 'website-domain')).resolves.toBeTruthy();
  });

  it('🔴 два рядки з одним хешем токена не живуть разом', async () => {
    const u = await account();
    const a = await spot(`dup-${uniq()}`, null, {});
    const b = await spot(`dup-${uniq()}`, null, {});
    const h = sha256(uniq());
    const ins = (spotId: string) =>
      db.query(
        `INSERT INTO spot_claims (camping_spot_id, user_id, code_hash, sent_to_masked, expires_at, method, basis)
         VALUES ($1, $2, $3, 'a***@b***.de', now() + interval '1 hour', 'link', 'website-domain')`,
        [spotId, u.id, h],
      );
    await ins(a);
    await expect(ins(b)).rejects.toThrow(/IDX_spot_claims_link_hash/);
  });
});

// ── рецензія PR #586 ────────────────────────────────────────────────────

describe('🔴 рецензія #586, п.1: домен пошти — це хост, а не URL', () => {
  it.each([
    (d: string) => `a@${d}/.evil.example`,
    (d: string) => `a@${d}?.evil.example`,
    (d: string) => `a@${d}#.evil.example`,
  ])(
    'форма з `/`, `?`, `#` не проходить як збіг і не дістає листа',
    async (form) => {
      const u = await account();
      const slug = `slash-${uniq()}`;
      const d = dom('slashcamp');
      const spotId = await spot(slug, `https://www.${d}`, {});
      const bad = form(d);
      const res = await ask(u.token, slug, bad);
      expect(res.status).toBe(400);
      expect(res.json.code).toBe('bad_email');
      expect(
        box.sent.filter((m) => m.to.includes('evil.example')),
      ).toHaveLength(0);
      expect(await rowsFor(spotId)).toHaveLength(0);
    },
  );
});

describe('🔴 рецензія #586, п.2: сторонній не закриває дорогу власнику', () => {
  it('три заявки чужого акаунта на кемпінг і три на адресу власника не заважають листу власника', async () => {
    const stranger = await account();
    const other = await account();
    const owner = await account();
    const slug = `block-${uniq()}`;
    const d = dom('blockcamp');
    await spot(slug, `https://www.${d}`, {});
    const chef = `chef.${uniq()}@${d}`;
    // Чужий акаунт тричі вписує саме адресу власника (вичерпує «3 на адресу»
    // для себе) і ще двічі — інші адреси (разом «3 на кемпінг» для себе).
    for (let i = 0; i < 3; i++) await ask(stranger.token, slug, chef);
    for (let i = 0; i < 3; i++)
      await ask(other.token, slug, `o${i}.${uniq()}@${d}`);
    expect(lettersTo(chef)).toHaveLength(3);
    // Власник — інший акаунт — отримує свій лист.
    await ask(owner.token, slug, chef);
    expect(lettersTo(chef)).toHaveLength(4);
  });

  it('межа на пару працює: четверта заявка ТОГО САМОГО акаунта на той самий кемпінг листа не шле', async () => {
    const u = await account();
    const slug = `pair-${uniq()}`;
    const d = dom('paircamp');
    await spot(slug, `https://www.${d}`, {});
    const addrs = [0, 1, 2, 3].map((i) => `p${i}.${uniq()}@${d}`);
    for (const a of addrs) await ask(u.token, slug, a);
    expect(addrs.map((a) => lettersTo(a).length)).toEqual([1, 1, 1, 0]);
  });

  it('рядки-посилання чужих акаунтів не вичерпують межу коду з OSM-адреси', async () => {
    const owner = await account();
    const slug = `oldflow-${uniq()}`;
    const d = dom('oldflow');
    await spot(slug, `https://www.${d}`, { email: `info@${d}` });
    for (let i = 0; i < 3; i++) {
      const stranger = await account();
      await ask(stranger.token, slug, `s${i}.${uniq()}@${d}`);
    }
    const res = await post('/spot-claims', { slug }, auth(owner.token));
    expect(res.status).toBe(202);
    expect(
      box.sent.filter((m) => m.kind === 'claim_spot' && m.to === `info@${d}`),
    ).toHaveLength(1);
  });
});

describe('🔴 рецензія #586, п.3: домен не належить кемпінгу, якщо він чужий', () => {
  it('сайт у піддомені: збігається лише точний хост, а не весь зареєстрований домен', async () => {
    const u = await account();
    const slug = `sub-${uniq()}`;
    const d = dom('stadt');
    await spot(slug, `https://camping.${d}/`, {});
    for (const bad of [
      `x.${uniq()}@${d}`,
      `x.${uniq()}@mail.${d}`,
      `x.${uniq()}@verein.${d}`,
    ]) {
      await ask(u.token, slug, bad);
      expect(lettersTo(bad)).toHaveLength(0);
    }
    const good = `x.${uniq()}@camping.${d}`;
    await ask(u.token, slug, good);
    expect(lettersTo(good)).toHaveLength(1);
  });

  it('сайт на apex чи на www: вся родина піддоменів пошти — його', async () => {
    const u = await account();
    const slug = `apex-${uniq()}`;
    const d = dom('apexcamp');
    await spot(slug, `https://www.${d}/`, {});
    const good = `x.${uniq()}@mail.${d}`;
    await ask(u.token, slug, good);
    expect(lettersTo(good)).toHaveLength(1);
  });

  it('домен, який згадують ДВА кемпінги (сайтом чи поштою), автопідтвердження по домену не дає; дослівна адреса з контактів — дає', async () => {
    const u = await account();
    const d = dom('chain');
    const a = `chain-a-${uniq()}`;
    const b = `chain-b-${uniq()}`;
    const listed = `booking.${uniq()}@${d}`;
    await spot(a, `https://www.${d}/a`, { email: listed });
    await spot(b, `https://${d}/b`, {});
    const viaDomain = `x.${uniq()}@${d}`;
    await ask(u.token, a, viaDomain);
    await ask(u.token, b, viaDomain.replace('x.', 'y.'));
    expect(lettersTo(viaDomain)).toHaveLength(0);
    expect(lettersTo(viaDomain.replace('x.', 'y.'))).toHaveLength(0);
    // Дослівна адреса з контактів — окремий шлях, і він не заблокований.
    await ask(u.token, a, listed);
    expect(lettersTo(listed)).toHaveLength(1);
  });

  it('спільним домен стає й тоді, коли другий кемпінг згадує його лише ПОШТОЮ', async () => {
    const u = await account();
    const d = dom('mailonly');
    const a = `mailonly-a-${uniq()}`;
    await spot(a, `https://www.${d}`, {});
    await spot(`mailonly-b-${uniq()}`, null, { email: `info@${d}` });
    const to = `x.${uniq()}@${d}`;
    await ask(u.token, a, to);
    expect(lettersTo(to)).toHaveLength(0);
  });

  it('підрядок — не повтор: домен, що лише міститься в чужому, спільним не робить', async () => {
    const u = await account();
    const d = dom('substr');
    const a = `substr-a-${uniq()}`;
    await spot(a, `https://www.${d}`, {});
    await spot(`substr-b-${uniq()}`, `https://www.not-${d}`, {});
    const to = `x.${uniq()}@${d}`;
    await ask(u.token, a, to);
    expect(lettersTo(to)).toHaveLength(1);
  });
});

describe('🔴 рецензія #586, п.4: час відповіді не залежить від збігу', () => {
  it('+80 мс роботи лише на збігу не видно в часі відповіді', async () => {
    const u = await account();
    const slug = `lag-${uniq()}`;
    const d = dom('lagcamp');
    await spot(slug, `https://www.${d}`, {});
    const real = (SpotClaimService.prototype as any).attempt;
    const spy = jest
      .spyOn(SpotClaimService.prototype as any, 'attempt')
      .mockImplementation(async function (this: unknown, ...args: unknown[]) {
        // args: slug, viewerId, email, mailer — «збіг» це адреса на домені.
        if (String(args[2]).endsWith(`@${d}`))
          await new Promise((r) => setTimeout(r, 80));
        return real.apply(this, args);
      });
    try {
      const hit: number[] = [];
      const miss: number[] = [];
      for (let i = 0; i < 7; i++) {
        let t = performance.now();
        await post(
          '/spot-claims/by-email',
          { slug, email: `h${i}.${uniq()}@${d}` },
          auth(u.token),
        );
        hit.push(performance.now() - t);
        t = performance.now();
        await post(
          '/spot-claims/by-email',
          { slug, email: `m${i}.${uniq()}@elsewhere.de` },
          auth(u.token),
        );
        miss.push(performance.now() - t);
      }
      await settle();
      const median = (xs: number[]) =>
        [...xs].sort((a, b) => a - b)[xs.length >> 1];
      expect(median(hit) - median(miss)).toBeLessThan(40);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('🔴 рецензія #586, п.7: свіжа правка в даних автопідтвердження не дає', () => {
  async function tryAge(ageDays: number | null, mailOnly = false) {
    const u = await account();
    const slug = `age-${uniq()}`;
    const d = dom('agecamp');
    const to = `x.${uniq()}@${d}`;
    if (mailOnly) await spot(slug, null, { email: to }, ageDays);
    else await spot(slug, `https://www.${d}`, {}, ageDays);
    await ask(u.token, slug, to);
    return lettersTo(to).length;
  }

  it('значення, що змінилось 10 днів тому, — ні; 31 день тому — так', async () => {
    expect(await tryAge(10)).toBe(0);
    expect(await tryAge(31)).toBe(1);
  });

  it('невідомий вік (NULL) — ні', async () => {
    expect(await tryAge(null)).toBe(0);
  });

  it('те саме для дослівної адреси з контактів', async () => {
    expect(await tryAge(5, true)).toBe(0);
    expect(await tryAge(45, true)).toBe(1);
  });
});
