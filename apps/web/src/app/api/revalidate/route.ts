import { revalidateTag } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { NAV_TAG } from "@/lib/navigation";
import { PAGE_TAG } from "@/lib/page-content";

// CAMP-365 / CAMP-363 — скидання кешу за міткою, щоб правка в CMS
// з'являлась за секунди, а не за добу.
//
// 🔴 ЧОМУ ЦЕ ПОТРІБНО, А НЕ «ПРОСТО ПОСТАВИТИ ВИТРИМКУ МЕНШЕ».
//
// Запит за меню живе в КОРЕНЕВОМУ макеті, а Next бере мінімум витримки
// по всьому дереву маршруту. Тобто коротка витримка заради меню
// опускала б її всьому сайту — див. `lib/navigation.ts`, там заміряно.
// Мітка цієї ціни не має: вона нічого не опускає, її скидає цей виклик.

/**
 * Що дозволено скидати. Довільну мітку приймати не можна.
 *
 * 🔴 `pages` ДОДАНО, БО БЕЗ НЕЇ КОМЕНТАР ВИЩЕ БУВ НЕПРАВДОЮ.
 *
 * Заміряно рецензією #308: `POST /api/revalidate?tag=pages` віддавав
 * `400 {"allowed":["navigation"]}`, і жоден виклик у репозиторії цю
 * мітку не згадував. Тобто ВЕСЬ текст CMS — сторінки, правові
 * документи, дописи блогу — оновлювався виключно витримкою 86 400 с,
 * тоді як сусідній файл `lib/posts.ts` стверджував «одна мітка — один
 * вебхук, який не можна налаштувати наполовину».
 *
 * Мітка існувала, і скинути її не міг ніхто.
 */
const ALLOWED = new Map([
  ["navigation", NAV_TAG],
  ["pages", PAGE_TAG],
]);

/**
 * 🔴 ПОРІВНЯННЯ СТАЛОГО ЧАСУ, І ДОВЖИНУ ТЕЖ ТРЕБА ХОВАТИ.
 *
 * `timingSafeEqual` кидає, коли довжини різні, — тобто сам по собі він
 * розкриває довжину секрету через виняток. Тому спершу зводимо обидва
 * боки до одного розміру.
 */
function sameSecret(given: string, expected: string): boolean {
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

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.REVALIDATE_SECRET;

  // 🔴 ПАДАЄ В ЗАКРИТИЙ БІК, І ГУЧНО.
  //
  // Якби відсутній секрет означав «пускати всіх», ендпоінт був би
  // відчинений рівно на тому середовищі, де про нього забули, — і
  // мовчки. Порожня змінна оточення це не «вимкнено», це недогляд, і
  // поводитись із нею треба як із недоглядом.
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

  const name = new URL(request.url).searchParams.get("tag") ?? "";
  const tag = ALLOWED.get(name);
  if (!tag) {
    return Response.json(
      {
        error: `мітка «${name}» не дозволена`,
        allowed: [...ALLOWED.keys()],
      },
      { status: 400 },
    );
  }

  revalidateTag(tag);
  return Response.json({ revalidated: tag });
}
