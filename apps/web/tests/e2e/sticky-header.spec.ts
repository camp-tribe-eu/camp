import { expect, test } from "@playwright/test";

// CAMP-374 — липка шапка, скло й кнопки за темою.
//
// 🔴 ЧОМУ ЦЕ НЕ «КОСМЕТИКА». Доки шапка була `static`, бургер їхав геть
// разом із нею: читач на телефоні, прокрутивши перелік кемпінгів, не мав
// доступу до меню взагалі, доки не прокрутить назад угору.
//
// Кожне твердження нижче — рядок зі «Способу перевірки» картки, і кожне
// міряє ЖИВУ сторінку, а не токен: значення, що існує в CSS і не доїхало
// до розмітки, — рівно той клас дефекту, яким була CAMP-352.

// 🔴 СТОРІНКА, ЯКА ДОВГА ЗАВЖДИ — І ЧОМУ НЕ `/camping`.
//
// Перша редакція прокручувала `/camping` на 1200 px. На фікстурі CI там
// 72 кемпінги, тож сторінка коротка: заміряно в прогоні — `scrollY`
// вийшов 199 на десктопі й НУЛЬ на телефоні. Головне твердження
// («шапка лишилась на верхівці») було б при цьому ЗЕЛЕНИМ НІ ПРО ЩО.
//
// Спіймала це пара, яку я поставив поруч саме на такий випадок — і це
// єдина причина, чому я про це дізнався. Тепер беремо правову сторінку
// (суцільний текст, довгий за будь-яких даних) і рахуємо запас
// прокрутки З САМОЇ СТОРІНКИ, а не вгадуємо число.
const LONG = "/legal/terms";

async function scrollToEnd(page: import("@playwright/test").Page) {
  const max = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  expect(
    max,
    `${LONG} не прокручується на цьому розмірі — твердження нижче безпредметні`,
  ).toBeGreaterThan(200);
  await page.evaluate((y) => window.scrollTo(0, y), max);
  expect(
    await page.evaluate(() => window.scrollY),
    "сторінка не прокрутилась",
  ).toBeGreaterThan(200);
}

