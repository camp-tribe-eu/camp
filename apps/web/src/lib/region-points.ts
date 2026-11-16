import { apiFetch } from '@/lib/api';
import type { LatLon } from '@/lib/mini-map';

/**
 * CAMP-441. Where a region's campsites are — the raw material of the
 * region card's picture and of the "marked on its region" picture of a
 * campsite that has no outline.
 *
 * Read from the route the map's chunks already use
 * (`/spots/map/region/{c}/{r}`, no API change): one array of markers, of
 * which only the coordinates are kept, so a region of 1 433 campsites
 * costs the page nothing but the dots it draws.
 *
 * 🔴 A REGION THAT CANNOT BE READ COSTS ITS OWN PICTURE, NOT THE PAGE.
 * The picture is decoration on a card that already names the region and
 * counts its campsites. A failure (non-200, not JSON, not an array) is
 * `[]`, logged once, and the card is drawn without a picture.
 */
export async function regionPoints(country: string, slug: string): Promise<LatLon[]> {
  try {
    const res = await apiFetch(
      `/spots/map/region/${encodeURIComponent(country)}/${encodeURIComponent(slug)}`,
      { next: { revalidate: 86400 } },
    );
    if (!res.ok) return [];
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return [];
    const out: LatLon[] = [];
    for (const r of rows) {
      if (typeof r !== 'object' || r === null) continue;
      const { lat, lon } = r as Record<string, unknown>;
      if (typeof lat === 'number' && typeof lon === 'number') out.push({ lat, lon });
    }
    return out;
  } catch (e) {
    console.warn(`region-points: ${country}/${slug} unreadable: ${(e as Error).message}`);
    return [];
  }
}

/**
 * `fn` over `items`, at most `limit` at a time, results in the order of
 * `items`. France has 102 regions; asking for all at once is the burst
 * that made the map chunks answer 429 (api.ts, `mapRegions`).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
