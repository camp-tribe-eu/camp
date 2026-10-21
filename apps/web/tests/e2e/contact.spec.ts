import { expect, test } from "@playwright/test";

// CAMP-365 — /contact переїхала з коду в CMS.
//
// 🔴 ЧОМУ САМЕ ТУТ ПОСИМВОЛЬНІСТЬ ВАЖИТЬ НАЙБІЛЬШЕ. Для бельгійської
// юрособи контакт — вимога, а не ввічливість, і афіліат-мережа, яка
// розглядає заявку (CAMP-98), перевіряє саме цю сторінку. Загублений
// абзац тут коштує не стилю, а відповідності.
//
// Абзаци знято з попередньої версії `app/contact/page.tsx` ПЕРЕД
// заміною. Повні, а не ключові слова: перевірка на «містить
// OpenStreetMap» зеленіла б і над переписаним реченням.

const PARAGRAPHS = [
  "One address, read by a person: hello@camptribe.eu. Write to us about a campsite we have wrong, a licence or attribution question, or working together.",
  "We do not take bookings and have no part in them: a campsite’s own site or phone is the only place to reserve. And we cannot change what OpenStreetMap says about a place — that map is edited by its own community, and a correction made there reaches us with the next import. Tell us anyway, and we will say which of the two it is.",
  "send them to the same address. Three things have to come with them: that the picture is yours to give, your permission for us to publish it here, and the month it was taken — we print that date beside every photograph. Uploads through the site do not exist yet, so email is the whole of it.",
  "Company details and the supervisory authority are on the legal notice; what we store and for how long is on the privacy page.",
];

test.describe("🔴 CAMP-365 — /contact із CMS", () => {
  test("текст той самий, що був у коді — посимвольно", async ({ page }) => {
    await page.goto("/contact");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contact");

    const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    for (const p of PARAGRAPHS) {
      expect(
        body,
        `абзац загублено або переписано:\n${p.slice(0, 60)}…`,
      ).toContain(p.replace(/\s+/g, " "));
    }
  });

  test("🔴 обидва виділені зачини лишились виділеними", async ({ page }) => {
    await page.goto("/contact");
    for (const lead of [
      "Two things we cannot do.",
      "If you run a campsite and want your photographs on its page",
    ]) {
      await expect(
        page.locator("main strong", { hasText: lead }),
        `зачин «${lead.slice(0, 30)}…» перестав бути виділеним`,
      ).toHaveCount(1);
    }
  });

  test("посилання всередині абзаців ведуть на правові сторінки", async ({
    page,
  }) => {
    await page.goto("/contact");
    for (const href of ["/legal/notice", "/legal/privacy"]) {
      await expect(
        page.locator(`main p a[href="${href}"]`),
        `посилання на ${href} зникло`,
      ).toHaveCount(1);
    }
  });

  test("🔴 контакти беруться з одного джерела, а не передруковуються", async ({
    page,
  }) => {
    // Друга копія адреси розійшлась би з першою на першій же правці.
    await page.goto("/contact");
    const body = await page.locator("main").innerText();
    expect(body).toContain("hello@camptribe.eu");
    expect(body).toContain("UTD BV");
    expect(body).toContain("2000 Antwerpen");
    // 🔴 І жодної нерозгорнутої підстановки — ні в тексті, ні в адресі
    // кнопки: `cta_href` теж проходить через білий список.
    expect(body, "лишилась нерозгорнута підстановка").not.toMatch(/\{\{/);
    // 🔴 КНОПКА, А НЕ ПЕРШЕ-ЛІПШЕ `mailto` НА СТОРІНЦІ.
    //
    // Перша редакція брала `main a[href^="mailto:"]`.first() — а на цій
    // сторінці ДВА такі якорі, і перший це посилання в абзаці. Рецензія
    // прибрала підстановку в `cta_href` мутацією: кнопка отримала
    // `mailto:{{contact.email}}`, тобто зламаний лист, і всі шість
    // тестів лишились зеленими. `[data-ct-button]` стоїть лише на
    // кнопці, тож цілиться саме в неї.
    const cta = page.locator("main [data-ct-button]");
    await expect(cta, "кнопок заклику не рівно одна").toHaveCount(1);
    await expect(cta).toHaveAttribute("href", "mailto:hello@camptribe.eu");
  });

  // 🔴 ТЕСТ «КНОПКА ЦЕ ЗВИЧАЙНИЙ ЯКІР, А НЕ next/link» ЗВІДСИ ПРИБРАНО.
  //
  // Він був зелений за побудовою: обидві гілки `CtaButton` дають
  // однакову розмітку — `ButtonLink` ставить `data-ct-button` так само,
  // як сирий `<a>`. Рецензія замінила гілку на `if (true)` і отримала
  // байт-еквівалентний вихід у всьому, що тест читав. Твердження, яке
  // не може почервоніти, гірше за відсутнє: воно створює враження
  // покриття.
  //
  // Різниця між цими шляхами видна лише В БРАУЗЕРІ, у поведінці
  // переходу, а не в HTML. Доти, доки я не маю способу її ЗАМІРЯТИ,
  // тут стоїть те, що заміряти можу: адреса кнопки правильна (вище) і
  // правило «що таке внутрішня адреса» тепер ОДНЕ на весь застосунок
  // (`lib/rich-text.ts`, накрито `tests/unit/page-content.spec.ts`).

  test("🔴 заголовок для пошуковика окремий від заголовка сторінки", async ({
    page,
  }) => {
    // Саме заради цього додано `meta_title`. Рецензія: жодного
    // твердження про `<title>` не існувало — нова колонка, нове поле
    // сервісу й запасний шлях пройшли б будь-яку мутацію зеленими.
    await page.goto("/contact");
    await expect(page).toHaveTitle("Contact CampTribe | CampTribe");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contact");
  });

  test("🔴 має власні хлібні крихти, що ведуть на себе", async ({ page }) => {
    await page.goto("/contact");
    const ld = (
      await page.locator('script[type="application/ld+json"]').allTextContents()
    ).join(" ");
    expect(ld, "немає BreadcrumbList").toContain("BreadcrumbList");
    expect(ld, "крихта не веде на себе").toContain("/contact");
  });
});
