import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_RETURN,
  MAX_RETURN_LENGTH,
  RETURN_KEY,
  RETURN_TTL_MS,
  isReturnPath,
  rememberReturn,
  safeReturnPath,
  takeReturn,
} from '@/lib/return-path';

// CAMP-229 — куди повернути людину після входу, і що НІКОЛИ не приймається.
//
// 🔴 ЦЕ ТЕСТ ПРО ВІДКРИТЕ ПЕРЕНАПРАВЛЕННЯ, тож він побудований не як список
// «заборонених рядків, які ми згадали», а у три шари, кожен з яких відповідає
// на своє питання:
//
//   1. ВОРОЖІ ФОРМИ ПО ОДНІЙ. Кожна — окремий випадок з іменем, і кожна мусить
//      ПОВЕРНУТИ типове місце (`/`), а не «не впасти». Прогнано через усі три
//      входи, якими чужий рядок міг би потрапити далі: `safeReturnPath`,
//      `rememberReturn` (запис) і `takeReturn` (читання зі сховища, куди
//      хтось поклав його в обхід).
//   2. ОРАКУЛ — ПАРСЕР БРАУЗЕРА. Десятки тисяч рядків, зібраних зі ЗЛОВМИСНИХ
//      ШМАТКІВ (`//`, `\`, `%2f`, `@`, `javascript:`…), а не з форми нашої
//      перевірки; кожен, що ми прийняли, проганяється через `new URL(…, origin)`
//      — і мусить лишитись на нашому origin. Це доводить властивість («прийняте
//      не втікає»), а не лише те, що кожну назву зі списку відхилено.
//   3. СХОВИЩЕ: строк, одноразовість, зіпсовані записи.
//
// Правило, записане в проєкті: список заборонених слів — не властивість; його
// обходять новим словом. Шар 2 і є «властивість».

const ORIGIN = 'https://camptribe.eu';

/** Сховище в памʼяті з тими самими трьома методами, що в `sessionStorage`. */
function memory(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    has: (k: string) => m.has(k),
    keys: () => [...m.keys()],
  };
}

// ── 1. Ворожі форми — по одній, кожна з іменем ─────────────────────────

type Hostile = readonly [name: string, input: unknown];

