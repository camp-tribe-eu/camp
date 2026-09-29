// CAMP-164: read the EEA's air quality index — the roster, one file per
// station, and the 1 km modelled raster.
//
// 🔴 NO KEY, AND NONE IS NEEDED. Nothing in this module reads an
// environment variable, so there is nothing here that could ever be
// committed by accident — the repository is public and has leaked once.
//
// 🔴 EVERY FAILURE HERE IS ONE OF THREE THINGS, and they are kept apart
// because the page tells them apart:
//
//   no-file  — HTTP 404. The EEA has no file for this station: 5 of 8
//              stations chosen because they were silent had none. That is
//              a fact about the station and is stored as one.
//   failed   — anything else (a 5xx, a timeout, a body that is not JSON).
//              That is a fact about US. It must never be stored as
//              "silent": the station's previous reading is left alone and
//              is simply a little older, which the page already handles.
//   ok       — a body.

import {
  AIR_RASTER_BATCH,
  AIR_RASTER_SENTINEL,
  AIR_RASTER_URL,
  AIR_ROSTER_INDEX_URL,
  airRosterUrl,
  airStationUrl,
  AIR_BLOB_BASE,
} from './source';

const TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 500;

/** Tells the operator of a public blob store who is asking. No secret. */
const HEADERS = {
  'User-Agent': 'CampTribe-air-import (+https://camptribe.eu)',
};

/** Sleep between the two attempts; replaced in tests. */
export const sleeper = {
  sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
};

/** JSON that may have been serialised twice, as the viewer's own code allows for. */
function parseJson(text: string): unknown {
  const once: unknown = JSON.parse(text);
  return typeof once === 'string' ? JSON.parse(once) : once;
}

/**
 * The response body as text, refusing a short one.
 *
 * 🔴 A blob store that cuts a transfer short answers 200 with fewer bytes
 * than it announced, and half a JSON object is a JSON error only if we
 * are lucky. When the server states a length, the body must have it.
 */
async function bodyText(res: Response, what: string): Promise<string> {
  const text = await res.text();
  const declared = res.headers?.get?.('content-length');
  if (declared && Number(declared) !== Buffer.byteLength(text)) {
    throw new Error(
      `${what}: read ${Buffer.byteLength(text)} bytes but the server announced ${declared} — refusing a short read`,
    );
  }
  return text;
}

async function getJson(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: unknown; bytes: number }> {
  const res = await fetchImpl(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return { status: 404, body: null, bytes: 0 };
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  const text = await bodyText(res, url);
  return {
    status: res.status,
    body: parseJson(text),
    bytes: Buffer.byteLength(text),
  };
}

async function withOneRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    await sleeper.sleep(RETRY_DELAY_MS);
    return run();
  }
}

/**
 * The newest roster file's name, from the index.
 *
 * 🔴 By the number in the name, not by array order and not by
 * lexicographic sort of the whole string. The index lists them out of
 * order (`…26091800, …26091100, …26090400, …26092500`); the viewer sorts
 * the names, which works for `yymmddNN` until 2100.
 */
export function newestRosterFile(index: unknown): string {
  const contents = (index as { contents?: unknown } | null)?.contents;
  if (!Array.isArray(contents)) {
    throw new Error('the roster index has no "contents" list');
  }
  let best: { file: string; n: number } | null = null;
  for (const f of contents) {
    const m =
      typeof f === 'string' ? /^raw_stations\.json\.(\d+)$/.exec(f) : null;
    if (!m) continue;
    const n = Number(m[1]);
    if (!best || n > best.n) best = { file: f as string, n };
  }
  if (!best)
    throw new Error('the roster index lists no raw_stations.json file');
  return best.file;
}

export interface Roster {
  file: string;
  rows: unknown[];
}

export async function fetchRoster(
  fetchImpl: typeof fetch = fetch,
): Promise<Roster> {
  const idx = await withOneRetry(() =>
    getJson(AIR_ROSTER_INDEX_URL, fetchImpl),
  );
  if (idx.status !== 200)
    throw new Error(`${AIR_ROSTER_INDEX_URL} answered ${idx.status}`);
  const file = newestRosterFile(idx.body);
  const url = airRosterUrl(file);
  const res = await withOneRetry(() => getJson(url, fetchImpl));
  if (res.status !== 200) throw new Error(`${url} answered ${res.status}`);
  if (!Array.isArray(res.body) || res.body.length === 0) {
    throw new Error(`${url} is not a non-empty list of stations`);
  }
  return { file, rows: res.body };
}

export type StationFile =
  | { outcome: 'ok'; body: unknown; bytes: number }
  | { outcome: 'no-file' }
  | { outcome: 'failed'; detail: string };

