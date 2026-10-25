import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/**
 * 🔴 ОДНЕ ОЗНАЧЕННЯ ПЕРЕВІРКИ ДОСТУПНОСТІ, І ГОЛОВНЕ В НЬОМУ —
 * ПОВІДОМЛЕННЯ, ЯКЕ НАЗИВАЄ ЕЛЕМЕНТ.
 *
 * 21.10.2026 за одну добу axe на `webkit-desktop` чотири рази дав
 * порушення, яке зникало з повтору: `plan` у темній темі, `/signup`,
 * `/forgot-password` двічі. Щоразу прогін коштував цикл CI — і щоразу
 * в звіті лишалось рівно це:
 *
 *     color-contrast: Elements must meet minimum color contrast ratio
 *
 * Тобто правило назване, а ЕЛЕМЕНТ — ні. Без нього немає чого
 * відтворювати: чотири однакові рядки не кажуть, чи це той самий
 * вузол, чи щоразу інший.
 *
 * Причина була у викликах: пʼять місць будували `AxeBuilder` окремо, і
 * чотири з них мапили порушення у `${id}: ${help}`, викидаючи
 * `nodes`. Лише `plan.spec.ts` друкував цілі — і саме він єдиний дав
 * хоч якусь зачіпку.
 *
 * 🔴 ЧОГО ТУТ НАВМИСНО НЕМАЄ: чекання `document.fonts.ready`. Гіпотеза,
 * що флуктуацію дає підміна шрифту, правдоподібна — і не доведена.
 * Обхід, збудований на недоведеній причині, це спосіб зробити дефект
 * невидимим, а не полагодженим. Спершу нехай наступне падіння назве
 * вузол.
 *
 * Падіння вузол назвало (`.border-line-blue`), і причина виявилась
 * ІНШОЮ, ніж шрифт, — вона доведена заміром нижче, біля `settle`.
 * Шрифт досі недоведений, тож чекання на нього досі немає.
 */
/**
 * 🔴 ЕКСПОРТОВАНО НАВМИСНО: це єдиний рядок, від якого тепер залежать
 * усі пʼять перевірок доступності, і він мусить мати сторожа.
 * Заміряно рецензією: одна зайва літера в назві тега дає НУЛЬ порушень
 * і жодної помилки — тобто сліпота без жодного сигналу.
 */
export const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
] as const;

/**
 * Теги правил axe, які ми взагалі вміємо просити.
 *
 * 🔴 Сторож живе ТУТ, а не лише в тесті над `WCAG_TAGS`, бо виклик має
 * обхід: `drought-layer.spec.ts` передає свій, вужчий перелік. Тест над
 * константою не побачив би друкарської помилки в ньому.
 */
const WCAG_TAG_SHAPE = /^wcag2[01]?a{1,2}$/;

export function assertWcagTags(tags: readonly string[]): readonly string[] {
  if (tags.length === 0) {
    throw new Error("axeViolations: порожній перелік тегів нічого не перевіряє");
  }
  const bad = tags.filter((t) => !WCAG_TAG_SHAPE.test(t));
  if (bad.length > 0) {
    throw new Error(
      `axeViolations: теги ${JSON.stringify(bad)} не є правилами WCAG — ` +
        `axe мовчки поверне НУЛЬ порушень. Дозволено: ${WCAG_TAG_SHAPE}`,
    );
  }
  return tags;
}

