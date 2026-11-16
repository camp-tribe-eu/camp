// CAMP-205 — /plan: форма планувальника і все, що вона знає про себе.
// CAMP-391 — і відповідь, яку вона вміє прочитати.
// CAMP-456 — назви місць, проміжні точки, зворотний шлях, дані авто.
//
// 🔴 ЦЕЙ ФАЙЛ НЕ ЗНАЄ, ЗВІДКИ БЕРЕТЬСЯ МАРШРУТ. Це і є відповідь на
// «коли алгоритм зʼявиться, підмінюється лише джерело даних».
//
// Три шари, і в кожного одна робота:
//
//   plan-source.ts        ЄДИНЕ місце, яке вміє рахувати: питає API.
//                         Приймає `PlanRequest` (ОДИН перегін між двома
//                         точками), повертає `PlanOutcome`, і читає відповідь
//                         мережі так, наче вона бреше.
//   plan.ts (цей файл)    перевірка того, що ввела людина; типи відповіді;
//                         стан форми; `settle` — обгортка, що не дає
//                         джерелу зламати сторінку; `planTrip` — складає
//                         поїздку з перегонів. Джерела не імпортує.
//   plan-view.tsx         малює стани. Знає лише типи цього файла.
//
// Компілятор зупиняє збірку в `PlanOutcomePanel`, доки новий варіант
// відповіді не намальовано, — див. `never` там.
//
// 🔴 ЯК ПОЇЗДКА З ПРОМІЖНИМИ ТОЧКАМИ СТАЄ ЗАПИТАМИ. Планувальник вміє рівно
// одне: розкласти пряму між двома точками на дні (`POST /plan`). Поїздка
// A → проміжні → B (→ назад до A) — це ЛАНЦЮЖОК таких перегонів, по одному
// запиту на кожен, а дні поїздки розподіляються між ними пропорційно прямій
// довжині (`splitDays`), по одному дню як мінімум. Це не маршрут, який
// «обходить» проміжні точки з урахуванням доріг: доріг немає, і кожен
// перегін — пряма між своїми двома точками. Сторінка каже це словами.
//
// 🔴 ЩО ФОРМА ЗНАЄ ПРО МІСЦЯ. Поле місця приймає ДВІ речі: «широта,
// довгота» (як і було) і назву, ОБРАНУ З ПІДКАЗКИ (`ChosenPlace`: наш
// власний індекс — кемпінги, регіони, населені пункти з бази; зовнішнього
// геокодера немає). Набрана назва, якої не обрано з підказки, не вгадується:
// «Ant» може бути трьома різними місцями в трьох країнах, і форма, що
// вибрала б одне мовчки, поставила б зупинку в іншому місці. Це помилка
// з поясненням, а не здогад.
//
// 🔴 ЩО ФОРМА РОБИТЬ З ДАНИМИ АВТО (висота, довжина, маса, тип): перевіряє,
// ЗБЕРІГАЄ з поїздкою й кладе в посилання — і НЕ ВІДПРАВЛЯЄ планувальнику,
// бо той їх не читає (даних про розміри майданчиків і доріг немає,
// CAMP-247; API відмовляє на поле, якого не читає). Поле, яке нічого не
// міняє, не має обіцяти план «під ваш кемпер»; сторінка прямо каже, що план
// від цих чисел не залежить.

/** Скільки днів дозволяє форма. Той самий ліміт, що в API (`MAX_DAYS` в itinerary.ts), і тест звіряє обидва. */
export const MAX_DAYS = 60;

/** Скільки проміжних точок. Кожен перегін — окремий запит, а ліміт API — десять на хвилину. */
export const MAX_VIA = 5;

/** Види місць, які віддає пошук. */
export type PlaceKind = 'city' | 'town' | 'village' | 'region' | 'campsite';

/** Місце, обране з підказки. `label` — рядок, що стоїть у полі: за ним форма знає, що поле не змінили. */
export interface ChosenPlace {
  kind: PlaceKind;
  name: string;
  /** ISO 3166-1 alpha-2, нижній регістр. */
  country: string;
  lat: number;
  lon: number;
  /** Лише в кемпінгу: за ним `/plan?to=` і сторінка кемпінгу. */
  slug?: string;
  label: string;
}

/** Проміжна точка в чернетці: свій номер, щоб порядок можна було міняти, не гублячи, яке поле яке. */
export interface ViaDraft {
  id: string;
  text: string;
  place: ChosenPlace | null;
}

