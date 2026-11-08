import { expect, test } from "@playwright/test";
import {
  HeaderFrame,
  ISLAND_GLASS,
  STACK_AFTER_PX,
  SiteHeaderFrame,
  isStacked,
} from "@/components/site-header-frame";
import { SiteHeader } from "@/components/site-chrome";
import type { NavItem } from "@/lib/navigation";
import { renderClient, renderComponent } from "./render-component";

// CAMP-448 (2/2) — острів у шапці: розмітка є, і її веде стан.
//
// 🔴 ЩО ЦЕЙ ФАЙЛ МОЖЕ ДОВЕСТИ, А ЩО НІ. Статичний рендер не прокручує
// вікно, тож «на скролі стан перемикається» тут не перевіряється — це
// робить `tests/e2e/header-island.spec.ts` у чотирьох проєктах. Тут —
// те, що читач отримує в HTML у КОЖНОМУ зі станів, і сам поріг: обидва
// боки, бо «острів є при stacked=true» без «острова немає при false»
// задовольнив би й каркас, який малює острів завжди.
//
// Числа острова — теми Fuse (`fuse 1.0.1.zip`, `assets/main.build.css`),
// селектори названо в site-header-frame.tsx. Тут вони стверджуються як
// контракт: 480px, радіус 16px (`rounded-card` = `--r`), скло
// `blur(8px) saturate(200%)` на `rgba(35,35,35,.8)`.

const PROBE = "island-probe-child";

const NAV: NavItem[] = [
  { href: "/map", label: "Map", children: [] },
  {
    href: "/tools",
    label: "Tools",
    children: [{ href: "/tools/camper-trip-cost", label: "Trip cost", children: [] }],
  },
];

