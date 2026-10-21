import { expect, test } from "@playwright/test";
import { HOME_H1, HOME_LEAD, HOME_STEPS } from "../unit/home-cms";

// CAMP-365 — головна бере заголовок, вступ і три кроки з CMS.
//
// 🔴 ЦІ ТВЕРДЖЕННЯ ЧИТАЮТЬ БАЗУ, А НЕ ПІДМІННИК. Юніти рендерять
// сторінку на `HOME_PAGE`, і окрема звірка не дає тому підміннику
// розійтись із міграцією. Але жодне з них не доводить, що база справді
// ВІДДАЄ ці рядки: міграція могла не доїхати, сторінка — впасти в 404.
// Тут сторінка піднята по-справжньому, тож ланцюг замкнений.
//
// 🔴 І ОКРЕМО — КЛАСИ. Посимвольна звірка тексту сліпа на вигляд: на
// /tools вона була зеленою, поки завершальний абзац губив `mt-10` і
// приглушений колір (рецензія #304). Тому нижче перевіряється і те, ЯК
// намальовано, а не лише ЩО написано.

/** Хвіст вступу — без обчисленого числа на початку. */
const LEAD_TAIL = HOME_LEAD.replace("{{lead}}", "");

test.describe("🔴 CAMP-365 — головна", () => {
  test("заголовок і вступ — ті самі рядки, що в базі", async ({ page }) => {
    await page.goto("/");

    const h1 = page.locator("main h1");
    await expect(h1, "заголовка немає або їх кілька").toHaveCount(1);
    await expect(h1).toHaveText(HOME_H1);

    const lead = await page.locator("main p").first().innerText();
    expect(lead, "вступ не закінчується рядком із бази").toContain(LEAD_TAIL);

    // 🔴 Початок вступу РАХУЄТЬСЯ (`heroLead`), і він має ЧОТИРИ форми,
    // не дві. Перша редакція цього взірця приймала рівно одну з них, а
    // коментар обіцяв, що приймає й вироджену — заміряно рецензією: усі
    // три вироджені гілки падали. Тобто при 500 від API сторінка
    // надрукувала б правильно, а сторож почервонів би з хибним
    // діагнозом.
    //
    // Форми `heroLead`, дослівно з `lib/campsite-count.ts`:
    //   Campsites and motorhome parks across Europe        (обидва нулі)
    //   N campsites and motorhome parks                    (немає регіонів)
    //   Campsites and motorhome parks across N regions     (немає місць)
    //   N campsites and motorhome parks across N regions   (усе є)
    expect(lead, "вступ друкує нуль як число").not.toMatch(/\b0 campsites\b/);
    expect(lead).toMatch(
      /^(?:[\d,]+ campsites|Campsites) and motorhome parks(?: across (?:Europe|[\d,]+ regions))?,/,
    );
  });

  test("три кроки — назви й тексти з бази, у порядку з бази", async ({
    page,
  }) => {
    await page.goto("/");
    const steps = page.locator("main ol > li");
    await expect(steps, "кроків не три").toHaveCount(HOME_STEPS.length);

    for (const [i, s] of HOME_STEPS.entries()) {
      const li = steps.nth(i);
      await expect(li, `крок ${i + 1}: не той номер`).toContainText(
        `Step ${i + 1}`,
      );
      await expect(li.locator("h3"), `крок ${i + 1}: не та назва`).toHaveText(
        s.term,
      );
      await expect(li, `крок ${i + 1}: не той текст`).toContainText(s.text);
    }
  });

  test("🔴 жодної нерозгорнутої підстановки на сторінці", async ({ page }) => {
    await page.goto("/");
    const text = await page.locator("main").innerText();
    expect(text, "у видимому тексті лишилось {{…}}").not.toMatch(/\{\{|\}\}/);
  });

  // 🔴 ВИГЛЯД, А НЕ ЛИШЕ ТЕКСТ. Переїзд у CMS уже одного разу забрав
  // класи, лишивши текст на місці.
  test("🔴 заголовок і вступ лишились тих самих класів", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main h1")).toHaveClass(
      /max-w-\[18ch\].*text-3xl.*font-bold/,
    );
    await expect(page.locator("main p").first()).toHaveClass(
      /mt-4.*max-w-prose.*text-ink-2/,
    );
  });

  // 🔴 І ТЕ, ЩО НАВМИСНО ЛИШИЛОСЬ У КОДІ. Блок двох лійок — перелік
  // країн і абзац про оренду — не переїжджав. Якби переїзд його зачепив,
  // головна тихо втратила б єдиний вхід у країни.
  test("блок двох лійок на місці, з посиланнями в країни", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Where to stay" })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "What to drive" })).toHaveCount(1);
    await expect(
      page.locator('main a[href="/camping"]'),
      "немає посилання на всі кемпінги",
    ).toHaveCount(1);
    const countryLinks = page.locator('main a[href^="/camping/"]');
    expect(
      await countryLinks.count(),
      "жодного посилання в країну — перелік із бази зник",
    ).toBeGreaterThan(0);
  });
});

// 🔴 CAMP-365 — голова документа, якої не бачив жоден сторож.
//
// Рецензія #306 заміряла A/B на одній базі: переїзд мовчки замінив
// `<title>` кореня з брендового на заголовок сторінки, і `og:title`
// лишився брендовим — сторінка суперечила власній картці для соцмереж.
// Доказ «різниця в усьому <main> — 8 символів» цього побачити не міг:
// уся зміна була в `<head>`.
test.describe("🔴 CAMP-365 — голова головної", () => {
  test("корінь лишається брендовим і не сперечається сам із собою", async ({
    page,
  }) => {
    await page.goto("/");

    const title = await page.title();
    expect(title, "бренд зник із заголовка кореневої адреси").toContain(
      "CampTribe",
    );

    const og = await page
      .locator('meta[property="og:title"]')
      .getAttribute("content");
    expect(og, "немає og:title").not.toBeNull();
    expect(
      og,
      `og:title («${og}») розійшовся з <title> («${title}»)`,
    ).toBe(title);

    const desc = await page
      .locator('meta[name="description"]')
      .getAttribute("content");
    const ogDesc = await page
      .locator('meta[property="og:description"]')
      .getAttribute("content");
    expect(desc, "немає опису").not.toBeNull();
    expect(ogDesc, "og:description розійшовся з description").toBe(desc);
  });
});
