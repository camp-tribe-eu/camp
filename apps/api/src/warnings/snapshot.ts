// CAMP-302: що саме їде читачеві й що НЕ їде.
//
import { createHash } from 'node:crypto';

// 🔴 ЦЕ ЧИСТИЙ МОДУЛЬ НАВМИСНО. Рішення «віддати без геометрії» і
// «лишити знімку його власний час» — єдине, що тут можна зіпсувати
// тихо, і доводити їх треба без Nest, без мережі й без годинника.

/** Зона попередження, як її віддає `areasOf` у фетчері. */
export interface Area {
  name: string | null;
  codes: string[];
  polygons: string[];
  circles: string[];
}

export interface Warning {
  areas: Area[];
  [key: string]: unknown;
}

/** Знімок, яким відповідає `GET /warnings`. */
export interface Snapshot {
  /**
   * Коли знімок БУЛО ЗНЯТО — не коли його віддали.
   *
   * 🔴 Підміна цього поля часом віддачі перетворила б протерміноване на
   * свіже одним рядком, і `warningState` на клієнті ніколи б не сказав
   * `stale`. Умова ліцензії MeteoAlarm 5.6 — «never longer than ten
   * minutes» — тримається саме цим полем.
   */
  fetchedAt: string | null;
  warnings: Warning[];
}

/**
 * Те саме попередження без жодної геометрії.
 *
 * 🔴 Геометрія не їде клієнтові НІКОЛИ. Заміряно 12.10.2026: полігони й
 * кола це 31.8% файлу, 125 КБ. Спокуса їх дослати є — 59 зон із 392
 * (Латвія, Естонія, Швеція) не мають кодів узагалі, і без полігона їх
 * нічим розмістити. Але це 115 КБ на кожного читача заради 15%
 * випадків, а чесна відповідь для них уже є: `unlocatable` із CAMP-287.
 */
export function withoutGeometry(warnings: readonly Warning[]): Warning[] {
  return warnings.map((w) => ({
    ...w,
    id: typeof w.id === 'string' ? safeId(w.id) : w.id,
    areas: (w.areas ?? []).map((a) => ({
      name: a.name,
      codes: a.codes,
      polygons: [],
      circles: [],
    })),
  }));
}

/**
 * Пара координат у будь-якому тексті.
 *
 * 🔴 Рецензія знайшла геометрію ТАМ, КУДИ Я НЕ ДИВИВСЯ. `id`
 * попередження будується у фетчері як `identifier|<ключ зони>`, а
 * ключем зони стає `codes.join('+') || polygons.join('+')` — тобто для
 * зони БЕЗ кодів у `id` запікається сирий полігон, ще до того, як
 * `withoutGeometry` щось почистить. Заміряно на живих фідах: Швеція
 * 45 155 байт із 55 781 (81%), Естонія 15 048 із 21 638 (69.5%) — це ті
 * самі три країни без кодів, які названі в коментарі вище.
 */
export const COORD_PAIR = /-?\d+\.\d+\s*[, ]\s*-?\d+\.\d+/;

/**
 * `id` без координат, але так само унікальний.
 *
 * Хвіст, що містить координати, замінюється дайджестом: два різні
 * полігони дають два різні `id`, і жодна цифра широти не їде читачеві.
 */
export function safeId(id: string): string {
  if (!COORD_PAIR.test(id)) return id;
  const cut = id.indexOf('|');
  const head = cut === -1 ? '' : id.slice(0, cut);
  const tail = cut === -1 ? id : id.slice(cut + 1);
  const digest = createHash('sha1').update(tail).digest('hex').slice(0, 12);
  return head === '' ? `geo:${digest}` : `${head}|geo:${digest}`;
}

/**
 * Скільки фігур лишилось будь-де у відповіді.
 *
 * 🔴 Існує, щоб перевірка рахувала, а не оглядала. «Я подивився і
 * полігонів не бачив» — це не доказ про 139 попереджень у 392 зонах.
 */
