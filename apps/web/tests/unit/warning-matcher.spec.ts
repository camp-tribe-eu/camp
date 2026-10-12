import { expect, test } from '@playwright/test';
import {
  applicableWarnings,
  noFreshDataSentence,
  warningState,
  type Warning,
  type WarningFeed,
} from '@/lib/warnings';

// CAMP-287 — which warnings cover THIS campsite, and which we cannot place.
//
// 🔴 ЗАМІР, ЩО ПРОДИКТУВАВ ЦЕЙ ФАЙЛ. Прогін усіх 27 живих фідів
// 12.10.2026: 6 066 блоків → 139 чинних попереджень, 392 зони, 537 кодів.
// З тих 392 зон **59 не мали жодного коду** — лише полігон — і для 21 з
// 139 попереджень це було правдою про КОЖНУ їхню зону. Усі в трьох
// державах: Латвія (39 зон), Естонія (14), Швеція (6).
//
// Матчер лише за кодами відповідає на них «не стосується», і ця
// відповідь не відрізняється від «тут нічого немає». Для латвійського
// кемпінга під латвійським штормом це найгірше речення, яке панель
// може надрукувати. Звідси другий результат — `unlocatable`.

const NOW = new Date('2026-10-12T12:00:00Z');
const FRESH = '2026-10-12T11:55:00Z';

const area = (codes: string[]) => ({
  name: 'Area',
  codes,
  polygons: codes.length === 0 ? ['55.0,24.0 55.1,24.1 55.0,24.1'] : [],
  circles: [],
});

const warn = (id: string, country: string, codes: string[][]): Warning => ({
  id,
  country,
  event: 'Wind',
  headline: 'Strong wind',
  description: null,
  instruction: null,
  type: 'wind',
  typeCode: null,
  level: 2,
  levelLabel: 'yellow; Moderate',
  sent: FRESH,
  onset: null,
  effective: null,
  expires: '2026-10-12T18:00:00Z',
  areas: codes.map(area),
  sender: 'A National Service',
  senderId: 'https://example.test',
  language: 'en',
});

const feedOf = (warnings: Warning[]): WarningFeed => ({
  meta: {
    source: 'MeteoAlarm (EUMETNET)',
    sourceUrl: 'https://meteoalarm.org/',
    fetchedAt: FRESH,
  },
  warnings,
});

test('a campsite inside the named zone gets the warning', () => {
  const w = warn('w1', 'croatia', [['EMMA_ID:HR012']]);
  const { applicable, unlocatable } = applicableWarnings(
    'croatia',
    ['EMMA_ID:HR012', 'NUTS3:HR031'],
    [w],
  );
  expect(applicable.map((x) => x.id)).toEqual(['w1']);
  expect(unlocatable).toEqual([]);
});

test('🔴 the neighbour outside the zone does NOT, and is told it is clear', () => {
  // Та сама країна, та сама мить, інший код зони. Саме та пара, на якій
  // країнове зіставлення зламалось би: воно показало б обом.
  const w = warn('w1', 'croatia', [['EMMA_ID:HR012']]);
  const { applicable, unlocatable } = applicableWarnings(
    'croatia',
    ['EMMA_ID:HR099'],
    [w],
  );
  expect(applicable).toEqual([]);
  // І це можна СТВЕРДЖУВАТИ: усі зони цього попередження мають коди,
  // тож воно справді не про цей кемпінг.
  expect(unlocatable).toEqual([]);
  expect(warningState(feedOf([w]), applicable, NOW, unlocatable).kind).toBe('clear');
});

test('a zone code written in another case is the same zone', () => {
  // 🔴 Чужі джерела не говорять однаково про регістр: `EMMA_ID` і
  // `emma_id` обидва трапляються. Дві назви однієї зони мовчки губили б
  // попередження з причини, якої ніхто не шукатиме.
  const w = warn('w1', 'france', [['emma_id:fr123']]);
  const { applicable } = applicableWarnings('France', [' EMMA_ID:FR123 '], [w]);
  expect(applicable.map((x) => x.id)).toEqual(['w1']);
});

test('🔴 a warning nobody can place does not read as "clear"', () => {
  // Латвія, Естонія, Швеція — 21 попередження зі 139 у заміряному зрізі.
  const w = warn('w1', 'latvia', [[]]);
  const { applicable, unlocatable } = applicableWarnings('latvia', ['EMMA_ID:LV001'], [w]);
  expect(applicable).toEqual([]);
  expect(unlocatable.map((x) => x.id)).toEqual(['w1']);

  const state = warningState(feedOf([w]), applicable, NOW, unlocatable);
  expect(state.kind).toBe('no-fresh-data');
  expect(state.kind === 'no-fresh-data' && state.reason).toBe('unlocatable');
});

test('🔴 …but it keeps quiet only in its own country', () => {
  // Латвійське попередження, яке ніхто не може розташувати, — це привід
  // мовчати в Латвії, а не в Португалії.
  const w = warn('w1', 'latvia', [[]]);
  const { applicable, unlocatable } = applicableWarnings('portugal', ['EMMA_ID:PT001'], [w]);
  expect(applicable).toEqual([]);
  expect(unlocatable).toEqual([]);
  expect(warningState(feedOf([w]), applicable, NOW, unlocatable).kind).toBe('clear');
});

test('🔴 a warning we DID match is shown even when another cannot be placed', () => {
  // Сховати певне заради зізнання в сумніві — це обміняти певність на
  // сумнів. Збіглося — показуємо.
  const hit = warn('hit', 'estonia', [['EMMA_ID:EE005']]);
  const lost = warn('lost', 'estonia', [[]]);
  const { applicable, unlocatable } = applicableWarnings(
    'estonia',
    ['EMMA_ID:EE005'],
    [hit, lost],
  );
  expect(applicable.map((x) => x.id)).toEqual(['hit']);
  expect(unlocatable.map((x) => x.id)).toEqual(['lost']);
  expect(warningState(feedOf([hit, lost]), applicable, NOW, unlocatable).kind).toBe(
    'warnings',
  );
});

test('a mixed warning matches on its coded area and is not also unlocatable', () => {
  const w = warn('w1', 'sweden', [['NUTS3:SE110'], []]);
  const { applicable, unlocatable } = applicableWarnings('sweden', ['NUTS3:SE110'], [w]);
  expect(applicable.map((x) => x.id)).toEqual(['w1']);
  expect(unlocatable).toEqual([]);
});

test('the sentence for an unplaceable warning refuses to imply calm', () => {
  const w = warn('w1', 'latvia', [[]]);
  const { applicable, unlocatable } = applicableWarnings('latvia', ['EMMA_ID:LV001'], [w]);
  const state = warningState(feedOf([w]), applicable, NOW, unlocatable);
  const said = state.kind === 'no-fresh-data' ? noFreshDataSentence(state) : '';
  expect(said).toContain('cannot tell whether it');
  // 🔴 Речення, яке є в кожній причині, бо порожнє місце читається як
  // «все спокійно».
  expect(said).toContain('not a statement that conditions are calm');
});

test('warningState keeps working for callers that pass no fourth argument', () => {
  // 🔴 Підпис розширено параметром зі значенням за замовчуванням. Якщо
  // він стане обовʼязковим, кожен наявний виклик мовчки змінить сенс.
  const w = warn('w1', 'croatia', [['EMMA_ID:HR012']]);
  expect(warningState(feedOf([w]), [w], NOW).kind).toBe('warnings');
  expect(warningState(feedOf([]), [], NOW).kind).toBe('clear');
});
