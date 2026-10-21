import { expect, test } from "@playwright/test";
import { renderComponent } from "./render-component";
import {
  PageSections,
  SECTION_TYPES,
  assertAllSectionsUsed,
  cardsOf,
} from "@/components/page-sections";
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

// ── картки: що саме падає, а що малюється ──────────────────────────────
//
// 🔴 Усі чотири випадки нижче знайшла рецензія #304, і всі вони раніше
// НЕ падали: обʼєкт замість масиву ставав порожнім переліком, а порожні
// `terms` — порожніми `<dt>`/`<dd>`. Тобто «падає тут, а не малює дірку»
// було неправдою саме для найімовірніших поломок.

const card = (over: Record<string, unknown> = {}) => ({
  title: "Назва",
  href: "/tools/x",
  body: "Текст",
  ...over,
});

test("🔴 `items` обʼєктом замість масиву — поломка, а не порожньо", () => {
  // Звичайний наслідок правки jsonb у Directus: масив стає {"0":{…}}.
  expect(() => cardsOf({ "0": card() }, "тест")).toThrow(/не масив/);
  expect(() => cardsOf(null, "тест")).toThrow(/не масив/);
});

test("порожній масив — це порожньо, і це нормально", () => {
  expect(cardsOf([], "тест")).toEqual([]);
});

test("🔴 картка без обовʼязкового поля падає, називаючи поле", () => {
  for (const k of ["title", "href", "body"]) {
    const bad = card({ [k]: "" });
    expect(() => cardsOf([bad], "тест"), `порожнє «${k}» пропущено`).toThrow(
      new RegExp(`«${k}»`),
    );
  }
});

test("🔴 порожній `terms` не стає порожніми рядками списку", () => {
  expect(() => cardsOf([card({ terms: [{}] })], "тест")).toThrow(/«term»/);
  expect(() => cardsOf([card({ terms: ["junk"] })], "тест")).toThrow(/«term»/);
  expect(() => cardsOf([card({ terms: "не масив" })], "тест")).toThrow(
    /не масив/,
  );
});

test("🔴 картка веде лише на нашу сторінку", () => {
  for (const href of [
    "https://evil.example",
    "javascript:alert(1)",
    "//evil",
  ]) {
    expect(() => cardsOf([card({ href })], "тест")).toThrow(/лише на наші/);
  }
});

test("справна картка проходить і зберігає рядки", () => {
  const out = cardsOf(
    [card({ terms: [{ term: "Дає", text: "Число" }] })],
    "тест",
  );
  expect(out).toHaveLength(1);
  expect(out[0].terms).toEqual([{ term: "Дає", text: "Число" }]);
});

// 🔴 CAMP-365 — підстановки в `items`, яких не робив ніхто.
//
// Заміряно рецензією #306 на справжній головній: крок із текстом
// «Write to {{contact.email}}» друкувався ЧИТАЧЕВІ дослівно, а
// невідомий ключ друкувався замість кидати. `applyValues` покриває
// `title`, `metaTitle`, `metaDescription`, `heading` і `ctaHref`,
// `body` розгортає `RichText`, а `items` не чіпав ніхто — і червоне
// твердження у файлі («мова одна… невідомий ключ кидає тут так само,
// як усюди») було хибним саме для них.
test.describe("🔴 підстановки доходять і в items", () => {
  const steps = (term: string, text: string) =>
    section({
      type: "steps",
      heading: "Як це працює",
      items: [{ term, text }],
    });

  test("відомий ключ у кроці розгортається, а не друкується", () => {
    const html = renderComponent(PageSections, {
      sections: [steps("Напишіть", "Write to {{contact.email}}")],
    });
    expect(html, "підстановка поїхала читачеві дослівно").not.toContain("{{");
    expect(html, "значення не підставилось").toContain("@");
  });

  test("підстановка в НАЗВІ кроку теж розгортається", () => {
    const html = renderComponent(PageSections, {
      sections: [steps("{{company.name}}", "текст")],
    });
    expect(html).not.toContain("{{");
  });

  // 🔴 Пара: «не містить {{» істинне й тоді, коли не друкується нічого.
  // Невідомий ключ мусить КИНУТИ, як усюди.
  test("🔴 невідомий ключ у кроці кидає, а не малює сміття", () => {
    expect(() =>
      renderComponent(PageSections, {
        sections: [steps("Назва", "{{no_such_key}}")],
      }),
    ).toThrow(/no_such_key/);
  });

  test("🔴 невідомий ключ у картці теж кидає", () => {
    expect(() =>
      cardsOf(
        [
          {
            title: "т",
            href: "/x",
            body: "{{no_such_key}}",
            terms: [],
          },
        ],
        "картках",
      ),
    ).toThrow(/no_such_key/);
  });
});

// 🔴 CAMP-365 — зайва секція не зникає мовчки.
test.describe("🔴 секція, якій немає місця в макеті", () => {
  test("кидає й називає тип", () => {
    expect(() =>
      assertAllSectionsUsed(
        [section({ type: "hero" }), section({ type: "prose" })],
        ["hero", "steps"],
        "головна",
      ),
    ).toThrow(/prose/);
  });

  test("кілька зайвих — названі всі, а не перша", () => {
    let message = "";
    try {
      assertAllSectionsUsed(
        [section({ type: "cards" }), section({ type: "cta" })],
        ["hero"],
        "головна",
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("cards");
    expect(message, "названо лише перший зайвий тип").toContain("cta");
  });

  // 🔴 Пара: без неї «кидає» було б істинним і для функції, що кидає
  // завжди — тобто перевірка не відрізняла б зайвого від звичайного.
  test("перелік рівно з дозволених не кидає", () => {
    expect(() =>
      assertAllSectionsUsed(
        [section({ type: "hero" }), section({ type: "steps" })],
        ["hero", "steps"],
        "головна",
      ),
    ).not.toThrow();
  });

  test("порожній перелік секцій не кидає", () => {
    expect(() => assertAllSectionsUsed([], ["hero"], "головна")).not.toThrow();
  });
});
