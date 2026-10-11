#!/usr/bin/env node
// CAMP-276: що робити з рядками, які не мають OSM-ключа.
//
//   node scripts/osm-pipeline/match-keyless.mjs             # лише звіт
//   node scripts/osm-pipeline/match-keyless.mjs --self-test
//
// 🔴 ЦЕЙ СКРИПТ НІЧОГО НЕ ЗМІНЮЄ, І `--apply` ТУТ НЕМАЄ НАВМИСНО.
//
// Заміряно 11.10.2026: у `camping_spots` 61 558 рядків, із них **8 752**
// мають `osm_ref IS NULL`. Усі Франція, усі створені 24.09.2026 за один
// день, усім проставлено `type = paid`, і всі мають опубліковану
// сторінку. Серед назв — «Toilettes publiques» (24), «Aire de
// pique-nique» (22), «Aire de stationnement» (61): це назви з OSM, і це
// не кемпінги.
//
// `ON CONFLICT (osm_ref)` їх не бачить, бо NULL ніколи не конфліктує.
// Тобто тижневий імпорт до них не доходить: `last_seen_at` застиг на
// 24.09 і не зрушить ніколи.
//
// Рішення, що з ними робити, коштує URL: у кожного є слаг, тобто жива
// сторінка. Тому спершу — число, і тільки потім правка.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { argv, exit, env } from 'node:process';

/** Межі, у метрах. Кожна тут тому, що її заміряли, а не вгадали. */
export const NEAR_SAME_NAME = 100;
export const NEAR_ANY_NAME = 50;
export const ALONE_BEYOND = 200;

/**
 * Назва, зведена до порівнюваного вигляду.
 *
 * 🔴 НЕ БІЛЬШЕ, НІЖ РЕГІСТР І ПРОБІЛИ. Спокуса «розумнішої» нормалізації
 * (прибрати «Camping», стягнути синоніми) закінчується тим, що два різні
 * кемпінги стають одним — а ціна помилки тут це злиті сторінки.
 */
export const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Що це за безключовий рядок на тлі тих, що ключ мають.
 *
 * `candidates` — рядки З ключем із відстанню в метрах, уже порахованою
 * базою. Функція нічого не вимірює сама: інакше її не перевірити без
 * PostGIS, а перевіряти треба саме рішення, не арифметику.
 *
 * 🔴 ОДНА НАЗВА — ЦЕ НЕ ДОКАЗ. «Camping municipal» зустрічається 121
 * раз, «Aire de stationnement» — 61. Це найпоширеніші назви у Франції.
 * Тому збіг назви рахується лише разом із відстанню.
 */
export function classify(row, candidates) {
  const name = norm(row.name);
  const near = candidates.filter((c) => Number.isFinite(c.metres));

  if (name) {
    const twin = near.find((c) => c.metres <= NEAR_SAME_NAME && norm(c.name) === name);
    if (twin) return { kind: 'twin', with: twin.osm_ref, metres: twin.metres };
  }

  const closest = near.slice().sort((a, b) => a.metres - b.metres)[0];
  if (closest && closest.metres <= NEAR_ANY_NAME) {
    return { kind: 'near', with: closest.osm_ref, metres: closest.metres };
  }
  if (!closest || closest.metres > ALONE_BEYOND) {
    return { kind: 'alone' };
  }
  // 🔴 Смуга між 50 і 200 метрами з іншою назвою. Сказати про неї
  // нічого не можна, і вигадувати тут відповідь — гірше, ніж визнати.
  return { kind: 'unclear', with: closest.osm_ref, metres: closest.metres };
}

const SELF_TEST = [
  ['та сама назва за 10 м — близнюк', { name: 'Camping du Lac' },
    [{ osm_ref: 'w1', name: 'Camping du Lac', metres: 10 }], 'twin'],
  ['та сама назва, але за 3 км — НЕ близнюк', { name: 'Camping municipal' },
    [{ osm_ref: 'w2', name: 'Camping municipal', metres: 3000 }], 'alone'],
  ['інша назва за 20 м — поруч', { name: 'Aire de stationnement' },
    [{ osm_ref: 'w3', name: 'Camping Les Pins', metres: 20 }], 'near'],
  ['інша назва за 120 м — не визначено', { name: 'Aire de stationnement' },
    [{ osm_ref: 'w4', name: 'Camping Les Pins', metres: 120 }], 'unclear'],
  ['нікого в радіусі 200 м — сам', { name: 'Camping du Lac' }, [], 'alone'],
  ['регістр і подвійні пробіли не заважають', { name: 'CAMPING  DU   LAC' },
    [{ osm_ref: 'w5', name: 'Camping du Lac', metres: 15 }], 'twin'],
  ['порожня назва ніколи не дає близнюка за назвою', { name: '' },
    [{ osm_ref: 'w6', name: '', metres: 10 }], 'near'],
  ['ближчий кандидат виграє в дальшого', { name: 'X' },
    [{ osm_ref: 'far', name: 'Y', metres: 190 }, { osm_ref: 'close', name: 'Y', metres: 30 }], 'near'],
  ['відстань, якої немає, ігнорується', { name: 'X' },
    [{ osm_ref: 'w7', name: 'X', metres: null }], 'alone'],
];

