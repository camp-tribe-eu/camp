import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { serverlessRun } from "./src/lib/cli-args";

// Cross-browser (chromium/firefox/webkit) + cross-platform (desktop/mobile viewport)
// coverage in one config, per CAMP-13.
// 🔴 Debt #3 (CAMP-60): visual regression, and deliberately narrow.
//
// Chromium only, two viewports, four pages. Screenshotting 1000
// generated campsite pages would produce 1000 baselines that all change
// together whenever a shared component does — a diff nobody reviews and
// therefore a guard nobody reads. These are the layouts where a CSS
// regression is invisible to every other test we have.
//
// ❌ Percy is not used: it is paid, and by the owner's standing decision
// never through the UTD account. `toHaveScreenshot()` is free and
// already in the stack.
const visualProject = {
  name: "visual",
  testDir: "./tests/visual",
  use: { ...devices["Desktop Chrome"] },
};

// 🔴 CAMP-134: the things that are only true at 61 557 campsites.
//
// Nine tests — six in the browser, three without one. NOT in the default
// set, for the same reason the visual project is not: they need a build
// made from the full database, and run against CI's 72-row fixture they
// would not fail, they would pass over nothing, which is the exact
// failure the card exists to stop.
//
// Every one of them gates itself on the size of what it is looking at —
// the built map index above 100 regions, the search index above five
// files, the API above 10 000 rows — and fails rather than skips below
// it. Review caught the /search test shipping without that gate, which
// made this very sentence false for one of the nine.
//
// The workflow that starts them is .github/workflows/scale-check.yml.
//
// Chromium only, deliberately. The defects these catch are about how much
// data arrives and when — not about how a browser renders it. Six engines
// would multiply the slowest suite we have by six to re-answer the same
// question. Cross-browser coverage stays in tests/e2e, on the fixture,
// where it is fast.
const scaleProject = {
  name: "scale",
  testDir: "./tests/scale",
  use: { ...devices["Desktop Chrome"] },
};

/** Projects that never touch a page, so they never need a server. */
const SERVERLESS_PROJECTS = new Set(["unit"]);

/**
 * Чи ганяти повну матрицю браузерів. `ci.yml` ставить це на злитті в
 * `main` і на ручному запуску; на PR — ні. Локально теж ні, щоб прогін
 * на ноуті був удвічі коротшим.
 */
const FULL_MATRIX = process.env.FULL_MATRIX === "1";

/**
 * 🔴 ДЕРЕВО, НА ЯКОМУ ЙДЕ ПРОГІН, МУСИТЬ ЗБІГАТИСЯ З LOCK-ФАЙЛОМ.
 *
 * Заміряно 03.11.2026, і це коштувало мені цілого дня чисел, які нічого
 * не означали: `package-lock.json` казав `@playwright/test` **1.64.1**,
 * а в `node_modules` лежав **1.63.0**. Тека `node_modules` була від
 * 02.11 21:15, lock-файл — від сьогоднішнього 11:40, коли злили
 * оновлення. Тобто після злиття ніхто не зробив `npm ci`, і п'ятнадцять
 * локальних прогонів поспіль ішли НЕ на тому коді, що в CI. Різниця не
 * теоретична: 1.63 компілює JSX власним runtime, 1.64 віддає справжні
 * елементи React — тобто саме те, на чому стоїть увесь місток у
 * `tests/unit/render-component.tsx`.
 *
 * 🔴 ЧОМУ ЦЕ ПАДІННЯ, А НЕ ПОПЕРЕДЖЕННЯ. Прогін на чужому дереві дає
 * число, яке виглядає як вердикт і ним не є. Ціна ХИБНОГО спрацювання —
 * одна команда `npm ci`, тобто площа ураження сторожа менша за площу
 * дефекту. Попередження в стіні виводу я б не побачив: я шукаю в ньому
 * слово «passed».
 *
 * У CI перевірка мовчить: там `npm ci` виконується завжди, і читати
 * lock-файл двічі немає потреби.
 */
