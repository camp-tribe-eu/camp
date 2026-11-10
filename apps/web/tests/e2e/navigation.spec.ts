import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./api-request";
import { openHeaderNav, revealSubmenu } from "./header-nav";

// CAMP-365 — меню переїхало з коду в базу, і цей файл повертає те, що
// ми переїздом втратили.
//
// 🔴 ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ, І ЧОМУ ВІН НЕ «ПРО ВСЯК ВИПАДОК».
//
// Доки меню жило списком у `site-chrome.tsx`, мертве посилання було
// НЕМОЖЛИВЕ. Поруч навіть стояв коментар: закоментовані пункти
// (`/routes`, `/rentals`) додаються «коли кожен поїде, не раніше». Щоб
// додати пункт, треба було змінити файл, а файл читає рецензія і CI.
//
// База цієї властивості не має. Власник може вписати пункт на
// сторінку, якої ще немає, — і нічого не впаде: сайт просто віддасть
// 404 з головного меню, мовчки, усім читачам одразу.
//
// Тобто без цього файла переїзд був би обміном «власник не може
// редагувати» на «власник може зламати». Саме тому тут перевіряється
// КОЖЕН пункт із бази, а не вибірка й не ті шість, що я переніс
// міграцією: наступний додасть власник, і його ніхто не рецензує.

const API = process.env.API_BASE_URL ?? "http://localhost:3001";

interface NavItem {
  href: string;
  label: string;
  children: NavItem[];
}

/** Усі пункти всіх розташувань, у глибину. */
function flatten(items: NavItem[], out: NavItem[] = []): NavItem[] {
  for (const i of items) {
    out.push(i);
    flatten(i.children, out);
  }
  return out;
}

const APP_DIR = join(__dirname, "..", "..", "src", "app");

/**
 * Статичні маршрути застосунку: кожна `page.tsx`, у шляху до якої немає
 * `[параметра]`. Динамічні (`/camping/[country]`) у меню не бувають —
 * їх тисячі, і до них ведуть хаби.
 *
 * Групи `(name)` не є сегментом адреси; `_private` і `@slot` — не
 * маршрути. Жодної з трьох конвенцій у `src/app` сьогодні немає, але
 * помічник їх знає, щоб не почервоніти на власному незнанні, коли
 * зʼявляться.
 */
export function staticRoutes(dir = APP_DIR, prefix = ""): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir).sort();
  if (entries.includes("page.tsx")) out.push(prefix || "/");
  for (const name of entries) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (name.startsWith("[") || name.startsWith("_") || name.startsWith("@")) {
      continue;
    }
    const segment = /^\(.*\)$/.test(name) ? "" : `/${name}`;
    out.push(...staticRoutes(full, `${prefix}${segment}`));
  }
  return out;
}

/**
 * 🔴 СТОРІНКИ, ЯКИМ У МЕНЮ НЕ МІСЦЕ, — З ПРИЧИНОЮ БІЛЯ КОЖНОЇ.
 *
 * Явний перелік, а не регулярка: `/^\/account/` сховала б і сторінку,
 * яку колись захочуть у меню, і ніхто б цього не побачив. Кожен рядок
 * тут — рішення, і його можна оскаржити поіменно.
 */
const NOT_IN_MENU: ReadonlyArray<{ path: string; why: string }> = [
  { path: "/", why: "головна — це логотип у шапці, він веде на неї з кожної сторінки" },
  { path: "/login", why: "автентифікація: вхід — дія, не розділ сайту" },
  { path: "/signup", why: "автентифікація: реєстрація пропонується з екрана входу" },
  { path: "/forgot-password", why: "автентифікація: лише з екрана входу" },
  { path: "/reset-password", why: "автентифікація: відкривається з посилання в листі" },
  { path: "/verify-email", why: "автентифікація: відкривається з посилання в листі" },
  { path: "/confirm-email-change", why: "автентифікація: відкривається з посилання в листі" },
  { path: "/gone", why: "технічна сторінка 410 для знятих адрес: читач потрапляє туди лише за старим посиланням" },
  { path: "/account", why: "кабінет: лише для того, хто ввійшов; публічне меню одне на всіх" },
  { path: "/account/claim", why: "кабінет: підсторінка кабінету" },
  { path: "/account/data", why: "кабінет: підсторінка кабінету" },
  { path: "/account/delete", why: "кабінет: підсторінка кабінету" },
  { path: "/account/listings", why: "кабінет: підсторінка кабінету" },
  { path: "/account/settings", why: "кабінет: підсторінка кабінету" },
  {
    path: "/internal/sections",
    why:
      "вітрина каталогу секцій (CAMP-449): службова сторінка, закрита " +
      "`noindex` і `Disallow: /internal/`. У меню їй місця немає — " +
      "читач на неї не йде, а виняток названий поіменно, бо правило " +
      "«/internal/.*» накрило б і те, що колись мало б бути видимим.",
  },
];

