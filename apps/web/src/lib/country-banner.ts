import { apiFetch } from './api';
import { isInternalHref } from './rich-text';
import {
  bannerFileUsable,
  parseBannerSource,
  type BannerSource,
} from './cms-file';

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
 * 🔴 ТРИ ДОЗВОЛЕНІ ЗАПИСИ, І ЖОДЕН НЕ ВЕДЕ НА ЧУЖИЙ ХОСТ. CSP сайту
 * (`img-src 'self' …`) не пускає чужих адрес, тож `https://…` дав би
 * зламану картинку в самому верху. Дозволено: шлях від кореня, id файла
 * з Directus і адреса `…/assets/<id>` (з неї береться лише id). Файл із
 * Directus читач отримує з нашого origin через `/media/country-banner/`,
 * див. `cms-file.ts`; CSP і закритий `directus_files` не чіпано.
 */
export interface CountryBanner {
  src: string;
  alt: string;
}

/** Що власник вписав і який опис поставив, ще без звернення до Directus. */
export type RawBanner =
  | { source: BannerSource; alt: string }
  | null;

export function readRawBanner(raw: unknown): RawBanner {
  if (raw === null || typeof raw !== 'object') return null;
  const { src, alt } = raw as { src?: unknown; alt?: unknown };
  if (typeof src !== 'string') return null;
  const source = parseBannerSource(src, isInternalHref);
  if (!source) return null;
  // Зображення без опису лишається, але як декоративне (`alt=""`): вигаданий
  // опис місця був би твердженням, якого ніхто не робив.
  return { source, alt: typeof alt === 'string' ? alt.trim() : '' };
}

/** Адреса на нашому origin, під якою читач бере файл із Directus. */
export const bannerFileUrl = (code: string, id: string): string =>
  `/media/country-banner/${encodeURIComponent(code.toLowerCase())}?f=${id}`;

async function resolveBanner(
  code: string,
  banner: RawBanner,
): Promise<CountryBanner | null> {
  if (!banner) return null;
  if (banner.source.kind === 'path') {
    return { src: banner.source.path, alt: banner.alt };
  }
  // 🔴 Файл, якого Directus не віддасть, не стає картинкою: сторінка з
  // недоступним CMS показує запасний банер, а не зламане зображення.
  if (!(await bannerFileUsable(banner.source.id))) return null;
  return { src: bannerFileUrl(code, banner.source.id), alt: banner.alt };
}

export const readCountryBanner = (
  code: string,
  raw: unknown,
): Promise<CountryBanner | null> => resolveBanner(code, readRawBanner(raw));

/** Сире значення поля банера з API; 404 — «не поставлено». */
export async function getRawBanner(code: string): Promise<RawBanner> {
  try {
    const res = await apiFetch(
      `/pages/camping-country/${encodeURIComponent(code.toLowerCase())}`,
      { next: { revalidate: 86400 } },
    );
    return res.ok ? readRawBanner(await res.json()) : null;
  } catch {
    // Збій API прибирає зображення, а не сторінку.
    return null;
  }
}

export async function getCountryBanner(
  code: string,
): Promise<CountryBanner | null> {
  try {
    return await resolveBanner(code, await getRawBanner(code));
  } catch {
    return null;
  }
}
