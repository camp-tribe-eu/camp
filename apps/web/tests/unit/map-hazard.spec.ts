import { expect, test } from '@playwright/test';
import {
  isShownLevel,
  levelByZone,
  levelForSpot,
  SHOWN_LEVELS,
  zonesOf,
} from '@/lib/map-hazard';
import type { Warning, WarningFeed } from '@/lib/warnings';

// CAMP-112 — які кемпінги на мапі накриті чинним попередженням.

const NOW = new Date('2026-10-13T12:00:00Z');
const at = (minutesAgo: number) =>
  new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const warn = (over: Partial<Warning> & { country: string; codes: string[] }): Warning => ({
  id: over.id ?? 'w',
  country: over.country,
  event: 'Wind',
  headline: null,
  description: null,
  instruction: null,
  type: null,
  typeCode: null,
  level: over.level ?? 2,
  levelLabel: 'yellow; Moderate',
  sent: at(5),
  onset: null,
  effective: null,
  expires: over.expires ?? '2026-10-13T20:00:00Z',
  areas: [{ name: null, codes: over.codes, polygons: [], circles: [] }],
  sender: 'A National Service',
  senderId: null,
  language: null,
});

const feed = (warnings: Warning[]): WarningFeed => ({
  meta: {
    source: 'EUMETNET – MeteoAlarm',
    sourceUrl: 'https://www.meteoalarm.org',
    fetchedAt: at(3),
  },
  warnings,
});

/** Те, що мапа робить насправді: індекс один раз, потім пошук на кемпінг. */
const spotLevel = (zones: string | null, f: WarningFeed | null) =>
  levelForSpot(zones, levelByZone(f, NOW));

test('зшиті коди розбираються назад', () => {
  expect(zonesOf('EMMA_ID:HR008|NUTS3:HR033')).toEqual(['EMMA_ID:HR008', 'NUTS3:HR033']);
  expect(zonesOf('NUTS3:HR033')).toEqual(['NUTS3:HR033']);
});

test('відсутнє або порожнє — порожній список, а не виняток', () => {
  expect(zonesOf(null)).toEqual([]);
  expect(zonesOf(undefined)).toEqual([]);
  expect(zonesOf('')).toEqual([]);
});

test('кемпінг у зоні попередження отримує свій рівень', () => {
  expect(
    spotLevel('EMMA_ID:HR804', feed([warn({ country: 'croatia', codes: ['EMMA_ID:HR804'], level: 3 })])),
  ).toBe(3);
});

test('сусід в іншій зоні не отримує нічого', () => {
  expect(
    spotLevel('EMMA_ID:HR008', feed([warn({ country: 'croatia', codes: ['EMMA_ID:HR804'] })])),
  ).toBe(0);
});

// 🔴 ЦЕЙ ВИПАДОК Я СПОЧАТКУ НАПИСАВ НАВПАКИ, І ПОМИЛЯВСЯ НЕ КОД, А Я.
//
// Очікував, що голландське попередження не сміє чіпати німецький
// кемпінг. Тест упав, і розсудило третє джерело: резолвер зон робить
// `ST_Contains(z.geom, s.location)` і має власний самотест — «зона
// мусить МІСТИТИ точку, не лише бути поруч»
// (`resolve-campsite-zones.mjs:425`). Отже код означає, що точка
// ГЕОМЕТРИЧНО всередині зони.
//
// Німецький кемпінг усередині голландської зони справді стоїть у
// площі, про яку попередила KNMI. Погода не зупиняється на кордоні, а
// клаузула 5.3 змушує назвати службу, тож читач бачить «KNMI» і судить
// сам. Сховати це означало б сказати «спокійно» під штормом.
//
// Заміряно: 52 коди належать більш ніж одній країні, 3 656 кемпінгів
// носять такий код. Це не крайовий випадок.
test('зона, що перетинає кордон, підсвічує кемпінг по той бік', () => {
  expect(
    spotLevel(
      'EMMA_ID:NL014|WARNCELLID:107215000',
      feed([warn({ country: 'netherlands', codes: ['EMMA_ID:NL014'], level: 4 })]),
    ),
  ).toBe(4);
});

