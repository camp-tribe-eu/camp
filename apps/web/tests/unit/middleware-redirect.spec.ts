import { expect, test } from '@playwright/test';
import { NextRequest, NextResponse } from 'next/server';
import { NextURL } from 'next/dist/server/web/next-url';

import {
  middleware,
  normalisePath,
  publicOrigin,
  redirectFor,
} from '../../src/middleware';

// CAMP-294 — редирект, який на живому сервері вів на localhost:3000.
//
// 🔴 ІСТОРІЯ ДВОХ ПОМИЛОК, ЩОБ ЇХ НЕ ПОВТОРИЛИ.
//
// 1. Баг: `new URL(moved, request.nextUrl.origin)`. За зворотним проксі
//    `nextUrl.origin` — адреса, на якій слухає Next. Усі 4 455 редиректів
//    віддавали `Location: https://localhost:3000/...`.
//
// 2. Перше «виправлення» було ГІРШИМ за баг: я зробив `Location`
//    відносним. Next обгортає middleware в `adapter()`, а той робить
//    `new NextURL(redirect, {опції})` — без бази. Відносна адреса там
//    кидає `TypeError: Invalid URL`, тобто 4 455 редиректів стали б
//    4 455 падіннями. Тест нижче тримає саме цю межу.
//
// 3. Фікстури СВОЇ, не згенерований `spot-redirects.json`: локально там
//    4 455 пар, у CI нуль, бо CI збирає 72 кемпінги. Тест на поведінку не
//    має залежати від того, скільки даних випадково лежить поруч.

const FROM = '/camping/at/burgenland/spot-old';
const TO = '/camping/at/burgenland/spot-new';
const MOVED = new Map([[FROM, TO]]);
const PUBLIC = 'https://camptribe.eu';

const proxied = (host = 'camptribe.eu', proto = 'https') =>
  new Headers({ host: 'localhost:3000', 'x-forwarded-host': host, 'x-forwarded-proto': proto });

test('Location is absolute and points at the public host, not the listen address', () => {
  const res = redirectFor(FROM, '', PUBLIC, MOVED)!;

  expect(res.status).toBe(301);
  expect(res.headers.get('location')).toBe(`${PUBLIC}${TO}`);
  expect(res.headers.get('location')).not.toContain('localhost');
});

test("🔴 the Location survives Next's adapter — a relative one throws there", () => {
  // Саме ця перевірка зупинила б попередню редакцію. `adapter()` робить
  // `new NextURL(location, {опції})` без бази; відносна адреса кидає.
  const location = redirectFor(FROM, '?from=map', PUBLIC, MOVED)!.headers.get('location')!;

  // `NextURL` чекає звичайний об'єкт заголовків, не `Headers` — саме в
  // такому вигляді їх подає `adapter()`.
  const opts = { forceLocale: false, headers: { host: 'camptribe.eu' } };

  expect(() => new NextURL(location, opts)).not.toThrow();

  // І контроль: те, що ми НЕ віддаємо, справді кидає — інакше ця
  // перевірка зелена за побудовою й нічого не стереже.
  expect(() => new NextURL(TO, opts)).toThrow();
});

test('publicOrigin prefers the forwarded host over the one Next listens on', () => {
  expect(publicOrigin(proxied(), 'http://localhost:3000')).toBe('https://camptribe.eu');
  expect(publicOrigin(proxied('www.camptribe.eu', 'https'), 'x')).toBe('https://www.camptribe.eu');

  // Без проксі лишається `host`.
  expect(publicOrigin(new Headers({ host: 'example.test' }), 'x')).toBe('https://example.test');
  // Зовсім без заголовків — запасний варіант, а не падіння.
  expect(publicOrigin(new Headers(), 'http://fallback:1')).toBe('http://fallback:1');
});

