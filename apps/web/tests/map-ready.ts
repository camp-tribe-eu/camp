import type { Page } from '@playwright/test';

// CAMP-382 — ОДНЕ чекання на готовність мапи для всіх наборів.
//
// 🔴 ЧОМУ ПОЗИТИВНЕ ПОРІВНЯННЯ, А НЕ `!== 'loading'`.
//
// Так було написано у трьох місцях (`drought-layer`, `wildfire-layer`, і
// я збирався додати четверте у візуальному наборі). Заміряно 21.10.2026,
// три прогони кожного:
//
//   атрибут правильний   → 380 / 1548 / 918 мс, зелено
//   атрибут із помилкою  → 309 / 310 / 311 мс, ЗЕЛЕНО
//   вузол із помилкою    → 20 001 мс, червоно
//
// Друкарська помилка в НАЗВІ АТРИБУТА робить чекання порожнім: відсутній
// атрибут це `null`, а `null !== 'loading'` істинне негайно. Тобто
// сторож проходив за 0,3 с, нічого не дочекавшись, і виглядав точно так
// само, як справжнє очікування.
//
// Позитивна форма цього не може: `null` не належить переліку, тож
// помилка падає гучно. Те саме вже робить `tests/scale/map.page.spec.ts`
// через `toHaveAttribute('data-map-state', 'ready')` — форма в репозиторії
// була, просто не всюди.

export const MAP = '[data-testid="map"]';

/**
 * Усі стани, які мапа вміє публікувати.
 *
 * 🔴 Звіряється з `MapDataState` у `src/lib/map-chunks.ts` окремим
 * модульним тестом: новий стан не має права зʼявитись у коді й не
 * зʼявитись тут, бо тоді чекання мовчки розійдеться з дійсністю.
 */
export const MAP_STATES = ['loading', 'ready', 'wide', 'failed'] as const;
export type MapState = (typeof MAP_STATES)[number];

/** Стани, у яких картинка стала: дані більше не приходять. */
export const MAP_DRAWN: readonly MapState[] = ['ready', 'wide'];

/**
 * Чекати, поки мапа ПРИЙДЕ в один із названих станів.
 *
 * Падіння називає стан, у якому вона застрягла, а не «бюджет вичерпано».
 */
/**
 * Стани нотатки про пожежі (`wildfire-panel.tsx`), що лежить у
 * повносторінковому знімку й НЕ замаскована.
 */
export const NOTE = '[data-testid="wildfire-note"]';
export const NOTE_STATES = [
  'off',
  'loading',
  'fresh',
  'stale',
  'missing',
] as const;
export type NoteState = (typeof NOTE_STATES)[number];
export const NOTE_SETTLED: readonly NoteState[] = [
  'off',
  'fresh',
  'stale',
  'missing',
];

/**
 * Чекати, поки вузол `sel` оголосить у `attr` один із названих станів.
 *
 * 🔴 ПОМИЛКУ НЕ ПІДМІНЮЄМО, А ДОПОВНЮЄМО. Перша редакція ловила будь-яке
 * відхилення й кидала власний вирок про таймаут. Заміряно рецензією
 * #313: закрита сторінка на 532-й мілісекунді давала «не дійшла до
 * стану за 10 000 мс; атрибута немає — перевір назву» — три твердження,
 * і всі три хибні, а справжня причина знищена.
 *
 * 🔴 І ДІАГНОСТИЧНЕ ЧИТАННЯ МАЄ ВЛАСНУ КОРОТКУ МЕЖУ. `page.getAttribute`
 * це ДІЯ, тобто вона підпадає під `actionTimeout` (20 000 мс). Заміряно:
 * при бюджеті чекання 3 000 мс падіння приходило через 23 046 мс — межі
 * складались. Разом із типовим чеканням це дало б 40 с проти 30-секундного
 * бюджету візуального проєкту, тобто рівно те «Test timeout exceeded»,
 * яке ця картка й скасовує.
 */
async function waitForState(
  page: Page,
  sel: string,
  attr: string,
  accept: readonly string[],
  timeout: number,
  what: string,
): Promise<void> {
  if (accept.length === 0) {
    throw new Error(
      `${what}: перелік прийнятних станів порожній — таке чекання не ` +
        'може завершитись успіхом ніколи.',
    );
  }
  await page.waitForSelector(sel, { timeout });
  try {
    await page.waitForFunction(
      ([s, a, want]: [string, string, string[]]) => {
        const v = document.querySelector(s)?.getAttribute(a);
        return v !== null && v !== undefined && want.includes(v);
      },
      [sel, attr, [...accept]] as [string, string, string[]],
      { timeout },
    );
  } catch (cause) {
    // 🔴 «Не вдалось прочитати» і «атрибута немає» — ДВА РІЗНІ факти, і
    // плутати їх не можна. Заміряно: при закритій сторінці читання
    // відхиляється, і якби обидва випадки давали одну фразу, звіт радив
    // би «перевір назву атрибута» там, де атрибут був на місці.
    let seen: string | null = null;
    let unread = false;
    try {
      seen = await page.getAttribute(sel, attr, { timeout: 1_000 });
    } catch {
      unread = true;
    }
    const says = unread
      ? 'прочитати не вдалось (сторінку або контекст закрито?)'
      : seen === null
        ? 'НІЧОГО (вузла або атрибута немає — перевір назву)'
        : `«${seen}»`;
    const original = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `${what}: не дійшло до стану [${accept.join(', ')}]. ` +
        `${attr} показує ${says}. Початкова помилка: ${original}`,
      { cause },
    );
  }
}

/** Чекати, поки мапа ПРИЙДЕ в один із названих станів. */
export async function waitForMapState(
  page: Page,
  accept: readonly MapState[] = MAP_DRAWN,
  timeout = 20_000,
): Promise<void> {
  await waitForState(page, MAP, 'data-map-state', accept, timeout, 'мапа');
}

/**
 * Чекати, поки нотатка про пожежі перестане казати «завантажується».
 *
 * 🔴 ЧОМУ ОКРЕМО ВІД МАПИ. `data-map-state` описує ТІЛЬКИ
 * `/data/spots/*`. Нотатка живиться `/data/wildfires.json` і має власний
 * видимий стан `loading` із власним текстом. `networkidle`, який я
 * прибрав, покривав і її — тож без цього чекання я прибрав один таймер
 * і лишив гонку в повносторінковому знімку. Заміряно рецензією #313.
 */
export async function waitForWildfireNote(
  page: Page,
  timeout = 20_000,
): Promise<void> {
  await waitForState(
    page,
    NOTE,
    'data-state',
    NOTE_SETTLED,
    timeout,
    'нотатка про пожежі',
  );
}