const HOSTILE: readonly Hostile[] = [
  // абсолютні адреси — «лише відносний шлях»
  ['абсолютна: https://evil.com', 'https://evil.com'],
  ['абсолютна: http із шляхом', 'http://evil.com/phish'],
  ['абсолютна: регістр схеми', 'HTTPS://EVIL.COM'],
  ['абсолютна НАШОГО origin теж не приймається', 'https://camptribe.eu/account'],
  ['абсолютна: ftp', 'ftp://evil.com'],

  // протокол-відносні
  ['протокол-відносна: //evil.com', '//evil.com'],
  ['протокол-відносна: зі шляхом', '//evil.com/account'],
  ['протокол-відносна: три слеші', '///evil.com'],
  ['протокол-відносна: чотири слеші', '////evil.com'],

  // зворотні скісні — браузер читає `\` як `/`
  ['зворотні: \\\\evil.com', '\\\\evil.com'],
  ['зворотні: /\\evil.com', '/\\evil.com'],
  ['зворотні: \\/evil.com', '\\/evil.com'],
  ['зворотні: /\\/evil.com', '/\\/evil.com'],
  ['зворотна всередині нашого шляху', '/account\\..\\..\\evil.com'],

  // схеми, що виконують або віддають
  ['javascript:', 'javascript:alert(1)'],
  ['javascript: у змішаному регістрі', 'JaVaScRiPt:alert(1)'],
  ['javascript: після слеша', '/javascript:alert(1)'],
  ['javascript: із коментарем-перенесенням', 'javascript://%0aalert(1)'],
  ['data: html', 'data:text/html,<script>alert(1)</script>'],
  ['data: base64', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
  ['vbscript:', 'vbscript:msgbox(1)'],
  ['file:', 'file:///etc/passwd'],
  ['blob:', 'blob:https://evil.com/00000000-0000-0000-0000-000000000000'],
  ['mailto:', 'mailto:a@evil.com'],

  // будь-що з @
  ['@: userinfo, наш хост першим', 'https://camptribe.eu@evil.com'],
  ['@: userinfo, чужий хост першим', 'https://evil.com@camptribe.eu'],
  ['@: протокол-відносна з userinfo', '//camptribe.eu@evil.com'],
  ['@: шлях, що починається з @', '/@evil.com'],
  ['@: шлях із @ всередині', '/x@evil.com'],

  // закодовані варіанти
  ['закодована: %2f%2fevil.com', '%2f%2fevil.com'],
  ['закодована: /%2f%2fevil.com', '/%2f%2fevil.com'],
  ['закодована: /%2Fevil.com (регістр)', '/%2Fevil.com'],
  ['закодована: %5cevil.com', '%5cevil.com'],
  ['закодована: /%5cevil.com', '/%5cevil.com'],
  ['закодована: /%5Cevil.com (регістр)', '/%5Cevil.com'],
  ['закодована: /..%2f..%2fevil.com', '/..%2f..%2fevil.com'],
  ['закодована: крапки /%2e%2e/%2e%2e/evil.com', '/%2e%2e/%2e%2e/evil.com'],
  ['закодована: табуляція /%09/evil.com', '/%09/evil.com'],
  ['закодована: CRLF /%0d%0a/evil.com', '/%0d%0a/evil.com'],
  ['закодована: нуль /%00', '/%00'],
  ['закодована: двокрапка /%3a', '/javascript%3aalert(1)'],

  // подвійне й потрійне декодування
  ['подвійне декодування: /%252f%252fevil.com', '/%252f%252fevil.com'],
  ['подвійне декодування: без слеша', '%252f%252fevil.com'],
  ['подвійне декодування: зворотна /%255cevil.com', '/%255cevil.com'],
  ['потрійне декодування', '/%25252f%25252fevil.com'],
  ['безневинний %25 теж не проходить', '/100%25'],

  // символи, які URL-парсер ковтає мовчки
  ['табуляція всередині: /<TAB>/evil.com', '/\t/evil.com'],
  ['перенос рядка всередині: /<LF>/evil.com', '/\n/evil.com'],
  ['повернення каретки всередині', '/\r/evil.com'],
  ['CRLF всередині', '/\r\n/evil.com'],
  ['пробіл всередині: / /evil.com', '/ /evil.com'],
  ['пробіл на початку: " //evil.com"', ' //evil.com'],
  ['табуляція на початку', '\t//evil.com'],
  ['нуль-байт на початку', '\u0000//evil.com'],
  ['кінцевий перенос рядка', '/account\n'],
  ['кінцевий пробіл', '/account '],

  // схожі на слеш символи Unicode
  ['схожий на слеш: U+2215', '/∕evil.com'],
  ['схожий на слеш: U+FF0F (повна ширина)', '/／evil.com'],
  ['схожий на зворотну: U+FF3C', '＼＼evil.com'],
  ['перевертання напряму U+202E', '/‮evil.com'],
  ['не-ASCII літера в шляху', '/akаunt'], // друга «а» — кирилична

  // форма: не від кореня
  ['порожній рядок', ''],
  ['самі пробіли', '   '],
  ['голе імʼя хоста: evil.com', 'evil.com'],
  ['відносна без кореня: account', 'account'],
  ['відносна: ./account', './account'],
  ['відносна: ../account', '../account'],
  ['лише запит', '?next=/account'],
  ['лише фрагмент', '#frag'],

  // Знаки поза алфавітом, які САМІ по собі не втеча, але алфавіт їх не знає.
  // Вони тут, щоб кожна межа алфавіту мала власного свідка: інакше межу можна
  // розсунути (як `:` чи `#`), і жоден випадок цього не помітить, бо кожен інший
  // відхиляється ще й через щось друге.
  ['алфавіт: двокрапка в сегменті, /a:b', '/a:b'],
  ['алфавіт: фрагмент без слешів, /account#frag', '/account#frag'],

  // чужий шлях, захований у нашому
  ['слеші в запиті: /account?next=//evil.com', '/account?next=//evil.com'],
  ['схема в запиті', '/account?x=https://evil.com'],
  ['фрагмент: /account#//evil.com', '/account#//evil.com'],
  ['крапка з комою: /account;//evil.com', '/account;//evil.com'],
  ['порожній сегмент усередині: /a//evil.com', '/a//evil.com'],
  ['порожній сегмент після крапки: /.//evil.com', '/.//evil.com'],

  // не рядки
  ['null', null],
  ['undefined', undefined],
  ['число', 0],
  ['true', true],
  ['обʼєкт', {}],
  ['порожній масив', []],
  ['масив із годящим рядком: ["/account"]', ['/account']],
  ['обʼєкт з toString, що віддає годящий шлях', { toString: () => '/account' }],
  ['обгортка new String("/account")', new String('/account')],

  // довжина
  ['довший за ліміт на один символ', '/' + 'a'.repeat(MAX_RETURN_LENGTH)],
  ['у тисячу разів довший', '/' + 'a'.repeat(MAX_RETURN_LENGTH * 1000)],
];

// Щоб «відхилено все» не пройшло за «відхилено, бо нічого не приймається»:
// справжні адреси проходять — зі свого боку.
const GOOD = [
  '/',
  '/account',
  '/account/',
  '/plan',
  '/map?layer=drought',
  '/routes/alps-in-6-days',
  '/camping/de/bayern/altmuehlsee',
  '/a?x=1&y=2',
  '/account?',
  '/a.b/c_d~e-f',
] as const;

test.describe('🔴 типове місце — це `/`, і воно саме безпечне', () => {
  test('типове місце проходить власну перевірку', () => {
    expect(DEFAULT_RETURN).toBe('/');
    expect(isReturnPath(DEFAULT_RETURN)).toBe(true);
  });
});

test.describe('🔴 ворожі форми: кожна повертає типове місце', () => {
  test('корпус ворожих форм не порожній і справді різноманітний', () => {
    // Щоб цикл нижче не пройшов над порожнім списком.
    // Нижня межа — те, скільки їх є: корпус можна збільшувати, а скорочення
    // має бути свідомою правкою цього числа, а не тихим видаленням рядка.
    expect(HOSTILE.length).toBeGreaterThanOrEqual(88);
    expect(new Set(HOSTILE.map(([name]) => name)).size).toBe(HOSTILE.length);
  });

  for (const [name, input] of HOSTILE) {
    test(`${name}`, () => {
      // Вхід 1: чиста функція.
      expect(isReturnPath(input), 'isReturnPath').toBe(false);
      expect(safeReturnPath(input), 'safeReturnPath').toBe(DEFAULT_RETURN);

      // Вхід 2: запис. Не записується взагалі.
      const written = memory();
      expect(rememberReturn(input, written, 1_000), 'rememberReturn').toBe(false);
      expect(written.keys(), 'нічого не записано').toEqual([]);

      // Вхід 3: читання зі сховища, куди рядок поклали в обхід (консоль,
      // розширення, XSS). Рядок JSON-ом; не-рядки (null, обʼєкти) теж.
      // (`new String(...)` JSON перетворює на звичайний рядок, тож «покласти
      // його в сховище» означало б покласти справжню адресу; цей один випадок
      // про ТИП, і його тримають входи 1 і 2.)
      if (!(input instanceof String)) {
        const planted = memory({ [RETURN_KEY]: JSON.stringify({ path: input, at: 1_000 }) });
        expect(takeReturn(planted, 1_001), 'takeReturn').toBe(DEFAULT_RETURN);
        expect(planted.has(RETURN_KEY), 'запис видалено після читання').toBe(false);
      }
    });
  }
});

test.describe('справжні адреси проходять — відхилення не за побудовою', () => {
  for (const good of GOOD) {
    test(`${good}`, () => {
      expect(isReturnPath(good)).toBe(true);
      expect(safeReturnPath(good)).toBe(good);
      const s = memory();
      expect(rememberReturn(good, s, 5_000)).toBe(true);
      expect(takeReturn(s, 5_001)).toBe(good);
    });
  }

  test('рівно на межі довжини — ще адреса, на одну більше — вже ні', () => {
    const atLimit = '/' + 'a'.repeat(MAX_RETURN_LENGTH - 1);
    expect(atLimit).toHaveLength(MAX_RETURN_LENGTH);
    expect(isReturnPath(atLimit)).toBe(true);
    expect(isReturnPath(atLimit + 'a')).toBe(false);
    expect(MAX_RETURN_LENGTH).toBe(512);
  });
});

// ── 2. Оракул: парсер браузера, і корпус не з форми нашої перевірки ────

/** Детермінований генератор: однакові числа щоразу, щоб збій можна було повторити. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Шматки ЗЛОВМИСНИКА, а не нашого алфавіту: ті, з яких роблять чужий хост,
// ховають слеш, ковтаються парсером чи ламають розбір. До них додано кілька
// звичайних шматків, щоб випадало й прийняте.
const PIECES = [
  '/', '/', '//', '\\', '/\\', '%2f', '%2F', '%5c', '%25', '%252f', '%00', '%09',
  '..', '.', '@', ':', 'https:', 'http:', 'javascript:', 'data:', '//evil.com',
  'evil.com', 'camptribe.eu', 'account', 'plan', 'map', '?', '#', '=', '&', '+',
  '\t', '\n', '\r', ' ', '\u0000', '／', '∕', 'a', 'b', '-', '_', '~',
  '0', '1',
] as const;

function corpus(count: number, seed: number): string[] {
  const rnd = lcg(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const WORDS = ['account', 'plan', 'map', 'a-b', 'x_y', '1.2', 'camping', 'de'] as const;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let s = '';
    if (rnd() < 0.25) {
      // Суцільний шум зі шматків зловмисника.
      const n = 1 + Math.floor(rnd() * 8);
      for (let j = 0; j < n; j++) s += pick(PIECES);
    } else {
      // Майже добра адреса, в яку вставлено 0–2 ворожі шматки в довільні місця:
      // саме такі «ледь не годяться» форми й обходять списки заборон.
      const segs = Array.from({ length: Math.floor(rnd() * 4) }, () => pick(WORDS));
      s = '/' + segs.join('/') + (rnd() < 0.3 ? `?${pick(WORDS)}=${pick(WORDS)}` : '');
      for (let k = Math.floor(rnd() * 3); k > 0; k--) {
        const at = Math.floor(rnd() * (s.length + 1));
        s = s.slice(0, at) + pick(PIECES) + s.slice(at);
      }
    }
    out.push(s);
  }
  return out;
}

/** Що каже браузер: куди б ця адреса привела з нашої сторінки. `null` — нікуди. */
function browserSays(s: string): URL | null {
  try {
    return new URL(s, ORIGIN);
  } catch {
    return null;
  }
}

test.describe('🔴 оракул: усе прийняте лишається на нашому origin (парсер браузера)', () => {
  const N = 60_000;
  const strings = corpus(N, 0xca3b229);
  const accepted = strings.filter((s) => isReturnPath(s));
  const escaping = strings.filter((s) => {
    const u = browserSays(s);
    return u !== null && u.origin !== ORIGIN;
  });

  // 🔴 Порушення збираються в масив і перевіряються ОДНИМ `expect`: так збій
  // показує перший десяток винних рядків, а не гасне на першому, і прогін
  // не платить за шістдесят тисяч окремих тверджень.

  test('корпус не вироджений: у ньому є і прийняте, і те, що веде на чужий хост', () => {
    // «Мовчун задовольняє заборону»: оракул, що нічого не приймає або на
    // якому ніщо не втікає, нічого не довів би. Пороги — нижче заміряного
    // (див. опис PR) з запасом, щоб зміна генератора не мовчки спорожнила корпус.
    expect(strings).toHaveLength(N);
    expect(accepted.length).toBeGreaterThan(1_000);
    expect(escaping.length).toBeGreaterThan(2_000);
    // Прийняте — це більше ніж просто `/`: різноманітність, а не один рядок.
    expect(new Set(accepted).size).toBeGreaterThan(200);
  });

  test('жодне прийняте не веде за межі origin, не несе userinfo і не стає //-шляхом', () => {
    const violations = accepted.filter((s) => {
      const u = browserSays(s);
      return (
        u === null ||
        u.origin !== ORIGIN ||
        u.username + u.password !== '' ||
        u.pathname.startsWith('//') ||
        !s.startsWith('/') ||
        s.startsWith('//')
      );
    });
    expect(violations.slice(0, 10)).toEqual([]);
  });

  test('і навпаки: усе, що парсер веде на чужий хост, відхилено', () => {
    const accepting = escaping.filter((s) => isReturnPath(s));
    expect(accepting.slice(0, 10)).toEqual([]);
  });

  test('прийняте не змінюється від жодної кількості розкодувань (немає `%`)', () => {
    const changed = accepted.filter((s) => {
      let t = s;
      for (let i = 0; i < 5; i++) t = decodeURIComponent(t);
      return t !== s;
    });
    expect(changed.slice(0, 10)).toEqual([]);
  });
});

// ── 3. Сховище ────────────────────────────────────────────────────────

test.describe('сховище: запис, строк, одноразовість', () => {
  test('кладе шлях і час, і нічого більше', () => {
    const s = memory();
    expect(rememberReturn('/account', s, 1_234)).toBe(true);
    expect(s.keys()).toEqual([RETURN_KEY]);
    expect(JSON.parse(s.getItem(RETURN_KEY)!)).toEqual({ path: '/account', at: 1_234 });
  });

  test('ключ — той, що описано, а не імʼя, яке хтось уже використовує', () => {
    expect(RETURN_KEY).toBe('camptribe.return');
  });

  test('одноразове: другий `takeReturn` вже нічого не знає', () => {
    const s = memory();
    rememberReturn('/account', s, 100);
    expect(takeReturn(s, 101)).toBe('/account');
    expect(takeReturn(s, 102)).toBe(DEFAULT_RETURN);
    expect(s.has(RETURN_KEY)).toBe(false);
  });

  test('нічого не записано — типове місце', () => {
    expect(takeReturn(memory(), 1)).toBe(DEFAULT_RETURN);
  });

  test('строк — 15 хвилин, написані числом: живе на мілісекунду до межі', () => {
    expect(RETURN_TTL_MS).toBe(900_000);
    const s = memory();
    rememberReturn('/account', s, 10_000);
    expect(takeReturn(s, 10_000 + 899_999)).toBe('/account');
  });

  test('рівно на межі вже мертве, як і сесія в API', () => {
    const s = memory();
    rememberReturn('/account', s, 10_000);
    expect(takeReturn(s, 10_000 + 900_000)).toBe(DEFAULT_RETURN);
    expect(s.has(RETURN_KEY), 'прострочений теж видалено').toBe(false);
  });

  test('запис із майбутнього не живе вічно: годинник, що збився, або підробка', () => {
    const s = memory({ [RETURN_KEY]: JSON.stringify({ path: '/account', at: 9_999_999_999_999 }) });
    expect(takeReturn(s, 1_000)).toBe(DEFAULT_RETURN);
    expect(s.has(RETURN_KEY)).toBe(false);
  });

  const CORRUPT: readonly (readonly [string, string])[] = [
    ['не JSON', 'not json'],
    ['порожній обʼєкт', '{}'],
    ['null', 'null'],
    ['масив', '[]'],
    ['просто рядок з адресою', '"/account"'],
    ['без часу', '{"path":"/account"}'],
    ['час рядком', '{"path":"/account","at":"now"}'],
    ['час null', '{"path":"/account","at":null}'],
    ['шлях числом', '{"path":123,"at":1000}'],
    ['без шляху', '{"at":1000}'],
    ['шлях масивом', '{"path":["/account"],"at":1000}'],
  ];

  for (const [name, raw] of CORRUPT) {
    test(`зіпсований запис («${name}») — типове місце, і запис видалено`, () => {
      const s = memory({ [RETURN_KEY]: raw });
      expect(takeReturn(s, 1_001)).toBe(DEFAULT_RETURN);
      expect(s.has(RETURN_KEY)).toBe(false);
    });
  }

  test('сховище, що кидає при читанні, — типове місце, а не виняток', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(takeReturn(broken, 1)).toBe(DEFAULT_RETURN);
  });

  test('сховище, що кидає при записі, — `false`, а не виняток', () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(rememberReturn('/account', full, 1)).toBe(false);
  });

  test('сховища немає зовсім (приватне вікно) — `false` і типове місце', () => {
    expect(rememberReturn('/account', null, 1)).toBe(false);
    expect(takeReturn(null, 1)).toBe(DEFAULT_RETURN);
  });
});

