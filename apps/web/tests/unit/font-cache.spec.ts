import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * Шрифти віддаються з `Cache-Control: … immutable` на рік
 * (next.config.mjs), а імена файлів хеша не мають. Тобто «файл за цією
 * адресою не зміниться» — обіцянка, яку дає людина, а не збірка.
 *
 * 🔴 ЩО ТРИМАЄ ЦЕЙ ФАЙЛ. Заміна вмісту шрифту під старим імʼям: читач,
 * який уже був на сайті, бачив би старий файл до року, і жоден інший
 * тест цього не помітив би — сторінка з новим шрифтом рендериться
 * правильно в кожному свіжому браузері CI.
 *
 * 🔴 ЧОГО ВІН НЕ ДОВОДИТЬ: що заголовок справді віддається. Це читає
 * tests/e2e/font-cache.spec.ts із живої відповіді сервера.
 *
 * Як діяти, коли він червоний: НЕ переписувати відбиток. Дати файлу нове
 * імʼя (`archivo-latin.v2.woff2`), оновити `layout.tsx` і `globals.css`,
 * і вже тоді додати сюди рядок для нового імені.
 */
const FONTS = path.join(__dirname, '..', '..', 'public', 'fonts');
const SRC = path.join(__dirname, '..', '..', 'src', 'app');

const PINNED: Record<string, string> = {
  'archivo-latin-ext.woff2':
    'a999e009fdcd0f939c138e04043b3b2ad083b26252b644e8f94c083d48b77af0',
  'archivo-latin.woff2':
    '7150c0ec5ad356453013d11affec1fbab95de0dd2dcecb043b4f1cb7f87c4ba4',
  'archivo-narrow-latin-ext.woff2':
    'db821b657f1d6b362a8bbddb4452073d156cea76854a157d3b33b4a999fcebfa',
  'archivo-narrow-latin.woff2':
    '728b32e94fd137eca605f80d3c34adeaeef0d312425c7a5a1ff743407b2d78f9',
};

const onDisk = () => readdirSync(FONTS).sort();

test('🔴 кожен файл у public/fonts має відбиток, і кожен відбиток — файл', () => {
  const files = onDisk();
  expect(files.length, 'тека шрифтів порожня — перевіряти нічого').toBeGreaterThan(0);
  expect(files).toEqual(Object.keys(PINNED).sort());
});

test('🔴 вміст шрифту під тим самим імʼям не змінився', () => {
  for (const name of onDisk()) {
    const got = createHash('sha256')
      .update(readFileSync(path.join(FONTS, name)))
      .digest('hex');
    expect(
      got,
      `${name} змінився, а адреса лишилась: кеш на рік віддасть читачам старий. Дай файлу нове імʼя.`,
    ).toBe(PINNED[name]);
  }
});

test('кожна адреса /fonts/… у розмітці й стилях — файл, який існує', () => {
  const text =
    readFileSync(path.join(SRC, 'layout.tsx'), 'utf8') +
    readFileSync(path.join(SRC, 'globals.css'), 'utf8');
  const refs = [...new Set([...text.matchAll(/\/fonts\/([\w.-]+\.woff2)/g)].map((m) => m[1]))];
  expect(refs.length, 'жодного посилання на шрифт не знайдено — вираз осліп').toBeGreaterThan(0);
  const files = onDisk();
  for (const ref of refs) expect(files, `посилання на ${ref}`).toContain(ref);
});
