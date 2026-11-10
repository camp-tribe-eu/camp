import { expect, test } from "@playwright/test";

import { PageSections } from "@/components/page-sections";
import type { SectionView } from "@/lib/page-content";
import { FUEL_COUNTRIES } from "@/lib/fuel";
import { renderComponent } from "./render-component";

/**
 * CAMP-458 — вигляд /tools: значки на картках і прапори біля 27 країн.
 *
 * 🔴 ЗНАЧОК ТУТ — НЕ ПРИКРАСА, А ТВЕРДЖЕННЯ ПРО АДРЕСУ. Він вибирається
 * кодом за `href` картки, тож картка, що веде кудись інде, мусить
 * лишитись БЕЗ значка: типовий значок на незнайомій адресі бреше тихо.
 */

const section = (over: Partial<SectionView>): SectionView => ({
  type: "prose",
  variant: null,
  slot: null,
  heading: null,
  subheading: null,
  body: null,
  imageUrl: null,
  imageAlt: null,
  ctaHref: null,
  ctaLabel: null,
  items: [],
  ...over,
});

const card = (href: string) => ({
  title: `Card ${href}`,
  href,
  body: "Body.",
});

const cardsHtml = (hrefs: string[]) =>
  renderComponent(PageSections, {
    sections: [section({ type: "cards", items: hrefs.map(card) })],
  });

/** Значків рахуємо ЕЛЕМЕНТИ: `<svg width="28"` малює лише ця карта. */
const iconCount = (html: string) =>
  (html.match(/<svg width="28"/g) ?? []).length;

test("🔴 відома адреса дістає значок, незнайома — ні", () => {
  expect(iconCount(cardsHtml(["/tools/camper-trip-cost"]))).toBe(1);
  expect(iconCount(cardsHtml(["/tools/camper-packing-list"]))).toBe(1);
  expect(iconCount(cardsHtml(["/tools/camper-trip-cost", "/tools/camper-packing-list"]))).toBe(2);

  // Інша НАША сторінка — картка лишається, значка немає.
  const other = cardsHtml(["/map"]);
  expect(other).toContain("Card /map");
  expect(iconCount(other)).toBe(0);

  // 🔴 І ОБГОРТКИ ТЕЖ НЕМАЄ, А НЕ «ПОРОЖНЯ».
  //
  // Мутація «малювати значок на будь-якій адресі» спершу лишилась
  // зеленою: `CARD_ICONS["/map"]` це `undefined`, тож усередині
  // не малюється нічого — і лічильник `<svg>` не ворухнувся. Але
  // порожній `<span>` у картці з `gap-4` зсуває весь текст на 16 px
  // управо. Тобто дефект видимий, а тест його не бачив.
  expect(other).not.toContain('class="shrink-0 text-heading"');
});

test("🔴 значок прихований від читача екрана, бо назва вже є текстом", () => {
  const html = cardsHtml(["/tools/camper-trip-cost"]);
  expect(html).toContain('<span class="shrink-0 text-heading" aria-hidden="true">');
});

const fuelHtml = () =>
  renderComponent(PageSections, {
    sections: [
      section({
        type: "fuel-countries",
        heading: "Fuel prices, country by country",
      }),
    ],
  });

test("🔴 прапор стоїть біля КОЖНОЇ з 27 країн, а не біля кількох", () => {
  const html = fuelHtml();
  // Знаменник названий: скільки країн у джерелі, стільки й прапорів.
  expect(FUEL_COUNTRIES.length).toBe(27);
  expect((html.match(/class="ct-flag"/g) ?? []).length).toBe(
    FUEL_COUNTRIES.length,
  );
  expect((html.match(/class="ct-fuel-country"/g) ?? []).length).toBe(
    FUEL_COUNTRIES.length,
  );
});

test("🔴 назва країни лишається текстом, а не замінена прапором", () => {
  const html = fuelHtml();
  for (const name of ["Austria", "Croatia", "Spain"]) {
    expect(html, `назви «${name}» немає`).toContain(name);
  }
});

test("🔴 прапор мовчить для читача екрана — назва поруч уже сказана", () => {
  // `Flag` віддає порожній alt; диктор не має казати «Flag of Croatia
  // Croatia». Перевіряємо саме відданий HTML, а не памʼять про компонент.
  const html = fuelHtml();
  expect((html.match(/class="ct-flag" src="[^"]+" alt=""/g) ?? []).length).toBe(
    FUEL_COUNTRIES.length,
  );
});
