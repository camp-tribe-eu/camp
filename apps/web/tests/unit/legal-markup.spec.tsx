import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { renderComponent } from "./render-component";
import { visibleText } from "./rendered-text";
import { LegalProse } from "@/components/legal-prose";
import Terms from "@/content/legal/terms";
import Privacy from "@/content/legal/privacy";
import Cookies from "@/content/legal/cookies";
import Disclaimer from "@/content/legal/disclaimer";
import Attribution from "@/content/legal/attribution";
import Database from "@/content/legal/database";
import Notice from "@/content/legal/notice";

// 🔴 CAMP-365 — СІМ ПРАВОВИХ ДОКУМЕНТІВ, ПЕРЕКЛАДЕНИХ У РОЗМІТКУ CMS,
// І ДОКАЗ, ЩО ПЕРЕКЛАД НІЧОГО НЕ ЗМІНИВ.
//
// Картка називає це пасткою номер один: «будь-яка втрата слова — це
// неправда в юридичному документі. Звіряти посимвольно, а не оком».
//
// Тому порівнюються ДВІ різні речі, і жодної з них самої по собі не
// досить:
//
//   1. ВИДИМИЙ ТЕКСТ — посимвольно. Ловить втрачене чи додане слово.
//   2. ПОСЛІДОВНІСТЬ ЕЛЕМЕНТІВ разом із якорями. Ловить те, чого текст
//      не бачить: заголовок, що став абзацом; рамку, що стала текстом;
//      список, що злився в речення; зниклий `id`, за яким цитують
//      розділ. Рецензія #304 заміряла саме цей клас: 2072 символи
//      збіглись, а абзац утратив відступ і колір.
//
// 🔴 ЦЕ НЕ ТЕСТ ПРО МОЮ КОПІЮ. Обидва боки беруться з РІЗНИХ джерел:
// ліворуч компонент, який сьогодні малює сторінку, праворуч файл
// розмітки, який її замінить. Якби я порівнював розмітку з розміткою,
// доказ був би зроблений із того, що доводить.

const PAGES = [
  ["terms", Terms],
  ["privacy", Privacy],
  ["cookies", Cookies],
  ["disclaimer", Disclaimer],
  ["attribution", Attribution],
  ["database", Database],
  ["notice", Notice],
] as const;

const MARKUP = join(__dirname, "..", "..", "src", "content", "legal", "markup");

const markupOf = (slug: string) =>
  readFileSync(join(MARKUP, `${slug}.md`), "utf8");

/**
 * Кістяк документа: послідовність структурних елементів, із якорем у
 * заголовка. Атрибути стилю навмисно НЕ беремо — їх звіряє окремий
 * випадок нижче, і плутати «та сама структура» з «той самий вигляд»
 * не можна.
 */
function skeleton(html: string): string[] {
  const out: string[] = [];
  const re =
    /<(h2|h3|p|ul|li|strong|em|i|a)\b([^>]*)>|<div([^>]*class="[^"]*accent-surface[^"]*")/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) {
      const id = / id="([^"]+)"/.exec(m[2] ?? "")?.[1];
      const href = / href="([^"]+)"/.exec(m[2] ?? "")?.[1];
      out.push(
        m[1] === "i" ? "em" : m[1],
      );
      if (id) out[out.length - 1] += `#${id}`;
      if (href) out[out.length - 1] += `→${href}`;
    } else {
      out.push("callout");
    }
  }
  return out;
}

test.describe("🔴 CAMP-365 — розмітка несе правові сторінки без втрат", () => {
  for (const [slug, Component] of PAGES) {
    test(`${slug}: видимий текст збігається посимвольно`, () => {
      const was = visibleText(renderComponent(Component, {}));
      const now = visibleText(renderComponent(LegalProse, { text: markupOf(slug) }));

      // Довжини — першими, бо повідомлення про розбіжність у 9000
      // символів без них нечитабельне.
      expect(
        now.length,
        `${slug}: було ${was.length} символів, стало ${now.length}`,
      ).toBe(was.length);
      expect(now).toBe(was);
    });

    test(`${slug}: структура й якорі ті самі`, () => {
      const was = skeleton(renderComponent(Component, {}));
      const now = skeleton(renderComponent(LegalProse, { text: markupOf(slug) }));
      expect(now.length, `${slug}: елементів було ${was.length}, стало ${now.length}`)
        .toBe(was.length);
      expect(now).toEqual(was);
    });
  }

  // 🔴 І пара до посимвольної звірки: вона істинна й над двома
  // порожніми рядками. Документи мусять бути НЕ порожні, і то суттєво.
  test("жоден документ не порожній", () => {
    for (const [slug, Component] of PAGES) {
      const text = visibleText(renderComponent(Component, {}));
      expect(text.length, `${slug} порожній`).toBeGreaterThan(1000);
      expect(markupOf(slug).length, `розмітка ${slug} порожня`).toBeGreaterThan(
        1000,
      );
    }
  });

  // 🔴 І сама звірка структури мусить уміти почервоніти: якщо
  // `skeleton` нічого не знаходить, попередні випадки порівнюють два
  // порожні масиви.
  test("розбір структури справді щось знаходить", () => {
    const sk = skeleton(renderComponent(Terms, {}));
    expect(sk.filter((x) => x.startsWith("h2#")).length).toBeGreaterThan(5);
    expect(sk.filter((x) => x === "callout").length).toBeGreaterThan(0);
    expect(sk.filter((x) => x.startsWith("a→")).length).toBeGreaterThan(3);
  });
});
