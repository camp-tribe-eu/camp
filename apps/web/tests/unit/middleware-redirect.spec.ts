import { expect, test } from '@playwright/test';
import { NextRequest } from 'next/server';

import { middleware } from '../../src/middleware';
import SPOT_REDIRECTS from '../../src/generated/spot-redirects.json';

// CAMP-294 — редирект, який на першій же викладці вів у нікуди.
//
// 🔴 ЧОМУ ЦЕЙ ТЕСТ ДИВИТЬСЯ НА ЗАГОЛОВОК, А НЕ НА ФУНКЦІЮ.
//
// Дефект був не в логіці вибору адреси — мапа віддавала правильну ціль.
// Зламаною була САМЕ ВІДПОВІДЬ: `new URL(moved, request.nextUrl.origin)`
// підставляв адресу, на якій слухає Next, і назовні йшло
// `Location: https://localhost:3000/...`. Тест на внутрішню функцію
// пройшов би й на зламаному коді, бо функція повертала правильний шлях.
//
// Тому тут будується справжній `NextRequest`, викликається справжній
// `middleware`, і читається справжній заголовок `Location`.

const PAIRS = Object.entries(SPOT_REDIRECTS as Record<string, string>);

// 🔴 Порожня мапа — це провал, а не «нема чого перевіряти». Інакше
// генератор, який одного дня віддасть нуль пар, зробить цей файл зеленим
// і беззмістовним водночас.
test('the redirect map is not empty', () => {
  expect(PAIRS.length).toBeGreaterThan(0);
});

const [FROM, TO] = PAIRS[0] ?? ['/camping/xx/none/none', '/camping/xx/none/moved'];

// 🔴 `middleware()` повертає або відповідь, або проміс — гілка 410
// асинхронна. Тому чекаємо завжди: інакше типи не сходяться, і це не
// формальність, а нагадування, що в цій функції дві різні гілки.
const call = async (origin: string, path: string) =>
  await middleware(new NextRequest(new URL(path, origin)));

test('Location is relative — it carries no scheme and no host', async () => {
  const res = await call('http://localhost:3000', FROM);

  expect(res.status).toBe(301);
  const location = res.headers.get('location');
  expect(location).toBe(TO);

  // Саме ці три перевірки й падали до виправлення.
  expect(location).toMatch(/^\//);
  expect(location).not.toContain('://');
  expect(location).not.toContain('localhost');
});

test('Location does not depend on the address the server listens on', async () => {
  // 🔴 ЦЕ ЯДРО ТЕСТУ. Два запити з РІЗНИХ походжень мусять дати
  // ОДНАКОВИЙ `Location`. Зі старим кодом вони розходились — саме так
  // дефект і виглядав у проді, і саме це не ловив жоден тест.
  const viaLocalhost = await call('http://localhost:3000', FROM);
  const viaPublic = await call('https://camptribe.eu', FROM);
  const viaOddPort = await call('http://127.0.0.1:8080', FROM);

  expect(viaLocalhost.headers.get('location')).toBe(TO);
  expect(viaPublic.headers.get('location')).toBe(TO);
  expect(viaOddPort.headers.get('location')).toBe(TO);
});

test('the query string is carried across', async () => {
  const res = await call('https://camptribe.eu', `${FROM}?from=map&page=2`);

  expect(res.status).toBe(301);
  expect(res.headers.get('location')).toBe(`${TO}?from=map&page=2`);
});

test('a trailing slash and upper case still redirect', async () => {
  // Обидві форми приходять зі старих посилань і від роботів.
  for (const variant of [`${FROM}/`, FROM.toUpperCase()]) {
    const res = await call('https://camptribe.eu', variant);
    expect(res.status, variant).toBe(301);
    expect(res.headers.get('location'), variant).toBe(TO);
  }
});

test('an address that is not in the map is left alone', async () => {
  const res = await call('https://camptribe.eu', '/camping/pl/warmian-masurian/not-moved');

  // `NextResponse.next()` не є редиректом і не несе `Location`.
  expect(res.status).toBe(200);
  expect(res.headers.get('location')).toBeNull();
});
