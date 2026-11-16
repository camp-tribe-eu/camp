// CAMP-477 — a seven-day forecast for a campsite, read from Open-Meteo's
// PUBLIC BUCKET on AWS Open Data, never from api.open-meteo.com.
//
// 🔴 WHY THE BUCKET AND NOT THE API. The free API is for non-commercial
// use and this site carries affiliate links. The bucket is CC BY 4.0, and
// Open-Meteo confirmed in writing (Ticket#235498, 10.11.2026) that it may
// be used commercially. There is not one call to *.open-meteo.com in this
// feature; `bucket.ts` is the only file that touches the network and it
// names a single host, openmeteo.s3.amazonaws.com. CAMP-484 moved the
// elevation reads to the same bucket for the same reason.
//
// 🔴 WHY ecmwf_ifs025. Read from the bucket's README on 16.11.2026:
//
//   model          region  step     horizon  updates
//   ecmwf_ifs025   Global  3-hourly 15 days  every 6 h      <- chosen
//   ecmwf_aifs025  Global  6-hourly 15 days  every 6 h      (AI model, coarser step)
//   dwd_icon       Global  hourly   7.5 days every 6 h      (7.5 d is too close to 7)
//   ncep_gfs025    Global  hourly   16 days  every 6 h      (US model, weaker over Europe)
//   dwd_icon_eu    Europe  hourly   5 days                  (short of 7 days)
//   meteofrance_arpege_europe 4 days, metno_nordic_pp 2.5 days: short.
//
// EU-27 spans Madeira to Cyprus and Malta to Finland, so the model must be
// global or cover Europe whole, AND reach seven days. Of the models that
// do, ECMWF's IFS is the one built for the medium range over Europe; its
// licence is CC BY 4.0 as well (open-meteo.com/en/licence, read 16.11.2026),
// and it has a stored daily-extreme pair (`temperature_2m_max/min`) so the
// maximum is not read off a 3-hourly sample. The cost is a 0.25 degree
// grid, about 25 km: this is a forecast for the area, and the page says so.
//
// 🔴 THE LAYOUT, MEASURED, NOT ASSUMED (curl on 16.11.2026):
//
//   https://openmeteo.s3.amazonaws.com/data/ecmwf_ifs025/static/meta.json
//   https://openmeteo.s3.amazonaws.com/data/ecmwf_ifs025/<variable>/chunk_<N>.om
//
//   meta.json: chunk_time_length 104 steps, temporal_resolution_seconds
//   10800, update_interval_seconds 21600, data_end_time, and
//   last_run_initialisation_time.
//   A chunk holds 104 steps = 13 days, so N = floor(t / (104 * 10800)).
//   Dimensions [721, 1440, 104] = [latitude, longitude, time]; latitude
//   runs -90..90 and longitude -180..179.75, both in 0.25 degree steps.
//   Step i of chunk N is at time (N * 104 + i) * 10800 seconds.
//
// 🔴 WHAT THE NUMBERS MEAN, and what this file does about it.
//
//   · Temperature is 3-hourly. The daily maximum is the largest of the
//     3-hourly values for that local day AND of the stored
//     `temperature_2m_max` intervals whose middle falls in it (the minimum
//     likewise): the stored extremes cover the three hours before their
//     stamp, as the rain does.
//   · Precipitation at a step is the amount that fell in the three hours
//     BEFORE its stamp (Open-Meteo's convention for accumulations). The
//     steps sit on UTC multiples of three hours, so in most of the EU a
//     local midnight falls INSIDE a step (Paris midnight is 23:00 UTC).
//     A step is given to the local day that holds the MIDDLE of the three
//     hours it covers, which is the best a 3-hourly series can do: the
//     error is at most an hour and a half of rain at each end of a day.
//   · A "day" is a LOCAL day. A UTC day would put a Finnish evening in the
//     next day's row and an Iberian night in the previous one. The zone
//     comes from the country (one zone for 25 of 27), with the two island
//     exceptions that are in the EU: the Canaries and the Azores.
//   · The word for the sky ("Clear", "Rain" ...) is OURS, derived from
//     cloud cover and precipitation with the thresholds below. The bucket
//     stores no weather code (it is computed by the API, which we do not
//     call). The thresholds are a choice, not a standard.

