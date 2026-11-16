import {
  EMPTY_DRAFT,
  MAX_VIA,
  parsePoint,
  VEHICLE_TYPES,
  type ChosenPlace,
  type PlaceKind,
  type PlanDraft,
  type VehicleType,
} from '@/lib/plan';

// CAMP-456 — збереження поїздки в браузері й посилання «поділитися».
//
// 🔴 ЧИСТІ ФУНКЦІЇ, без `window` і без сховища: тут лише те, що можна зламати
// й побачити, як тест червоніє. Читання/запис у `localStorage` — у
// plan-form.tsx (ключ мусить стояти літералом там, де `.setItem(`: так його
// бачить сторож правових сторінок).
//
// 🔴 ДВА ФОРМАТИ, ОДНА ЧИСТИЛКА. І збережений запис, і посилання — це ТЕКСТ,
// який прийшов ззовні: сховище міг переписати розширення, посилання — будь-хто.
// Обидва проходять крізь `draftFromUnknown`, яка не робить `as PlanDraft`, а
// перебудовує чернетку з перевірених полів. Що не пройшло — відсутнє, а не
// напівправильне.
//
// 🔴 ОДИН ЗІПСОВАНИЙ ЗАПИС КОШТУЄ ОДНОГО ЗАПИСУ. `parseSaved` перевіряє кожну
// збережену поїздку окремо: зіпсована зникає з переліку, решта лишається, а
// скільки зникло — повертається числом, щоб сторінка сказала про це, а не
// мовчала.
//
// 🔴 ПОСИЛАННЯ НЕСЕ СТАН У ФРАГМЕНТІ (`#t=…`), А НЕ В ЗАПИТІ (`?t=…`).
// Фрагмент браузер не відправляє на сервер: ні журнал доступу, ні проксі, ні
// Cloudflare його не бачать. Запит бачили б усі — а в ньому місця, де людина
// планує бути. Те, що в посиланні, бачить лише той, кому воно дістанеться.

/** Версія формату. Підняти, коли форма запису зміниться: старі записи відсіються, а не зламають. */
export const FORMAT = 1;

/** Скільки поїздок тримає браузер. Повне сховище — відмова з поясненням, а не мовчазне витіснення найстарішої. */
export const MAX_SAVED = 10;

const MAX_TEXT = 200;
const MAX_NAME = 60;
/** Найдовше посилання, яке розбирається: п'ять проміжних точок із назвами — близько двох тисяч знаків. */
export const MAX_SHARE = 6000;

const KINDS: readonly PlaceKind[] = ['city', 'town', 'village', 'region', 'campsite'];
const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = MAX_TEXT): string | null =>
  typeof v === 'string' && v.length <= max ? v : null;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function placeFrom(v: unknown): ChosenPlace | null {
  if (!isRec(v)) return null;
  const kind = v.k;
  const name = text(v.n);
  const label = text(v.l);
  const country = text(v.c, 2);
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) return null;
  if (name === null || label === null || country === null || !/^[a-z]{2}$/.test(country)) return null;
  if (!finite(v.la) || !finite(v.lo) || Math.abs(v.la) > 90 || Math.abs(v.lo) > 180) return null;
  const place: ChosenPlace = {
    kind: kind as PlaceKind,
    name,
    country,
    lat: v.la,
    lon: v.lo,
    label,
  };
  if (v.s !== undefined) {
    if (typeof v.s !== 'string' || !SLUG.test(v.s)) return null;
    place.slug = v.s;
  }
  return place;
}

const placeTo = (p: ChosenPlace | null): Rec | null =>
  p
    ? { k: p.kind, n: p.name, l: p.label, c: p.country, la: p.lat, lo: p.lon, ...(p.slug ? { s: p.slug } : {}) }
    : null;

/** Чернетка → простий об'єкт для JSON. Ключі короткі: посилання має лишатись посиланням. */
export function snapshotOf(draft: PlanDraft): Rec {
  return {
    v: FORMAT,
    f: draft.from,
    fp: placeTo(draft.fromPlace),
    t: draft.to,
    tp: placeTo(draft.toPlace),
    via: draft.via.map((x) => ({ t: x.text, p: placeTo(x.place) })),
    d: draft.days,
    rt: draft.roundTrip,
    ve: [draft.vehicle.type, draft.vehicle.height, draft.vehicle.length, draft.vehicle.weight],
  };
}

/**
 * Усе, що прийшло ззовні, → чернетка або `null`. Не кидає.
 *
 * 🔴 Проміжні точки понад `MAX_VIA` — відмова всього, а не обрізання: поїздка
 * з відрізаним кінцем виглядала б повною.
 */
