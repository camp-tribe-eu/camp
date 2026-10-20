import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// CAMP-365 / CAMP-363 — ендпоінт скидання кешу за міткою.
//
// 🔴 ЧОМУ ВІН ВЗАГАЛІ ПОТРЕБУЄ СТОРОЖА. Виклик без секрету, який усе ж
// скидає кеш, — це спосіб змусити сайт перемальовувати сторінки на
// вимогу будь-кого. Дефект тихий: відповідь 200 виглядає як успіх.

test.describe("🔴 CAMP-365 — скидання кешу меню", () => {
  test("без секрету не скидає НІКОЛИ, і каже, чого бракує", async ({
    request,
  }) => {
    const res = await request.post("/api/revalidate?tag=navigation", {
      failOnStatusCode: false,
    });

    // 🔴 ГОЛОВНЕ ТВЕРДЖЕННЯ — НЕГАТИВНЕ, ТОЖ ПОРУЧ СТОЇТЬ ПОЗИТИВНЕ.
    // «Не 200» істинне й тоді, коли маршруту немає зовсім, а це була б
    // інша поломка з тим самим виглядом. Тому перевіряємо ще й те, що
    // відповідь прийшла саме від нашого обробника.
    expect(res.status(), "виклик без секрету скинув кеш").not.toBe(200);
    expect([401, 503], `несподіваний код ${res.status()}`).toContain(
      res.status(),
    );

    const body = (await res.json()) as { error?: string };
    expect(body.error, "обробник не назвав причину").toBeTruthy();
    if (res.status() === 503) {
      expect(body.error).toContain("REVALIDATE_SECRET");
    }
  });

  test("невідому мітку не приймає", async ({ request }) => {
    const res = await request.post("/api/revalidate?tag=everything", {
      failOnStatusCode: false,
    });
    expect(res.status(), "довільна мітка пройшла").not.toBe(200);
  });

  // 🔴 ПЕРЕВІРКА ПОРЯДКУ, А НЕ ЛИШЕ ВІДПОВІДІ.
  //
  // Обидва твердження вище зелені й тоді, коли обробник спершу скидає
  // кеш, а вже потім віддає 401: побічна дія сталась, а код відповіді
  // про це не каже. Тож читаємо джерело й вимагаємо, щоб `revalidateTag`
  // стояв ПІСЛЯ обох перевірок.
  test("🔴 revalidateTag кличеться лише після перевірки секрету", () => {
    const src = readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "src",
        "app",
        "api",
        "revalidate",
        "route.ts",
      ),
      "utf8",
    );
    const call = src.indexOf("revalidateTag(tag)");
    const secret = src.indexOf("sameSecret(given, expected)");
    const allowed = src.indexOf("ALLOWED.get(name)");

    expect(call, "виклику revalidateTag немає").toBeGreaterThan(-1);
    expect(secret, "перевірки секрету немає").toBeGreaterThan(-1);
    expect(call, "revalidateTag стоїть ДО перевірки секрету").toBeGreaterThan(
      secret,
    );
    expect(call, "revalidateTag стоїть ДО перевірки мітки").toBeGreaterThan(
      allowed,
    );
  });
});
