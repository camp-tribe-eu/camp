#!/usr/bin/env node
// CAMP-482: налаштування адмінки Directus — під наглядом, а не «хтось
// колись клікнув».
//
//   node scripts/ci/check-directus-config.mjs --db          # звірити
//   node scripts/ci/check-directus-config.mjs --db --write  # зафіксувати
//   node scripts/ci/check-directus-config.mjs --self-test   # перевірити сторожа
//
// 🔴 ЧОМУ ЦЕЙ СТОРОЖ ІСНУЄ. Заміряно 10.11.2026: уся конфігурація
// адмінки — які колекції зареєстровані, які сховані, яким віджетом
// редагується кожне поле — живе ТІЛЬКИ в таблицях `directus_*` робочої
// бази. У репозиторії її немає. Наслідки, кожен тихий:
//
//   • відновлення бази зі знімка іншої дати поверне й стару адмінку,
//     і ніхто не помітить, бо сайт працюватиме;
//   • налаштування, зроблене мишкою на проді, не доїде на локальну
//     машину, і навпаки;
//   • різниця між «як налаштовано» і «як задумано» ніде не видна, тому
//     не може почервоніти.
//
// Саме через це `page_sections.image_url` досі голе текстове поле: хтось
// мав налаштувати віджет мишкою, і цього не сталось. Довідатись про це
// можна було лише відкривши адмінку очима.
//
// 🔴 ЧОМУ ЧИТАЄМО POSTGRES, А НЕ DIRECTUS. Підняти Directus заради
// перевірки означало б спалити активацію Open Innovation Grant: їх пʼять,
// вони прив'язані до бази + PUBLIC_URL і згорають назавжди. Про це вже
// написано в `check-cms-hardening.mjs`, і те саме правило тут: сторож
// ходить у базу, не в застосунок.
//
// 🔴 ПОПРАВКА ДО ПОПЕРЕДНЬОГО АБЗАЦУ. Першою редакцією тут стояло, що
// вендорський `directus schema snapshot` «локально не стартує взагалі».
// Це неточно: він падає на Node 24 (`isolated-vm` зібраний під іншу
// версію), а під Node 22 — тією самою, що й на проді, — працює. Причина
// не користуватись ним лишилась інша й сильніша: знімок схеми вимагає
// живого Directus, а сторожеві він не потрібен, бо все, що нас
// цікавить, лежить у звичайних таблицях.
//
// 🔴 І ТОМУ ЖИВЕ НА МАШИНІ, А НЕ В CI. База CI має міграції, але не має
// жодного рядка `directus_*` — Directus там ніколи не запускався. Сторож,
// поставлений у CI, звіряв би порожнечу з порожнечею і зеленів щоразу.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(HERE, '..', '..', 'apps', 'cms', 'directus-config.json');

const HERE_IS_MAIN =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

/**
 * Те, що описує адмінку і що має сенс стерегти.
 *
 * 🔴 НАВМИСНО НЕ ВСЕ. `directus_collections` має десятки колонок, і
 * більшість із них — стан інтерфейсу (чи розгорнута тека, якого кольору
 * іконка в чиємусь профілі). Стерегти їх означало б червоніти від того,
 * що адмін згорнув список, і сторож швидко почали б ігнорувати.
 *
 * Тут лишилось те, зміна чого МІНЯЄ РОБОТУ редактора: чи колекція
 * зареєстрована, чи схована, як називається поле й яким віджетом воно
 * редагується.
 */
const COLLECTION_SQL = `
  SELECT collection,
         coalesce(hidden, false) AS hidden,
         coalesce(singleton, false) AS singleton,
         coalesce(icon, '') AS icon
    FROM directus_collections
   ORDER BY collection`;

const FIELD_SQL = `
  SELECT collection,
         field,
         coalesce(interface, '') AS interface,
         coalesce(special::text, '') AS special,
         coalesce(readonly, false) AS readonly,
         coalesce(required, false) AS required
    FROM directus_fields
   ORDER BY collection, field`;

async function readLive() {
  const url = process.env.DATABASE_URL;
  // 🔴 ВІДСУТНЯ ЗМІННА — ПАДІННЯ З РЕЧЕННЯМ, А НЕ ПРОПУСК. Сторож, який
  // мовчки нічого не перевірив, виглядає так само зелено, як сторож,
  // що перевірив усе.
  if (!url) {
    console.error(
      'Немає DATABASE_URL. Без неї читати нічого, і «розбіжностей не ' +
        'знайдено» означало б лише те, що я нікуди не ходив.',
    );
    process.exit(2);
  }

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const collections = (await client.query(COLLECTION_SQL)).rows;
    const fields = (await client.query(FIELD_SQL)).rows;

    // 🔴 ПОРОЖНЯ ВИБІРКА — ЦЕ ЗБІЙ. Нуль колекцій означає, що Directus
    // у цій базі не запускався або таблиці зникли. Порівнювати з
    // файлом тоді безглуздо: різниця буде повна, і сторож закричить про
    // все замість того, щоб назвати справжню причину.
    if (collections.length === 0) {
      console.error(
        '`directus_collections` порожня. Directus у цій базі не ' +
          'налаштований — це не розбіжність конфігурації, а її відсутність.',
      );
      process.exit(2);
    }
    return { collections, fields };
  } finally {
    await client.end();
  }
}

