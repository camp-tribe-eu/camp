import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';

// CAMP-461 — міграція, що кладе секції хаба оренди, шаблону країни й
// сторінки компаній, проти СПРАВЖНЬОЇ бази.
//
// Усе, що вона обіцяє, — про рядки: які слоти зʼявились, що картинки
// існують на диску й мають опис, що жодне слово з переліку «внутрішньої
// кухні» не стоїть у тексті, що повторний прогін нічого не множить, що
// текст, який власник уже поправив, не перезаписується, і що `down`
// забирає лише своє. Мок цього не побачив би.
//
// 🔴 ВІДСУТНЯ БАЗА — ЦЕ ПРОВАЛ, А НЕ ПРОПУСК. Потрібен CAMP_TEST_DATABASE_URL
// (локально) або CI_DATABASE_URL.

const ADMIN_URL =
  process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

jest.setTimeout(180_000);

const THIS = '1797650000000-RentalPagesSections.ts';

type Runner = {
  up(q: QueryRunner): Promise<void>;
  down(q: QueryRunner): Promise<void>;
};

let admin: Client;
let db: Client;
let dbName: string;
let mine: Runner;

const runnerOf = (client: Client) =>
  ({
    query: async (sql: string, params?: unknown[]) =>
      (await client.query(sql, params)).rows,
  }) as unknown as QueryRunner;