test.describe("🔴 CAMP-365 — меню з бази", () => {
  test("кожен пункт меню веде на сторінку, яка відкривається", async ({
    page,
    request,
  }) => {
    const res = await request.get(`${API}/navigation`);
    expect(
      res.status(),
      `API меню відмовив: ${res.status()} ${res.statusText()}`,
    ).toBe(200);

    const body = (await res.json()) as Record<string, NavItem[]>;
    const all = flatten([
      ...(body.header ?? []),
      ...(body.footer ?? []),
      ...(body.mobile ?? []),
    ]);

    // 🔴 ПОРОЖНЄ МЕНЮ ЗАДОВОЛЬНИЛО Б УСІ ПЕРЕВІРКИ НИЖЧЕ.
    //
    // «Жоден пункт не веде в нікуди» істинне й тоді, коли пунктів
    // немає зовсім. А меню, що зникло, це поломка, яку читач помітить
    // раніше за нас. Тож спершу стверджуємо, що воно є.
    expect(
      all.length,
      "меню порожнє — або база не наповнена, або запит бере не те",
    ).toBeGreaterThan(0);

    for (const item of all) {
      expect(
        item.label.trim(),
        `пункт ${item.href} без підпису — читач побачить порожнє місце`,
      ).not.toBe("");

      // Зовнішні посилання не наші, їх не перевіряємо: чужий сайт може
      // лежати з причин, до яких ми не маємо стосунку.
      if (!item.href.startsWith("/")) continue;

      const page404 = await request.get(item.href, { failOnStatusCode: false });
      expect(
        page404.status(),
        `пункт меню «${item.label}» веде на ${item.href}, а той віддає ` +
          `${page404.status()}. Саме це переїзд меню в базу і зробив ` +
          `можливим — див. коментар угорі файла.`,
      ).toBeLessThan(400);
    }

    // 🔴 І ТЕ САМЕ ОЧИМА ЧИТАЧА, а не лише в API. Пункт може бути в
    // базі й не доїхати до розмітки — саме цей клас дефекту ми ловили
    // в CAMP-352, коли проп доходив до підпису, але не до мапи.
    await page.goto("/camping");

    // 🔴 ЧОМУ ТУТ ДВА ШЛЯХИ, А НЕ ОДИН.
    //
    // Перша редакція шукала пункти просто в `<header>` і впала на
    // mobile-chrome: «пункт „Map“ є в базі, але його немає в шапці».
    // Формально тест мав рацію, по суті — ні: нижче 1200 px
    // горизонтального меню НЕМАЄ за задумом (`hidden xl:block`), там
    // працює шухляда, і межу взято з архіву теми. Тобто я стверджував
    // властивість, хибну на телефоні за побудовою, — і це був дефект
    // мого ж критерію, а не продукту.
    //
    // 🔴 І ЧОМУ МЕЖА НЕ ЗАШИТА ЧИСЛОМ. 1200 px живе в CSS
    // (`--breakpoint-xl: 75rem`). Копія константи тут розійшлась би з
    // нею мовчки при першій зміні макета, і тест перевіряв би не той
    // шлях, лишаючись зеленим. Тому він питає БРАУЗЕР, що читач бачить.
    const nav = page.locator('header nav[aria-label="Main"]');
    const burger = page.getByTestId('burger-open');
    const navShown = await nav.isVisible();
    const burgerShown = await burger.isVisible();

    // 🔴 ПАРА ДО РОЗГАЛУЖЕННЯ. Без цього рядка перевірка нижче зеленіла б
    // і над шапкою, де немає НІ меню, ні бургера. Це найгірший можливий
    // стан — навігації не існує зовсім, — і саме його помічник, що
    // мовчки нічого не відкриває, приховав би найкраще.
    expect(
      [navShown, burgerShown].filter(Boolean).length,
      `до меню має вести рівно один шлях, а видно: меню=${navShown}, ` +
        `бургер=${burgerShown}`,
    ).toBe(1);

    // 🔴 СПОСІБ ДІСТАТИСЬ МЕНЮ — ЧУЖИЙ, А НЕ СВІЙ.
    //
    // Першу редакцію цього блоку я написав інлайном: сам шукав бургер,
    // сам клікав, сам чекав панель. А `tests/e2e/header-nav.ts` уже
    // існує саме для цього, і його коментар описує мене наперед —
    // «доки спосіб дістатись меню живе копіями по файлах, наступний
    // такий тест напишуть так само й він впаде так само». Я став третьою
    // копією через двадцять хвилин після того, як прочитав ці рядки.
    const menu = await openHeaderNav(page);

    // 🔴 ГЛИБИНА, А НЕ ВЕРХНІЙ РІВЕНЬ.
    //
    // Перша редакція брала лише `body.header`, тобто корені. Підпункт,
    // доданий власником у CMS, пройшов би перевірку на 404 вище (там
    // перелік плаский) і мовчки не доїхав би до розмітки: шапка малює
    // один рівень. Тобто переїзд у базу додав би дефект, якого в масиві
    // в коді бути не могло — а саме проти цього класу весь цей файл.
    //
    // Тепер тут `flatten`: щойно зʼявиться підпункт, цей тест почервоніє
    // з його назвою, замість того щоб читач не побачив пункт ніколи.
    //
    // 🔴 CAMP-448: підпункт у розкривачі схований, доки батька не
    // розкрито, — тож перед дитиною відкриваємо її батька. У шухляді
    // діти видимі одразу, і `revealSubmenu` там нічого не робить.
    const walk = async (items: NavItem[], parents: NavItem[]) => {
      for (const item of items) {
        for (const p of parents) await revealSubmenu(menu, p.href);
        await expect(
          menu.getByRole('link', { name: item.label, exact: true }).first(),
          `пункт «${item.label}» є в базі, але читач до нього не дістанеться`,
        ).toHaveAttribute('href', item.href);
        await walk(item.children, [...parents, item]);
      }
    };
    await walk(body.header ?? [], []);
  });

  // 🔴 CAMP-448 — ЗВОРОТНИЙ НАПРЯМОК. Тест вище тримає «пункт меню →
  // сторінка існує». Напрямок «сторінка існує → вона в меню» не тримав
  // ніхто, і саме тому `/tools/camper-trip-cost`,
  // `/tools/camper-packing-list` і `/camper-rental/providers` прожили
  // невидимими, доки власник не спитав: «Сторінка є а в меню хедера не
  // виведена… чого сховав?» (08.11.2026). Два переліки — маршрути в коді
  // й пункти в базі — розходились тихо.
  //
  // Перелік маршрутів береться З КОДУ (кожна `page.tsx` без `[параметра]`
  // у шляху), пункти — З БАЗИ через той самий API, що й шапка. Винятки —
  // явним переліком із причиною біля кожного, а не регуляркою: регулярка
  // «/account.*» сховала б і сторінку, яка в меню мала б бути.
  test('🔴 кожна видима сторінка є в меню — зворотний напрямок', async ({
    request,
  }, testInfo) => {
    const routes = staticRoutes();

    // 🔴 ВИНЯТОК НА МАРШРУТ, ЯКОГО НЕМАЄ, — ПРОТУХЛИЙ ВИНЯТОК. Без цього
    // перелік нижче ріс би мовчки: сторінку перейменували, виняток
    // лишився й колись накриє чуже імʼя.
    const stale = NOT_IN_MENU.filter((e) => !routes.includes(e.path));
    expect(
      stale.map((e) => e.path),
      'виняток на маршрут, якого в коді вже немає',
    ).toEqual([]);

    const visible = routes.filter(
      (r) => !NOT_IN_MENU.some((e) => e.path === r),
    );
    // Знаменник: «усі в меню» над порожнім переліком нічого не варте.
    expect(visible.length, 'видимих маршрутів замало').toBeGreaterThan(5);

    const res = await request.get(`${API}/navigation`);
    expect(res.ok(), `GET ${API}/navigation → ${res.status()}`).toBe(true);
    const body = (await res.json()) as Record<string, NavItem[] | undefined>;
    const roots = [
      ...(body.header ?? []),
      ...(body.footer ?? []),
      ...(body.mobile ?? []),
    ];
    const all = flatten(roots);
    const inMenu = new Set(all.map((i) => i.href));
    const children = all.length - roots.length;

    const summary =
      `маршрутів видимих ${visible.length}, у меню ${inMenu.size}, ` +
      `з них підпунктів ${children}`;
    console.log(summary);
    testInfo.annotations.push({ type: 'замір', description: summary });

    const missing = visible.filter((r) => !inMenu.has(r));
    expect(
      missing,
      `сторінки існують, а в меню їх немає — читач туди не потрапить: ` +
        `${missing.join(', ')}. Або додай пункт (міграція, як ` +
        `1794700000000-NavigationChildren.ts), або впиши у NOT_IN_MENU ` +
        `з причиною.`,
    ).toEqual([]);

    // 🔴 І НАВПАКИ: виняток, який УЖЕ в меню, — теж протухлий. Інакше
    // перелік винятків і меню знову розійшлися б, цього разу в інший бік.
    const leaked = NOT_IN_MENU.filter((e) => inMenu.has(e.path));
    expect(
      leaked.map((e) => e.path),
      'сторінка і в меню, і у винятках — одне з двох зайве',
    ).toEqual([]);
  });

  // 🔴 CAMP-397. Мало перевірити, що пункт підвалу ВІДКРИВАЄТЬСЯ — треба,
  // щоб він був НАМАЛЬОВАНИЙ. До 26.10.2026 поле `location` у таблиці
  // існувало, API віддавав три розділи, а каркас споживав лише `header`:
  // рядок із `location='footer'` можна було додати в базу й не отримати
  // нічого, мовчки. Саме так `/contact` і не було в жодному меню, хоч
  // сторінка працювала.
  test("кожен пункт розділу footer намальований у підвалі", async ({
    page,
    request,
  }) => {
    const res = await request.get(`${API}/navigation`);
    expect(res.ok(), `GET ${API}/navigation → ${res.status()}`).toBe(true);
    const body = (await res.json()) as Record<string, NavItem[] | undefined>;
    const items = body.footer ?? [];
    test.skip(items.length === 0, "у базі немає пунктів підвалу");

    await page.goto("/");
    const nav = page.locator('footer nav[aria-label="More"]');
    await expect(
      nav,
      "підвал не малює розділ footer — поле в базі є, рендера немає",
    ).toBeVisible();

    for (const item of items) {
      await expect(
        nav.locator(`a[href="${item.href}"]`),
        `пункт ${item.href} є в базі, але не намальований у підвалі`,
      ).toBeVisible();
    }
  });
});

