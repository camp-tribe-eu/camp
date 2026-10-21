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
 */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] as const;

export async function axeViolations(
  page: Page,
  opts: { tags?: readonly string[]; include?: string } = {},
): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags([...(opts.tags ?? WCAG)]);
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
