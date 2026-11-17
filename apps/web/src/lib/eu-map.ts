import type { RegionSummary } from './map-chunks';
import type { MapRow } from '@/components/country-map';

/**
 * CAMP-441 (35): the map on /camping — one circle per country.
 *
 * Built from the SAME index the country maps read (`mapRegions()`), summed
 * per country: the count is the sum of its regions' counts, the box is the
 * union of their boxes, and the circle sits at the count-weighted centre of
 * its regions (a country's campsites, not its geometric middle).
 *
 * Only the countries that have a tile on the page (`codes`): Åland folds into
 * Finland and a hidden country never gets a circle — the map and the tiles
 * below it must show the same set.
 */
export function euMapRows(
  rows: readonly RegionSummary[],
  codes: readonly { code: string; name: string }[],
  fold: Readonly<Record<string, string>> = { ax: 'fi' },
): MapRow[] {
  const names = new Map(codes.map((c) => [c.code.toLowerCase(), c.name]));
  const acc = new Map<string, { n: number; lon: number; lat: number; minLon: number; minLat: number; maxLon: number; maxLat: number }>();
  for (const r of rows) {
    const raw = r.country.toLowerCase();
    const cc = fold[raw] ?? raw;
    if (!names.has(cc) || r.count <= 0) continue;
    const a = acc.get(cc) ?? { n: 0, lon: 0, lat: 0, minLon: 180, minLat: 90, maxLon: -180, maxLat: -90 };
    a.n += r.count;
    a.lon += r.lon * r.count;
    a.lat += r.lat * r.count;
    a.minLon = Math.min(a.minLon, r.minLon);
    a.minLat = Math.min(a.minLat, r.minLat);
    a.maxLon = Math.max(a.maxLon, r.maxLon);
    a.maxLat = Math.max(a.maxLat, r.maxLat);
    acc.set(cc, a);
  }
  return [...acc.entries()]
    .map(([cc, a]) => ({
      country: cc.toUpperCase(),
      region: names.get(cc) ?? cc,
      slug: cc,
      count: a.n,
      lon: a.lon / a.n,
      lat: a.lat / a.n,
      minLon: a.minLon,
      minLat: a.minLat,
      maxLon: a.maxLon,
      maxLat: a.maxLat,
      href: `/camping/${cc}`,
    }))
    .sort((x, y) => y.count - x.count);
}
