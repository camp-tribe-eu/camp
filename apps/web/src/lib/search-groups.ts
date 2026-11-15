// CAMP-455: вкладки пошуку — регіони й країни.
//
// 🔴 ЛИШЕ ТЕ, ЩО ДАНІ РЕАЛЬНО МІСТЯТЬ. Індекс пошуку (`/spots/search-index`)
// віддає кемпінги, і в кожного є країна та регіон. З цього виходять два
// інші типи без нового сервісу й без нового запиту:
//
//   • регіони — відмінні пари (країна, регіон) серед документів індексу,
//     кожна з лічильником кемпінгів;
//   • країни — перелік, який сторінка вже має з `/spots/countries`
//     (кількості звідти, а не з індексу: вони повні й тоді, коли частини
//     індексу ще йдуть).
//
// Гайдів тут немає навмисно: API віддає їх лише списком із повними
// текстами (1 268 записів), а не індексом для пошуку. Тягнути їх у
// браузер заради вкладки — це новий, окремий індекс, і це не те, що
// можна принести тихо в картці про сторінку.
//
// 🔴 Регіон названий за слагом, а не за справжньою назвою («Splitsko
// Dalmatinska», не «Splitsko-dalmatinska županija»): назва живе в
// `/spots/{country}/regions`, а це 27 запитів, яких пошук не робить.
// Назва годиться, щоб упізнати місце; сама картка веде на сторінку
// регіону, де вона вже справжня.

import { countryName } from '@/lib/api';
import { fold, terms, type SearchDoc } from '@/lib/search';

export interface RegionEntry {
  country: string;
  /** Слаг регіону — те, що стоїть в адресі. */
  region: string;
  /** Читабельна назва зі слагу. */
  name: string;
  /** Скільки кемпінгів індексу в ньому. */
  count: number;
  /** Згорнутий рядок, у якому шукаємо: регіон і країна. */
  text: string;
}

export interface CountryEntry {
  country: string;
  name: string;
  spots: number;
  regions: number;
  text: string;
}

/** `splitsko-dalmatinska` → `Splitsko Dalmatinska`. */
export function regionTitle(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Відмінні регіони індексу з лічильниками. Порядок не визначений. */
export function regionEntries(docs: readonly SearchDoc[]): RegionEntry[] {
  const seen = new Map<string, RegionEntry>();
  for (const d of docs) {
    const key = `${d.country}/${d.region}`;
    const found = seen.get(key);
    if (found) {
      found.count += 1;
      continue;
    }
    const name = regionTitle(d.region);
    seen.set(key, {
      country: d.country,
      region: d.region,
      name,
      count: 1,
      text: fold(`${name} ${countryName(d.country)}`),
    });
  }
  return [...seen.values()];
}

export function countryEntries(
  countries: readonly { country: string; spots: number; regions: number }[],
): CountryEntry[] {
  return countries.map((c) => ({
    country: c.country,
    name: countryName(c.country),
    spots: c.spots,
    regions: c.regions,
    text: fold(countryName(c.country)),
  }));
}

/**
 * Записи, у яких КОЖНЕ слово запиту є початком якогось слова запису.
 *
 * Початком, а не підрядком: «ari» не мусить знаходити «Bari», а «bar» —
 * мусить. Одруківок тут немає: у переліку з 27 країн і кількох сотень
 * регіонів нема чого відновлювати вгадуванням, а помилкова картка
 * країни гірша за порожню.
 *
 * Порядок: назва дорівнює запиту → назва починається із запиту → більше
 * кемпінгів → за абеткою. Останній ключ потрібен, щоб порядок не залежав
 * від того, у якому порядку прийшли частини індексу.
 */
export function matchEntries<
  T extends { text: string; name: string; country: string },
>(entries: readonly T[], query: string, count: (e: T) => number, limit = 12): T[] {
  const ts = terms(query);
  if (ts.length === 0) return [];
  const whole = ts.join(' ');
  const hits = entries.filter((e) => {
    const words = e.text.split(' ');
    return ts.every((t) => words.some((w) => w.startsWith(t)));
  });
  const rank = (e: T): number => {
    const n = fold(e.name);
    return n === whole ? 0 : n.startsWith(whole) ? 1 : 2;
  };
  return hits
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        count(b) - count(a) ||
        a.name.localeCompare(b.name, 'en') ||
        a.country.localeCompare(b.country),
    )
    .slice(0, limit);
}
