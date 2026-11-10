import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./api-request";
import { visibleText } from "../unit/rendered-text";

// 🔴 ТОЙ САМИЙ ВИДОБУВАЧ ТЕКСТУ, ЩО Й У ЮНІТІ — І ЦЕ НЕ ЗРУЧНІСТЬ.
//
// Ці твердження прийшли з `thin-pages.spec.tsx`, де текст діставав
// `visibleText()`: він ставить пробіл на межі блокових тегів і не
// ставить на рядкових, тобто читає так, як бачить людина.
//
// Перенісши їх, я двічі змінив поверхню виміру й двічі отримав червоний
// CI:
//   • `innerText` — не бачить тексту `<option>` у закритому `<select>`,
//     тож «Campervan» зникав;
//   • `textContent` — бачить усе, але склеює вузли БЕЗ роздільника:
//     «…(Euro-super 95)VehicleCampervan…», і взірець `/\bVehicle\b/`
//     не знаходив межі слова. Заміряно на справжній розмітці:
//       склеєно    → "trol (Euro-super 95)VehicleCampe"  → false
//       visibleText → "rol (Euro-super 95) Vehicle Camp" → true
//
// Третьої копії видобування тут не буде: беремо наявну.

// CAMP-365 — /tools переїхала в CMS частково, і її сторожі переїхали
// разом із текстом.
//
// 🔴 ЧОМУ ВОНИ ТУТ, А НЕ ЛИШИЛИСЬ ЮНІТ-ТЕСТАМИ. Сторінка стала
// асинхронною: текст приходить із бази, тож синхронний рендер на ній
// падає. Переїзд зробив їх сильнішими — вони читають те, що бачить
// читач, а не те, що містить компонент.
//
// 🔴 І ЧОМУ ЇХ НЕ МОЖНА БУЛО ПРОСТО ВИКИНУТИ. Текст цієї сторінки вже
// одного разу розійшовся з правдою: абзац обіцяв, що обидва інструменти
// «працюють без JavaScript», і вказував на «паливні цифри нижче», яких
// на сторінці немає. Тепер цей текст редагує власник у CMS — тобто
// ризик не зник, а переїхав ближче до людини.

const ORIGIN = "https://camptribe.eu";

async function jsonLdBlocks(page: import("@playwright/test").Page) {
  const raw = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  return raw.flatMap((t) => {
    const parsed = JSON.parse(t) as unknown;
    const graph = (parsed as { "@graph"?: unknown[] })["@graph"];
    return (graph ?? [parsed]) as Array<Record<string, unknown>>;
  });
}

