/**
 * ЄС-27 у вебі: перелік країн і шлях до прапора кожної. CAMP-450.
 *
 * 🔴 ДВІ КОПІЇ ОДНОГО ПЕРЕЛІКУ, І ЦЕ НАЗВАНО. Машиночитане джерело області
 * проєкту — `apps/api/src/osm/eu-member-states.json` (CAMP-118): його
 * читають API, `check-eu-scope.mjs` і `drop-non-eu.mjs`. Веб-застосунок із
 * воркспейсу API не імпортує (той самий аргумент, що й у
 * `campsite-count.ts` для `SUBDIVISION_OF`), тож перелік виписано тут
 * руками — а `tests/unit/camping-index.spec.tsx` звіряє його з тим JSON
 * у ОБИДВА боки. Розійдуться — тест називає код, а не мовчить.
 *
 * 🔴 ЧОМУ СТОРІНКА /camping ПОКАЗУЄ ВСІ 27, А НЕ ЛИШЕ КОДИ З API.
 * `/spots/countries` віддає коди, які НЕСУТЬ рядки бази: сьогодні це 27
 * членів плюс `ax` (Åland, регіон Фінляндії зі своїм ISO-кодом). Країна
 * без жодного кемпінгу в базі зникла б зі сторінки зовсім — а читач, який
 * шукає кемпінг на Мальті, має побачити плитку з чесним «ще немає», а не
 * відсутність Мальти серед країн Європи.
 */

/** Двадцять сім держав-членів, ISO 3166-1 alpha-2 у нижньому регістрі. */
export const EU_MEMBER_STATES: readonly string[] = [
  'at', 'be', 'bg', 'hr', 'cy', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr',
  'hu', 'ie', 'it', 'lv', 'lt', 'lu', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk',
  'si', 'es', 'se',
];

const MEMBERS = new Set(EU_MEMBER_STATES);

export const isEuMemberState = (code: string): boolean =>
  MEMBERS.has(code.trim().toLowerCase());

/**
 * Коди, для яких у `public/flags/` лежить файл: 27 членів і `ax` — Åland
 * має власну сторінку (`/camping/ax`, 19 кемпінгів) і власний прапор у
 * flag-icons. Плитка коду поза цим переліком прапора не показує — інакше
 * новий код з API дав би на проді зображення, якого немає (404).
 * Тест про прапори перевіряє файл для КОЖНОГО коду звідси.
 */
const FLAGGED = new Set([...EU_MEMBER_STATES, 'ax']);

export const FLAGGED_CODES: readonly string[] = [...FLAGGED].sort();

export const hasFlag = (code: string): boolean =>
  FLAGGED.has(code.trim().toLowerCase());

/**
 * Прапор країни — наш власний файл у `public/flags/`, не CDN і не npm.
 *
 * Файли — SVG 4×3 з flag-icons (Panayiotis Lipiridis, MIT; скопійовано
 * 08.11.2026 з теки `flags/4x3` репозиторію lipis/flag-icons). Атрибуція —
 * на сторінці /legal/attribution, розділ «Flags», разом із рештою джерел.
 *
 * 🔴 Прецедент самостійного хостингу — шрифт Archivo (CAMP-88): пакет
 * `flag-icons` з npm НЕ ставимо; 27 файлів (плюс `ax`) лежать у репозиторії.
 *
 * ⚠️ Бриф CAMP-450 називав «221–289 байт кожен, усі 27 ≈ 8 КБ». Заміряно
 * 08.11.2026 (`wc -c`, `gzip`): 195 Б (at) … 80 958 Б (es, герб); разом
 * 147 944 Б сирих, 44 645 Б у gzip. Рішення лишається — ліцензія та сама,
 * — але число в брифі було хибне в 18 разів.
 *
 * Чи існує файл — питання тесту про прапори (`FLAGGED_CODES`), а не цієї
 * функції; компонент `Flag` сам не кличе її для коду без прапора. Код із
 * «/» або «..» нікуди не веде.
 */
export function flagSrc(code: string): string {
  const c = code.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(c)) {
    throw new Error(`flagSrc: «${code}» — не двобуквений код країни`);
  }
  return `/flags/${c}.svg`;
}
