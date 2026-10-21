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
export async function waitForMapState(
  page: Page,
  accept: readonly MapState[] = MAP_DRAWN,
  timeout = 20_000,
): Promise<void> {
  await page.waitForSelector(MAP, { timeout });
  await page
    .waitForFunction(
      ([sel, want]: [string, string[]]) => {
        const v = document.querySelector(sel)?.getAttribute('data-map-state');
        return v !== null && v !== undefined && want.includes(v);
      },
      [MAP, [...accept]] as [string, string[]],
      { timeout },
    )
    .catch(async () => {
      const seen = await page
        .getAttribute(MAP, 'data-map-state')
        .catch(() => null);
      throw new Error(
        `мапа не дійшла до стану [${accept.join(', ')}] за ${timeout} мс; ` +
          `атрибут data-map-state показує ${seen === null ? 'НІЧОГО (атрибута немає — перевір назву)' : `«${seen}»`}.`,
      );
    });
}
