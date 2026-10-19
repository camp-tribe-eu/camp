import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import Privacy from '@/content/legal/privacy';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

/**
 * CAMP-353 — строк зберігання безпекового журналу живе у ДВОХ місцях:
 * у конфігу ротації на машині й у політиці приватності, яку читають
 * люди. Розбіжність між ними — не неточність, а опублікована неправда.
 *
 * 🔴 ЦЕЙ ТЕСТ ІСНУЄ, БО ТАКЕ ВЖЕ СТАЛОСЬ. До 19.10.2026 політика
 * стверджувала, що журналювання вимкнене. Це було виміряно й правдиво
 * 15.10 — і перестало бути правдою, коли на машині змінився ОДИН рядок
 * конфігу. Жодного рядка коду не торкнулись, жоден тест не почервонів.
 *
 * 🔴 ЧИТАЄТЬСЯ САМЕ ВІДРЕНДЕРЕНИЙ ТЕКСТ, А НЕ ФАЙЛ. Коментарі у
 * `privacy.tsx` пояснюють цей самий механізм і містять і «fourteen
 * days», і «rotate 13». Пошук по сирому файлу задовольнявся б
 * поясненням, а не обіцянкою — тобто перевіряв би сам себе. З тієї ж
 * причини з конфігу logrotate знімаються рядки `#`: у них теж є слово
 * `rotate`.
 */

// `__dirname`, а не `import.meta`: Playwright компілює ці специфікації
// в CommonJS (та сама причина, що й у csp.spec.ts).
const ROOT = path.join(__dirname, '..', '..', '..', '..');

/** Рядки конфігу без коментарів і порожніх. */
function directives(file: string): string[] {
  return readFileSync(path.join(ROOT, file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

const rotateConf = directives('infra/logrotate/camptribe-caddy');
const caddyfile = directives('infra/caddy/camptribe.eu.caddyfile');

/**
 * Скільки діб тримається рядок. Відротованих файлів `rotate N`, плюс
 * активний, який теж живе добу, бо ротація щоденна.
 */
const rotate = Number(rotateConf.find((l) => /^rotate\s+\d+$/.test(l))?.split(/\s+/)[1]);
const DAYS = rotate + 1;

/**
 * Число словами — рівно так, як воно стоїть у тексті політики.
 * Перелік навмисно короткий: якщо строк змінять на той, якого тут
 * немає, тест упаде з проханням дописати слово, а не промовчить.
 */
const WORD: Record<number, string> = { 7: 'seven', 14: 'fourteen', 28: 'twenty-eight', 30: 'thirty' };

const prose = visibleText(renderComponent(Privacy, {}));

/**
 * Текст ОДНОГО розділу, від заголовка до наступного.
 *
 * 🔴 БЕЗ ЦЬОГО ТЕСТ ПІДТВЕРДЖУВАВ САМ СЕБЕ, І МУТАЦІЙНИЙ ПРОГІН ЦЕ
 * ПОКАЗАВ. `rotate 13` → `rotate 29` означає строк 30 діб; перевірка
 * шукала «thirty days» по всьому документу — і знаходила, бо політика
 * каже «Sessions: thirty days» зовсім про інше. Мутація вижила, а
 * виглядала спійманою разом з усіма.
 */
function section(from: string, to: string): string {
  const a = prose.indexOf(from);
  const b = prose.indexOf(to, a + from.length);
  expect(a, `у політиці немає розділу «${from}»`).toBeGreaterThanOrEqual(0);
  expect(b, `після «${from}» немає «${to}» — розділ не обмежений`).toBeGreaterThan(a);
  return prose.slice(a, b);
}

const LOG = section('The security log', 'Your account, if you make one');

test('конфіг ротації розібрався, а не дав NaN', () => {
  expect(Number.isInteger(rotate), 'директиви `rotate N` у конфігу немає').toBe(true);
  expect(rotate).toBeGreaterThan(0);
  // 🔴 Пара до кожного твердження нижче: якщо рендер порожній, усі
  // `toContain` справдились би над порожнечею.
  expect(prose.length, 'політика відрендерилась порожньою').toBeGreaterThan(2000);
  expect(prose).toContain('Who is responsible');
});

test('ротація щодоби, інакше `rotate N` не означає N діб', () => {
  expect(rotateConf, 'без `daily` строк рахується розміром файла, а не днями').toContain('daily');
  // `notifempty` пропускає ротацію порожнього файла — а на тихій добі
  // це лишає в активному файлі вчорашні рядки, і так доба за добою.
  expect(rotateConf, '`notifempty` ламає календарний строк').not.toContain('notifempty');
});

test('веб-сервер не ротує сам, інакше господарів строку двоє', () => {
  expect(caddyfile, 'без `roll_disabled` рольщик Caddy сперечається з logrotate').toContain(
    'roll_disabled',
  );
  expect(
    caddyfile.some((l) => l.startsWith('roll_keep_for') || l.startsWith('roll_size')),
    'розмірна ротація повернулась — вона не дає календарного строку',
  ).toBe(false);
});

test('строк у політиці — той самий, що в конфігу', () => {
  const word = WORD[DAYS];
  expect(word, `строк став ${DAYS} діб — допиши це число словом у WORD`).toBeTruthy();
  expect(LOG, `розділ про журнал має називати строк «${word} days»`).toContain(`${word} days`);
  // Пара: жодне ІНШЕ число з переліку не має стояти в цьому ж розділі,
  // інакше «містить потрібне слово» нічого не означає.
  for (const [n, w] of Object.entries(WORD)) {
    if (Number(n) === DAYS) continue;
    expect(LOG, `у розділі про журнал стоїть і «${w} days»`).not.toContain(`${w} days`);
  }
});

test('політика не стверджує того, що скасовано', () => {
  expect(prose, 'текст досі каже, що журналювання вимкнене').not.toContain('switched off');
  expect(prose).toContain('The security log');
  expect(LOG, 'підстава має бути названа в самому розділі').toContain('Article 6(1)(f)');
  expect(LOG, 'право заперечити має бути назване').toContain('Article 21');
  expect(LOG, 'має бути сказано, що це не аналітика').toContain('Not used for:');
  expect(LOG, 'має бути сказано, що куки й авторизація не пишуться').toContain('REDACTED');
});
