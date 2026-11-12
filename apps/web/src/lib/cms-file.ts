import { createHash } from 'node:crypto';

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
const DEFAULT_TIMEOUT_MS = 5000;

/** Скільки чекаємо на Directus; змінною лише щоб тест не чекав п'ять секунд. */
const timeoutMs = (): number =>
  Number(process.env.CMS_FETCH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

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
      // Таймаут охоплює й читання тіла, а не лише заголовки.
      signal: AbortSignal.timeout(timeoutMs()),
      ...(revalidate === undefined ? {} : { next: { revalidate } }),
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/**
 * Дешева перевірка до завантаження: файл є, це дозволений тип і він не
 * завеликий. Ґрунтується на метаданих Directus, без байтів. Відсіює 2-ГБ
 * файл ще до того, як ми його почнемо читати.
 */
async function bannerFileMetaOk(id: string): Promise<boolean> {
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

/**
 * 🔴 ЧИТАННЯ ПОТОКОМ З ОБРИВОМ. `arrayBuffer()` буферизує все тіло, і лише
 * потім можна зміряти довжину: заглушка без `Content-Length` віддала 2 ГБ за
 * 5 с і підняла пам'ять процесу на 1,1 ГБ, а це публічний маршрут. Тут
 * читаємо чанками й скасовуємо потік, щойно набралось більше за ліміт.
 */
async function readCapped(res: Response): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length'));
  const reader = res.body?.getReader();
  if (!reader) return null;
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export interface VerifiedFile {
  bytes: Uint8Array;
  type: string;
  etag: string;
}

/** Байти файла, тип за вмістом і ETag, або `null`. Без кешу. */
export async function fetchBannerFile(id: string): Promise<VerifiedFile | null> {
  if (!BARE_ID.test(id)) return null;
  const res = await cms(`/assets/${id}`);
  if (!res) return null;
  const bytes = await readCapped(res);
  if (!bytes || bytes.length === 0) return null;
  const type = sniffImage(bytes);
  if (!type) return null;
  const etag = `"${createHash('sha1').update(bytes).digest('hex').slice(0, 24)}"`;
  return { bytes, type, etag };
}

// ── Кеш на origin ────────────────────────────────────────────────────────
//
// 🔴 БЕЗ НЬОГО КОЖЕН ЗАПИТ ХОДИВ У DIRECTUS ПО 4 МБ (заміряно: 60 паралельних
// запитів дали 60 походів). Ключ — id файла з ПОЛЯ БАНЕРА, а не що-небудь із
// запиту: `?f=0..59` ключів не множить. Тримаємо не більше восьми файлів,
// одночасні запити на той самий id діляться одним походом, відмова
// запам'ятовується на хвилину, а застарілий файл віддається ще добу, якщо
// Directus не відповів на оновлення.

const FRESH_MS = 60 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const MAX_ENTRIES = 8;

interface Entry {
  at: number;
  value: VerifiedFile | null;
  retryAt: number;
}

let clock: () => number = () => Date.now();
const files = new Map<string, Entry>();
const inflight = new Map<string, Promise<VerifiedFile | null>>();

/** Для тестів: годинник і порожній кеш. */
export const testHooks = {
  setClock: (f: () => number) => {
    clock = f;
  },
  reset: () => {
    clock = () => Date.now();
    files.clear();
    inflight.clear();
  },
};

export const nowMs = (): number => clock();

export async function getVerifiedFile(id: string): Promise<VerifiedFile | null> {
  const now = clock();
  const e = files.get(id);
  if (e && ((e.value && now - e.at < FRESH_MS) || now < e.retryAt)) {
    return e.value;
  }
  const running = inflight.get(id);
  if (running) return running;

  const p = (async () => {
    const fresh = await fetchBannerFile(id);
    const t = clock();
    if (fresh) {
      files.set(id, { at: t, value: fresh, retryAt: 0 });
    } else {
      const keep = e?.value && t - e.at < STALE_MS ? e : null;
      files.set(id, {
        at: keep ? keep.at : t,
        value: keep ? keep.value : null,
        retryAt: t + RETRY_MS,
      });
    }
    while (files.size > MAX_ENTRIES) {
      files.delete(files.keys().next().value as string);
    }
    return files.get(id)!.value;
  })().finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

/**
 * Для РЕНДЕРУ сторінки: чи справді читач дістане цей файл. Метадані
 * Directus кажуть, чим файл ЗВЕТЬСЯ (SVG під іменем `.png`, HEIC із типом
 * `image/jpeg` проходили), тому остаточно судять байти — ті самі, що віддасть
 * маршрут, з того самого кешу.
 */
export async function bannerFileUsable(id: string): Promise<boolean> {
  if (!(await bannerFileMetaOk(id))) return false;
  return (await getVerifiedFile(id)) !== null;
}
