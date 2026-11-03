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
export const WRITABLE = Object.freeze(['name', 'amenities'] as const);

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
      for (const [k, v] of Object.entries(patch.amenities ?? {})) {
        if (v === null) delete after[k];
        else after[k] = v;
      }
      // Остання прибрана зручність забирає й сам об'єкт: порожній
      // `amenities: {}` нічого не означає й лише плутає читача дампу.
      if (Object.keys(after).length === 0) delete next.amenities;
      else next.amenities = after;
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
