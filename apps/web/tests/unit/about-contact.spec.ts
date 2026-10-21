import { expect, test } from "@playwright/test";

import Contact from "@/app/contact/page";
import { COMPANY, CONTACT_EMAIL } from "@/lib/legal";
import { STATIC_HUBS } from "@/lib/sitemap";
import { renderComponent } from "./render-component";
import { visibleText } from "./rendered-text";

// CAMP-209: чотири сторінки були в карті сайту й не існували як адреси.
// Тут лишилась одна з них — `/contact`.
//
// 🔴 ЧОМУ `/about` ЗВІДСИ ПІШЛА. CAMP-365 забрала її текст у CMS, тож
// компонент став асинхронним і малюється лише з відповіддю API —
// синхронний `renderComponent` на ньому падає «A component suspended
// while responding to synchronous input».
//
// Твердження не викинуті, а переїхали туди, де тепер є предмет:
// `tests/e2e/about.spec.ts` малює СПРАВЖНЮ сторінку з бази. Це сильніше
// за юніт: раніше тест доводив, що компонент містить рядок, а тепер —
// що читач цей рядок бачить.
//
// 🔴 Знайдено рецензією PR #302, а не мною: я прогнав ЛИШЕ ті тести, що
// написав сам, і зламав файл, якого не відкривав. Увесь проєкт `unit`
// на тому коміті давав 1871 passed / 4 failed.

const contact = () => renderComponent(Contact, {});

test("відкривається й має власний заголовок", () => {
  expect(visibleText(contact())).toContain("Contact");
});

test("🔴 кожна має власні хлібні крихти, а не лише посилання «додому»", () => {
  // Правило карти сайту: кожна глибока сторінка це окремий лендинг.
  for (const [name, html, path] of [
    ["contact", contact(), "/contact"],
  ] as const) {
    expect(html, `${name}: немає BreadcrumbList`).toContain("BreadcrumbList");
    expect(html, `${name}: крихта не веде на себе`).toContain(path);
  }
});

test("🔴 має власну CTA", () => {
  expect(contact()).toContain('data-testid="contact-cta"');
  // І вона веде кудись конкретно, а не в порожнечу.
  expect(contact()).toContain(`mailto:${CONTACT_EMAIL}`);
});

test("🔴 контакти беруться з одного джерела, а не передруковуються", () => {
  // Друга копія адреси розійшлась би з першою на першій же правці.
  const html = contact();
  expect(html).toContain(CONTACT_EMAIL);
  expect(html).toContain(COMPANY.name);
  expect(html).toContain(COMPANY.city);
});

test("🔴 контактна сторінка каже, чого ми НЕ можемо", () => {
  // Інакше людина напише й чекатиме на бронювання або на правку в OSM.
  const said = visibleText(contact());
  expect(said).toContain("do not take bookings");
  expect(said).toContain("OpenStreetMap");
});

test("🔴 обидві є в карті сайту — інакше вони існують для нікого", () => {
  // Саме цього бракувало: сторінки були в карті сайту як намір, а в
  // переліку їх не було, бо й самих сторінок не було.
  //
  // 🔴 `STATIC_HUBS`, а не `hubUrls()`: друга ходить по індекс кемпінгів
  // і по гайди, тобто в мережу, і перевірка крізь неї падала б без
  // піднятого API — тобто доводила б доступність API, а не наявність
  // сторінки.
  const paths = STATIC_HUBS.map((u) => new URL(u.loc).pathname);
  expect(paths).toContain("/about");
  expect(paths).toContain("/contact");
});
