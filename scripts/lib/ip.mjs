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

/**
 * IPv6 у тексті.
 *
 * 🔴 ЦЬОГО НЕ БУЛО ВЗАГАЛІ, І ЦЕ БУВ ЗЕЛЕНИЙ ШЛЯХ ДЛЯ ПЕРСОНАЛЬНИХ
 * ДАНИХ. Рецензія 19.10.2026 поклала в індекс файл із рядком журналу,
 * де `client_ip` — справжня IPv6-адреса читача: `isLogShaped` сказав
 * «так», `examined` став одиницею (отже й пара до вироку була
 * задоволена), і сторож надрукував «справжніх адрес немає», rc=0.
 *
 * За Cloudflare `Cf-Connecting-Ip` для читача з IPv6 — це саме IPv6,
 * тобто випадок не рідкісний, а щоденний.
 */
// 🔴 ПОРОЖНІ ГРУПИ ДОЗВОЛЕНІ, І ЦЕ НЕ ПРИДИРКА. Перша редакція
// обривала `2001:4860:4860::8888` на `2001:4860:4860::` — тобто сторож
// бачив ПРЕФІКС замість адреси, а перелік названих адрес із нею вже не
// збігався. Знайдено не оком: сторож поскаржився на запис, якого
// «більше немає», хоча файл не змінювали.
//
// Форму тут розпізнаємо грубо, а рішення ухвалює `isRealV6`: він
// вимагає або `::`, або рівно вісім груп, тож `12:34:56` і подібне
// відсіюється там, а не тут.
export const IPV6_RE = /(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?:%[0-9a-zA-Z]+)?/g;

/**
 * Чи належить ця IPv6-адреса комусь насправді.
 *
 * `false` для `2001:db8::/32` (RFC 3849, для документації), `fc00::/7`
 * (локальні), `fe80::/10` (link-local), `::1` і `::`.
 */
export function isRealV6(ip) {
  const a = ip.split('%')[0].toLowerCase();
  if (a === '::1' || a === '::') return false;
  // 🔴 СУТЬ, А НЕ ЛИШЕ ФОРМА. Послаблений вираз почав ловити
  // приведення типів SQL — `value::text` дає кандидата `::te`, і таких
  // у дереві знайшлось 175. Формально `::a` це валідна адреса
  // (`::0.0.0.10`), але в нашому коді це завжди не вона.
  //
  // Справжня адреса має щонайменше дві непорожні групи, і хоча б одна
  // з них довша за дві цифри. `fe80::1` і `2001:db8::1` проходять,
  // `::a`, `::ca`, `a::b` — ні.
  // `:::` не буває: у фікстурі фаєрвола саме так записаний НЕВАЛІДНИЙ
  // приклад, і класифікатор приймав його як адресу.
  if (a.includes(':::')) return false;
  const groups = a.split(':').filter(Boolean);
  if (groups.length < 2) return false;
  if (!groups.some((g) => g.length >= 3)) return false;
  const head = a.split(':')[0];
  if (a.startsWith('2001:db8:') || a === '2001:db8::') return false;
  // fc00::/7 — перші сім бітів 1111110
  if (/^f[cd][0-9a-f]{0,2}$/.test(head)) return false;
  // fe80::/10
  if (/^fe[89ab][0-9a-f]?$/.test(head)) return false;
  // Має бути схоже на адресу, а не на час `12:34` чи на ключ у JSON.
  return a.includes('::') || a.split(':').length === 8;
}

/** Адреси в тексті, які комусь належать. Без повторів, у порядку появи. */
export function realAddressesIn(text) {
  const out = [];
  for (const m of text.matchAll(IPV4_RE)) {
    if (isRealAddress(m[0]) && !out.includes(m[0])) out.push(m[0]);
  }
  for (const m of text.matchAll(IPV6_RE)) {
    if (isRealV6(m[0]) && !out.includes(m[0])) out.push(m[0]);
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
  // 🔴 Адреса ЦІЛКОМ, а не її префікс: саме на цьому обривався розбір.
  is('IPv6 береться повністю, разом із хвостом після ::',
    realAddressesIn('було 2001:4860:4860::8888 і 2a01:4f8:1061:2266::'),
    ['2001:4860:4860::8888', '2a01:4f8:1061:2266::']);
  is('час і версії не стають адресами',
    realAddressesIn('о 12:34:56 версія 1:2:3 і ::1'), []);
  // 🔴 Приведення типів SQL — 175 хибних спрацювань у дереві.
  is('потрійна двокрапка — не адреса', isRealV6('2400:::cb00::'), false);
  is('приведення типів SQL — не адреси',
    realAddressesIn('select x::text, y::int, z::ca from t'), []);
  is('а коротка справжня адреса — адреса',
    realAddressesIn('хост 2001:db8::1 і сусід 2a01:4f8::1'), ['2a01:4f8::1']);

  const EXPECTED_CASES = 12;
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