// 🔴 ШАПКА САЙТУ НАЗИВАЄТЬСЯ `data-testid`, А НЕ ТЕГОМ `header`.
//
// Перша редакція брала `locator("header")` — і впала на `/legal/terms`
// зі «strict mode violation: resolved to 2 elements». Другий `<header>`
// там свій, у `legal/[slug]/page.tsx`: заголовок правового документа.
// Те саме чекало б на сторінці кемпінгу і маршруту — обидві мають
// власний `<header>`.
//
// Це не дрібниця розбору: якби Playwright мовчки брав перший, тест на
// «шапка лишилась на верхівці» міряв би заголовок СТАТТІ, тобто був би
// зеленим ні про що. Межа задана тим, ЩО міряємо, а не тим, що
// трапилось першим у DOM.
test.describe("🔴 CAMP-374 — шапка лишається з читачем", () => {
  for (const [name, width, height] of [
    ["телефон", 375, 812],
    ["десктоп", 1280, 800],
  ] as const) {
    test(`${name}: після прокручування шапка на місці`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(LONG);

      const top = async () =>
        page.getByTestId("site-header").evaluate((el) => el.getBoundingClientRect().top);

      expect(await top(), "шапка не на верхівці до прокручування").toBe(0);
      await scrollToEnd(page);
      expect(await top(), "шапка поїхала геть при прокручуванні").toBe(0);
    });
  }

  // 🔴 ЦЕЙ ВИПАДОК БУВ ЗЕЛЕНИЙ І БЕЗ ЛИПКОЇ ШАПКИ — тобто стеріг
  // головну тезу картки й не міг почервоніти. Заміряно рецензією:
  // прибери `sticky top-0`, і він усе одно проходить. Дві причини, і
  // обидві треба було закрити:
  //
  //   • `toBeVisible()` НЕ ЗНАЄ ПРО ВІКНО. Воно питає коробку й
  //     відсутність `display:none`. Унизу /legal/terms бургер мав
  //     `top = -4071` — на чотири тисячі пікселів вище екрана — і
  //     лишався «видимим».
  //   • `click()` САМ ПРОКРУЧУЄ до елемента. `scrollY` падав 4079 → 0,
  //     тобто Playwright робив рівно те «прокрутити назад угору», чого
  //     читач, за словами цієї ж картки, робити не має.
  //
  // Тепер питаємо те, чого дефект задовольнити не може: бургер у межах
  // вікна, він топовий елемент у своїй точці, і клік не зрушив сторінку.
  test("🔴 бургер досяжний саме ПІСЛЯ прокручування", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(LONG);
    await scrollToEnd(page);

    const burger = page.getByTestId("burger-open");
    await expect(burger, "бургера не видно після прокручування").toBeVisible();

    const box = await burger.boundingBox();
    expect(box, "у бургера немає коробки").not.toBeNull();
    const height = page.viewportSize()!.height;
    expect(box!.y, `бургер вище вікна: top=${box!.y}`).toBeGreaterThanOrEqual(0);
    expect(
      box!.y + box!.height,
      `бургер нижче вікна: bottom=${box!.y + box!.height} при ${height}`,
    ).toBeLessThanOrEqual(height);

    // Чи справді в нього можна поцілити: щось інше могло лягти зверху.
    const onTop = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return !!el?.closest('[data-testid="burger-open"]');
      },
      [box!.x + box!.width / 2, box!.y + box!.height / 2] as const,
    );
    expect(onTop, "у точці бургера лежить щось інше").toBe(true);

    const before = await page.evaluate(() => window.scrollY);
    await burger.click();
    expect(
      await page.evaluate(() => window.scrollY),
      "клік прокрутив сторінку — значить, бургера на екрані не було",
    ).toBe(before);

    await expect(
      page.getByTestId("burger-panel"),
      "бургер не відкрив меню",
    ).toBeVisible();
  });

  // 🔴 ПАСТКА, ЯКУ НАЗИВАЄ САМА КАРТКА. Липка шапка не сміє накрити
  // перший елемент сторінки. `sticky` (на відміну від `fixed`) лишається
  // в потоці, тож місце резервується саме — але сказати це й перевірити
  // це різні речі, і перевіряємо на ТРЬОХ сторінках, не на одній.
  for (const path of ["/camping", "/guides", "/tools"]) {
    test(`${path}: перший елемент не під шапкою`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(path);
      const h = await page
        .getByTestId("site-header")
        .evaluate((el) => el.getBoundingClientRect().bottom);
      const first = await page
        .locator("main")
        .evaluate((el) => el.getBoundingClientRect().top);
      expect(h, "шапка нульової висоти — міряємо не те").toBeGreaterThan(10);
      expect(
        first,
        `${path}: вміст починається під шапкою`,
      ).toBeGreaterThanOrEqual(h);
    });
  }
});

