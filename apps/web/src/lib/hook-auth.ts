import { timingSafeEqual } from "node:crypto";

// CAMP-363 — спільні ворота для гачків, якими керує CMS.
//
// 🔴 ЖИВЕ В БІБЛІОТЕЦІ, А НЕ В `route.ts`, І З ТІЄЇ Ж ПРИЧИНИ, ЩО Й
// `ALLOWED_TAGS`: файл маршруту Next звіряє експорти з власним переліком
// і валить збірку на зайвому. Юнітом це можна накрити лише звідси.
//
// 🔴 І ЩОБ НЕ БУЛО ДРУГОЇ КОПІЇ. Гачків стало два (`/internal/revalidate`
// і `/internal/content-stamp`), а перевірка секрету, написана двічі,
// розходиться мовчки — і розходиться саме та копія, якої ніхто не читає.

/**
 * 🔴 ПОРІВНЯННЯ СТАЛОГО ЧАСУ, І ДОВЖИНУ ТЕЖ ТРЕБА ХОВАТИ.
 *
 * `timingSafeEqual` кидає, коли довжини різні, — тобто сам по собі він
 * розкриває довжину секрету через виняток. Тому спершу зводимо обидва
 * боки до одного розміру.
 */
export function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Порівняння з самим собою, щоб витрата часу не залежала від того,
    // збіглася довжина чи ні.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Ворота гачка: `null` — пускаємо, інакше готова відповідь із відмовою.
 *
 * 🔴 ПАДАЄ В ЗАКРИТИЙ БІК, І ГУЧНО. Якби відсутній секрет означав
 * «пускати всіх», ендпоінт був би відчинений рівно на тому середовищі,
 * де про нього забули, — і мовчки. Порожня змінна оточення це не
 * «вимкнено», це недогляд, і поводитись із нею треба як із недоглядом.
 */
export function authorizeHook(request: Request): Response | null {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected) {
    return Response.json(
      {
        error:
          "REVALIDATE_SECRET не налаштовано — скидання кешу вимкнено. " +
          "Це не «заборонено», а «не налаштовано»: поки змінної немає, " +
          "меню оновлюється за витримкою (доба), а не за гачком.",
      },
      { status: 503 },
    );
  }
  const given = request.headers.get("x-revalidate-secret") ?? "";
  if (!sameSecret(given, expected)) {
    return Response.json({ error: "невірний секрет" }, { status: 401 });
  }
  return null;
}
