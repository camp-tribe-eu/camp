/**
 * CAMP-449, перша частина: багатошаровий банер.
 *
 * Шари знизу вгору, словами власника: фон → (розмиття) → біжучий текст →
 * переднє фото → текст. Тут перевіряється ПОРЯДОК шарів у відданому HTML,
 * а не наявність класів десь у файлі: шар, якого в розмітці немає,
 * дає індекс −1 і ламає монотонність.
 */
import { expect, test } from "@playwright/test";

import { LayeredBanner } from "@/components/layered-banner";
import { renderComponent } from "./render-component";

/**
 * Розмітка без піднятого `<style>`: CSS теж згадує класи шарів, тож
 * «класу немає в HTML» мусить дивитись на дерево, а не на правила.
 *
 * 🔴 Заміна повторюється до нерухомої точки, а не робиться один раз. CodeQL
 * назвав однопрохідну форму «incomplete multi-character sanitization», і він
 * має рацію як правило: після одного проходу залишки можуть скластися в новий
 * `<style`. Тут на вхід іде наш власний відрендерений HTML, тож справжнього
 * ризику немає — але хелпер, який ОБІЦЯЄ прибрати стилі, мусить їх прибирати,
 * інакше тест мовчки дивиться не на те дерево.
 */
const markup = (html: string): string => {
  let out = html;
  for (;;) {
    const next = out.replace(/<style[\s\S]*?<\/style>/g, "");
    if (next === out) return out;
    out = next;
  }
};

const base = {
  background: { src: "/bg.jpg" },
  tickerText: "OUTDOOR",
  heading: "Усе для кемпінгу",
  description: "Опис банера",
  cta: { href: "/camping", label: "Дивитись" },
};

/** Індекси маркерів шарів у HTML, у порядку появи. */
function layerIndexes(html: string): number[] {
  return [
    'class="ct-banner__background"',
    "ct-banner__overlay",
    'class="ct-banner__ticker"',
    'class="ct-banner__media"',
    'class="ct-banner__box"',
  ].map((marker) => html.indexOf(marker));
}

test("🔴 пʼять шарів, усі присутні, знизу вгору: фон → накладка → тікер → фото → текст", () => {
  const html = renderComponent(LayeredBanner, {
    ...base,
    foreground: { src: "/fg.jpg", alt: "Намет" },
  });
  const idx = layerIndexes(markup(html));
  for (const [i, at] of idx.entries()) {
    expect(at, `шар №${i + 1} відсутній у HTML`).toBeGreaterThan(-1);
  }
  for (let i = 1; i < idx.length; i++) {
    expect(idx[i], `шар №${i + 1} стоїть не після шару №${i}`)
      .toBeGreaterThan(idx[i - 1]);
  }
});

test("біжучий текст — у шарі тікера, двічі (петля) і схований від диктора", () => {
  const html = renderComponent(LayeredBanner, base);
  expect(markup(html).match(/OUTDOOR/g)?.length).toBe(2);
  expect(html).toMatch(/class="ct-banner__ticker" aria-hidden="true"/);
  expect(html).toContain("animation-direction:var(--direction)");
  expect(html).toContain("animation-duration:var(--mobile-movement-speed)");
  expect(html).toContain("--animateEnd:-50%");
});

test("🔴 банер із розмиттям і без — різна розмітка, і різниця саме в накладці", () => {
  const plain = renderComponent(LayeredBanner, base);
  const blurred = renderComponent(LayeredBanner, { ...base, blur: true });
  expect(plain).not.toBe(blurred);
  expect(blurred).toContain('class="ct-banner__overlay ct-banner__overlay--blur"');
  expect(plain).toContain('class="ct-banner__overlay"');
  expect(plain).not.toContain("ct-banner__overlay--blur\"");
  // Розмиття — так, як у теми: модифікатор на накладці, а розмивається
  // сам фон через :has().
  expect(blurred).toMatch(
    /\.ct-banner__slide:has\(\.ct-banner__overlay--blur\) \.ct-banner__background\{filter:blur\(\d+px\)/,
  );
});

test("🔴 без переднього фото шару media немає зовсім — не порожня рамка", () => {
  const html = markup(renderComponent(LayeredBanner, base));
  expect(html).not.toContain("ct-banner__media");
  // А решта банера на місці.
  expect(html).toContain('class="ct-banner__background"');
  expect(html).toContain("Усе для кемпінгу");
  expect(html).toContain("OUTDOOR");
});

test("переднє фото, коли є, стоїть над тікером і несе свій alt", () => {
  const html = markup(
    renderComponent(LayeredBanner, {
      ...base,
      foreground: { src: "/fg.jpg", alt: "Намет на березі" },
    }),
  );
  expect(html).toContain('class="ct-banner__media"');
  expect(html).toContain('alt="Намет на березі"');
  expect(html.indexOf('class="ct-banner__media"')).toBeGreaterThan(
    html.indexOf('class="ct-banner__ticker"'),
  );
});

test("🔴 банер містить правило prefers-reduced-motion для своєї доріжки", () => {
  const html = renderComponent(LayeredBanner, base);
  const m = html.match(
    /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{([\s\S]*?)\}\s*\}/,
  );
  expect(m, "у відданому HTML немає @media (prefers-reduced-motion: reduce)")
    .not.toBeNull();
  expect(m![1]).toContain(".ct-banner__ticker-items");
  expect(m![1]).toMatch(/animation\s*:\s*none/);
});

test("текстовий блок: заголовок, опис і кнопка-посилання", () => {
  const html = renderComponent(LayeredBanner, base);
  expect(html).toMatch(/<h2 class="ct-banner__heading">Усе для кемпінгу<\/h2>/);
  expect(html).toContain("Опис банера");
  expect(html).toMatch(/<a [^>]*href="\/camping"[^>]*>Дивитись<\/a>/);
});

test("заголовок може бути h1 на сторінці, де банер головний", () => {
  const html = renderComponent(LayeredBanner, { ...base, headingLevel: 1 });
  expect(html).toContain("<h1 class=\"ct-banner__heading\">");
  expect(html).not.toContain("<h2");
});

test("без опису й кнопки — без порожніх обгорток", () => {
  const html = markup(
    renderComponent(LayeredBanner, {
      background: base.background,
      tickerText: base.tickerText,
      heading: base.heading,
    }),
  );
  expect(html).not.toContain("ct-banner__description");
  expect(html).not.toContain("ct-banner__button-wrapper");
  expect(html).not.toContain("<a ");
});

test("швидкість, напрямок і висота — змінними на корені, як у теми", () => {
  const html = renderComponent(LayeredBanner, {
    ...base,
    direction: "reverse",
    speed: { desktop: "40s", mobile: "15s" },
    minHeight: "600px",
  });
  expect(html).toContain("--desktop-movement-speed:40s");
  expect(html).toContain("--mobile-movement-speed:15s");
  expect(html).toContain("--direction:reverse");
  expect(html).toContain("--ct-banner-height:600px");
  // Перемикання швидкості — на 992px, як у interactive-slides теми.
  expect(html).toMatch(
    /@media\(min-width:992px\)\{[^@]*animation-duration:var\(--desktop-movement-speed\)/,
  );
});

test("фон декоративний за замовчуванням: alt порожній, а не відсутній", () => {
  const html = renderComponent(LayeredBanner, base);
  expect(html).toMatch(/<img class="ct-banner__background" src="\/bg.jpg" alt=""/);
});

test("банер не вживає читальної колонки", () => {
  expect(renderComponent(LayeredBanner, base)).not.toContain("max-w-prose");
});
