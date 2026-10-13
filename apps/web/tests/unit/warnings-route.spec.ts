import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { CACHE_SECONDS, toFeed } from '@/lib/warnings-feed';
import { FRESH_FOR_MINUTES } from '@/lib/warnings';
import { AGGREGATOR, METEOALARM_URL, panelStateForTestOnly } from './warnings-route-helpers';

// CAMP-287 — шов між API і читачем, і він був розірваний.
//
// 🔴 ЦЕЙ ФАЙЛ ІСНУЄ ЧЕРЕЗ ДЕФЕКТ, ЯКИЙ ПЕРЕЖИВ ДЕСЯТЬ ЗЕЛЕНИХ ТЕСТІВ.
// API віддає `{ fetchedAt, warnings }`. Панель читає
// `feed.meta.fetchedAt`. Маршрут передавав тіло «як є», тож `meta`
// було `undefined`, вік — `null`, а `isFresh` — `false`. Панель
// сказала б «немає свіжих даних» кожному кемпінгу Європи, тримаючи в
// руках 179 живих попереджень (заміряно на живому API 13.10.2026).
//
// Тести цього не бачили, бо фікстури були моєї форми з обох боків:
// автор тесту писав і те, що віддає продюсер, і те, що чекає читач.
// Тому перша перевірка нижче бере імена полів ІЗ ФАЙЛУ API.

const SNAPSHOT_TS = path.join(
  process.cwd(),
  '..',
  'api',
  'src',
  'warnings',
  'snapshot.ts',
);

/** Імена полів `interface Snapshot`, прочитані з джерела продюсера. */
function snapshotFields(): string[] {
  const src = readFileSync(SNAPSHOT_TS, 'utf8');
  const m = /export interface Snapshot \{([\s\S]*?)\n\}/.exec(src);
  if (m === null) throw new Error(`не знайшов interface Snapshot у ${SNAPSHOT_TS}`);
  const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return [...body.matchAll(/^\s*([A-Za-z_]\w*)\??:/gm)].map((x) => x[1]);
}

test('API справді оголошує саме ті поля, які читає маршрут', () => {
  // 🔴 Якщо API перейменує поле, це впаде ТУТ, а не мовчки на сторінці.
  expect(snapshotFields().sort()).toEqual(['fetchedAt', 'warnings']);
});

test('тіло з полями продюсера стає фідом, який панель уміє прочитати', () => {
  const payload = Object.fromEntries(
    snapshotFields().map((f) => [f, f === 'fetchedAt' ? '2026-10-13T14:22:21.335Z' : []]),
  );
  const feed = toFeed(payload);
  expect(feed).not.toBeNull();
  expect(feed?.meta.fetchedAt).toBe('2026-10-13T14:22:21.335Z');
});

test('fetchedAt переноситься дослівно, а не перештамповується', () => {
  const at = '2026-10-13T14:22:21.335Z';
  expect(toFeed({ fetchedAt: at, warnings: [] })?.meta.fetchedAt).toBe(at);
});

/**
 * 🔴 ПЕРША ВЕРСІЯ ЦІЄЇ ПЕРЕВІРКИ БУЛА ЗЕЛЕНА ЗА ПОБУДОВОЮ. Вона
 * порівнювала заголовок із тим самим `CACHE_SECONDS`, з якого його
 * зроблено, тож `60 → 600` не валило нічого. Переказ означення, не
 * перевірка.
 *
 * Питання, яке має значення: чи може знімок дожити до читача
 * протермінованим. Найгірший вік = цикл оновлення API + наш кеш, і він
 * мусить лишатись під бюджетом клаузули 5.6. Цикл читається З ФАЙЛУ
 * API, а не вписаний сюди.
 */
test('цикл API плюс наш кеш вміщаються в десять хвилин клаузули 5.6', () => {
  const src = readFileSync(
    path.join(process.cwd(), '..', 'api', 'src', 'warnings', 'warnings.service.ts'),
    'utf8',
  );
  // 🔴 Розбір, не `eval`: виконувати текст із файлу всередині тесту —
  // поганий смак навіть тут. Приймаються рівно дві форми, які там
  // можуть стояти: число або добуток двох чисел.
  const m = /export const REFRESH_EVERY_MS = ([0-9_]+)(?:\s*\*\s*([0-9_]+))?;/.exec(src);
  if (m === null) throw new Error('не знайшов REFRESH_EVERY_MS у warnings.service.ts');
  const num = (t: string | undefined) => (t === undefined ? 1 : Number(t.replace(/_/g, '')));
  const apiCycleMs = num(m[1]) * num(m[2]);
  expect(Number.isFinite(apiCycleMs) && apiCycleMs > 0).toBe(true);

  const worstAgeMs = apiCycleMs + CACHE_SECONDS * 1_000;
  expect(worstAgeMs).toBeLessThan(FRESH_FOR_MINUTES * 60_000);
});

