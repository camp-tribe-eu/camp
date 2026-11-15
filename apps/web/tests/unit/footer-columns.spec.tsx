import { expect, test } from "@playwright/test";

import { SiteFooter } from "@/components/site-chrome";
import { LEGAL_PAGES, legalPath } from "@/lib/legal";
import { LOCALES } from "@/lib/i18n";
import type { NavItem } from "@/lib/navigation";
import { cleanSocialLinks } from "@/lib/site-settings";
import { renderComponent } from "./render-component";
import { visibleText } from "./rendered-text";

/**
 * CAMP-448 — підвал за Fuse: колонки з CMS, соцкнопки, фото-смуга, мова.
 *
 * 🔴 УСЕ ЧИТАЄТЬСЯ З ВІДДАНОГО HTML. «Соцкнопок немає» означає, що в
 * розмітці немає ні списку, ні заголовка, ні порожнього ряду — а не що
 * прапорець у пропсах `false`.
 */

const leaf = (href: string, label: string): NavItem => ({ href, label, children: [] });
const COLUMNS: NavItem[] = [
  {
    href: "/camping",
    label: "Campsites",
    children: [leaf("/map", "Map"), leaf("/routes", "Routes")],
  },
  {
    href: "/about",
    label: "CampTribe",
    children: [leaf("/blog", "Blog"), leaf("/contact", "Contact")],
  },
];

const hrefs = (html: string) =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);

test.describe("🔴 CAMP-448 — колонки підвалу з CMS", () => {
  const html = renderComponent(SiteFooter, { nav: COLUMNS });

  test("кожен корінь із дітьми — колонка: заголовок-посилання й діти за ним", () => {
    for (const col of COLUMNS) {
      const m = new RegExp(
        `<nav aria-label="${col.label}"[^>]*>([\\s\\S]*?)</nav>`,
      ).exec(html);
      expect(m, `колонки «${col.label}» немає`).not.toBeNull();
      expect(hrefs(m![1])).toEqual([col.href, ...col.children.map((c) => c.href)]);
      expect(visibleText(m![1])).toContain(col.label);
    }
  });

  test("🔴 корінь БЕЗ дітей не губиться: іде в колонку More", () => {
    const out = renderComponent(SiteFooter, {
      nav: [...COLUMNS, leaf("/lonely", "Lonely page")],
    });
    const more = /<nav aria-label="More"[^>]*>([\s\S]*?)<\/nav>/.exec(out);
    expect(more, "пункт без дітей зник із підвалу").not.toBeNull();
    expect(hrefs(more![1])).toEqual(["/lonely"]);
  });

  test("порожнє меню — без колонок і без «More»", () => {
    const out = renderComponent(SiteFooter, { nav: [] });
    expect(out).not.toContain('aria-label="More"');
    expect(out).not.toContain("data-footer-column");
  });
});

test.describe("🔴 CAMP-448 — правові посилання: кожне один раз", () => {
  const html = renderComponent(SiteFooter, { nav: COLUMNS });

  test("жодна адреса /legal/* не повторюється в підвалі", () => {
    const legal = hrefs(html).filter((h) => h.startsWith("/legal/"));
    expect(legal.length, "правових посилань немає зовсім").toBeGreaterThan(0);
    expect(
      legal.filter((h, i) => legal.indexOf(h) !== i),
      "правова адреса стоїть у підвалі двічі",
    ).toEqual([]);
  });

  test("усі правові сторінки на місці — і лише з LEGAL_PAGES", () => {
    const legal = hrefs(html).filter((h) => h.startsWith("/legal/")).sort();
    expect(legal).toEqual(LEGAL_PAGES.map((p) => legalPath(p.slug)).sort());
  });

  test("правила й походження даних — два різні списки", () => {
    const legalNav = /<nav aria-label="Legal"[^>]*>([\s\S]*?)<\/nav>/.exec(html)![1];
    const dataNav = /<nav aria-label="Data and sources"[^>]*>([\s\S]*?)<\/nav>/.exec(html)![1];
    expect(hrefs(dataNav)).toEqual(["/legal/attribution", "/legal/database"]);
    expect(hrefs(legalNav)).not.toContain("/legal/attribution");
    expect(hrefs(legalNav)).not.toContain("/legal/database");
  });

  test("атрибуція ODbL лишилась поруч із даними", () => {
    expect(html).toContain("OpenStreetMap contributors");
    expect(html).toContain("Open Database License");
  });
});

