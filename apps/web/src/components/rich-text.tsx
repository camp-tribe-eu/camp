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
        if (s.kind === "strong") {
          return (
            <strong key={i} className="text-heading">
              {s.text}
            </strong>
          );
        }
        if (s.kind === "link") {
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
        }
        return <span key={i}>{s.text}</span>;
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
        if (b.kind === "h2") {
          return (
            <h2 key={i} className="text-xl font-semibold text-heading">
              <Spans spans={b.spans} />
            </h2>
          );
        }
        if (b.kind === "ul") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.items.map((item, j) => (
                <li key={j}>
                  <Spans spans={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            <Spans spans={b.spans} />
          </p>
        );
      })}
    </div>
  );
}
