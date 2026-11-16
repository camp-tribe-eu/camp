import { expect, test } from "./api-request";
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
  // 🔴 ОДИН h1 НА ГОЛОВНІЙ — ПЕРШИЙ СЛАЙД. Старий блок «Every campsite, and
  // what is around it» + вступ під слайдером був дублем заголовка й прибраний
  // (міграція ховає секцію, код її не малює). Тест читає ВИДАНУ сторінку.
  test("рівно один h1, він у слайдері, а старого блоку немає", async ({ page }) => {
    await page.goto("/");

    const h1 = page.locator("main h1");
    await expect(h1, "h1 немає або їх кілька").toHaveCount(1);
    await expect(
      page.getByTestId("home-slide").first().locator("h1"),
      "h1 має бути заголовком першого слайда",
    ).toHaveCount(1);
    await expect(h1).not.toHaveText(HOME_H1);

    const text = await page.locator("main").innerText();
    expect(text, "старий вступ під слайдером лишився").not.toContain(LEAD_TAIL);
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

  // 🔴 І ТЕ, ЩО НАВМИСНО ЛИШИЛОСЬ У КОДІ. Блок двох лійок — перелік
  // країн і абзац про оренду — не переїжджав. Якби переїзд його зачепив,
  // головна тихо втратила б єдиний вхід у країни.
  test("блок двох лійок на місці, з посиланнями в країни", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Where to stay" })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "What to drive" })).toHaveCount(1);
    // 🔴 CAMP-488: слайдер теж має кнопку на /camping («Find a campsite»),
    // тож рахувати по всьому `main` більше не можна — предмет перевірки це
    // БЛОК ЛІЙОК, і шукаємо в ньому.
    await expect(
      page.locator('[data-persona-group] a[href="/camping"]'),
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
