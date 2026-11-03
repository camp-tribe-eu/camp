import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// 🔴 CAMP-425. ІНТЕРФЕЙС НЕ СМІЄ ОБІЦЯТИ ТЕ, ЧОГО API НЕ ВМІЄ ПРИЙНЯТИ.
//
// Кабінет казав читачеві: «сердечко на будь-якому кемпінгу — і він тут»,
// «ваш знімок побачать тисячі людей», «зникнуть ваші маршрути й відгуки».
// Жодного з цих маршрутів у API не існує. Сторінка приватності вже
// говорила правду («the site does not yet let you save a trip, a place, a
// photograph or a review»), тобто дві поверхні одного сайту казали
// протилежне тому самому читачеві — і жоден тест цього не бачив.
//
// 🔴 ЧОМУ ЦЕ НЕ ПРОСТО ЧОРНИЙ СПИСОК ФРАЗ. Перевірка починається з
// ЗАМІРУ API. Коли write-маршрут зʼявиться, перший випадок почервоніє і
// змусить переписати текст — тобто сторож старіє правильно. Чорний
// список фраз без цього замовк би назавжди в день, коли фіча вийде.

const API = join(__dirname, "../../../api/src");
const COMPONENTS = join(__dirname, "../../src/components");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const isSpec = (f: string) => /\.(spec|test)\.[a-z]+$/.test(f);

/** Файли контролерів API, без самоперевірок. */
function controllers(): string[] {
  return walk(API).filter((f) => f.endsWith(".controller.ts") && !isSpec(f));
}

/**
 * Скільки write-маршрутів (`@Post/@Put/@Patch/@Delete`) стоїть у
 * контролерах, чия назва містить одне з цих слів.
 */
function writeRoutesAbout(words: string[]): number {
  let n = 0;
  for (const f of controllers()) {
    if (!words.some((w) => f.includes(w))) continue;
    n += (readFileSync(f, "utf8").match(/@(Post|Put|Patch|Delete)\(/g) ?? [])
      .length;
  }
  return n;
}

const CABINET = [
  "account-cabinet-view.tsx",
  "account-data-view.tsx",
  "account-delete-view.tsx",
  "account-view.tsx",
].map((f) => join(COMPONENTS, f));

/**
 * 🔴 ПРОБІЛИ ЗГОРТАЮТЬСЯ, І ЦЕ НЕ КОСМЕТИКА.
 *
 * Prettier переносить текст усередині JSX по ширині рядка, тож речення
 * «does not yet let you save a trip…» лежить у файлі розрізаним на три
 * рядки з відступами. Пошук підрядка по сирому файлу не знайшов би його
 * в трьох файлах із чотирьох — і сказав би «кабінет цього не каже» там,
 * де кабінет це каже. Читач бачить один рядок; тест мусить бачити те саме.
 */
const flat = (s: string) => s.replace(/\s+/g, " ");

const cabinetText = () =>
  flat(CABINET.map((f) => readFileSync(f, "utf8")).join("\n"));

test.describe("кабінет не обіцяє того, чого API не приймає", () => {
  test("🔴 замір: write-маршрутів про поїздки, фото й відгуки немає", () => {
    // Знаменник названий: контролери справді прочитані.
    expect(controllers().length).toBeGreaterThan(10);
    // Усього write-маршрутів на весь API — щоб «0» нижче не був нулем
    // через те, що тест не знайшов жодного файлу.
    const all = controllers()
      .map(
        (f) =>
          (readFileSync(f, "utf8").match(/@(Post|Put|Patch|Delete)\(/g) ?? [])
            .length,
      )
      .reduce((a, b) => a + b, 0);
    expect(all).toBeGreaterThan(10);

    expect(writeRoutesAbout(["trips"]), "поїздки").toBe(0);
    expect(
      writeRoutesAbout(["photo", "review", "upload"]),
      "фото й відгуки",
    ).toBe(0);

    // І жодного приймача файлів у виробничому коді.
    const uploads = walk(API)
      .filter((f) => f.endsWith(".ts") && !isSpec(f))
      .filter((f) =>
        /FileInterceptor|multer|multipart/.test(readFileSync(f, "utf8")),
      );
    expect(uploads.map((f) => f.replace(API, "api"))).toEqual([]);
  });

  test("🔴 і тому кабінет НЕ містить жодної з обіцянок, які там стояли", () => {
    const text = cabinetText();
    // Кожен рядок справді стояв у коді до 03.11.2026.
    for (const promise of [
      "A heart on any campsite and it lands here",
      "The list syncs between your devices",
      "Thousands of people will see your shot",
      "with your name in the credit",
      "Build your own in the Trip Planner",
      "your routes and saved campsites",
      "your profile and routes are back",
    ]) {
      expect(text, promise).not.toContain(promise);
    }
  });

  test("🔴 перевірка не сліпа — фразу, яка там Є, вона знаходить", () => {
    // Без цього «жодної обіцянки не знайдено» так само вірно для
    // перевірки, що читає порожній рядок.
    const text = cabinetText();
    expect(text.length).toBeGreaterThan(5000);
    expect(text).toContain("does not yet let you save a trip");
  });

  test("🔴 кабінет каже правду тими самими словами, що й сторінка приватності", () => {
    const text = cabinetText();
    // Одне формулювання на весь сайт: інакше дві поверхні розійдуться.
    const SAID =
      "does not yet let you save a trip, a place, a photograph or a review";
    const where = CABINET.filter((f) =>
      flat(readFileSync(f, "utf8")).includes(SAID),
    ).map((f) => f.replace(/.*\//, ""));
    // Два екрани з чотирьох: кабінет із трьома картками каже це своїми
    // словами на кожній картці, а не одним реченням.
    expect(
      where.length,
      `жоден екран кабінету не каже цього: ${where}`,
    ).toBeGreaterThanOrEqual(2);
    // І сторінка приватності каже те саме — текст лежить у міграції.
    const privacy = flat(
      readFileSync(
        join(
          __dirname,
          "../../../api/src/migrations/1793900000000-PrivacyBrowserStorage.ts",
        ),
        "utf8",
      ),
    );
    expect(privacy).toContain(SAID);
    expect(text).toContain(SAID);

    // 🔴 І КОЖЕН із чотирьох екранів мусить сказати «ще ні» хоч раз —
    // інакше той, що мовчить, знову почне обіцяти непомітно.
    const silent = CABINET.filter(
      (f) =>
        !/\b(not yet|do not take|is not built yet|does not yet)\b/i.test(
          flat(readFileSync(f, "utf8")),
        ),
    ).map((f) => f.replace(/.*\//, ""));
    expect(silent).toEqual([]);
  });
});
