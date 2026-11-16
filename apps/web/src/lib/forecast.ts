// CAMP-477 — the seven-day forecast, as the page meets it.
//
// 🔴 THE PAGE CARRIES NO FORECAST IN ITS HTML. These pages are built once
// and read for days; a forecast baked in would be as old as the build. The
// browser asks OUR API (`GET /forecast`, apps/api/src/forecast), which
// reads Open-Meteo's public bucket on AWS and keeps the answer for three
// hours. The reader's browser never contacts Open-Meteo or Amazon: no new
// recipient of the reader's address, so nothing new for the privacy page
// to say. A test reads every network request of a real page and fails on
// either host.
//
// 🔴 NO DATA, NO SECTION. Every way this can fail — no network, a 503, a
// body of the wrong shape, fewer than five usable days — ends in the same
// place: nothing is drawn. Not a frame, not "forecast unavailable", not a
// spinner left turning. A reader sees the section only when there is a
// forecast in it.
//
// 🔴 ONE BAD DAY COSTS ONE DAY. A row that is not a date, a temperature or
// a known sky word is dropped on its own; the other six are shown. Only
// when fewer than `MIN_DAYS` survive is the whole section left out, and
// the same number is the API's (`MIN_DAYS_TO_SHOW`), so the two ends agree
// on what "too few" means.

export const FORECAST_API = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export const CONDITIONS = [
  'clear',
  'partly-cloudy',
  'cloudy',
  'rain',
  'heavy-rain',
  'snow',
] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface ForecastDay {
  /** Local calendar date of the campsite, YYYY-MM-DD. */
  date: string;
  tMax: number;
  tMin: number;
  precipMm: number;
  condition: Condition;
}

export const CONDITION_LABEL: Record<Condition, string> = {
  clear: 'Clear',
  'partly-cloudy': 'Partly cloudy',
  cloudy: 'Cloudy',
  rain: 'Rain',
  'heavy-rain': 'Heavy rain',
  snow: 'Snow',
};

/** Fewer usable days than this and there is no section. */
export const MIN_DAYS = 5;
export const MAX_DAYS = 7;

export const OPEN_METEO_URL = 'https://open-meteo.com/';
export const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/';

export function forecastUrl(
  lat: number,
  lon: number,
  country: string,
  base: string = FORECAST_API,
): string {
  // Six decimals is about a tenth of a metre; the server rounds to a
  // 25 km cell anyway, and a shorter address is a better cache key.
  const q = new URLSearchParams({
    lat: lat.toFixed(3),
    lng: lon.toFixed(3),
    country: country.toLowerCase(),
  });
  return `${base}/forecast?${q.toString()}`;
}

const isDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};
const isNum = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;

function day(x: unknown): ForecastDay | null {
  if (!x || typeof x !== 'object') return null;
  const d = x as Record<string, unknown>;
  if (!isDate(d.date)) return null;
  if (!isNum(d.tMax, -60, 60) || !isNum(d.tMin, -60, 60)) return null;
  if (d.tMin > d.tMax) return null;
  if (!isNum(d.precipMm, 0, 500)) return null;
  if (!CONDITIONS.includes(d.condition as Condition)) return null;
  return {
    date: d.date,
    tMax: d.tMax,
    tMin: d.tMin,
    precipMm: d.precipMm,
    condition: d.condition as Condition,
  };
}

/** The days the API answered with, or null when there is no section to draw. */
export function parseForecast(body: unknown): ForecastDay[] | null {
  const raw = (body as { days?: unknown } | null)?.days;
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const days: ForecastDay[] = [];
  for (const r of raw) {
    const d = day(r);
    if (!d || seen.has(d.date)) continue;
    seen.add(d.date);
    days.push(d);
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  const kept = days.slice(0, MAX_DAYS);
  return kept.length >= MIN_DAYS ? kept : null;
}

/** "Mon 17 Nov" — the weekday of a calendar date, whatever the reader's zone. */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  const rest = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return `${wd} ${rest}`;
}

export const formatMm = (mm: number): string =>
  mm === 0 ? '0 mm' : `${mm.toFixed(1).replace(/\.0$/, '')} mm`;

/** `−3°` with a real minus sign; a value that rounds to zero is `0°`, never `-0°`. */
export const formatDeg = (t: number): string => {
  const r = Math.round(t);
  return `${r < 0 ? '−' : ''}${Math.abs(r)}°`;
};

export interface ForecastWatchDeps {
  fetchImpl: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  /** Absent where the browser has none: then the forecast is asked for at once. */
  observe?: (el: Element, onNear: () => void) => () => void;
}

/**
 * Ask for the forecast when the reader gets near the place it would be,
 * once, and hand the result to `onDays` — `null` for every kind of
 * failure. Returns the cleanup. Out of the component so a test can drive
 * it without a browser; `onDays` is never called after the cleanup.
 */
export function watchForForecast(
  el: Element | null,
  url: string,
  onDays: (days: ForecastDay[] | null) => void,
  deps: ForecastWatchDeps,
): () => void {
  let cancelled = false;
  let stop: (() => void) | null = null;
  const go = () => {
    deps
      .fetchImpl(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled) onDays(parseForecast(body));
      })
      .catch(() => {
        if (!cancelled) onDays(null);
      });
  };
  if (el && deps.observe) stop = deps.observe(el, go);
  else go();
  return () => {
    cancelled = true;
    stop?.();
  };
}