/**
 * CAMP-448, пункт 5 — підвал як витвір, а не смужка (знімки 441/25–441/26).
 *
 * 🔴 ТУТ ПЕРЕВІРЯЄТЬСЯ СТРУКТУРА, А НЕ ВИГЛЯД. Було три плоскі ряди
 * посилань однакового розміру; стало чотири колонки за призначенням.
 * Ієрархія — це те, що читач бачить першим, і те, що найлегше загубити
 * наступною правкою.
 */
test.describe("🔴 CAMP-448 — підвал", () => {
  test("чотири колонки, і кожна названа", async ({ page }) => {
    await page.goto("/");

    const grid = page.locator("footer > div > div").first();
    const cols = await grid.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
    expect(cols, `колонок ${cols}, а має бути чотири на цій ширині`).toBe(4);

    // Правові сторінки лишились на місці — їх будує LEGAL_PAGES, і
    // загубити їх підвалом означало б загубити обовʼязкове посилання.
    const legal = page.locator('footer nav[aria-label="Legal"] a');
    await expect(legal, "правових посилань у підвалі не лишилось").not.toHaveCount(
      0,
    );

    // Атрибуція ODbL має бути ТАМ, ДЕ ПОКАЗАНІ ДАНІ, тобто на кожній
    // сторінці; переїзд у колонку не привід її загубити.
    await expect(
      page.locator("footer", { hasText: "OpenStreetMap contributors" }),
    ).toHaveCount(1);
  });

  test("🔴 «догори» — якір, що працює без скрипта", async ({ page }) => {
    await page.goto("/");

    const toTop = page.getByTestId("to-top");
    await expect(toTop, "посилання «догори» немає").toHaveCount(1);
    // Якір, а не кнопка: саме тому він працює і тоді, коли JS не доїхав.
    await expect(toTop).toHaveAttribute("href", "#top");
    await expect(page.locator("body#top")).toHaveCount(1);

    await page.evaluate(() => window.scrollTo(0, 4000));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await toTop.click();
    await expect
      .poll(() => page.evaluate(() => window.scrollY), {
        message: "сторінка не повернулась угору",
      })
      .toBeLessThan(50);
  });
});

