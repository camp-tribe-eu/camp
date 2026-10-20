import { expect, test } from '@playwright/test';

import Notice from '@/content/legal/notice';
import Privacy from '@/content/legal/privacy';
import { SiteFooter } from '@/components/site-chrome';
import { COMPANY, COMPANY_ADDRESS } from '@/lib/legal';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-188 — ідентифікація підприємства на сайті.
//
// 🔴 ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ. Стаття 5 Директиви про е-комерцію
// (2000/31/EC), у Бельгії — книга XII Wetboek van economisch recht,
// вимагає від комерційного сайту назву, адресу осідку й номер торгового
// реєстру. Це не стиль і не оздоба: це умова, за якою сайт узагалі можна
// відкривати.
//
// Номер підприємства власник видав 20.10.2026, і він зʼявився в підвалі
// та на сторінці правової інформації. Вимога, яку ніщо не стереже,
// тримається рівно до першого рефакторингу, який «прибирає зайве» з
// копірайту, — а помітять це не ми, а той, хто прийде з претензією.
//
// 🔴 ПЕРЕВІРЯЄМО ПРОЧИТАНЕ, А НЕ КОНСТАНТУ. `expect(COMPANY.x).toBe(…)`
// тут був би тестом, який переказує означення: він зелений і тоді, коли
// значення нікуди не виводиться. Тому читаємо видимий текст сторінки.

test('🔴 сторінка правової інформації називає номер підприємства', () => {
  const text = visibleText(renderComponent(Notice, {}));
  expect(text).toContain(COMPANY.enterpriseNumber);
  // І підписує його так, щоб читач зрозумів, що це за число.
  expect(text).toMatch(/enterprise number/i);
  expect(text).toMatch(/VAT/i);
});

test('називає і саму компанію, і де вона', () => {
  const text = visibleText(renderComponent(Notice, {}));
  expect(text).toContain(COMPANY.name);
  expect(text).toContain(COMPANY.city);
  expect(text).toContain(COMPANY.country);
});

// 🔴 ФОРМА НОМЕРА, А НЕ ЛИШЕ ЙОГО НАЯВНІСТЬ. Бельгійський номер
// підприємства це десять цифр, що починаються з 0 або 1. Порожній рядок,
// заповнювач на кшталт «TODO» чи обрізане значення пройшли б перевірку
// «текст містить константу» — бо вона порівнює сторінку сама з собою.
test('🔴 номер має вигляд бельгійського, а не заповнювача', () => {
  expect(COMPANY.enterpriseNumber).toMatch(/^BE [01]\d{3}\.\d{3}\.\d{3}$/);
});

// 🔴 АДРЕСА ОСІДКУ НАЗВАНА ПОВНІСТЮ. Рішення власника 20.10.2026: вона
// публікується, бо з номера підприємства знаходиться й так. До того тут
// стояв зворотний тест — «вулиці немає, і сторінка пояснює чому». Він
// упав, щойно адреса зʼявилась, і це була його робота: він тримав
// пояснення рівно доти, доки воно було правдою.
test('🔴 сторінка називає адресу осідку, а не саме лише місто', () => {
  const text = visibleText(renderComponent(Notice, {}));
  expect(text).toContain(COMPANY.street);
  expect(text).toContain(COMPANY.city);
  expect(text).toMatch(/registered office/i);
});

// 🔴 ПОЛІТИКА ПРИВАТНОСТІ НАЗИВАЄ КОНТРОЛЕРА ПОВНІСТЮ. Стаття 13 GDPR
// вимагає ОСОБУ контролера, а «UTD BV, Антверпен» це натяк, не особа.
// Окремий тест, бо це окрема сторінка й окрема норма: виправлення
// правової сторінки не мусить мовчки лишати політику старою.
test('🔴 політика приватності називає контролера з адресою', () => {
  const text = visibleText(renderComponent(Privacy, {}));
  expect(text).toContain(COMPANY_ADDRESS);
  expect(text).toMatch(/controller/i);
});

// 🔴 ПІДВАЛ НЕСЕ НАЗВУ Й ПРАВА — І НЕ НЕСЕ АДРЕСИ.
//
// Це теж рішення власника, і воно симетричне попередньому: опублікувати
// адресу — обовʼязок, друкувати осідок під кожною сторінкою — ні.
// Без цього тесту наступне «уніфікуємо підвал» поверне її туди, і
// помітить це не розробник, а власник.
//
// Рік тут НЕ перевіряється рядком: `CurrentYear` навмисно розходиться
// між збіркою та браузером, тож твердження про конкретне число було б
// тестом, який ламається 1 січня без жодного дефекту.
test('🔴 у підвалі немає адреси — лише назва, рік і права', () => {
  const text = visibleText(renderComponent(SiteFooter, {}));
  expect(text).toContain(COMPANY.name);
  expect(text).toMatch(/All rights reserved/i);
  expect(text).not.toContain(COMPANY.street);
  expect(text).not.toContain(COMPANY.enterpriseNumber);
});
