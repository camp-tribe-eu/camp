// CAMP-289: регіон перейменували — стара адреса мусить вести на нову.
//
// 🔴 ЧОМУ ЦЕ НЕ `spot_links`. Та таблиця описує «кемпінг А → кемпінг Б»:
// той самий ключ, інший рядок. Тут інше — ТОЙ САМИЙ кемпінг, інший
// сегмент адреси. Моделі для перейменування шляху в проєкті не було, і
// через це `slugifyRegion` досі навмисно не вживає `foldToAscii`: його
// власний коментар каже, що зміна зрушила б 350 опублікованих сторінок
// у 404, бо ловити їх нічим.
//
// 🔴 І ЧОМУ САМЕ ЗАРАЗ. Виправлення назв (CAMP-288) злито 12.10 о 12:33,
// а останній імпорт на проді був 11.10. Тобто наступний тижневий імпорт
// перейменує регіони сам — `ON CONFLICT … SET region = EXCLUDED.region` —
// і 681 опублікована адреса переїде. Якщо до того не буде редиректу,
// вони віддадуть 404.
//
// 🔴 ПАРИ РАХУЮТЬСЯ, А НЕ ПЕРЕЛІЧУЮТЬСЯ РУКАМИ. Джерело — той самий
// `NATURAL_EARTH_FIXES`, яким користується імпорт, і той самий
// `slugifyRegion`, яким будується адреса. Переліченими руками вони
// розійшлися б із першою ж правкою таблиці виправлень.

import { correctRegion } from '../osm/region-names';
import { legacyRegionSlug, slugifyRegion } from './canonical';

export interface RegionRename {
  country: string;
  from: string;
  to: string;
  pages: number;
}

/** Рядок, яким база відповідає на питання «які регіони в ужитку». */
export interface RegionRow {
  country: string;
  region: string;
  pages: number;
}

/** Звідки беруться рядки. Запит один — і репетиція вживає саме його. */
export const REGIONS_IN_USE_SQL = `
  SELECT country, region, count(*)::int AS pages
    FROM camping_spots
   WHERE missing_since IS NULL AND region IS NOT NULL
   GROUP BY country, region`;

/**
 * Пари «адреса, що опублікована сьогодні → адреса, яка буде завтра».
 *
 * Дві причини зсуву, і обидві тут, бо для читача вони нерозрізненні:
 *   1. назву виправили (CAMP-288): `Haute-Rhin` → `Haut-Rhin`;
 *   2. слагифікатор навчився згортати `æ ø ß ł ħ` (було `sja-lland`).
 *
 * 🔴 РІЗНИЦЯ ЛИШЕ В ДІАКРИТИЦІ ПАРИ НЕ ДАЄ. `Gyôr` і `Győr` обидва
 * зводяться до `gyor`: адреса не рухається, рухається тільки назва на
 * сторінці. Картка просила це заміряти — заміряно, і дві пари з девʼяти
 * відпали саме тому.
 */
export function regionRenames(rows: readonly RegionRow[]): RegionRename[] {
  const byPair = new Map<string, RegionRename>();
  for (const row of rows) {
    const from = legacyRegionSlug(row.region);
    const to = slugifyRegion(correctRegion(row.country, row.region));
    if (from === '' || to === '' || from === to) continue;
    const key = `${row.country.toLowerCase()}/${from}`;
    const seen = byPair.get(key);
    // Два написання однієї країни можуть зводитись до того самого
    // старого слага; сторінки додаються, адреса призначення одна.
    if (seen) seen.pages += row.pages;
    else
      byPair.set(key, {
        country: row.country.toLowerCase(),
        from,
        to,
        pages: row.pages,
      });
  }
  return [...byPair.values()].sort((a, b) =>
    a.country === b.country
      ? a.from.localeCompare(b.from)
      : a.country.localeCompare(b.country),
  );
}
