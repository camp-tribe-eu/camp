// CAMP-205 — /plan: форма планувальника і все, що вона знає про себе.
// CAMP-391 — і відповідь, яку вона вміє прочитати.
//
// 🔴 ЦЕЙ ФАЙЛ НЕ ЗНАЄ, ЗВІДКИ БЕРЕТЬСЯ МАРШРУТ. Це і є відповідь на
// «коли алгоритм зʼявиться, підмінюється лише джерело даних».
//
// Три шари, і в кожного одна робота:
//
//   plan-source.ts        ЄДИНЕ місце, яке вміє рахувати: питає API.
//                         Приймає `PlanRequest`, повертає `PlanOutcome`,
//                         і читає відповідь мережі так, наче вона бреше.
//   plan.ts (цей файл)    перевірка того, що ввела людина; типи відповіді;
//                         стан форми; `settle` — обгортка, що не дає
//                         джерелу зламати сторінку. Джерела не імпортує.
//   plan-view.tsx         малює стани. Знає лише тип `PlanOutcome`.
//
// Компілятор зупиняє збірку в `PlanOutcomePanel`, доки новий варіант
// відповіді не намальовано, — див. `never` там. Нічого з цього не треба
// пам'ятати: це не обіцянка, це помилка типів.
//
// 🔴 ЩО ФОРМА ЗНАЄ ПРО МІСЦЯ, І ЦЕ МЕЖА, А НЕ НЕДОГЛЯД. Алгоритм працює з
// координатами, а перетворювача «назва → координати» в коді немає (газетир
// із docs/trip-planner-design.md, крок 3, не зроблено, і «Munich» проти
// «München» там окрема проблема: `osm_ctx_place` не має `name:en`). Тому
// поля «звідки» й «куди» приймають «широта, довгота», і підказка під ними
// каже прямо, що назви не шукаються. Назва, яку форма «прийняла» б, не
// знаючи, де це, була б зупинкою в іншому місці.
//
// 🔴 ЩО ФОРМА НЕ ПИТАЄ: транспорт. Алгоритм його не читає (даних про
// розміри майданчиків немає, CAMP-247), і поле, яке нічого не міняє,
// обіцяло б план «під ваш кемпер». API відмовляє на запит із `vehicleId`,
// так само суворо, як форма його не питає.

/** Скільки днів дозволяє форма. Той самий ліміт, що в API (`MAX_DAYS` в itinerary.ts), і тест звіряє обидва. */
export const MAX_DAYS = 60;

/** Те, що людина ввела, — рядки як є. */
export interface PlanDraft {
  from: string;
  to: string;
  days: string;
}

/** Де почати чи де закінчити, у градусах. Іменовані, а не парою: пара не каже, що перше. */
export interface PlanPoint {
  lat: number;
  lon: number;
}

/** Те, що пройшло перевірку. Єдине, що отримує джерело. */
export interface PlanRequest {
  from: PlanPoint;
  to: PlanPoint;
  days: number;
}

export type PlanField = keyof PlanDraft;

/** Порядок полів на екрані. Підсумок помилок іде в ньому ж, а не в порядку перевірки. */
export const FIELD_ORDER: readonly PlanField[] = ['from', 'to', 'days'];

export type PlanErrors = Partial<Record<PlanField, string>>;

export const EMPTY_DRAFT: PlanDraft = { from: '', to: '', days: '' };

export type Checked =
  | { ok: true; request: PlanRequest }
  | { ok: false; errors: PlanErrors };

export type ParsedPoint =
  | { ok: true; point: PlanPoint }
  | { ok: false; why: 'empty' | 'format' | 'range' };

const NUMBER = '[+-]?\\d+(?:\\.\\d+)?';
const PAIR = new RegExp(`^(${NUMBER})(?:\\s*[,;]\\s*|\\s+)(${NUMBER})$`);

/**
 * «46.0569, 14.5058» → точка. Широта перша, як у кожній мапі, звідки це
 * копіюють.
 *
 * 🔴 ЩО ПРИЙМАЄТЬСЯ, і кожна поблажка має тест: кома, крапка з комою чи
 * пробіл між числами; знак градуса біля числа й «−» (U+2212), якими
 * мапи-застосунки копіюють координати. Що НЕ приймається: кома як
 * десятковий роздільник («46,0569 14,5058» — два числа чи чотири?), і
 * будь-що, що не два числа. Відмова з поясненням краща за вгадування,
 * яке одного дня поставить Бледу в Ефіопію.
 */
export function parsePoint(text: string): ParsedPoint {
  const t = text.replace(/\u2212/g, '-').replace(/°/g, '').trim();
  if (t === '') return { ok: false, why: 'empty' };
  const m = PAIR.exec(t);
  if (!m) return { ok: false, why: 'format' };
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, why: 'range' };
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { ok: false, why: 'range' };
  return { ok: true, point: { lat, lon } };
}

/** Приклад у підказці й у повідомленні: Любляна і Спліт. Справжні координати, не «XX.XXXX». */
export const EXAMPLE: Record<'from' | 'to', string> = {
  from: '46.0569, 14.5058',
  to: '43.5081, 16.4402',
};

const WHERE: Record<'from' | 'to', string> = {
  from: 'where the trip starts',
  to: 'where the trip ends',
};

/**
 * Чи годиться те, що ввели.
 *
 * 🔴 Повідомлення кажуть, що не так і як виправити, а не «invalid».
 * Читач із екранним читачем почує саме цей рядок, коли встане на поле.
 *
 * 🔴 «Звідки» дорівнює «куди» — не помилка: коло навколо одного місця це
 * справжній маршрут, а відмовити в ньому означало б вигадати правило.
 * (Планувальник відповість на таке сам: «кола він не планує», і це його
 * відповідь, а не помилка форми.)
 *
 * 🔴 Чи точка в ЄС-27, форма не знає й не вгадує: це знає лише сервер, у
 * якого є межі країн, і його відмова приходить як `outside-union`.
 */