// ── Сторожі на текст: ЄДИНИЙ запис і НУЛЬ читань адреси сторінки ─────

// 🔴 Це СИГНАЛІЗАЦІЯ, а не доказ, і названо так. Доказ «`?next=` не читається»
// — прогін у браузері з живим API (опис PR); тут — що, коли хтось додасть
// читання, тест це помітить. Коментарі відкинуто: згадка слова в тексті не
// є викликом (правило проєкту: сторож на текст мусить читати код).

const SRC = join(__dirname, '..', '..', 'src');
const code = (rel: string) =>
  readFileSync(join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Тіло однієї функції: від її заголовка до наступного розділювача `// ──`. */
function fnBody(source: string, header: string): string {
  const raw = readFileSync(join(SRC, source), 'utf8');
  const start = raw.indexOf(header);
  expect(start, `немає ${header} у ${source}`).toBeGreaterThanOrEqual(0);
  const end = raw.indexOf('\n// ──', start);
  const body = raw.slice(start, end < 0 ? undefined : end);
  return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

test.describe('сторожі на текст', () => {
  test('LoginForm бере місце повернення з `takeReturn` і не звертається до адреси сторінки', () => {
    const body = fnBody('components/account-forms.tsx', 'export function LoginForm()');
    // Щоб відсутність читань щось значила: функція справді ця й справді повертається.
    expect(body).toContain('takeReturn(');
    expect(body).toContain('router.replace(');
    expect(body).not.toMatch(
      /location|searchParams|SearchParams|\.search\b|\.hash\b|referrer|document\./i,
    );
  });

  test('лише кабінет пише місце повернення', () => {
    const writers = ['components/account-forms.tsx', 'components/account-cabinet.tsx', 'lib/cabinet.ts'];
    expect(code('components/account-cabinet.tsx')).toContain('rememberReturn(');
    expect(code('components/account-forms.tsx')).not.toContain('rememberReturn(');
    expect(code('lib/cabinet.ts')).not.toContain('rememberReturn(');
    // Ключ сховища не згадується ніде, крім його власного модуля.
    for (const rel of writers) expect(code(rel), rel).not.toContain('camptribe.return');
    expect(code('lib/return-path.ts')).toContain("'camptribe.return'");
  });

  test('кабінет запамʼятовує адресу цієї сторінки, а не що-небудь із запиту', () => {
    const c = code('components/account-cabinet.tsx');
    expect(c).toMatch(/rememberReturn\(\s*window\.location\.pathname\s*\+\s*window\.location\.search\s*\)/);
    expect(c).not.toMatch(/URLSearchParams|searchParams|\.get\(/);
  });
});
