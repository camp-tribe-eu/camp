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

    // 🔴 Початок вступу РАХУЄТЬСЯ (`heroLead`), і саме тому він має
    // виглядати як одне з двох: речення з числом або — коли API відповів
    // нулями — те саме речення БЕЗ чисел (CAMP-308). Третього не буває,
    // і «0 campsites» зокрема.
    expect(lead, "вступ друкує нуль як число").not.toMatch(/\b0 campsites\b/);
    expect(lead).toMatch(
      /^(Campsites and motorhome parks|[\d,]+ campsites and motorhome parks across [\d,]+ regions),/,
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