// 🔴 А ось межа, яку перетинати не можна: збіг КРАЇНИ без збігу зони
// нічого не означає. Інакше одне попередження світило б усю державу —
// рівно те, що картка забороняє прямим текстом.
test('та сама країна, інша зона — не підсвічує', () => {
  expect(
    spotLevel('EMMA_ID:HR008', feed([warn({ country: 'croatia', codes: ['EMMA_ID:HR804'], level: 4 })])),
  ).toBe(0);
});

test('два попередження — береться вищий рівень', () => {
  expect(
    spotLevel(
      'EMMA_ID:HR804',
      feed([
        warn({ id: '1', country: 'croatia', codes: ['EMMA_ID:HR804'], level: 2 }),
        warn({ id: '2', country: 'croatia', codes: ['EMMA_ID:HR804'], level: 4 }),
      ]),
    ),
  ).toBe(4);
});

test('…і порядок у фіді на це не впливає', () => {
  expect(
    spotLevel(
      'EMMA_ID:HR804',
      feed([
        warn({ id: '2', country: 'croatia', codes: ['EMMA_ID:HR804'], level: 4 }),
        warn({ id: '1', country: 'croatia', codes: ['EMMA_ID:HR804'], level: 2 }),
      ]),
    ),
  ).toBe(4);
});

// 🔴 Регістр: чужі джерела не згодні самі з собою про нього.
test('регістр коду не вирішує нічого', () => {
  expect(
    spotLevel('emma_id:hr804', feed([warn({ country: 'croatia', codes: ['EMMA_ID:HR804'], level: 3 })])),
  ).toBe(3);
});

// 🔴 Вік ПОПЕРЕДЖЕННЯ, не лише знімка — той самий годинник, що на сторінці.
test('протерміноване попередження не підсвічує нічого', () => {
  expect(
    spotLevel(
      'EMMA_ID:HR804',
      feed([
        warn({ country: 'croatia', codes: ['EMMA_ID:HR804'], expires: '2026-10-13T11:00:00Z' }),
      ]),
    ),
  ).toBe(0);
});

test('кемпінг без кодів — нуль, а не виняток', () => {
  expect(spotLevel(null, feed([warn({ country: 'sweden', codes: [], level: 3 })]))).toBe(0);
});

test('немає фіда — нуль', () => {
  expect(spotLevel('EMMA_ID:HR804', null)).toBe(0);
});

test('порожній фід — нуль', () => {
  expect(spotLevel('EMMA_ID:HR804', feed([]))).toBe(0);
});

// 🔴 Рівень 1 — зелений, тобто ВІДСУТНІСТЬ попередження; фетчер його
// відкидає, і в індексі його бути не може.
test('зелений рівень не потрапляє в індекс', () => {
  const idx = levelByZone(
    feed([warn({ country: 'croatia', codes: ['EMMA_ID:HR804'], level: 1 })]),
    NOW,
  );
  expect(idx.size).toBe(0);
});

test('показуються рівні 2, 3 і 4 — і тільки вони', () => {
  expect([...SHOWN_LEVELS]).toEqual([2, 3, 4]);
  expect(isShownLevel(1)).toBe(false);
  expect(isShownLevel(2)).toBe(true);
  expect(isShownLevel(4)).toBe(true);
  expect(isShownLevel(5)).toBe(false);
});

// 🔴 Індекс будується ОДИН раз: це і є причина, чому він існує.
test('індекс покриває всі зони попередження, не лише першу', () => {
  const idx = levelByZone(
    feed([warn({ country: 'croatia', codes: ['EMMA_ID:HR804', 'NUTS3:HR034'], level: 3 })]),
    NOW,
  );
  expect([...idx.keys()].sort()).toEqual(['emma_id:hr804', 'nuts3:hr034']);
});
