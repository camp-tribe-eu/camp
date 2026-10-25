import { AMENITY_LABEL } from '@/lib/api';
import type {
  PlanOutcome,
  PlannedDay,
  PlannedNight,
  PlannedReason,
  PlannedSource,
  PlannedTrip,
  Planner,
  PlanRequest,
  RankingTerm,
} from '@/lib/plan';

// CAMP-205 — ЄДИНЕ місце, де планувальник щось рахує.
// CAMP-391 — і тепер воно справді рахує: питає API (`POST /plan`).
//
// 🔴 Форма, її перевірка, її стани й панель про це джерело нічого не
// знають: вони імпортують `planRoute` і віддають йому `PlanRequest`. Це
// те, що обіцяв попередній коментар цього файла, і те, що тут зроблено:
// змінилось тіло однієї функції і тип `PlanOutcome`.
//
// 🔴 ЧИТАЄМО ВІДПОВІДЬ ЯК ТЕ, ЩО МОЖЕ БРЕХАТИ. Мережа не перевіряє
// TypeScript, а API й сайт викочуються окремо (api.ts: «API й сайт
// деплояться окремо»). Тож `readPlan` не робить `as PlannedTrip`: він
// перевіряє кожне поле, яке сторінка намалює, і відповідь, що не збігається
// з обіцяним, — це `failed`, а не напівнамальований план.
//
// Дві різні міри суворості, і обидві навмисні:
//
//   · ЗАПИС, якого бракує чи який зіпсовано (одна причина, одне джерело,
//     посилання, що не годиться як адреса), коштує ЦЬОГО запису: ночівля
//     лишається на місці без посилання, причина просто не малюється.
//   · ФОРМА відповіді, яка не збігається (день без номера, ночівля там, де
//     має бути кінець, `measure`, якого сторінка не вміє читати), коштує
//     відповіді: напівплан із пропущеним днем читався б як маршрут коротший
//     за той, що ми порахували.
//
// 🔴 `measure` ЛИШЕ «straight». Це єдине слово, яким сторінка вміє
// пояснити метри. Коли API скаже `road`, сторінка мусить відмовити, а не
// підписати шосе пряму лінію: розбіжність між тим, що відповідь каже, і що
// сторінка пише, — саме те, чого цей файл не пропускає.
//
// 🔴 ЗАПИТ ЙДЕ ТІЛЬКИ З ТРЬОХ ПОЛІВ, перелічених тут, а не `...request`.
// API відмовляє на поле, якого не читає (`plan-request.ts`), тож поле, яке
// колись додадуть у `PlanRequest` для сторінки, не повинно мовчки поїхати
// на сервер.
//
// 🔴 ПОРОЖНЯ АДРЕСА API — ЦЕ `failed`, І ЗАПИТУ НЕ ВІДБУВАЄТЬСЯ. Так само
// поводяться сторінки акаунта й звітувач помилок (`NEXT_PUBLIC_API_BASE_URL`,
// account.ts): збірка CI її не має, і форма там чесно каже, що планувальник
// не відповів, замість того щоб слати запит на хост, якого немає. CSP
// (`connect-src`) і CORS уже знають цю адресу з тієї ж змінної.

/** Адреса API з боку браузера. Порожня — запит не відбувається. */
export const PLAN_API = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/**
 * Скільки чекати на відповідь, мс.
 *
 * Сервер сам відсікає запит, що тримає базу довше за 10 с (503), тож 20 с —
 * це «сервер мовчить», а не «сервер думає». Без межі «Asking the planner…»
 * тривало б, поки людина не перезавантажить сторінку.
 */
export const PLAN_TIMEOUT_MS = 20_000;

// ── Читання відповіді ──────────────────────────────────────────────────

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/**
 * Адреса сторінки кемпінгу, яку API називає, або `null`.
 *
 * 🔴 Лише наш власний шлях виду `/camping/країна/регіон/слаг`. Відповідь —
 * дані, а не довірена розмітка: `javascript:…` чи чужий хост у `href`
 * були б посиланням, яке веде куди завгодно. Така адреса коштує ночівлі
 * посилання, а не плану.
 */
const CAMPSITE_PATH = /^\/camping\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/;

function readReason(v: unknown): PlannedReason | null {
  if (!isRec(v)) return null;
  const { field, value, unit, weighed, text } = v;
  if (!isStr(field) || field === '') return null;
  if (!(isStr(value) || isNum(value))) return null;
  if (!(unit === null || unit === 'm' || unit === 'stars')) return null;
  if (typeof weighed !== 'boolean') return null;
  if (!isStr(text) || text.trim() === '') return null;
  return { field, value, unit, weighed, text };
}

function readSource(v: unknown): PlannedSource | null {
  if (!isRec(v)) return null;
  return isStr(v.id) && v.id !== '' && isStr(v.updatedAt) && v.updatedAt !== ''
    ? { id: v.id, updatedAt: v.updatedAt }
    : null;
}

const each = <T>(v: unknown, read: (x: unknown) => T | null): T[] =>
  Array.isArray(v) ? v.flatMap((x) => { const r = read(x); return r === null ? [] : [r]; }) : [];

