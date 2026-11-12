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

/**
 * Чи закриває robots.txt цей шлях для ОДНОГО агента.
 *
 * 🔴 CAMP-509: раніше тут питали «чи закриває хоч один блок». Відколи
 * навчальні боти закриті цілком (`Disallow: /`), така відповідь була б
 * завжди «так» для будь-якого шляху. Робот читає власний блок, а якщо його
 * немає — блок `*`; так і тут. Блоки пошукових ШІ-ботів звіряє з `*`
 * окремий тест у robots-ai-crawlers.spec.ts.
 */
export function blockedByRobots(
  open: boolean,
  path: string,
  agent = "*",
): boolean {
  const all = groups(open);
  const own = all.filter((g) => [g?.userAgent ?? []].flat().includes(agent));
  const used = own.length > 0 ? own : all.filter((g) => g?.userAgent === "*");
  return used.some((g) =>
    [g?.disallow ?? []].flat().some((d) => d !== "" && path.startsWith(d)),
  );
}

/**
 * robots.txt ТАК, ЯК ЙОГО ВІДДАЄ NEXT: тим самим серіалізатором, що відповідає
 * на `GET /robots.txt`, а не читанням нашої структури. Тест, що дивиться на
 * структуру, не помітив би, що поле не дійшло до тексту.
 */
export function renderedRobots(open: boolean): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolveRobots } = require(
    "next/dist/build/webpack/loaders/metadata/resolve-route-data",
  ) as { resolveRobots: (d: MetadataRoute.Robots) => string };
  return resolveRobots(robotsFor(open));
}

/** Відданий текст → `{агент: {allow[], disallow[]}}`, лише читання рядків. */
export function parseRobots(
  text: string,
): Map<string, { allow: string[]; disallow: string[] }> {
  const out = new Map<string, { allow: string[]; disallow: string[] }>();
  let current: string[] = [];
  let lastWasAgent = false;
  for (const raw of text.split("\n")) {
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(raw.trim());
    if (!m) {
      lastWasAgent = false;
      continue;
    }
    const key = m[1].toLowerCase();
    const val = m[2];
    if (key === "user-agent") {
      if (!lastWasAgent) current = [];
      current.push(val);
      if (!out.has(val)) out.set(val, { allow: [], disallow: [] });
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    for (const a of current) {
      if (key === "allow") out.get(a)!.allow.push(val);
      if (key === "disallow") out.get(a)!.disallow.push(val);
    }
  }
  return out;
}
