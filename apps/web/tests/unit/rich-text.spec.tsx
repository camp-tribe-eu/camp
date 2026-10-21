import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { renderComponent } from "./render-component";
import { RichText } from "@/components/rich-text";
import { parseBlocks, parseInline, substitute } from "@/lib/rich-text";

// CAMP-365 — текст із CMS. Файл стереже дві різні речі, і плутати їх
// не можна: ЩО читач бачить, і чого браузер НЕ виконає.

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

  // 🔴 РЕГІСТР СХЕМИ НЕ СМІЄ КИДАТИ.
  //
  // Рецензія: `/^(https:\/\/|mailto:)/` без `i` кидав на `HTTPS://…`, а
  // кидок у серверному компоненті валить УСЮ сторінку, не одне
  // посилання. Тепер схему дає розбір `URL`, і він нормалізує регістр.
  for (const href of ["HTTPS://example.org", "Mailto:a@b.eu"]) {
    test(`«${href}» приймається, а не валить сторінку`, () => {
      expect(() => parseInline(`[x](${href})`)).not.toThrow();
    });
  }
});

test.describe("🔴 чого браузер не виконає", () => {
  // 🔴 ВЛАСТИВІСТЬ, А НЕ СПИСОК НАПИСАНЬ.
  //
  // Перша редакція перелічувала `javascript:`, `data:`, `//evil` — і
  // рецензія обійшла її входом `/\evil.com`, бо браузер читає `\` як
  // `/`. Заміряно: new URL("/\\evil.com", "https://camptribe.eu/x") →
  // https://evil.com/. Список обходять новим написанням; тому нижче
  // перевіряється ВЛАСТИВІСТЬ — «після розбору адреса лишилась на
  // нашому origin», — а перелік входів тут лише ілюструє її.
  for (const bad of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "//evil.example",
    "/\\evil.com",
    "/\\\\evil.com",
    "\\\\evil.com",
    "vbscript:msgbox",
  ]) {
    test(`адреса «${bad}» не проходить`, () => {
      expect(
        () => parseInline(`[клік](${bad})`),
        `адресу «${bad}» пропущено`,
      ).toThrow(/не дозволена/);
    });
  }

  // 🔴 ЕКРАНУВАННЯ — НА КОЖНІЙ ГІЛЦІ РЕНДЕРУ, А НЕ В ОДНОМУ МІСЦІ.
  //
  // Рецензія довела, що попередня перевірка міряла буквальний рядок
  // «dangerouslySetInnerHTML», а не властивість: обчислена назва пропа
  // (`["dangerously","Set","Inner","HTML"].join("")`) на ОДНІЙ лише
  // гілці `strong` лишила всі 15 тестів зеленими, а в розмітку поїхав
  // живий `<img onerror=…>`. Тому payload тепер іде в КОЖНУ позицію,
  // яку малює свій вузол.
  const EVIL = "<img src=x onerror=alert(1)>";
  for (const [where, text] of [
    ["звичайний текст", EVIL],
    ["виділення", `**${EVIL}**`],
    ["підпис посилання", `[${EVIL}](/x)`],
    ["підзаголовок", `## ${EVIL}`],
    ["пункт списку", `- ${EVIL}`],
  ] as const) {
    test(`розмітка в позиції «${where}» лишається текстом`, () => {
      const html = renderComponent(RichText, { text });
      expect(html, `у «${where}» зʼявився живий <img`).not.toContain("<img");
      expect(html, `у «${where}» зʼявився <script`).not.toContain("<script");
      // 🔴 Пара: текст таки показано, екранованим. Без неї твердження
      // було б істинним і над порожнім рендером.
      expect(html, `у «${where}» текст зник замість екрануватись`).toContain(
        "&lt;img",
      );
    });
  }

  test("у рендері немає жодного способу віддати сирий HTML", () => {
    // Сторож на СПОСІБ лишається, але він тепер другий рубіж, а не
    // перший: властивість вище ловить і те, чого цей не бачить.
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
    expect(
      code,
      "у рендері зʼявився createElement із обчисленим пропом",
    ).not.toContain("createElement");
    // 🔴 Пара: знімач коментарів не зʼїв файл цілком.
    expect(code, "знімач коментарів лишив порожнечу").toContain(
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

  // 🔴 УСПАДКОВАНІ КЛЮЧІ — ЦЕ НЕ ВІДОМІ КЛЮЧІ.
  //
  // Рецензія: `values[key]` діставав `Object.prototype`, тож
  // `{{__proto__}}` давало «[object Object]», `{{constructor}}` — текст
  // функції. Замість обіцяного гучного падіння читач бачив сміття.
  for (const key of [
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
  ]) {
    test(`«{{${key}}}» кидає, а не малює успадковане`, () => {
      expect(() =>
        substitute(`{{${key}}}`, { "company.name": "UTD BV" }),
      ).toThrow(/невідома підстановка/);
    });
  }

  test("🔴 порожнього рядка замість підстановки не буває", () => {
    let out = "";
    try {
      out = substitute("керує {{nope}}, Антверпен", {});
    } catch {
      out = "кинуло";
    }
    expect(out).toBe("кинуло");
  });
});

// CAMP-365 — третій рівень, рамка і якорі. Усе троє додано під переїзд
// семи правових сторінок, і кожне твердження нижче стоїть на замірі з
// тих сторінок, а не на бажанні мати ширшу розмітку.
test.describe("правова розмітка", () => {
  test("«### » дає h3, а не абзац і не h2", () => {
    const blocks = parseBlocks("### Підрозділ");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind, "третій рівень злився з чимось іншим").toBe("h3");
    const html = renderComponent(RichText, { text: "### Підрозділ" });
    expect(html).toContain("<h3");
    expect(html, "h3 намальовано як h2").not.toContain("<h2");
  });

  test("«> » дає рамку, і позначка не лишається у видимому тексті", () => {
    const html = renderComponent(RichText, {
      text: "> **Перевірте.** Дані можуть бути застарілі.\n> Телефонуйте на місце.",
    });
    expect(html).toContain("accent-surface");
    expect(html, "рамка перетворилась на цитату з видимим «>»").not.toMatch(
      /&gt;|>\s*\*\*/,
    );
    expect(html).toContain("Перевірте.");
    expect(html, "другий рядок рамки загубився").toContain(
      "Телефонуйте на місце.",
    );
  });

  test("🔴 якір заголовка — той, що написано, а не вирахуваний із тексту", () => {
    const blocks = parseBlocks("## Links to other sites {#links}");
    expect(blocks[0]).toMatchObject({ kind: "h2", id: "links" });
    const html = renderComponent(RichText, {
      text: "## Links to other sites {#links}",
    });
    expect(html, "якоря немає в розмітці").toContain('id="links"');
    expect(html, "позначка якоря видима читачеві").not.toContain("{#links}");
    expect(html).toContain("Links to other sites");
  });

  test("заголовок без якоря лишається без id, а не дістає вигаданий", () => {
    const blocks = parseBlocks("## Просто заголовок");
    expect(blocks[0]).toMatchObject({ kind: "h2", id: null });
    const html = renderComponent(RichText, { text: "## Просто заголовок" });
    expect(html).not.toContain("id=");
  });

  // 🔴 Обидві негативні перевірки вище зелені й тоді, коли не
  // друкується НІЧОГО. Тому поруч — випадки, де мовчання не рятує:
  // зіпсована форма й повтор мусять КИНУТИ.
  test("🔴 зіпсований якір кидає, а не губиться", () => {
    expect(() => parseBlocks("## Заголовок {#Links}")).toThrow(/якір/);
    expect(() => parseBlocks("## Заголовок {#}")).toThrow(/якір/);
    expect(() => parseBlocks("## Заголовок {# links}")).toThrow(/якір/);
  });

  test("🔴 два однакові якорі кидають", () => {
    expect(() =>
      parseBlocks("## Один {#same}\n\n## Другий {#same}"),
    ).toThrow(/#same/);
    // а різні — ні, інакше попереднє твердження було б зелене завжди
    expect(() =>
      parseBlocks("## Один {#a}\n\n## Другий {#b}"),
    ).not.toThrow();
  });

  test("🔴 h3 теж несе якір — інакше рівень вирішував би, чи працює посилання", () => {
    const blocks = parseBlocks("### Підрозділ {#sub}");
    expect(blocks[0]).toMatchObject({ kind: "h3", id: "sub" });
  });
});
