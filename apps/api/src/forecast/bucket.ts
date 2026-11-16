// CAMP-477 — the only file of the forecast that touches the network.
//
// 🔴 ONE HOST: openmeteo.s3.amazonaws.com, anonymous reads, no key. Not
// api.open-meteo.com — see the head of forecast.ts. The reader is the
// official one (`@openmeteo/file-reader`, github.com/open-meteo/
// typescript-omfiles, published by the Open-Meteo maintainers, WASM over
// the C library). It reads with HTTP Range requests, so one point costs a
// few kilobytes of a 68 MB file.
//
// 🔴 LICENCE OF THAT PACKAGE: GPL-2.0-only. It runs on OUR server and is
// never sent to a reader or bundled into the web app, so nothing is
// distributed; the GPL's conditions attach on distribution. It must stay
// in apps/api — `forecast-licence.spec.ts` fails if the web workspace
// ever depends on it.

import {
  LruBlockCache,
  OmDataType,
  OmHttpBackend,
} from '@openmeteo/file-reader';

import {
  BUCKET_DATA,
  type BucketMeta,
  type ChunkRead,
  type Series,
  type Variable,
  VARIABLES,
  cellOf,
  chunksNeeded,
  joinChunks,
} from './forecast';

/** The bucket answers in well under a second; ten is already a failure. */
const TIMEOUT_MS = 10_000;

/** Four megabytes of 64 KiB blocks: enough for a point, small for a server. */
const blocks = new LruBlockCache(64 * 1024, 64);

export type Fetch = typeof fetch;

export async function readMeta(f: Fetch = fetch): Promise<BucketMeta> {
  const res = await f(`${BUCKET_DATA}/static/meta.json`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`meta ${res.status}`);
  const m = (await res.json()) as Partial<BucketMeta>;
  for (const k of [
    'chunk_time_length',
    'temporal_resolution_seconds',
    'update_interval_seconds',
    'data_end_time',
    'last_run_initialisation_time',
  ] as const) {
    if (!Number.isFinite(m[k]) || (m[k] as number) <= 0) {
      throw new Error(`meta: ${k} is not a positive number`);
    }
  }
  return m as BucketMeta;
}

/** One variable of one chunk at one grid point: the whole time axis. */
async function readOne(
  variable: Variable,
  chunk: number,
  y: number,
  x: number,
): Promise<Float32Array> {
  const backend = new OmHttpBackend({
    url: `${BUCKET_DATA}/${variable}/chunk_${chunk}.om`,
    timeoutMs: TIMEOUT_MS,
    retries: 1,
  });
  return backend.withReader(blocks, async (reader) => {
    const dims = reader.getDimensions();
    // A file whose shape is not the one measured would be read at the
    // wrong place without a word; refuse it.
    if (dims.length !== 3 || y >= dims[0] || x >= dims[1]) {
      throw new Error(`unexpected dimensions ${dims.join('x')}`);
    }
    return reader.read({
      type: OmDataType.FloatArray,
      ranges: [
        { start: y, end: y + 1 },
        { start: x, end: x + 1 },
        { start: 0, end: dims[2] },
      ],
    });
  });
}

/**
 * What the bucket holds for one point, chunk by chunk, undecoded beyond
 * the file format. Any chunk that fails fails the read: a quietly missing
 * chunk would leave a hole in the middle of the week.
 */
export async function readChunks(
  lat: number,
  lon: number,
  nowSec: number,
  f: Fetch = fetch,
): Promise<{ meta: BucketMeta; reads: ChunkRead[] }> {
  const meta = await readMeta(f);
  const { y, x } = cellOf(lat, lon);
  const chunks = chunksNeeded(meta, nowSec);
  if (chunks.length === 0) throw new Error('no chunk covers now');
  const reads = await Promise.all(
    chunks.map(async (chunk) => {
      const got = await Promise.all(
        VARIABLES.map((v) => readOne(v, chunk, y, x)),
      );
      const values = {} as Record<Variable, Float32Array>;
      VARIABLES.forEach((v, i) => (values[v] = got[i]));
      return { chunk, values };
    }),
  );
  return { meta, reads };
}

/** The series for one point, and the meta it was read with. */
export async function readPoint(
  lat: number,
  lon: number,
  nowSec: number,
  f: Fetch = fetch,
): Promise<{ meta: BucketMeta; series: Series }> {
  const { meta, reads } = await readChunks(lat, lon, nowSec, f);
  const series = joinChunks(meta, reads);
  if (!series) throw new Error('nothing read');
  return { meta, series };
}