function installedMatchesLock(): void {
  if (process.env.CI) return;
  const lockPath = join(__dirname, "..", "..", "package-lock.json");
  let want: string | undefined;
  let have: string | undefined;
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
      packages?: Record<string, { version?: string }>;
    };
    want = lock.packages?.["node_modules/@playwright/test"]?.version;
    have = (
      JSON.parse(
        readFileSync(
          join(
            __dirname,
            "..",
            "..",
            "node_modules",
            "@playwright",
            "test",
            "package.json",
          ),
          "utf8",
        ),
      ) as { version?: string }
    ).version;
  } catch {
    // 🔴 Не можемо прочитати — мовчимо. Сторож, що падає на власній
    // сліпоті, зупиняє роботу там, де не мав про неї думки.
    return;
  }
  if (!want || !have || want === have) return;
  throw new Error(
    [
      `node_modules не збігається з package-lock.json: @playwright/test ${have} встановлено, ${want} у lock-файлі.`,
      "Прогін на такому дереві дає число, яке виглядає як вердикт і ним не є.",
      "Полагодь так:  npm ci",
    ].join("\n"),
  );
}

installedMatchesLock();

export default defineConfig({
  testDir: "./tests/e2e",
  // 🔴 `tests/e2e/touch/` НЕ біжить у звичайних проєктах, і це навмисно.
  // Там лежать тести, яким потрібна комбінація «дотик + широкий екран»;
  // у проєкті без дотику вони або падали б, або — гірше — зеленіли б,
  // не перевіривши нічого. Єдиний, хто туди заходить, — `tablet-touch`
  // нижче, і він перекриває цей виняток власним `testDir`.
  testIgnore: ["**/touch/**"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 🔴 The JSON report is not decoration. `retries: 1` means a test that
  // fails and then passes leaves the job GREEN, and on 23.09.2026 that
  // hid a real design fault for a whole CI run — the error reporter
  // attached its listeners after hydration, and the only evidence was a
  // retry line nobody would read. scripts/ci/check-flaky.mjs reads this
  // file and fails the build on any flake, so "green" means green.
  reporter: process.env.CI
    ? [
        ["html"],
        ["github"],
        ["json", { outputFile: "playwright-report/report.json" }],
      ]
    : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",

    // 🔴 CAMP-334. ЗАВИСАННЯ МУСИТЬ ПАДАТИ ШВИДКО Й НАЗИВАТИ ДІЮ.
    //
    // Сім разів за три доби прогін валився так: один тест зʼїдав УВЕСЬ
    // бюджет (90 с на webkit), а повтор проходив за секунду. Розподіл
    // без середини — це зависання, не повільність, і бюджет тут уже
    // піднімали тричі. Четвертого разу не буде.
    //
    // Без `actionTimeout` окрема дія не має межі ВЗАГАЛІ: вона просто
    // їсть бюджет тесту, і в звіті лишається «Test timeout exceeded» —
    // речення, яке не називає НІЧОГО. З межею падіння приходить за 20 с
    // і каже, на якій саме дії та на якому локаторі.
    //
    // 20 с — не «швидше», а «достатньо повільно, щоб не вигадати нових
    // флуктуацій»: найдовша чесна дія в нас це клік по мапі, і вона
    // вкладається в одиниці секунд. Навігація має свою межу, бо
    // `next start` на холодному маршруті справді думає довше за клік.
    actionTimeout: 20_000,
    navigationTimeout: 30_000,

    // 🔴 `on-first-retry` ЗАПИСУЄ ПОВТОР, ТОБТО ТУ СПРОБУ, ЩО ПРОЙШЛА.
    //
    // Саме через це в мене сім разів не було жодного сліду того, що
    // зависло: падала перша спроба, а траса лишалась від другої, де все
    // гаразд. `retain-on-failure` пише кожну спробу й лишає тільки
    // невдалі — тобто рівно ту, заради якої все це.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // \ud83d\udd34 The unit project is pure logic \u2014 no browser, no server \u2014 and
  // making it wait 60 s for `next start` (which needs a build that may
  // not exist) is how a fast check stops being run at all. If every
  // project asked for on the command line is a serverless one, no server
  // is started. Any other selection, and CI's full run, behave as before.
  webServer:
    process.env.BASE_URL || serverlessRun(process.argv, SERVERLESS_PROJECTS)
      ? undefined
      : {
          command: "npm run start -- -p 3000",
          url: "http://localhost:3000",
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
  // Baselines are per-platform by nature — a font renders differently on
  // macOS and on Linux. Ours are generated on the CI runner and only
  // compared there; the path carries the platform so a locally generated
  // one can never be mistaken for the real baseline.
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFileName}/{arg}-{platform}{ext}",

  // 🔴 The visual project is NOT in the default set, and the split is
  // made by a flag rather than by listing project names on the command
  // line. `npm run test:e2e` is a bare `playwright test`, so a project
  // added here joins it automatically — which is what we want for a new
  // browser, and exactly what we do not want for the screenshots, whose
  // baselines only exist for the CI platform.
  //
  // A hand-written `--project=…` list in package.json would have the
  // failure this repository has already been bitten by twice: a scope
  // maintained by hand that silently stops covering what it names.
  projects: process.env.SCALE
    ? [scaleProject]
    : process.env.VISUAL
      ? [visualProject]
      : [
          // 🔴 Pure logic, no browser and no server. The map filters decide what
          // a reader is shown, and that decision is worth testing in
          // milliseconds rather than only through six browsers — the same rule
          // the API side follows, where filters.ts has its own unit spec.
          { name: "unit", testDir: "./tests/unit" },
          // 🔴 БЮДЖЕТ НА ПРОЄКТ, І ЦЕ ЗАМІР, А НЕ ВРАЖЕННЯ (CAMP-304).
          //
          // Три різні тести за три PR уперлись у ту саму межу й саме в
          // найповільнішому браузері: `legal.spec.ts`, `guides.spec.ts` і
          // `touch-targets.spec.ts`. Латати кожен поіменно означало б латати
          // випадок замість правила, тож спершу поміряли.
          //
          // Зріз 20.10.2026: 21 прогін CI, 23 звіти, 74 127 результатів.
          // Порівняння чесне — лише по 321 тесту, який ганяють УСІ чотири
          // браузерні проєкти, бо медіани різних підмножин не порівнюються:
          //
          //   webkit / chromium  = 2.79  (медіани 663 і 238 мс)
          //   firefox / chromium = 1.96
          //   mobile  / chromium = 1.23
          //
          // Відношення webkit лежить у 2.49–3.77 в КОЖНОМУ з 23 звітів, тобто
          // це системна властивість рушія, а не шум прогону. На тих 321
          // тестах webkit повільніший у 246, швидший у 51, рівний у 24.
          //
          // І головне: усі 18 таймаутів за ті 21 прогін — webkit (12) і
          // firefox (6). У chromium і mobile-chrome НУЛЬ.
          //
          // 🔴 ЦЕ НЕ ПІДНЯТТЯ ГЛОБАЛЬНОГО ТАЙМАУТА, І РІЗНИЦЯ ІСТОТНА.
          // Картка окремо попереджає: більший бюджет для всіх сховав би й
          // справжні зависання — один із трьох випадків був саме дефектом
          // (банер додавав `padding-bottom` після першого малювання, і умова
          // ставала недосяжною назавжди). Множник на рушій лишає сувороість
          // ОДНАКОВОЮ: «удвічі повільніше за норму цього браузера» червоніє
          // так само швидко, як і раніше.
          //
          // 🔴 ЧОГО ЦЕЙ ЗРІЗ НЕ ДОВОДИТЬ. `playwright-report` вивантажується
          // лише при `if: failure()`, тож усі 23 звіти — з прогонів, які
          // впали. Абсолютні числа («скільки тестів за 15 с») через це
          // завищені й читаються як стеля. Але ВІДНОШЕННЯ стійке до цього:
          // webkit і chromium у кожному звіті міряні в тих самих умовах того
          // самого прогону.
          { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
          {
            name: "firefox-desktop",
            timeout: 60_000,
            use: {
              ...devices["Desktop Firefox"],
              // 🔴 ПРИЧИНА МИГОТІННЯ `hub-filters.spec.ts:60`, І ЦЕ ЗАМІР.
              //
              // Сторінка регіону віддається з `Cache-Control: s-maxage=900,
              // stale-while-revalidate=31535100` (це Next, для CDN). Firefox
              // читає `stale-while-revalidate` і для документів у приватному
              // кеші: на ПОВТОРНИЙ перехід за адресою, яку вже завантажував,
              // він віддає копію з кешу одразу, а другим запитом (`If-None-
              // Match`, `Cache-Control: max-age=0`) перевіряє її у фоні.
              // Playwright бачить два документні запити в одному фреймі, і
              // `expect(page).toHaveURL` лишається в «waiting for navigation to
              // finish» із `Received string: ""`, хоча сторінка вже показана
              // (знімок помилки містить хаб).
              //
              // Тест просто ходить хаб → фільтр → «clear filters» → хаб, тож
              // другий захід на хаб і є повтором. Трасса падіння: запит №1 без
              // мережі (`wait: -1`), запит №2 — 304.
              //
              // Заміряно на `apps/web/tests/e2e/hub-filters.spec.ts:60`,
              // firefox-desktop, `--retries=0 --repeat-each=60`, одна й та
              // сама збірка: без цього преференса червоніло 22 з 60, з ним
              // 0 з 60. Усі 22 — той самий текст помилки (`toHaveURL`,
              // `Received string: ""`). Голе «goto → клік → клік назад» у
              // окремому спеці: 12 з 20 при стандартних преференсах і 0 з 20
              // з вимкненим.
              //
              // 🔴 ЦЕ НЕ ПОДОВЖЕННЯ ТАЙМАУТА Й НЕ ДОЗВІЛ НА БЛИМАННЯ. Жодне
              // твердження не слабшає: тест, як і раніше, перевіряє адресу після
              // кліку. Вимикається лише оптимізація браузера, якої в тесту
              // немає причини перевіряти, бо вона дає два запити замість
              // одного до сервера, адресу якого тест і так міряє.
              // Користувач Firefox її отримує як є — це не дефект сторінки,
              // а взаємодія кешу рушія з протоколом керування ним.
              launchOptions: {
                firefoxUserPrefs: {
                  "network.http.stale_while_revalidate.enabled": false,
                },
              },
            },
          },
          // 🔴 WEBKIT — ЛИШЕ НА ЗЛИТТІ, І ЦЕ ЗАМІР, А НЕ ВТОМА ВІД НЬОГО.
          //
          // Зріз за 7 діб (51 червоний прогін, 144 рядки падінь, 38
          // флуктуацій), по тому, скільки УНІКАЛЬНИХ дефектів зловив кожен
          // проєкт сам-один:
          //
          //   mobile-chrome      4 дефекти    4 флуктуації
          //   firefox-desktop    3            2
          //   chromium-desktop   1            1
          //   webkit-desktop     0           31
          //
          // Тобто за тиждень НЕ БУЛО жодного дефекту, який побачив би лише
          // webkit — і він дав 82% усіх флуктуацій, переважно таймаутами
          // (21 з 31). Кожна така флуктуація червонить `check-flaky` і коштує
          // повний цикл CI, бо сторож мигтіння має рацію: повтор, що зеленіє,
          // це форма справжнього переривчастого дефекту.
          //
          // 🔴 ЧОГО ЦЕЙ ЗРІЗ НЕ ДОВОДИТЬ: що Safari нам не потрібен. «За сім
          // діб не було webkit-дефекту» не означає «їх не буває» — сьогодні
          // ж був дефект, видимий ЛИШЕ в Chrome. Тому проєкт не видалено, а
          // перенесено на злиття: на PR він мовчить, на `main` і на ручному
          // запуску біжить повністю. Safari-дефект знайдеться перед деплоєм,
          // а не перед кожним пушем.
          //
          // Вмикається змінною, а не назвою гілки: конфіг не має знати про
          // GitHub, а `ci.yml` ставить її там, де повна матриця потрібна.
          ...(FULL_MATRIX
            ? [
                {
                  name: "webkit-desktop",
                  timeout: 90_000,
                  use: { ...devices["Desktop Safari"] },
                },
              ]
            : []),
          { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
          // 🔴 CAMP-468: ДОТИК НА ШИРОКОМУ ЕКРАНІ — комбінація, якої не
          // давав жоден із проєктів вище, і саме в ній жив дефект.
          // `chromium-desktop` і `firefox-desktop` без дотику;
          // `mobile-chrome` (Pixel 7, 412 px) вужчий за 1200 і бачить
          // бургер, де розкривача немає взагалі. Тап по тригеру давав
          // емульоване наведення (відкрити) і клік (закрити) підряд —
          // меню блимало, і планшет не міг дістатись підпунктів.
          //
          // 🔴 1280 ВЗЯТО З ПОРОГА ТЕМИ, не з уподобання: нижче 1200
          // шапка показує бургер (`max-width:1199.98px`). Поріг переїде —
          // переїде й це число, бо інакше проєкт мовчки перестане
          // перевіряти те, заради чого існує.
          //
          // 🔴 І ВІН ЗВУЖЕНИЙ `testDir` ДО ОДНІЄЇ ТЕКИ. 11.10.2026
          // власник прибрав `tablet` і `mobile-safari` рівно тому, що
          // вони вшосте ганяли ті самі десктопні твердження в іншому
          // user-agent: 286 тестів, жоден із яких не звертався ні до
          // дотику, ні до ширини. Цей проєкт коштує стільки, скільки
          // коштують його власні тести, і ні секундою більше.
          {
            name: "tablet-touch",
            testDir: "./tests/e2e/touch",
            testIgnore: [],
            use: {
              ...devices["Desktop Chrome"],
              viewport: { width: 1280, height: 800 },
              hasTouch: true,
            },
          },
          // 🔴 `mobile-safari` (iPhone 14) І `tablet` (iPad Mini) ПРИБРАНІ
          // 11.10.2026, рішенням власника, і ось на яких числах.
          //
          // Заміряно по 30 прогонах `ci.yml`: сім випадків, коли тест проходив
          // лише з другої спроби, і **всі сім** — у цих двох проєктах. Нуль у
          // `chromium-desktop`, `firefox-desktop`, `mobile-chrome`. Три різні
          // симптоми (внутрішня помилка WebKit, таймаут, невдале очікування) у
          // двох різних файлах тестів — тобто причина не в тестах.
          //
          // А перевіряли вони те саме, що й решта: жоден із 286 тестів не
          // звертається до дотику чи ширини екрана. Ці два проєкти вшосте й
          // усьоме проганяли десктопні твердження у мобільному user-agent.
          //
          // 🔴 ЩО ЛИШАЄТЬСЯ ПІСЛЯ ЇХ ВИДАЛЕННЯ — бо це не «мінус мобільні»:
          //
          //   · рушій WebKit        — `webkit-desktop`;
          //   · емуляція пристрою і дотик — `mobile-chrome` (Pixel 7);
          //   · ширина телефона     — проєкт `visual` знімає скриншоти на
          //     390×844 (tests/visual/pages.spec.ts:55), тож зламана мобільна
          //     верстка ловиться порівнянням зображень.
          //
          // Прогалина рівно одна й названа: WebKit РАЗОМ з емуляцією
          // пристрою, тобто справжня поведінка iOS Safari на телефоні.
          // Рішення власника: її закриває фінальний раунд QA перед запуском,
          // де проєкт перевіряється цілком і руками.
          //
          // Повертати ці проєкти без тестів, які справді щось мобільне
          // перевіряють, — означає повернути сім флаків і нуль сигналу.
        ],
});
