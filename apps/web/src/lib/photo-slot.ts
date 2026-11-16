import { apiFetch } from './api';
import { bannerFileUsable, nowMs } from './cms-file';
import { readRawBanner, type RawBanner } from './country-banner';

/**
 * Слоти фото, які заповнює власник у Directus.
 *
 * Рішення власника 16.11.2026: «Нароби заглушки фото де треба, а я виведу
 * перед відкриттям сайту вже те, що мені буде потрібно». Тема Fuse має фото
 * там, де наша сторінка досі не мала нічого. Ми фото НЕ генеруємо й чужих
 * не беремо (на сайті надруковано «No stock photography and no AI-generated
 * images of places nobody has visited»): місце під фото — слот. Порожній
 * показує заглушку (`components/photo-slot.tsx`), заповнений — фото власника.
 *
 * 🔴 МЕХАНІЗМ ТОЙ САМИЙ, ЩО В БАНЕРА КРАЇНИ (CAMP-469), НЕ НОВИЙ. Слот — рядок
 * `pages` з `type = 'photo-slot'`; адреса й опис — наявні поля
 * `pages.banner_image_url` і `page_translations.banner_image_alt`. Нових
 * колекцій і полів Directus немає. Три дозволені записи в полі — ті самі:
 * шлях від кореня, id файла Directus, адреса `…/assets/<id>`; файл читач
 * бере з нашого origin через `/media/photo/<ключ>`, чужий хост не пускає CSP.
 *
 * 🔴 ПЕРЕЛІК КЛЮЧІВ ДЗЕРКАЛИТЬ `apps/api/src/pages/photo-slots.ts`; тест
 * `tests/unit/photo-slot.spec.tsx` читає той файл і червоніє, якщо переліки
 * розійшлися. Ключ не з переліку не доходить ні до API, ні до Directus.
 *
 * 🔴 ОДИН ЗІПСОВАНИЙ ЗАПИС КОШТУЄ ОДНОГО СЛОТА, А НЕ СТОРІНКИ: збій API,
 * не-рядок, адреса чужого хоста, файл, якого Directus не віддасть, — усе це
 * `null`, тобто заглушка, а не виняток і не зламана картинка.
 */
export const PHOTO_SLOT_KEYS = [
  'route-hero',
  'guide-hero',
  'guide-topic-hero',
  'provider-hero',
] as const;

export type PhotoSlotKey = (typeof PHOTO_SLOT_KEYS)[number];

export const isPhotoSlotKey = (v: string): v is PhotoSlotKey =>
  (PHOTO_SLOT_KEYS as readonly string[]).includes(v);

export interface PhotoSlotImage {
  src: string;
  alt: string;
}

/** Адреса на нашому origin, під якою читач бере файл із Directus. */
export const photoFileUrl = (key: PhotoSlotKey, id: string): string =>
  `/media/photo/${key}?f=${id}`;

/** Сире значення поля слота з API; 404 — «не поставлено». */
export async function getRawPhotoSlot(key: PhotoSlotKey): Promise<RawBanner> {
  try {
    const res = await apiFetch(`/pages/photo-slot/${key}`, {
      next: { revalidate: 86400 },
    });
    return res.ok ? readRawBanner(await res.json()) : null;
  } catch {
    // Збій API прибирає фото, а не сторінку.
    return null;
  }
}

/** Фото слота або `null` — тоді сторінка малює заглушку. */
export async function getPhotoSlot(
  key: PhotoSlotKey,
): Promise<PhotoSlotImage | null> {
  try {
    const raw = await getRawPhotoSlot(key);
    if (!raw) return null;
    if (raw.source.kind === 'path') {
      return { src: raw.source.path, alt: raw.alt };
    }
    // 🔴 Файл, якого Directus не віддасть, не стає картинкою.
    if (!(await bannerFileUsable(raw.source.id))) return null;
    return { src: photoFileUrl(key, raw.source.id), alt: raw.alt };
  } catch {
    return null;
  }
}

// ── Для маршруту `/media/photo/<ключ>`: коротка пам'ять про поле слота ──
// Ключів чотири, тож пам'ять обмежена перелічком; одночасні запити діляться
// одним походом.
const RAW_TTL_MS = 60 * 1000;
const rawMemo = new Map<string, { at: number; value: RawBanner }>();
const rawInflight = new Map<string, Promise<RawBanner>>();

export const photoSlotTestHooks = {
  reset: () => {
    rawMemo.clear();
    rawInflight.clear();
  },
};

export async function getRawPhotoSlotMemo(key: PhotoSlotKey): Promise<RawBanner> {
  const hit = rawMemo.get(key);
  if (hit && nowMs() - hit.at < RAW_TTL_MS) return hit.value;
  const running = rawInflight.get(key);
  if (running) return running;
  const p = getRawPhotoSlot(key)
    .then((value) => {
      rawMemo.set(key, { at: nowMs(), value });
      return value;
    })
    .finally(() => rawInflight.delete(key));
  rawInflight.set(key, p);
  return p;
}

/**
 * Фон банера, який живить слот: фото власника, а порожній слот — дефолтний
 * фон, тож сторінка без фото виглядає рівно як до слота. Опис — зі слота
 * (порожній, коли власник його не вписав: фон декоративний).
 */
export async function bannerBackground(
  key: PhotoSlotKey,
  fallback: string,
): Promise<{ src: string; alt: string }> {
  return (await getPhotoSlot(key)) ?? { src: fallback, alt: '' };
}
