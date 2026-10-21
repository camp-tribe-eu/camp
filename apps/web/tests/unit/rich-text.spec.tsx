import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { renderComponent } from "./render-component";
import { RichText } from "@/components/rich-text";
import { parseBlocks, parseInline, substitute } from "@/lib/rich-text";

// CAMP-365 — текст із CMS. Цей файл стереже дві різні речі, і плутати
// їх не можна: ЩО читач бачить, і чого браузер НЕ виконає.

test.describe("блоки", () => {
  test("порожній рядок ділить абзаци, «- » робить список, «## » — підзаголовок", () => {
    const html = renderComponent(RichText, {
      text: "Перший.\n\nДругий.\n\n## Розділ\n\n- один\n- два",
    });
    expect(html.match(/<p>/g)?.length, "абзаців не два").toBe(2);
    expect(html).toContain("<h2");
    expect(html.match(/<li>/g)?.length, "пунктів списку не два").toBe(2);
  });

  test("перенос усередині абзацу не ділить його", () => {
    const blocks = parseBlocks("рядок один\nрядок два");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("p");
  });
});

test.describe("всередині рядка", () => {
  test("виділення і посилання стають елементами", () => {
    const html = renderComponent(RichText, {
      text: "Текст **важливий** і [туди](/legal/notice).",
    });
    expect(html).toContain("<strong");
    expect(html).toContain("важливий");
    expect(html).toContain('href="/legal/notice"');
    expect(html).toContain("туди");
  });

  test('зовнішнє посилання має rel="noopener", внутрішнє — ні', () => {
    const ext = renderComponent(RichText, {
      text: "[там](https://example.org)",
    });
    expect(ext).toContain('rel="noopener"');
    const int = renderComponent(RichText, { text: "[тут](/map)" });
    expect(int, "внутрішньому посиланню rel не потрібен").not.toContain(
      "noopener",
    );
  });

  test("mailto дозволено", () => {
    const html = renderComponent(RichText, {
      text: "[напишіть](mailto:a@b.eu)",
    });
    expect(html).toContain('href="mailto:a@b.eu"');
  });
});

test.describe("🔴 чого браузер не виконає", () => {
  // 🔴 КОЖНЕ ЗАПЕРЕЧЕННЯ МАЄ ПАРУ. «Не виконається» істинне й тоді, коли
  // не рендериться нічого, — а це була б інша поломка з тим самим
  // виглядом. Тому поруч із кожною забороною стоїть твердження про те,
  // що саме читач натомість бачить.

  for (const bad of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "//evil.example",
    "vbscript:msgbox",
  ]) {
    test(`адреса «${bad}» не проходить`, () => {
      expect(
        () => parseInline(`[клік](${bad})`),
        `адресу «${bad}» пропущено`,
      ).toThrow(/не дозволена/);
    });
  }

  test("розмітка в тексті лишається ТЕКСТОМ, а не стає розміткою", () => {
    const html = renderComponent(RichText, {
      text: "Спроба <script>alert(1)</script> і <img src=x onerror=alert(1)>",
    });
    // Негативне: жодного виконуваного вузла.
    expect(html, "у розмітці зʼявився <script>").not.toContain("<script>");
    expect(html, "у розмітці зʼявився <img").not.toContain("<img");
    // 🔴 І позитивне: текст таки показано, екранованим.
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("alert(1)");
  });

  test("у цьому шляху немає жодного dangerouslySetInnerHTML", () => {
    // 🔴 СТОРОЖ ЧИТАЄ КОД, А НЕ ЗГАДКУ ПРО НЬОГО.
    //
    // Перша редакція цього тесту падала — і правильно падала, але не з
    // тієї причини: вона матчила МІЙ ЖЕ КОМЕНТАР у `rich-text.tsx`, де
    // написано «тут немає dangerouslySetInnerHTML». Сторож на текст, що
    // не відрізняє код від коментаря, зупиняє чесні зміни й пропускає
    // нечесні, якщо ті не згадують забороненого слова.
    //
    // Тому коментарі знімаються, і лишається те, що виконується.
    const raw = readFileSync(
      path.join(__dirname, "..", "..", "src", "components", "rich-text.tsx"),
      "utf8",
    );
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(code, "у рендері зʼявився dangerouslySetInnerHTML").not.toContain(
      "dangerouslySetInnerHTML",
    );

    // 🔴 ПАРА: доводимо, що знімач коментарів не зʼїв увесь файл. Без
    // цього рядка тест зеленів би й над порожнім рядком — тобто саме
    // тоді, коли перестав би щось перевіряти.
    expect(code, "знімач коментарів лишив від файла порожнечу").toContain(
      "function RichText",
    );
  });
});

test.describe("підстановки", () => {
  test("відомий ключ підставляється", () => {
    expect(
      substitute("керує {{company.name}}", { "company.name": "UTD BV" }),
    ).toBe("керує UTD BV");
  });

  test("🔴 невідомий ключ кидає і називає дозволені", () => {
    expect(() => substitute("{{nope}}", { "company.name": "UTD BV" })).toThrow(
      /невідома підстановка «\{\{nope\}\}».*company\.name/s,
    );
  });

  test("🔴 порожнього рядка замість підстановки не буває", () => {
    // Пара до тесту вище: якби невідомий ключ давав '', текст виглядав
    // би зламаним у читача, а в нас — зеленим.
    let out = "";
    try {
      out = substitute("керує {{nope}}, Антверпен", {});
    } catch {
      out = "кинуло";
    }
    expect(out).toBe("кинуло");
  });
});
