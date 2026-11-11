import { apiFetch } from './api';
import { isInternalHref } from './rich-text';

/**
 * Власне зображення банера країни — CAMP-469, частина 1.
 *
 * Його ставить власник у Directus (`pages` → тип «camping-country» → поле
 * «Banner image address»). Ні код, ні генерація, ні сток його не дають:
 * на сайті надруковано правило «No stock photography and no AI-generated
 * images of places nobody has visited».
 *
 * 🔴 `null` — «зображення немає», і сторінка тоді виглядає РІВНО так, як
 * до цієї картки: фон `eu-dawn.svg`, без переднього фото, без напису
 * «фото скоро буде».
 *
 * 🔴 ОДИН ЗІПСОВАНИЙ ЗАПИС КОШТУЄ ОДНОГО БАНЕРА, А НЕ СТОРІНКИ. Не-рядок,
 * порожній рядок і адреса поза нашим origin дають `null`, а не виняток:
 * збірка 27 сторінок країн не мусить падати через одне поле, яке правила
 * людина.
 *
 * 🔴 ЧОМУ ЛИШЕ ШЛЯХ ВІД КОРЕНЯ. CSP сайту (`img-src 'self' data: blob:` і
 * один названий хост вебкамер) не пускає чужих адрес, тож `https://…` дав
 * би зламану картинку в самому верху сторінки — дірку, а не запасний
 * шлях. Рішення про те, звідки власнику брати файл (завантаження в
 * Directus потребує публічного читання `directus_files` і хоста в CSP),
 * не ухвалене цією карткою.
 */
export interface CountryBanner {
  src: string;
  alt: string;
}

export function readCountryBanner(raw: unknown): CountryBanner | null {
  if (raw === null || typeof raw !== 'object') return null;
  const { src, alt } = raw as { src?: unknown; alt?: unknown };
  if (typeof src !== 'string') return null;
  const path = src.trim();
  if (path === '' || !isInternalHref(path)) return null;
  // Зображення без опису лишається, але як декоративне (`alt=""`): вигаданий
  // опис місця був би твердженням, якого ніхто не робив.
  return { src: path, alt: typeof alt === 'string' ? alt.trim() : '' };
}

export async function getCountryBanner(
  code: string,
): Promise<CountryBanner | null> {
  try {
    const res = await apiFetch(
      `/pages/camping-country/${encodeURIComponent(code.toLowerCase())}`,
      { next: { revalidate: 86400 } },
    );
    return res.ok ? readCountryBanner(await res.json()) : null;
  } catch {
    // Збій API прибирає зображення, а не сторінку.
    return null;
  }
}
