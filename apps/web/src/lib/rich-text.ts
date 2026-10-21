// CAMP-365 — розбір тексту, що приходить із CMS.
//
// 🔴 ЧОМУ ЦЕ ВЗАГАЛІ ПОТРІБНО, І ЧОМУ БЕЗ БІБЛІОТЕКИ.
//
// Дім уже рендерить тіло з бази: `guides/[slug]/page.tsx` ділить текст
// на блоки по порожньому рядку, рядок із «- » робить списком, решту —
// абзацом. Формат простий і свідомий: ні markdown-бібліотеки, ні
// `dangerouslySetInnerHTML` в репозиторії немає жодної, а CI гейтиться
// на вразливості залежностей — тож кожна нова бібліотека це постійна
// ціна.
//
// Але цей формат не виражає ДВОХ речей, без яких текст із CMS не
// замінить текст із коду:
//   • посилання ВСЕРЕДИНІ речення — `/about` має його на «Legal
//     notice», і 1 256 гайдів не можуть поставити жодного внутрішнього
//     посилання в тілі;
//   • виділення — в `/about` ним позначено речення, яке коментар поруч
//     називає найважливішим на сторінці.
//
// 🔴 ЧОМУ ЦЕ БЕЗПЕЧНО, хоч текст редагує людина, а не рецензія.
//
// Розбір НЕ будує HTML-рядків. Він повертає опис, з якого React робить
// елементи, а React екранує текст сам. Тобто вставити розмітку через
// поле CMS неможливо за побудовою — не тому, що ми щось вичищаємо, а
// тому, що зібраного HTML тут немає взагалі.
//
// Окремо перевіряються адреси посилань: `javascript:` в `href` це
// виконання коду, і воно пройшло б повз React. Тому дозволені схеми
// перелічені, а не заборонені — список заборон обходять новим словом.

/** Шматок рядка: або звичайний текст, або посилання, або виділення. */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "link"; text: string; href: string };

/** Блок: абзац, підзаголовок або список. */
export type Block =
  | { kind: "p"; spans: Inline[] }
  | { kind: "h2"; spans: Inline[] }
  | { kind: "ul"; items: Inline[][] };

/**
 * 🔴 ДОЗВОЛЕНІ СХЕМИ ПЕРЕЛІЧЕНІ, А НЕ ЗАБОРОНЕНІ.
 *
 * Перелік заборон («не можна javascript:») обходять новим словом —
 * `data:`, `vbscript:`, пробіл перед двокрапкою, регістр. Перелік
 * дозволів не обходять нічим: усе, чого в ньому немає, не проходить.
 *
 * Внутрішні шляхи — це `/щось`, і саме вони тут основні. `//host` НЕ
 * внутрішній: браузер читає його як протоколо-відносну адресу на чужий
 * сайт, і саме тому перевірка дивиться на другий символ теж.
 */
function allowedHref(href: string): boolean {
  if (href.startsWith("/") && !href.startsWith("//")) return true;
  return /^(https:\/\/|mailto:)/.test(href);
}

/**
 * Підстановки виду `{{company.name}}`.
 *
 * 🔴 НЕВІДОМИЙ КЛЮЧ — ЦЕ ПОМИЛКА, А НЕ ПОРОЖНІЙ РЯДОК. Текст, де
 * підстановка мовчки зникла, читач побачить як «керується , Антверпен»
 * — тобто як поломку, якої ніхто не помітив на нашому боці. Порожнеча
 * неправильна завжди, а гучне падіння видно одразу.
 */
export function substitute(
  text: string,
  values: Readonly<Record<string, string>>,
): string {
  return text.replace(/\{\{([a-z0-9_.]+)\}\}/gi, (_, key: string) => {
    const v = values[key];
    if (v === undefined) {
      throw new Error(
        `rich-text: невідома підстановка «{{${key}}}». Дозволені: ` +
          `${Object.keys(values).sort().join(", ") || "—"}. ` +
          "Текст із CMS не може вигадувати ключі.",
      );
    }
    return v;
  });
}

/** Розбирає один рядок на текст, виділення й посилання. */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  // Один прохід, два візерунки: `[текст](адреса)` і `**текст**`.
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(line)) !== null) {
    if (m.index > last)
      out.push({ kind: "text", text: line.slice(last, m.index) });
    if (m[3] !== undefined) {
      out.push({ kind: "strong", text: m[3] });
    } else {
      const href = m[2];
      if (!allowedHref(href)) {
        throw new Error(
          `rich-text: адреса «${href}» не дозволена. Можна внутрішній ` +
            "шлях (/…), https:// або mailto:. Схеми перелічені, а не " +
            "заборонені — перелік заборон обходять новим словом.",
        );
      }
      out.push({ kind: "link", text: m[1], href });
    }
    last = re.lastIndex;
  }

  if (last < line.length) out.push({ kind: "text", text: line.slice(last) });
  return out;
}

/**
 * Текст → блоки. Формат той самий, що вже читає сторінка гайда:
 * порожній рядок ділить блоки, «- » робить список. Додано «## » для
 * підзаголовка.
 */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split(/\n\s*\n/)) {
    const block = raw.trim();
    if (!block) continue;

    if (block.startsWith("- ")) {
      blocks.push({
        kind: "ul",
        items: block
          .split("\n")
          .map((l) => l.replace(/^-\s*/, "").trim())
          .filter(Boolean)
          .map(parseInline),
      });
      continue;
    }

    if (block.startsWith("## ")) {
      blocks.push({ kind: "h2", spans: parseInline(block.slice(3).trim()) });
      continue;
    }

    // Переноси всередині абзацу — це один абзац, а не кілька: у полі
    // CMS вони зʼявляються від ширини вікна редактора, не від наміру.
    blocks.push({ kind: "p", spans: parseInline(block.replace(/\n/g, " ")) });
  }
  return blocks;
}
