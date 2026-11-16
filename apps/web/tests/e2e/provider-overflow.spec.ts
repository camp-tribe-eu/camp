import { expect, test } from "./api-request";

// CAMP-445 / CAMP-444/21 — сторінка компанії не сміє мати горизонтальної
// прокрутки на 375 px.
//
// 🔴 ЗАМІРЯНО 16.11.2026 на проді: /camper-rental/providers/indie-campers,
// scrollWidth 387 при 375. Винна була примітка «What to know» з адресою PDF
// без жодного пробілу — абзац став ширший за екран. У CI-фікстурі такої
// адреси немає, тож тест вставляє її у ВІДДАНУ сторінку: перевіряється CSS
// справжньої розмітки, а не константа чи клас. Прибрати `break-words` з
// абзацу чи з панелі — тест червоніє (мутації описані в PR).

const LONG =
  "https://example-company-with-a-long-name.test/documents/registration/FichaProjeto_IC_2026_final_signed.pdf";

async function firstProviderPath(
  page: import("@playwright/test").Page,
): Promise<string> {
  await page.goto("/camper-rental/providers");
  const href = await page
    .locator('main a[href^="/camper-rental/providers/"]')
    .first()
    .getAttribute("href");
  expect(href, "у каталозі немає жодної компанії").toBeTruthy();
  return href!;
}

const overflow = (page: import("@playwright/test").Page) =>
  page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
  }));

test.describe("🔴 сторінка компанії на 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("без вставки: scrollWidth дорівнює ширині вікна (знаменник — сторінка справді відкрилась)", async ({
    page,
  }) => {
    await page.goto(await firstProviderPath(page));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const m = await overflow(page);
    expect(m.sw).toBe(m.iw);
  });

  test("довга адреса без пробілів у «What to know» не розпирає сторінку", async ({
    page,
  }) => {
    await page.goto(await firstProviderPath(page));
    const para = page
      .locator("section", {
        has: page.getByRole("heading", { name: "What to know" }),
      })
      .locator("p")
      .first();
    await expect(
      para,
      "у фікстурі немає примітки «What to know»",
    ).toBeVisible();
    await para.evaluate((el, text) => {
      el.textContent = `Taken from the company PDF (${text}) and nothing else.`;
    }, LONG);
    const m = await overflow(page);
    expect(m.sw, "горизонтальна прокрутка на 375").toBe(m.iw);
  });

  test("довга адреса в панелі контактів теж не розпирає", async ({ page }) => {
    await page.goto(await firstProviderPath(page));
    const panel = page.getByTestId("provider-panel");
    await panel.evaluate((el, text) => {
      const p = document.createElement("p");
      p.textContent = `Source: ${text}`;
      el.appendChild(p);
    }, LONG);
    const m = await overflow(page);
    expect(m.sw, "горизонтальна прокрутка на 375").toBe(m.iw);
  });
});
