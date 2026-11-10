import { LEGAL_PAGES } from "../../src/lib/legal";
import { MAP_SOURCES } from "../../src/lib/map-sources";
import { expect, test, type Page } from "./api-request";
import { openMapRetryingThrottle } from "./open-map";

/**
 * Кредит провайдера плиток і кнопки стилів — на ЖИВИХ сторінках, не в
 * вихідному коді.
 *
 * 🔴 ЧОМУ ЦЕ E2E. Сторінка «Cookies» 1.1 стверджує дві речі про мапи:
 * кожна мапа називає провайдера (на самій мапі й рядком під нею), а кнопки
 * зміни стилю є лише на `/map`. Перша половина була неправдою для мапи
 * кемпінгу: `site-map.tsx` мав `attributionControl: false` і не додавав
 * власного контролу, тож кредит стояв лише в підписі, який малює ІНШИЙ
 * компонент (`campsite-media.tsx`). Вказання джерела плиток — умова ліцензії,
 * за якою ми їх показуємо; воно не повинно залежати від того, чи
 * батьківський компонент пам'ятає дописати підпис.
 *
 * 🔴 ЩО ВПАЛО В CI І ЧОМУ (прогін 41421192999, #399). Два тести з семи падали
 * ЛИШЕ на `firefox-desktop`: «element(s) not found» на `map-attribution` і
 * `[data-boilerplate="map-attribution"]`. Не мережа: у тому ж прогоні
 * chromium і mobile-chrome пройшли всі сім, включно з текстом кредиту, який
 * приходить з мережі (TileJSON), а мережевих помилок у журналі нуль. Причина —
 * headless Firefox на раннері без GPU НЕ ВМІЄ WebGL, мапа чесно показує запасний
 * текст (`route-map-unsupported`, `map-unsupported`), і абзаців під мапою, яких
 * вона не малює, там нема. Відтворено локально Firefox із `webgl.disabled`:
 * ті самі дві відмови. Тест вимагав абзац ДО перевірки, чи є мапа взагалі.
 *
 * Тепер три шари, і жоден не послаблено:
 *   A. СТРУКТУРА, від мережі НЕ залежить: де мапа малюється, на ній є контрол
 *      кредиту (елемент у DOM) і під нею — підпис; де мапи немає (без WebGL), є
 *      запасний текст І не було жодного запиту до тайлового сервера (чужі
 *      плитки без мапи не показуються — кредиту нема кому бути).
 *   B. ЖИВИЙ ТЕКСТ кредиту з TileJSON — залежить від мережі. Якщо сервер
 *      плиток недосяжний, тест пропускається ЯВНО й голосно (причина в звіті),
 *      а не зеленіє тихо. Без WebGL перевіряється запасний стан, не пропуск.
 *   C. НЕГАТИВНИЙ КОНТРОЛЬ: той самий предикат бачить ВІДСУТНІСТЬ контролу (на
 *      синтетичному DOM у кожному браузері і на живій сторінці, з якої контрол
 *      видалено). Без цього сторож був би зеленим за побудовою.
 *
 * Мутація «прибрати `addControl(new AttributionControl(…))`» з `site-map.tsx`
 * червонить A1 на chromium і mobile-chrome (див. опис PR).
 */

/**
 * 🔴 Чи вміє цей браузер малювати мапу взагалі (headless Firefox на раннері
 * без GPU — ні, і сторінка чесно показує запасний текст). Питання ставиться
 * ДИФЕРЕНЦІЙНО, а не `test.skip`: там, де мапи бути не може, перевіряється
 * запасний стан.
 */
async function hasWebGl(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    try {
      return !!document.createElement("canvas").getContext("webgl2");
    } catch {
      return false;
    }
  });
}

const TILE_HOST = "tiles.openfreemap.org";
const TILE_STYLE = `https://${TILE_HOST}/styles/liberty`;

/**
 * Чи досяжний тайловий сервер з цього прогону. Напряму `fetch`, а не
 * `request`-фікстура: та несе `x-build-token` на КОЖЕН запит (див.
 * `api-request.ts`) і не повинна дивитись на третю сторону.
 */
