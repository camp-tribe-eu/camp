import { expect, test } from "@playwright/test";

import { SiteHeader } from "@/components/site-chrome";
import { LOCALES, liveLocales } from "@/lib/i18n";
import { megaColumns, isMega } from "@/lib/mega-menu";
import { COUNTRY_GROUP, withCountryGroups } from "@/lib/nav-groups";
import type { NavItem } from "@/lib/navigation";
import { renderComponent } from "./render-component";
import { visibleText } from "./rendered-text";

/**
 * CAMP-448 — мега-меню, лупа, вхід і мова в шапці.
 *
 * 🔴 КОЖНЕ ТВЕРДЖЕННЯ ЧИТАЄ ВІДДАНИЙ HTML (`renderComponent` → рядок), а не
 * константу, клас чи `sr-only`. «Країна є в меню» означає, що в розмітці
 * шапки є `<a href="/camping/hr">` з видимим підписом, а не що функція
 * повернула масив.
 */

const MAP: NavItem = { href: "/map", label: "Map", children: [] };
const SEARCH: NavItem = { href: "/search", label: "Search", children: [] };
const CAMPING: NavItem = { href: "/camping", label: "Campsites", children: [] };
const RENTAL: NavItem = {
  href: "/camper-rental",
  label: "Camper rental",
  children: [
    { href: "/camper-rental/providers", label: "Rental companies", children: [] },
  ],
};
const TOOLS: NavItem = {
  href: "/tools",
  label: "Tools",
  children: [
    { href: "/tools/camper-trip-cost", label: "Trip cost calculator", children: [] },
    { href: "/tools/camper-packing-list", label: "Packing list", children: [] },
  ],
};

const COUNTRIES = [
  { code: "hr", name: "Croatia" },
  { code: "si", name: "Slovenia" },
  { code: "fr", name: "France" },
];

const links = (html: string) =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(
    (m) => ({ href: m[1], text: visibleText(m[2]) }),
  );

/** Горизонтальне меню шапки — без шухляди, яка теж усередині `<header>`. */
function mainNav(html: string): string {
  const m = /<nav aria-label="Main"[^>]*>([\s\S]*?)<\/nav>/.exec(html);
  expect(m, "у шапці немає nav[aria-label=Main]").not.toBeNull();
  return m![1];
}

const withData = (nav: NavItem[]) =>
  withCountryGroups(nav, { camping: COUNTRIES, rental: COUNTRIES });

test.describe("🔴 CAMP-448 — країни добудовуються з даних", () => {
  test("Campsites і Camper rental дістають країни; решта пунктів — за посиланням", () => {
    const out = withData([MAP, CAMPING, TOOLS, RENTAL]);
    expect(out[0]).toBe(MAP);
    expect(out[2]).toBe(TOOLS);
    expect(out[1].children.map((c) => c.href)).toEqual([
      "/camping/hr",
      "/camping/si",
      "/camping/fr",
    ]);
    // Діти з бази лишаються першими, країни йдуть за ними.
    expect(out[3].children.map((c) => c.href)).toEqual([
      "/camper-rental/providers",
      "/camper-rental/hr",
      "/camper-rental/si",
      "/camper-rental/fr",
    ]);
    expect(out[1].children.every((c) => c.group === COUNTRY_GROUP && c.flag)).toBe(true);
  });

  test("🔴 даних немає — пункт той самий обʼєкт, а не пункт із порожньою групою", () => {
    const out = withCountryGroups([CAMPING, RENTAL], { camping: [], rental: [] });
    expect(out[0]).toBe(CAMPING);
    expect(out[1]).toBe(RENTAL);
  });

  test("дубль коду в джерелі дає один рядок", () => {
    const out = withCountryGroups([CAMPING], {
      camping: [COUNTRIES[0], COUNTRIES[0]],
      rental: [],
    });
    expect(out[0].children).toHaveLength(1);
  });

  test("мега, коли діти згруповані, вкладені або їх сім і більше; інакше простий розкривач", () => {
    expect(isMega(TOOLS), "два пункти — простий розкривач").toBe(false);
    expect(isMega(CAMPING)).toBe(false);
    expect(isMega(withData([CAMPING])[0])).toBe(true);
    const seven: NavItem = {
      href: "/x",
      label: "X",
      children: Array.from({ length: 7 }, (_, i) => ({
        href: `/x/${i}`,
        label: `X${i}`,
        children: [],
      })),
    };
    expect(isMega(seven)).toBe(true);
    const nested: NavItem = {
      href: "/n",
      label: "N",
      children: [
        {
          href: "/n/a",
          label: "A",
          children: [{ href: "/n/a/1", label: "A1", children: [] }],
        },
      ],
    };
    expect(isMega(nested)).toBe(true);
    expect(megaColumns(nested)).toEqual([
      { title: "A", href: "/n/a", items: nested.children[0].children },
    ]);
  });
});

