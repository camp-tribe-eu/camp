// CAMP-127: the map, in pieces — and the rules for which pieces to fetch.
//
// 🔴 Why the map is no longer one file.
//
// It read a single snapshot with a hard cap of 20 000 markers, and the
// route refused — correctly — to serve a truncated one. On 24.09.2026 the
// EU-27 import took the database from 9 830 campsites to 61 521, the cap
// fired, and the map went from working to a 500. Raising the cap was
// never the answer: 9 830 markers weighed 2.4 MB, so 61 521 is roughly
// 15 MB to fetch, parse and cluster before anything appears.
//
// Measured on the same data: 812 chunks (800 regions plus 12 for the
// campsites that have no region at all), the largest holding 1 433 and
// the median 26.
//
// Pure, so every rule below can be driven without a map, a network or a
// browser — which is the only way to test the cases that matter: a
// viewport crossing the antimeridian, an index that failed to load, a
// chunk that came back empty.

export interface RegionSummary {
  country: string;
  region: string | null;
  slug: string;
  count: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  lon: number;
  lat: number;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** The address of one chunk, and of its file. */
export const chunkKey = (r: { country: string; slug: string }): string =>
  `${r.country.toLowerCase()}/${r.slug}`;

export const chunkUrl = (key: string): string => `/data/spots/${key}.geojson`;

/**
 * Below this, the map draws one circle per region instead of markers.
 *
 * 🔴 Not a taste. At a whole-Europe view the reader cannot tell one
 * campsite from another anyway, and fetching the chunks to prove it would
 * cost megabytes. The index is already in hand — 812 points, 164 KB — so
 * the wide view is free and the detailed view is bounded.
 */
export const DETAIL_ZOOM = 6;

/**
 * Do two boxes overlap?
 *
 * 🔴 Touching counts. A campsite exactly on the edge of the viewport is
 * in view, and a strict comparison would blink it out of existence as the
 * reader panned — the kind of thing that looks like a data bug for weeks.
 */
export function overlaps(
  a: Bounds,
  b: Pick<RegionSummary, 'minLon' | 'minLat' | 'maxLon' | 'maxLat'>,
): boolean {
  return (
    b.minLon <= a.east &&
    b.maxLon >= a.west &&
    b.minLat <= a.north &&
    b.maxLat >= a.south
  );
}

/**
 * Which chunks a viewport needs, nearest the middle first.
 *
 * 🔴 Ordered, because the order is what the reader sees. Fetches finish
 * in the order they are made, so starting from the centre of the screen
 * fills in what somebody is looking at before what is at the edge.
 *
 * `limit` is a bound on bytes, not a filter: crossing it means the view
 * is too wide for markers, and the caller must say so rather than draw a
 * part of the answer as if it were all of it.
 */
export function chunksInView(
  index: readonly RegionSummary[],
  view: Bounds,
  limit = 60,
): { keys: string[]; tooMany: boolean } {
  const midLon = (view.west + view.east) / 2;
  const midLat = (view.south + view.north) / 2;
  const hit = index.filter((r) => overlaps(view, r));
  hit.sort(
    (a, b) =>
      (a.lon - midLon) ** 2 +
      (a.lat - midLat) ** 2 -
      ((b.lon - midLon) ** 2 + (b.lat - midLat) ** 2),
  );
  return {
    keys: hit.slice(0, limit).map(chunkKey),
    tooMany: hit.length > limit,
  };
}

/** How many campsites the index says are in view, without fetching any. */
export function countInView(
  index: readonly RegionSummary[],
  view: Bounds,
): number {
  return index.reduce((n, r) => (overlaps(view, r) ? n + r.count : n), 0);
}

/**
 * What the reader is told, in one value.
 *
 * 🔴 The states are distinct on purpose, and 'failed' is the one this
 * card exists for. The map used to swallow a failed fetch with a comment
 * saying an empty map "still renders honestly" — and it does not. Seen
 * on screen 24.09.2026: the data request answered 500 and the panel read
 * "0 campsites", which a reader reads as "there are none here". An empty
 * map is the one thing that must never be silent.
 */
export type MapDataState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'wide'; count: number }
  | { kind: 'failed'; what: string };

export function dataMessage(state: MapDataState): string | null {
  switch (state.kind) {
    case 'loading':
      return 'Loading campsites…';
    case 'wide':
      return `${state.count.toLocaleString('en-GB')} campsites in view — zoom in to see them individually. The circles are regions, sized by how many each holds.`;
    case 'failed':
      return `The campsites could not be loaded (${state.what}). This map is empty because of that, not because there is nothing here.`;
    case 'ready':
      return null;
  }
}

/**
 * What the filter panel's count says, given what the map actually knows.
 *
 * 🔴 It printed a bold `0` whenever no individual campsites were
 * loaded — which is the normal state of this map, because zoomed out it
 * draws regions and fetches no markers at all. So "0 campsites" sat
 * directly above "3,116 campsites in view", and the two disagreed on
 * one screen. A reader reads the bold zero and leaves.
 *
 * That is the CAMP-127 defect a second time: `shown` was never wrong —
 * it is exactly the number of things drawn — but the SENTENCE built
 * from it claimed something else. Every test was green. It was found by
 * opening the page and reading it.
 *
 * 🔴 A number is returned only in `ready`, where one exists. The other
 * three states each say what they are, because silence and zero are the
 * two ways this panel has already misled somebody.
 */
export function filterCountLabel(
  state: MapDataState,
  counts: { shown: number; total: number; filtering: boolean },
): { text: string; value: number | null } {
  switch (state.kind) {
    case 'ready':
      return {
        value: counts.shown,
        text: counts.filtering
          ? ` of ${counts.total.toLocaleString('en-GB')} campsites`
          : ' campsites',
      };
    case 'loading':
      return { value: null, text: 'Counting campsites…' };
    case 'wide':
      // 🔴 No number invented from the region totals. Filters apply to
      // individual campsites, and none are loaded — a count that
      // silently ignored the filters the reader just set would be worse
      // than admitting it has not counted.
      return {
        value: null,
        text: counts.filtering
          ? 'Zoom in to count the campsites your filters match.'
          : 'Zoom in to count campsites.',
      };
    case 'failed':
      // 🔴 Not "0", and not silence. The message above says what failed;
      // this says why there is no number, so the two agree.
      return { value: null, text: 'Not counted — the campsites did not load.' };
  }
}
