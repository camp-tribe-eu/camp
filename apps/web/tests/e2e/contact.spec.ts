import { expect, test } from "./api-request";

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
  "send them to the same address. Three things have to come with them: that the picture is yours to give, your permission for us to publish it here, and the month it was taken — we print that date beside every photograph. Email is all it takes — there is nothing else to fill in.",
  "Company details and the supervisory authority are on the legal notice; what we store and for how long is on the privacy page.",
];

test.describe("🔴 CAMP-365 — /contact із CMS", () => {
  test("🔴 жодної «внутрішньої кухні» про те, чого ще немає", async ({ page }) => {
    await page.goto("/contact");
    const body = await page.locator("main").innerText();
    expect(body).not.toMatch(/do not exist yet|not exist yet|yet\b.*email is the whole/i);
  });

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
    // CAMP-441: на сторінці тепер ще й кнопка «Send message» форми, теж
    // `data-ct-button`. Ціль — КНОПКА-ЯКІР, тобто `a`, а не будь-яка кнопка:
    // форма лишається поза цим твердженням (її тримає блок нижче).
    const cta = page.locator("main a[data-ct-button]");
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

/**
 * CAMP-464 — у сторінки контактів зʼявився верх.
 *
 * 🔴 ТЕ САМЕ ТВЕРДЖЕННЯ, ЩО НА /about І /tools, І ВОНО ТУТ ПОТРІБНЕ
 * ОКРЕМО: найдешевший спосіб зіпсувати банер — лишити старий заголовок
 * під ним «щоб було помітніше». Тоді сторінка дістає два `h1`, а з ними
 * зламаний обрис для читача екрана й для пошуковика.
 */
test.describe('🔴 CAMP-464 — верх сторінки контактів', () => {
  test('заголовок один, він у банері й не порожній', async ({ page }) => {
    await page.goto('/contact');

    await expect(page.locator('main h1'), 'заголовків не один').toHaveCount(1);
    await expect(
      page.locator('main .ct-banner h1'),
      'заголовок лишився поза банером',
    ).toHaveCount(1);

    const text = (await page.locator('main h1').innerText()).trim();
    expect(text.length, 'заголовок порожній').toBeGreaterThan(2);
    expect(await page.title(), `«${text}» немає в назві вкладки`).toContain(text);

    const height = await page
      .locator('main .ct-banner')
      .evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(height, `висота банера ${height} px`).toBeGreaterThan(200);
  });
});

/**
 * CAMP-441, пункт 31 ревʼю — форма «Write to us».
 *
 * 🔴 ТУТ ТЕ, ЩО ВИДНО ЛИШЕ В БРАУЗЕРІ: розкладка (два поля в рядку на
 * десктопі, одна колонка на 375, без горизонтальної прокрутки), що пастка
 * справді за екраном і поза табом, які запити робить сторінка, і що
 * людина бачить на кожен із відповідей API. Те, що сторінка СТВЕРДЖУЄ
 * словами, читається з відданого HTML у `tests/unit/contact-form.spec.tsx`.
 *
 * Відповіді API підмінені `page.route`: перевіряється ПОВЕДІНКА сторінки на
 * 200 / 400 / 429 / 503, а не API (його тримає `contact.spec.ts` в api).
 */
const API_ORIGIN = new URL(
  process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.API_BASE_URL ?? 'http://localhost:3001',
).origin;

type Sent = { body: Record<string, unknown> };

/** Підміна `POST {API}/contact`: прохід CORS (OPTIONS) і задана відповідь. */
async function stubContactApi(
  page: import('@playwright/test').Page,
  status: number,
  sent: Sent[] = [],
) {
  await page.route(
    (url) => url.origin === API_ORIGIN && url.pathname === '/contact',
    async (route) => {
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'POST, OPTIONS',
      };
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      sent.push({ body: JSON.parse(req.postData() ?? '{}') });
      return route.fulfill({
        status,
        headers: { ...cors, 'content-type': 'application/json' },
        body: status === 200 ? '{"ok":true}' : `{"code":"x","status":${status}}`,
      });
    },
  );
}

async function fill(page: import('@playwright/test').Page, over: Record<string, string> = {}) {
  const v = { name: 'Anna Novak', email: 'anna@example.eu', subject: '', message: 'A closed campsite, the gate is chained.', ...over };
  const form = page.getByTestId('contact-form');
  await form.getByLabel('Name', { exact: true }).fill(v.name);
  await form.getByLabel('Email', { exact: true }).fill(v.email);
  if (v.subject) await form.getByLabel(/^Subject/).fill(v.subject);
  await form.getByLabel('Message', { exact: true }).fill(v.message);
}

test.describe('🔴 CAMP-441/31 — форма на /contact', () => {
  test('десктоп 1280: імʼя й пошта в одному рядку, форма праворуч від контактів', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/contact');
    const form = page.getByTestId('contact-form');
    await expect(form.getByRole('button', { name: 'Send message' })).toBeEnabled();
    const box = async (label: string) => (await form.getByLabel(label, { exact: true }).boundingBox())!;
    const [name, email] = [await box('Name'), await box('Email')];
    expect(Math.abs(name.y - email.y), 'імʼя й пошта не в одному рядку').toBeLessThan(2);
    expect(email.x, 'пошта не праворуч від імені').toBeGreaterThan(name.x + name.width - 1);
    const intro = (await page.getByTestId('contact-intro').boundingBox())!;
    const card = (await form.boundingBox())!;
    expect(card.x, 'форма не праворуч від контактів').toBeGreaterThan(intro.x + intro.width - 1);
  });

  test('375: одна колонка, форма влізає, горизонтальної прокрутки немає', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/contact');
    const form = page.getByTestId('contact-form');
    await expect(form.getByRole('button', { name: 'Send message' })).toBeEnabled();
    const name = (await form.getByLabel('Name', { exact: true }).boundingBox())!;
    const email = (await form.getByLabel('Email', { exact: true }).boundingBox())!;
    expect(email.y, 'на 375 поля мусять стояти одне під одним').toBeGreaterThan(name.y + name.height - 1);
    const fb = (await form.boundingBox())!;
    expect(fb.x).toBeGreaterThanOrEqual(0);
    expect(fb.x + fb.width, 'форма виходить за правий край').toBeLessThanOrEqual(375);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, `горизонтальна прокрутка ${over} px`).toBeLessThanOrEqual(0);
  });

  test('🔴 пастка за екраном і поза табом: Tab її не знаходить', async ({ page }) => {
    await page.goto('/contact');
    const form = page.getByTestId('contact-form');
    await expect(form.getByRole('button', { name: 'Send message' })).toBeEnabled();
    const trap = form.locator('input[name="leaveBlank"]');
    const b = (await trap.boundingBox())!;
    expect(b.x + b.width, 'пастка потрапляє в область екрана').toBeLessThan(0);
    await form.getByLabel('Name', { exact: true }).focus();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const onTrap = await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name === 'leaveBlank');
      expect(onTrap, 'Tab зупинився на пастці').toBe(false);
    }
  });

  test('🔴 сторінка не звертається до сторонніх доменів — ні при завантаженні, ні при надсиланні', async ({ page }) => {
    const hosts = new Set<string>();
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.protocol === 'http:' || u.protocol === 'https:') hosts.add(u.origin);
    });
    await stubContactApi(page, 200);
    await page.goto('/contact');
    await fill(page);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByRole('status')).toContainText('Thank you');
    const own = new URL(page.url()).origin;
    const foreign = [...hosts].filter((o) => o !== own && o !== API_ORIGIN);
    expect(foreign, `сторонні домени: ${foreign.join(', ')}`).toEqual([]);
    expect(hosts.size, 'не було жодного запиту — перевірка нічого не бачила').toBeGreaterThan(1);
    expect(hosts.has(API_ORIGIN), 'POST до нашого API не відбувся').toBe(true);
  });

  test('успіх: тіло — рівно ті поля, які дозволяє API, пастка порожня, час відкриття не менший за мінімум', async ({ page }) => {
    const sent: Sent[] = [];
    await stubContactApi(page, 200, sent);
    await page.goto('/contact');
    await fill(page, { subject: 'Hello' });
    // 🔴 людина натискає одразу — кнопка сама чекає, а не віддає «занадто швидко»
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByRole('status')).toContainText('Thank you. Your message is with us');
    expect(sent).toHaveLength(1);
    const b = sent[0].body;
    expect(Object.keys(b).sort()).toEqual(['elapsedMs', 'email', 'leaveBlank', 'message', 'name', 'subject']);
    expect(b.leaveBlank).toBe('');
    expect(b.elapsedMs as number).toBeGreaterThanOrEqual(3000);
    expect(b.email).toBe('anna@example.eu');
  });

  test('порожня форма: помилки біля полів, жодного запиту', async ({ page }) => {
    const sent: Sent[] = [];
    await stubContactApi(page, 200, sent);
    await page.goto('/contact');
    const form = page.getByTestId('contact-form');
    await form.getByRole('button', { name: 'Send message' }).click();
    await expect(form.getByText('Please tell us your name.')).toBeVisible();
    await expect(form.getByText('Please give an email address, so we can answer.')).toBeVisible();
    await expect(form.getByText(/at least 10 characters/)).toBeVisible();
    expect(sent).toHaveLength(0);
  });

  for (const [status, said] of [
    [503, 'We could not send your message just now'],
    [429, 'Enough messages from this connection for now'],
    [400, 'The form was not accepted'],
  ] as const) {
    test(`🔴 ${status}: чесне повідомлення${status === 400 ? '' : ' з адресою'}, написане лишається`, async ({ page }) => {
      await stubContactApi(page, status);
      await page.goto('/contact');
      await fill(page);
      await page.getByRole('button', { name: 'Send message' }).click();
      const alert = page.getByTestId('contact-form').getByRole('alert');
      await expect(alert).toContainText(said);
      if (status !== 400) {
        await expect(alert).toContainText('hello@camptribe.eu');
        await expect(alert.locator('a[href="mailto:hello@camptribe.eu"]')).toHaveCount(1);
      }
      await expect(page.getByTestId('contact-form').getByLabel('Message', { exact: true })).toHaveValue(
        'A closed campsite, the gate is chained.',
      );
      await expect(page.getByRole('status')).toHaveCount(0);
    });
  }

  test('мережа лягла: те саме чесне повідомлення, а не «дякуємо»', async ({ page }) => {
    await page.route(
      (url) => url.origin === API_ORIGIN && url.pathname === '/contact',
      (route) => route.abort('connectionrefused'),
    );
    await page.goto('/contact');
    await fill(page);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByTestId('contact-form').getByRole('alert')).toContainText('Nothing was sent');
    await expect(page.getByRole('status')).toHaveCount(0);
  });
});
