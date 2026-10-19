// CAMP-355: одне місце, яке вирішує, чи адреса комусь належить.
//
//   node scripts/lib/ip.mjs --self-test
//
// 🔴 ЧОМУ ОКРЕМИМ МОДУЛЕМ. Це правило потрібне двом сторожам — тому, що
// не пускає журнальні дані в репозиторій (CAMP-353), і тому, що не
// пускає туди адресу нашої машини (CAMP-355). Два списки одного правила
// розходяться мовчки: один оновлять, другий ні, і обидва будуть
// впевнені в собі.
//
// 🔴 ЗА ЗАМОВЧУВАННЯМ — «НАЛЕЖИТЬ». Невідомий діапазон має читатись як
// чужа адреса, інакше кожна нова підмережа тихо стає дозволеною.

/** Схоже на IPv4 у тексті. Навмисно без меж слова на крапках. */
export const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/**
 * Чи належить ця адреса комусь насправді.
 *
 * `false` для діапазонів RFC 5737 (заведені для документації й не
 * належать нікому), приватних, loopback, link-local і службових.
 */
export function isRealAddress(ip) {
  const o = ip.split('.').map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : NaN));
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = o;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 192 && b === 168) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 169 && b === 254) return false;
  if (a === 255 || a >= 224) return false;
  return true;
}

/** Адреси в тексті, які комусь належать. Без повторів, у порядку появи. */
export function realAddressesIn(text) {
  const out = [];
  for (const m of text.matchAll(IPV4_RE)) {
    if (isRealAddress(m[0]) && !out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

// ── Самотест ──────────────────────────────────────────────────────────
// 🔴 За точкою входу, як вимагає check-script-entrypoints: модуль, що
// робить роботу при імпорті, робить її й у того, хто просто імпортує.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function selfTest() {
  const cases = [];
  const is = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    cases.push(ok);
    if (!ok) console.error(`✗ ${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
  };

  is('діапазони для документації не належать нікому',
    ['192.0.2.1', '198.51.100.23', '203.0.113.10'].map(isRealAddress), [false, false, false]);
  is('приватні, loopback і службові',
    ['10.0.0.1', '127.0.0.1', '192.168.1.1', '172.20.0.5', '169.254.1.1', '224.0.0.1', '255.255.255.255']
      .map(isRealAddress), [false, false, false, false, false, false, false]);
  is('публічні належать',
    ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1'].map(isRealAddress), [true, true, true, true]);
  is('межі приватного блоку 172.16/12',
    ['172.16.0.1', '172.31.255.254'].map(isRealAddress), [false, false]);
  is('не адреси', ['999.1.1.1', '1.2.3', '1.2.3.4.5'.slice(0, 3)].map(isRealAddress), [false, false, false]);
  // 🔴 Пара: номер розділу RFC виглядає як адреса (`RFC 5321 §4.5.3.1`),
  // і саме на ньому перше правило CAMP-355 дало б хибне спрацювання.
  // Модуль ЦЕ НЕ РОЗРІЗНЯЄ — і не повинен: рішення про контекст
  // ухвалює сторож, а не класифікатор. Випадок тут, щоб ніхто не
  // «виправив» це всередині.
  is('номер розділу RFC — теж чотири числа', isRealAddress('4.5.3.1'), true);
  is('у тексті, без повторів, у порядку появи',
    realAddressesIn('a 8.8.8.8 b 8.8.8.8 c 10.0.0.1 d 1.1.1.1'), ['8.8.8.8', '1.1.1.1']);

  const EXPECTED_CASES = 7;
  let rc = 0;
  if (cases.some((c) => !c)) rc = 1;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ виконано ${cases.length} випадків, очікувалось ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ ip self-test: ${cases.length} випадків`);
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
  const { chooseAction } = await import('./entrypoint.mjs');
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'ip.mjs');
  if (action.has('--self-test')) process.exit(selfTest());
  console.error('ip.mjs — модуль; самостійно він уміє лише --self-test');
  process.exit(2);
}