test.describe("🔴 CAMP-374 — скло й кнопки в РЕНДЕРІ, не в токені", () => {
  test("шапка справді розмиває те, що під нею", async ({ page }) => {
    await page.goto("/camping");
    const filter = await page
      .getByTestId("site-glass")
      .evaluate((el) => getComputedStyle(el).backdropFilter);
    // 🔴 ЧИТАЄМО ОБИДВІ ФОРМИ, І ЦЕ НЕ ПЕРЕСТРАХОВКА. Саме цей тест
    // спіймав, що в зібраному CSS лишалась ТІЛЬКИ префіксна форма, якої
    // Chromium 152 уже не розуміє: `backdrop-filter` там рахувався
    // `none` — тобто скла не було в Chrome і Firefox, а в Safari було.
    // Знімки цього не побачили.
    const webkit = await page
      .getByTestId("site-glass")
      .evaluate(
        (el) =>
          (getComputedStyle(el) as unknown as Record<string, string>)
            .webkitBackdropFilter ?? "none",
      );
    expect(
      `${filter} ${webkit}`,
      "скла немає: значення є в CSS, але не доїхало до розмітки",
    ).toMatch(/blur\(/);
  });

  // 🔴 ТРИ З ЧОТИРЬОХ ТВЕРДЖЕНЬ ТУТ БУЛИ ЗЕЛЕНІ ЗА ПОБУДОВОЮ, і
  // рецензія заміряла кожне:
  //
  //   • `[data-ct-button]` без межі ловив ПЛАШКУ ЗГОДИ: на фікстурі CI
  //     /camping мав рівно дві такі кнопки, обидві банера, і `.first()`
  //     віддавав «Reject». Плюс `.first()` разом із `toHaveCount(1)` —
  //     тавтологія: перший елемент завжди один.
  //   • тривалість 0.2s віддає `--default-transition-duration` у
  //     globals.css НЕЗАЛЕЖНО від нашого класу. Заміряно: заміни
  //     `ct-button-motion` на `transition-colors` — усі вісім тестів
  //     лишались зелені.
  //   • насиченість 600 приходила з власного `font-semibold` кнопки
  //     банера, а 16px — це типовий `--text-base` Tailwind, не наш
  //     токен (`--text-*` у темі не визначений узагалі).
  //
  // Лишилось те, що СПРАВДІ від нас: радіус із `--radius → --r-sm` і
  // перелік властивостей переходу, у якому є `opacity` — саме ним
  // гасне вимкнена кнопка, і саме його `transition-colors` не має.
  test("кнопка бере радіус із теми й гасне плавно", async ({ page }) => {
    // /tools: 27 кнопок країн будуються зі сталої `FUEL_COUNTRIES`,
    // тобто є незалежно від того, скільки рядків у фікстурі.
    await page.goto("/tools");
    const buttons = page.locator("main [data-ct-button]");
    const found = await buttons.count();
    expect(found, "у вмісті /tools немає жодної нашої кнопки").toBeGreaterThan(
      0,
    );

    const got = await buttons.first().evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        radius: s.borderTopLeftRadius,
        property: s.transitionProperty,
        duration: s.transitionDuration,
      };
    });
    expect(got.radius, "радіус не з теми").toBe("12px");
    expect(
      got.property,
      `перехід не чіпає opacity — вимкнена кнопка клацатиме: «${got.property}»`,
    ).toContain("opacity");
    expect(got.duration, "тривалість переходу не задана").toContain("0.2s");
  });
});