export function checkDraft(draft: PlanDraft): Checked {
  const errors: PlanErrors = {};
  const points: Partial<Record<'from' | 'to', PlanPoint>> = {};

  for (const field of ['from', 'to'] as const) {
    const r = parsePoint(draft[field]);
    if (r.ok) points[field] = r.point;
    else if (r.why === 'empty') {
      errors[field] = `Enter ${WHERE[field]}, as latitude and longitude, for example ${EXAMPLE[field]}.`;
    } else if (r.why === 'format') {
      errors[field] =
        `Write ${WHERE[field]} as two numbers, latitude then longitude, for example ${EXAMPLE[field]}. ` +
        'A place name is not looked up.';
    } else {
      errors[field] =
        'Latitude goes from -90 to 90 and longitude from -180 to 180. Latitude comes first.';
    }
  }

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

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, request: { from: points.from!, to: points.to!, days } };
}

// ── Що джерело може відповісти ─────────────────────────────────────────

/** Чому цей кемпінг, словами сервера: поле, значення, одиниця, і чи ранжування це зважило. */
export interface PlannedReason {
  field: string;
  value: string | number;
  unit: 'm' | 'stars' | null;
  /** Чи зважив це бал. Лише `true` можна називати тим, ЗА ЩО обрано; решта — «також поруч». */
  weighed: boolean;
  /** Речення, зібране сервером із трьох попередніх. */
  text: string;
}

/** Хто дав запис і коли: дві речі, яких вимагає ліцензія поруч із записом. */
export interface PlannedSource {
  id: string;
  updatedAt: string;
}

export interface PlannedNight {
  slug: string;
  /** `null` — у записі немає назви. Сторінка так і каже, а не вигадує. */
  name: string | null;
  /** Код країни, як у джерелі. */
  country: string;
  /** Сторінка кемпінгу на цьому сайті; `null` — посилатись нема на що. */
  path: string | null;
  /** Метри по ПРЯМІЙ від A вздовж лінії A→B. */
  alongM: number;
  /** Метри по прямій убік від лінії. */
  offsetM: number;
  /** Де цей день мав закінчитись: метри від A вздовж лінії. */
  targetAlongM: number;
  /** Пряма від тієї точки до кемпінгу — найбільший доданок ранжування. */
  fromTargetM: number;
  /** Лише записане: `yes` чи `no`. Немає ключа — не записано (а не «немає»). */
  amenities: Record<string, 'yes' | 'no'>;
  stars: number | null;
  reasons: PlannedReason[];
  sources: PlannedSource[];
}

export interface PlannedDay {
  /** 1..D. */
  day: number;
  /** Метри по прямій за цей день. НЕ дорога й не час. */
  runM: number;
  /** Де день закінчується; `null` в останнього — він закінчується в точці Б. */
  night: PlannedNight | null;
}

export interface RankingTerm {
  id: string;
  /** 0..1; доданки в сумі дають 1. */
  weight: number;
}

/**
 * План. Усі метри в ньому — по прямій між точками, і тип це каже: `measure`
 * лише `'straight'`. Дороги в ньому немає, бо її немає в API (немає
 * маршрутизатора), а годин за кермом немає й поготів. Коли API скаже
 * `road`, `readPlan` відмовить, поки хтось не навчить сторінку читати це
 * слово, — а не намалює шосе пряму лінію.
 */
export interface PlannedTrip {
  /** A→B по прямій, метри. */
  lengthM: number;
  /** Скільки кемпінгів лежало в коридорі: з чого обирали ночівлі. */
  candidates: number;
  /** За чим ранжувалось, і скільки кожне. Береться з відповіді, а не з цього файла. */
  ranking: RankingTerm[];
  days: PlannedDay[];
}

/**
 * Відповіді джерела.
 *
 * 🔴 `planned` — план. `refused` — планувальник ВІДПОВІВ, що плану немає:
 * кемпінги не ланцюжаться вздовж коридору (відкрита вода) або «звідки»
 * дорівнює «куди». Це не збій: збій — `failed`, і сторінка не має права
 * сказати про відповідь «планувальник не відповів».
 * `outside-union` — сервер відмовив у точці поза ЄС-27. `throttled` — ліміт
 * частоти. `failed` — джерело впало, не відповіло, чи повернуло щось не те.
 *
 * Додаючи сюди варіант, додай його й у `OUTCOME_STATUSES` нижче (тип
 * `Record` не дасть забути) і в `PlanOutcomePanel`.
 */
export type PlanOutcome =
  | { status: 'planned'; plan: PlannedTrip }
  | {
      status: 'refused';
      reason: 'no-chain';
      lengthM: number;
      daysAsked: number;
      candidates: number;
      /** Скільки ночівель вдалось поставити від A, поки ланцюжок не урвався. */
      reachedNights: number;
    }
  | { status: 'refused'; reason: 'round-trip' }
  | { status: 'outside-union'; fields: Array<'from' | 'to'> }
  | { status: 'throttled' }
  | { status: 'failed' };

/** Усі статуси — по одному разу, й перелік повний за побудовою. */
const OUTCOME_STATUSES: Record<PlanOutcome['status'], true> = {
  planned: true,
  refused: true,
  'outside-union': true,
  throttled: true,
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
 * ⚠️ Помилка читачеві показується, але нікуди не звітується: звітування
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
