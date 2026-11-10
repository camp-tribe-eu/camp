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

/**
 * CAMP-458 — «шер-лінк має працювати завжди».
 *
 * 🔴 ПРАЦЮВАВ ВІН І ДО ТОГО — рівно доти, доки буфер обміну не казав
 * «ні». Тоді посилання мовчки їхало в адресний рядок, а кнопка далі
 * писала «Copy a link to this»: для людини це «натиснув — нічого не
 * сталось». Тому тут перевіряються ОБИДВА шляхи, і другий — з буфером,
 * якого немає, бо саме він і був зламаний.
 */
test.describe("🔴 CAMP-458 — посилання на розрахунок", () => {
  const fill = async (page: import("@playwright/test").Page) => {
    await page.goto("/tools/camper-trip-cost");
    // Форма оживає після гідратації; до того введене затирається.
    await expect(page.getByTestId("calculator-loading")).toHaveCount(0);
    await page.selectOption("#tc-country", "FR");
    await page.fill("#tc-km", "800");
    await page.fill("#tc-nights", "5");
  };

  test("посилання веде на ті самі числа в чистому вікні", async ({
    page,
    browser,
  }) => {
    await fill(page);
    await page.getByTestId("share-button").click();

    // Адресний рядок оновлюється завжди — це єдиний шлях без дозволів.
    const url = page.url();
    expect(url, "адреса не несе розрахунку").toContain("c=FR");

    const fresh = await browser.newContext();
    const other = await fresh.newPage();
    await other.goto(url);
    await expect(other.getByTestId("calculator-loading")).toHaveCount(0);
    await expect(other.locator("#tc-country")).toHaveValue("FR");
    await expect(other.locator("#tc-km")).toHaveValue("800");
    await expect(other.locator("#tc-nights")).toHaveValue("5");
    await fresh.close();
  });

  test("🔴 без буфера обміну посилання показується, а не зникає", async ({
    page,
  }) => {
    // Буфер обміну не існує зовсім — так буває на http:// і в старих
    // WebView. До CAMP-458 цей шлях мовчав.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
      });
    });

    await fill(page);
    await page.getByTestId("share-button").click();

    const manual = page.getByTestId("share-manual");
    await expect(manual, "посилання не показалось").toHaveCount(1);
    const shown = await manual.locator("input").inputValue();
    expect(shown, "показане посилання не несе розрахунку").toContain("c=FR");
    expect(shown, "показане посилання розійшлось з адресним рядком").toBe(
      page.url(),
    );

    // І кнопка не бреше, що скопіювала.
    await expect(page.getByTestId("share-button")).not.toHaveText(
      "Link copied",
    );
  });
});

/**
 * CAMP-458 — «FAQ не за дизайном». Тепер це секція каталогу (CAMP-449),
 * тобто нативний `<details>`.
 *
 * 🔴 ЗВІРЯЄМО РОЗМІТКУ ЗІ СТОРІНКОЮ, А НЕ ПРОСТО НАЯВНІСТЬ АКОРДЕОНА.
 * FAQPage у JSON-LD — це твердження для машини, що відповіді є НА
 * сторінці. Акордеон тримає їх у відданому HTML закритими, і саме цю
 * рівність — скільки питань у розмітці, стільки й на сторінці — легше
 * за все загубити, міняючи вигляд.
 */
test.describe("🔴 CAMP-458 — FAQ калькулятора", () => {
  test("питань на сторінці стільки ж, скільки в розмітці FAQPage", async ({
    page,
  }) => {
    await page.goto("/tools/camper-trip-cost");

    const blocks = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    const faqPage = blocks
      .map((b) => JSON.parse(b) as Record<string, unknown>)
      .find((b) => b["@type"] === "FAQPage");
    expect(faqPage, "FAQPage у розмітці немає").toBeTruthy();
    const inMarkup = (faqPage!.mainEntity as unknown[]).length;
    expect(inMarkup, "питань у розмітці замало").toBeGreaterThan(2);

    const items = page.getByTestId("trip-cost-faq").locator("details");
    await expect(items, "акордеон і розмітка розійшлись").toHaveCount(
      inMarkup,
    );

    // І відповідь лежить у ВІДДАНОМУ HTML, а не домальовується кліком.
    const first = items.first();
    await expect(first).not.toHaveAttribute("open", "");
    const text = await first.evaluate((el) => el.textContent ?? "");
    expect(
      text.length,
      "у закритому пункті немає тексту відповіді",
    ).toBeGreaterThan(60);
  });
});