export const VEHICLE_TYPES = ['motorhome', 'campervan', 'caravan', 'tent'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export interface VehicleDraft {
  type: '' | VehicleType;
  /** Метри. */
  height: string;
  /** Метри. */
  length: string;
  /** Тонни, повна маса. */
  weight: string;
}

/** Те, що людина ввела, — рядки як є. */
export interface PlanDraft {
  from: string;
  to: string;
  days: string;
  fromPlace: ChosenPlace | null;
  toPlace: ChosenPlace | null;
  via: ViaDraft[];
  /** Повернутись до старту: після «куди» додається ще один перегін назад. */
  roundTrip: boolean;
  vehicle: VehicleDraft;
}

/** Де почати чи де закінчити, у градусах. Іменовані, а не парою: пара не каже, що перше. */
export interface PlanPoint {
  lat: number;
  lon: number;
}

/** Один перегін: те, що отримує джерело. Єдине, що отримує джерело. */
export interface PlanRequest {
  from: PlanPoint;
  to: PlanPoint;
  days: number;
}

export type ViaField = `via-${string}`;
export type PlanField = 'from' | 'to' | 'days' | 'height' | 'length' | 'weight' | ViaField;

export const viaField = (id: string): ViaField => `via-${id}`;

/**
 * Порядок полів на екрані: «звідки», проміжні, «куди», дні, габарити.
 * Підсумок помилок іде в ньому ж, а не в порядку перевірки.
 */
export function fieldOrder(draft: Pick<PlanDraft, 'via'>): PlanField[] {
  return [
    'from',
    ...draft.via.map((v) => viaField(v.id)),
    'to',
    'days',
    'height',
    'length',
    'weight',
  ];
}

export type PlanErrors = Partial<Record<PlanField, string>>;

export const EMPTY_VEHICLE: VehicleDraft = { type: '', height: '', length: '', weight: '' };

export const EMPTY_DRAFT: PlanDraft = {
  from: '',
  to: '',
  days: '',
  fromPlace: null,
  toPlace: null,
  via: [],
  roundTrip: false,
  vehicle: EMPTY_VEHICLE,
};

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
  const t = text.replace(/−/g, '-').replace(/°/g, '').trim();
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

/** Рядок у полі, коли місце обрано з підказки: «Antwerpen, Belgium» чи «Camping Bled (campsite), Slovenia». */
export function placeLabel(
  kind: PlaceKind,
  name: string,
  countryName: string,
): string {
  return kind === 'campsite' ? `${name} (campsite), ${countryName}` : `${name}, ${countryName}`;
}

// ── Поїздка: зупинки, перегони, дні ───────────────────────────────────

/** Зупинка, яка пройшла перевірку: підпис для людини й точка для джерела. */
export interface TripStop {
  label: string;
  point: PlanPoint;
}

export interface LegRequest {
  from: TripStop;
  to: TripStop;
  /** Скільки днів із поїздки припадає на цей перегін. Не менше одного. */
  days: number;
  /** Скільки днів ішло до цього перегону: нумерація днів у результаті наскрізна. */
  offset: number;
}

export interface VehicleValues {
  type: VehicleType | null;
  heightM: number | null;
  lengthM: number | null;
  weightT: number | null;
}

/** Те, що пройшло перевірку цілком. */
export interface TripRequest {
  days: number;
  roundTrip: boolean;
  stops: TripStop[];
  legs: LegRequest[];
  vehicle: VehicleValues;
}

export type Checked =
  | { ok: true; trip: TripRequest }
  | { ok: false; errors: PlanErrors };

const EARTH_RADIUS_M = 6_371_008.8;

/** Пряма по великому колу, метри. Лише щоб поділити дні між перегонами, а не щоб щось показувати. */
export function straightM(a: PlanPoint, b: PlanPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Розподілити `total` днів між перегонами за їхньою прямою довжиною: кожному не
 * менше одного дня, решта — пропорційно, залишок — тим, у кого дробова
 * частка найбільша (метод найбільших залишків). Сума завжди рівно `total`.
 *
 * 🔴 `total` менше за кількість перегонів — не здогадка, а помилка вище за
 * течією (`checkDraft`): тут день не можна ні вкрасти в сусіда, ні
 * вигадати.
 */
export function splitDays(total: number, lengthsM: number[]): number[] {
  const n = lengthsM.length;
  if (n === 0) return [];
  if (total < n) throw new Error(`splitDays: ${total} days for ${n} legs`);
  const spare = total - n;
  const sum = lengthsM.reduce((s, m) => s + m, 0);
  // Усі перегони нульові (одна й та сама точка): порівну.
  const weights = sum > 0 ? lengthsM.map((m) => m / sum) : lengthsM.map(() => 1 / n);
  const exact = weights.map((w) => w * spare);
  const out = exact.map((x) => 1 + Math.floor(x));
  let left = total - out.reduce((s, d) => s + d, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) out[order[k].i] += 1;
  return out;
}

const SIZE = {
  height: { min: 1, max: 4.5, unit: 'metres', example: '3.1', label: 'Height' },
  length: { min: 2, max: 18.75, unit: 'metres', example: '7.4', label: 'Length' },
  weight: { min: 0.5, max: 44, unit: 'tonnes', example: '3.5', label: 'Weight' },
} as const;

type SizeField = keyof typeof SIZE;

/**
 * Число з поля габариту. Кома як десятковий роздільник ТУТ приймається («3,5
 * t» — так пишуть у більшості країн ЄС), бо в полі одне число й неоднозначності
 * немає, на відміну від пари координат.
 */
function checkSize(
  field: SizeField,
  raw: string,
): { value: number | null; error?: string } {
  const s = raw.trim();
  if (s === '') return { value: null };
  const spec = SIZE[field];
  const range = `between ${spec.min} and ${spec.max} ${spec.unit}`;
  if (!/^\d+(?:[.,]\d+)?$/.test(s)) {
    return { value: null, error: `${spec.label} is a number in ${spec.unit}, for example ${spec.example}.` };
  }
  const v = Number(s.replace(',', '.'));
  if (!Number.isFinite(v) || v < spec.min || v > spec.max) {
    return { value: null, error: `${spec.label} must be ${range}.` };
  }
  return { value: v };
}

const WHERE: Record<'from' | 'to', string> = {
  from: 'where the trip starts',
  to: 'where the trip ends',
};

type StopCheck = { ok: true; stop: TripStop } | { ok: false; error: string };

/**
 * Одна зупинка: «широта, довгота» як є, або місце, обране з підказки й
 * не змінене після цього.
 *
 * 🔴 Рядок, що не координати й не обране місце, — помилка з поясненням, а не
 * пошук «що ближче»: форма не вгадує, яке з трьох «Ant» мала на увазі людина.
 */
function checkStop(text: string, place: ChosenPlace | null, what: string): StopCheck {
  const parsed = parsePoint(text);
  if (parsed.ok) {
    const { lat, lon } = parsed.point;
    return { ok: true, stop: { label: `${lat}, ${lon}`, point: parsed.point } };
  }
  if (parsed.why === 'range') {
    return {
      ok: false,
      error: 'Latitude goes from -90 to 90 and longitude from -180 to 180. Latitude comes first.',
    };
  }
  if (parsed.why === 'empty') {
    return {
      ok: false,
      error: `Enter ${what}: type a place name and pick it from the list, or write latitude and longitude, for example ${EXAMPLE.from}.`,
    };
  }
  if (place && place.label === text.trim()) {
    return { ok: true, stop: { label: place.label, point: { lat: place.lat, lon: place.lon } } };
  }
  return {
    ok: false,
    error:
      `Pick ${what} from the list that appears as you type, or write it as two numbers, ` +
      `latitude then longitude, for example ${EXAMPLE.from}. A name that is not picked from the list is not guessed.`,
  };
}

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
 *
 * 🔴 Днів не менше, ніж перегонів: поїздка з трьох перегонів за два дні
 * означала б перегін без жодного дня. Помилка стоїть на полі днів, бо
 * виправляється там.
 */
export function checkDraft(draft: PlanDraft): Checked {
  const errors: PlanErrors = {};
  const stops: Partial<Record<'from' | 'to', TripStop>> = {};
  const viaStops: TripStop[] = [];

  for (const field of ['from', 'to'] as const) {
    const r = checkStop(draft[field], draft[`${field}Place`], WHERE[field]);
    if (r.ok) stops[field] = r.stop;
    else errors[field] = r.error;
  }
  for (const v of draft.via) {
    const r = checkStop(v.text, v.place, 'this stop');
    if (r.ok) viaStops.push(r.stop);
    else errors[viaField(v.id)] = r.error;
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

  const sizes: Partial<Record<SizeField, number | null>> = {};
  for (const f of ['height', 'length', 'weight'] as const) {
    const r = checkSize(f, draft.vehicle[f]);
    sizes[f] = r.value;
    if (r.error) errors[f] = r.error;
  }

  if (draft.via.length > MAX_VIA) {
    // Недосяжно з екрана (кнопка вимикається), але чернетка може прийти з
    // посилання, і межа тримається тут, а не лише в кнопці.
    errors.to = `A trip can have at most ${MAX_VIA} stops between the start and the destination.`;
  }

  if (Object.keys(errors).length === 0) {
    const all: TripStop[] = [stops.from!, ...viaStops, stops.to!];
    if (draft.roundTrip) all.push(stops.from!);
    const legCount = all.length - 1;
    if (days < legCount) {
      errors.days = `This trip has ${legCount} legs, so it needs at least ${legCount} days: one per leg.`;
    } else {
      const lengths = all.slice(1).map((s, i) => straightM(all[i].point, s.point));
      const per = splitDays(days, lengths);
      let offset = 0;
      const legs: LegRequest[] = per.map((d, i) => {
        const leg = { from: all[i], to: all[i + 1], days: d, offset };
        offset += d;
        return leg;
      });
      return {
        ok: true,
        trip: {
          days,
          roundTrip: draft.roundTrip,
          stops: all,
          legs,
          vehicle: {
            type: draft.vehicle.type === '' ? null : draft.vehicle.type,
            heightM: sizes.height ?? null,
            lengthM: sizes.length ?? null,
            weightT: sizes.weight ?? null,
          },
        },
      };
    }
  }
  return { ok: false, errors };
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


// ── Поїздка з перегонів ───────────────────────────────────────────────

/** Відповідь джерела на один перегін, разом із перегоном, на який вона відповідь. */
export interface LegResult {
  leg: LegRequest;
  outcome: PlanOutcome;
}

/**
 * Опитати джерело про кожен перегін. Паралельно: перегони не залежать один
 * від одного (кожен — своя пара точок), а чекати їх по черзі означало б
 * додати секунди там, де людина вже чекає. Кожен проходить через `settle`, тож
 * один зіпсований перегін коштує одного перегону, а не всієї поїздки.
 */
export async function planTrip(planner: Planner, trip: TripRequest): Promise<LegResult[]> {
  return Promise.all(
    trip.legs.map(async (leg) => ({
      leg,
      outcome: await settle(planner, { from: leg.from.point, to: leg.to.point, days: leg.days }),
    })),
  );
}

// ── Стан сторінки ─────────────────────────────────────────────────────

export type PlanRun =
  | { phase: 'idle' }
  | { phase: 'pending'; id: number; request: TripRequest }
  | { phase: 'done'; id: number; request: TripRequest; legs: LegResult[] };

export interface PlanState {
  draft: PlanDraft;
  errors: PlanErrors;
  /** Скільки спроб відправити не пройшло перевірку. За цим числом сторінка вирішує, що пора перенести фокус. */
  rejected: number;
  /** Наступний номер запиту. Росте завжди, тож двох запитів з одним номером не буває. */
  nextId: number;
  /** Наступний номер проміжної точки. Росте завжди: видалена точка не віддає свій номер новій. */
  nextVia: number;
  run: PlanRun;
}

export type TextField = 'from' | 'to' | 'days' | 'height' | 'length' | 'weight' | ViaField;

export type PlanAction =
  | { type: 'edit'; field: TextField; value: string }
  | { type: 'pick'; field: 'from' | 'to' | ViaField; place: ChosenPlace }
  | { type: 'vehicle-type'; value: '' | VehicleType }
  | { type: 'round-trip'; value: boolean }
  | { type: 'add-via' }
  | { type: 'remove-via'; id: string }
  | { type: 'move-via'; id: string; to: number }
  | { type: 'load'; draft: PlanDraft }
  | { type: 'validate' }
  | { type: 'submit' }
  | { type: 'settled'; id: number; legs: LegResult[] };

export const initialState = (): PlanState => ({
  draft: EMPTY_DRAFT,
  errors: {},
  rejected: 0,
  nextId: 1,
  nextVia: 1,
  run: { phase: 'idle' },
});

const isVia = (f: PlanField): f is ViaField => f.startsWith('via-');

/** Зміна чернетки: результат зникає, а помилки названих полів — разом із ним. */
function changed(state: PlanState, draft: PlanDraft, clear: PlanField[]): PlanState {
  // Помилка того поля, яке виправляють, зникає: `aria-invalid` на
  // полі з правильним значенням — це неправда для екранного читача.
  const errors = { ...state.errors };
  for (const f of clear) delete errors[f];
  return { ...state, draft, errors, run: { phase: 'idle' } };
}

/**
 * 🔴 Чисте перетворення, без запитів і без DOM — щоб правила нижче можна
 * було зламати й побачити, що тест червоніє.
 *
 * Три правила, кожне — про момент, коли джерело стане справжнім (зараз
 * воно відповідає миттєво, і жодне з них не видно):
 *
 *   1. Змінив що завгодно в чернетці — результат зникає. Панель праворуч
 *      ніколи не описує запит, відмінний від того, що зараз у формі.
 *   2. Відповідь на запит, якого вже немає, відкидається. Пізня
 *      відповідь на старий запит не затирає нового.
 *   3. Друга відправка, поки перша ще йде, ігнорується. Enter у полі
 *      натискає кнопку навіть тоді, коли кнопку вимкнено.
 */
export function planReducer(state: PlanState, action: PlanAction): PlanState {
  const d = state.draft;
  switch (action.type) {
    case 'edit': {
      const f = action.field;
      if (f === 'from' || f === 'to') {
        // Вписане руками прибирає обране місце: поле з «Antwerpen, Belgium»,
        // у якому змінили літеру, більше не те місце.
        return changed(
          state,
          { ...d, [f]: action.value, [`${f}Place`]: null },
          [f],
        );
      }
      if (f === 'days') return changed(state, { ...d, days: action.value }, [f]);
      if (f === 'height' || f === 'length' || f === 'weight') {
        return changed(state, { ...d, vehicle: { ...d.vehicle, [f]: action.value } }, [f]);
      }
      if (isVia(f)) {
        const id = f.slice(4);
        return changed(
          state,
          { ...d, via: d.via.map((v) => (v.id === id ? { ...v, text: action.value, place: null } : v)) },
          [f],
        );
      }
      return state;
    }
    case 'pick': {
      const f = action.field;
      const text = action.place.label;
      if (f === 'from' || f === 'to') {
        return changed(state, { ...d, [f]: text, [`${f}Place`]: action.place }, [f]);
      }
      const id = f.slice(4);
      return changed(
        state,
        { ...d, via: d.via.map((v) => (v.id === id ? { ...v, text, place: action.place } : v)) },
        [f],
      );
    }
    case 'vehicle-type':
      return changed(state, { ...d, vehicle: { ...d.vehicle, type: action.value } }, []);
    case 'round-trip':
      // Помилка днів («потрібно N днів») залежить від числа перегонів.
      return changed(state, { ...d, roundTrip: action.value }, ['days']);
    case 'add-via': {
      if (d.via.length >= MAX_VIA) return state;
      const via = [...d.via, { id: String(state.nextVia), text: '', place: null }];
      return { ...changed(state, { ...d, via }, ['days']), nextVia: state.nextVia + 1 };
    }
    case 'remove-via': {
      if (!d.via.some((v) => v.id === action.id)) return state;
      return changed(state, { ...d, via: d.via.filter((v) => v.id !== action.id) }, [
        viaField(action.id),
        'days',
      ]);
    }
    case 'move-via': {
      const from = d.via.findIndex((v) => v.id === action.id);
      if (from < 0) return state;
      const to = Math.max(0, Math.min(d.via.length - 1, action.to));
      if (to === from) return state;
      const via = [...d.via];
      const [moved] = via.splice(from, 1);
      via.splice(to, 0, moved);
      return changed(state, { ...d, via }, []);
    }
    case 'load': {
      // Збережена чи отримана за посиланням поїздка замінює чернетку цілком.
      // Лічильник проміжних точок іде за найбільшим номером, що прийшов.
      const top = action.draft.via.reduce((m, v) => Math.max(m, Number(v.id) || 0), 0);
      return {
        ...state,
        draft: action.draft,
        errors: {},
        nextVia: Math.max(state.nextVia, top + 1),
        run: { phase: 'idle' },
      };
    }
    case 'validate': {
      // «Зберегти» й «поділитися» питають те саме, що «Check my trip», але
      // нічого не запитують у джерела: помилки показуються, запиту немає.
      const checked = checkDraft(state.draft);
      if (checked.ok) return { ...state, errors: {} };
      return { ...state, errors: checked.errors, rejected: state.rejected + 1 };
    }
    case 'submit': {
      if (state.run.phase === 'pending') return state;
      const checked = checkDraft(state.draft);
      if (!checked.ok) {
        // `run` тут не чіпається, і чіпати нема чого: чернетка міняється
        // лише через дії вище, які вже скинули `run`, а запит у польоті
        // відсіяно вище. Невдала відправка може прийти лише з `idle`.
        return { ...state, errors: checked.errors, rejected: state.rejected + 1 };
      }
      return {
        ...state,
        errors: {},
        nextId: state.nextId + 1,
        run: { phase: 'pending', id: state.nextId, request: checked.trip },
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
          legs: action.legs,
        },
      };
    }
  }
}
