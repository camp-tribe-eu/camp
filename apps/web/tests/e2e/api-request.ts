import { writeFile } from 'node:fs/promises';
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
/**
 * 🔴 КОДИ ЗАМІРЯНО, А НЕ ВЗЯТО ЗІ СТЕЛІ.
 *
 * Перша редакція ловила 418, 423 і 425. Рецензія #314 прогнала кожен
 * через справжній конвеєр Next (15.5.27 несе React 19.3, прод-збірка):
 *
 *   418 → 3 вкладення
 *   423 → 0        422 → 0        425 → такого коду в React 19 немає
 *
 * Причина: 425 згорнуто в 418 аргументом `?"text":"HTML"`, а 422 і 423
 * React будує як `Error(msg, { cause: value })` — і Next звітує саме
 * `error.cause` (`react-client-callbacks/on-recoverable-error.js`), тож
 * рядок «#423» на сторінку не потрапляє ніколи. Тобто дві третини мого
 * переліку були декорацією.
 *
 * 424 додано: це відмова гідратувати корінь
 * (`mountHostRootWithoutHydrating`), вона виходить із кодом неушкодженим
 * і раніше пролітала повз.
 */
const HYDRATION_ERROR = /Minified React error #(418|424)\b|Hydration failed/;

/**
 * Зняти обидва боки розбіжності: DOM після гідратації і HTML, який
 * віддав сервер.
 *
 * 🔴 ДОКАЗ ПРИВʼЯЗАНИЙ ДО АДРЕСИ, НА ЯКІЙ СТАЛАСЯ ПОМИЛКА. Рецензія
 * заміряла: мʼякий перехід (саме те, що робить `next/link` — pushState
 * і заміна DOM) між помилкою і знімком давав DOM ЗОВСІМ ІНШОГО
 * маршруту при тому самому URL у заголовку. Тест зелений, три
 * вкладення, і різниця виглядає як тотальна розбіжність, якої не було.
 * Доказ, що бреше, гірший за відсутній.
 *
 * 🔴 І ПОРОЖНІЙ CATCH БІЛЬШЕ НЕ ВІДДАЄ ДОКАЗ, ЯКОГО НЕМАЄ. Було: при
 * закритій сторінці вкладення лежали, а всередині — рядок «не вдалось
 * зняти DOM». Виглядало як зібраний доказ. Тепер невдача не стає
 * файлом: вона йде в примітку, яку видно у звіті.
 *
 * 🔴 І ФАЙЛАМИ, А НЕ ТІЛОМ. `attach({ body })` інлайнить base64 у
 * `report.json` — 110 КБ сирих стають ~147 КБ, помножених на чотири
 * браузерні проєкти, а `check-flaky.mjs` робить `JSON.parse` усього
 * файла. `attach({ path })` кладе поруч і лишає звіт легким.
 */
async function captureHydrationEvidence(
  page: Page,
  message: string,
  urlAtError: string,
  testInfo: { outputPath: (n: string) => string; attach: AttachFn },
): Promise<void> {
  const note: string[] = [message, '', `URL на момент помилки: ${urlAtError}`];

  const urlNow = page.url();
  if (urlNow !== urlAtError) {
    note.push(
      `🔴 ДОКАЗ НЕ ЗНЯТО: сторінка вже на ${urlNow}.`,
      'Знімок DOM належав би іншому маршруту, і різниця виглядала б як',
      'тотальна розбіжність, якої не було.',
    );
    await writeNote(testInfo, note);
    return;
  }

  let dom: string | null = null;
  try {
    dom = await page.evaluate(() => document.documentElement.outerHTML);
  } catch (e) {
    note.push(`🔴 DOM не знято: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Ще раз: `evaluate` чекається, і за цей час сторінка могла поїхати.
  if (dom !== null && page.url() !== urlAtError) {
    note.push(`🔴 DOM відкинуто: за час знімання сторінка пішла на ${page.url()}.`);
    dom = null;
  }

  let before: string | null = null;
  try {
    before = (await page.evaluate(
      () =>
        (window as unknown as Record<string, unknown>).__campPreHydration ??
        null,
    )) as string | null;
    if (before === null) note.push('🔴 знімка ДО гідратації немає (сторінка не дійшла до DOMContentLoaded?)');
  } catch (e) {
    note.push(`🔴 знімок ДО гідратації не знято: ${e instanceof Error ? e.message : String(e)}`);
  }

  let served: string | null = null;
  try {
    served = await (await page.context().request.get(urlAtError)).text();
  } catch (e) {
    note.push(
      `🔴 серверний HTML не знято: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  await writeNote(testInfo, note);
  if (before !== null) {
    await attachFile(testInfo, 'hydration-dom-before.html', before);
  }
  if (dom !== null) await attachFile(testInfo, 'hydration-dom-after.html', dom);
  if (served !== null) {
    await attachFile(testInfo, 'hydration-served.html', served);
  }
}

type AttachFn = (
  name: string,
  opts: { path?: string; body?: string; contentType: string },
) => Promise<void>;

async function attachFile(
  testInfo: { outputPath: (n: string) => string; attach: AttachFn },
  name: string,
  body: string,
): Promise<void> {
  const file = testInfo.outputPath(name);
  await writeFile(file, body, 'utf8');
  await testInfo.attach(name, { path: file, contentType: 'text/html' });
}

async function writeNote(
  testInfo: { outputPath: (n: string) => string; attach: AttachFn },
  lines: string[],
): Promise<void> {
  await testInfo.attach('hydration-error.txt', {
    body: lines.join('\n') + '\n',
    contentType: 'text/plain',
  });
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
    // 🔴 ЗНІМОК ДО ГІДРАТАЦІЇ, бо знімок ПІСЛЯ запізнюється.
    //
    // Заміряно на справжньому спрацюванні в CI: у `dom-after` лишались
    // тільки законні зміни — банер згоди, перевірка сесії, заповнення
    // пошуку. React до того моменту вже перебудував дерево, і сама
    // розбіжність зникла з кадру.
    //
    // Цей скрипт виконується ДО будь-якого коду сторінки й знімає
    // розмітку такою, якою її розібрав БРАУЗЕР, ще до того, як React
    // до неї торкнувся. Саме порівняння «сервер → браузер» показало
    // попередню причину: `<style>` усередині `<noscript>` ставав
    // текстовим вузлом.
    await page.addInitScript(() => {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          try {
            (window as unknown as Record<string, unknown>).__campPreHydration =
              document.documentElement.outerHTML;
          } catch {
            /* знімок — не привід валити сторінку */
          }
        },
        { once: true },
      );
    });

    // 🔴 ОБІЦЯНКУ ТРЕБА ДОЧЕКАТИСЬ, І ЦЕ НЕ ДРІБНИЦЯ. Перша редакція
    // запускала знімання через `void` — тобто воно гналось наввипередки
    // з завершенням тесту й не встигало ніколи. Заміряно: два випадки
    // пройшли зелено, артефактів нуль. Свідок, який не встигає, це
    // відсутній свідок.
    let pending: Promise<void> | null = null;
    const onError = (message: string) => {
      if (pending || !HYDRATION_ERROR.test(message)) return;
      // один доказ на тест: другий був би тією ж сторінкою
      pending = captureHydrationEvidence(page, message, page.url(), testInfo);
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
