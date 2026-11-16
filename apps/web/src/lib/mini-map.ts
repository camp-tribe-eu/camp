/**
 * CAMP-441 (49, 57, 58) — the pictures of the listing cards, drawn from
 * OUR OWN coordinates.
 *
 * We hold no photograph of a region or of an ordinary campsite, and a
 * stock shot would be a promise of one. What we do hold is where every
 * campsite is, and for about half of them the outline of the ground from
 * OpenStreetMap. So the picture of a card is a drawing of that:
 *
 *   region card      the cloud of its campsites, inside their own extent
 *   campsite card    its outline, where OSM has one; otherwise the cloud of
 *                    its region with this campsite marked
 *
 * Pure: no React, no network. Both functions return `null` when there is
 * nothing honest to draw (no finite coordinates, an outline with no ring),
 * and the card then has no picture at all — never a blank one.
 *
 * 🔴 ONE BAD POINT COSTS ONE POINT. A coordinate that is not a finite
 * latitude/longitude is skipped; the rest are drawn.
 *
 * 🔴 THE FRAME IS NEVER BLOWN UP. Two campsites 100 m apart would otherwise
 * be stretched to opposite corners of the tile, which reads as "far
 * apart". The drawn extent is at least `MIN_SPAN_DEG` (≈ 22 km) for a
 * cloud and `MIN_OUTLINE_SPAN_DEG` (≈ 55 m) for one campsite's outline.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

/** The viewBox of every picture: 16:9, like the card's image slot. */
export const ART_W = 160;
export const ART_H = 90;
const PAD = 8;

/**
 * The cloud is drawn on a grid, one dot per occupied cell, and the grid is
 * as fine as the budget allows: the first cell size in `CELLS` that leaves
 * at most `MAX_DOTS` occupied cells.
 *
 * 🔴 THE BUDGET IS BYTES ON A PAGE OF 102 CARDS. Measured 16.11.2026 on
 * /camping/fr with a fixed 4-unit cell: 79 dots a card on average, 65 600
 * bytes of SVG — and React serves every element twice, once as HTML and
 * once in the RSC payload, so +131 kB for one page. A cap of 90 dots keeps
 * a region's shape readable (its outline is still its outline) and a
 * region of three campsites keeps its three dots at the finest grid.
 */
const CELLS = [4, 5, 6, 7, 8, 10, 12, 16];
const MAX_DOTS = 90;
const MIN_SPAN_DEG = 0.2;
const MIN_OUTLINE_SPAN_DEG = 0.0005;

const isLatLon = (p: unknown): p is LatLon => {
  if (typeof p !== 'object' || p === null) return false;
  const { lat, lon } = p as Record<string, unknown>;
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
};

interface Frame {
  project: (lat: number, lon: number) => [number, number];
}

/** Equirectangular, longitude scaled by cos(latitude), centred in the box. */
function frame(
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  minSpan: number,
): Frame {
  const midLat = (minLat + maxLat) / 2;
  const k = Math.cos((midLat * Math.PI) / 180);
  const spanY = Math.max(maxLat - minLat, minSpan);
  const spanX = Math.max((maxLon - minLon) * k, minSpan);
  const scale = Math.min((ART_W - 2 * PAD) / spanX, (ART_H - 2 * PAD) / spanY);
  const cx = ((minLon + maxLon) / 2) * k;
  const cy = (minLat + maxLat) / 2;
  return {
    project: (lat, lon) => [
      ART_W / 2 + (lon * k - cx) * scale,
      ART_H / 2 - (lat - cy) * scale,
    ],
  };
}

export interface DotMap {
  /** One `<path>`: a zero-length round-capped segment per occupied cell. */
  d: string;
  /** Dots drawn (cells occupied), not points given. */
  dots: number;
  /** Stroke width that makes a dot fill about half its cell. */
  dot: number;
  /** Where a point of the same region falls in this picture. */
  project: (p: LatLon) => [number, number];
}