export async function fetchStationFile(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StationFile> {
  try {
    const res = await withOneRetry(() =>
      getJson(airStationUrl(code), fetchImpl),
    );
    return res.status === 404
      ? { outcome: 'no-file' }
      : { outcome: 'ok', body: res.body, bytes: res.bytes };
  } catch (err) {
    return {
      outcome: 'failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** `fn` over `items`, at most `limit` at a time, results in input order. */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

/** The map file for one hour: `map/2026-09-29T19.json`. Used by the reports only. */
export const airMapUrl = (hour: Date): string =>
  `${AIR_BLOB_BASE}/map/${hour.toISOString().slice(0, 13)}.json`;

// ---------------------------------------------------------------------
// The 1 km modelled raster.
// ---------------------------------------------------------------------

export interface RasterWindow {
  /** Epoch ms, inclusive. */
  start: number;
  end: number;
}

/**
 * The hours the raster holds, read from the service.
 *
 * 🔴 An hour outside this window is refused BEFORE any point is sent.
 * The service answers a time slice it does not hold with HTTP 400 and
 * "Invalid or missing input parameters" — and an ArcGIS folder that has
 * been retired answers 200. Reading the window first turns "the EEA
 * moved to AQMobile_2026" into a sentence in the import's output.
 */
export async function rasterWindow(
  fetchImpl: typeof fetch = fetch,
): Promise<RasterWindow> {
  const url = `${AIR_RASTER_URL}?f=json`;
  const res = await withOneRetry(() => getJson(url, fetchImpl));
  const body = res.body as {
    error?: { message?: string };
    timeInfo?: { timeExtent?: unknown };
    maxValues?: unknown;
  } | null;
  if (res.status !== 200 || !body || body.error) {
    throw new Error(
      `${url} did not describe an image service: ${body?.error?.message ?? res.status}`,
    );
  }
  const te = body.timeInfo?.timeExtent;
  if (
    !Array.isArray(te) ||
    te.length !== 2 ||
    !te.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    throw new Error(
      `${url} has no time extent — this is not the index raster any more`,
    );
  }
  // The index is levels 1–6. A different top value is a different product.
  const max = Array.isArray(body.maxValues) ? body.maxValues[0] : null;
  if (max !== 6) {
    throw new Error(
      `${url} reports maxValues ${JSON.stringify(body.maxValues)}, not [6]`,
    );
  }
  return { start: te[0] as number, end: te[1] as number };
}

export interface BandsResult {
  /** Index level 1–6 per input point, or null where the model has none. */
  bands: (number | null)[];
  /** Samples the server returned that were not an integer 1–6. */
  badValues: number;
}

/**
 * The modelled index at each point, for one hour.
 *
 * 🔴 EVERY BATCH CARRIES ITS OWN PROOF THAT IT WAS READ WHOLE. See
 * AIR_RASTER_BATCH in source.ts: the server ignores everything after the
 * first 1 000 points without saying so, and a point it ignored is
 * indistinguishable from a point outside the model. The sentinel is
 * sent LAST; when it does not come back the whole call throws.
 *
 * "Whole call", not "that batch": a truncating server is a server whose
 * every other answer is in doubt, and a half-refreshed modelled table is
 * worse than one that keeps last hour's values and lets them age out.
 *
 * A point the model has no value for is simply absent from `samples`
 * (Canary Islands, Réunion, the Atlantic at 30°W all were) — `null`,
 * and the page says the model does not cover it.
 */
export async function fetchModelledBands(
  points: readonly { lon: number; lat: number }[],
  hourMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<BandsResult> {
  const bands: (number | null)[] = new Array(points.length).fill(null);
  let badValues = 0;

  for (let from = 0; from < points.length; from += AIR_RASTER_BATCH) {
    const chunk = points.slice(from, from + AIR_RASTER_BATCH);
    const sentinelId = chunk.length;
    const geometry = {
      points: [
        ...chunk.map((p) => [p.lon, p.lat]),
        [AIR_RASTER_SENTINEL.lon, AIR_RASTER_SENTINEL.lat],
      ],
      spatialReference: { wkid: 4326 },
    };
    const mosaicRule = {
      ascending: true,
      mosaicMethod: 'esriMosaicNone',
      multidimensionalDefinition: [
        {
          variableName: 'AQI',
          dimensionName: 'StdTime',
          values: [hourMs],
          isSlice: true,
        },
      ],
      mosaicOperation: 'MT_FIRST',
    };
    const form = new URLSearchParams({
      geometryType: 'esriGeometryMultipoint',
      geometry: JSON.stringify(geometry),
      mosaicRule: JSON.stringify(mosaicRule),
      returnFirstValueOnly: 'true',
      outFields: 'AQI',
      f: 'json',
    });

    const body = await withOneRetry(async () => {
      const res = await fetchImpl(`${AIR_RASTER_URL}/getSamples`, {
        method: 'POST',
        headers: {
          ...HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`getSamples answered HTTP ${res.status}`);
      const json = (await res.json()) as {
        samples?: { locationId?: unknown; value?: unknown }[];
        error?: { message?: string };
      };
      // ArcGIS reports failures inside a 200.
      if (json.error)
        throw new Error(
          `getSamples error: ${json.error.message ?? 'no message'}`,
        );
      if (!Array.isArray(json.samples))
        throw new Error('getSamples returned no samples list');
      return json.samples;
    });

    const byId = new Map<number, unknown>();
    for (const s of body) {
      if (typeof s.locationId === 'number') byId.set(s.locationId, s.value);
    }
    if (!byId.has(sentinelId)) {
      throw new Error(
        `the sentinel point did not come back from a batch of ${chunk.length + 1} — ` +
          'the server dropped part of it; refusing a partial answer',
      );
    }
    for (let i = 0; i < chunk.length; i++) {
      if (!byId.has(i)) continue;
      const n = Number(byId.get(i));
      if (Number.isInteger(n) && n >= 1 && n <= 6) bands[from + i] = n;
      else badValues += 1;
    }
  }
  return { bands, badValues };
}