export function draftFromUnknown(raw: unknown): PlanDraft | null {
  if (!isRec(raw) || raw.v !== FORMAT) return null;
  const from = text(raw.f);
  const to = text(raw.t);
  const days = text(raw.d, 10);
  if (from === null || to === null || days === null) return null;
  if (!Array.isArray(raw.via) || raw.via.length > MAX_VIA) return null;
  const via: PlanDraft['via'] = [];
  for (const [i, x] of raw.via.entries()) {
    if (!isRec(x)) return null;
    const t = text(x.t);
    if (t === null) return null;
    via.push({ id: String(i + 1), text: t, place: x.p == null ? null : placeFrom(x.p) });
  }
  if (typeof raw.rt !== 'boolean') return null;
  if (!Array.isArray(raw.ve) || raw.ve.length !== 4) return null;
  const [type, height, length, weight] = raw.ve as unknown[];
  const h = text(height, 10);
  const l = text(length, 10);
  const w = text(weight, 10);
  if (h === null || l === null || w === null) return null;
  if (type !== '' && !(VEHICLE_TYPES as readonly unknown[]).includes(type)) return null;
  return {
    ...EMPTY_DRAFT,
    from,
    to,
    days,
    fromPlace: raw.fp == null ? null : placeFrom(raw.fp),
    toPlace: raw.tp == null ? null : placeFrom(raw.tp),
    via,
    roundTrip: raw.rt,
    vehicle: { type: type as '' | VehicleType, height: h, length: l, weight: w },
  };
}

// ── Посилання ─────────────────────────────────────────────────────────

const b64 = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const unb64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

/** Фрагмент посилання: `t=…`, без `#`. */
export function encodeShare(draft: PlanDraft): string {
  return `t=${b64(JSON.stringify(snapshotOf(draft)))}`;
}

/** Фрагмент (з `#` чи без) → чернетка. Будь-яка помилка — `null`, і довге, і зіпсоване, і чуже. */
export function decodeShare(fragment: string): PlanDraft | null {
  const h = fragment.replace(/^#/, '');
  if (h.length > MAX_SHARE) return null;
  const m = /^t=([A-Za-z0-9_-]+)$/.exec(h);
  if (!m) return null;
  try {
    return draftFromUnknown(JSON.parse(unb64(m[1])));
  } catch {
    return null;
  }
}

// ── Збережені поїздки ─────────────────────────────────────────────────

export interface SavedTrip {
  id: string;
  name: string;
  /** Мілісекунди від епохи. */
  savedAt: number;
  draft: PlanDraft;
}

/**
 * Назва за замовчуванням: «Antwerpen to Bari» — перша частина підпису до коми.
 * Для координат назви немає: «46.0 to 44.0» нічого не каже людині, яка потім
 * шукатиме поїздку в списку, тож це просто «My trip».
 */
export function defaultName(draft: PlanDraft): string {
  const head = (s: string) => s.split(',')[0].replace(/\s*\(campsite\)\s*$/, '').trim();
  const named = (s: string) => s.trim() !== '' && !parsePoint(s).ok;
  const a = head(draft.from);
  const b = head(draft.to);
  const base = named(draft.from) && named(draft.to) ? `${a} to ${b}` : 'My trip';
  return (draft.roundTrip ? `${base} and back` : base).slice(0, MAX_NAME);
}

/** Збережене → перелік. Один зіпсований запис коштує одного запису, і скільки їх було — повертається. */
export function parseSaved(raw: string | null): { trips: SavedTrip[]; dropped: number } {
  if (raw === null) return { trips: [], dropped: 0 };
  let top: unknown;
  try {
    top = JSON.parse(raw);
  } catch {
    // Сховище не JSON: як порожнє, але скільки втрачено — невідомо, а
    // не нуль. Одиниця: «щось було й не прочиталось».
    return { trips: [], dropped: 1 };
  }
  if (!isRec(top) || top.v !== FORMAT || !Array.isArray(top.trips)) return { trips: [], dropped: 1 };
  const trips: SavedTrip[] = [];
  let dropped = 0;
  const ids = new Set<string>();
  for (const x of top.trips) {
    const ok = isRec(x) ? entryFrom(x) : null;
    if (!ok || ids.has(ok.id)) {
      dropped += 1;
      continue;
    }
    ids.add(ok.id);
    trips.push(ok);
  }
  return { trips: trips.slice(0, MAX_SAVED), dropped: dropped + Math.max(0, trips.length - MAX_SAVED) };
}

function entryFrom(x: Rec): SavedTrip | null {
  const id = text(x.id, 40);
  const name = text(x.name, MAX_NAME);
  const draft = draftFromUnknown(x.draft);
  if (!id || id === '' || !name || !finite(x.savedAt) || !draft) return null;
  return { id, name, savedAt: x.savedAt, draft };
}

export function serializeSaved(trips: SavedTrip[]): string {
  return JSON.stringify({
    v: FORMAT,
    trips: trips.map((t) => ({ id: t.id, name: t.name, savedAt: t.savedAt, draft: snapshotOf(t.draft) })),
  });
}

export type SaveResult =
  | { ok: true; trips: SavedTrip[] }
  | { ok: false; reason: 'full' | 'name' };

/** Добавити поїздку першою. Повно — відмова: найстарішу мовчки не витісняємо. */
export function addSaved(
  trips: SavedTrip[],
  name: string,
  draft: PlanDraft,
  now: number,
  id: string,
): SaveResult {
  const clean = name.trim().slice(0, MAX_NAME);
  if (clean === '') return { ok: false, reason: 'name' };
  if (trips.length >= MAX_SAVED) return { ok: false, reason: 'full' };
  return { ok: true, trips: [{ id, name: clean, savedAt: now, draft }, ...trips] };
}

export const removeSaved = (trips: SavedTrip[], id: string): SavedTrip[] =>
  trips.filter((t) => t.id !== id);
