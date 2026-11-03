import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// 🔴 ВКАЗІВНИК У ПОРОЖНЕЧУ ГІРШИЙ ЗА ВІДСУТНІЙ — і для моделі, і для людини.
//
// Знання передане основним мозком UTD 03.11.2026 з їхнього власного
// заміру: у їхній мережі `llms.txt` називав `/guides/`, який віддавав
// 404 на ТРЬОХ сайтах із пʼяти. Тобто файл, яким ми самі кажемо
// асистентові «ось що в нас є», вів його в нікуди.
//
// Це твердження, не вказівка (CLAUDE.md), тому перевірено на нас:
// `llms.txt` у нас генерується, а не пишеться руками, отже посилання на
// кемпінги, гайди й маршрути беруться з тих самих джерел, що й мапа
// сайту. Але СТАТИЧНІ шляхи розділів написані рядками в коді — і саме
// вони можуть пережити перейменування маршруту мовчки.
//
// 🔴 НЕГАТИВНИЙ КОНТРОЛЬ ОБОВʼЯЗКОВИЙ. Без нього перевірка, що «всі
// розділи існують», однаково зелена і тоді, коли вона не вміє бачити
// відсутній розділ. Їхній лист називає це прямо, і він правий.

const ROOT = join(__dirname, "..", "..");
const APP = join(ROOT, "src", "app");
const LLMS = join(APP, "llms.txt", "route.ts");

/** Статичні шляхи, які файл друкує рядком, а не бере з бази. */
export function staticPathsIn(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/\$\{SITE\}(\/[a-z0-9/.-]*)/g)) {
    const path = m[1].replace(/\/$/, "");
    // Шаблонні шматки на кшталт `${SITE}/camping/` + змінна — не шлях.
    if (path && !path.includes("${")) out.add(path);
  }
  return [...out].sort();
}

/**
 * Чи існує маршрут у App Router. Сегмент `[param]` приймає будь-яке
 * значення, тому шлях із двох сегментів може лягти у `[country]`.
 */
export function routeExists(path: string, appDir = APP): boolean {
  const segments = path.split("/").filter(Boolean);
  const walk = (dir: string, rest: string[]): boolean => {
    if (rest.length === 0) {
      return ["page.tsx", "page.ts", "route.ts"].some((f) => {
        try {
          return statSync(join(dir, f)).isFile();
        } catch {
          return false;
        }
      });
    }
    // 🔴 Спецфайли Next: `/sitemap.xml` віддає `app/sitemap.ts`, а
    // `/robots.txt` — `app/robots.ts`. Перша редакція цієї перевірки
    // назвала `/sitemap` мертвим, хоч маршрут живий: вона шукала теку.
    // Без цієї гілки сторож червонів би на власній незнанні конвенції —
    // і його б вимкнули, а не полагодили.
    if (rest.length === 1) {
      const base = rest[0].replace(/\.(xml|txt)$/, "");
      try {
        if (statSync(join(dir, `${base}.ts`)).isFile()) return true;
      } catch {
        // немає — перевіряємо звичайні варіанти нижче
      }
    }
    const [head, ...tail] = rest;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return false;
    }
    if (entries.includes(head) && walk(join(dir, head), tail)) return true;
    // Динамічний сегмент приймає будь-що.
    return entries
      .filter((e) => e.startsWith("[") && e.endsWith("]"))
      .some((e) => walk(join(dir, e), tail));
  };
  return walk(appDir, segments);
}

test.describe("llms.txt не веде асистента в нікуди", () => {
  const source = readFileSync(LLMS, "utf8");
  const paths = staticPathsIn(source);

  test("🔴 кожен статичний розділ, названий у llms.txt, має маршрут", () => {
    const dead = paths.filter((p) => !routeExists(p));
    expect(dead, `розділи без маршруту: ${dead.join(", ")}`).toEqual([]);
  });

  // Знаменник: «нуль мертвих» на порожньому переліку нічого не варте.
  test("перелік не порожній і містить розділи, а не лише корінь", () => {
    expect(paths.length).toBeGreaterThan(3);
    expect(paths.some((p) => p.split("/").length > 2)).toBe(true);
  });

  test("🔴 негативний контроль: вигаданий розділ ПОВИНЕН бути визнаний мертвим", () => {
    expect(routeExists("/sections-that-do-not-exist")).toBe(false);
    expect(routeExists("/camping/zz/no-such-region/no-such-spot/deeper")).toBe(
      false,
    );
  });

  test("а справжній розділ — живим, і динамічний теж", () => {
    expect(routeExists("/camper-rental")).toBe(true);
    expect(routeExists("/camper-rental/providers")).toBe(true);
    expect(routeExists("/camper-rental/de")).toBe(true);
  });
});
