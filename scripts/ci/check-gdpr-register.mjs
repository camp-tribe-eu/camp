#!/usr/bin/env node
// Реєстр операцій обробки не сміє розійтися з кодом.
//
// 🔴 ЧОМУ ЦЕЙ СТОРОЖ, А НЕ ВИЧИТКА РАЗ НА ПІВРОКУ. Реєстр за ст. 30 GDPR
// описує, що ми СПРАВДІ обробляємо. Щойно з'являється сутність із
// персональними даними, а в реєстрі її немає, документ стає неправдою —
// і неправдою саме того роду, яку питає наглядовий орган.
//
// Сторож не вміє САМ вирішити, чи дані персональні: це судження. Тому
// кожна сутність мусить бути класифікована тут явно. Нова сутність без
// класифікації валить перевірку — і це навмисно: людина має вирішити.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SELF_TEST = process.argv.includes('--self-test');

// Сутності з даними ПРО ЛЮДИНУ. Кожна має бути названа в реєстрі.
const PERSONAL = new Map([
  ['user', 'user'],
  ['session', 'session'],
  ['auth-token', 'auth-token'],
  ['moderation', 'moderation'],
  ['client-error', 'client-error'],
  ['not-found-hit', 'not-found-hit'],
  ['trip', 'trip'],
  ['trip-stop', 'trip-stop'],
  // CAMP-390: журнал згод — хто, на що (версія формулювання), надав чи відкликав.
  ['consent-record', 'consent-record'],
  // «Report a problem»: що не так із кемпінгом — і, ЗА БАЖАННЯМ, як відповісти людині.
  ['problem-report', 'problem-report'],
]);

// Сутності БЕЗ даних про людину — довідники місць, погоди, тарифів.
// 🔴 Якщо додаєш сюди рядок, спитай себе: чи справді там немає нічого,
// що вказує на конкретну людину? «Ім'я» кемпінгу — ні. «Автор» — так.
const IMPERSONAL = new Set([
  'air-quality', 'bathing-water', 'camping-spot', 'content', 'rental',
  'route', 'route-point', 'spot-tariff',
]);

/** Чисте ядро: приймає світ, віддає перелік розбіжностей. Саме його
 *  перевіряє самотест — на фікстурах, не на справжньому дереві. */
export function audit(found, register, personal = PERSONAL, impersonal = IMPERSONAL) {
  const problems = [];

  for (const name of found) {
    if (!personal.has(name) && !impersonal.has(name)) {
      problems.push(
        `сутність «${name}» не класифікована: додай її в PERSONAL (і в реєстр) або в IMPERSONAL`,
      );
    }
  }
  for (const [name, needle] of personal) {
    if (!found.includes(name)) {
      problems.push(`сутність «${name}» названа в сторожі, але її вже немає в коді — реєстр описує неіснуюче`);
      continue;
    }
    if (!register.includes(needle)) {
      problems.push(`сутність «${name}» має персональні дані, але не згадана в реєстрі`);
    }
  }
  return problems;
}

if (SELF_TEST) {
  // 🔴 Сторож, що ніколи не червонів, нічого не доводить. Кожен випадок
  // нижче — навмисно зламаний світ, на якому перевірка МУСИТЬ упасть.
  const P = new Map([['user', 'user'], ['trip', 'trip']]);
  const I = new Set(['camping-spot']);
  const ok = ['user', 'trip', 'camping-spot'];
  const REG = 'тут згадано user і trip';
  let passed = 0;
  let failed = 0;
  const t = (what, got, want) => {
    if (got === want) { passed += 1; console.log(`  ✓ ${what}`); }
    else { failed += 1; console.error(`  ✗ ${what}: було ${got}, мало бути ${want}`); }
  };
  t('чистий світ не червоніє', audit(ok, REG, P, I).length, 0);
  t('нова некласифікована сутність ловиться', audit([...ok, 'zz'], REG, P, I).length, 1);
  t('персональна сутність без згадки в реєстрі ловиться', audit(ok, 'тут лише user', P, I).length, 1);
  t('сутність, що зникла з коду, ловиться', audit(['user', 'camping-spot'], REG, P, I).length, 1);
  t('дві поломки дають дві скарги', audit([...ok, 'zz'], 'тут лише user', P, I).length, 2);
  console.log(`check-gdpr-register self-test: ran ${passed + failed}, passed ${passed}, failed ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

const found = readdirSync('apps/api/src/entities')
  .filter((f) => f.endsWith('.entity.ts'))
  .map((f) => f.replace(/\.entity\.ts$/, ''));
const problems = audit(found, readFileSync('docs/GDPR-REGISTER.md', 'utf8'));

if (problems.length > 0) {
  console.error('✗ Реєстр операцій обробки розійшовся з кодом:\n');
  for (const p of problems) console.error(`  🔴 ${p}`);
  console.error('\n  docs/GDPR-REGISTER.md описує, що ми справді обробляємо. Розбіжність тут —');
  console.error('  це не неохайність, а неправда перед наглядовим органом.');
  process.exit(1);
}

console.log(
  `✓ реєстр ст. 30 збігається з кодом: ${PERSONAL.size} сутностей із персональними даними, ` +
    `${IMPERSONAL.size} без них, усі ${found.length} класифіковані`,
);
