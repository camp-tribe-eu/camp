import { expect, test } from '@playwright/test';
import { isShownLevel, levelsBySlug, SHOWN_LEVELS, zonesOf } from '@/lib/map-hazard';
import type { Warning, WarningFeed } from '@/lib/warnings';

// CAMP-112 — які кемпінги на мапі накриті чинним попередженням.
//
// 🔴 ПАРА, НА ЯКІЙ ТРИМАЄТЬСЯ ГОЛОВНИЙ ВИПАДОК, УЗЯТА З БАЗИ. Запит по
// camptribe_dev 13.10.2026: 52 коди зон належать БІЛЬШ НІЖ одній
// країні. Найбільший — `EMMA_ID:NL014`, 645 кемпінгів у Німеччині й
// Нідерландах; далі `EMMA_ID:IT002`, 255 в Австрії й Італії.
// Метеозони не зупиняються на кордоні, і зіставлення лише за кодом
// підсвітило б 645 німецьких кемпінгів на голландське попередження.

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
  const m = levelsBySlug(
    'HR',
    [{ slug: 'a', zones: 'EMMA_ID:HR804' }],
    feed([warn({ country: 'croatia', codes: ['EMMA_ID:HR804'], level: 3 })]),
    NOW,
  );
  expect(m.get('a')).toBe(3);
});

test('сусід в іншій зоні не отримує нічого', () => {
  const m = levelsBySlug(
    'HR',
    [{ slug: 'a', zones: 'EMMA_ID:HR804' }, { slug: 'b', zones: 'EMMA_ID:HR008' }],
    feed([warn({ country: 'croatia', codes: ['EMMA_ID:HR804'] })]),
    NOW,
  );
  expect([...m.keys()]).toEqual(['a']);
});

// 🔴 ЦЕЙ ВИПАДОК Я СПОЧАТКУ НАПИСАВ НАВПАКИ, І ПОМИЛЯВСЯ НЕ КОД, А Я.
//
// Очікував, що голландське попередження НЕ сміє чіпати німецький
// кемпінг. Тест упав, і третє джерело розсудило: резолвер зон робить
// `ST_Contains(z.geom, s.location)` і має власний самотест — «зона
// мусить МІСТИТИ точку, не лише бути поруч»
// (`resolve-campsite-zones.mjs:425`). Отже код на кемпінгу означає, що
// ця точка ГЕОМЕТРИЧНО всередині зони, а не «десь поблизу».
//
// Німецький кемпінг усередині голландської зони справді стоїть у
// площі, про яку попередила KNMI. Погода не зупиняється на кордоні, а
// клаузула 5.3 змушує назвати службу, тож читач бачить «KNMI» і судить
// сам. Сховати це означало б сказати «спокійно» під штормом — те
// єдине, чого картка забороняє.
//
// Заміряно: 52 коди належать більш ніж одній країні, 3 656 кемпінгів
// носять такий код. Це не крайовий випадок.
//
// 🔴 А ось чого тут НЕМАЄ і бути не сміє — зіставлення за КРАЇНОЮ:
// хорватське попередження на всіх хорватських кемпінгах. Воно
// перевірене нижче.
test('зона, що перетинає кордон, підсвічує кемпінг по той бік', () => {
  const m = levelsBySlug(
    'DE',
    [{ slug: 'німецький', zones: 'EMMA_ID:NL014|WARNCELLID:107215000' }],
    feed([warn({ country: 'netherlands', codes: ['EMMA_ID:NL014'], level: 4 })]),
    NOW,
  );
  expect(m.get('німецький')).toBe(4);
});

// 🔴 І межа, яку перетинати не можна: збіг країни БЕЗ збігу коду нічого
// не означає. Інакше одне попередження світило б усю державу.
test('та сама країна, інша зона — не підсвічує', () => {
  const m = levelsBySlug(
    'HR',
    [{ slug: 'a', zones: 'EMMA_ID:HR008' }],
    feed([warn({ country: 'croatia', codes: ['EMMA_ID:HR804'], level: 4 })]),
    NOW,
  );
  expect(m.size).toBe(0);
});

test('…а власне попередження країни його підсвічує', () => {
  const m = levelsBySlug(
    'DE',
    [{ slug: 'німецький', zones: 'EMMA_ID:NL014|WARNCELLID:107215000' }],
    feed([warn({ country: 'germany', codes: ['WARNCELLID:107215000'], level: 3 })]),
    NOW,
  );
  expect(m.get('німецький')).toBe(3);
});

// 🔴 Максимум, не перший: порядок у фіді — чуже сортування.
test('два попередження — береться вищий рівень', () => {
  const m = levelsBySlug(
    'HR',
    [{ slug: 'a', zones: 'EMMA_ID:HR804' }],
    feed([
      warn({ id: '1', country: 'croatia', codes: ['EMMA_ID:HR804'], level: 2 }),
      warn({ id: '2', country: 'croatia', codes: ['EMMA_ID:HR804'], level: 4 }),
    ]),
    NOW,
  );
  expect(m.get('a')).toBe(4);
});

test('…і порядок у фіді на це не впливає', () => {
  const m = levelsBySlug(
    'HR',
    [{ slug: 'a', zones: 'EMMA_ID:HR804' }],
    feed([
      warn({ id: '2', country: 'croatia', codes: ['EMMA_ID:HR804'], level: 4 }),
      warn({ id: '1', country: 'croatia', codes: ['EMMA_ID:HR804'], level: 2 }),
    ]),
    NOW,
  );
  expect(m.get('a')).toBe(4);
});

// 🔴 Вік ПОПЕРЕДЖЕННЯ, не лише знімка — той самий годинник, що на сторінці.
test('протерміноване попередження не підсвічує нічого', () => {
  const m = levelsBySlug(
    'HR',
    [{ slug: 'a', zones: 'EMMA_ID:HR804' }],
    feed([
      warn({ country: 'croatia', codes: ['EMMA_ID:HR804'], expires: '2026-10-13T11:00:00Z' }),
    ]),
    NOW,
  );
  expect(m.size).toBe(0);
});

test('кемпінг без кодів не потрапляє в список', () => {
  const m = levelsBySlug(
    'SE',
    [{ slug: 'шведський', zones: null }],
    feed([warn({ country: 'sweden', codes: [], level: 3 })]),
    NOW,
  );
  expect(m.size).toBe(0);
});

test('немає фіда — порожньо, а не виняток', () => {
  expect(levelsBySlug('HR', [{ slug: 'a', zones: 'EMMA_ID:HR804' }], null, NOW).size).toBe(0);
});

test('порожній фід — порожньо', () => {
  expect(levelsBySlug('HR', [{ slug: 'a', zones: 'EMMA_ID:HR804' }], feed([]), NOW).size).toBe(0);
});

// 🔴 Рівень 1 — зелений, тобто ВІДСУТНІСТЬ попередження; фетчер його
// відкидає, і на мапі його бути не може.
test('показуються рівні 2, 3 і 4 — і тільки вони', () => {
  expect([...SHOWN_LEVELS]).toEqual([2, 3, 4]);
  expect(isShownLevel(1)).toBe(false);
  expect(isShownLevel(2)).toBe(true);
  expect(isShownLevel(4)).toBe(true);
  expect(isShownLevel(5)).toBe(false);
});
