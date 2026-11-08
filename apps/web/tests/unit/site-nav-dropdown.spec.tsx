/**
 * CAMP-448 (1/2) — шапка й шухляда читають `children`.
 *
 * 🔴 ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ. Ієрархія меню була підтримана наскрізь — схема,
 * API, тип — а `site-chrome.tsx` робив `nav.map((item) => <Link>)` і дітей
 * не читав. Підпункт, заведений у базі, не зʼявлявся без помилки, і саме так
 * три готові сторінки прожили невидимими. Жоден тест цього не ловив, бо
 * жоден не давав шапці пункт із дітьми.
 *
 * 🔴 КОЖНЕ ТВЕРДЖЕННЯ ЧИТАЄ ВИДАНИЙ HTML — не константу, не клас, не
 * `data-testid`. «Дитина намальована» означає, що в розмітці є `<a href>` з
 * її адресою і видимим підписом; «розкривач є» — що є `<button aria-expanded
 * aria-controls>`, і `aria-controls` вказує на елемент, у якому лежать саме
 * ці посилання.
 */
import { expect, test } from "@playwright/test";

import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import type { NavItem } from "@/lib/navigation";
import { renderComponent } from "./render-component";
import { visibleText } from "./rendered-text";

const TOOLS: NavItem = {
  href: "/tools",
  label: "Tools",
  children: [
    { href: "/tools/camper-trip-cost", label: "Trip cost calculator", children: [] },
    { href: "/tools/camper-packing-list", label: "Packing list", children: [] },
  ],
};
const MAP: NavItem = { href: "/map", label: "Map", children: [] };
const NAV: NavItem[] = [MAP, TOOLS];

/** Усі `<a href>` з видимим текстом. */
function links(html: string): { href: string; text: string }[] {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(
    (m) => ({ href: m[1], text: visibleText(m[2]) }),
  );
}

/** Усі `<button …>` з їхніми атрибутами. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button\b([^>]*)>/g)].map((m) => m[1]);
}

/** Горизонтальне меню шапки — без шухляди, яка теж усередині `<header>`. */
function mainNav(html: string): string {
  const m = /<nav aria-label="Main"[^>]*>([\s\S]*?)<\/nav>/.exec(html);
  expect(m, "у шапці немає nav[aria-label=Main]").not.toBeNull();
  return m![1];
}

test.describe("🔴 CAMP-448 — пункт із дітьми в шапці", () => {
  test("дає розкривач: кнопку з aria-expanded і aria-controls на список дітей", () => {
    const nav = mainNav(renderComponent(SiteHeader, { nav: NAV }));

    const toggles = buttons(nav).filter((b) => /\baria-expanded=/.test(b));
    expect(toggles, "розкривача немає — діти нікуди не ведуть").toHaveLength(1);

    const [toggle] = toggles;
    expect(toggle, "розкривач має бути закритим за замовчуванням").toContain(
      'aria-expanded="false"',
    );
    // Підпис для читача екрана: стан каже `aria-expanded`, назву — сам
    // пункт, і вона мусить бути НАЗВАНА, а не «button».
    expect(toggle).toContain('aria-label="Tools submenu"');

    const controls = /aria-controls="([^"]+)"/.exec(toggle)?.[1];
    expect(controls, "aria-controls не вказує нікуди").toBeTruthy();

    // Елемент, на який указує aria-controls, існує і містить рівно дітей.
    const panel = new RegExp(
      `<div\\b[^>]*\\bid="${controls}"[^>]*>([\\s\\S]*?)</ul>`,
    ).exec(nav);
    expect(panel, `елемента з id="${controls}" у шапці немає`).not.toBeNull();
    expect(links(panel![1])).toEqual(
      TOOLS.children.map((c) => ({ href: c.href, text: c.label })),
    );
  });

  test("батько лишається посиланням на власну сторінку, а не лише перемикачем", () => {
    const nav = mainNav(renderComponent(SiteHeader, { nav: NAV }));
    const tools = links(nav).filter((l) => l.href === "/tools");
    expect(tools).toEqual([{ href: "/tools", text: "Tools" }]);
  });

  test("пункт без дітей — звичайне посилання, без кнопки й без панелі", () => {
    const nav = mainNav(renderComponent(SiteHeader, { nav: [MAP] }));
    expect(links(nav)).toEqual([{ href: "/map", text: "Map" }]);
    expect(buttons(nav), "у пункту без дітей зʼявилась кнопка").toEqual([]);
    expect(nav).not.toContain("aria-expanded");
    expect(nav).not.toContain("data-nav-sub");
  });

  // 🔴 ПАРА ДО ПЕРШОГО ТЕСТУ. «Рівно один розкривач» над меню з одним
  // батьком не відрізняє «малюю розкривач кожному, хто має дітей» від
  // «малюю розкривач завжди першому». Два батьки й один бездітний між ними.
  test("розкривачів рівно стільки, скільки пунктів із дітьми", () => {
    const rental: NavItem = {
      href: "/camper-rental",
      label: "Camper rental",
      children: [{ href: "/camper-rental/providers", label: "Rental companies", children: [] }],
    };
    const nav = mainNav(renderComponent(SiteHeader, { nav: [TOOLS, MAP, rental] }));
    const toggles = buttons(nav).filter((b) => /\baria-expanded=/.test(b));
    expect(toggles).toHaveLength(2);
    expect(toggles.map((b) => /aria-label="([^"]+)"/.exec(b)?.[1])).toEqual([
      "Tools submenu",
      "Camper rental submenu",
    ]);
    // Два різні id — інакше aria-controls обох кнопок вели б на одну панель.
    const ids = toggles.map((b) => /aria-controls="([^"]+)"/.exec(b)?.[1]);
    expect(new Set(ids).size).toBe(2);
  });

  test("закрита панель схована через visibility, а не вирізана з DOM", () => {
    // Без JS `<noscript>` повертає її на екран; читачеві екрана закрите
    // меню не зачитується; перехід на відкриття має від чого починатись.
    const nav = mainNav(renderComponent(SiteHeader, { nav: NAV }));
    const panel = /<div\b[^>]*data-nav-sub[^>]*>/.exec(nav)?.[0] ?? "";
    expect(panel).toContain("invisible");
    expect(panel).toContain("opacity-0");
    expect(nav).toContain('href="/tools/camper-trip-cost"');
  });
});

// 🔴 Шухляди тут НЕМАЄ навмисно: її панель рендериться лише відкритою,
// а статичний рендер відкрити не може. Дітей у шухляді доводить e2e
// `navigation.spec.ts` на `mobile-chrome` — там `flatten(body.header)` бере
// кожен підпункт із бази й шукає його посилання у відкритій шухляді.
test.describe("🔴 CAMP-448 — діти в підвалі", () => {
  test("підвал малює дітей одразу за батьком, у його порядку", () => {
    const html = renderComponent(SiteFooter, { nav: NAV });
    const more = /<nav aria-label="More"[^>]*>([\s\S]*?)<\/nav>/.exec(html);
    expect(more, "у підвалі немає nav[aria-label=More]").not.toBeNull();
    expect(links(more![1]).map((l) => l.href)).toEqual([
      "/map",
      "/tools",
      "/tools/camper-trip-cost",
      "/tools/camper-packing-list",
    ]);
  });
});
