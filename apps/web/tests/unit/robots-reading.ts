import type { MetadataRoute } from "next";

import { robotsFor } from "@/lib/robots-rules";

/**
 * Читання robots.txt так, як його читає робот, а не так, як нам зручно.
 *
 * 🔴 Чому це окремий файл, а не каст у тесті.
 *
 * Поле `rules` у Next буває І об'єктом, І масивом об'єктів. Доки правило
 * було одне, тести писали `robotsFor(true).rules as { disallow: string[] }`
 * і читали його напряму. 03.11.2026 правил стало дев'ять (CAMP-431: ШІ-
 * кравлери названі поіменно) — каст почав давати `undefined`, і два тести
 * впали з `TypeError`. Впали голосно, і це пощастило: якби вони читали
 * `rules[0]`, вони б мовчки проходили, а Disallow, дописаний у блок для
 * GPTBot, був би для них невидимий.
 *
 * Тому тут читаються ВСІ блоки. Шлях вважається закритим, якщо його
 * закриває хоч один із них — рівно так вирішує робот, який знайшов свій
 * блок і далі не дивиться.
 */
type RuleGroup = Exclude<MetadataRoute.Robots["rules"], unknown[]>;

function groups(open: boolean): RuleGroup[] {
  const rules = robotsFor(open).rules;
  return Array.isArray(rules) ? rules : [rules];
}

/** Усі User-agent, названі в robots.txt поіменно (без `*`). */
export function agentsNamed(open: boolean): string[] {
  return groups(open)
    .flatMap((g) => [g?.userAgent ?? []].flat())
    .filter((a) => a !== "*");
}

/** Чи закриває robots.txt цей шлях — для БУДЬ-ЯКОГО з названих агентів. */
export function blockedByRobots(open: boolean, path: string): boolean {
  return groups(open).some((g) =>
    [g?.disallow ?? []].flat().some((d) => d !== "" && path.startsWith(d)),
  );
}
