/**
 * CAMP-449, перша частина: біжучий рядок.
 *
 * Усе нижче читає ВІДДАНИЙ HTML (`renderComponent`), а не константи
 * компонента: правило руху й правило його зупинки мають стояти в тому, що
 * отримує читач, інакше тест стверджував би те, чого не бачить.
 */
import { expect, test } from "@playwright/test";

import { Ticker, TickerImage } from "@/components/ticker";
import { renderComponent, rendersNothing } from "./render-component";

/** Вміст `@media (prefers-reduced-motion: reduce) { … }` з HTML, або null. */
function reducedMotionBlock(html: string): string | null {
  const m = html.match(
    /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{([\s\S]*?)\}\s*\}/,
  );
  return m ? m[1] : null;
}

test("🔴 тікер без елементів не рендериться зовсім — порожнє не малюємо", () => {
  expect(rendersNothing(Ticker, { items: [] })).toBe(true);
});

test("🔴 тікер, у якому ЖОДЕН елемент не живий, теж не рендериться", () => {
  expect(rendersNothing(Ticker, { items: ["", null, undefined, false, "  "] }))
    .toBe(true);
});

test("один зіпсований елемент коштує одного елемента, а не рядка", () => {
  const html = renderComponent(Ticker, { items: ["Alpha", "", null, "Beta"] });
  expect(html).toContain("Alpha");
  expect(html).toContain("Beta");
  // Два живі елементи, кожен двічі (петля) — чотири, не більше.
  expect(html.match(/class="ct-ticker__item"/g)?.length).toBe(4);
});

test("вміст віддається двічі — петля до −50% без шва, і копія схована від диктора", () => {
  const html = renderComponent(Ticker, { items: ["Alpha", "Beta"] });
  expect(html.match(/Alpha/g)?.length).toBe(2);
  expect(html.match(/Beta/g)?.length).toBe(2);
  expect(html.match(/aria-hidden="true"/g)?.length).toBe(2);
  // Перша копія — НЕ схована: диктор мусить почути текст рівно раз.
  const first = html.indexOf("Alpha");
  const firstTag = html.lastIndexOf("<div", first);
  expect(html.slice(firstTag, first)).not.toContain("aria-hidden");
  expect(html).toContain("--animateEnd:-50%");
});

test("🔴 тікер містить правило prefers-reduced-motion, і воно зупиняє саме доріжку", () => {
  const html = renderComponent(Ticker, { items: ["Alpha"] });
  const block = reducedMotionBlock(html);
  expect(block, "у відданому HTML немає @media (prefers-reduced-motion: reduce)")
    .not.toBeNull();
  expect(block).toContain(".ct-ticker__items");
  expect(block).toMatch(/animation\s*:\s*none/);
});

test("швидкість і напрямок — змінними теми на корені, як у ticker.build.css", () => {
  const html = renderComponent(Ticker, {
    items: ["Alpha"],
    direction: "reverse",
    speed: { desktop: "45s", mobile: "20s" },
  });
  expect(html).toContain("--desktop-movement-speed:45s");
  expect(html).toContain("--mobile-movement-speed:20s");
  expect(html).toContain("--direction:reverse");
  // CSS читає саме ці змінні: напрямок анімації і тривалість, що
  // перемикається на 768px.
  expect(html).toContain("animation-direction:var(--direction)");
  expect(html).toContain("animation-duration:var(--mobile-movement-speed)");
  expect(html).toMatch(
    /@media\(min-width:768px\)\{[^}]*\}[^@]*animation-duration:var\(--desktop-movement-speed\)/,
  );
});

test("типові значення — з демо-стору теми: 60s / 30s, normal", () => {
  const html = renderComponent(Ticker, { items: ["Alpha"] });
  expect(html).toContain("--desktop-movement-speed:60s");
  expect(html).toContain("--mobile-movement-speed:30s");
  expect(html).toContain("--direction:normal");
});

test("елементи довільні: текст із картинкою і прапор + назва + число", () => {
  const html = renderComponent(Ticker, {
    items: [
      <>
        <TickerImage src="/x.jpg" alt="Намет" />
        <span>Сезонний розпродаж</span>
      </>,
      <span key="hr">
        🇭🇷 Croatia <strong>1 204</strong>
      </span>,
    ],
  });
  expect(html).toContain('class="ct-ticker__image-wrapper"');
  expect(html).toContain('src="/x.jpg"');
  expect(html).toContain("Сезонний розпродаж");
  expect(html).toContain("🇭🇷 Croatia");
  expect(html).toContain("<strong>1 204</strong>");
});

test("наведення і фокус зупиняють рух (ticker--pause-on-hover), і це можна вимкнути", () => {
  const on = renderComponent(Ticker, { items: ["Alpha"] });
  expect(on).toContain("ct-ticker--pause-on-hover");
  expect(on).toContain(
    ".ct-ticker--pause-on-hover:focus-within .ct-ticker__items{animation-play-state:paused}",
  );
  const off = renderComponent(Ticker, { items: ["Alpha"], pauseOnHover: false });
  expect(off).not.toMatch(/class="[^"]*ct-ticker--pause-on-hover/);
});

test("стиль піднімається один раз, скільки б тікерів не стояло поруч", () => {
  const Two = () => (
    <>
      <Ticker items={["A"]} />
      <Ticker items={["B"]} />
    </>
  );
  const html = renderComponent(Two, {});
  expect(html.match(/<style/g)?.length).toBe(1);
  expect(html.match(/class="ct-ticker /g)?.length).toBe(2);
});

test("тікер не вживає читальної колонки", () => {
  expect(renderComponent(Ticker, { items: ["Alpha"] })).not.toContain(
    "max-w-prose",
  );
});
