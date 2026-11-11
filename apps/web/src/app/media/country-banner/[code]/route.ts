import { getVerifiedFile } from '@/lib/cms-file';
import { getRawBannerMemo } from '@/lib/country-banner';

// CAMP-469 — власне зображення банера країни з Directus, з нашого origin.
//
// 🔴 ПІД `/media`, А НЕ ПІД `/api`: весь префікс `/api` у Caddy належить
// Nest (див. коментар у `internal/revalidate/route.ts`), і обробник Next
// там не існував би для зовнішнього світу.
//
// 🔴 КОД КРАЇНИ, А НЕ ID ФАЙЛА. Id береться з поля банера цієї країни,
// прочитаного з API; `?f=` у адресі лише ключ кешу (id змінюється разом із
// файлом, тож заміна зображення не лишає старого в кешах) і ніколи не
// читається. Інакше цей маршрут став би відкритим шлюзом до всіх файлів CMS.
//
// 🔴 Токена нема ні у відповіді, ні в цьому файлі: він живе лише в
// `lib/cms-file.ts` і йде в запит до Directus.

const NOT_FOUND_HEADERS = {
  // Коротко: збій Directus не мусить застрягти в кешах надовго, але й
  // кожен читач не повинен бити в нього щоразу.
  'cache-control': 'public, max-age=60',
  'x-content-type-options': 'nosniff',
};

const notFound = () =>
  new Response('Not found', { status: 404, headers: NOT_FOUND_HEADERS });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params;
  // До будь-якого походу в API: сміттєвий код не коштує нічого.
  if (!/^[a-z]{2}$/i.test(code)) return notFound();

  const banner = await getRawBannerMemo(code);
  // Шлях із `public/` віддає статика, цей маршрут про файли Directus.
  if (!banner || banner.source.kind !== 'file') return notFound();

  // З кешу на origin: годину свіжий, добу придатний, якщо Directus мовчить.
  const file = await getVerifiedFile(banner.source.id);
  if (!file) return notFound();

  const cacheControl =
    'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
  if (request.headers.get('if-none-match') === file.etag) {
    return new Response(null, {
      status: 304,
      headers: { etag: file.etag, 'cache-control': cacheControl },
    });
  }

  return new Response(file.bytes as BodyInit, {
    status: 200,
    headers: {
      'content-type': file.type,
      'content-length': String(file.bytes.length),
      etag: file.etag,
      'x-content-type-options': 'nosniff',
      // Зображення не виконує нічого, навіть відкрите напряму.
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': cacheControl,
    },
  });
}