test('джерело і посилання — наші константи ліцензії, не поля API', () => {
  const feed = toFeed({ fetchedAt: '2026-10-13T14:00:00.000Z', warnings: [], source: 'щось' });
  expect(feed?.meta.source).toBe(AGGREGATOR);
  expect(feed?.meta.sourceUrl).toBe(METEOALARM_URL);
});

test('fetchedAt: null — це «знімка ще немає», і фіда з цього не буде', () => {
  expect(toFeed({ fetchedAt: null, warnings: [] })).toBeNull();
});

test('тіло без warnings не є знімком', () => {
  expect(toFeed({ fetchedAt: '2026-10-13T14:00:00.000Z' })).toBeNull();
});

test('не обʼєкт — не знімок', () => {
  expect(toFeed(null)).toBeNull();
  expect(toFeed('{}')).toBeNull();
});

// 🔴 ПЕРЕВІРКА, ЯКОЇ БРАКУВАЛО. Усе вище можна задовольнити формою;
// ця питає про наслідок: чи стає тіло API панеллю з попередженням.
// Саме вона червоніє, якщо `meta` знову зникне.
test('тіло API доходить до панелі як попередження, а не як «немає даних»', () => {
  const now = new Date('2026-10-13T14:25:00.000Z');
  const body = {
    fetchedAt: '2026-10-13T14:22:21.335Z',
    warnings: [
      {
        id: 'hr-1',
        country: 'croatia',
        event: 'Yellow wind warning',
        headline: null,
        description: null,
        instruction: null,
        type: null,
        typeCode: null,
        level: 2,
        levelLabel: 'yellow; Moderate',
        sent: '2026-10-13T14:00:00.000Z',
        onset: null,
        effective: null,
        expires: '2026-10-13T20:00:00.000Z',
        areas: [{ name: 'Šibenska obala', codes: ['EMMA_ID:HR804'], polygons: [], circles: [] }],
        sender: 'DHMZ Državni hidrometeorološki zavod',
        senderId: 'https://meteo.hr',
        language: 'hr',
      },
    ],
  };
  const state = panelStateForTestOnly('HR', ['EMMA_ID:HR804'], toFeed(body), now);
  expect(state?.kind).toBe('warnings');
});

// 🔴 ДЕФЕКТИ ВМІСТУ, ЗНАЙДЕНІ РЕЦЕНЗІЄЮ. `toFeed` перевіряв конверт і
// сліпо приводив вміст, а виняток у рендері клієнтського компонента
// піднімається до межі сегмента — читач діставав би error-екран
// замість СТОРІНКИ КЕМПІНГА, не замість панелі.

const ok = (over: Record<string, unknown> = {}) => ({
  id: 'x', country: 'croatia', event: null, headline: null, description: null,
  instruction: null, type: null, typeCode: null, level: null, levelLabel: null,
  sent: '2026-10-13T14:00:00.000Z', onset: null, effective: null,
  expires: '2026-10-13T20:00:00.000Z',
  areas: [{ name: null, codes: ['EMMA_ID:HR804'], polygons: [], circles: [] }],
  sender: 'DHMZ', senderId: null, language: null, ...over,
});
const AT = '2026-10-13T14:22:21.335Z';

test('зіпсовані елементи відкидаються, здорові лишаються', () => {
  const feed = toFeed({
    fetchedAt: AT,
    warnings: [null, ok(), { ...ok(), areas: 'oops' }, { ...ok(), country: 42 }],
  });
  expect(feed?.warnings.length).toBe(1);
});

test('усе нечитабельне при непорожньому масиві — це «не прочитали», не «нічого немає»', () => {
  expect(toFeed({ fetchedAt: AT, warnings: [null, { country: 42, areas: [] }] })).toBeNull();
});

test('порожній масив — законна відповідь, а не поломка', () => {
  expect(toFeed({ fetchedAt: AT, warnings: [] })?.warnings).toEqual([]);
});

test('порожній fetchedAt не є часом', () => {
  expect(toFeed({ fetchedAt: '', warnings: [] })).toBeNull();
  expect(toFeed({ fetchedAt: '   ', warnings: [] })).toBeNull();
});
