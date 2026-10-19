#!/usr/bin/env node
// CAMP-355: жодної публічної адреси у відстежуваних файлах, крім
// названих у `public-addresses.json` із причиною.
//
//   node scripts/ci/check-public-addresses.mjs
//   node scripts/ci/check-public-addresses.mjs --self-test
//
// 🔴 ЧОМУ ЗАКРИТИЙ ПЕРЕЛІК, А НЕ ЗАБОРОНА ОДНОГО РЯДКА. Сторож, який
// шукає адресу нашої машини, мусив би цю адресу МІСТИТИ — тобто сам
// став би місцем, де вона записана, і прибирання втратило б сенс.
//
// Тому питання поставлене навпаки, і на нього дефект не може відповісти
// «так»: чи кожна публічна адреса в репозиторії названа з причиною?
// Адреси нашої машини в переліку немає й не буде, тож її повернення —
// це «не названа адреса», і сторож червоніє, жодного разу її не знаючи.
//
// 🔴 ПЕРЕЛІК ЗАКРИТИЙ З ОБОХ БОКІВ. Запис, якого в дереві вже немає,
// теж провал: інакше таблиця за півроку стає переліком побажань, і
// «все названо» перестає щось означати.
//
// Заміряно 19.10.2026: у дереві було 9 збігів, з них 2 — адреси нашої
// інфраструктури (сервер і спільний релей пошти Hetzner), 2 — зовсім не
// адреси (номер розділу RFC і префікс ідентифікатора CAP), решта —
// чужі діапазони в діагностиці й фікстурах.

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { chooseAction } from '../lib/entrypoint.mjs';
import { isRealAddress, realAddressesIn } from '../lib/ip.mjs';

/**
 * Файли, яких правило не стосується, бо вони САМЕ ПРО адреси.
 *
 * 🔴 Рівно два, і самотест це число тримає: кожен новий виняток —
 * це нове місце, де адресу можна сховати законно.
 */
export const EXEMPT = [
  'scripts/lib/ip.mjs',
  'scripts/ci/public-addresses.json',
  // 🔴 І ЦЕЙ ФАЙЛ ТЕЖ — він спіймав сам себе на першому ж прогоні.
  // Самотестові потрібні адреси, які `isRealAddress` визнає чужими,
  // інакше `scan` їх не знайде й перевірка нічого не перевіряє;
  // діапазони RFC 5737 для цього не годяться за визначенням.
  //
  // Спокусливо було б зібрати адресу з частин (`['8','8','8','8']
  // .join('.')`), щоб літерала в файлі не було. Це обман власного
  // сторожа, і в цьому репозиторії такий трюк уже ловили.
  'scripts/ci/check-public-addresses.mjs',
];

/** Двійкове за розширенням — читати як текст немає сенсу. */
const BINARY = /\.(png|jpe?g|webp|avif|gif|ico|pdf|zip|gz|br|woff2?|ttf|otf|mp4|webm|pbf|mbtiles)$/i;

/**
 * Звірити знайдене з переліком.
 *
 * Повертає `unaccounted` (є в дереві, немає в переліку) і `phantom`
 * (є в переліку, немає в дереві) — і те й те провал.
 */
export function reconcile(found, accounted) {
  const key = (x) => `${x.file}\u0000${x.address}`;
  const haveFound = new Set(found.map(key));
  const haveListed = new Set(accounted.map(key));
  return {
    unaccounted: found.filter((f) => !haveListed.has(key(f))),
    phantom: accounted.filter((a) => !haveFound.has(key(a))),
  };
}

/** Адреси у файлах, як їх бачить сторож. `read` підміняють у тестах. */
export function scan(files, read) {
  const out = [];
  for (const f of files) {
    if (EXEMPT.includes(f) || BINARY.test(f)) continue;
    let text;
    try {
      text = read(f);
    } catch {
      continue;
    }
    for (const address of realAddressesIn(text)) out.push({ file: f, address });
  }
  return out;
}

