import { AmenityValue, type AmenityKey } from '../osm/tag-mapping';

/**
 * Що підтверджений власник кемпінгу має право виправити. CAMP-51, CAMP-86.
 *
 * 🔴 ЦЕЙ ПЕРЕЛІК МУСИТЬ ДОРІВНЮВАТИ ТОМУ, ЩО СТОРІНКА ЧИТАЄ.
 *
 * `withOwnerOverrides()` в `apps/web/src/lib/api.ts` зливає поверх OSM
 * рівно `name` і `amenities`. Дозволити записати щось понад це означає
 * дати власникові правити поле, якого сторінка не показує: він
 * виправить, побачить, що нічого не змінилось, і вирішить, що помилився
 * сам. Мовчазна робота в нікуди — найгірший вид зламаного.
 *
 * Тому список один, він експортується, і тест читає ОБИДВА боки й падає,
 * якщо вони розійшлись.
 */
export const WRITABLE = Object.freeze(['name', 'amenities', 'hookup'] as const);

/**
 * CAMP-503: the pitch's mains hookup — what a CAMPER plugs into. OSM has none
 * of these on a campsite, so they start EMPTY and only the owner fills them.
 * 🔴 Not EV charging: that is a public charger for electric cars, found by
 * distance (camp-services.ts), and nothing here describes it.
 */
export const HOOKUP_FIELDS = Object.freeze({
  voltageV: { min: 100, max: 480, whole: true },
  powerKw: { min: 0.1, max: 50, whole: false },
  priceEurPerNight: { min: 0, max: 100, whole: false },
} as const);
export type HookupKey = keyof typeof HOOKUP_FIELDS;
export const HOOKUP_KEYS = Object.freeze(
  Object.keys(HOOKUP_FIELDS) as HookupKey[],
);

export const AMENITY_KEYS = Object.freeze([
  'electricity',
  'water',
  'shower',
  'toilets',
  'dogFriendly',
  'wifi',
  'greyWater',
  'laundry',
  'wheelchair',
  'wheelchairFull',
] as const satisfies readonly AmenityKey[]);

const VALUES: readonly string[] = Object.values(AmenityValue);

/** Назва кемпінгу — рядок, який читає людина, а не поле для розмітки. */
export const MAX_NAME = 120;

export type OverridePatch = {
  name?: string | null;
  amenities?: Partial<Record<AmenityKey, string | null>> | null;
  hookup?: Partial<Record<HookupKey, number | null>> | null;
};

/**
 * Усі претензії до правки, або порожній масив.
 *
 * 🔴 ЗАЙВЕ ПОЛЕ — ЦЕ ВІДМОВА, А НЕ ТИХЕ ІГНОРУВАННЯ. Той самий вибір, що
 * у «Report a problem»: мовчки викинуте поле виглядає для того, хто його
 * надіслав, точно як збережене.
 */
export function faults(patch: unknown): string[] {
  const out: string[] = [];
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return ['правка має бути об’єктом'];
  }
  const p = patch as Record<string, unknown>;
  const keys = Object.keys(p);
  if (keys.length === 0) out.push('порожня правка — нема чого зберігати');
  for (const k of keys) {
    if (!(WRITABLE as readonly string[]).includes(k)) {
      out.push(`поле «${k}» власник не редагує — сторінка його не показує`);
    }
  }
  if ('name' in p && p.name !== null) {
    if (typeof p.name !== 'string') out.push('name має бути рядком або null');
    else {
      const name = p.name.trim();
      if (name === '')
        out.push('name порожній — щоб прибрати правку, надішли null');
      else if (name.length > MAX_NAME)
        out.push(`name довший за ${MAX_NAME} символів`);
      // 🔴 Назва їде на сторінку й у JSON-LD. Кутові дужки тут не
      // екранування вирішує, а те, що назви кемпінгів їх не містять.
      else if (/[<>]/.test(name)) out.push('name містить < або >');
    }
  }
  if ('amenities' in p && p.amenities !== null) {
    const a = p.amenities;
    if (a === null || typeof a !== 'object' || Array.isArray(a)) {
      out.push('amenities має бути об’єктом або null');
    } else {
      const am = a as Record<string, unknown>;
      const names = Object.keys(am);
      if (names.length === 0)
        out.push('amenities порожні — надішли null, щоб прибрати');
      for (const k of names) {
        if (!(AMENITY_KEYS as readonly string[]).includes(k)) {
          out.push(`зручності «${k}» не існує`);
          continue;
        }
        const v = am[k];
        if (v === null) continue;
        if (typeof v !== 'string' || !VALUES.includes(v)) {
          out.push(`«${k}»: ${String(v)} — має бути yes, no, unknown або null`);
        }
      }
    }
  }
  if ('hookup' in p && p.hookup !== null) {
    const h = p.hookup;
    if (h === null || typeof h !== 'object' || Array.isArray(h)) {
      out.push('hookup має бути об’єктом або null');
    } else {
      const hm = h as Record<string, unknown>;
      const names = Object.keys(hm);
      if (names.length === 0)
        out.push('hookup порожній — надішли null, щоб прибрати');
      for (const k of names) {
        if (!(HOOKUP_KEYS as readonly string[]).includes(k)) {
          out.push(`hookup: поля «${k}» не існує`);
          continue;
        }
        const v = hm[k];
        if (v === null) continue;
        const f = HOOKUP_FIELDS[k as HookupKey];
        if (
          typeof v !== 'number' ||
          !Number.isFinite(v) ||
          v < f.min ||
          v > f.max ||
          (f.whole && !Number.isInteger(v))
        )
          out.push(
            `hookup.${k}: ${String(v)} — число від ${f.min} до ${f.max}${f.whole ? ', ціле' : ''} або null`,
          );
      }
    }
  }
  return out;
}