export const MODEL = 'ecmwf_ifs025';
export const BUCKET_ORIGIN = 'https://openmeteo.s3.amazonaws.com';
export const BUCKET_DATA = `${BUCKET_ORIGIN}/data/${MODEL}`;

/** The variables read, and nothing else: each is one small file per chunk. */
export const VARIABLES = [
  'temperature_2m',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation',
  'cloud_cover',
] as const;
export type Variable = (typeof VARIABLES)[number];

export interface BucketMeta {
  chunk_time_length: number;
  temporal_resolution_seconds: number;
  update_interval_seconds: number;
  data_end_time: number;
  last_run_initialisation_time: number;
}

/** The model's grid, from the file dimensions measured on 16.11.2026. */
export const GRID = {
  latStart: -90,
  lonStart: -180,
  step: 0.25,
  ny: 721,
  nx: 1440,
};

/** Row and column of the grid point nearest to a coordinate. */
export function cellOf(lat: number, lon: number): { y: number; x: number } {
  const y = Math.round((lat - GRID.latStart) / GRID.step);
  const x = Math.round((lon - GRID.lonStart) / GRID.step);
  return {
    y: Math.min(GRID.ny - 1, Math.max(0, y)),
    // 179.9 rounds to column 1440, which is column 0 (-180) round the globe.
    x: ((x % GRID.nx) + GRID.nx) % GRID.nx,
  };
}

const HOUR = 3600;

/**
 * Which chunks to read: the ones covering from a day and a half ago (so
 * that today's earlier steps are there whatever the zone) to eight days
 * ahead, and never one that starts after the data ends.
 */
export function chunksNeeded(meta: BucketMeta, nowSec: number): number[] {
  const span = meta.chunk_time_length * meta.temporal_resolution_seconds;
  const first = Math.floor((nowSec - 36 * HOUR) / span);
  const last = Math.min(
    Math.floor((nowSec + 8 * 24 * HOUR) / span),
    Math.floor((meta.data_end_time - 1) / span),
  );
  const out: number[] = [];
  for (let n = first; n <= last; n++) out.push(n);
  return out;
}

/** Epoch seconds of step `i` of chunk `n`. */
export function stepTime(meta: BucketMeta, chunk: number, i: number): number {
  return (
    (chunk * meta.chunk_time_length + i) * meta.temporal_resolution_seconds
  );
}

// ───────────────────────────── time zones ─────────────────────────────

const ZONE: Record<string, string> = {
  at: 'Europe/Vienna',
  be: 'Europe/Brussels',
  bg: 'Europe/Sofia',
  hr: 'Europe/Zagreb',
  cy: 'Asia/Nicosia',
  cz: 'Europe/Prague',
  dk: 'Europe/Copenhagen',
  ee: 'Europe/Tallinn',
  fi: 'Europe/Helsinki',
  // Åland has its own ISO code in our data and the Finnish clock.
  ax: 'Europe/Helsinki',
  fr: 'Europe/Paris',
  de: 'Europe/Berlin',
  gr: 'Europe/Athens',
  hu: 'Europe/Budapest',
  ie: 'Europe/Dublin',
  it: 'Europe/Rome',
  lv: 'Europe/Riga',
  lt: 'Europe/Vilnius',
  lu: 'Europe/Luxembourg',
  mt: 'Europe/Malta',
  nl: 'Europe/Amsterdam',
  pl: 'Europe/Warsaw',
  pt: 'Europe/Lisbon',
  ro: 'Europe/Bucharest',
  sk: 'Europe/Bratislava',
  si: 'Europe/Ljubljana',
  es: 'Europe/Madrid',
  se: 'Europe/Stockholm',
};

export function isKnownCountry(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(ZONE, code);
}

