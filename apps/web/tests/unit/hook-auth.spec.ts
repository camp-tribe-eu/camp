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
    process.env.REVALIDATE_SECRET = "right-secret";
    expect(authorizeHook(req("wrong-secret"))?.status).toBe(401);
    if (before === undefined) delete process.env.REVALIDATE_SECRET;
    else process.env.REVALIDATE_SECRET = before;
  });

  test("заголовка немає зовсім — теж 401, а не прохід", () => {
    const before = process.env.REVALIDATE_SECRET;
    process.env.REVALIDATE_SECRET = "right-secret";
    expect(authorizeHook(req())?.status).toBe(401);
    if (before === undefined) delete process.env.REVALIDATE_SECRET;
    else process.env.REVALIDATE_SECRET = before;
  });

  test("свій секрет — `null`, тобто пускаємо", () => {
    const before = process.env.REVALIDATE_SECRET;
    process.env.REVALIDATE_SECRET = "right-secret";
    expect(authorizeHook(req("right-secret"))).toBeNull();
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
});
