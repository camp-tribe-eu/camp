import { revalidateTag } from "next/cache";
import { authorizeHook } from "@/lib/hook-auth";
import { ALLOWED_TAGS } from "@/lib/revalidate-tags";

// CAMP-365 / CAMP-363 — скидання кешу за міткою, щоб правка в CMS
// з'являлась за секунди, а не за добу.
//
// 🔴 ЧОМУ ЦЕ ПОТРІБНО, А НЕ «ПРОСТО ПОСТАВИТИ ВИТРИМКУ МЕНШЕ».
//
// Запит за меню живе в КОРЕНЕВОМУ макеті, а Next бере мінімум витримки
// по всьому дереву маршруту. Тобто коротка витримка заради меню
// опускала б її всьому сайту — див. `lib/navigation.ts`, там заміряно.
// Мітка цієї ціни не має: вона нічого не опускає, її скидає цей виклик.
//
// 🔴 ЧОМУ ЦЕЙ МАРШРУТ НЕ ЛЕЖИТЬ ПІД `/api`, І ПОВЕРТАТИ ЙОГО ТУДИ НЕ МОЖНА.
//
// Він там лежав, і через це НЕ ІСНУВАВ для зовнішнього світу. У Caddy
// (`infra/caddy/camptribe.eu.caddyfile:45`) стоїть
// `handle_path /api/* { reverse_proxy 127.0.0.1:3001 }` — тобто ВЕСЬ
// префікс `/api` належить Nest. Хук від Directus на
// `https://camptribe.eu/api/revalidate` доходив до Nest, діставав 404 і
// нічого не скидав. Жодна помилка при цьому не виникала ніде: Next про
// запит не чув, Nest чесно відповів «нема такого», Directus записав
// невдачу в журнал, якого ніхто не читає. Рівно той мовчазний провал,
// проти якого написана CAMP-363.
//
// Тепер адреса потрапляє у наскрізний `handle { reverse_proxy :3000 }`
// (рядок 56), тобто в Next — без жодної зміни в Caddy.
//
// Щоб це не зламали вдруге, перевіряє не людська пильність, а
// `scripts/ci/check-next-routes-reachable.mjs`: він читає Caddyfile,
// бере префікси, віддані НЕ в Next, і червоніє, якщо хоч один
// обробник Next опинився під ними.



export async function POST(request: Request): Promise<Response> {
  const denied = authorizeHook(request);
  if (denied) return denied;

  const name = new URL(request.url).searchParams.get("tag") ?? "";
  const tag = ALLOWED_TAGS.get(name);
  if (!tag) {
    return Response.json(
      {
        error: `мітка «${name}» не дозволена`,
        allowed: [...ALLOWED_TAGS.keys()],
      },
      { status: 400 },
    );
  }

  revalidateTag(tag);
  return Response.json({ revalidated: tag });
}