function live() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const files = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const found = scan(files, (f) => readFileSync(path.join(root, f), 'utf8'));
  const listed = JSON.parse(
    readFileSync(path.join(root, 'scripts/ci/public-addresses.json'), 'utf8'),
  ).accounted;
  const { unaccounted, phantom } = reconcile(found, listed);

  // 🔴 Пара до вироку: «нічого не знайдено» справджується й тоді, коли
  // сканер не відкрив жодного файла. Перелік не порожній за побудовою,
  // тож нуль збігів означає зламаний сканер, а не чисте дерево.
  if (found.length === 0) {
    console.error('::error::check-public-addresses: у дереві не знайдено ЖОДНОЇ адреси — сканер нічого не прочитав');
    return 1;
  }
  for (const u of unaccounted) {
    console.error(`::error file=${u.file}::публічна адреса ${u.address} не названа в scripts/ci/public-addresses.json`);
  }
  for (const p of phantom) {
    console.error(`::error file=scripts/ci/public-addresses.json::${p.file} вже не містить ${p.address} — прибери запис`);
  }
  if (unaccounted.length > 0 || phantom.length > 0) {
    console.error(`::error::check-public-addresses: ${unaccounted.length} неназваних, ${phantom.length} застарілих записів`);
    return 1;
  }
  console.log(`✓ check-public-addresses: ${found.length} адрес у дереві, кожна названа з причиною`);
  return 0;
}

function selfTest() {
  const cases = [];
  const is = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    cases.push(ok);
    if (!ok) console.error(`✗ ${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
  };

  const A = { file: 'a.md', address: '8.8.8.8' };
  const B = { file: 'b.md', address: '1.1.1.1' };

  is('усе названо — скарг немає', reconcile([A], [A]), { unaccounted: [], phantom: [] });
  is('адреса без запису', reconcile([A, B], [A]).unaccounted.map((x) => x.address), ['1.1.1.1']);
  is('запис без адреси', reconcile([A], [A, B]).phantom.map((x) => x.address), ['1.1.1.1']);
  is('той самий файл, інша адреса — це інший запис',
    reconcile([A, { file: 'a.md', address: '1.1.1.1' }], [A]).unaccounted.length, 1);

  const read = (f) => ({
    'x.md': 'сервер 8.8.8.8 і ще раз 8.8.8.8, а також 10.0.0.1',
    'scripts/lib/ip.mjs': 'приклад 8.8.8.8',
    'scripts/ci/public-addresses.json': '{"address":"8.8.8.8"}',
    'img.png': 'байти 8.8.8.8',
  })[f] ?? '';
  is('приватні не рахуються, повтори не дублюються',
    scan(['x.md'], read), [{ file: 'x.md', address: '8.8.8.8' }]);
  is('файли про адреси пропускаються',
    scan(['scripts/lib/ip.mjs', 'scripts/ci/public-addresses.json'], read), []);
  is('двійкові пропускаються', scan(['img.png'], read), []);
  is('нечитаний файл не валить прогін', scan(['boom'], () => { throw new Error('x'); }), []);
  // 🔴 Два винятки, і не більше: кожен новий — це нове законне місце,
  // де адресу можна сховати.
  is('винятків рівно три', EXEMPT.length, 3);
  is('класифікатор той самий, що в іншого сторожа',
    [isRealAddress('8.8.8.8'), isRealAddress('10.0.0.1')], [true, false]);

  const EXPECTED_CASES = 10;
  let rc = 0;
  if (cases.some((c) => !c)) rc = 1;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ виконано ${cases.length} випадків, очікувалось ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ check-public-addresses self-test: ${cases.length} випадків`);
  return rc;
}

const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'check-public-addresses.mjs');
  if (action.has('--self-test')) process.exit(selfTest());
  process.exit(live());
}
