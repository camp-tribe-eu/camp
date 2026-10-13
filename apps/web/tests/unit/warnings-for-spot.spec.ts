import { expect, test } from '@playwright/test';
import { panelStateFor } from '@/components/warnings-for-spot';
import type { Warning, WarningFeed } from '@/lib/warnings';

// CAMP-287 пункт перевірки 1 — «кемпінг у зоні з чинним попередженням
// показує панель; сусідній кемпінг поза зоною — ні, і це доведено на
// конкретній парі координат».
//
// 🔴 ПАРА ВЗЯТА З БАЗИ, НЕ ВИГАДАНА. Запит по camptribe_dev 13.10.2026
// (`country='HR'`, `missing_since IS NULL`, обидві схеми кодів присутні,
// нуль спільних кодів, впорядковано за відстанню) дав найближчу таку
// пару в ЄС-27:
//
//   Autocamp Paradiso  43.8721, 15.5595  EMMA_ID:HR804, NUTS3:HR034
//   Autokamp Gentile   43.8727, 15.5582  EMMA_ID:HR008, NUTS3:HR033
//                                        відстань 126 м
//
// 🔴 ЦЯ ВІДСТАНЬ — І Є АРГУМЕНТ. Сто двадцять шість метрів, той самий
// берег, той самий округ Šibensko-Kninska, той самий поштовий індекс.
// Зіставлення за країною підсвітило б обидва, і жодне око не відрізнило
// б хибну тривогу від правдивої. Розрізняє їх лише зона, яку назвала
// служба, — тому коди кемпінгів тут скопійовані з рядків бази, а код у
// фікстурі попередження скопійований з рядка Paradiso. Жодна сторона
// з'єднання не придумана автором тесту.
//
// Одиниця виміру перевірена: `location` це `geometry` (SRID 4326), тож
// `ST_Distance` без `::geography` рахує ГРАДУСИ. 126 м — із
// `::geography`. Перший прогін цього запиту надрукував «0.00 km» для
// пари за 500 км, і число ледь не потрапило в коментар.

const PARADISO = ['EMMA_ID:HR804', 'NUTS3:HR034'] as const;
const GENTILE = ['EMMA_ID:HR008', 'NUTS3:HR033'] as const;

/**
 * 🔴 Сторож, не доказ. Якщо колись хтось зрівняє ці два набори однією
 * правкою, випадок «сусід поза зоною» тихо перетвориться на випадок
 * «кемпінг у зоні» і лишиться зеленим. Нехай падає тут і голосно.
 */
test('пара з бази справді не має спільних кодів', () => {
  const shared = PARADISO.filter((c) => (GENTILE as readonly string[]).includes(c));
  expect(shared).toEqual([]);
});

const NOW = new Date('2026-10-13T12:00:00Z');
const at = (minutesAgo: number) =>
  new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const croatianWind = (codes: readonly string[]): Warning => ({
  id: 'alert-hr-1',
  country: 'croatia',
  event: 'Yellow wind warning',
  headline: 'Jugo 60 km/h',
  description: null,
  instruction: null,
  type: 'wind',
  typeCode: null,
  level: 2,
  levelLabel: 'yellow; Moderate',
  sent: at(4),
  onset: null,
  effective: null,
  expires: '2026-10-13T20:00:00Z',
  areas: [{ name: 'Šibenska obala', codes: [...codes], polygons: [], circles: [] }],
  sender: 'DHMZ Državni hidrometeorološki zavod',
  senderId: 'https://meteo.hr',
  language: 'hr',
});

const feedAt = (minutesAgo: number, warnings: Warning[]): WarningFeed => ({
  meta: {
    source: 'MeteoAlarm (EUMETNET)',
    sourceUrl: 'https://meteoalarm.org/',
    fetchedAt: at(minutesAgo),
  },
  warnings,
});

/** Попередження на зону Paradiso. Код узятий з рядка Paradiso в базі. */
const STORM = feedAt(3, [croatianWind([PARADISO[0]])]);

const state = (codes: string[] | null, feed: WarningFeed | null, failed = false) =>
  panelStateFor({ country: 'HR', codes, feed, failed, now: NOW });

test('кемпінг у зоні попередження бачить панель із цим попередженням', () => {
  const s = state([...PARADISO], STORM);
  expect(s?.kind).toBe('warnings');
  expect(s?.kind === 'warnings' && s.warnings.map((w) => w.id)).toEqual(['alert-hr-1']);
});

test('сусід за 126 метрів в іншій зоні панелі не бачить', () => {
  const s = state([...GENTILE], STORM);
  // 🔴 `clear`, а не `warnings`: це ВИМІР, а не мовчання. Фід свіжий,
  // прочитаний, і для цього кемпінга в ньому нічого немає.
  expect(s?.kind).toBe('clear');
});

test('codes === null не малює нічого: резолвер сюди не дійшов', () => {
  expect(state(null, STORM)).toBeNull();
});

test('codes === [] це інша відповідь, ніж null, і вона не «спокійно»', () => {
  // Хорватське попередження без жодного коду — зона дана полігоном.
  const placeless = feedAt(3, [croatianWind([])]);
  const s = state([], placeless);
  expect(s).not.toBeNull();
  expect(s?.kind).toBe('no-fresh-data');
  expect(s?.kind === 'no-fresh-data' && s.reason).toBe('unlocatable');
});

test('поки фід не приїхав — нічого, бо порожня панель читається як «спокійно»', () => {
  expect(state([...PARADISO], null)).toBeNull();
});

test('невдалий запит каже «немає свіжих даних», а не «попереджень немає»', () => {
  const s = state([...PARADISO], null, true);
  expect(s?.kind).toBe('no-fresh-data');
  expect(s?.kind === 'no-fresh-data' && s.reason).toBe('nothing-arrived');
});

test('фід старший за десять хвилин клаузули 5.6 не показує попередження', () => {
  const s = state([...PARADISO], feedAt(11, [croatianWind([PARADISO[0]])]));
  expect(s?.kind).toBe('no-fresh-data');
  expect(s?.kind === 'no-fresh-data' && s.reason).toBe('stale');
});

// 🔴 ДВА ВИПАДКИ, ЯКІ З'ЯВИЛИСЬ ІЗ МУТАЦІЇ. `failed ? null : feed`
// пережив увесь перший прогін матриці, бо в кожному тесті, де `failed`
// був true, `feed` і так був `null`. Стан, у якому тернарник щось
// вирішував, — повторний запит, що впав поверх отриманого знімка, —
// жоден тест не описував, а сам тернарник у ньому помилявся.

test('знімок віком 4 хв лишається на екрані, хоч повторний запит упав', () => {
  const s = state([...PARADISO], STORM, true);
  expect(s?.kind).toBe('warnings');
});

test('але знімок віком 11 хв після падіння — це вже не попередження', () => {
  const s = state([...PARADISO], feedAt(11, [croatianWind([PARADISO[0]])]), true);
  expect(s?.kind).toBe('no-fresh-data');
  expect(s?.kind === 'no-fresh-data' && s.reason).toBe('stale');
});