/**
 * CAMP-448, пункт 3 — перемикач день/ніч.
 *
 * 🔴 ТЕМНА ТЕМА БУЛА В НАС ІЗ ПЕРШОГО ДНЯ, І ЧИТАЧ ДО НЕЇ НЕ ДОТЯГУВАВСЯ.
 * Усі токени описані двічі — `@media (prefers-color-scheme: dark)` і
 * `:root[data-theme="dark"]`, — тож людина зі світлою системою не могла
 * обрати темну НІКОЛИ.
 */
test.describe("🔴 CAMP-448 — перемикач теми", () => {
  test("три стани по колу, і фон справді міняється", async ({ page }) => {
    await page.goto("/");
    const button = page.getByTestId("theme-toggle");
    await expect(button, "перемикача немає").toHaveCount(1);

    const theme = () =>
      page.evaluate(() => document.documentElement.dataset.theme ?? null);
    const bg = () =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    // Поки вибору немає — атрибута немає, і сайт іде за системою.
    expect(await theme(), "на старті вже стоїть вибір").toBeNull();

    await button.click();
    expect(await theme()).toBe("light");
    const light = await bg();

    await button.click();
    expect(await theme()).toBe("dark");
    const dark = await bg();
    // 🔴 Не просто «атрибут змінився»: фон мусить справді стати іншим,
    // інакше перемикач пересував би лише рядок у розмітці.
    expect(dark, `фон не змінився: ${light} → ${dark}`).not.toBe(light);

    await button.click();
    expect(await theme(), "третій клік не повернув вибір системі").toBeNull();
  });

  test("🔴 вибір переживає перезавантаження і ставиться до першого малювання", async ({
    page,
  }) => {
    await page.goto("/");
    const button = page.getByTestId("theme-toggle");
    await button.click();
    await button.click();
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe("dark");

    await page.reload();
    // 🔴 Без скрипта в `<head>` тут був би спалах білого: React ставить
    // атрибут після гідратації. Тому перевіряємо і сам атрибут, і те,
    // що інструкція приїхала у ВІДДАНОМУ HTML.
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "вибір не пережив перезавантаження",
    ).toBe("dark");

    const html = await page.content();
    expect(html, "у сторінці немає скрипта, що ставить тему до рендера").toContain(
      "ct-theme",
    );
  });

  test("🔴 сміття в сховищі ігнорується, а не ставиться атрибутом", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("ct-theme", "chartreuse"));
    await page.reload();
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme ?? null),
      "невідоме значення доїхало до атрибута",
    ).toBeNull();
  });
});