// 🔴 CAMP-374 — шари мапи не сміють вилазити на шапку.
//
// Заміряно рецензією: `maplibre-gl.css` дає завісі «прокрутка з Ctrl»
// `z-index: 99999`, а контейнер мапи власного контексту накладання не
// створював (`overflow: hidden` його не створює). Один рух коліщатка над
// мапою — і шапка з усіма шістьма пунктами меню опинялась під сірою
// плівкою. Жоден наш токен цього б не перебив: іменована шкала
// закінчується на 26. Лік — `.maplibregl-map { isolation: isolate }`.
//
// 🔴 ЧОМУ СИНТЕТИЧНИЙ ВИПАДОК, А НЕ СПРАВЖНЯ МАПА. Перша редакція
// ходила на сторінку маршруту й крутила коліщатком. Вона падала на
// firefox-раннері, і діагноз був хибний: мапа вантажиться
// `dynamic(() => import('./route-map'), { ssr: false })`, тож на момент
// перевірки в розмітці не було НІ полотна, ні запасного блоку —
// «на сторінці маршруту немає мапи» казало про швидкість завантаження
// чанка, а не про шари.
//
// Властивість, яку треба стерегти, вендорного полотна не потребує: це
// контракт між ЙОГО класом і НАШИМ правилом. Тому кладемо елемент із
// тим класом і нащадком на 99999 самі.
//
// Що клас справді наш — заміряно окремо, на /map у браузері:
// `document.querySelectorAll('.maplibregl-map').length === 1`, і це той
// самий контейнер, якому ми даємо свої класи. MapLibre вішає його сам
// під час ініціалізації.
test.describe("🔴 CAMP-374 — мапа не накриває шапку", () => {
  for (const [name, width, height] of [
    ["телефон", 375, 812],
    ["десктоп", 1280, 800],
  ] as const) {
    test(`${name}: шар з мапи лишається в її межах`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/camping");

      const header = (await page.getByTestId("site-header").boundingBox())!;
      expect(header, "шапки немає — міряємо не те").not.toBeNull();
      expect(header.height, "шапка нульової висоти").toBeGreaterThan(10);

      // 🔴 СЦЕНА ВІДТВОРЮЄ СПРАВЖНЮ, А НЕ «ЩОСЬ ІЗ ВЕЛИКИМ z-index».
      //
      // Перша редакція цього випадку була ЗЕЛЕНА ЗА ПОБУДОВОЮ: я клав
      // завісу в контейнер, якого шапка не перекривала, і вона нічого
      // не накривала й без правила. Заміряно в браузері — обидва боки
      // давали ту саму відповідь, тобто сторож не розрізняв.
      //
      // Справжню структуру зняв із живої сторінки маршруту:
      //   .maplibregl-map              position: relative, overflow: hidden
      //     .maplibregl-canvas-container  static
      //       .maplibregl-cooperative-gesture-screen  absolute, z-index 99999
      // Контейнер із класом `maplibregl-map` — це НАШ div, клас вішає
      // MapLibre при ініціалізації.
      //
      // І головне: дефект видно лише там, де липка шапка ПЕРЕКРИВАЄ
      // коробку мапи. Після виправлення геометрії сцена розрізняє —
      // заміряно в браузері:
      //   без isolation: isolate → зверху «probe-scrim»
      //   з  isolation: isolate → зверху «probe-bar»
      await page.evaluate(() => {
        const map = document.createElement("div");
        map.className = "maplibregl-map";
        map.setAttribute("data-testid", "fake-map");
        map.style.cssText =
          "position:fixed;top:0;left:0;right:0;height:300px;overflow:hidden";
        const canvasWrap = document.createElement("div");
        const scrim = document.createElement("div");
        scrim.setAttribute("data-testid", "fake-scrim");
        scrim.style.cssText =
          "position:absolute;inset:0;background:rgba(0,0,0,.4);z-index:99999";
        canvasWrap.appendChild(scrim);
        map.appendChild(canvasWrap);
        document.body.appendChild(map);
      });

      // Пара: сам нащадок таки намальований, інакше «шапка зверху» було
      // б істинним і над відсутнім шаром.
      await expect(
        page.getByTestId("fake-scrim"),
        "підставний шар не намалювався — випадок безпредметний",
      ).toBeVisible();

      const onTop = await page.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x, y);
          return {
            inHeader: !!el?.closest('[data-testid="site-header"]'),
            what: el?.getAttribute("data-testid") ?? el?.tagName ?? "—",
          };
        },
        [header.x + header.width / 2, header.y + header.height / 2] as const,
      );
      expect(
        onTop.inHeader,
        `шапку накрило: у її центрі лежить «${onTop.what}»`,
      ).toBe(true);
    });
  }
});

// 🔴 CAMP-374 — скло не сміє з'їдати вікно у шухляди.
//
// `backdrop-filter` робить елемент КОНТЕЙНЕРОМ для нащадків із
// `position: fixed`. Шухляда меню — `fixed inset-0` усередині шапки, тож
// щойно скло ожило в Chromium, затемнення й панель стиснулись у смужку
// заввишки з шапку. Заміряно в браузері на синтетичному випадку:
//
//   без backdrop-filter → fixed-нащадок 1024×768 (усе вікно)
//   з  backdrop-filter → fixed-нащадок 1024×64  (коробка шапки)
//
// Упало в трьох браузерах одразу — і жоден зі сторожів цієї картки
// цього не бачив, бо всі вони дивились на саму шапку, а не на те, що в
// ній живе.
test.describe("🔴 CAMP-374 — шухляда отримує все вікно, а не шапку", () => {
  test("затемнення шухляди заввишки з екран", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/legal/terms");
    await page.getByTestId("burger-open").click();

    const scrim = await page.getByTestId("burger-scrim").boundingBox();
    expect(scrim, "затемнення не намалювалось").not.toBeNull();
    const view = page.viewportSize()!;
    expect(
      Math.round(scrim!.height),
      `затемнення ${Math.round(scrim!.height)} px при вікні ${view.height} px ` +
        "— шапка стала контейнером для fixed",
    ).toBe(view.height);
    expect(Math.round(scrim!.width)).toBe(view.width);

    // Пара: панель теж має бути на весь екран, інакше «затемнення
    // правильне» нічого не каже про те, куди можна клікнути.
    const panel = await page.getByTestId("burger-panel").boundingBox();
    expect(panel, "панель не намалювалась").not.toBeNull();
    expect(Math.round(panel!.height), "панель коротша за екран").toBe(
      view.height,
    );
  });
});