export function countShapes(warnings: readonly Warning[]): number {
  let n = 0;
  for (const w of warnings) {
    for (const a of w.areas ?? []) {
      n += (a.polygons?.length ?? 0) + (a.circles?.length ?? 0);
    }
  }
  return n;
}

/**
 * Скільки пар координат лишилось у ВСЬОМУ, що ми віддаємо.
 *
 * 🔴 `countShapes` виявився перевіркою, яка погоджується сама з собою:
 * він сумує рівно ті два поля, які чистить `withoutGeometry`, і тому
 * повертав нуль, коли 81% тіла відповіді складався з координат у `id`.
 * Ця функція дивиться на СЕРІАЛІЗОВАНУ відповідь — на те саме, що
 * побачить читач, — і не знає, у якому полі шукати.
 */
export function coordinatesIn(payload: unknown): number {
  const text = JSON.stringify(payload) ?? '';
  const all = new RegExp(COORD_PAIR.source, 'g');
  return (text.match(all) ?? []).length;
}

/**
 * Чи знімок іще годиться, щоб його показувати.
 *
 * 🔴 Відповідь тут НЕ вирішує, що побачить читач — це робить
 * `warningState` на клієнті, і дублювати його правило тут було б двома
 * копіями однієї умови. Ця функція потрібна лише службі: щоб вирішити,
 * чи варто скаржитись у лог, коли оновлення не вдається.
 */
export const FRESH_FOR_MINUTES = 10;

export function ageMinutes(snapshot: Snapshot, now: Date): number | null {
  if (snapshot.fetchedAt === null) return null;
  const at = new Date(snapshot.fetchedAt).getTime();
  if (Number.isNaN(at)) return null;
  return (now.getTime() - at) / 60_000;
}

/**
 * Який знімок лишається в памʼяті після оберту оновлювача.
 *
 * 🔴 ЦЕ НАЙНЕБЕЗПЕЧНІШЕ МІСЦЕ ВСІЄЇ КАРТКИ, і я ледь не проґавив його
 * у власному коді. `collect` ставить час ЗАВЖДИ — отже оберт, у якому
 * не відповів ЖОДЕН фід, дав би свіжий і порожній знімок. Панель
 * сказала б читачеві «попереджень немає» там, де вони є, і сказала б
 * це з бездоганно свіжою міткою часу.
 *
 * Правило: повний провал не замінює нічого. Старий знімок лишається зі
 * СВОЇМ часом, старіє, і `warningState` сам скаже `stale` — тобто «ми
 * не знаємо», а не «нічого немає». Різниця між цими двома реченнями і
 * є вся користь шару попереджень.
 *
 * Частковий провал — інша річ: три фіди з 27 мовчать, 24 відповіли, і
 * викинути їхні попередження було б гіршою брехнею.
 */
export function adopt(
  previous: Snapshot,
  fresh: Snapshot,
  {
    countries,
    failed,
    looksBroken = false,
  }: { countries: number; failed: number; looksBroken?: boolean },
): Snapshot {
  // 🔴 `failed >= countries`, І ЦЕ НАВМИСНО ПОКРИВАЄ НУЛЬ.
  //
  // Спершу тут стояло `countries > 0 && failed >= countries`, і той
  // перший доданок благословляв порожній перелік країн: `fresh`
  // публікувався, тобто порожнеча ставала відповіддю. Рецензія це
  // заміряла.
  //
  // 🔴 А потім я додав окремий рядок `if (countries === 0)` — і матриця
  // показала, що він НЕ ЧЕРВОНІЄ НІ ПІД ЧИМ: при нулі країн `0 >= 0`
  // істинне, тож два сторожі прикривали один одного. Надлишковий
  // прибрано, лишився той, який справді говорить.
  if (failed >= countries) return previous;
  // 🔴 І 27 відповідей «200 OK» із тілом, із якого нічого не вийшло, —
  // теж збій, хоч жодна з них не «впала». Детектор для цього вже є у
  // фетчері (`yieldLooksBroken`), і до рецензії він не був згаданий в
  // API жодного разу.
  if (looksBroken) return previous;
  return fresh;
}
