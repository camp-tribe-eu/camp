// CAMP-287 — шов між знімком API і фідом, який читає панель.
//
// 🔴 ОКРЕМИЙ МОДУЛЬ, І ЦЕ ВИМОГА NEXT, А НЕ СМАК. `route.ts` має
// рівно один дозволений набір експортів; будь-який інший Next
// відхиляє згенерованим типом у `.next/types`. Перша версія тримала
// `toFeed` у маршруті, і локальний `tsc` мовчав — доки не піднявся
// dev-сервер і не згенерував ті типи. Зелений typecheck до збірки
// тут нічого не доводить.

// 🔴 РОЗМІР ТОГО, ЩО ЇДЕ ЧИТАЧЕВІ. Заміряно на живому фіді 13.10.2026:
// 179 попереджень, 250 зон, **165 393 байти сирих → 15 673 gzip,
// 13 886 zstd**. Caddy на проді має `encode zstd gzip` (рядок 29
// `/etc/caddy/Caddyfile`, перевірено того ж дня), тож по дроту їде
// ~14 КБ, а не 165.
//
// 🔴 ГЕОМЕТРІЇ СЕРЕД ЦЬОГО НЕМАЄ, і це заміряно, а не припущено: у
// тілі 0 полігонів, 0 кіл і 0 пар координат. Ключі `polygons` і
// `circles` лишаються порожніми масивами — 6 500 байт самих назв, які
// зникають у стисненні. Чистить їх `withoutGeometry` в API; якщо вона
// колись замовкне, число вище виросте на десятки мегабайт, тому його
// тут і записано.

import { AGGREGATOR, METEOALARM_URL, type Warning, type WarningFeed } from '@/lib/warnings';

/**
 * Скільки читачів можуть ділити одну відповідь.
 *
 * Оновлювач в API крутиться раз на 5 хвилин, тож кешувати довше немає
 * сенсу, а коротше — марна праця. 🔴 Але не більше за бюджет ліцензії
 * мінус цикл: інакше ми самі зробили б знімок протермінованим.
 */
export const CACHE_SECONDS = 60;

/**
 * Знімок API → фід, який читає панель.
 *
 * 🔴 ТУТ СТИКАЮТЬСЯ ДВІ СЛОВНИКИ, І ПЕРША ВЕРСІЯ ЦЬОГО ФАЙЛУ ВДАВАЛА,
 * ЩО ВОНИ ОДИН. API віддає `{ fetchedAt, warnings }`; панель читає
 * `feed.meta.fetchedAt`. Тіло, передане «як є», давало `meta ===
 * undefined`, тобто вік `null`, тобто `isFresh === false` — і панель
 * сказала б «немає свіжих даних» КОЖНОМУ кемпінгу Європи, маючи 179
 * живих попереджень у тому самому тілі. Заміряно 13.10.2026 на живому
 * API; десять зелених тестів цього не бачили, бо обидві сторони
 * зʼєднання писав автор тестів.
 *
 * 🔴 `fetchedAt` переноситься ДОСЛІВНО. Спокуса поставити тут момент
 * віддачі перетворила б протерміноване на свіже одним рядком, і
 * `warningState` ніколи б не сказав `stale`.
 *
 * 🔴 `source`/`sourceUrl` — наші константи, а не поля API. Клаузули
 * 5.2 і 5.5 вимагають їх на екрані, і вони живуть там, де живе решта
 * ліцензії, а не подорожують мережею на кожен запит.
 *
 * Повертає `null`, коли тіло не є знімком. Маршрут тоді каже 503, і
 * клієнт читає це як «нічого не приїхало» — єдина чесна відповідь.
 * Порожній фід зі свіжим часом сказав би «попереджень немає».
 */
export function toFeed(payload: unknown): WarningFeed | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { fetchedAt, warnings } = payload as Record<string, unknown>;
  if (typeof fetchedAt !== 'string' || fetchedAt.trim() === '') return null;
  if (!Array.isArray(warnings)) return null;

  // 🔴 КОНВЕРТ ПЕРЕВІРЯВСЯ, ВМІСТ — НІ, І ЦЕ КОШТУВАЛО Б УСЮ СТОРІНКУ.
  // `warnings as readonly Warning[]` був сліпим приведенням. Рецензія
  // прогнала три тіла: `[null]` → `Cannot read properties of null
  // (reading 'areas')`; `areas: "oops"` → `areas.some is not a
  // function`; `country: 42` → `.trim is not a function`. Виняток у
  // рендері клієнтського компонента піднімається до межі сегмента, тож
  // читач діставав би error-екран замість СТОРІНКИ КЕМПІНГА — не
  // замість панелі.
  const usable = warnings.filter(isWarning);

  // 🔴 Усе нечитабельне при непорожньому масиві — це не «попереджень
  // немає», це «ми не змогли прочитати». Та сама логіка, що
  // `yieldLooksBroken` у фетчері: побачили блоки, не лишили жодного.
  if (usable.length === 0 && warnings.length > 0) return null;

  return {
    meta: { source: AGGREGATOR, sourceUrl: METEOALARM_URL, fetchedAt },
    warnings: usable,
  };
}

/**
 * Чи можна це прочитати, не кинувши винятку.
 *
 * 🔴 Перелічені рівно ті поля, яких читач ТОРКАЄТЬСЯ без перевірки:
 * `country.trim()`, `areas.some()`, `area.codes`. Решта полів може
 * бути будь-чим — вони лише друкуються, і `null` друкується
 * нормально.
 */
export function isWarning(x: unknown): x is Warning {
  if (typeof x !== 'object' || x === null) return false;
  const w = x as Record<string, unknown>;
  if (typeof w.country !== 'string') return false;
  if (!Array.isArray(w.areas)) return false;
  return w.areas.every(
    (a) =>
      typeof a === 'object' &&
      a !== null &&
      (( a as Record<string, unknown>).codes === undefined ||
        Array.isArray((a as Record<string, unknown>).codes)),
  );
}
