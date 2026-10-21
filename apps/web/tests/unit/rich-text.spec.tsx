import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { renderComponent } from "./render-component";
import { RichText } from "@/components/rich-text";
import {
  assertUniqueAnchors,
  parseBlocks,
  parseInline,
  substitute,
} from "@/lib/rich-text";

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
  // 🔴 І ПЕРЕЛІК ПОЗИЦІЙ ЗВІРЯЄТЬСЯ З РЕНДЕРОМ, А НЕ ПИШЕТЬСЯ РУКОЮ.
  //
  // Рецензія #307 заміряла, чого це коштує. Той самий обчислений проп
  // (`["dangerously","Set","Inner","HTML"].join("")`), поставлений у
  // щойно додану гілку `em`, лишив УВЕСЬ юніт-проєкт байт у байт на
  // базовій лінії — 1892 passed, 10 skipped — і віддав у розмітку
  // живий `<img onerror=…>`. Бо перелік нижче мав пʼять позицій, а
  // рендер відростив три нові вузли: `em`, `h3` і абзац рамки.
  //
  // Це третій раз, коли новий побратим не вступає в інвентар сторожа,
  // тож перелік більше не є списком: нижче він ЗВІРЯЄТЬСЯ з мітками
  // `case` самого рендера, і гілка без випадку валить тест на імені.
  /**
   * Код рендера БЕЗ коментарів. Окремою функцією, бо його читають два
   * сторожі, а сторож, який матчить коментар, уже був: згадка «тут
   * немає dangerouslySetInnerHTML» колись сама задовольняла перевірку.
   */
  const rendererCode = () =>
    readFileSync(
      path.join(__dirname, "..", "..", "src", "components", "rich-text.tsx"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  const EVIL = "<img src=x onerror=alert(1)>";
  const POSITIONS: ReadonlyArray<{
    where: string;
    text: string;
    covers: readonly string[];
  }> = [
    { where: "звичайний текст", text: EVIL, covers: ["p", "text"] },
    { where: "виділення", text: `**${EVIL}**`, covers: ["strong"] },
    { where: "наголос", text: `*${EVIL}*`, covers: ["em"] },
    { where: "підпис посилання", text: `[${EVIL}](/x)`, covers: ["link"] },
    { where: "підзаголовок", text: `## ${EVIL}`, covers: ["h2"] },
    { where: "третій рівень", text: `### ${EVIL}`, covers: ["h3"] },
    { where: "рамка", text: `> ${EVIL}`, covers: ["callout"] },
    { where: "пункт списку", text: `- ${EVIL}`, covers: ["ul"] },
  ];

  for (const { where, text } of POSITIONS) {
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

  // 🔴 ЗВІРКА ПЕРЕЛІКУ З РЕНДЕРОМ. Без неї попередні вісім випадків
  // лишаються просто списком, який хтось колись забуде доповнити — і
  // підсумок «8 passed» виглядатиме так само зелено.
  test("🔴 кожна гілка рендера має свою позицію в матриці", () => {
    const code = rendererCode();
    const labels = new Set(
      [...code.matchAll(/case "([a-z0-9-]+)":/g)].map((m) => m[1]),
    );
    const covered = new Set(POSITIONS.flatMap((p) => p.covers));

    expect(labels.size, "у рендері не знайдено жодної гілки — розбір зламався")
      .toBeGreaterThan(5);
    expect(
      [...labels].filter((l) => !covered.has(l)).sort(),
      "рендер малює вузол, якого немає в матриці екранування",
    ).toEqual([]);
    expect(
      [...covered].filter((c) => !labels.has(c)).sort(),
      "матриця називає вузол, якого рендер не малює",
    ).toEqual([]);
  });

  test("у рендері немає жодного способу віддати сирий HTML", () => {
    // Сторож на СПОСІБ лишається, але він тепер другий рубіж, а не
    // перший: властивість вище ловить і те, чого цей не бачить.
    const code = rendererCode();

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

  // 🔴 Рамка про ODbL у `attribution.tsx` складається з ТРЬОХ абзаців,
  // розділених `<br /><br />`. Якби рамка вміла один, переїзд склеїв би
  // три окремі умови в стіну тексту — мовчки й без втрати жодного слова,
  // тобто посимвольна звірка тексту цього б не побачила.
  test("🔴 рамка тримає кілька абзаців, розділених рядком з одного «>»", () => {
    const blocks = parseBlocks(
      "> перший\n>\n> другий\n>\n> третій",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "callout" });
    const callout = blocks[0] as { kind: "callout"; paragraphs: unknown[] };
    expect(callout.paragraphs, "абзаців у рамці не три").toHaveLength(3);

    const html = renderComponent(RichText, {
      text: "> перший\n>\n> другий\n>\n> третій",
    });
    expect(
      (html.match(/<p/g) ?? []).length,
      "абзаци рамки злились в один",
    ).toBe(3);
  });

  test("рамка без тексту кидає, а не малює порожню коробку", () => {
    expect(() => parseBlocks("> \n>")).toThrow(/рамка/);
  });

  // 🔴 ЄДИНИЙ КУРСИВ У СЕМИ СТОРІНКАХ, І ВІН НЕСЕ ПРАВОВУ РІЗНИЦЮ:
  // «something produced *from* the data» протиставляє похідний твір
  // адаптованій базі — там, де ODbL вимагає різного.
  test("🔴 «*слово*» дає наголос, а «**слово**» лишається виділенням", () => {
    const html = renderComponent(RichText, {
      text: "produced *from* the data, not a **database**",
    });
    expect(html, "наголосу немає").toContain("<em>from</em>");
    expect(html).toContain("<strong");
    expect(html, "зірочки видно читачеві").not.toContain("*");
  });

  test("🔴 порядок гілок: подвійна зірочка не читається як дві одинарні", () => {
    const spans = parseInline("**жирний**");
    expect(spans).toHaveLength(1);
    expect(spans[0], "виділення стало наголосом").toMatchObject({
      kind: "strong",
      text: "жирний",
    });
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

// 🔴 CAMP-365 — дві дірки, які знайшла рецензія #307.
test.describe("межі формату", () => {
  // Без екранування `a * b * c` у полі CMS мовчки ставало курсивом.
  test("🔴 зворотна скісна робить зірочку просто зірочкою", () => {
    const spans = parseInline("знижка 5\\* і ще 10\\*");
    expect(
      spans.every((x) => x.kind === "text"),
      `щось стало розміткою: ${JSON.stringify(spans)}`,
    ).toBe(true);
    expect(spans.map((x) => x.text).join("")).toBe("знижка 5* і ще 10*");
  });

  test("екранується і квадратна дужка, і сама скісна", () => {
    expect(parseInline("\\[не посилання\\]").map((x) => x.text).join("")).toBe(
      "[не посилання]",
    );
    expect(parseInline("шлях C:\\\\").map((x) => x.text).join("")).toBe(
      "шлях C:\\",
    );
  });

  // Пара до попереднього: без неї «усе стало текстом» було б зеленим і
  // тоді, коли розмітка перестала працювати взагалі.
  test("екранування не вимикає звичайної розмітки поруч", () => {
    const spans = parseInline("5\\* це **багато**");
    expect(spans.some((x) => x.kind === "strong")).toBe(true);
    expect(spans.map((x) => x.text).join("")).toBe("5* це багато");
  });

  // 🔴 Якір унікальний у межах СТОРІНКИ. Кожна секція CMS розбирається
  // окремо, тож перевірка всередині одного розбору не бачить сусідньої
  // секції — а `what` трапляється в правових сторінках чотири рази.
  test("🔴 однакові якорі в РІЗНИХ секціях кидають", () => {
    const a = parseBlocks("## Перша {#what}");
    const b = parseBlocks("## Друга {#what}");
    expect(() => assertUniqueAnchors([a, b], "сторінці")).toThrow(/#what/);
  });

  test("різні якорі в різних секціях не кидають", () => {
    const a = parseBlocks("## Перша {#one}");
    const b = parseBlocks("## Друга {#two}");
    expect(() => assertUniqueAnchors([a, b], "сторінці")).not.toThrow();
  });
});
