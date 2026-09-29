// CAMP-168: read every feature out of the EEA's ArcGIS layer.
//
// 🔴 NO KEY, AND NONE IS NEEDED. Checked 28.09.2026: the service answers
// HTTP 200 to an anonymous request. Nothing in this module reads an
// environment variable, so there is nothing here that could ever be
// committed by accident — the repository is public and has leaked once.

import { BATHING_LAYER_URL } from './source';
import type { BathingFeatureAttributes } from './parse';

/**
 * 🔴 The server's own ceiling, not ours.
 *
 * The layer advertises `maxRecordCount: 2000` and enforces it; asking for
 * more returns 2 000 and `exceededTransferLimit: true`. Hard-coding a
 * larger page would silently lose records, which is the failure mode
 * this whole card exists to avoid.
 */
export const PAGE_SIZE = 2000;

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
): Promise<BathingFeatureAttributes[]> {
  const expected = await fetchCount(fetchImpl, layer);
  const out: BathingFeatureAttributes[] = [];

  for (let offset = 0; ;) {
    const res = await fetchImpl(pageUrl(offset, layer));
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
): Promise<number> {
  const res = await fetchImpl(countUrl(layer));
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
