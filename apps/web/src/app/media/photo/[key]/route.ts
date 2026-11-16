import { getVerifiedFile } from '@/lib/cms-file';
import { getRawPhotoSlotMemo, isPhotoSlotKey } from '@/lib/photo-slot';

// Власне фото слота з Directus, з нашого origin (рішення власника 16.11.2026).
// Той самий порядок, що в `/media/country-banner/[code]` (CAMP-469).
//
// 🔴 КЛЮЧ ЛИШЕ З ПЕРЕЛІКУ СЛОТІВ, А НЕ ID ФАЙЛА. Id береться з поля цього
// слота, прочитаного з API; `?f=` лише ключ кешу і ніколи не читається.
// Ключ не з переліку — 404 до будь-якого походу, тож маршрут не шлюз до
// файлів CMS.
//
// 🔴 Токена нема ні у відповіді, ні в цьому файлі: він живе лише в
// `lib/cms-file.ts`.

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
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await params;
  // До будь-якого походу в API: сміттєвий ключ не коштує нічого.
  if (!isPhotoSlotKey(key)) return notFound();

  const banner = await getRawPhotoSlotMemo(key);
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