/** The IANA zone whose midnight starts this campsite's day. */
export function zoneFor(country: string, lat: number, lon: number): string {
  const zone = ZONE[country];
  if (!zone) throw new Error(`no zone for ${country}`);
  // The two parts of the EU that keep a different clock from the mainland.
  if (country === 'es' && lat < 30) return 'Atlantic/Canary';
  if (country === 'pt' && lon < -24) return 'Atlantic/Azores';
  return zone;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(zone: string, sec: number): { date: string; hour: number } {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(zone, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(sec * 1000))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

// ───────────────────────────── the series ─────────────────────────────

/** One chunk's worth of one point: every variable over the chunk's steps. */
export interface ChunkRead {
  chunk: number;
  values: Record<Variable, ArrayLike<number>>;
}

/** One point's values over consecutive steps. Missing is NaN, never 0. */
export interface Series {
  /** Epoch seconds of the first step. */
  start: number;
  /** Seconds between steps. */
  step: number;
  temperature_2m: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation: number[];
  cloud_cover: number[];
}

/**
 * Join per-chunk reads into one series.
 *
 * 🔴 A chunk that was not read is NaN for its whole span, NOT a shorter
 * series: positions in this array are times, and dropping a block would
 * slide every later value onto the wrong day.
 */
export function joinChunks(
  meta: BucketMeta,
  reads: ChunkRead[],
): Series | null {
  if (reads.length === 0) return null;
  const chunks = reads.map((r) => r.chunk).sort((a, b) => a - b);
  const n = meta.chunk_time_length;
  const first = chunks[0];
  const total = (chunks[chunks.length - 1] - first + 1) * n;
  const blank = () => new Array<number>(total).fill(NaN);
  const out: Series = {
    start: stepTime(meta, first, 0),
    step: meta.temporal_resolution_seconds,
    temperature_2m: blank(),
    temperature_2m_max: blank(),
    temperature_2m_min: blank(),
    precipitation: blank(),
    cloud_cover: blank(),
  };
  for (const r of reads) {
    const at = (r.chunk - first) * n;
    for (const v of VARIABLES) {
      const src = r.values[v];
      for (let i = 0; i < Math.min(n, src.length); i++) {
        const x = src[i];
        out[v][at + i] = Number.isFinite(x) ? x : NaN;
      }
    }
  }
  return out;
}

// ───────────────────────────── the days ─────────────────────────────

export type Condition =
  'clear' | 'partly-cloudy' | 'cloudy' | 'rain' | 'heavy-rain' | 'snow';

export interface ForecastDay {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  tMax: number;
  tMin: number;
  /** Millimetres over the local day. */
  precipMm: number;
  condition: Condition;
}

/** Thresholds for the word; ours, see the head of this file. */
export const RAIN_MM = 1;
export const HEAVY_RAIN_MM = 10;
export const SNOW_MAX_C = 1;
export const CLEAR_BELOW_PCT = 25;
export const CLOUDY_FROM_PCT = 60;

export function conditionOf(
  precipMm: number,
  tMax: number,
  cloudPct: number | null,
): Condition {
  if (precipMm >= RAIN_MM) {
    if (tMax <= SNOW_MAX_C) return 'snow';
    return precipMm >= HEAVY_RAIN_MM ? 'heavy-rain' : 'rain';
  }
  if (cloudPct === null) return 'partly-cloudy';
  if (cloudPct < CLEAR_BELOW_PCT) return 'clear';
  return cloudPct < CLOUDY_FROM_PCT ? 'partly-cloudy' : 'cloudy';
}

/** A day needs this many of its (about) eight 3-hourly steps to be shown. */
const MIN_STEPS_PER_DAY = 6;

/** Whole degrees, and never "-0". */
const whole = (x: number) => Math.round(x) + 0;

/**
 * Seven local days starting with today, from a series.
 *
 * 🔴 A DAY WITHOUT ENOUGH STEPS IS LEFT OUT, NOT AVERAGED OVER WHAT IS
 * THERE. A maximum over two afternoon steps is not the day's maximum; it
 * would print a plausible number that is wrong in the one direction that
 * flatters the weather. The caller decides how few days are too few.
 */
export function dailyForecast(
  s: Series,
  zone: string,
  nowSec: number,
  days = 7,
): ForecastDay[] {
  const n = s.temperature_2m.length;
  interface Acc {
    hi: number[];
    lo: number[];
    rain: number[];
    cloud: number[];
    tempSteps: number;
    rainSteps: number;
  }
  const byDay = new Map<string, Acc>();
  const get = (d: string): Acc => {
    let a = byDay.get(d);
    if (!a) {
      a = { hi: [], lo: [], rain: [], cloud: [], tempSteps: 0, rainSteps: 0 };
      byDay.set(d, a);
    }
    return a;
  };
  for (let i = 0; i < n; i++) {
    const t = s.start + i * s.step;
    const here = parts(zone, t);
    const a = get(here.date);
    const t0 = s.temperature_2m[i];
    if (Number.isFinite(t0)) {
      a.tempSteps++;
      a.hi.push(t0);
      a.lo.push(t0);
    }
    // 🔴 THE STORED EXTREMES LOOK BACKWARDS LIKE THE RAIN: Open-Meteo's
    // ECMWF `temperature_2m_max/min` are the extreme of the three hours
    // BEFORE the stamp (`.backwards` in its EcmwfVariable.swift). They go
    // to the day holding the middle of that interval, not the day of the
    // stamp; the instantaneous temperature stays with its stamp.
    const hi = s.temperature_2m_max[i];
    const lo = s.temperature_2m_min[i];
    if (Number.isFinite(hi) || Number.isFinite(lo)) {
      const b = get(parts(zone, t - s.step / 2).date);
      if (Number.isFinite(hi)) b.hi.push(hi);
      if (Number.isFinite(lo)) b.lo.push(lo);
    }
    // 🔴 daytime only: a clear night under a cloudy day is a cloudy day.
    const c = s.cloud_cover[i];
    if (Number.isFinite(c) && here.hour >= 6 && here.hour <= 20)
      a.cloud.push(c);
    // The step covers the three hours BEFORE its stamp: take the day of
    // the middle of them.
    const p = s.precipitation[i];
    if (Number.isFinite(p)) {
      const b = get(parts(zone, t - s.step / 2).date);
      b.rain.push(Math.max(0, p));
      b.rainSteps++;
    }
  }

  // 🔴 A CONTIGUOUS RUN STARTING TODAY, AND NOTHING AFTER A HOLE. If a day
  // lacks data, the days after it are not pulled forward to fill the week:
  // that would label a later day as an earlier one's neighbour and call
  // the set "seven days". The run stops at the first day missing.
  let date = parts(zone, nowSec).date;
  const out: ForecastDay[] = [];
  while (out.length < days) {
    const a = byDay.get(date);
    if (
      !a ||
      a.tempSteps < MIN_STEPS_PER_DAY ||
      a.rainSteps < MIN_STEPS_PER_DAY
    ) {
      break;
    }
    const tMax = Math.max(...a.hi);
    const tMin = Math.min(...a.lo);
    const rain = a.rain.reduce((x, y) => x + y, 0);
    const cloud = a.cloud.length
      ? a.cloud.reduce((x, y) => x + y, 0) / a.cloud.length
      : null;
    out.push({
      date,
      tMax: whole(tMax),
      tMin: whole(tMin),
      precipMm: Math.round(rain * 10) / 10,
      condition: conditionOf(rain, tMax, cloud),
    });
    date = nextDate(date);
  }
  return out;
}

/** The calendar date after `date` (YYYY-MM-DD), by calendar and not by hours. */
export function nextDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** How few days are too few to print a forecast section at all. */
export const MIN_DAYS_TO_SHOW = 3;

// ───────────────────────────── the request ─────────────────────────────

export interface ForecastQuery {
  lat: number;
  lon: number;
  country: string;
}

/**
 * 🔴 THE REQUEST NAMES A CAMPSITE, NOT A POINT. The coordinates come from
 * our own database, so the set of grid cells this route can ever make us
 * read is the set of cells our campsites sit in, not the 49 000 inside a
 * bounding box that anyone could walk through a 2000-entry cache.
 */
export function parseSlug(slug?: string): string | null {
  return typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,199}$/.test(slug)
    ? slug
    : null;
}
