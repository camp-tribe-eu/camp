import { countryName } from '@/lib/api';
import { placeLabel, type ChosenPlace, type PlaceKind } from '@/lib/plan';

// CAMP-456 — підказки місць і кемпінг за slug: ЄДИНЕ місце, яке питає
// `GET /places/*`. Так само, як plan-source.ts, читає відповідь як ту, що
// може брехати: мережа не перевіряє TypeScript, а API й сайт викочуються
// окремо.
//
// 🔴 ОДИН ЗІПСОВАНИЙ ЗАПИС КОШТУЄ ОДНОГО ЗАПИСУ. Підказка з відсутнім
// полем, координатою поза кулею чи кемпінгом без адреси сторінки просто не
// потрапляє в список; решта лишається. Відповідь, яка не масив, —
// `failed`, а не порожній список: «нічого не знайдено» і «пошук не відповів» —
// різні речі, і сторінка каже їх різними словами.
//
// 🔴 ПОРОЖНЯ АДРЕСА API — `unavailable`, І ЗАПИТУ НЕ ВІДБУВАЄТЬСЯ (так само
// поводиться plan-source.ts): збірка CI її не має, і поле чесно каже, що
// пошуку немає, замість слати запит на хост, якого немає. Назви в такій
// збірці не шукаються, а координати працюють.

export const PLACES_API = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export const MIN_LETTERS = 3;
const TIMEOUT_MS = 8_000;

export type SuggestOutcome =
  | { status: 'found'; places: ChosenPlace[] }
  | { status: 'none' }
  | { status: 'unavailable' }
  | { status: 'failed' };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const KINDS: readonly string[] = ['city', 'town', 'village', 'region', 'campsite'];
const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;

/** Один запис відповіді → місце, або `null`, і лише цей запис пропадає. */
export function readPlace(v: unknown): ChosenPlace | null {
  if (!isRec(v)) return null;
  const { kind, name, country, lat, lon, slug } = v;
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return null;
  if (typeof name !== 'string' || name.trim() === '' || name.length > 200) return null;
  if (typeof country !== 'string' || !/^[a-z]{2}$/.test(country)) return null;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (kind === 'campsite') {
    // Кемпінг без slug не може стати ні `?to=`, ні посиланням на сторінку.
    if (typeof slug !== 'string' || !SLUG.test(slug)) return null;
  }
  const place: ChosenPlace = {
    kind: kind as PlaceKind,
    name,
    country,
    lat,
    lon,
    label: placeLabel(kind as PlaceKind, name, countryName(country)),
  };
  if (kind === 'campsite') place.slug = slug as string;
  return place;
}

export function readSuggestions(status: number, body: unknown): SuggestOutcome {
  if (status !== 200 || !isRec(body) || !Array.isArray(body.items)) return { status: 'failed' };
  const places = body.items.map(readPlace).filter((p): p is ChosenPlace => p !== null);
  return places.length > 0 ? { status: 'found', places } : { status: 'none' };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export async function suggestPlaces(
  query: string,
  signal?: AbortSignal,
  base: string = PLACES_API,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
): Promise<SuggestOutcome> {
  if (base === '') return { status: 'unavailable' };
  try {
    // 🔴 POST з тілом, а не GET із `?q=`: набраний текст — це місце, де людина
    // планує бути, і в адресі він потрапив би в журнал доступу веб-сервера на
    // чотирнадцять днів. Так само, як `POST /plan` (plan-source.ts).
    const res = await fetchImpl(`${base}/places/suggest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: query }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* не JSON: читається як null */
    }
    return readSuggestions(res.status, body);
  } catch {
    return { status: 'failed' };
  }
}

export type CampsiteOutcome =
  | { status: 'found'; place: ChosenPlace }
  | { status: 'unknown' }
  | { status: 'unavailable' }
  | { status: 'failed' };

/** `?to=<slug>`: кемпінг за slug. Недовірений вхід з адресного рядка перевіряється ДО запиту. */
export async function resolveCampsite(
  slug: string,
  base: string = PLACES_API,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
): Promise<CampsiteOutcome> {
  if (!SLUG.test(slug)) return { status: 'unknown' };
  if (base === '') return { status: 'unavailable' };
  try {
    const res = await fetchImpl(`${base}/places/campsite/${encodeURIComponent(slug)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return { status: 'unknown' };
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* не JSON */
    }
    const place = res.status === 200 ? readPlace(body) : null;
    return place && place.kind === 'campsite' ? { status: 'found', place } : { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }
}
