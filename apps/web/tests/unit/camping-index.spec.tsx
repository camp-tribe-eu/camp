/**
 * CAMP-450, перша частина: /camping — плитки країн, тікер, банери.
 *
 * Усе нижче читає ВІДДАНИЙ HTML сторінки (`renderAsyncComponent` проти
 * підміненого `fetch`) або файли, які справді лежать у `public/`, — а не
 * константи компонентів. Число в плитці звіряється з рядком API, що його
 * породив; прапор — з файлом на диску за тим самим `src`, який стоїть у
 * розмітці.
 *
 * 🔴 МУТАЦІЇ, ЯКІ ЦЕЙ ФАЙЛ МУСИТЬ ЧЕРВОНИТИ (прогнано 08.11.2026, вивід у
 * PR): прибрати `public/flags/at.svg` → падає «Austria (at)»; у
 * `country-tiles.tsx` надрукувати `data.spots + 1` → падає перелік кодів.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import CampingIndex from "@/app/camping/page";
import { CountryTicker, pickTickerCountries } from "@/components/country-ticker";
import { CountryTiles, countryTiles } from "@/components/country-tiles";
import { countryName, type CountrySummary } from "@/lib/api";
import { EU_MEMBER_STATES, FLAGGED_CODES, flagSrc } from "@/lib/eu-countries";
import {
  renderAsyncComponent,
  renderComponent,
  rendersNothing,
} from "./render-component";
import { visibleText } from "./rendered-text";

// `__dirname`, а не `import.meta`: Playwright компілює специфікації в CommonJS.
const ROOT = resolve(__dirname, "..", "..", "..", "..");
const PUBLIC = join(ROOT, "apps", "web", "public");

/** Те, що `/spots/countries` віддає на фікстурі CI: 27 членів + `ax`. */
const API_COUNTRIES = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "api-spots-countries.json"), "utf8"),
) as CountrySummary[];

const en = (n: number): string => n.toLocaleString("en-GB");

type Fetcher = (url: string) => Response | Promise<Response>;

async function withFetch(impl: Fetcher, run: () => Promise<void>) {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string) =>
    Promise.resolve().then(() => impl(String(url)))) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** /camping, відданий проти заданої відповіді `/spots/countries`. */
async function renderCamping(countries: CountrySummary[]): Promise<string> {
  let html = "";
  await withFetch(
    (url) => {
      if (url.endsWith("/spots/countries")) return json(countries);
      throw new Error(`unexpected request in a unit test: ${url}`);
    },
    async () => {
      html = await renderAsyncComponent(CampingIndex, {});
    },
  );
  return html;
}

