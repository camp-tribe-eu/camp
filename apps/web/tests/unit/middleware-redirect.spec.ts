import { expect, test } from '@playwright/test';
import { NextRequest } from 'next/server';

import { middleware, normalisePath, redirectFor } from '../../src/middleware';

// CAMP-294 — редирект, який на першій же викладці вів у нікуди.
//
// 🔴 ЧОМУ ЦЕЙ ТЕСТ ДИВИТЬСЯ НА ЗАГОЛОВОК, А НЕ НА ВНУТРІШНЮ ФУНКЦІЮ.
//
// Дефект був не у виборі адреси — мапа віддавала правильну ціль. Зламаною
// була САМЕ ВІДПОВІДЬ: `new URL(moved, request.nextUrl.origin)` підставляв
// адресу, на якій слухає Next, і назовні йшло
// `Location: https://localhost:3000/...`. Перевірка, що повертає рядок,
// пройшла б і на зламаному коді. Тому тут читається справжній
// `NextResponse` і справжній заголовок `Location`.
//
// 🔴 ЧОМУ ФІКСТУРА СВОЯ, А НЕ ЗГЕНЕРОВАНИЙ ФАЙЛ.
//
// Перша версія цього файлу кликала `middleware()` і спиралась на
// `spot-redirects.json`. Локально там 4 455 пар — у CI нуль, бо CI збирає
// фікстуру з 72 кемпінгів, де ніщо нікуди не переїжджало. Тест падав у CI
// й проходив локально, і винен був не код, а припущення, що продакшн-дані
// є всюди. Поведінка редиректу не залежить від того, скільки їх, тож і
// тест не має залежати.

const MOVED = new Map([
  ['/camping/at/burgenland/spot-old', '/camping/at/burgenland/spot-new'],
]);
const FROM = '/camping/at/burgenland/spot-old';
const TO = '/camping/at/burgenland/spot-new';

test('Location is relative — it carries no scheme and no host', () => {
  const res = redirectFor(FROM, '', MOVED);

  expect(res).not.toBeNull();
  expect(res!.status).toBe(301);

  const location = res!.headers.get('location');
  expect(location).toBe(TO);

  // Саме ці три перевірки й падали до виправлення.
  expect(location).toMatch(/^\//);
  expect(location).not.toContain('://');
  expect(location).not.toContain('localhost');
});

test('middleware leaves an unmoved address alone, from any origin', () => {
  // 🔴 ЦЕЙ ТЕСТ НЕ ЛОВИТЬ ТОЙ ДЕФЕКТ, і прикидатись не варто.
  //
  // Перша редакція тут кликала `middleware()` і перевіряла заголовок
  // «якщо він є». З реальною мапою шляху-фікстури в ній немає, заголовка
  // немає, перевірка мовчки пропускалась — і ВОНА ПРОХОДИЛА НА
  // ЗЛАМАНОМУ КОДІ. Галочка, зелена за побудовою, гірша за її
  // відсутність.
  //
  // Тому тут лишилось рівно те, що справді тримається в будь-якому
  // середовищі: адресу, якої немає в мапі, middleware не чіпає, і це не
  // залежить від походження запиту. Від абсолютних адрес захищає
  // підпис `redirectFor` — вона не бачить запиту, тож узяти адресу
  // сервера їй нізвідки.
  for (const origin of [
    'http://localhost:3000',
    'https://camptribe.eu',
    'http://127.0.0.1:8080',
  ]) {
    const res = middleware(
      new NextRequest(new URL('/camping/pl/nowhere/not-moved', origin)),
    );
    const headers = (res as { headers: Headers }).headers;
    expect(headers.get('location'), origin).toBeNull();
  }
});

test('the query string is carried across', () => {
  const res = redirectFor(FROM, '?from=map&page=2', MOVED);

  expect(res!.status).toBe(301);
  expect(res!.headers.get('location')).toBe(`${TO}?from=map&page=2`);
});

test('a trailing slash and upper case still redirect', () => {
  for (const variant of [`${FROM}/`, `${FROM}//`, FROM.toUpperCase()]) {
    const res = redirectFor(variant, '', MOVED);
    expect(res, variant).not.toBeNull();
    expect(res!.headers.get('location'), variant).toBe(TO);
  }
});

test('an address that is not in the map is left alone', () => {
  expect(redirectFor('/camping/pl/nowhere/not-moved', '', MOVED)).toBeNull();
});

test('normalisePath strips trailing slashes and lowers case, and nothing else', () => {
  expect(normalisePath('/Camping/AT/X/')).toBe('/camping/at/x');
  expect(normalisePath('/camping/at/x///')).toBe('/camping/at/x');
  // 🔴 Внутрішні скісні не чіпаються: шлях — це не рядок для прибирання.
  expect(normalisePath('/camping//at/x')).toBe('/camping//at/x');
});
