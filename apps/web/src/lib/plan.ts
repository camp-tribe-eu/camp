import { VEHICLES } from '@/lib/fuel';

// CAMP-205 — /plan: форма планувальника і все, що вона знає про себе.
//
// 🔴 ЦЕЙ ФАЙЛ НЕ ЗНАЄ, ЗВІДКИ БЕРЕТЬСЯ МАРШРУТ. Це і є відповідь на
// «коли алгоритм зʼявиться, підмінюється лише джерело даних».
//
// Три шари, і в кожного одна робота:
//
//   plan-source.ts        ЄДИНЕ місце, яке вміє (або не вміє) рахувати.
//                         Приймає `PlanRequest`, повертає `PlanOutcome`.
//   plan.ts (цей файл)    перевірка того, що ввела людина; стан форми;
//                         `settle` — обгортка, що не дає джерелу зламати
//                         сторінку. Джерела не імпортує.
//   plan-view.tsx         малює стани. Знає лише тип `PlanOutcome`.
//
// Коли CAMP-46 зробить алгоритм, змінюється plan-source.ts і додається
// варіант у `PlanOutcome`. Компілятор тоді сам зупинить збірку в
// `PlanOutcomePanel`, доки новий варіант не намальовано, — див. `never`
// там. Нічого з цього не треба пам'ятати: це не обіцянка, це помилка
// типів.
//
// 🔴 ЧОГО ТУТ НЕМАЄ, і це не недогляд: варіанта «маршрут знайдено».
// Його форма (зупинки? геометрія? відстані?) — рішення CAMP-46 і
// CAMP-42, а вигадати її зараз означало б намалювати результат, якого
// ніхто не рахує. Порожнє не малюємо.

/** Скільки днів дозволяє форма. Страховка від друкарської помилки, не правило продукту. */
export const MAX_DAYS = 60;

/** Скільки символів у назві місця. Так само — від помилки й від зондування, не від бажання. */
export const MAX_PLACE = 120;

/** Те, що людина ввела, — рядки як є. */
export interface PlanDraft {
  from: string;
  to: string;
  days: string;
  vehicleId: string;
}

/** Те, що пройшло перевірку. Єдине, що отримує джерело. */
export interface PlanRequest {
  from: string;
  to: string;
  days: number;
  vehicleId: string;
}

export type PlanField = keyof PlanDraft;

/** Порядок полів на екрані. Підсумок помилок іде в ньому ж, а не в порядку перевірки. */
export const FIELD_ORDER: readonly PlanField[] = ['from', 'to', 'days', 'vehicleId'];

export type PlanErrors = Partial<Record<PlanField, string>>;

export const EMPTY_DRAFT: PlanDraft = { from: '', to: '', days: '', vehicleId: '' };

export type Checked =
  | { ok: true; request: PlanRequest }
  | { ok: false; errors: PlanErrors };

/**
 * Чи годиться те, що ввели.
 *
 * 🔴 Повідомлення кажуть, що не так і як виправити, а не «invalid».
 * Читач із екранним читачем почує саме цей рядок, коли встане на поле.
 *
 * 🔴 «Звідки» дорівнює «куди» — не помилка: коло навколо одного місця це
 * справжній маршрут, а відмовити в ньому означало б вигадати правило.
 */