async function tilesReachable(): Promise<boolean> {
  try {
    const res = await fetch(TILE_STYLE, { signal: AbortSignal.timeout(8_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Скільки запитів до тайлового сервера зробила сторінка (рахується з моменту виклику). */
function countTileRequests(page: Page): () => number {
  let n = 0;
  page.on("request", (r) => {
    try {
      if (new URL(r.url()).host === TILE_HOST) n++;
    } catch {
      /* не URL — не наш запит */
    }
  });
  return () => n;
}

async function anySpotPath(request: Page["request"]): Promise<string> {
  const res = await request.get(
    `${process.env.API_BASE_URL ?? "http://localhost:3001"}/spots/index`,
  );
  expect(
    res.status(),
    `API відмовив: ${res.status()} ${res.statusText()}`,
  ).toBe(200);
  const body = (await res.json()) as {
    country: string;
    region: string;
    slug: string;
  }[];
  expect(
    Array.isArray(body) && body.length > 0,
    "індекс кемпінгів порожній",
  ).toBe(true);
  const s = body[0];
  return `/camping/${s.country}/${s.region}/${s.slug}`;
}

/**
 * Скільки контролів кредиту MapLibre всередині `scope`. ПРЕДИКАТ, який бачить і
 * наявність, і відсутність (негативний контроль нижче доводить друге). Від
 * мережі не залежить: контрол є в DOM, навіть коли тексту ще немає
 * (`maplibregl-attrib-empty`).
 */
const controlCount = (page: Page, scope: string): Promise<number> =>
  page.locator(`${scope} .maplibregl-ctrl-attrib`).count();

/** Живий текст кредиту: ЧЕКАЄ, поки стиль/TileJSON доїдуть (мережа). */
async function liveCredit(page: Page, scope: string): Promise<string> {
  const control = page.locator(`${scope} .maplibregl-ctrl-attrib`);
  await expect(
    control,
    `на мапі «${scope}» немає контролу кредиту`,
  ).toHaveCount(1);
  await expect(control).toBeVisible();
  // 🔴 20 с, а не 5 за замовчуванням: текст приходить з мережі (TileJSON), і на
  // першому прогоні з холодним кешем 5 с не вистачало (мобільний прогін лишив
  // «кредит на мапі порожній» 1 раз із 3). `check-flaky` валить збірку за
  // будь-який тест, що пройшов лише з повтору.
  await expect
    .poll(async () => (await control.textContent()) ?? "", {
      message: "кредит на мапі порожній",
      timeout: 20_000,
    })
    .toContain("OpenStreetMap");
  return (await control.textContent()) ?? "";
}

const styleButtons = (page: Page) =>
  page.getByRole("group", { name: "Map style" });

/** Одна з трьох сторінок з мапою: як її відкрити, де мапа, що показується без WebGL. */
interface MapPage {
  name: string;
  open: (page: Page, request: Page["request"]) => Promise<void>;
  scope: string;
  /** Рядок під мапою, що називає провайдера (там, де мапа є). */
  caption: (page: Page) => ReturnType<Page["locator"]>;
  /** Те, що сторінка показує замість мапи, коли браузер не вміє WebGL. */
  unsupported: (page: Page) => ReturnType<Page["locator"]>;
  hasStyleButtons: boolean;
}

const PAGES: MapPage[] = [
  {
    name: "мапа кемпінгу",
    open: async (page, request) => {
      await page.goto(await anySpotPath(request));
    },
    scope: '[data-testid="site-map"]',
    caption: (page) => page.getByTestId("campsite-media").locator("figcaption"),
    unsupported: (page) => page.getByTestId("site-map-fallback"),
    hasStyleButtons: false,
  },
  {
    name: "мапа маршруту",
    open: async (page) => {
      // 🔴 СЛАГ БЕРЕТЬСЯ З API, А НЕ З КОДУ (CAMP-479): маршрути в базі.
      const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
      const res = await fetch(`${api}/routes/content`);
      expect(res.ok, `GET /routes/content → ${res.status}`).toBeTruthy();
      const { routes } = (await res.json()) as {
        routes: Array<{ slug: string }>;
      };
      expect(routes.length, "немає жодного маршруту").toBeGreaterThan(0);
      await page.goto(`/routes/${routes[0].slug}`);
    },
    scope: '[data-testid="route-map"]',
    caption: (page) => page.locator('[data-boilerplate="map-attribution"]'),
    unsupported: (page) => page.getByTestId("route-map-unsupported"),
    hasStyleButtons: false,
  },
  {
    name: "/map",
    open: async (page) => {
      await openMapRetryingThrottle(page, {
        mapSelector: '[data-testid="map"], [data-testid="map-unsupported"]',
      });
    },
    scope: '[data-testid="map"]',
    caption: (page) => page.getByTestId("map-attribution"),
    unsupported: (page) => page.getByTestId("map-unsupported"),
    hasStyleButtons: true,
  },
];

test.describe("🔴 A. структура: кожна мапа називає провайдера, а де мапи немає — не показує чужих плиток", () => {
  for (const p of PAGES) {
    test(`${p.name}: контрол кредиту на мапі й підпис під нею (або запасний стан без жодного запиту до плиток)`, async ({
      page,
      request,
    }) => {
      const tileRequests = countTileRequests(page);
      await p.open(page, request);

      if (await hasWebGl(page)) {
        // Мапа малюється: контрол кредиту всередині неї (DOM, без мережі) і підпис під нею.
        await expect(p.caption(page)).toContainText("OpenFreeMap");
        await expect
          .poll(() => controlCount(page, p.scope), {
            message: `на мапі «${p.name}» немає контролу кредиту`,
            timeout: 15_000,
          })
          .toBe(1);
      } else {
        // Мапи немає: запасний текст, жодного контролу і жодного запиту до плиткового
        // сервера — плитки без мапи не показуються, кредиту нема кому бути.
        await expect(p.unsupported(page)).toBeVisible();
        expect(await controlCount(page, p.scope)).toBe(0);
        await page.waitForTimeout(1_000);
        expect(tileRequests(), "без WebGL сторінка таки ходила по плитки").toBe(
          0,
        );
      }
      if (!p.hasStyleButtons) await expect(styleButtons(page)).toHaveCount(0);
    });
  }

  test("/map: кнопки стилів тут ЄДИНІ, і їх стільки, скільки стилів у MAP_SOURCES", async ({
    page,
    request,
  }) => {
    await PAGES[2].open(page, request);
    if (!(await hasWebGl(page))) {
      await expect(PAGES[2].unsupported(page)).toBeVisible();
      await expect(styleButtons(page)).toHaveCount(0);
      return;
    }
    await expect(styleButtons(page)).toBeVisible();
    // Стилів стільки, скільки в MAP_SOURCES (сторінка кукі називає це число
    // словом, і `legal-cookies-claims.spec.ts` звіряє його з тим самим масивом).
    // (Кнопка супутника стоїть у тій самій групі й теж має `data-source`, тож
    // рахуються кнопки з id зі списку, а не всі.)
    await expect(
      styleButtons(page).locator(
        MAP_SOURCES.map((m) => `button[data-source="${m.id}"]`).join(", "),
      ),
    ).toHaveCount(MAP_SOURCES.length);
  });
});

test.describe("🔴 B. живий текст кредиту з TileJSON (залежить від мережі)", () => {
  for (const p of PAGES) {
    test(`${p.name}: на мапі видно «OpenFreeMap … OpenStreetMap»`, async ({
      page,
      request,
    }) => {
      test.slow();
      await p.open(page, request);
      if (!(await hasWebGl(page))) {
        // Мапи немає — її запасний стан перевірено в A; тут нема чого читати.
        await expect(p.unsupported(page)).toBeVisible();
        return;
      }
      // 🔴 ЯВНИЙ І ГОЛОСНИЙ ПРОПУСК, а не тиха зеленість: без тайлового сервера
      // текст кредиту не приходить, і причина стоїть у звіті.
      test.skip(
        !(await tilesReachable()),
        `${TILE_HOST} недосяжний з цього прогону: живий текст кредиту (TileJSON) перевірити нема чим; ` +
          "структуру (контрол і підпис) перевіряє блок A",
      );
      const credit = await liveCredit(page, p.scope);
      expect(credit).toContain("OpenFreeMap");
    });
  }
});

test.describe("🔴 C. негативний контроль: предикат бачить ВІДСУТНІСТЬ кредиту", () => {
  test("на синтетичному DOM: без контролу — 0, з контролом — 1", async ({
    page,
  }) => {
    await page.setContent('<div id="m"></div>');
    expect(
      await controlCount(page, "#m"),
      "предикат бачить контрол там, де його нема",
    ).toBe(0);
    await page.setContent(
      '<div id="m"><div class="maplibregl-ctrl maplibregl-ctrl-attrib">x</div></div>',
    );
    expect(
      await controlCount(page, "#m"),
      "предикат не бачить контролу там, де він є",
    ).toBe(1);
  });

  test("на живій мапі кемпінгу: після видалення контролу з DOM предикат каже 0", async ({
    page,
    request,
  }) => {
    await PAGES[0].open(page, request);
    if (!(await hasWebGl(page))) {
      // Мапи немає — предикат уже перевірено на синтетичному DOM; на живій сторінці нема що видаляти.
      await expect(PAGES[0].unsupported(page)).toBeVisible();
      return;
    }
    await expect.poll(() => controlCount(page, PAGES[0].scope)).toBe(1);
    await page.evaluate((scope) => {
      document.querySelector(`${scope} .maplibregl-ctrl-attrib`)?.remove();
    }, PAGES[0].scope);
    expect(
      await controlCount(page, PAGES[0].scope),
      "предикат не помітив, що контрол зник",
    ).toBe(0);
  });
});

test.describe("🔴 сторінки, змінені правками 02.11.2026, віддають нову версію вгорі", () => {
  // «The version and the date it took effect are printed at the top of this
  // page» (терміни §6) — тут читається віддана сторінка: версія з реєстру
  // стоїть у DOM ПЕРЕД текстом документа.
  for (const slug of ["terms", "cookies", "database", "notice"]) {
    test(`${slug}: версія з реєстру надрукована над текстом`, async ({
      page,
    }) => {
      const reg = LEGAL_PAGES.find((p) => p.slug === slug)!;
      await page.goto(`/legal/${slug}`);
      const version = page.getByTestId("legal-version");
      await expect(version).toContainText(`Version ${reg.version}`);
      const above = await page.evaluate(() => {
        const v = document.querySelector('[data-testid="legal-version"]');
        const a = document.querySelector("article");
        return (
          !!v &&
          !!a &&
          !!(v.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
      });
      expect(above, "версія надрукована НЕ над текстом документа").toBe(true);
    });
  }
});