test('the query string is carried across, with or without a leading "?"', () => {
  expect(redirectFor(FROM, '?from=map&page=2', PUBLIC, MOVED)!.headers.get('location'))
    .toBe(`${PUBLIC}${TO}?from=map&page=2`);

  // 🔴 Конкатенація дала б `…spot-newa=1`. `target.search =` нормалізує.
  expect(redirectFor(FROM, 'a=1', PUBLIC, MOVED)!.headers.get('location'))
    .toBe(`${PUBLIC}${TO}?a=1`);
});

test('arguments are not interchangeable — order is load-bearing', () => {
  // 🔴 Рецензія показала, що перестановка `redirectFor(search, pathname)`
  // переживала всі тести. Тут усі три аргументи різні за формою, тож
  // будь-яка перестановка змінює результат.
  const res = redirectFor(FROM, '?q=1', PUBLIC, MOVED);
  expect(res).not.toBeNull();
  expect(res!.headers.get('location')).toBe(`${PUBLIC}${TO}?q=1`);

  // Шлях і рядок запиту місцями — редиректу бути не може.
  expect(redirectFor('?q=1', FROM, PUBLIC, MOVED)).toBeNull();
});

test('a trailing slash and upper case still redirect', () => {
  for (const variant of [`${FROM}/`, `${FROM}//`, FROM.toUpperCase()]) {
    const res = redirectFor(variant, '', PUBLIC, MOVED);
    expect(res, variant).not.toBeNull();
    expect(res!.headers.get('location'), variant).toBe(`${PUBLIC}${TO}`);
  }
});

test('an address that is not in the map is left alone', () => {
  expect(redirectFor('/camping/pl/nowhere/not-moved', '', PUBLIC, MOVED)).toBeNull();
});

test('middleware redirects a path that IS in the map, using the forwarded host', () => {
  // 🔴 Рецензія: жоден тест не проводив `middleware()` шляхом, який
  // справді є в мапі, тож усе з'єднання всередині неї лишалось
  // неперевіреним. Фікстура подається аргументом саме для цього.
  const req = new NextRequest(new URL(`${FROM}?from=map`, 'http://localhost:3000'), {
    headers: proxied(),
  });
  const res = middleware(req, MOVED) as NextResponse;

  expect(res.status).toBe(301);
  expect(res.headers.get('location')).toBe(`${PUBLIC}${TO}?from=map`);
});

test('the 410 branch normalises the path too', () => {
  // 🔴 Рецензія: мутація `gone.has(request.nextUrl.pathname)` без
  // `normalisePath` переживала всі тести. Гілка 410 асинхронна, тож
  // перевіряємо САМЕ РІШЕННЯ про маршрут — чи пішли ми в неї.
  const gone = new Set(['/camping/at/burgenland/spot-gone']);
  const go = (path: string) =>
    middleware(
      new NextRequest(new URL(path, 'http://localhost:3000'), { headers: proxied() }),
      new Map(),
      gone,
    );

  for (const variant of [
    '/camping/at/burgenland/spot-gone',
    '/camping/at/burgenland/spot-gone/',
    '/camping/AT/Burgenland/SPOT-GONE',
  ]) {
    const res = go(variant);
    expect(res instanceof Promise, variant).toBe(true);
    // 🔴 Гасимо обіцянку. `serveGone` іде по `/gone` фетчем, слухати
    // нікому, і відмова спливла б як необроблена — прогін червонів би
    // «поза тестами», то з'являючись, то ні, залежно від таймінгу.
    void (res as Promise<unknown>).catch(() => {});
  }

  // А те, чого немає в списку, йде далі й не є обіцянкою.
  expect(go('/camping/at/burgenland/spot-alive') instanceof Promise).toBe(false);
});

test('normalisePath strips trailing slashes and lowers case, and nothing else', () => {
  expect(normalisePath('/Camping/AT/X/')).toBe('/camping/at/x');
  expect(normalisePath('/camping/at/x///')).toBe('/camping/at/x');
  // 🔴 Внутрішні скісні не чіпаються: шлях — це не рядок для прибирання.
  expect(normalisePath('/camping//at/x')).toBe('/camping//at/x');
});
