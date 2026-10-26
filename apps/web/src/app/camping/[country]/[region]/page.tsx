import type { Metadata } from 'next';
import { countryName, getCountries, getRegions } from '@/lib/api';
import RegionListing, { regionMeta } from '@/components/region-listing';
import { alternatesFor } from '@/lib/i18n';

type Params = { country: string; region: string };

// 🔴 `true`, І ЦЕ ЗМІНА ПРОТИ CAMP-73 — ЇЇ ЗАСНОВКУ ПЕРЕМІРЯНО 26.10.2026.
//
// CAMP-73 ставила тут `false`, бо з `true` невідома адреса рендерилась на
// вимогу, кликала `notFound()`, і Next віддавав КЛІЄНТСЬКУ оболонку
// помилки: 404 їхав у RSC-навантаженні, тож сторінка була ідеальна в
// браузері й порожня для будь-кого без JS, робота пошуковика включно.
//
// Це більше не так. Заміряно на живій збірці Next 15.5.28, на маршруті
// `/blog/[slug]`, який уже мав `true`:
//     /blog/<неіснуючий> → HTTP 404, 34 418 байт РОЗМІТКИ,
//     у ній «404», «Not found», «page is not here»
// Тобто сторінку-404 тепер рендерить сервер, справжнім HTML.
//
// 🔴 А ЦІНА `false` ВИЯВИЛАСЬ НЕСУМІСНОЮ З ISR (CAMP-396). Документація
// Next каже прямо: під час перевалідації `generateStaticParams` НЕ
// викликається повторно. Ворота Next при цьому — `fallback === false &&
// !isPrerendered → NoFallbackError`. Разом це означає: будь-який
// `revalidateTag` знецінює запис, і сторінка, яку нема з чого
// перевивести, віддає 404 ДО ПЕРЕЗАПУСКУ СЛУЖБИ.
//
// Заміряно на проді 26.10.2026: один виклик `revalidateTag('navigation')`
// поклав 55 269 сторінок кемпінгів і 1 256 гайдів — бо меню живе в
// кореневому макеті, тож його мітку споживає КОЖНА сторінка. Мітка
// `pages` так само клала `/legal/*`, не чіпаючи решти: гине рівно те,
// що мітку їло.
//
// Сторож: scripts/ci/check-dynamic-params.mjs
export const dynamicParams = true;

export async function generateStaticParams(): Promise<Params[]> {
  const countries = await getCountries();
  const out: Params[] = [];
  for (const c of countries) {
    for (const r of await getRegions(c.country)) {
      out.push({ country: c.country, region: r.slug });
    }
  }
  return out;
}

export async function generateMetadata(
  props: {
    params: Promise<Params>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const meta = await regionMeta(params.country, params.region);
  if (!meta) return { title: 'Region not found' };

  const cName = countryName(params.country);

  return {
    title: `Campsites in ${meta.region}, ${cName}`,
    description: `${meta.spots} campsites and motorhome parks in ${meta.region}, ${cName}, with facilities and locations.`,
    alternates: alternatesFor(`/camping/${params.country}/${params.region}`),
    // 🔴 The threshold from CAMP-71: a hub listing one or two campsites is
    // a duplicate of those campsites' own pages. It stays crawlable
    // (`follow`) because it is the only path down to them without the map,
    // but it must not compete in the index as a landing page.
    //
    // Spread rather than `robots: undefined` — see the campsite page:
    // an explicitly-undefined key overwrites the root's value.
    ...(meta.indexable ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function RegionPage(props: { params: Promise<Params> }) {
  const params = await props.params;
  return (
    <RegionListing
      country={params.country}
      region={params.region}
      page={1}
    />
  );
}