/**
 * CAMP-458 — список спорядження: «стилі не ті; розкласти колонками».
 *
 * 🔴 ТУТ ПЕРЕВІРЯЄТЬСЯ ОДНАКОВІСТЬ, А НЕ КРАСА. На цій сторінці вже
 * стояли наші галочки (CAMP-459) — у блоці налаштувань. А сам список
 * лишався на голому `<input type="checkbox">`, тобто два різні контроли
 * на одному екрані. Саме це й читається як «стилі не ті».
 */
test.describe("🔴 CAMP-458 — вигляд списку спорядження", () => {
  test("жодної галочки повз наш контрол", async ({ page }) => {
    await page.goto("/tools/camper-packing-list");

    const themed = page.locator("main .ct-cb");
    // Знаменник: над порожньою сторінкою «жодної чужої» нічого не варте.
    await expect(themed, "наших галочок на сторінці немає").not.toHaveCount(0);

    const raw = page.locator(
      "main input[type=checkbox]:not(.ct-cb__input)",
    );
    await expect(
      raw,
      "на сторінці лишився голий чекбокс повз наш контрол",
    ).toHaveCount(0);
  });

  test("🔴 групи стоять колонками, а не ряд у ряд", async ({ page }) => {
    await page.goto("/tools/camper-packing-list");

    const groups = page.locator("main [data-group]");
    await expect(groups, "груп на сторінці немає").not.toHaveCount(0);

    // 🔴 ЩО САМЕ ТУТ ДОВОДИТЬСЯ, І ЧОМУ ДВІ ПОПЕРЕДНІ РЕДАКЦІЇ НЕ
    // ДОВОДИЛИ НІЧОГО.
    //
    // Перша читала `columnCount` і впала на мобільному «Received: NaN»:
    // там колонок немає, тож властивість це `auto`. Друга рахувала
    // різні ліві краї — і мутація «поверни сітку» лишила її ЗЕЛЕНОЮ, бо
    // сітка з двох стовпців дає рівно ті самі два краї.
    //
    // Скарга власника була не про кількість стовпців, а про діри: сітка
    // вирівнює ряди по найвищій групі, тож під короткою групою зяє
    // порожнеча до наступного ряду. Колонки пакують щільно — проміжок
    // між сусідами в колонці завжди той самий (`mb-6`). Це й міряємо.
    const width = page.viewportSize()?.width ?? 0;
    expect(width, 'ширина вікна невідома — замір нічого не доводить').toBeGreaterThan(0);

    const boxes = await groups.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          left: Math.round(r.left),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
        };
      }),
    );
    expect(boxes.length, 'груп замало, щоб побачити розкладку').toBeGreaterThan(2);

    const columns = new Map<number, typeof boxes>();
    for (const b of boxes) {
      const col = columns.get(b.left) ?? [];
      col.push(b);
      columns.set(b.left, col);
    }
    if (width >= 768) {
      expect(
        columns.size,
        `на ${width} px груп у ${columns.size} колонку, а має бути більше однієї`,
      ).toBeGreaterThan(1);
    } else {
      expect(
        columns.size,
        `на ${width} px груп у ${columns.size} колонок, а має бути рівно одна`,
      ).toBe(1);
    }

    // 🔴 ДІРА НЕ МІЖ КАРТКАМИ, А ВСЕРЕДИНІ НИХ — І ЦЕ ТРЕТЯ РЕДАКЦІЯ
    // ЦЬОГО ЗАМІРУ.
    //
    // Проміжки між картками в сітці теж однакові (`gap-6`), тож мутація
    // «поверни сітку» лишалась зеленою і тут. Різниця ось у чому: у
    // сітці картка РОЗТЯГУЄТЬСЯ на висоту ряду, і під останнім пунктом
    // короткої групи зяє порожнеча до рамки. У колонках картка обіймає
    // свій вміст, тож відстань від останнього пункту до низу картки —
    // це завжди падінг, той самий у всіх.
    const slack = await groups.evaluateAll((els) =>
      els.map((el) => {
        const items = el.querySelectorAll('li');
        const last = items[items.length - 1].getBoundingClientRect();
        return Math.round(el.getBoundingClientRect().bottom - last.bottom);
      }),
    );
    expect(slack.length, 'груп немає — міряти нічого').toBeGreaterThan(2);
    expect(
      [...new Set(slack)],
      `під останнім пунктом груп лишається різна порожнеча (${slack.join(', ')}) — ` +
        'так виглядає картка, розтягнута на висоту ряду сітки',
    ).toHaveLength(1);

    // І група не розривається між колонками.
    const breakInside = await groups
      .first()
      .evaluate((el) => getComputedStyle(el).breakInside);
    expect(breakInside, "групу можна розірвати між колонками").toBe("avoid");
  });
});