/**
 * The cloud of a region's campsites. `null` without a single usable point.
 *
 * Relative moves keep it small: at most `MAX_DOTS` dots of some six bytes
 * each, whatever the region's size; a region of one is 12 bytes.
 */
export function dotMap(points: readonly unknown[]): DotMap | null {
  const ok = points.filter(isLatLon);
  if (ok.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of ok) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  const f = frame(minLat, maxLat, minLon, maxLon, MIN_SPAN_DEG);
  const projected = ok.map((p) => f.project(p.lat, p.lon));
  let dots: [number, number][] = [];
  let size = CELLS[0];
  for (const cell of CELLS) {
    size = cell;
    const cells = new Map<number, [number, number]>();
    for (const [x, y] of projected) {
      const cx = Math.round(x / cell);
      const cy = Math.round(y / cell);
      cells.set(cy * 1000 + cx, [cx * cell, cy * cell]);
    }
    dots = [...cells.values()];
    if (dots.length <= MAX_DOTS) break;
  }
  // Row by row, left to right: the deltas stay small.
  dots.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  let d = '';
  let px = 0;
  let py = 0;
  for (const [x, y] of dots) {
    d += `${d === '' ? 'M' : 'm'}${x - px} ${y - py}h0`;
    px = x;
    py = y;
  }
  return {
    d,
    dots: dots.length,
    dot: Math.max(2.4, round1(size * 0.5)),
    project: (p) => {
      const [x, y] = f.project(p.lat, p.lon);
      return [round1(x), round1(y)];
    },
  };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** An outline as the API sends it: GeoJSON Polygon or MultiPolygon. */
export type OutlineShape =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

const isRing = (r: unknown): r is [number, number][] =>
  Array.isArray(r) &&
  r.length >= 3 &&
  r.every(
    (c) =>
      Array.isArray(c) &&
      typeof c[0] === 'number' &&
      typeof c[1] === 'number' &&
      Number.isFinite(c[0]) &&
      Number.isFinite(c[1]) &&
      Math.abs(c[1]) <= 90 &&
      Math.abs(c[0]) <= 180,
  );

/**
 * The outline of one campsite as one `d` attribute, fitted to the tile.
 * `null` for anything that is not a Polygon/MultiPolygon with at least one
 * ring of three finite points. A ring that is not one is skipped; the
 * others are drawn.
 *
 * Both shapes are read: the column is a MultiPolygon, but `ST_AsGeoJSON`
 * hands over whatever is stored (the same trap `outlineBounds` documents).
 */
export function outlinePath(outline: unknown): string | null {
  if (typeof outline !== 'object' || outline === null) return null;
  const o = outline as { type?: unknown; coordinates?: unknown };
  let polygons: unknown[];
  if (o.type === 'Polygon' && Array.isArray(o.coordinates)) {
    polygons = [o.coordinates];
  } else if (o.type === 'MultiPolygon' && Array.isArray(o.coordinates)) {
    polygons = o.coordinates;
  } else {
    return null;
  }
  const rings: [number, number][][] = [];
  for (const poly of polygons) {
    if (!Array.isArray(poly)) continue;
    for (const ring of poly) if (isRing(ring)) rings.push(ring);
  }
  if (rings.length === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  }
  const f = frame(minLat, maxLat, minLon, maxLon, MIN_OUTLINE_SPAN_DEG);
  let d = '';
  for (const ring of rings) {
    let last = '';
    let n = 0;
    for (const [lon, lat] of ring) {
      const [x, y] = f.project(lat, lon);
      const pt = `${round1(x)} ${round1(y)}`;
      if (pt === last) continue; // a vertex the rounding folded into the last
      d += `${n === 0 ? 'M' : 'L'}${pt}`;
      last = pt;
      n++;
    }
    d += 'Z';
  }
  return d;
}