/**
 * 🔴 axe СКАНУЄ ОСІЛУ СТОРІНКУ, А НЕ КАДР ПЕРЕХОДУ (CAMP-387).
 *
 * 21.10.2026 коміт `a6a484b` дописав у `ct-button-motion` властивість
 * `opacity` (0.2 с). Відтоді в webkit мигтить `color-contrast` на
 * `.border-line-blue` — це кнопка `accent` на `/signup` і `/plan`: до
 * гідратації вона `disabled` і має `opacity: .6`, після — 1, і цей шлях
 * тепер ЙДЕ 0.2 с. axe, що стартує в перші кадри переходу, читає колір
 * ПОМІЖ і чесно звітує про контраст, якого в осілому стані немає.
 *
 * Заміряно 25.10.2026, webkit, саме ці два тести (кожен рядок — N
 * прогонів кожного з двох тестів); стан (б) — те саме, але з першої миті
 * `transition:none; animation:none`:
 *
 *   без навантаження         (а) 3 із 200    (б) 0 із 200
 *   + 6 процесів-вантажників (а) 21 із 150   (б) 0 із 150
 *
 * Усі падіння — `color-contrast` на `.border-line-blue`, і за `fgColor`
 * кожного з них ефективна прозорість кнопки лежить у 0.58–0.73: початок
 * згасання 0.6 → 1, а не якийсь інший колір.
 *
 * 🔴 ЛІКУЄТЬСЯ МОМЕНТ ЗАМІРУ, А НЕ ТВЕРДЖЕННЯ. Правило лишається тим
 * самим — WCAG AA, `color-contrast` увімкнений, без винятків: сторінка,
 * яка в ОСІЛОМУ стані справді неконтрастна, червоніє так само, як
 * червоніла (доведено мутацією кольору в `globals.css`, див. опис PR).
 * Єдине, що змінилось, — axe не починає, поки на сторінці щось ще їде.
 *
 * Чекаємо на `Animation.finished`, а не на таймер: ні `waitForTimeout`,
 * ні повтор не відповідають на питання «чи сторінка вже осіла», вони
 * лише зменшують шанс не зловити відповідь.
 *
 * ⚠️ Чекаємо лише на КІНЦЕВІ рухи. Нескінченна анімація (спінер) не
 * осяде ніколи, і чекання на неї підвісило б тест до таймауту. Рух, що
 * не скінчився за бюджет, — не тихе «скануємо як є», а помилка, що
 * називає його: інакше axe знову читав би напіврозчинену кнопку, тільки
 * вже непомітно.
 */
export const SETTLE_BUDGET_MS = 5_000;

export async function settle(
  page: Page,
  budgetMs: number = SETTLE_BUDGET_MS,
): Promise<void> {
  const unsettled = await page.evaluate(async (budget: number) => {
    // `getAnimations()` спершу застосовує відкладені зміни стилю, тож
    // перехід, запущений щойно зробленою зміною DOM (гідратація зняла
    // `disabled`), уже тут, навіть якщо кадру ще не було.
    const moving = () =>
      document.getAnimations().filter((a) => {
        if (a.playState !== "running") return false;
        const end = a.effect?.getComputedTiming().endTime;
        return typeof end === "number" && Number.isFinite(end);
      });
    const name = (a: Animation) => {
      const what =
        (a as CSSTransition).transitionProperty ??
        (a as CSSAnimation).animationName ??
        "animation";
      const el = (a.effect as KeyframeEffect | null)?.target as Element | null;
      const cls = typeof el?.className === "string" ? el.className.trim() : "";
      return `${what} on ${el ? el.tagName.toLowerCase() : "?"}${
        el?.id ? `#${el.id}` : ""
      }${cls ? `.${cls.split(/\s+/)[0]}` : ""}`;
    };
    const deadline = performance.now() + budget;
    for (;;) {
      const now = moving();
      if (now.length === 0) return [];
      const left = deadline - performance.now();
      if (left <= 0) return now.map(name);
      // `allSettled`: скасований перехід відхиляє `finished`, і це не
      // помилка — він просто більше не рухається.
      await Promise.race([
        Promise.allSettled(now.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, left)),
      ]);
    }
  }, budgetMs);

  if (unsettled.length > 0) {
    throw new Error(
      `axeViolations: сторінка не осіла за ${budgetMs} мс — ще рухається: ` +
        unsettled.join(", "),
    );
  }
}

export async function axeViolations(
  page: Page,
  opts: { tags?: readonly string[]; include?: string } = {},
): Promise<string[]> {
  // Спершу осісти, потім міряти — див. `settle`.
  await settle(page);

  let builder = new AxeBuilder({ page }).withTags([
    ...assertWcagTags(opts.tags ?? WCAG_TAGS),
  ]);
  // `include` звужує огляд до одного вузла — так робить перевірка шару
  // посухи, де решта мапи не її предмет.
  if (opts.include) builder = builder.include(opts.include);
  const result = await builder.analyze();

  return describeViolations(result.violations);
}

/**
 * Порушення → рядок, який називає ПРАВИЛО і ВУЗОЛ.
 *
 * Винесено окремо навмисно: це єдина частина, заради якої все
 * робилось, і єдина, яку можна перевірити без браузера. Сторож на неї
 * лежить у `tests/unit/axe-message.spec.ts`.
 */
export function describeViolations(
  violations: ReadonlyArray<{
    id: string;
    help: string;
    nodes: ReadonlyArray<{ target: unknown[] }>;
  }>,
): string[] {
  return violations.map(
    (v) =>
      `${v.id}: ${v.help} — ${v.nodes
        .map((n) => n.target.map(String).join(" "))
        .join(", ")}`,
  );
}