test.describe("🔴 CAMP-448 — мега-меню в розмітці шапки", () => {
  const html = renderComponent(SiteHeader, {
    nav: withData([MAP, CAMPING, RENTAL, TOOLS]),
  });
  const nav = mainNav(html);

  test("країни — звичайні посилання з видимою назвою й прапорцем", () => {
    for (const c of COUNTRIES) {
      expect(links(nav)).toContainEqual({
        href: `/camping/${c.code}`,
        text: c.name,
      });
      expect(nav, `прапор ${c.code} не намальований`).toContain(
        `/flags/${c.code}.svg`,
      );
    }
  });

  test("мега-панель має заголовок групи, а проста — ні", () => {
    const camping = /data-nav-parent="\/camping"[\s\S]*?<\/li>/.exec(nav)![0];
    expect(camping).toContain('data-nav-kind="mega"');
    // Закрита панель схована (`invisible`), тож «видимий текст» порожній
    // за побудовою — читаємо розмітку, а не видимість.
    expect(camping).toContain(`>${COUNTRY_GROUP}<`);
    const tools = /data-nav-parent="\/tools"[\s\S]*?<\/li>/.exec(nav)![0];
    expect(tools).toContain('data-nav-kind="dropdown"');
    expect(tools).not.toContain(COUNTRY_GROUP);
  });

  test("мега-панель закрита за замовчуванням і стоїть від ряду шапки, не від пункту", () => {
    const panel = /<div\b[^>]*data-nav-sub[^>]*>/.exec(
      /data-nav-parent="\/camping"[\s\S]*?<\/li>/.exec(nav)![0],
    )![0];
    expect(panel).toContain("invisible");
    expect(panel).toMatch(/\binset-x-4\b/);
    // `<li>` мега-пункту НЕ `relative`: інакше панель рахувалась би від
    // нього й стирчала б за край вікна.
    const li = /<li\b[^>]*data-nav-parent="\/camping"[^>]*>/.exec(nav)![0];
    expect(li).not.toMatch(/\brelative\b/);
  });
});

test.describe("🔴 CAMP-448 — лупа, вхід, мова", () => {
  test("пошук — іконка: підпис у aria-label, а не видимим словом", () => {
    const nav = mainNav(renderComponent(SiteHeader, { nav: [MAP, SEARCH] }));
    const a = /<a\b[^>]*data-testid="header-search"[^>]*>([\s\S]*?)<\/a>/.exec(nav);
    expect(a, "лупи немає").not.toBeNull();
    expect(a![0]).toContain('aria-label="Search"');
    expect(a![0]).toContain('href="/search"');
    expect(visibleText(a![1]), "слово «Search» лишилось видимим").toBe("");
  });

  test("🔴 лупа — остання в ряду, хоч у базі вона третя", () => {
    const nav = mainNav(
      renderComponent(SiteHeader, { nav: [SEARCH, MAP, TOOLS] }),
    );
    const hrefs = links(nav).map((l) => l.href);
    expect(hrefs[hrefs.length - 1]).toBe("/search");
  });

  test("пункт Search, знятий у CMS, забирає й лупу", () => {
    const html = renderComponent(SiteHeader, { nav: [MAP] });
    expect(html).not.toContain('data-testid="header-search"');
  });

  test("вхід — посилання на /account з підписом для читача екрана", () => {
    const html = renderComponent(SiteHeader, { nav: [MAP] });
    const a = /<a\b[^>]*data-testid="header-account"[^>]*>/.exec(html);
    expect(a, "входу в шапці немає").not.toBeNull();
    expect(a![0]).toContain('href="/account"');
    expect(a![0]).toContain('aria-label="Account"');
  });

  test("🔴 мова: у шапці рівно живі мови з конфігурації, неживі не показуються", () => {
    const dead = LOCALES.filter((l) => !l.live);
    expect(dead.length, "премиса: у конфігурації є неживі мови").toBeGreaterThan(0);

    const html = renderComponent(SiteHeader, { nav: [MAP] });
    const switcher = /data-testid="language-switch-header"[\s\S]*?<\/ul>/.exec(html);
    expect(switcher, "перемикача мови в шапці немає").not.toBeNull();
    const langs = [...switcher![0].matchAll(/hrefLang="([^"]+)"/gi)].map((m) => m[1]);
    expect(langs).toEqual(liveLocales().map((l) => l.code));
    for (const l of dead) {
      expect(switcher![0], `нежива мова ${l.code} показана`).not.toContain(
        `hrefLang="${l.code}"`,
      );
      expect(switcher![0], `підпис ${l.label} показаний`).not.toContain(l.label);
    }
  });

  test("мова з прапорцем: знак ЄС для англійської, файл країни для решти", () => {
    const html = renderComponent(SiteHeader, {
      nav: [MAP],
      locales: [LOCALES[0], LOCALES[1]],
    });
    const switcher = /data-testid="language-switch-header"[\s\S]*?<\/ul>/.exec(html)![0];
    expect(switcher).toContain("<svg");
    expect(switcher).toContain("/flags/nl.svg");
    expect(switcher).toContain(">Nederlands<");
  });

  test("без жодної живої мови перемикача немає зовсім", () => {
    const html = renderComponent(SiteHeader, { nav: [MAP], locales: [] });
    expect(html).not.toContain("language-switch");
  });
});
