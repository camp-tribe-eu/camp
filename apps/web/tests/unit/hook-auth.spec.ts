import { expect, test } from "@playwright/test";
import { authorizeHook, sameSecret } from "@/lib/hook-auth";

// CAMP-363 — ворота гачка: єдине місце, яке вирішує «пускати чи ні».
//
// 🔴 ЧОМУ ЦЕ ВЗАГАЛІ ПОТРІБНО НАКРИВАТИ ОКРЕМО. Перевірка секрету
// переїхала з `route.ts` у бібліотеку, бо гачків стало два. Переїзд, за
// яким не стоїть тест, — це рівно та правка, після якої ворота тихо
// перестають зачинятись: обидва маршрути й далі «працюють», просто
// пускають усіх.
//
// 🔴 І ЧОМУ ЮНІТ, А НЕ E2E. Та сама причина, що в `revalidate-tags`: у
// CI змінної `REVALIDATE_SECRET` немає, тож по HTTP звідти видно ЛИШЕ
// 503. Ні 401, ні успішний прохід у CI по HTTP не спостерігаються
// ніколи.

// 🔴 ЗНАЧЕННЯ ТУТ ЛИШЕ ASCII, І ЦЕ НЕ СМАК. Значення HTTP-заголовка —
// ByteString: `new Request` кидає `Cannot convert argument to a ByteString`
// на першій же кириличній літері. Заміряно 26.10.2026, коли я написав ці
// випадки українською і дістав три падіння замість трьох перевірок.
// Звідси й вимога до самого секрету: він мусить бути ASCII, інакше
// Directus не зможе його навіть надіслати.
// Довші за поріг MIN_SECRET_LENGTH (24): інакше ворота справедливо
// скажуть «не налаштовано», і тест перевірятиме не те, що думає.
const RIGHT = "right-secret-0123456789abcdef";
const WRONG = "wrong-secret-0123456789abcdef";

const req = (secret?: string) =>
  new Request("https://example.test/internal/revalidate?tag=navigation", {
    method: "POST",
    headers: secret === undefined ? {} : { "x-revalidate-secret": secret },
  });

test.describe("ворота гачка", () => {
  test("секрета немає на машині — 503, і сказано, що це недогляд, а не заборона", async () => {
    const before = process.env.REVALIDATE_SECRET;
    delete process.env.REVALIDATE_SECRET;
    const res = authorizeHook(req("anything"));
    expect(res?.status).toBe(503);
    expect(JSON.stringify(await res!.json())).toContain("REVALIDATE_SECRET");
    if (before !== undefined) process.env.REVALIDATE_SECRET = before;
  });

  test("чужий секрет — 401", () => {
    const before = process.env.REVALIDATE_SECRET;
    process.env.REVALIDATE_SECRET = RIGHT;
    expect(authorizeHook(req(WRONG))?.status).toBe(401);
    if (before === undefined) delete process.env.REVALIDATE_SECRET;
    else process.env.REVALIDATE_SECRET = before;
  });

  test("заголовка немає зовсім — теж 401, а не прохід", () => {
    const before = process.env.REVALIDATE_SECRET;
    process.env.REVALIDATE_SECRET = RIGHT;
    expect(authorizeHook(req())?.status).toBe(401);
    if (before === undefined) delete process.env.REVALIDATE_SECRET;
    else process.env.REVALIDATE_SECRET = before;
  });

  test("свій секрет — `null`, тобто пускаємо", () => {
    const before = process.env.REVALIDATE_SECRET;
    process.env.REVALIDATE_SECRET = RIGHT;
    expect(authorizeHook(req(RIGHT))).toBeNull();
    if (before === undefined) delete process.env.REVALIDATE_SECRET;
    else process.env.REVALIDATE_SECRET = before;
  });

  // 🔴 РІЗНА ДОВЖИНА НЕ СМІЄ КИДАТИ. `timingSafeEqual` на буферах різного
  // розміру кидає виняток — тобто неперевірена гілка перетворила б 401 на
  // 500 і заразом розкрила б довжину секрету.
  test("інша довжина — `false`, а не виняток", () => {
    expect(() => sameSecret("ab", "a-much-longer-secret")).not.toThrow();
    expect(sameSecret("ab", "a-much-longer-secret")).toBe(false);
  });

  test("однакові рядки збігаються", () => {
    expect(sameSecret("same-secret", "same-secret")).toBe(true);
  });

  // 🔴 ЦІ ТРИ ВИПАДКИ ДОДАНО ПІСЛЯ РЕЦЕНЗІЇ #344, І ОСЬ ЧОМУ.
  //
  // Без них рядок, що тримає ворота, був накритий лише грубою мутацією
  // (`if (false)`). Заміряно: заміна `!expected` на `expected === undefined`
  // пережила всі шість тестів — і на такому коді порожній
  // `REVALIDATE_SECRET` разом із відсутнім заголовком ВІДЧИНЯВ ворота, бо
  // `timingSafeEqual(порожній, порожній)` повертає `true`.
  for (const [name, value] of [
    ["порожній рядок", ""],
    ["самі пробіли", "   "],
    ["закороткий, «тимчасовий»", "test123"],
    // 🔴 ДОВШИЙ ЗА ПОРІГ, АЛЕ З САМИХ ПРОБІЛІВ. Без цього випадку `.trim()`
    // у воротах не тримав нічого: його прибрання лишало всі тести
    // зеленими (заміряно). Поріг довжини ловить «   », бо воно коротке, —
    // а тридцять пробілів поріг пропускає.
    ["тридцять пробілів", "                              "],
  ] as const) {
    test(`${name} — це «не налаштовано», тобто 503, а не прохід`, () => {
      const before = process.env.REVALIDATE_SECRET;
      process.env.REVALIDATE_SECRET = value;
      // Саме БЕЗ заголовка: так виглядав прохід на мутованому коді.
      expect(authorizeHook(req())?.status).toBe(503);
      expect(authorizeHook(req(value))?.status).toBe(503);
      if (before === undefined) delete process.env.REVALIDATE_SECRET;
      else process.env.REVALIDATE_SECRET = before;
    });
  }
});
