/**
 * Файл із Directus, відданий читачеві з НАШОГО origin — CAMP-469.
 *
 * Власник завантажує зображення в Directus звичайним способом. Читач
 * бачить його як `/media/country-banner/<код>` на нашому домені.
 *
 * 🔴 ЧОМУ ПРОКСІ, А НЕ ПУБЛІЧНЕ ЧИТАННЯ. Публічне читання `directus_files`
 * відкрило б УСІ завантажені файли, а що туди покладуть завтра — невідомо;
 * чужий хост у `img-src` послаблює CSP. Тут `img-src 'self'` не чіпано, а
 * `directus_files` лишається закритим: файл забирає СЕРВЕР нашим токеном.
 *
 * 🔴 ЦЕЙ МОДУЛЬ — ЄДИНЕ МІСЦЕ, ДЕ Є `CMS_ASSET_TOKEN`. Імені без
 * `NEXT_PUBLIC_`, бо префікс вшив би значення в клієнтський бандл. Модуль
 * не можна імпортувати з жодного `'use client'`-файла, ні прямо, ні
 * транзитивно: це читає `tests/unit/cms-token-server-only.spec.ts`.
 *
 * 🔴 НЕ ШЛЮЗ «ДАЙ БУДЬ-ЯКИЙ ФАЙЛ ЗА ID». Id файла сюди приходить ЛИШЕ з
 * поля банера країни, прочитаного з API за кодом країни; ніщо з URL запиту
 * (ні шлях, ні `?f=`) id не задає.
 *
 * 🔴 ВІДПОВІДЬ ПРО ТИП — ЗА ВМІСТОМ. Перші байти кажуть, що це за файл;
 * `Content-Type` від Directus ігнорується. Дозволено лише растр (JPEG, PNG,
 * WebP, AVIF, GIF). SVG ні: відкритий напряму він виконує скрипти зі
 * свого origin, а це наш origin.
 *
 * 🔴 ЛЮБА ПОМИЛКА — `null`, не виняток: Directus недоступний, токена немає,
 * файл завеликий — сторінка тоді показує запасний банер.
 */
export const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 5000;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const BARE_ID = new RegExp(`^${UUID}$`, 'i');
const ASSET_URL = new RegExp(`(?:^|/)assets/(${UUID})(?:[/?#]|$)`, 'i');

/** Що саме власник вписав у поле банера. */
export type BannerSource =
  | { kind: 'path'; path: string }
  | { kind: 'file'; id: string };

/**
 * Поле приймає три записи: шлях від кореня (`/banners/x.jpg`), id файла
 * з Directus або адресу `…/assets/<id>`, яку видно у файловій бібліотеці.
 * З адреси береться ЛИШЕ id: хост ігнорується, ходимо тільки на свій CMS.
 */
export function parseBannerSource(
  value: string,
  isInternalHref: (v: string) => boolean,
): BannerSource | null {
  const v = value.trim();
  if (BARE_ID.test(v)) return { kind: 'file', id: v.toLowerCase() };
  const asset = ASSET_URL.exec(v);
  if (asset) return { kind: 'file', id: asset[1].toLowerCase() };
  if (v !== '' && isInternalHref(v)) return { kind: 'path', path: v };
  return null;
}

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
]);

/** Тип за першими байтами, або `null`, якщо це не дозволений растр. */
export function sniffImage(b: Uint8Array): string | null {
  const at = (i: number, s: string) =>
    [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && at(1, 'PNG\r\n') && b[6] === 0x1a) return 'image/png';
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return 'image/gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(4, 'ftyp') && (at(8, 'avif') || at(8, 'avis'))) return 'image/avif';
  return null;
}

function config(): { base: string; token: string } | null {
  const base = process.env.CMS_INTERNAL_URL?.replace(/\/+$/, '');
  const token = process.env.CMS_ASSET_TOKEN;
  return base && token ? { base, token } : null;
}

/**
 * 🔴 БЕЗ ЖОДНОГО ЗАБОРОНЕНОГО КЕШУ — НАВІТЬ ТУТ. Цей модуль у графі імпортів
 * сторінки країни, а заборона кешу в графі робить сторінку динамічною на
 * кожен запит (це перевіряє `hub-screens.spec.tsx`, «read no request»).
 * Метадані на рендері кешуються на годину; маршрут `fetch` без підказки
 * не кешує (GET-обробник у Next 15+ статичним не стає).
 */
async function cms(path: string, revalidate?: number): Promise<Response | null> {
  const c = config();
  if (!c) return null;
  try {
    const res = await fetch(`${c.base}${path}`, {
      headers: { authorization: `Bearer ${c.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(revalidate === undefined ? {} : { next: { revalidate } }),
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/**
 * Дешева перевірка на РЕНДЕРІ сторінки: файл є, це дозволений тип і він не
 * завеликий. Ґрунтується на метаданих Directus, без завантаження байтів.
 */
export async function bannerFileUsable(id: string): Promise<boolean> {
  if (!BARE_ID.test(id)) return false;
  const res = await cms(`/files/${id}?fields=type,filesize`, 3600);
  if (!res) return false;
  try {
    const { data } = (await res.json()) as {
      data?: { type?: unknown; filesize?: unknown };
    };
    const size = Number(data?.filesize);
    return (
      typeof data?.type === 'string' &&
      IMAGE_TYPES.has(data.type) &&
      Number.isFinite(size) &&
      size > 0 &&
      size <= MAX_BYTES
    );
  } catch {
    return false;
  }
}

/** Байти файла й тип за вмістом, або `null`. */
export async function fetchBannerFile(
  id: string,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!BARE_ID.test(id)) return null;
  const res = await cms(`/assets/${id}`);
  if (!res) return null;
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null;
  try {
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Довжини заголовка вірити не можна: міряємо те, що прийшло.
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
    const type = sniffImage(bytes);
    return type ? { bytes, type } : null;
  } catch {
    return null;
  }
}
