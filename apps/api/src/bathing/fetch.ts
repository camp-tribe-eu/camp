// CAMP-168: read every feature out of the EEA's ArcGIS layer.
//
// 🔴 NO KEY, AND NONE IS NEEDED. Checked 28.09.2026: the service answers
// HTTP 200 to an anonymous request. Nothing in this module reads an
// environment variable, so there is nothing here that could ever be
// committed by accident — the repository is public and has leaked once.

import { BATHING_LAYER_URL } from './source';
import type { BathingFeatureAttributes } from './parse';
import { isUpstreamStatus, UpstreamUnavailable } from './upstream';

/**
 * 🔴 The server's own ceiling, not ours.
 *
 * The layer advertises `maxRecordCount: 2000` and enforces it; asking for
 * more returns 2 000 and `exceededTransferLimit: true`. Hard-coding a
 * larger page would silently lose records, which is the failure mode
 * this whole card exists to avoid.
 */
export const PAGE_SIZE = 2000;

/**
 * CAMP-440: how many times one request is tried before the source is
 * declared unavailable, and the pause between tries.
 *
 * The same shape as the download loop in .github/workflows/osm-weekly.yml:
 * a loop of SEPARATE calls, each attempt named in the log as
 * "attempt i of N", and the failure named once, after the loop, by the
 * caller. Three attempts thirty seconds apart ride out the common
 * one-off 5xx; the 04.11.2026 outage (the whole server, for longer) is
 * what upstream.ts is for.
 */
export const ATTEMPTS = 3;
export const RETRY_PAUSE_MS = 30_000;

export interface RetryOptions {
  attempts?: number;
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

interface QueryResponse {
  features?: { attributes: BathingFeatureAttributes }[];
  exceededTransferLimit?: boolean;
  error?: { message?: string };
}

export function pageUrl(offset: number, layer = BATHING_LAYER_URL): string {
  const q = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'false',
    // 🔴 A stable sort, or paging by offset is undefined. Without it the
    // server may return the same feature on two pages and none on a
    // third, and the only symptom is a total that looks about right.
    orderByFields: 'OBJECTID',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    f: 'json',
  });
  return `${layer}/query?${q}`;
}

export function countUrl(layer = BATHING_LAYER_URL): string {
  const q = new URLSearchParams({
    where: '1=1',
    returnCountOnly: 'true',
    f: 'json',
  });
  return `${layer}/query?${q}`;
}

/**
 * One request, retried while the SOURCE is the one failing.
 *
 * 🔴 Only a 5xx, a 429 or a transport error (the host unreachable, the
 * connection reset) is retried, and only those become
 * `UpstreamUnavailable` once the attempts are spent. Any other answer —
 * a 200 with an error object, a 404 because the layer moved — is handed
 * back untouched for the caller to fail on, loudly, as before. The pause
 * is injectable so tests do not wait thirty seconds; the loop is not.
 */
export async function fetchUpstream(
  fetchImpl: typeof fetch,
  url: string,
  what: string,
  opts: RetryOptions = {},
): Promise<Response> {
  const attempts = opts.attempts ?? ATTEMPTS;
  const pauseMs = opts.pauseMs ?? RETRY_PAUSE_MS;
  const sleep = opts.sleep ?? realSleep;
  const log = opts.log ?? ((line: string) => console.log(line));
  let last = 'not attempted';

  for (let i = 1; i <= attempts; i++) {
    let res: Response | null = null;
    try {
      res = await fetchImpl(url);
    } catch (err) {
      const cause = (err as { cause?: { code?: string } })?.cause?.code;
      last = `unreachable (${(err as Error)?.message ?? String(err)}${
        cause ? `, ${cause}` : ''
      })`;
    }
    if (res) {
      if (!isUpstreamStatus(res.status)) return res;
      last = `HTTP ${res.status}`;
    }
    log(
      `  ${what}: attempt ${i} of ${attempts} — ${last}` +
        (i < attempts ? `, waiting ${pauseMs / 1000} s` : ''),
    );
    if (i < attempts) await sleep(pauseMs);
  }

  throw new UpstreamUnavailable(
    `the EEA ArcGIS server is unavailable: ${what} answered ${last} on all ` +
      `${attempts} attempts, ${pauseMs / 1000} s apart — the source, not this import`,
  );
}

/**
 * Every feature in the layer, in OBJECTID order.
 *
 * 🔴 It asks the server how many rows there are FIRST and refuses to
 * return a short read. ArcGIS answers a failed page with HTTP 200 and an
 * `error` object, so "the loop ended" is not evidence that the data
 * ended — and a bathing-water table that is quietly 40% short would
 * produce pages that say "no classified bathing water nearby" about
 * places that have one.
 */
export async function fetchAllFeatures(
  fetchImpl: typeof fetch = fetch,
  layer = BATHING_LAYER_URL,
  retry: RetryOptions = {},
): Promise<BathingFeatureAttributes[]> {
  const expected = await fetchCount(fetchImpl, layer, retry);
  const out: BathingFeatureAttributes[] = [];

  for (let offset = 0; ;) {
    const res = await fetchUpstream(
      fetchImpl,
      pageUrl(offset, layer),
      `page at offset ${offset}`,
      retry,
    );
    if (!res.ok) {
      throw new Error(
        `${layer} answered HTTP ${res.status} at offset ${offset}`,
      );
    }
    const body = (await res.json()) as QueryResponse;
    if (body.error) {
      throw new Error(
        `${layer} returned an error at offset ${offset}: ${
          body.error.message ?? 'no message'
        }`,
      );
    }
    const features = body.features ?? [];
    if (!features.length) break;
    for (const f of features) out.push(f.attributes ?? {});
    offset += features.length;
    if (!body.exceededTransferLimit) break;
  }

  if (out.length !== expected) {
    throw new Error(
      `read ${out.length} features but the layer reports ${expected} — ` +
        'refusing a short read',
    );
  }
  return out;
}

export async function fetchCount(
  fetchImpl: typeof fetch = fetch,
  layer = BATHING_LAYER_URL,
  retry: RetryOptions = {},
): Promise<number> {
  const res = await fetchUpstream(fetchImpl, countUrl(layer), 'count', retry);
  if (!res.ok) throw new Error(`${layer} count answered HTTP ${res.status}`);
  const body = (await res.json()) as {
    count?: number;
    error?: { message?: string };
  };
  if (body.error) {
    throw new Error(`${layer} count returned an error: ${body.error.message}`);
  }
  if (typeof body.count !== 'number') {
    throw new Error(`${layer} count returned no count`);
  }
  return body.count;
}
