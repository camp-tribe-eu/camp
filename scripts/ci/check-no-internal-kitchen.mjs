#!/usr/bin/env node
// CAMP-463: сайт не розповідає читачеві про стан наших справ.
//
//   node scripts/ci/check-no-internal-kitchen.mjs             # по зібраних сторінках
//   node scripts/ci/check-no-internal-kitchen.mjs --self-test # без збірки
//
// 🔴 ЩО САМЕ ЦЕ ЛОВИТЬ. Власник, ревю CAMP-443/445: «ти що вирішив нас
// скомпроментувати на весь світ?… Перевір весь проєкт тепер щоб не було
// витоків і тупості з твого боку у всьому проєкту!»
//
// На `/camper-rental` стояло, що партнерів немає, заявки подані й без
// відповіді, сторінка нічого не заробляє, і як ми плануємо заробляти. На
// сторінці кемпінгу — заголовок «Weather on site» з єдиним рядком
// «Forecast is not connected yet». Це не помилки верстки: це розповідь
// про нас там, де читач прийшов по кемпінг.
//
// 🔴 ЧОМУ ПО ЗІБРАНИХ СТОРІНКАХ, А НЕ ПО КОДУ. Текст живе в трьох
// місцях: у компонентах, у базі (правові сторінки, гіди) і в CMS. Греп
// по `src/` бачить лише перше — і при цьому червоніє на коментарях, що
// пояснюють, ЧОМУ фразу прибрано. Зібрана сторінка — це рівно те, що
// бачить читач, незалежно від того, звідки слова приїхали.
//
// 🔴 ЦІНА ХИБНОГО СПРАЦЮВАННЯ, НАЗВАНА ЗАЗДАЛЕГІДЬ. Сторож читає ЖИВИЙ
// текст сторінок — а ми свідомо пишемо читачеві, чого НЕ знаємо: «not
// recorded», «we hold none», «nobody has recorded it». Це не кухня, це
// чесність про дані, і вона тут ЗАКОННА. Тому перелік вузький, кожен
// рядок має причину, і жоден не ловить слова самі по собі — лише
// сполуки, які можуть означати тільки стан наших справ.
//
// Хибне спрацювання коштує дорого саме тому, що лікується послабленням
// переліку: один надто широкий рядок — і наступний, хто його зустріне,
// викине зі списку щось потрібне. Тож краще пропустити рідкісне
// формулювання, ніж навчити людей вимикати сторожа.

import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { chooseAction } from '../lib/entrypoint.mjs';
import { visibleHtmlText } from '../seo/page-text.mjs';

const BUILD = 'apps/web/.next/server/app';

/**
 * Заборонені сполуки. Кожна — з причини, і кожна така, що законного
 * тексту про ДАНІ вона означати не може.
 */
export const FORBIDDEN = [
  {
    re: /\bnot (yet )?connected\b/i,
    why: 'Заголовок над зізнанням, чого ми ще не підʼєднали (знімок 441/70).',
  },
  {
    re: /\bcoming soon\b/i,
    why: 'Обіцянка з датою, якої ми не знаємо (те саме правило, що в route-figures.tsx).',
  },
  {
    re: /\baffiliate applications?\b/i,
    why: 'Стан наших перемовин із партнерами.',
  },
  {
    re: /\b(earns?|makes?) (us )?nothing\b/i,
    why: 'Скільки сторінка нам приносить — не справа читача.',
  },
  {
    re: /\bno partners? yet\b|\bthere are no partner links\b/i,
    why: 'Право ЄС вимагає розкривати звʼязок ТАМ, ДЕ ВІН Є; оголошувати відсутність не зобовʼязує ніщо.',
  },
  {
    re: /\bdoes not have yet\b|\bwhat .{0,30}does not have yet\b/i,
    why: 'Розділ, названий через те, чого в ньому немає.',
  },
  {
    re: /\bwe (plan|intend) to\b|\bthe intention is\b/i,
    why: 'План, а не те, що читач може зробити сьогодні.',
  },
  {
    re: /\bnot implemented\b|\bnot built yet\b|\bwork in progress\b/i,
    why: 'Стан робіт.',
  },
  {
    re: /\blorem ipsum\b/i,
    why: 'Заглушка доїхала до читача.',
  },
];

/** Усі збіги в одному тексті, з позицією. */
export function findForbidden(text) {
  const out = [];
  for (const rule of FORBIDDEN) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : `${rule.re.flags}g`);
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push({ phrase: m[0], why: rule.why, at: m.index });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return out;
}

/** Рядок тексту навколо збігу — щоб у червоному прогоні було що читати. */
export function around(text, at, span = 70) {
  return text.slice(Math.max(0, at - span), at + span).replace(/\s+/g, ' ').trim();
}

