import { expect, test } from "@playwright/test";
import { renderComponent } from "./render-component";
import { PageSections, SECTION_TYPES } from "@/components/page-sections";
import type { SectionView } from "@/lib/page-content";

const section = (over: Partial<SectionView>): SectionView => ({
  type: "prose",
  variant: null,
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

test("секція тексту малює тіло", () => {
  const html = renderComponent(PageSections, {
    sections: [section({ body: "Абзац із [посиланням](/map)." })],
  });
  expect(html).toContain("Абзац із");
  expect(html).toContain('href="/map"');
});

test("секція заклику малює кнопку з підписом", () => {
  const html = renderComponent(PageSections, {
    sections: [section({ type: "cta", ctaHref: "/map", ctaLabel: "Туди" })],
  });
  expect(html).toContain('href="/map"');
  expect(html).toContain("Туди");
});

// 🔴 ГОЛОВНЕ ТВЕРДЖЕННЯ ЦЬОГО ФАЙЛА.
//
// `page_sections.type` це varchar без CHECK — саме так CAMP-362 і
// обіцяла «новий тип без міграції». Ціна обіцянки: база може віддати
// тип, якого рендер не знає. Мовчазний `return null` зробив би з цього
// найгірше: власник бачить секцію в адмінці й не бачить на сайті.
test("🔴 невідомий тип падає гучно, а не зникає мовчки", () => {
  expect(() =>
    renderComponent(PageSections, {
      sections: [section({ type: "timeline" })],
    }),
  ).toThrow(/невідомий тип секції «timeline»/);
});

test("🔴 перелік відомих типів не порожній і названий у помилці", () => {
  // 🔴 ПЕРША РЕДАКЦІЯ ЦЬОГО ТЕСТУ БУЛА ПОРОЖНЬОЮ.
  //
  // Твердження стояли ВСЕРЕДИНІ `catch`, без жодної перевірки, що
  // кидок узагалі стався. Рецензія заміряла: заміна `throw` на
  // `return null` лишала цей тест зеленим над НУЛЕМ перевірок — тобто
  // він підтверджував сам факт свого запуску, і нічого більше.
  expect(SECTION_TYPES.length).toBeGreaterThan(1);

  let msg = "";
  try {
    renderComponent(PageSections, { sections: [section({ type: "nope" })] });
  } catch (e) {
    msg = String(e);
  }

  // Пара до циклу нижче: без неї порожній `msg` задовольнив би все.
  expect(msg, "рендер не кинув на невідомий тип").not.toBe("");
  for (const t of SECTION_TYPES) expect(msg).toContain(t);
});
