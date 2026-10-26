import type { APIRequestContext, Page, TestInfo } from "@playwright/test";

// CAMP-383 — зловити гідратаційне розходження за доказом, а не за кодом помилки.
//
// 🔴 Чому не «відтворити й подивитись»: 120 завантажень (60 у dev, 60 на проді
// у трьох браузерах) дали НУЛЬ влучань. Дефект виходить лише в CI під
// паралельним навантаженням. Ганятися за ним відтворенням — марно; треба, щоб
// наступне спрацювання саме принесло докази у артефакт збірки.
//
// Що саме кажуть коди: 418 — «server rendered %s didn't match the client», і в
// нашому влучанні args[]=HTML, тобто розходиться ЕЛЕМЕНТ, а не текст (текст — це
// 425). Тому доказом є розмітка з обох боків, а не повідомлення.
const HYDRATION =
  /Minified React error #(418|419|421|422|423|425)\b|Hydration failed|Text content does not match|did not match/i;

export function isHydration(message: string): boolean {
  return HYDRATION.test(message);
}

// 🔴 Знімок мусить лягти в ту саму мить, коли React поскаржився. Через секунду
// він уже перемалює піддерево з нуля, і `page.content()` покаже ВИПРАВЛЕНИЙ DOM,
// тобто другу половину рівняння замість розходження. Тому перехоплюємо
// console.error усередині сторінки і знімаємо outerHTML синхронно в обробнику.
export async function armHydrationTrap(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const re =
      /Minified React error #(418|419|421|422|423|425)\b|Hydration failed|Text content does not match|did not match/i;
    const original = console.error;
    console.error = function (...args: unknown[]) {
      try {
        const text = args
          .map((a) => (typeof a === "string" ? a : String(a)))
          .join(" ");
        const store = window as unknown as { __hydrationTrap?: unknown[] };
        if (re.test(text) && (store.__hydrationTrap ??= []).length < 3) {
          (store.__hydrationTrap as unknown[]).push({
            message: text,
            at: Date.now(),
            readyState: document.readyState,
            // Синхронно, у тому ж такті, що й скарга.
            dom: document.documentElement.outerHTML,
          });
        }
      } catch {
        // Пастка не має права повалити сторінку, яку вона спостерігає.
      }
      return original.apply(console, args as []);
    };
  });
}

// Скрипти — це RSC-пейлоад, а не розмітка; у ньому розходжень не буває, зате
// він на порядок більший за саму сторінку і ховає справжню різницю.
// 🔴 Заміряно 26.10 на /camping/*: увесь файл 34 399 байтів, без <script> —
// 1 302. Саме через цей шум я одного разу «знайшов» 404 там, де його не було.
export function stripScripts(html: string): string {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, "<script/>");
}

function firstDivergence(
  a: string,
  b: string,
  labelA: string,
  labelB: string,
): string {
  if (a === b)
    return `${labelA} і ${labelB}: збігаються байт у байт (${a.length} Б).`;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const from = Math.max(0, i - 200);
  return [
    `${labelA}: ${a.length} Б, ${labelB}: ${b.length} Б. Перша відмінність на позиції ${i}.`,
    `── спільний хвіст до розходження ──`,
    a.slice(from, i),
    `── ${labelA} далі ──`,
    a.slice(i, i + 400),
    `── ${labelB} далі ──`,
    b.slice(i, i + 400),
  ].join("\n");
}

/**
 * Складає в артефакт усе, що потрібно, щоб назвати причину, не відтворюючи баг.
 * Викликати лише коли консоль уже червона — інакше це 4 зайві файли на кожен тест.
 */
export async function attachHydrationEvidence(
  page: Page,
  request: APIRequestContext,
  path: string,
  testInfo: TestInfo,
): Promise<void> {
  const trapped = await page
    .evaluate(
      () =>
        (window as unknown as { __hydrationTrap?: unknown[] })
          .__hydrationTrap ?? [],
    )
    .catch(() => []);

  // 🔴 Два незалежні запити підряд. Якщо вони різні між собою — причина на
  // сервері, і далі шукати в браузері нема чого. Це єдина перевірка тут, яка
  // вміє вказати винного, а не лише показати наслідок.
  const first = stripScripts(await (await request.get(path)).text());
  const second = stripScripts(await (await request.get(path)).text());
  const serverStable = first === second;

  const live = trapped.length
    ? stripScripts(String((trapped[0] as { dom?: string }).dom ?? ""))
    : stripScripts(await page.content());

  await testInfo.attach(`hydration-${path.replace(/\W+/g, "_")}-висновок.txt`, {
    contentType: "text/plain; charset=utf-8",
    body: [
      `Сторінка: ${path}`,
      `Браузер: ${testInfo.project.name}`,
      `Перехоплено скарг у момент помилки: ${trapped.length}`,
      ...trapped.map((t, n) => {
        const e = t as { message: string; readyState: string };
        return `  [${n}] readyState=${e.readyState} :: ${e.message.slice(0, 300)}`;
      }),
      "",
      `Сервер віддає двічі однакове: ${serverStable ? "ТАК" : "🔴 НІ — причина на сервері"}`,
      serverStable ? "" : firstDivergence(first, second, "запит 1", "запит 2"),
      "",
      `── сервер проти браузера ──`,
      firstDivergence(first, live, "сервер", "браузер"),
      "",
      trapped.length
        ? "DOM знято синхронно в обробнику console.error, до того як React перемалював піддерево."
        : "🔴 Пастка порожня: скарга не пройшла через console.error сторінки (могла прийти з pageerror або з іншого кадру). DOM нижче — ВЖЕ виправлений React-ом.",
    ].join("\n"),
  });

  await testInfo.attach(`hydration-${path.replace(/\W+/g, "_")}-сервер.html`, {
    contentType: "text/html; charset=utf-8",
    body: first,
  });
  await testInfo.attach(`hydration-${path.replace(/\W+/g, "_")}-браузер.html`, {
    contentType: "text/html; charset=utf-8",
    body: live,
  });
}
