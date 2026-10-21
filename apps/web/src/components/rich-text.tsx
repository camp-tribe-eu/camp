import Link from "next/link";
import { parseBlocks, substitute, type Inline } from "@/lib/rich-text";

// CAMP-365 — текст із CMS, перетворений на елементи React.
//
// 🔴 ТУТ НЕМАЄ `dangerouslySetInnerHTML`, І ЦЕ НЕ ЗАБУТО.
//
// Кожен шматок тексту потрапляє в дерево як ТЕКСТОВИЙ вузол, тож React
// екранує його сам. Вставити розмітку через поле CMS неможливо за
// побудовою: зібраного HTML у цьому шляху не існує взагалі. Саме тому в
// репозиторії й не зʼявилось ні markdown-бібліотеки, ні очищувача —
// очищати нічого.

function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((s, i) => {
        // 🔴 Вичерпно, з тієї ж причини, що й блоки нижче: доки в кінці
        // стояв `return <span>`, новий вид тексту малювався б як
        // звичайний — і саме так наголос зник би мовчки.
        switch (s.kind) {
          case "strong":
            return (
              <strong key={i} className="text-heading">
                {s.text}
              </strong>
            );
          case "em":
            return <em key={i}>{s.text}</em>;
          case "link":
            // 🔴 Внутрішні — через `next/link`, щоб перехід лишався
            // клієнтським, як на решті сайту. Зовнішні — звичайним `<a>`
            // із `rel="noopener"`, як уже робить підвал.
            return s.href.startsWith("/") ? (
              <Link key={i} href={s.href} className="underline">
                {s.text}
              </Link>
            ) : (
              <a key={i} href={s.href} className="underline" rel="noopener">
                {s.text}
              </a>
            );
          case "text":
            return <span key={i}>{s.text}</span>;
          default: {
            const never: never = s;
            throw new Error(
              `rich-text: немає рендера для ${JSON.stringify(never)}.`,
            );
          }
        }
      })}
    </>
  );
}

/**
 * Тіло, що приходить із бази.
 *
 * `values` — підстановки, дозволені цьому тексту. Невідомий ключ у
 * тексті кидає (див. `substitute`): текст із CMS не вигадує ключів, а
 * підстановка, що мовчки зникла, читається як поломка.
 */
export function RichText({
  text,
  values = {},
  className = "max-w-prose space-y-4 text-ink-2",
}: {
  text: string;
  values?: Readonly<Record<string, string>>;
  className?: string;
}) {
  const blocks = parseBlocks(substitute(text, values));

  return (
    <div className={className}>
      {blocks.map((b, i) => {
        // 🔴 РОЗБІР ВИЧЕРПНИЙ, І ЦЕ НЕ СТИЛЬ, А ЗАПОБІЖНИК.
        //
        // Доки в кінці стояв `return <p>`, новий вид блоку малювався б
        // ЯК АБЗАЦ — мовчки. Заміряно на собі: щойно доданий `h3`
        // пройшов `tsc` зеленим і віддав би чотирнадцять підзаголовків
        // правових сторінок звичайним текстом. `never` нижче перетворює
        // цей клас дефекту на помилку складання.
        switch (b.kind) {
          case "h2":
            return (
              <h2
                key={i}
                id={b.id ?? undefined}
                className="scroll-mt-24 text-xl font-semibold text-heading"
              >
                <Spans spans={b.spans} />
              </h2>
            );
          case "h3":
            return (
              <h3
                key={i}
                id={b.id ?? undefined}
                className="scroll-mt-24 text-base font-semibold text-heading"
              >
                <Spans spans={b.spans} />
              </h3>
            );
          case "callout":
            return (
              <div
                key={i}
                className="rounded-card border border-line-blue bg-accent-surface p-4 text-heading"
              >
                {b.paragraphs.map((spans, j) => (
                  <p key={j} className={j > 0 ? "mt-3" : undefined}>
                    <Spans spans={spans} />
                  </p>
                ))}
              </div>
            );
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item} />
                  </li>
                ))}
              </ul>
            );
          case "p":
            return (
              <p key={i}>
                <Spans spans={b.spans} />
              </p>
            );
          default: {
            const never: never = b;
            throw new Error(
              `rich-text: немає рендера для блоку ${JSON.stringify(never)}.`,
            );
          }
        }
      })}
    </div>
  );
}
