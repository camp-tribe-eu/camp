import { expect, test } from "@playwright/test";

import { robotsFor } from "@/lib/robots-rules";
import { agentsNamed, blockedByRobots } from "./robots-reading";

// 🔴 CAMP-422. ЩО САМЕ ТУТ СТЕРЕЖЕТЬСЯ — І ЧОМУ ЦЕ НЕ КОСМЕТИКА.
//
// Відповідні машини (ChatGPT, Perplexity, Claude, Gemini) цитують те, що
// має джерело й дату. Наш провенанс кожного факту — рівно те, за що вони
// винагороджують, і це найдешевший канал проти конкурента, більшого в
// рази. До 03.11.2026 жоден із цих обхідників не був названий у
// robots.txt: вони проходили за `*`, тобто за замовчуванням, а не за
// рішенням. Різниця в тому, що замовчування стирають одним рядком і не
// помічають.
//
// Тому тест перевіряє ДВІ різні речі, і кожна падає окремо:
//   1. агента названо поіменно — стерти його з переліку стає видно;
//   2. названому агенту не закрито сайт — дописати йому Disallow стає
//      видно теж. Без другого перелік імен був би ярликом: вісім блоків
//      із `Disallow: /` виглядали б у цьому тесті так само добре.

/** Обхідники, присутність яких тут — рішення, а не випадковість. */
const WANTED = [
  "GPTBot", // ChatGPT — навчання і цитування
  "OAI-SearchBot", // ChatGPT Search — показ у видачі асистента
  "ChatGPT-User", // перехід за посиланням на запит людини
  "PerplexityBot",
  "ClaudeBot",
  "Google-Extended", // Gemini й огляди ШІ; на звичайну видачу НЕ впливає
  "Applebot-Extended",
  "CCBot", // Common Crawl — корпус, з якого вчаться всі інші
];

test.describe("robots.txt: ШІ-обхідники пущені рішенням, а не замовчуванням", () => {
  test("🔴 кожного названо поіменно у відкритій збірці", () => {
    const named = agentsNamed(true);
    // Щоб порожнє читання не пройшло за «усі на місці».
    expect(named.length).toBeGreaterThanOrEqual(WANTED.length);
    for (const agent of WANTED) expect(named, agent).toContain(agent);
  });

  test("🔴 жодному з них не закрито те, заради чого його пустили", () => {
    const rules = robotsFor(true).rules;
    expect(Array.isArray(rules)).toBe(true);
    const groups = (Array.isArray(rules) ? rules : [rules]).filter((g) =>
      WANTED.includes(String(g?.userAgent)),
    );
    expect(groups.length).toBe(WANTED.length);
    for (const g of groups) {
      const disallow = [g?.disallow ?? []].flat();
      expect([g?.allow ?? []].flat(), String(g?.userAgent)).toContain("/");
      // Закрити можна рівно те саме, що й усім: особисті поїздки і API.
      expect(disallow.sort(), String(g?.userAgent)).toEqual([
        "/api/",
        "/trips/",
      ]);
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
  });

  test("🔴 закрита збірка не пускає нікого — і ШІ теж", () => {
    expect(agentsNamed(false)).toEqual([]);
    for (const path of ["/camping/fr", "/camper-rental/providers", "/"]) {
      expect(blockedByRobots(false, path), path).toBe(true);
    }
  });
});
