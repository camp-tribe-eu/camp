import { expect, test } from '@playwright/test';
import {
  applicableWarnings,
  FEED_COUNTRY,
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
    'HR',
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
    'HR',
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
  const { applicable } = applicableWarnings('fr', [' EMMA_ID:FR123 '], [w]);
  expect(applicable.map((x) => x.id)).toEqual(['w1']);
});

test('🔴 a warning nobody can place does not read as "clear"', () => {
  // Латвія, Естонія, Швеція — 21 попередження зі 139 у заміряному зрізі.
  const w = warn('w1', 'latvia', [[]]);
  const { applicable, unlocatable } = applicableWarnings('LV', ['EMMA_ID:LV001'], [w]);
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
  const { applicable, unlocatable } = applicableWarnings('PT', ['EMMA_ID:PT001'], [w]);
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
    'EE',
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
  const { applicable, unlocatable } = applicableWarnings('SE', ['NUTS3:SE110'], [w]);
  expect(applicable.map((x) => x.id)).toEqual(['w1']);
  expect(unlocatable).toEqual([]);
});

test('the sentence for an unplaceable warning refuses to imply calm', () => {
  const w = warn('w1', 'latvia', [[]]);
  const { applicable, unlocatable } = applicableWarnings('LV', ['EMMA_ID:LV001'], [w]);
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

// 🔴 ДВА СЛОВНИКИ, І ПЕРША РЕДАКЦІЯ ВДАВАЛА, ЩО ЦЕ ОДИН.
//
// `camping_spots.country` — ISO-2 у верхньому регістрі (заміряно в базі:
// LV 310, EE 467, SE 2368, AX 19). `Warning.country` — слаг фіду
// (`latvia`). Порівняння рядків ніколи не було істинним, тож уся гілка
// `unlocatable` була мертва — а девʼять зелених тестів цього не бачили,
// бо звіряли літерал автора з літералом автора.
//
// Тому корпус для цієї перевірки береться З ФЕТЧЕРА, а не звідси.
test('🔴 the map covers exactly the feeds the fetcher asks for', async () => {
  const { COUNTRIES } = (await import(
    '../../../../scripts/meteoalarm/fetch-warnings.mjs'
  )) as { COUNTRIES: readonly string[] };

  // Імпорт, що нічого не привіз, дав би порожні множини й зелену
  // перевірку ні над чим.
  expect(COUNTRIES.length).toBe(27);

  const mapped = new Set(Object.values(FEED_COUNTRY));
  const asked = new Set(COUNTRIES);
  expect([...asked].filter((c) => !mapped.has(c))).toEqual([]);
  expect([...mapped].filter((c) => !asked.has(c))).toEqual([]);

  // 27 держав плюс `AX`, яка ділить фід із Фінляндією.
  expect(Object.keys(FEED_COUNTRY).length).toBe(28);
  expect(FEED_COUNTRY.AX).toBe('finland');
});

test('🔴 an ISO code reaches its feed: LV finds a latvian warning', () => {
  const w = warn('w1', 'latvia', [['EMMA_ID:LV777']]);
  const { applicable } = applicableWarnings('LV', ['EMMA_ID:LV777'], [w]);
  expect(applicable.map((x) => x.id)).toEqual(['w1']);
});

test('🔴 Åland takes Finland’s feed, because it has none of its own', () => {
  // 19 кемпінгів у базі несуть `AX`. Без цього рядка їхні попередження
  // не збігалися б ніколи — і мовчки.
  const w = warn('w1', 'finland', [[]]);
  const { unlocatable } = applicableWarnings('AX', ['EMMA_ID:FI001'], [w]);
  expect(unlocatable.map((x) => x.id)).toEqual(['w1']);
});

test('🔴 a campsite with no codes of its own is not told it is clear', () => {
  // Сьогодні це КОЖЕН кемпінг: колонки з кодами ще немає (крок 1).
  const w = warn('w1', 'croatia', [['EMMA_ID:HR012']]);
  const { applicable, unlocatable } = applicableWarnings('HR', [], [w]);
  expect(applicable).toEqual([]);
  expect(unlocatable.map((x) => x.id)).toEqual(['w1']);
  expect(warningState(feedOf([w]), applicable, NOW, unlocatable).kind).toBe(
    'no-fresh-data',
  );
});

test('…and a campsite with no codes is still clear where the country has none', () => {
  // Межа: порожні коди не означають «мовчи завжди».
  const elsewhere = warn('w1', 'italy', [['EMMA_ID:IT001']]);
  const { applicable, unlocatable } = applicableWarnings('HR', [], [elsewhere]);
  expect(applicable).toEqual([]);
  expect(unlocatable).toEqual([]);
  expect(warningState(feedOf([elsewhere]), applicable, NOW, unlocatable).kind).toBe(
    'clear',
  );
});

test('🔴 one readable zone and one unreadable is still a doubt', () => {
  // Мутація, що пережила перший прогін: `some` → `every` у `placeless`.
  // Єдиний мішаний випадок у наборі ЗБІГАВСЯ, а збіг виходить із циклу
  // раніше — тож того рядка ніхто не міряв.
  const w = warn('w1', 'latvia', [['EMMA_ID:LV999'], []]);
  const { applicable, unlocatable } = applicableWarnings('LV', ['EMMA_ID:LV001'], [w]);
  expect(applicable).toEqual([]);
  expect(unlocatable.map((x) => x.id)).toEqual(['w1']);
});

test('a code that is not a string does not throw the panel away', () => {
  // Панель, що кидає, не малює нічого — на цій картці це заборонений
  // результат із трасуванням стека замість речення.
  const w = warn('w1', 'croatia', [['EMMA_ID:HR012']]);
  const codes = ['EMMA_ID:HR012', null as unknown as string];
  expect(() => applicableWarnings('HR', codes, [w])).not.toThrow();
  expect(applicableWarnings('HR', codes, [w]).applicable.map((x) => x.id)).toEqual([
    'w1',
  ]);
});

// 🔴 ТРЕТІЙ СЛОВНИК, І ВІН ВИРІШУЄ ОБЛАСТЬ ПРОЄКТУ.
//
// Перевірка вище звіряє мапу з тим, що просить ФЕТЧЕР. Ця звіряє її з
// тим, які країни ми взагалі обслуговуємо — `eu-member-states.json`,
// єдине машиночитне місце, де лежить область (CAMP-118), і те саме
// джерело читають `check-eu-scope.mjs` та `drop-non-eu.mjs`.
//
// Без неї нова держава-член зʼявилась би в базі й у фіді, а в мапі ні —
// і її кемпінги мовчки чули б «спокійно». Саме так помер перший варіант
// цієї гілки, тільки на іншій парі словників.
test('🔴 the map covers exactly the member states the project serves', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const raw = readFileSync(
    join(process.cwd(), '..', 'api', 'src', 'osm', 'eu-member-states.json'),
    'utf8',
  );
  const members = (JSON.parse(raw) as { members: Record<string, string> }).members;

  // Файл, якого не прочитали, дав би порожній перелік і зелену
  // перевірку ні над чим.
  expect(Object.keys(members).length).toBe(27);

  const scope = new Set(Object.keys(members).map((c) => c.toUpperCase()));
  const mapped = new Set(Object.keys(FEED_COUNTRY));

  expect([...scope].filter((c) => !mapped.has(c)).sort()).toEqual([]);
  // Єдиний ключ поза областю — `AX`: субдивізія Фінляндії, 19 кемпінгів
  // у базі, власного фіду не має.
  expect([...mapped].filter((c) => !scope.has(c)).sort()).toEqual(['AX']);
});