test.describe("🔴 CAMP-365 — /tools", () => {
  test("🔴 лінкує два інструменти й каже, що кожен бере, дає і чого не знає", async ({
    page,
  }) => {
    await page.goto("/tools");
    for (const href of [
      "/tools/camper-trip-cost",
      "/tools/camper-packing-list",
    ]) {
      await expect(
        page.locator(`main a[href="${href}"]`),
        `немає посилання на ${href}`,
      ).toHaveCount(1);
    }
    const text = await page.locator("main").innerText();
    expect((text.match(/You give it/g) ?? []).length).toBe(2);
    expect((text.match(/You get/g) ?? []).length).toBe(2);
    expect((text.match(/What it does not know/g) ?? []).length).toBe(2);
  });

  test("🔴 колекція JSON-LD перелічує ті самі два інструменти", async ({
    page,
  }) => {
    await page.goto("/tools");
    const collection = (await jsonLdBlocks(page)).find(
      (b) => b["@type"] === "CollectionPage",
    ) as {
      mainEntity: { numberOfItems: number; itemListElement: { url: string }[] };
    };
    expect(collection, "немає CollectionPage").toBeTruthy();
    expect(collection.mainEntity.numberOfItems).toBe(2);
    expect(collection.mainEntity.itemListElement.map((i) => i.url)).toEqual([
      `${ORIGIN}/tools/camper-trip-cost`,
      `${ORIGIN}/tools/camper-packing-list`,
    ]);
  });

  test("🔴 одна паливна сторінка на кожну з ЄС-27 — не більше й не менше", async ({
    page,
  }) => {
    // Саме цю властивість переїзд у CMS забрав би, якби перелік країн
    // поїхав у базу. Тому він лишився з генератором, а сторож — тут.
    const members = Object.keys(
      (
        JSON.parse(
          readFileSync(
            join(
              process.cwd(),
              "..",
              "api",
              "src",
              "osm",
              "eu-member-states.json",
            ),
            "utf8",
          ),
        ) as { members: Record<string, string> }
      ).members,
    ).sort();
    // Файл, який не прочитався, зробив би порівняння нижче порожнім.
    expect(members.length, "перелік ЄС-27 не прочитався").toBe(27);

    const linked = (
      await page
        .goto("/tools")
        .then(() =>
          page
            .locator('main a[href^="/tools/camper-trip-cost/"]')
            .evaluateAll((els) =>
              els.map(
                (e) => (e as HTMLAnchorElement).getAttribute("href") ?? "",
              ),
            ),
        )
    )
      .map((h) => h.split("/").pop() ?? "")
      .sort();
    expect(linked).toEqual(members);
  });

  test("🔴 кожен вхід, який називає вступ, є полем на самому інструменті", async ({
    page,
  }) => {
    // Вступ — це проза. Кожен рядок нижче: що він називає, і підпис
    // поля на сторінці інструмента. Приберуть поле з інструмента або
    // обіцянку зі вступу — рядок червоніє. Назве вступ поле, якого
    // немає, — теж.
    await page.goto("/tools");
    const gives = async (href: string) => {
      const card = page.locator("main li", {
        has: page.locator(`a[href="${href}"]`),
      });
      await expect(card, `немає картки для ${href}`).toHaveCount(1);
      const said = await card.innerText();
      const m = /You give it\s*([\s\S]*?)\s*You get/.exec(said);
      expect(m, `${href}: немає рядка «You give it»`).not.toBeNull();
      return m![1].toLowerCase();
    };
    const costGives = await gives("/tools/camper-trip-cost");
    const packGives = await gives("/tools/camper-packing-list");

    await page.goto("/tools/camper-trip-cost");
    const cost = visibleText(await page.locator("main").innerHTML());
    await page.goto("/tools/camper-packing-list");
    const pack = visibleText(await page.locator("main").innerHTML());

    // Форма, що не відрендерилась, зробила б кожен рядок нижче
    // безпредметним — тож спершу стверджуємо, що вона є.
    expect(cost.length, "калькулятор не відрендерився").toBeGreaterThan(200);
    expect(pack.length, "пакувальний список не відрендерився").toBeGreaterThan(
      200,
    );

    const rows: Array<{
      tool: string;
      form: string;
      field: RegExp;
      said: string;
      gives: string;
    }> = [
      {
        tool: "trip cost",
        form: cost,
        field: /Country you are driving in/,
        said: "country",
        gives: costGives,
      },
      {
        tool: "trip cost",
        form: cost,
        field: /\bFuel\b[\s\S]*Diesel[\s\S]*Petrol/,
        said: "diesel or petrol",
        gives: costGives,
      },
      {
        tool: "trip cost",
        form: cost,
        field: /\bVehicle\b/,
        said: "vehicle",
        gives: costGives,
      },
      {
        tool: "trip cost",
        form: cost,
        field: /Distance, km/,
        said: "distance",
        gives: costGives,
      },
      {
        tool: "trip cost",
        form: cost,
        field: /\bNights\b/,
        said: "nights",
        gives: costGives,
      },
      {
        tool: "trip cost",
        form: cost,
        field: /\bPeople\b/,
        said: "people",
        gives: costGives,
      },
      {
        tool: "trip cost",
        form: cost,
        field: /Pitch per night/,
        said: "pitch",
        gives: costGives,
      },
      {
        tool: "packing list",
        form: pack,
        field:
          /Travelling in[\s\S]*Campervan[\s\S]*Motorhome[\s\S]*Car and tent/,
        said: "vehicle",
        gives: packGives,
      },
      {
        tool: "packing list",
        form: pack,
        field: /Time of year[\s\S]*Summer[\s\S]*Winter/,
        said: "season",
        gives: packGives,
      },
      {
        tool: "packing list",
        form: pack,
        field: /\bNights\b/i,
        said: "nights",
        gives: packGives,
      },
      {
        tool: "packing list",
        form: pack,
        field: /\bPeople\b/i,
        said: "people",
        gives: packGives,
      },
      {
        tool: "packing list",
        form: pack,
        field: /Cooking at the pitch/,
        said: "cook",
        gives: packGives,
      },
      {
        tool: "packing list",
        form: pack,
        field: /Pitch has electricity/,
        said: "electricity",
        gives: packGives,
      },
      {
        tool: "packing list",
        form: pack,
        field: /Travelling with children/,
        said: "children",
        gives: packGives,
      },
      {
        tool: "packing list",
        form: pack,
        field: /Travelling with a dog/,
        said: "dog",
        gives: packGives,
      },
    ];
    for (const r of rows) {
      expect(
        r.form,
        `${r.tool}: вступ називає «${r.said}», а такого поля в інструменті немає`,
      ).toMatch(r.field);
      expect(r.gives, `${r.tool}: вступ більше не каже «${r.said}»`).toContain(
        r.said,
      );
    }
  });

  test("🔴 не обіцяє інструмента, якого немає", async ({ page }) => {
    await page.goto("/tools");
    const html = await page.content();
    expect(await page.locator("main").innerText()).toContain(
      "comparison tool was planned",
    );
    expect(html).not.toMatch(/href="\/tools\/(camper-)?compar/);
  });

  test("🔴 дата паливного бюлетеня справді підставилась", async ({ page }) => {
    // `{{fuel.bulletin}}` — жива підстановка, не рядок у базі. Якщо
    // редактор її зітре, дата зникне мовчки; якщо білий список її
    // втратить — розбір кине. Тут перевіряється перший випадок.
    await page.goto("/tools");
    const text = await page.locator("main").innerText();
    expect(text, "лишилась нерозгорнута підстановка").not.toMatch(/\{\{/);
    expect(text, "зникла згадка тижня бюлетеня").toMatch(
      /for the week of \d{1,2} \w+ \d{4}/,
    );
  });

  test("🔴 має хлібні крихти, що ведуть на себе", async ({ page }) => {
    // 🔴 ПЕРША РЕДАКЦІЯ БУЛА ЗЕЛЕНА ЗА ПОБУДОВОЮ. Вона склеювала ВСІ
    // блоки JSON-LD в один рядок і питала `includes("/tools")` — а
    // `/tools` є підрядком `…/tools/camper-trip-cost` у колекції. Тест
    // із назвою «ведуть на себе» червонів би лише тоді, коли блок
    // крихт прибрано цілком. Заміряно рецензією #304.
    await page.goto("/tools");
    const crumbs = (await jsonLdBlocks(page)).find(
      (b) => b["@type"] === "BreadcrumbList",
    ) as {
      itemListElement: Array<{
        position: number;
        item?: string;
        name?: string;
      }>;
    };

    expect(crumbs, "немає BreadcrumbList").toBeTruthy();
    const last = crumbs.itemListElement[crumbs.itemListElement.length - 1];
    expect(
      String(last.item ?? ""),
      "остання крихта веде не на цю сторінку",
    ).toBe(`${ORIGIN}/tools`);
  });
});

/**
 * CAMP-458 — два переходи наприкінці сторінки пального по країні стали
 * картками. До того вони були підкресленими словами в абзаці, і власник
 * сказав прямо: «посилання майже не видно, а вони важливі».
 *
 * 🔴 ПЕРЕВІРЯЄТЬСЯ ДВОЇСТІСТЬ, А НЕ ПРОСТО НАЯВНІСТЬ. Перехід на країну
 * показується лише там, де в нас є кемпінги: ці 27 сторінок ростуть із
 * паливного бюлетеня, що покриває весь Союз, а наше покриття — ні, і
 * `dynamicParams = false` робить із такого посилання 404 у навігації
 * сторінки, яку ми попросили Google індексувати.
 */
test.describe("🔴 CAMP-458 — переходи зі сторінки пального", () => {
  test("обидва переходи — картки-посилання, а не слова в абзаці", async ({
    page,
  }) => {
    await page.goto("/tools/camper-trip-cost/hr");

    const cards = page.getByTestId("next-steps");
    await expect(cards, "секції переходів немає").toHaveCount(1);

    const links = cards.locator("a.ct-feat__link");
    // Хорватію ми тримаємо, тож карток дві: країна і спорядження.
    await expect(links, "карток-переходів не дві").toHaveCount(2);
    await expect(links.nth(0)).toHaveAttribute("href", "/camping/hr");
    await expect(links.nth(1)).toHaveAttribute(
      "href",
      "/tools/camper-packing-list",
    );

    // 🔴 КЛІКАБЕЛЬНА ВСЯ КАРТКА, А НЕ САМА НАЗВА. Інакше зміна
    // лишилась би косметичною: ціль так само завширшки зі слово.
    const box = await links.nth(0).boundingBox();
    expect(box, "картка не має розміру").not.toBeNull();
    expect(box!.height, "висота картки менша за рядок тексту").toBeGreaterThan(
      48,
    );
  });

  test("🔴 жодна картка не веде на країну, якої ми не тримаємо", async ({
    page,
    request,
  }) => {
    // Знаменник названий: обходимо ВСІ 27 сторінок, а не одну зручну.
    // Перелік — із того самого файлу, з якого ростуть самі сторінки.
    const codes = Object.keys(
      (
        JSON.parse(
          readFileSync(
            join(
              process.cwd(),
              "..",
              "api",
              "src",
              "osm",
              "eu-member-states.json",
            ),
            "utf8",
          ),
        ) as { members: Record<string, string> }
      ).members,
    ).sort();
    expect(codes.length, "перелік ЄС-27 не прочитався").toBe(27);

    let withCountryCard = 0;
    for (const code of codes) {
      await page.goto(`/tools/camper-trip-cost/${code.toLowerCase()}`);
      const country = page
        .getByTestId("next-steps")
        .locator(`a.ct-feat__link[href="/camping/${code.toLowerCase()}"]`);
      const n = await country.count();
      if (n === 0) continue;
      withCountryCard++;
      const res = await request.get(`/camping/${code.toLowerCase()}`);
      expect(
        res.status(),
        `картка веде на /camping/${code.toLowerCase()}, а там ${res.status()}`,
      ).toBe(200);
    }
    // Щоб «жодного 404» не пройшло над порожнечею.
    expect(withCountryCard, "жодна сторінка не показала картку країни").toBeGreaterThan(0);
  });
});