export function checkDraft(draft: PlanDraft): Checked {
  const errors: PlanErrors = {};

  const from = draft.from.trim();
  const to = draft.to.trim();
  if (from === '') errors.from = 'Enter where the trip starts.';
  else if (from.length > MAX_PLACE) errors.from = `Use ${MAX_PLACE} characters or fewer.`;
  if (to === '') errors.to = 'Enter where the trip ends.';
  else if (to.length > MAX_PLACE) errors.to = `Use ${MAX_PLACE} characters or fewer.`;

  const rawDays = draft.days.trim();
  let days = 0;
  if (rawDays === '') {
    errors.days = 'Enter how many days the trip lasts.';
  } else if (!/^\d+$/.test(rawDays)) {
    errors.days = 'Use a whole number of days, for example 7.';
  } else {
    days = Number(rawDays);
    if (days < 1 || days > MAX_DAYS) errors.days = `Days must be between 1 and ${MAX_DAYS}.`;
  }

  if (!VEHICLES.some((v) => v.id === draft.vehicleId)) {
    errors.vehicleId = 'Choose your vehicle.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, request: { from, to, days, vehicleId: draft.vehicleId } };
}

// ── Що джерело може відповісти ─────────────────────────────────────────

/**
 * Відповіді джерела.
 *
 * 🔴 `unavailable` — «планувальник ще не рахує маршрути»: сьогоднішня
 * відповідь. `failed` — джерело впало, не відповіло або повернуло щось
 * не те.
 *
 * Додаючи сюди варіант, додай його й у `OUTCOME_STATUSES` нижче (тип
 * `Record` не дасть забути) і в `PlanOutcomePanel`.
 */
export type PlanOutcome = { status: 'unavailable' } | { status: 'failed' };

/** Усі статуси — по одному разу, й перелік повний за побудовою. */
const OUTCOME_STATUSES: Record<PlanOutcome['status'], true> = {
  unavailable: true,
  failed: true,
};

export type Planner = (request: PlanRequest) => Promise<PlanOutcome>;

/**
 * Запитати джерело так, щоб воно не могло зламати сторінку.
 *
 * 🔴 Три способи, якими справжнє джерело відповість не так: кине помилку,
 * відхилить проміс, або поверне те, чого тип не обіцяв (мережа не
 * перевіряє TypeScript). Усі три дають `failed`, а не білу сторінку і не
 * вічне «Checking…».
 *
 * ⚠️ Помилка читачеві показується, але нікуди не звітується: джерела,
 * яке могло б її кинути, сьогодні немає. Коли воно зʼявиться, звітування
 * (CAMP-92) — рішення тієї картки, а не мовчазна властивість цієї.
 */
export async function settle(planner: Planner, request: PlanRequest): Promise<PlanOutcome> {
  try {
    const outcome = await planner(request);
    const status =
      outcome !== null && typeof outcome === 'object'
        ? (outcome as { status?: unknown }).status
        : undefined;
    // 🔴 Через ключі, а не `status in OUTCOME_STATUSES`: `in` пропускає
    // `constructor` і `toString` з прототипу об'єкта.
    if (typeof status === 'string' && Object.keys(OUTCOME_STATUSES).includes(status)) {
      return outcome;
    }
    return { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }
}

// ── Стан сторінки ─────────────────────────────────────────────────────

export type PlanRun =
  | { phase: 'idle' }
  | { phase: 'pending'; id: number; request: PlanRequest }
  | { phase: 'done'; id: number; request: PlanRequest; outcome: PlanOutcome };

export interface PlanState {
  draft: PlanDraft;
  errors: PlanErrors;
  /** Скільки спроб відправити не пройшло перевірку. За цим числом сторінка вирішує, що пора перенести фокус. */
  rejected: number;
  /** Наступний номер запиту. Росте завжди, тож двох запитів з одним номером не буває. */
  nextId: number;
  run: PlanRun;
}

export type PlanAction =
  | { type: 'edit'; field: PlanField; value: string }
  | { type: 'submit' }
  | { type: 'settled'; id: number; outcome: PlanOutcome };

export const initialState = (): PlanState => ({
  draft: EMPTY_DRAFT,
  errors: {},
  rejected: 0,
  nextId: 1,
  run: { phase: 'idle' },
});

/**
 * 🔴 Чисте перетворення, без запитів і без DOM — щоб правила нижче можна
 * було зламати й побачити, що тест червоніє.
 *
 * Три правила, кожне — про момент, коли джерело стане справжнім (зараз
 * воно відповідає миттєво, і жодне з них не видно):
 *
 *   1. Змінив поле — результат зникає. Панель праворуч ніколи не
 *      описує запит, відмінний від того, що зараз у формі.
 *   2. Відповідь на запит, якого вже немає, відкидається. Пізня
 *      відповідь на старий запит не затирає нового.
 *   3. Друга відправка, поки перша ще йде, ігнорується. Enter у полі
 *      натискає кнопку навіть тоді, коли кнопку вимкнено.
 */
export function planReducer(state: PlanState, action: PlanAction): PlanState {
  switch (action.type) {
    case 'edit': {
      // Помилка того поля, яке виправляють, зникає: `aria-invalid` на
      // полі з правильним значенням — це неправда для екранного читача.
      const errors = { ...state.errors };
      delete errors[action.field];
      return {
        ...state,
        draft: { ...state.draft, [action.field]: action.value },
        errors,
        run: { phase: 'idle' },
      };
    }
    case 'submit': {
      if (state.run.phase === 'pending') return state;
      const checked = checkDraft(state.draft);
      if (!checked.ok) {
        // `run` тут не чіпається, і чіпати нема чого: чернетка міняється
        // лише через `edit`, який уже скинув `run`, а запит у польоті
        // відсіяно вище. Невдала відправка може прийти лише з `idle`.
        return { ...state, errors: checked.errors, rejected: state.rejected + 1 };
      }
      return {
        ...state,
        errors: {},
        nextId: state.nextId + 1,
        run: { phase: 'pending', id: state.nextId, request: checked.request },
      };
    }
    case 'settled': {
      if (state.run.phase !== 'pending' || state.run.id !== action.id) return state;
      return {
        ...state,
        run: {
          phase: 'done',
          id: state.run.id,
          request: state.run.request,
          outcome: action.outcome,
        },
      };
    }
  }
}