function readNight(v: unknown): PlannedNight | null {
  if (!isRec(v)) return null;
  if (!isStr(v.slug) || v.slug === '') return null;
  if (!isStr(v.country) || !/^[A-Za-z]{2}$/.test(v.country)) return null;
  for (const k of ['lat', 'lon', 'alongM', 'offsetM', 'targetAlongM', 'fromTargetM'] as const) {
    if (!isNum(v[k])) return null;
  }
  const amenities: Record<string, 'yes' | 'no'> = {};
  if (isRec(v.amenities)) {
    for (const key of Object.keys(AMENITY_LABEL)) {
      const a = v.amenities[key];
      if (a === 'yes' || a === 'no') amenities[key] = a;
    }
  }
  const stars = isNum(v.stars) && v.stars >= 1 && v.stars <= 5 ? v.stars : null;
  return {
    slug: v.slug,
    name: isStr(v.name) && v.name.trim() !== '' ? v.name : null,
    country: v.country.toUpperCase(),
    path: isStr(v.path) && CAMPSITE_PATH.test(v.path) ? v.path : null,
    alongM: v.alongM as number,
    offsetM: v.offsetM as number,
    targetAlongM: v.targetAlongM as number,
    fromTargetM: v.fromTargetM as number,
    amenities,
    stars,
    reasons: each(v.reasons, readReason),
    sources: each(v.sources, readSource),
  };
}

function readRanking(v: unknown): RankingTerm[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: RankingTerm[] = [];
  for (const t of v) {
    if (!isRec(t) || !isStr(t.id) || t.id === '' || !isNum(t.weight) || t.weight < 0 || t.weight > 1) {
      return null;
    }
    out.push({ id: t.id, weight: t.weight });
  }
  return out;
}

function readTrip(b: Rec): PlannedTrip | null {
  if (b.measure !== 'straight') return null;
  if (!isNum(b.lengthM) || b.lengthM < 0) return null;
  if (!isNum(b.candidates) || !Number.isInteger(b.candidates) || b.candidates < 0) return null;
  const ranking = readRanking(b.ranking);
  if (!ranking) return null;
  if (!Array.isArray(b.days) || b.days.length === 0) return null;

  const days: PlannedDay[] = [];
  for (let i = 0; i < b.days.length; i++) {
    const d = b.days[i];
    if (!isRec(d) || d.day !== i + 1 || d.measure !== 'straight') return null;
    if (!isNum(d.runM) || d.runM < 0) return null;
    const last = i === b.days.length - 1;
    // Ночівля є в кожного дня, крім останнього, який закінчується в точці Б.
    if (last !== (d.night === null)) return null;
    const night = d.night === null ? null : readNight(d.night);
    if (!last && night === null) return null;
    days.push({ day: i + 1, runM: d.runM, night });
  }
  return { lengthM: b.lengthM, candidates: b.candidates, ranking, days };
}

/**
 * Відповідь API → один зі станів сторінки.
 *
 * 🔴 `status` вирішує все, що він може вирішити, а `code` — лише там, де
 * один статус має два значення (400: поза ЄС чи хиба самої форми). Тіло,
 * що не збігається з очікуваним, не вгадується — це `failed`. Те саме
 * правило, що в account.ts.
 */
export function readPlan(status: number, body: unknown): PlanOutcome {
  const b = isRec(body) ? body : null;

  if (status === 200 && b) {
    if (b.status === 'ok') {
      const plan = readTrip(b);
      return plan ? { status: 'planned', plan } : { status: 'failed' };
    }
    if (b.status === 'unsupported' && b.reason === 'round-trip') {
      return { status: 'refused', reason: 'round-trip' };
    }
    if (
      b.status === 'infeasible' &&
      b.reason === 'no-chain' &&
      b.measure === 'straight' &&
      isNum(b.lengthM) &&
      isNum(b.daysAsked) &&
      isNum(b.candidates) &&
      isNum(b.reachedNights)
    ) {
      return {
        status: 'refused',
        reason: 'no-chain',
        lengthM: b.lengthM,
        daysAsked: b.daysAsked,
        candidates: b.candidates,
        reachedNights: b.reachedNights,
      };
    }
    return { status: 'failed' };
  }

  if (status === 400 && b && b.code === 'invalid_plan_request' && Array.isArray(b.errors)) {
    // Форма перевіряє все, крім межі ЄС, і сама чекає від сервера лише її.
    // Будь-яка інша відмова — це розбіжність форми й сервера, тобто наш
    // дефект, і говорити про неї читачеві «ваша точка поза ЄС» було б брехнею.
    const fields: Array<'from' | 'to'> = [];
    for (const e of b.errors) {
      if (isRec(e) && e.code === 'outside_union' && (e.field === 'from' || e.field === 'to')) {
        if (!fields.includes(e.field)) fields.push(e.field);
      } else {
        return { status: 'failed' };
      }
    }
    return fields.length > 0 ? { status: 'outside-union', fields } : { status: 'failed' };
  }

  if (status === 429) return { status: 'throttled' };
  return { status: 'failed' };
}

// ── Запит ──────────────────────────────────────────────────────────────

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Один POST із JSON. Не кидає: мережа, що впала, і відповідь, що не JSON, —
 * це `failed`. Адреса і `fetch` приходять параметрами, тож усе, що тут
 * вирішується, можна перевірити на ДАНИХ — відповідях, які API справді
 * віддає, — а не на підміненій функції.
 */
export async function callPlan(
  request: PlanRequest,
  base: string = PLAN_API,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
  timeoutMs: number = PLAN_TIMEOUT_MS,
): Promise<PlanOutcome> {
  if (base === '') return { status: 'failed' };
  try {
    const res = await fetchImpl(`${base}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: { lat: request.from.lat, lon: request.from.lon },
        to: { lat: request.to.lat, lon: request.to.lon },
        days: request.days,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* тіло не JSON: його читає `readPlan` як null */
    }
    return readPlan(res.status, body);
  } catch {
    return { status: 'failed' };
  }
}

export const planRoute: Planner = (request) => callPlan(request);
