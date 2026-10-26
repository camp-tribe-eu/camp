import { createHash } from "node:crypto";
import { authorizeHook } from "@/lib/hook-auth";
import { headerNav } from "@/lib/navigation";
import { missingHomeSections } from "@/lib/home-sections";
import { pageContent } from "@/lib/page-content";

// CAMP-363 — мітка того, що Next ЗАРАЗ віддає читачеві з кешу.
//
// 🔴 НАВІЩО ВОНА, КОЛИ Є САМ ГАЧОК. Картка вимагає ловити САМЕ мовчазний
// провал, а не «чи є ендпойнт». Гачок, який відповідає 200 і при цьому
// нічого не скидає, — це рівно мовчазний провал, і перевірка «ендпойнт
// живий» його не бачить. Побачити його можна лише порівнявши ДВА числа:
// що в кеші Next і що зараз у джерелі.
//
// Тому цей маршрут навмисно кличе `headerNav()` — ту саму функцію з тими
// самими параметрами `fetch`, що й сторінки. Next ключує кеш за URL та
// параметрами, тож ми читаємо ТОЙ САМИЙ запис кешу, який бачить читач, а
// не робимо свіжий запит. Якщо мітку не скинули, тут буде старе значення.
//
// 🔴 ЦЕ МУСИТЬ БУТИ ДОВЕДЕНО МУТАЦІЄЮ, А НЕ ПРИПУЩЕНО. Якби маршрут усе ж
// ходив повз кеш, він завжди збігався б із джерелом, і сторож світив би
// зеленим рівно тоді, коли гачок мертвий. Спосіб перевірки в картці: змінити
// рядок у БД, НЕ скидаючи мітку, і довести, що тут лишилось старе значення.
//
// Віддаємо хеш, а не вміст: порівняти його досить, а висипати меню тому,
// хто вгадав секрет, — зайва щедрість.

export async function GET(request: Request): Promise<Response> {
  const denied = authorizeHook(request);
  if (denied) return denied;

  const items = await headerNav();

  // 🔴 ЧОГО БРАКУЄ — ТЕЖ ЧАСТИНА СТАНУ (CAMP-365 п.3).
  //
  // Сторінка більше не падає, коли власник видалив секцію: вона просто
  // малює без неї. Саме по собі це тиша, а тиша тут найдорожча — з ISR
  // Next лишив би попередню справну сторінку, і зникнення блоку не
  // помітив би ніхто. Тож відсутність називається поіменно, і сторож
  // `check-isr-hook` її бачить.
  const home = await pageContent("home");
  const missing = home ? missingHomeSections(home.sections) : ["(сторінки home немає)"];

  const canonical = JSON.stringify(items);
  return Response.json({
    navHash: createHash("sha256").update(canonical).digest("hex"),
    navCount: items.length,
    missingSections: missing,
  });
}
