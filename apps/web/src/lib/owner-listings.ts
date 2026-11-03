import { readSession } from '@/lib/session-store';

/**
 * Листинги, які цей акаунт підтвердив, і правки до них. CAMP-51 / CAMP-86.
 *
 * 🔴 ПРАВИТИ МОЖНА РІВНО ТЕ, ЩО СТОРІНКА КЕМПІНГУ ПОКАЗУЄ. Перелік
 * нижче — та сама пара, що її зливає `withOwnerOverrides()` і що її
 * дозволяє API (`WRITABLE` в `apps/api/src/spots/owner-overrides.ts`).
 * Тест `owner-overrides-reach.spec.ts` читає обидва боки й падає, коли
 * вони розійшлись: інакше власник правив би поле, якого ніхто не
 * побачить, і вирішив би, що помилився сам.
 */

export const OWNER_API = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type AmenityValue = 'yes' | 'no' | 'unknown';

/** Порядок, у якому їх читає людина — той самий, що на сторінці кемпінгу. */
export const AMENITY_KEYS = [
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
] as const;

export type AmenityKey = (typeof AMENITY_KEYS)[number];

export const AMENITY_LABEL: Record<AmenityKey, string> = {
  electricity: 'Electricity',
  water: 'Drinking water',
  shower: 'Shower',
  toilets: 'Toilets',
  dogFriendly: 'Dogs allowed',
  wifi: 'Wi-Fi',
  greyWater: 'Grey water disposal',
  laundry: 'Laundry',
  wheelchair: 'Wheelchair access',
  wheelchairFull: 'Step-free access',
};

export type Listing = {
  slug: string;
  name: string | null;
  /**
   * 🔴 Адресу сторінки рахує API, а не ми: вона складається з країни й
   * регіону, яких у `slug` немає. `null` означає, що сторінки НЕМАЄ —
   * кемпінг без регіону її не отримує (CAMP-34), і інтерфейс мусить
   * сказати це словами, а не дати посилання на 404.
   */
  path: string | null;
  overrides: { name?: string; amenities?: Partial<Record<AmenityKey, AmenityValue>> };
};

export type ListingsOutcome =
  | { kind: 'ok'; listings: Listing[] }
  | { kind: 'signed-out' }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

export type EditOutcome =
  | { kind: 'saved'; overrides: Listing['overrides'] }
  | { kind: 'refused'; message: string }
  | { kind: 'signed-out' }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

/**
 * 🔴 «Прибрати правку» — це `null`, а не порожній рядок.
 *
 * Порожній рядок у назві записав би кемпінг без назви; `null` повертає
 * те, що каже OSM. Без цього єдиний вихід із хибної правки — інша
 * хибна правка.
 */
export function namePatch(typed: string, fromOsm: string | null): string | null {
  const value = typed.trim();
  if (value === '') return null;
  // Збіг із OSM — це теж «нема що правити»: зайвий рядок у колонці
  // виглядав би як рішення власника, якого він не ухвалював.
  if (fromOsm !== null && value === fromOsm.trim()) return null;
  return value;
}

/** Чи має сенс надсилати цю правку взагалі. */
export function hasChanges(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).length > 0;
}

async function send(
  path: string,
  init: RequestInit,
  base: string,
  fetchImpl: Fetch,
  storage?: Storage,
): Promise<{ status: number; body: Record<string, unknown> } | 'no-session' | 'no-base' | 'failed'> {
  if (base === '') return 'no-base';
  const session = readSession(storage);
  if (!session) return 'no-session';
  let res: Response;
  try {
    res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${session.token}`,
      },
      credentials: 'omit',
    });
  } catch {
    return 'failed';
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Порожнє тіло — не помилка.
  }
  return { status: res.status, body: (body ?? {}) as Record<string, unknown> };
}

export async function loadListings(
  base: string = OWNER_API,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
  storage?: Storage,
): Promise<ListingsOutcome> {
  const r = await send('/owner/listings', { method: 'GET', cache: 'no-store' }, base, fetchImpl, storage);
  if (r === 'no-base') return { kind: 'unavailable' };
  if (r === 'no-session') return { kind: 'signed-out' };
  if (r === 'failed') return { kind: 'failed' };
  if (r.status === 401) return { kind: 'signed-out' };
  if (r.status !== 200 || !Array.isArray(r.body.listings)) return { kind: 'failed' };
  return { kind: 'ok', listings: r.body.listings as Listing[] };
}

export async function saveListing(
  slug: string,
  patch: Record<string, unknown>,
  base: string = OWNER_API,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
  storage?: Storage,
): Promise<EditOutcome> {
  const r = await send(
    '/owner/listing',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, patch }),
    },
    base,
    fetchImpl,
    storage,
  );
  if (r === 'no-base') return { kind: 'unavailable' };
  if (r === 'no-session') return { kind: 'signed-out' };
  if (r === 'failed') return { kind: 'failed' };
  if (r.status === 401) return { kind: 'signed-out' };
  if (r.status === 200)
    return { kind: 'saved', overrides: (r.body.overrides ?? {}) as Listing['overrides'] };
  const message =
    typeof r.body.message === 'string' && r.body.message !== ''
      ? r.body.message
      : 'That did not save.';
  return { kind: 'refused', message };
}