async function loadMigrations(): Promise<Array<{ file: string; m: Runner }>> {
  const dir = join(__dirname, '..', 'migrations');
  const out: Array<{ file: string; m: Runner }> = [];
  for (const file of readdirSync(dir)
    .filter((f) => /^\d{13}-.*\.ts$/.test(f))
    .sort()) {
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

interface Row {
  slug: string;
  slot: string;
  type: string;
  image_url: string | null;
  cta_href: string | null;
  heading: string | null;
  subheading: string | null;
  body: string | null;
  image_alt: string | null;
  cta_label: string | null;
  items: Array<{ term: string; text: string }>;
}

const PAGES = [
  'camper-rental',
  'camper-rental-country',
  'camper-rental-providers',
];

async function rows(): Promise<Row[]> {
  const { rows: r } = await db.query(
    `SELECT p.slug, s.slot, s.type, s.image_url, s.cta_href,
            t.heading, t.subheading, t.body, t.image_alt, t.cta_label, t.items
       FROM page_sections s
       JOIN pages p ON p.id = s.page_id
       JOIN page_section_translations t ON t.section_id = s.id
      WHERE p.slug = ANY($1)
      ORDER BY p.slug, s.sort`,
    [PAGES],
  );
  return r as Row[];
}

const slotsOf = (all: Row[], slug: string) =>
  all.filter((r) => r.slug === slug).map((r) => r.slot);

beforeAll(async () => {
  if (!ADMIN_URL) {
    throw new Error(
      'Set CAMP_TEST_DATABASE_URL (any PostGIS database you may CREATE DATABASE in).\n' +
        'This suite FAILS instead of skipping: a skipped test reads as a passed one.',
    );
  }
  admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  dbName = `camp461_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();

  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.query(
    'CREATE TABLE IF NOT EXISTS migrations (id serial PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL)',
  );
  // Усі міграції, КРІМ тієї, що перевіряється: база стоїть у стані «до».
  for (const { file, m } of await loadMigrations()) {
    if (file === THIS) {
      mine = m;
      continue;
    }
    await m.up(runnerOf(db));
  }
  if (!mine) throw new Error(`${THIS} not found`);
});

afterAll(async () => {
  await db?.end();
  if (admin) {
    if (dbName)
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
});

test('anchor: before the migration only the hub intro exists, and no collection table is about to be added', async () => {
  // 🔴 Без цього «усе зʼявилось» нижче нічого б не доводило: може, сіялка
  // вже інша, і міграція нічого не додала.
  const before = await rows();
  expect(slotsOf(before, 'camper-rental')).toEqual(['intro']);
  expect(slotsOf(before, 'camper-rental-country')).toEqual([]);
  expect(slotsOf(before, 'camper-rental-providers')).toEqual([]);
});

test('up() adds exactly the slots the pages read, and nothing else', async () => {
  await mine.up(runnerOf(db));
  const after = await rows();
  expect(slotsOf(after, 'camper-rental')).toEqual([
    'intro',
    'banner',
    'picker',
    'providers',
    'mass-line',
    'countries',
    'story:0',
    'story:1',
    'story:2',
    'story:3',
    'faq',
  ]);
  expect(slotsOf(after, 'camper-rental-country')).toEqual([
    'cta',
    'before',
    'story:0',
    'story:1',
  ]);
  expect(slotsOf(after, 'camper-rental-providers')).toEqual([
    'banner',
    'intro',
    'story:0',
    'story:1',
  ]);
});

test('the hub intro the owner can already edit is untouched', async () => {
  const intro = (await rows()).find(
    (r) => r.slug === 'camper-rental' && r.slot === 'intro',
  );
  expect(intro?.body).toMatch(
    /^This page is about the things that are decided/,
  );
});

test('every picture exists on disk and carries a description', async () => {
  const pics = (await rows()).filter((r) => r.image_url !== null);
  // Щоб порожній перелік не пройшов за «усі існують».
  expect(pics.length).toBe(8);
  const missing: string[] = [];
  const noAlt: string[] = [];
  for (const p of pics) {
    const file = join(
      __dirname,
      '..',
      '..',
      '..',
      'web',
      'public',
      p.image_url!.replace(/^\//, ''),
    );
    if (!existsSync(file)) missing.push(`${p.slug}/${p.slot}: ${p.image_url}`);
    if ((p.image_alt ?? '').trim().length <= 10)
      noAlt.push(`${p.slug}/${p.slot}`);
  }
  expect(missing).toEqual([]);
  expect(noAlt).toEqual([]);
});

test('every button leads to a page of ours and comes with a label', async () => {
  const withHref = (await rows()).filter((r) => r.cta_href !== null);
  expect(withHref.length).toBeGreaterThanOrEqual(10);
  const badHref: string[] = [];
  const noLabel: string[] = [];
  for (const r of withHref) {
    if (!/^\/[a-z0-9-]/.test(r.cta_href!))
      badHref.push(`${r.slug}/${r.slot}: ${r.cta_href}`);
    if ((r.cta_label ?? '').trim().length <= 3)
      noLabel.push(`${r.slug}/${r.slot}`);
  }
  expect(badHref).toEqual([]);
  expect(noLabel).toEqual([]);
});

test('no sentence about our own affairs reaches the reader', async () => {
  // Фрази власника (CAMP-443), дослівно, і ті, що ловить сторож збірки.
  const KITCHEN = [
    /we hold (no|none)/i,
    /not going to guess/i,
    /no (rental )?partners?/i,
    // «European Commission» — законне слово (бюлетень пального); кухня — це
    // комісія, яку отримуємо ми.
    /commission (for|on) (bookings?|sales)|earn(s|ing)? (a )?commission/i,
    /affiliate/i,
    /earns? (us )?nothing/i,
    /not (yet )?connected/i,
    /coming soon/i,
    /we (plan|intend) to/i,
    /lorem ipsum/i,
  ];
  const text = (await rows())
    .flatMap((r) => [
      r.heading,
      r.subheading,
      r.body,
      r.cta_label,
      ...r.items.flatMap((i) => [i.term, i.text]),
    ])
    .filter((x): x is string => typeof x === 'string')
    .join('\n');
  // Сторож мусить мати що читати.
  expect(text.length).toBeGreaterThan(4000);
  expect(KITCHEN.filter((re) => re.test(text)).map(String)).toEqual([]);
});

test('the FAQ and the 3 500 kg cards are well formed: no empty term or text', async () => {
  const all = await rows();
  for (const slot of ['faq', 'mass-line']) {
    const r = all.find((x) => x.slug === 'camper-rental' && x.slot === slot)!;
    expect(r.items.length).toBeGreaterThanOrEqual(3);
    for (const i of r.items) {
      expect(i.term.trim().length).toBeGreaterThan(3);
      expect(i.text.trim().length).toBeGreaterThan(20);
    }
  }
  const mass = all.find((x) => x.slot === 'mass-line')!;
  // Чотири значки в коді (право, збори, зима, навантаження): п'ята картка
  // дістала б картку без значка, тож їх рівно чотири.
  expect(mass.items.length).toBe(4);
});

test('running it again changes nothing, and keeps what the owner edited', async () => {
  await db.query(
    `UPDATE page_section_translations SET heading = 'Owner heading'
      WHERE section_id = (SELECT s.id FROM page_sections s JOIN pages p ON p.id = s.page_id
                           WHERE p.slug = 'camper-rental' AND s.slot = 'providers')`,
  );
  const once = await rows();
  await mine.up(runnerOf(db));
  const twice = await rows();
  expect(twice.length).toBe(once.length);
  expect(
    twice.find((r) => r.slot === 'providers' && r.slug === 'camper-rental')
      ?.heading,
  ).toBe('Owner heading');
});

test('down() removes what up() added and leaves the intro and the other pages', async () => {
  await mine.down(runnerOf(db));
  const after = await rows();
  expect(slotsOf(after, 'camper-rental')).toEqual(['intro']);
  expect(slotsOf(after, 'camper-rental-country')).toEqual([]);
  const { rows: pages } = await db.query(
    `SELECT slug FROM pages WHERE slug = ANY($1) ORDER BY slug`,
    [PAGES],
  );
  expect(pages.map((p) => p.slug)).toEqual(['camper-rental']);
});