test.describe("🔴 CAMP-448 — соцкнопки: лише ті, що існують", () => {
  test("жодної мережі — блоку немає зовсім", () => {
    for (const links of [undefined, []]) {
      const out = renderComponent(SiteFooter, { nav: COLUMNS, socialLinks: links });
      expect(out).not.toContain("footer-social");
      expect(out).not.toContain("Social media");
    }
  });

  test("вписані мережі — кнопки з назвою для читача екрана й справжньою адресою", () => {
    const out = renderComponent(SiteFooter, {
      nav: COLUMNS,
      socialLinks: [
        { network: "instagram", url: "https://www.instagram.com/camptribe" },
        { network: "youtube", url: "https://www.youtube.com/@camptribe" },
      ],
    });
    const block = /data-testid="footer-social"[\s\S]*?<\/ul>/.exec(out);
    expect(block, "кнопок немає").not.toBeNull();
    expect(hrefs(block![0])).toEqual([
      "https://www.instagram.com/camptribe",
      "https://www.youtube.com/@camptribe",
    ]);
    expect(block![0]).toContain('aria-label="Instagram"');
    expect(block![0]).toContain('aria-label="YouTube"');
  });

  test("🔴 один зіпсований запис коштує одного запису: решта кнопок живі", () => {
    const cleaned = cleanSocialLinks([
      { network: "instagram", url: "https://www.instagram.com/camptribe" },
      { network: "facebook", url: "javascript:alert(1)" },
      { network: "tiktok", url: "http://tiktok.com/@x" },
      { network: "myspace", url: "https://myspace.com/x" },
      { network: "x", url: 42 },
      null,
      "рядок",
      { network: "linkedin", url: "not a url" },
      { network: "youtube", url: "https://www.youtube.com/@camptribe" },
    ]);
    expect(cleaned.map((l) => l.network)).toEqual(["instagram", "youtube"]);
    expect(cleanSocialLinks({ instagram: "https://x.y" })).toEqual([]);
    expect(cleanSocialLinks(undefined)).toEqual([]);
  });
});

test.describe("🔴 CAMP-448 — фото-смуга, мова, «вгору»", () => {
  const html = renderComponent(SiteFooter, { nav: COLUMNS });

  test("фото-смуга: напис, залитий фотографією; диктор його не читає вдруге", () => {
    const m = /<p\b[^>]*data-testid="footer-wordmark"[^>]*>([\s\S]*?)<\/p>/.exec(html);
    expect(m, "фото-смуги немає").not.toBeNull();
    expect(m![0]).toContain('aria-hidden="true"');
    // Зрячий читач її бачить (`aria-hidden` ховає лише від диктора).
    expect(visibleText(m![0])).toBe("CampTribe");
    // Стиль віддається в розмітці, і маска — справді фото, а не колір.
    expect(html).toContain("background-clip:text");
    expect(html).toMatch(/background-image:url\(\/banners\/[a-z-]+\.webp\)/);
  });

  test("мова в підвалі: лише живі, без неживих", () => {
    const dead = LOCALES.filter((l) => !l.live);
    const sw = /data-testid="language-switch-footer"[\s\S]*?<\/ul>/.exec(html);
    expect(sw, "перемикача мови в підвалі немає").not.toBeNull();
    for (const l of dead) expect(sw![0]).not.toContain(`hrefLang="${l.code}"`);
    expect(sw![0]).toContain('hrefLang="en"');
  });

  test("«вгору» — якір на #top", () => {
    expect(html).toMatch(/<a\b[^>]*href="#top"[^>]*data-testid="to-top"/);
  });
});
