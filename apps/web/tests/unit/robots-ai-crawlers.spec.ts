import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

import { blockedByRobots, parseRobots, renderedRobots } from "./robots-reading";

// 🔴 CAMP-509 (рішення власника 12.11.2026, остаточне): ВСІ ШІ-боти —
// пошукові й навчальні — ДОЗВОЛЕНО. robots.txt нічого не ховає, секрет
// живе в API; видимість важливіша.
//
// Тест читає ВІДДАНИЙ текст robots.txt (серіалізатором самого Next) і
// вимагає ЯВНИЙ блок на кожного: замовчування `*` пускало б усіх — і мовчки.
// Перелік виписано тут окремо від коду навмисно.

const SEARCH = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
];
const TRAINING = [
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
];

test.describe("robots.txt: усіх ШІ-ботів пущено — явно, кожного окремо", () => {
  const rendered = parseRobots(renderedRobots(true));

  test("🔴 КОЖЕН названий бот має власний явний блок у відданому тексті", () => {
    // Щоб порожнє читання не пройшло за «усі на місці».
    expect(rendered.size).toBeGreaterThanOrEqual(SEARCH.length + TRAINING.length + 1);
    for (const agent of [...SEARCH, ...TRAINING]) {
      expect(rendered.has(agent), `немає блоку для ${agent}`).toBe(true);
    }
  });

  test("🔴 кожному: Allow / і закрито рівно те саме, що й `*`", () => {
    const star = rendered.get("*");
    expect(star, "блок `*` зник").toBeTruthy();
    expect(star!.disallow.length).toBeGreaterThan(0);
    for (const agent of [...SEARCH, ...TRAINING]) {
      const g = rendered.get(agent);
      expect(g, agent).toBeTruthy();
      expect(g!.allow, agent).toContain("/");
      expect(g!.disallow.slice().sort(), agent).toEqual(star!.disallow.slice().sort());
      expect(g!.disallow, agent).not.toContain("/");
      expect(blockedByRobots(true, "/camping/fr", agent), agent).toBe(false);
    }
  });

  test("кожен бот має рядок із джерелом у docs/robots-ai-sources.md", () => {
    const doc = readFileSync(
      join(__dirname, "..", "..", "..", "..", "docs", "robots-ai-sources.md"),
      "utf8",
    );
    for (const agent of [...SEARCH, ...TRAINING]) {
      expect(doc, agent).toMatch(new RegExp(`\\| ${agent} \\|.*https://`));
    }
  });

  test("🔴 правила для Googlebot і Bing не зачеплені: окремих блоків нема, діє `*`", () => {
    expect(rendered.has("Googlebot")).toBe(false);
    expect(rendered.has("Bingbot")).toBe(false);
    const star = rendered.get("*")!;
    expect(star.allow).toEqual(["/"]);
    expect(star.disallow.slice().sort()).toEqual(["/api/", "/internal/", "/trips/"]);
    for (const agent of ["Googlebot", "Bingbot"]) {
      expect(blockedByRobots(true, "/camping/fr", agent), agent).toBe(false);
      expect(blockedByRobots(true, "/trips/abc", agent), agent).toBe(true);
    }
  });

  test("відкритими лишаються саме ті розділи, що мають ранжуватись", () => {
    for (const path of [
      "/camping/fr",
      "/camper-rental/providers",
      "/routes",
      "/guides",
      "/llms.txt",
    ]) {
      expect(blockedByRobots(true, path), path).toBe(false);
    }
    // Щоб відсутність щось означала: правило, яке справді є, спрацьовує.
    expect(blockedByRobots(true, "/trips/abc")).toBe(true);
    expect(blockedByRobots(true, "/api/spots")).toBe(true);
    // Вітрина каталогу секцій (CAMP-449) — службова сторінка, не для обходу.
    expect(blockedByRobots(true, "/internal/sections")).toBe(true);
  });

  test("🔴 закрита збірка не пускає нікого — і ШІ теж", () => {
    const closed = parseRobots(renderedRobots(false));
    expect([...closed.keys()]).toEqual(["*"]);
    for (const path of ["/camping/fr", "/camper-rental/providers", "/"]) {
      expect(blockedByRobots(false, path), path).toBe(true);
    }
  });
});
