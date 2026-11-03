import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// 🔴 САЙТ ГОВОРИТЬ АНГЛІЙСЬКОЮ, І ЦЕ НЕ ОЧЕВИДНО З КОДУ.
//
// `layout.tsx` ставить `<html lang="en">`, а в `lib/i18n.ts` живим
// позначено ЛИШЕ `en`; решта пʼяти локалей мають `live: false`, а
// української в переліку немає взагалі.
//
// 03.11.2026 я написав увесь каталог провайдерів українською — сторінку,
// підписи фільтрів, блок на лендінгу — і засіяв українську прозу з
// `language_code: 'uk'`. Сусідні заголовки тієї самої сторінки кажуть
// «Renting a camper in the EU». Жоден із 2404 тестів цього не побачив:
// текст є, структура правильна, JSON-LD на місці — усе зелене.
//
// 🔴 ЧОМУ ПЕРЕЛІК ФАЙЛІВ, А НЕ ВСЕ ДЕРЕВО. Кирилиця в коді законна:
// коментарі, повідомлення збірки, тексти винятків. Заміряно 03.11.2026:
// під `apps/web/src` її мають 22 файли поза коментарями, і жоден із них
// не доходить до читача. Заборона «кирилиці в коді» була б запобіжником,
// ширшим за дефект — тому список, і кожен рядок у ньому названий.
//
// 🔴 МЕЖА, ЯКУ ТРЕБА ЗНАТИ. Перевіряється ДЖЕРЕЛО зі зрізаними
// коментарями, а не відданий HTML. Відданий був би точніший, але
// `renderComponent` викликає компонент як звичайну функцію, і клієнтський
// компонент із `useState` у ньому падає на `Cannot read properties of
// null (reading 'useState')`. Тобто це стеля наявного інструмента, а не
// лінощі; коли зʼявиться рендер клієнтських компонентів — перевірку
// треба перенести на нього.

const CYRILLIC = /[Ѐ-ӿ]/;
const ROOT = join(__dirname, "..", "..");

/** Файли, текст яких читає відвідувач каталогу оренди. */
const READER_FACING = [
  "src/app/camper-rental/providers/page.tsx",
  "src/app/camper-rental/providers/[slug]/page.tsx",
  "src/components/provider-catalogue.tsx",
  "src/lib/rental-providers.ts",
];

/**
 * Коментарі — не текст сторінки. Зрізаються блокові, рядкові та
 * JSX-коментарі; усе, що лишилось, або віддається читачеві, або стоїть
 * у рядку, який до нього доходить.
 */
export function withoutComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test.describe("каталог оренди говорить мовою сайту", () => {
  test("🔴 у жодному файлі каталогу немає кирилиці поза коментарями", () => {
    const guilty: string[] = [];
    for (const rel of READER_FACING) {
      const text = withoutComments(readFileSync(join(ROOT, rel), "utf8"));
      const line = text.split("\n").find((l) => CYRILLIC.test(l));
      if (line) guilty.push(`${rel}: ${line.trim().slice(0, 60)}`);
    }
    expect(
      guilty,
      `кирилиця у тексті сторінок:\n  ${guilty.join("\n  ")}`,
    ).toEqual([]);
  });

  // 🔴 Без цього попередній випадок був би зелений і на порожньому
  // переліку, і на зрізальнику, що зрізає все: немає тексту — немає й
  // кирилиці.
  test("🔴 перелік не порожній, а зрізальник зрізає лише коментарі", () => {
    expect(READER_FACING.length).toBeGreaterThan(3);
    for (const rel of READER_FACING) {
      expect(readFileSync(join(ROOT, rel), "utf8").length).toBeGreaterThan(200);
    }
    expect(withoutComments('// коментар\nconst a = "текст";')).toContain(
      "текст",
    );
    expect(withoutComments("/* коментар */ const a = 1;")).not.toContain(
      "коментар",
    );
    expect(withoutComments("{/* коментар */}<p>слово</p>")).toContain("слово");
    expect(withoutComments('const u = "https://x/y"; // хвіст')).toContain(
      "https://x/y",
    );
  });

  test("🔴 засіяна проза, яку читає сторінка компанії, теж англійською", () => {
    const seed = JSON.parse(
      readFileSync(
        join(ROOT, "..", "api", "src", "rental", "providers.seed.json"),
        "utf8",
      ),
    ) as {
      providers: {
        slug: string;
        intro?: string;
        whatToKnow?: string;
        services?: { note?: string }[];
      }[];
    };

    const bad: string[] = [];
    for (const p of seed.providers) {
      if (p.intro && CYRILLIC.test(p.intro)) bad.push(`${p.slug}.intro`);
      if (p.whatToKnow && CYRILLIC.test(p.whatToKnow))
        bad.push(`${p.slug}.whatToKnow`);
      for (const s of p.services ?? []) {
        if (s.note && CYRILLIC.test(s.note))
          bad.push(`${p.slug}.services.note`);
      }
    }
    // Знаменник поруч: «нуль поганих» на порожньому файлі нічого не варте.
    expect(seed.providers.length).toBeGreaterThan(0);
    expect(bad, `поля з кирилицею: ${bad.join(", ")}`).toEqual([]);
  });
});