const openTag = (html: string, testId: string): string =>
  new RegExp(`<[a-z]+\\b[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ??
  "";

test.describe("🔴 CAMP-448 — поріг острова", () => {
  test("поріг — число теми: будь-яке прокручування стискає, самий верх розгортає", () => {
    // `headerTopPositionHandler`: `window.scrollY <= 0` → верх, інакше острів.
    expect(STACK_AFTER_PX).toBe(0);
    expect(isStacked(0), "на самому верху острова бути не має").toBe(false);
    // iOS тягне `scrollY` у мінус при відскоку — це теж «верх».
    expect(isStacked(-40), "відскок угору — не прокручування").toBe(false);
    expect(isStacked(1), "один піксель — уже острів, як у теми").toBe(true);
    expect(isStacked(4079)).toBe(true);
  });
});

test.describe("🔴 CAMP-448 — каркас у двох станах", () => {
  test("смуга: на всю ширину, з лінією, зі склом смуги, без острова", () => {
    const html = renderComponent(HeaderFrame, { stacked: false, children: PROBE });
    const header = openTag(html, "site-header");
    const bar = openTag(html, "site-header-bar");
    const glass = openTag(html, "site-glass");

    expect(header).toContain('data-stacked="false"');
    expect(header, "`sticky top-0` — рішення CAMP-374, і воно лишається").toMatch(
      /class="[^"]*\bsticky\b[^"]*\btop-0\b/,
    );
    expect(bar).toContain("w-full");
    expect(bar).toContain("border-line-2");
    expect(bar).not.toContain("max-w-[480px]");
    expect(bar).not.toContain("rounded-card");
    expect(glass).toContain("ct-glass");
    expect(glass, "у смузі скло острова не має бути інлайном").not.toContain(
      "backdrop-filter",
    );
    expect(html).toContain("max-w-wrap");
    expect(html).toContain(PROBE);
  });

  test("острів: 480px по центру, радіус теми, темне скло, лінія прозора, ряд 8px", () => {
    const html = renderComponent(HeaderFrame, { stacked: true, children: PROBE });
    const header = openTag(html, "site-header");
    const bar = openTag(html, "site-header-bar");
    const glass = openTag(html, "site-glass");

    expect(header).toContain('data-stacked="true"');
    // Острів живе ВСЕРЕДИНІ sticky: сам <header> не змінив позиціювання.
    expect(header).toMatch(/class="[^"]*\bsticky\b[^"]*\btop-0\b/);

    for (const cls of [
      "max-w-[480px]",
      "mx-auto",
      "rounded-card",
      "w-[calc(100%-8px)]",
      "xl:w-[calc(100%-24px)]",
      "top-1",
      "xl:top-3",
      "border-transparent",
    ]) {
      expect(bar, `в острові немає ${cls}`).toContain(cls);
    }
    expect(bar).not.toContain("w-full ");
    expect(bar).not.toContain("border-line-2");

    // Скло теми — дослівно `.bg-glass-dark` і `stacked_bg`.
    expect(glass).not.toContain("ct-glass");
    expect(glass).toContain("rounded-[inherit]");
    expect(glass).toContain("backdrop-filter:blur(8px) saturate(200%)");
    expect(glass).toContain("background-color:rgba(35, 35, 35, 0.8)");
    expect(ISLAND_GLASS.boxShadow).toContain("0px 6px 16px 0px");

    expect(html).not.toContain("max-w-wrap");
    expect(html).toMatch(/class="relative flex min-h-\[62px\][^"]*\bpx-2\b/);
    expect(html).toContain(PROBE);
  });

  // 🔴 Без цього обидва тести вище були б зелені й тоді, коли проп
  // ігнорується, а стан вшито: кожен дивиться лише на свій бік.
  test("два стани — два різні HTML, і різняться вони лише островом", () => {
    const top = renderComponent(HeaderFrame, { stacked: false, children: PROBE });
    const island = renderComponent(HeaderFrame, { stacked: true, children: PROBE });
    expect(top).not.toBe(island);
    // Те, що НЕ сміє змінюватись: sticky, шар скла під вмістом, висота ряду.
    for (const same of ["sticky top-0", 'data-testid="site-glass"', "min-h-[62px]"]) {
      expect(top).toContain(same);
      expect(island).toContain(same);
    }
  });

  test("перший кадр для читача — смуга: на сервері прокручування немає", () => {
    const html = renderClient(SiteHeaderFrame, { children: PROBE });
    expect(openTag(html, "site-header")).toContain('data-stacked="false"');
    expect(html).toContain("ct-glass");
    expect(html).toContain(PROBE);
  });
});

// 🔴 КОНТРАКТ МІЖ КАРКАСОМ І ВМІСТОМ. Меню, лого й бургер живуть у
// site-chrome.tsx і site-nav-drawer.tsx і читають стан через
// `group-data-[stacked=true]/header:*`. Якщо хтось перейменує атрибут у
// каркасі або прибере `group/header`, меню перестане ховатись в острові,
// а бургер — зʼявлятись, і жоден тест вище цього не побачить.
test.describe("🔴 CAMP-448 — вміст шапки читає стан каркаса", () => {
  test("атрибут один і той самий з обох боків", () => {
    const html = renderComponent(SiteHeader, { nav: NAV });
    const header = openTag(html, "site-header");
    expect(header).toContain("group/header");
    expect(header).toContain('data-stacked="false"');

    const nav = /<nav aria-label="Main"[^>]*>/.exec(html)?.[0] ?? "";
    expect(nav, "меню не ховається в острові").toContain(
      "group-data-[stacked=true]/header:hidden",
    );
    expect(nav, "межа 1200 px лишається").toContain("xl:block");

    const burger = openTag(html, "burger-open");
    expect(burger, "бургер не зʼявляється в острові від 1200 px").toContain(
      "group-data-[stacked=true]/header:grid",
    );
    expect(burger, "межа 1200 px лишається").toContain("xl:hidden");
    // Кольори кнопки в острові — теми: білий на темному склі.
    expect(burger).toContain("group-data-[stacked=true]/header:bg-[#fff]");

    const logo = /<a\b[^>]*href="\/"[^>]*>/.exec(html)?.[0] ?? "";
    expect(logo, "підпис лого не світлішає на темному склі").toContain(
      "group-data-[stacked=true]/header:text-[#fff]",
    );
  });

  test("<noscript> і правила без JS лишились у шапці", () => {
    const html = renderComponent(SiteHeader, { nav: NAV });
    expect(html).toContain("<noscript>");
    expect(html).toContain("header nav[aria-label='Main'] { display: block !important }");
  });
});