/** Різниця двох переліків за ключем, як перелік речень. */
function diff(label, expected, actual, keyOf) {
  const problems = [];
  const byKey = (rows) => new Map(rows.map((r) => [keyOf(r), r]));
  const e = byKey(expected);
  const a = byKey(actual);

  for (const [k, row] of a) {
    if (!e.has(k)) problems.push(`${label} зʼявилось у базі, немає у файлі: ${k}`);
  }
  for (const [k, row] of e) {
    if (!a.has(k)) {
      problems.push(`${label} є у файлі, немає в базі: ${k}`);
      continue;
    }
    const live = a.get(k);
    for (const col of Object.keys(row)) {
      if (String(row[col]) !== String(live[col])) {
        problems.push(
          `${label} ${k}: «${col}» у файлі ${JSON.stringify(row[col])}, ` +
            `у базі ${JSON.stringify(live[col])}`,
        );
      }
    }
  }
  return problems;
}

export function compare(saved, live) {
  return [
    ...diff('Колекція', saved.collections, live.collections, (r) => r.collection),
    ...diff(
      'Поле',
      saved.fields,
      live.fields,
      (r) => `${r.collection}.${r.field}`,
    ),
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Самоперевірка: сторож, який ніколи не червонів, нічого не стереже.
// ─────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const KNOWN = new Set(['--db', '--write', '--self-test']);
  const unknown = argv.filter((a) => !KNOWN.has(a));
  if (unknown.length) {
    console.error(`Невідомі аргументи: ${unknown.join(' ')}`);
    console.error(`Відомі: ${[...KNOWN].join(' ')}`);
    process.exit(2);
  }
  const WRITE = argv.includes('--write');

  if (argv.includes('--self-test')) {
  const base = {
    collections: [{ collection: 'pages', hidden: false, singleton: false, icon: 'web' }],
    fields: [{ collection: 'pages', field: 'slug', interface: 'input', special: '', readonly: false, required: true }],
  };
  const cases = [
    ['однакове — тиша', base, base, 0],
    [
      'колекцію сховали',
      base,
      { ...base, collections: [{ ...base.collections[0], hidden: true }] },
      1,
    ],
    [
      'віджет поля зник',
      base,
      { ...base, fields: [{ ...base.fields[0], interface: '' }] },
      1,
    ],
    [
      'колекція зникла з бази',
      base,
      { collections: [], fields: base.fields },
      1,
    ],
    [
      'колекцію додали в базі повз файл',
      base,
      {
        ...base,
        collections: [
          ...base.collections,
          { collection: 'routes', hidden: false, singleton: false, icon: 'map' },
        ],
      },
      1,
    ],
  ];

  let bad = 0;
  for (const [name, saved, live, want] of cases) {
    const got = compare(saved, live).length;
    const ok = got === want;
    if (!ok) bad += 1;
    console.log(`${ok ? 'ok  ' : 'ЗБІЙ'} ${name} — розбіжностей ${got}, чекали ${want}`);
  }
  console.log(`\nперевірено ${cases.length} випадків, провалів ${bad}`);
  process.exit(bad === 0 ? 0 : 1);
}

if (!argv.includes('--db')) {
  console.error(
    'Потрібен --db. Таблиці читаються лише за прапорцем, а не «коли є ' +
      'DATABASE_URL»: інакше втрата змінної осліпила б сторожа мовчки.',
  );
  process.exit(2);
}

  const live = await readLive();

if (WRITE) {
  writeFileSync(SNAPSHOT, `${JSON.stringify(live, null, 2)}\n`, 'utf8');
  console.log(
    `Записано ${live.collections.length} колекцій і ${live.fields.length} ` +
      `полів у ${SNAPSHOT}`,
  );
  process.exit(0);
}

let saved;
try {
  saved = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
} catch {
  console.error(
    `Немає ${SNAPSHOT}. Зафіксуй поточний стан: --db --write, і прочитай ` +
      `diff перед комітом — у ньому видно, що саме адмінка вважає нормою.`,
  );
  process.exit(2);
}

const problems = compare(saved, live);

// 🔴 ЗНАМЕННИК ДРУКУЄТЬСЯ ЗАВЖДИ. «Розбіжностей немає» нічого не варте,
// якщо під ним нуль порівняних рядків.
console.log(
  `Звірено ${live.collections.length} колекцій і ${live.fields.length} полів ` +
    `із ${saved.collections.length} і ${saved.fields.length} у файлі.`,
);

if (problems.length === 0) {
  console.log('Адмінка збігається з тим, що лежить у git.');
  process.exit(0);
}

console.error(`\nРозбіжностей: ${problems.length}`);
for (const p of problems) console.error(`  • ${p}`);
console.error(
  '\nЯкщо зміна навмисна — `--db --write` і коміт. Якщо ні — хтось ' +
    'налаштував адмінку мишкою, і ця правка зникне на першому ж ' +
    'відновленні бази.',
);
process.exit(1);
}

// 🔴 РОБОТА ЛИШЕ ПРИ ПРЯМОМУ ЗАПУСКУ. Сторож репозиторію
// (`check-script-entrypoints.mjs`) впіймав першу редакцію: файл, що
// пише в базу, не має права покладатись на те, що його ніхто не
// імпортує. `compare` і `diff` лишаються експортованими для тестів.
if (HERE_IS_MAIN) await main();