if (argv.includes('--self-test')) {
  let failed = 0;
  for (const [what, row, cands, want] of SELF_TEST) {
    const got = classify(row, cands).kind;
    const ok = got === want;
    if (!ok) failed += 1;
    console.log(`${ok ? '✓' : '✗'} ${what} (чекав ${want}, дало ${got})`);
  }
  console.log(failed ? `\n::error::самоперевірка впала на ${failed} випадках` : `\n✓ self-test passed: ${SELF_TEST.length} cases`);
  exit(failed ? 1 : 0);
}

if (import.meta.url === pathToFileURL(argv[1] ?? '').href) {
  const DB = env.DATABASE_URL;
  if (!DB) {
    console.error('::error::DATABASE_URL не задано');
    exit(1);
  }
  // 🔴 maxBuffer підняти, бо 8 752 рядки з кандидатами це ~1,1 МБ, а
  // типовий ліміт — 1 МБ. Перший прогін упав саме на ньому, і це
  // правильна поведінка: обрізаний мовчки вивід дав би менше рядків і
  // звіт, який виглядає як робота. Краще впасти, ніж недорахувати.
  const psql = (sql) =>
    execFileSync('psql', [DB, '-tAX', '-F', '|', '-c', sql], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    }).trim();

  // 🔴 JSON, А НЕ РЯДКИ З РОЗДІЛЬНИКОМ.
  //
  // Перша редакція читала вивід `psql -tA -F'|'` по рядках і
  // нарахувала 8 753 там, де база каже 8 752. Причина не в даних: у
  // таблиці **пʼять** назв містять перенос рядка — просто з тегу
  // `name` в OSM, наприклад «Camping Le\nDiamant» і
  // «Wohnmobilstellplatz Am Bürgerhaus\n\nWehrheim». `split('\n')`
  // різав один запис на два.
  //
  // JSON екранує переноси, тож документ лишається однією стрічкою і
  // розбирається однозначно. Парсер, який мусить розуміти формат,
  // мусить його розуміти, а не вгадувати.
  const expected = Number(psql('SELECT count(*) FROM camping_spots WHERE osm_ref IS NULL'));

  const raw = psql(`
    SELECT coalesce(json_agg(t), '[]')::text FROM (
      SELECT coalesce(a.name,'') AS name,
             coalesce(json_agg(
               json_build_object(
                 'osm_ref', b.osm_ref,
                 'name', coalesce(b.name,''),
                 'metres', round(ST_Distance(a.location::geography, b.location::geography))
               )
             ) FILTER (WHERE b.osm_ref IS NOT NULL), '[]') AS candidates
      FROM camping_spots a
      LEFT JOIN camping_spots b
        ON b.osm_ref IS NOT NULL
       AND ST_DWithin(a.location::geography, b.location::geography, ${ALONE_BEYOND})
      WHERE a.osm_ref IS NULL
      GROUP BY a.id, a.name
    ) t
  `);

  const rows = JSON.parse(raw);

  // 🔴 Підлога на власний розбір. Звіт, у якому рядків більше або менше,
  // ніж у таблиці, — це звіт про щось інше, і виглядає він так само
  // переконливо. Різниця в один рядок уже ховала тут помилку парсера.
  if (rows.length !== expected) {
    console.error(
      `::error::розібрано ${rows.length} рядків, а в таблиці ${expected} — ` +
        'розбір втратив або роздвоїв записи, і числам нижче вірити не можна',
    );
    exit(1);
  }

  const tally = { twin: 0, near: 0, unclear: 0, alone: 0 };
  for (const row of rows) {
    tally[classify(row, row.candidates.map((c) => ({ ...c, metres: Number(c.metres) }))).kind] += 1;
  }
  const total = rows.length;

  console.log(`  рядків без osm_ref: ${total}`);
  console.log(`  близнюк (та сама назва ≤${NEAR_SAME_NAME} м):  ${tally.twin}`);
  console.log(`  поруч  (будь-яка назва ≤${NEAR_ANY_NAME} м):   ${tally.near}`);
  console.log(`  не визначено (${NEAR_ANY_NAME}–${ALONE_BEYOND} м): ${tally.unclear}`);
  console.log(`  сам   (нікого в ${ALONE_BEYOND} м):            ${tally.alone}`);
  console.log('\n  🔴 Жодного рядка не змінено: цей скрипт тільки рахує.');
}
