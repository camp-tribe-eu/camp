import { Fragment } from "react";
import { A, B, Callout, H2, H3, P, UL } from "@/content/legal/prose";
import { parseBlocks, substitute, type Inline } from "@/lib/rich-text";
import { PAGE_VALUES } from "@/lib/page-content";

/**
 * CAMP-365 — правовий документ із розмітки CMS, намальований ТИМИ
 * САМИМИ компонентами, що й досі.
 *
 * 🔴 ЧОМУ НЕ `RichText`. Той рендер має власні класи — `text-xl
 * font-semibold` на заголовку, `space-y-4 text-ink-2` на обгортці. У
 * правових сторінок вони інші: `mt-10 text-xl font-bold first:mt-0`,
 * абзац `mt-3 text-sm leading-6`, посилання з `decoration-line-blue
 * underline-offset-2`. Рецензія #307 заміряла саме це: переїзд через
 * `RichText` змінив би вигляд семи юридичних документів, не втративши
 * жодного слова — і посимвольна звірка тексту цього б не побачила.
 *
 * Тому класи лишаються там, де й були: у `content/legal/prose.tsx`.
 * Цей файл не малює нічого власного, він лише розкладає блоки по
 * наявних компонентах.
 *
 * 🔴 І ПОСИЛАННЯ ЛИШАЮТЬСЯ ЗВИЧАЙНИМ `<a>`, як у `prose.tsx`, а не
 * `next/link`, як у `RichText`. Це видима відмінність поведінки
 * (перехід не клієнтський), і міняти її переїздом джерела даних не
 * можна: картка каже «тут тільки джерело даних».
 */

function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((s, i) => {
        switch (s.kind) {
          case "strong":
            return <B key={i}>{s.text}</B>;
          case "em":
            return <i key={i}>{s.text}</i>;
          case "link":
            return (
              <A key={i} href={s.href}>
                {s.text}
              </A>
            );
          case "text":
            return <span key={i}>{s.text}</span>;
          default: {
            const never: never = s;
            throw new Error(
              `legal-prose: немає рендера для ${JSON.stringify(never)}.`,
            );
          }
        }
      })}
    </>
  );
}

export function LegalProse({
  text,
  values = PAGE_VALUES,
}: {
  text: string;
  values?: Readonly<Record<string, string>>;
}) {
  // 🔴 ПІДСТАНОВКА ДО РОЗБОРУ, як у `RichText`, і з тієї ж причини:
  // `[{{company.email}}](mailto:{{company.email}})` мусить стати
  // посиланням, а не текстом із дужками. Реквізити компанії в правових
  // сторінках саме такі — заміряно: `{{company.email}}` 18 разів.
  const blocks = parseBlocks(substitute(text, values));

  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h2":
            // 🔴 Якір ОБОВʼЯЗКОВИЙ саме тут. У семи документах 42
            // заголовки й 42 `id`; на два з них посилаємось ми самі, на
            // решту може послатись будь-хто ззовні. Заголовок без якоря
            // це зламане посилання, тож падаємо на складанні сторінки,
            // а не віддаємо документ, у якому не відкривається розділ.
            if (b.id === null) {
              throw new Error(
                "legal-prose: заголовок без якоря. Правовий документ " +
                  "цитують за розділами, тож кожен `## ` потребує " +
                  "`{#id}`.",
              );
            }
            return (
              <H2 key={i} id={b.id}>
                <Spans spans={b.spans} />
              </H2>
            );
          case "h3":
            return (
              <H3 key={i}>
                <Spans spans={b.spans} />
              </H3>
            );
          case "callout":
            // 🔴 БЕЗ `<p>` УСЕРЕДИНІ, І ЦЕ НЕ НЕДОГЛЯД. Оригінальна
            // рамка в `prose.tsx` малює дітей просто в `<div>`, а
            // кілька абзаців у ній розділені `<br /><br />` — так
            // зроблена рамка про ODbL в `attribution.tsx`. Обгорнути їх
            // в `<p>` означало б ПОКРАЩИТИ розмітку сімох юридичних
            // документів тим самим кроком, яким переїжджає джерело
            // даних, а картка каже прямо: «тут тільки джерело даних».
            //
            // Заміряно: `<p>` усередині давав зайвий елемент у кістяку
            // `notice` (26 проти 25) і зсував текст.
            return (
              <Callout key={i}>
                {b.paragraphs.map((spans, j) => (
                  <Fragment key={j}>
                    {j > 0 && (
                      <>
                        <br />
                        <br />
                      </>
                    )}
                    <Spans spans={spans} />
                  </Fragment>
                ))}
              </Callout>
            );
          case "ul":
            return (
              <UL key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item} />
                  </li>
                ))}
              </UL>
            );
          case "p":
            return (
              <P key={i}>
                <Spans spans={b.spans} />
              </P>
            );
          default: {
            const never: never = b;
            throw new Error(
              `legal-prose: немає рендера для блоку ${JSON.stringify(never)}.`,
            );
          }
        }
      })}
    </>
  );
}
