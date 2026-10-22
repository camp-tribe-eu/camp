import { test as base, type APIRequestContext, type Page } from '@playwright/test';

// CAMP-69 — the `request` fixture, carrying the build token.
//
// 🔴 Why this file exists instead of one line in playwright.config.ts.
//
// The obvious fix was `use.extraHTTPHeaders`, and it broke four tests in
// a way worth remembering: that setting applies to the BROWSER as well as
// to the test runner. A page then sends `x-build-token` on its
// cross-origin POST to /client-errors, which turns a simple request into
// a preflighted one — and our CORS allowlist is deliberately narrow
// (`Content-Type` only then; since CAMP-229 also `Authorization`, for the
// account page — see apps/api/src/cors.ts. `x-build-token` is still not
// allowed, which is the point of this file). The preflight was refused, the
// error reports never arrived, and the failure read as "the error
// reporter is broken" rather than "the test harness added a header".
//
// Widening CORS to fix a test harness would be the wrong trade, and
// main.ts says so in as many words: a wider allowance needs its own
// reasoning, not a borrowed one. So the token goes on the test runner's
// requests only, where it belongs — the browser never sends it, in tests
// or in production.
//
// ⚠️ The header goes on every request this context makes, which in this
// suite means our own site and our own API — both on localhost. It is
// not scoped per host, and it should not be pointed at a third party.

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';
const TOKEN = process.env.API_BUILD_TOKEN;

/**
 * A `request` that identifies itself to our API as an internal caller.
 *
 * Specs import `test` and `expect` from here instead of
 * `@playwright/test`; nothing else changes at the call sites.
 */
/**
 * CAMP-383 — ЗЛОВИТИ ГІДРАТАЦІЙНУ РОЗБІЖНІСТЬ ІЗ ДОКАЗАМИ.
 *
 * 🔴 ЧОМУ НЕ ВИПРАВЛЕННЯ, А ЗБІР ДОКАЗІВ.
 *
 * React #418 («server rendered HTML didn't match the client») спрацював
 * у CI щонайменше чотири рази за три прогони — на `/login`, `/plan` і
 * `/routes/tuscany-hill-towns`, завжди у firefox, завжди зеленіючи з
 * повтору. Відтворити локально не вдалось: 30 послідовних завантажень
 * пʼяти сторінок і 5 навантажених прогонів трьох наборів дали НУЛЬ
 * спрацювань.
 *
 * А мінімізована збірка React не називає вузла: вона друкує лише номер
 * і слово «HTML». Тобто без доказів із МІСЦЯ ПОДІЇ ми можемо тільки
 * вгадувати — а вгадане виправлення це спосіб сховати дефект, не
 * полагодити.
 *
 * Тому тут не лік, а свідок: щойно сторінка кидає #418, ми знімаємо
 * DOM ПІСЛЯ гідратації і HTML, який віддав сервер за тією самою
 * адресою, і кладемо обидва в артефакт прогону. Наступне спрацювання
 * назве вузол саме.
 *
 * 🔴 І воно нічого не глушить. Помилка лишається в консолі, тест і далі
 * червоніє — збір доказів стоїть ПОРУЧ із падінням, а не замість нього.
 */
const HYDRATION_ERROR = /Minified React error #(418|423|425)\b|Hydration failed/;

async function captureHydrationEvidence(
  page: Page,
  message: string,
  attach: (name: string, body: string) => Promise<void>,
): Promise<void> {
  const url = page.url();
  let dom = '(не вдалось зняти DOM)';
  try {
    dom = await page.evaluate(() => document.documentElement.outerHTML);
  } catch {
    /* сторінку могли вже закрити — тоді лишається серверний бік */
  }
  let served = '(не вдалось забрати серверний HTML)';
  try {
    const res = await page.context().request.get(url);
    served = await res.text();
  } catch {
    /* той самий випадок */
  }
  await attach('hydration-error.txt', `${message}\n\nURL: ${url}\n`);
  await attach('hydration-dom-after.html', dom);
  await attach('hydration-served.html', served);
}

export const test = base.extend<{ request: APIRequestContext }>({
  request: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({
      // 🔴 Carried over from the project config. Half this suite asks for
      // relative paths — `request.get('/legal/privacy')` — and a fresh
      // context without it turns every one of those into an invalid URL.
      baseURL,
      extraHTTPHeaders: TOKEN ? { 'x-build-token': TOKEN } : {},
    });
    await use(context);
    await context.dispose();
  },

  // Автофікстура: вішається на КОЖЕН тест, що бере `page`, без жодного
  // рядка в самих наборах.
  page: async ({ page }, use, testInfo) => {
    // 🔴 ОБІЦЯНКУ ТРЕБА ДОЧЕКАТИСЬ, І ЦЕ НЕ ДРІБНИЦЯ. Перша редакція
    // запускала знімання через `void` — тобто воно гналось наввипередки
    // з завершенням тесту й не встигало ніколи. Заміряно: два випадки
    // пройшли зелено, артефактів нуль. Свідок, який не встигає, це
    // відсутній свідок.
    let pending: Promise<void> | null = null;
    const onError = (message: string) => {
      if (pending || !HYDRATION_ERROR.test(message)) return;
      // один доказ на тест: другий був би тією ж сторінкою
      pending = captureHydrationEvidence(page, message, async (name, body) => {
        await testInfo.attach(name, { body, contentType: 'text/plain' });
      });
    };
    page.on('pageerror', (e) => onError(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') onError(m.text());
    });
    await use(page);
    // Тут сторінка ще жива: внутрішня фікстура закриє її ПІСЛЯ цього.
    if (pending) await pending;
  },
});

export { expect } from '@playwright/test';

// Re-exported so a spec needs one import line, not two. Anything else
// Playwright exports can be added here when a spec first needs it.
export type { APIRequestContext, Page, Locator } from '@playwright/test';

/** The API base, so specs stop each spelling their own default. */
export const API_BASE = API;
