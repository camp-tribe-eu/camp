import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://camptribe.eu";

// CAMP-90. Two different files depending on the mode, because a closed
// environment and a live one need opposite things.

/**
 * The same answer with the mode passed in, so a test can ask BOTH modes from
 * one process.
 *
 * 🔴 WHY THIS IS NOT IN `app/robots.ts`. `isPublic` is a constant read from
 * the environment when the module loads, so every CI run that reads the file
 * can only ever see the closed branch — and the public one, the one that will
 * ship, would otherwise be checked by reading its source text. And a Next
 * metadata route file does not tolerate extra exports (the route-handler rule
 * `route.ts` has, which `tsc` does not report until `.next/types` exists), so
 * the function lives here and `app/robots.ts` only passes the mode.
 * (CAMP-228: the account pages must not appear in the public `disallow`.)
 */
export function robotsFor(open: boolean): MetadataRoute.Robots {
  if (!open) {
    // 🔴 No `sitemap:` line here. Advertising a list of pages we are
    // simultaneously asking nobody to crawl is a contradiction, and
    // Google resolves contradictions however it likes.
    //
    // Note this is belt to the `X-Robots-Tag` braces, not a replacement:
    // a full Disallow stops the crawl, which means the crawler never
    // reads the `noindex` on the page itself. A URL blocked in
    // robots.txt but linked from elsewhere can still appear in results
    // as a bare link. The header is what actually keeps it out, and it
    // is served on every response including files.
    return {
      rules: { userAgent: "*", disallow: "/" },
    };
  }

  // 🔴 ШІ-КРАВЛЕРИ: УСІМ ДОЗВОЛЕНО, КОЖЕН НАЗВАНИЙ ПОІМЕННО.
  //
  // Рішення власника 12.11.2026 (CAMP-509), остаточне: «щоб усі пошукові
  // роботи, агенти й ШІ-помічники знали наш сайт і посилалися на нього».
  // Спершу того ж дня було обрано «навчальних закрити» — скасовано:
  // robots.txt нічого не ховає, усе на сторінках і так публічне, а секрет
  // бізнесу живе в API, не в тексті сторінок. Видимість важливіша.
  // Явний блок на кожного лишається навмисно: замовчування `*` стирають
  // одним рядком непомітно, а явний блок видно в diff (CAMP-431).
  //
  // Імена й призначення прочитано з офіційних сторінок вендорів 12.11.2026
  // (curl). Вендор сам каже, що налаштування незалежні одне від одного.
  //
  // Пошукові / за запитом людини:
  const aiSearchCrawlers = [
    // OpenAI: «surface websites in search results in ChatGPT's search
    // features»; закритий сайт не потрапляє у відповіді ChatGPT Search.
    // https://platform.openai.com/docs/bots (12.11.2026)
    "OAI-SearchBot",
    // OpenAI: відвідини за дією користувача в ChatGPT / Custom GPT.
    // https://platform.openai.com/docs/bots (12.11.2026)
    "ChatGPT-User",
    // Anthropic: «improve search result quality for users».
    // https://support.claude.com/en/articles/8896518 (12.11.2026)
    "Claude-SearchBot",
    // Anthropic: людина питає Claude, і той відкриває сайт.
    // https://support.claude.com/en/articles/8896518 (12.11.2026)
    "Claude-User",
    // Perplexity: «surface and link websites in search results»; сам
    // вендор пише, що для навчання фундаментальних моделей він НЕ
    // використовується. https://docs.perplexity.ai/guides/bots (12.11.2026)
    "PerplexityBot",
    // Perplexity: дія користувача в Perplexity.
    // https://docs.perplexity.ai/guides/bots (12.11.2026)
    "Perplexity-User",
  ];

  // Навчальні — теж дозволені (рішення власника 12.11.2026: видимість
  // важливіша, секрет — в API):
  const aiTrainingCrawlers = [
    // OpenAI: «crawl content that may be used in training our generative
    // AI foundation models»; Disallow = не для навчання.
    // https://platform.openai.com/docs/bots (12.11.2026)
    "GPTBot",
    // Anthropic: збір вмісту, що «could potentially contribute to their
    // training». https://support.claude.com/en/articles/8896518 (12.11.2026)
    "ClaudeBot",
    // Google: токен керує тим, чи може вміст іти на навчання Gemini та
    // grounding. На звичайну видачу Google Search НЕ впливає (Googlebot).
    // https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers (12.11.2026)
    "Google-Extended",
    // Apple: «opt-out from having their content used to train generative
    // foundation models». https://support.apple.com/en-us/119829 (12.11.2026)
    "Applebot-Extended",
    // Common Crawl: відкритий корпус, з якого вчаться інші; сам вендор
    // публікує `User-agent: CCBot / Disallow: /` як спосіб відмови.
    // https://commoncrawl.org/ccbot (12.11.2026)
    "CCBot",
  ];

  /**
   * 🔴 ОДИН ПЕРЕЛІК НА ОБИДВА ПРАВИЛА, А НЕ ДВА ОДНАКОВІ.
   *
   * Він стояв двічі — для `*` і для ШІ-кравлерів. Поки шляхів було два,
   * це читалось; варто додати третій, і найімовірніша помилка — додати
   * його в одне місце з двох, тобто закрити шлях від Google і лишити
   * відкритим для ChatGPT. Тепер розійтись неможливо за побудовою.
   *
   * - `/trips/` — планування рейсу: воно залогінене й персональне,
   *   рангувати там нічого, а обхід їв би бюджет замість каталогу.
   * - `/api/` — машинний інтерфейс, не сторінки.
   * - `/internal/` — наші службові адреси: гачок перебудови, штамп
   *   вмісту і вітрина секцій (CAMP-449). Жодна з них не для читача.
   *   🔴 Це ДРУГИЙ замок, а не єдиний: заборона тут зупиняє обхід, тож
   *   `noindex` на самій сторінці кравлер уже не прочитає. Тому вітрина
   *   несе `robots: { index: false }` і сама.
   */
  const CLOSED = ["/trips/", "/api/", "/internal/"];

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: CLOSED,
      },
      ...[...aiSearchCrawlers, ...aiTrainingCrawlers].map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: CLOSED,
      })),
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