/**
 * Накласти правку на те, що вже лежить у `owner_overrides`.
 *
 * 🔴 `null` ПРИБИРАЄ ПРАВКУ, А НЕ ЗАПИСУЄ ПОРОЖНЄ. Власник, що помилився,
 * мусить мати спосіб повернути те, що каже OSM, — інакше єдиний вихід із
 * хибної правки це інша хибна правка. Прибрана зручність зникає з
 * об'єкта цілком, а не лишається як `null`: `withOwnerOverrides` зливає
 * об'єкт поверх OSM, і `null` затулив би справжнє значення.
 */
export function merge(
  existing: Record<string, unknown>,
  patch: OverridePatch,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...existing };

  if ('name' in patch) {
    if (patch.name === null) delete next.name;
    else if (typeof patch.name === 'string') next.name = patch.name.trim();
  }

  if ('amenities' in patch) {
    if (patch.amenities === null) {
      delete next.amenities;
    } else {
      const before = (next.amenities ?? {}) as Record<string, unknown>;
      const after: Record<string, unknown> = { ...before };
      // 🔴 ІДЕМО ПО СВОЄМУ ПЕРЕЛІКУ, А НЕ ПО КЛЮЧАХ КОРИСТУВАЧА.
      //
      // CodeQL знайшов тут `js/remote-property-injection`, двічі high, і
      // мав рацію по суті: ім'я властивості, у яку пишемо, походило з
      // тіла запиту. Сьогодні це безпечно лише тому, що `faults()`
      // відкидає все поза `AMENITY_KEYS` — але гарантія жила в
      // ВИКЛИКАЧЕВІ, а не тут. Другий виклик без перевірки — і
      // `__proto__` чи `constructor` приїхали б у `delete`/присвоєння.
      //
      // Тепер ключ може бути лише одним із десяти власних літералів, і
      // функція безпечна сама по собі, а не за домовленістю.
      const given = (patch.amenities ?? {}) as Record<string, unknown>;
      for (const k of AMENITY_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(given, k)) continue;
        if (given[k] === null) delete after[k];
        else after[k] = given[k];
      }
      // Остання прибрана зручність забирає й сам об'єкт: порожній
      // `amenities: {}` нічого не означає й лише плутає читача дампу.
      if (Object.keys(after).length === 0) delete next.amenities;
      else next.amenities = after;
    }
  }

  if ('hookup' in patch) {
    if (patch.hookup === null) {
      delete next.hookup;
    } else {
      // Той самий принцип, що для зручностей: ключі лише зі СВОГО переліку.
      const before = (next.hookup ?? {}) as Record<string, unknown>;
      const after: Record<string, unknown> = { ...before };
      const given = (patch.hookup ?? {}) as Record<string, unknown>;
      for (const k of HOOKUP_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(given, k)) continue;
        if (given[k] === null) delete after[k];
        else after[k] = given[k];
      }
      if (Object.keys(after).length === 0) delete next.hookup;
      else next.hookup = after;
    }
  }

  return next;
}

/**
 * Скільки рядків змінив `UPDATE … RETURNING`, поданий через
 * `DataSource.query`. Та сама функція, що в `spot-claim.ts`, і з тієї ж
 * причини: заміряно, що TypeORM віддає пару `[рядки, кількість]`, а
 * `.length` зовнішнього масиву — це завжди 2.
 */
export { updatedRowCount as updatedRowCountOf } from './spot-claim';
