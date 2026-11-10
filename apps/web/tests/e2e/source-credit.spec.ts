import { expect, test } from "./api-request";

/**
 * CAMP-485 — посилання на джерело поруч із місцем, де показано його дані.
 *
 * 🔴 ЦЕ УМОВА ЛІЦЕНЗІЇ, А НЕ ВВІЧЛИВІСТЬ. Open-Meteo вимагає дослівно:
 * «You must include a link next to any location Open-Meteo data are
 * displayed». Заміряно 10.11.2026: висоту ми показуємо на сторінці
 * кемпінгу, а рядок `open-meteo` не траплявся в усьому `apps/web/src`
 * жодного разу — атрибуція жила лише на сторінці джерел.
 *
 * 🔴 ПЕРЕВІРЯЄТЬСЯ ПОСИЛАННЯ, А НЕ ЗГАДКА. Назва джерела словами умову не
 * виконує, і — гірше — тест на текст лишився б зеленим після того, як
 * хтось прибере `href`: слово «Open-Meteo» на сторінці залишиться. Тому
 * шукається саме `a[href]`.
 *
 * 🔴 І ЛИШЕ ТАМ, ДЕ ДАНІ СПРАВДІ Є. Сторінка без висоти не має кредитувати
 * джерело, яке нічого не дало: заміряно 25.09.2026 — 9 523 кемпінги мають
 * оточення й НЕ мають висоти. Тому кандидат шукається перебором, а
 * порожній результат падає з поясненням, а не зеленіє над порожнечею.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface Marker {
  country: string;
  region: string;
  slug: string;
  path: string;
}

/**
 * Перший кемпінг фікстури, у якого в БАЗІ є висота.
 *
 * Перебір, а не `find` із перевіркою після: кандидат без висоти — це не
 * поломка пошуку, у переліку є ще сотні. Той самий урок, що записаний у
 * `campsite.spec.ts`: одна мовчазна відповідь не означає «такого немає».
 */
async function spotWithElevation(
  request: import("@playwright/test").APIRequestContext,
): Promise<{ path: string; tried: number; total: number }> {
  const url = `${API_BASE}/spots/map/points?bbox=-180,-85,180,85&limit=20000`;
  const res = await request.get(url);
  expect(res.ok(), `GET ${url} → ${res.status()}`).toBeTruthy();
  const markers = ((await res.json()) as { markers?: Marker[] }).markers ?? [];

  expect(
    markers.length,
    "Перелік міток порожній — шукати нема де, і зелений результат нижче " +
      "нічого не доводив би.",
  ).toBeGreaterThan(0);

  let tried = 0;
  for (const m of markers.slice(0, 120)) {
    tried += 1;
    const r = await request.get(
      `${API_BASE}/spots/${m.country}/${m.region}/${m.slug}?nearby=0`,
    );
    if (!r.ok()) continue;
    const body = (await r.json()) as {
      spot?: { context?: { elevation?: number } };
    };
    if (typeof body.spot?.context?.elevation === "number") {
      return { path: m.path, tried, total: markers.length };
    }
  }

  throw new Error(
    `Серед ${tried} перевірених кемпінгів (із ${markers.length} у переліку) ` +
      `жоден не має висоти. Це не «все гаразд»: сторож про атрибуцію не ` +
      `має на чому спрацювати, тож фікстуру треба полагодити, а не ` +
      `пропускати тест.`,
  );
}

test("висота на сторінці кемпінгу несе посилання на обидва джерела", async ({
  page,
  request,
}) => {
  const { path, tried, total } = await spotWithElevation(request);
  await page.goto(path);

  const main = page.locator("main");
  await expect(
    main,
    `API віддав висоту для ${path}, а сторінка її не показує — ` +
      `(перевірено ${tried} кандидатів із ${total}).`,
  ).toContainText("above sea level");

  // 🔴 РАХУЄМО В АБЗАЦІ АТРИБУЦІЇ, А НЕ ПО ВСІЙ СТОРІНЦІ.
  //
  // Перша редакція шукала `a[href*="copernicus"]` у всьому `main` і
  // впала на CI, очікуючи одне посилання при трьох: панель посухи малює
  // ще два — `drought.emergency.copernicus.eu` як джерело й як умови.
  //
  // Виправлення не косметичне. Умова Open-Meteo вимагає посилання
  // ПОРУЧ із місцем показу даних, а не будь-де на сторінці. Пошук по
  // всьому `main` зеленів би й тоді, коли посилання стоїть у підвалі
  // секції про посуху — тобто перевіряв би не те, що вимагає ліцензія.
  const credit = main.getByTestId("surroundings-credit");
  await expect(
    credit,
    `На ${path} немає абзацу атрибуції під оточенням.`,
  ).toHaveCount(1);

  await expect(
    credit.locator('a[href*="open-meteo.com"]'),
    `Умова Open-Meteo: посилання мусить стояти ПОРУЧ із місцем показу ` +
      `даних. На ${path} висота є, посилання біля неї немає.`,
  ).toHaveCount(1);

  await expect(
    credit.locator('a[href*="copernicus"]'),
    `Висота походить із Copernicus, і їхня ж сторінка ліцензії називає ` +
      `обидва джерела — тож і ми називаємо обидва.`,
  ).toHaveCount(1);
});