async function main() {
  let pages = 0;
  const bad = [];
  for await (const file of glob(`${BUILD}/**/*.html`)) {
    pages++;
    const text = visibleHtmlText(readFileSync(file, 'utf8'));
    for (const hit of findForbidden(text)) {
      bad.push({ file: path.relative(BUILD, file), ...hit, line: around(text, hit.at) });
    }
  }

  // 🔴 НУЛЬ СТОРІНОК — ЦЕ ЗБІЙ, А НЕ ЧИСТИЙ ПРОГІН. Без збірки `glob`
  // не знаходить нічого, і «0 збігів» звучало б як перемога.
  if (pages === 0) {
    console.error(
      `✗ жодної зібраної сторінки в ${BUILD} — спершу \`npm run build\`. ` +
        'Нуль сторінок не доводить нічого.',
    );
    return 1;
  }

  console.log(`перевірено сторінок: ${pages}`);
  if (bad.length === 0) {
    console.log('✓ внутрішньої кухні в текстах немає');
    return 0;
  }
  for (const b of bad.slice(0, 40)) {
    console.error(`✗ ${b.file}: «${b.phrase}» — ${b.why}\n    …${b.line}…`);
  }
  if (bad.length > 40) console.error(`  …і ще ${bad.length - 40}`);
  console.error(`\n✗ ${bad.length} збіг(ів) на ${pages} сторінках`);
  return 1;
}

const EXPECTED_CASES = 8;

function selfTest() {
  const cases = [
    { name: 'чистий текст', text: 'Twelve routes through the European Union.', hits: 0 },
    // 🔴 ЗАКОННИЙ ТЕКСТ ПРО ДАНІ — НЕ КУХНЯ. Ці речення стоять на сайті
    // сьогодні й мусять лишитись: вони про те, чого НЕ ЗНАЄ ДЖЕРЕЛО, а
    // не про те, чого не зробили ми.
    { name: 'не записано в OSM', text: 'Facilities not recorded. Nobody has recorded it.', hits: 0 },
    { name: 'ми не тримаємо цін', text: 'Because we hold none. We link to the companies instead.', hits: 0 },
    { name: 'сезон не названо', text: 'Season not stated.', hits: 0 },
    // А це — кухня.
    { name: 'прогноз', text: 'Forecast is not connected yet.', hits: 1 },
    { name: 'заявки', text: 'The affiliate applications are open and unanswered.', hits: 1 },
    { name: 'заробіток', text: 'so this page earns nothing today', hits: 1 },
    { name: 'заглушка', text: 'Lorem ipsum dolor sit amet', hits: 1 },
  ];
  let bad = 0;
  for (const c of cases) {
    const got = findForbidden(c.text);
    if (got.length !== c.hits) {
      console.error(
        `  ✗ ${c.name}: очікувалось ${c.hits} збіг(ів), отримано ${got.length}` +
          (got.length ? ` (${got.map((g) => g.phrase).join(', ')})` : ''),
      );
      bad++;
      continue;
    }
    // 🔴 І кожен збіг мусить НАЗВАТИ причину. Порожнє пояснення
    // перетворює червоний прогін на «щось не те», а саме в цей момент
    // людина вирішує, чи послабити перелік.
    for (const g of got) {
      if (!g.why || g.why.length < 20) {
        console.error(`  ✗ ${c.name}: збіг «${g.phrase}» без причини`);
        bad++;
      }
    }
  }
  if (cases.length !== EXPECTED_CASES) {
    console.error(`  ✗ випадків ${cases.length}, очікувалось ${EXPECTED_CASES}`);
    bad++;
  }
  console.log(
    bad === 0
      ? `✓ check-no-internal-kitchen self-test: ${cases.length} cases over ${FORBIDDEN.length} rules`
      : `✗ ${bad} check(s) failed`,
  );
  return bad > 0 ? 1 : 0;
}

const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

// 🔴 `chooseAction`, а не `argv.includes`: `--selftest`, одна літера
// різниці, провалився б у бойову гілку, не знайшов зібраних сторінок і
// вийшов би одиницею з правильного тексту й хибної причини. Порівняння
// написане дослівно, бо `check-script-entrypoints.mjs` впізнає сторож,
// ЧИТАЮЧИ його.
//
// 🔴 І ПЕРША РЕДАКЦІЯ ЦЬОГО ФАЙЛА САМЕ НА ЦЬОМУ Й ЗЛАМАЛАСЬ: я викликав
// `chooseAction({ main, selfTest, … })` — із чужою сигнатурою. Скрипт
// нічого не запустив і вийшов НУЛЕМ. Тобто сторож проти мовчазних
// провалів сам був мовчазним провалом.
if (invokedDirectly) {
  const action = chooseAction(
    process.argv.slice(2),
    ['--self-test'],
    'check-no-internal-kitchen.mjs',
  );
  process.exit(action.has('--self-test') ? selfTest() : await main());
}