/** Розмітка однієї плитки: `<li>`, у якому стоїть посилання на країну. */
function tileHtml(html: string, code: string): string {
  const at = html.indexOf(`href="/camping/${code}"`);
  expect(at, `плитки з посиланням на /camping/${code} немає`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<li", at);
  const end = html.indexOf("</li>", at);
  expect(start, `посилання /camping/${code} стоїть не в <li>`).toBeGreaterThan(-1);
  return html.slice(start, end);
}

const tileCount = (html: string): number =>
  html.match(/class="ct-tiles__col"/g)?.length ?? 0;

// ── Перелік і прапори ─────────────────────────────────────────────────────

test("🔴 ЄС-27 у вебі — той самий перелік, що в JSON області проєкту, в обидва боки", () => {
  const scope = JSON.parse(
    readFileSync(join(ROOT, "apps", "api", "src", "osm", "eu-member-states.json"), "utf8"),
  ) as { members: Record<string, string> };
  const fromApi = Object.keys(scope.members).sort();
  const fromWeb = [...EU_MEMBER_STATES].sort();
  expect(fromWeb.length, "у вебі не 27 членів").toBe(27);
  expect(fromWeb).toEqual(fromApi);
});

test("🔴 прапор є для кожної з 27 країн (і для Åland): файл лежить там, куди веде src", () => {
  // Знаменник — у звіті, не в голові.
  test.info().annotations.push({
    type: "denominator",
    description: `${FLAGGED_CODES.length} codes: ${FLAGGED_CODES.join(", ")}`,
  });
  expect(FLAGGED_CODES.length).toBe(28);
  for (const code of EU_MEMBER_STATES) expect(FLAGGED_CODES).toContain(code);

  const missing: string[] = [];
  for (const code of FLAGGED_CODES) {
    const src = flagSrc(code);
    const file = join(PUBLIC, src);
    if (!existsSync(file)) {
      missing.push(`${countryName(code)} (${code}): ${src}`);
      continue;
    }
    const head = readFileSync(file, "utf8").slice(0, 300);
    expect(head, `${countryName(code)}: ${src} — не SVG`).toContain("<svg");
    expect(head, `${countryName(code)}: ${src} — файл не з flag-icons`).toContain(
      `id="flag-icons-${code}"`,
    );
  }
  expect(
    missing,
    `прапорів немає на диску (${missing.length} з ${FLAGGED_CODES.length}):\n  ${missing.join("\n  ")}`,
  ).toEqual([]);
});

test("🔴 кожен src прапора у ВІДДАНІЙ розмітці плиток — існуючий файл у public/", () => {
  // Із порожньою відповіддю API — усі 27 плиток, усі з прапорами.
  const html = renderComponent(CountryTiles, { countries: [] });
  const srcs = [...html.matchAll(/<img class="ct-flag" src="([^"]+)"/g)].map((m) => m[1]);
  expect(srcs.length, "плиток із прапором не 27").toBe(27);
  expect(new Set(srcs).size, "два коди ведуть на один файл").toBe(27);
  const dead = srcs.filter((src) => !existsSync(join(PUBLIC, src)));
  expect(dead, `src без файлу (404 на проді): ${dead.join(", ")}`).toEqual([]);
});

test("код з API без прапора в public/ не дає <img>, а показує код літерами", () => {
  const html = renderComponent(CountryTiles, {
    countries: [{ country: "zz", spots: 3, regions: 1 }],
  });
  expect(html).not.toContain("/flags/zz.svg");
  expect(html).toContain('ct-flag ct-flag--none" aria-hidden="true">ZZ<');
  expect(tileCount(html)).toBe(28);
});

// ── Числа ─────────────────────────────────────────────────────────────────

test("🔴 число в плитці дорівнює числу, яке віддає API — для кожного рядка фікстури", async () => {
  const html = await renderCamping(API_COUNTRIES);
  test.info().annotations.push({
    type: "denominator",
    description: `${API_COUNTRIES.length} rows from /spots/countries, ${tileCount(html)} tiles rendered`,
  });
  expect(API_COUNTRIES.length).toBe(28);
  expect(tileCount(html)).toBe(28);

  const wrong: string[] = [];
  for (const row of API_COUNTRIES) {
    const text = visibleText(tileHtml(html, row.country));
    const expected =
      `${en(row.spots)} ${row.spots === 1 ? "campsite" : "campsites"} · ` +
      `${en(row.regions)} ${row.regions === 1 ? "region" : "regions"}`;
    if (!text.includes(expected)) wrong.push(`${row.country}: «${text}» не містить «${expected}»`);
    if (!text.includes(countryName(row.country))) wrong.push(`${row.country}: без назви країни`);
  }
  expect(wrong, `плитки, чиє число не збігається з API:\n  ${wrong.join("\n  ")}`).toEqual([]);
});

test("однина й множина: 1 campsite · 1 region", () => {
  const html = renderComponent(CountryTiles, {
    countries: [{ country: "mt", spots: 1, regions: 1 }],
  });
  expect(visibleText(tileHtml(html, "mt"))).toContain("1 campsite · 1 region");
});

// ── Без даних ─────────────────────────────────────────────────────────────

test("🔴 плитка без даних не ламає сторінку: країна стоїть, каже «ще немає» і нікуди не веде", async () => {
  const without = API_COUNTRIES.filter((c) => c.country !== "mt" && c.country !== "cy");
  const html = await renderCamping(without);
  expect(tileCount(html), "плиток має бути 27 + ax").toBe(28);
  const text = visibleText(html);
  expect(text).toContain("Malta");
  expect(text).toContain("Cyprus");
  expect(text).toContain("No campsites listed yet");
  expect(html).not.toContain('href="/camping/mt"');
  expect(html).not.toContain('href="/camping/cy"');
  // А ті, що з даними, лишаються посиланнями.
  expect(html).toContain('href="/camping/fr"');
});

test("🔴 API відповів порожнім: 27 плиток, жодного «0 campsites», тікера немає", async () => {
  const html = await renderCamping([]);
  expect(tileCount(html)).toBe(27);
  const text = visibleText(html);
  expect(text).toContain("No countries have been imported yet.");
  expect(text).not.toMatch(/\b0 campsites/);
  expect(text).toContain("across 27 countries");
  expect(html).not.toContain('role="marquee"');
  expect(html.match(/No campsites listed yet/g)?.length).toBe(27);
});

test("зіпсований запис API коштує одного запису: решта плиток на місці", () => {
  const tiles = countryTiles([
    { country: "fr", spots: 5, regions: 2 },
    { country: "", spots: 9, regions: 1 },
    { country: "not-a-code", spots: 9, regions: 1 },
    { country: undefined as unknown as string, spots: 9, regions: 1 },
  ]);
  expect(tiles.length).toBe(27);
  expect(tiles.find((t) => t.code === "fr")?.data?.spots).toBe(5);
});

test("порядок: 27 членів за назвою, Åland — після них", () => {
  const tiles = countryTiles(API_COUNTRIES);
  const names = tiles.map((t) => t.name);
  expect(names[0]).toBe("Austria");
  expect(names[26]).toBe("Sweden");
  expect(names[27]).toBe("Åland Islands");
  const members = names.slice(0, 27);
  expect(members).toEqual([...members].sort((a, b) => a.localeCompare(b, "en")));
});

// ── Тікер ─────────────────────────────────────────────────────────────────

test("🔴 тікер: 3–6 країн з даними, кожна з прапором, назвою й числом, посилання на країну", () => {
  const html = renderComponent(CountryTicker, { countries: API_COUNTRIES });
  expect(html).toContain('role="marquee"');
  const items = html.match(/class="ct-ticker__item"/g)?.length ?? 0;
  // Кожен елемент віддається двічі (петля), друга копія з aria-hidden.
  const live = (html.match(/class="ct-ticker__item"( aria-hidden="true")?>/g) ?? []).filter(
    (m) => !m.includes("aria-hidden"),
  ).length;
  expect(live).toBeGreaterThanOrEqual(3);
  expect(live).toBeLessThanOrEqual(6);
  expect(items).toBe(live * 2);

  const picked = pickTickerCountries(API_COUNTRIES);
  expect(picked.length).toBe(live);
  for (const c of picked) {
    expect(html).toContain(`href="/camping/${c.country}"`);
    expect(html).toContain(`src="${flagSrc(c.country)}"`);
    expect(visibleText(html)).toContain(countryName(c.country));
    expect(visibleText(html)).toContain(`${en(c.spots)} campsites`);
  }
});

test("тікер відтворюваний: та сама відповідь API — той самий HTML; інша — інший вибір", () => {
  const a = renderComponent(CountryTicker, { countries: API_COUNTRIES });
  const b = renderComponent(CountryTicker, { countries: [...API_COUNTRIES].reverse() });
  expect(a).toBe(b);
  const changed = API_COUNTRIES.map((c) =>
    c.country === "fr" ? { ...c, spots: c.spots + 1 } : c,
  );
  const picksA = pickTickerCountries(API_COUNTRIES).map((c) => c.country);
  const picksB = pickTickerCountries(changed).map((c) => c.country);
  expect(picksA).not.toEqual(picksB);
});

test("тікер: країна з нулем і зіпсований код пропускаються; менше трьох — показуємо скільки є", () => {
  const picks = pickTickerCountries([
    { country: "fr", spots: 5, regions: 1 },
    { country: "de", spots: 0, regions: 0 },
    { country: "xx1", spots: 7, regions: 1 },
    { country: "it", spots: 2, regions: 1 },
  ]).map((c) => c.country);
  expect(picks.sort()).toEqual(["fr", "it"]);
  expect(rendersNothing(CountryTicker, { countries: [] })).toBe(true);
  expect(
    rendersNothing(CountryTicker, { countries: [{ country: "de", spots: 0, regions: 0 }] }),
  ).toBe(true);
});

// ── Банери ────────────────────────────────────────────────────────────────

test("🔴 склад сторінки: h1 у банері, плитки, тікер, два банери, банер про нас — у цьому порядку", async () => {
  const html = await renderCamping(API_COUNTRIES);
  const order = [
    '<h1 class="ct-banner__heading">',
    'class="ct-tiles__row"',
    'role="marquee"',
    '<section class="ct-grid-banner',
    '<section class="ct-box-banner',
  ].map((marker) => html.indexOf(marker));
  for (const [i, at] of order.entries()) {
    expect(at, `секція №${i + 1} відсутня`).toBeGreaterThan(-1);
  }
  for (let i = 1; i < order.length; i++) {
    expect(order[i], `секція №${i + 1} стоїть не після №${i}`).toBeGreaterThan(order[i - 1]);
  }
  expect(html.match(/<h1\b/g)?.length, "h1 має бути рівно один").toBe(1);
});

test("🔴 банери ведуть на наші сторінки вибору й на /about; про партнерів — ні слова", async () => {
  const html = await renderCamping(API_COUNTRIES);
  expect(html).toContain('href="/camper-rental"');
  expect(html).toContain('href="/map"');
  expect(html).toContain('href="/about"');
  const text = visibleText(html);
  expect(text).toContain("Rent a camper");
  expect(text).toContain("Find a campsite");
  expect(text).toContain("About CampTribe");
  expect(text).not.toMatch(/partner/i);
});

test("речення під заголовком банера несе число з API, і воно збігається із сумою рядків", async () => {
  const html = await renderCamping(API_COUNTRIES);
  const total = API_COUNTRIES.reduce((n, c) => n + c.spots, 0);
  expect(visibleText(html)).toContain(
    `${en(total)} campsites, motorhome parks and camper stops across 27 countries`,
  );
});
