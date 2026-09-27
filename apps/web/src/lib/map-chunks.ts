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
// browser — which is the only way to test the cases that matter: an index
// that failed to load, a chunk that came back empty, a view whose chunks
// weigh more than the reader should be asked to download.
//
// 🔴 What this file does NOT do: the antimeridian.
//
// The header used to list "a viewport crossing the antimeridian" among
// the cases this purity lets us test. There was no handling and no test —
// it was a promise in a comment. `overlaps` below now says plainly that
// it reads a box as west ≤ east, and a unit test pins that reading, so
// nobody has to find out by experiment. Measured against the live index
// on 27.09.2026, the EU-27 data spans longitude −31.27 … 34.55, so no
// region bbox comes within 145° of ±180° and the case cannot arise while
// the project is EU-27.

import { knownAmenities } from './map-filter';
import type { Amenities, AmenityKey } from './api';

export interface RegionSummary {
  country: string;
  region: string | null;
  slug: string;
  count: number;
  /**
   * How many bytes this region's chunk file weighs, uncompressed.
   *
   * 🔴 Measured, not modelled. The index route builds each chunk body
   * with `chunkBody` below — the same function the chunk route serves —
   * and records its length, so this is the number of bytes the browser
   * will actually receive for this key.
   *
   * It exists because the only bound the map had was a count of chunks,
   * and chunks are not the same size. Measured 27.09.2026 across all
   * 812: median 6 192 B, largest 418 923 B (de/bayern), and between 172
   * and 402 bytes per campsite. A flat "bytes per campsite" ceiling of
   * 402 would have overstated a window's real weight by 1.38× to 2.34×
   * (median 1.60×) — which, at a 1.5 MB budget, blocks 391 of 5 520
   * detail-zoom windows where the true weight blocks 98. Four times as
   * many readers told to zoom in for no reason. Hence real bytes.
   */
  bytes: number;
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

/** One campsite as the API's map routes hand it over. */
export interface ChunkMarker {
  slug: string;
  name: string | null;
  type: string;
  lat: number;
  lon: number;
  amenities: Partial<Amenities> | null;
  /** 🔴 Null when the campsite has no page — see canonicalPath. */
  path: string | null;
}

export interface ChunkFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    slug: string;
    name: string | null;
    type: string;
    /** Null rather than a broken URL. The popup renders text instead. */
    href: string | null;
  } & Partial<Record<AmenityKey, 'yes' | 'no'>>;
}

/**
 * One chunk file, exactly as the browser receives it.
 *
 * 🔴 One function, because two callers need the same bytes for
 * different reasons: the chunk route serves this string, and the index
 * route measures its length to fill `RegionSummary.bytes`. Written
 * twice, the index would be describing a file the map does not fetch —
 * and the map would be refusing views on a number about nothing.
 */
export function chunkBody(markers: readonly ChunkMarker[]): string {
  const features: ChunkFeature[] = markers.map((m) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
    properties: {
      slug: m.slug,
      name: m.name,
      type: m.type,
      href: m.path,
      // Only what is known — an absent key means unknown, which is what
      // the filters already assume. See knownAmenities.
      ...knownAmenities(m.amenities),
    },
  }));
  return JSON.stringify({ type: 'FeatureCollection', features });
}

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
 *
 * 🔴 Both boxes are read as west ≤ east. A viewport wrapped across the
 * antimeridian — MapLibre can report west 170, east −170 — is NOT
 * handled: this function would read it as the 340° the reader is not
 * looking at and answer for that instead. Stated rather than handled,
 * because handling it would be untested code for a case our data cannot
 * produce (EU-27, longitude −31.27 … 34.55, measured 27.09.2026) and the
 * test below pins the reading so the limit is checked rather than
 * remembered.
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
 * The most a view may weigh before the map declines to draw it.
 *
 * 🔴 A number of BYTES, and every part of it is measured.
 *
 * What it replaces was `limit = 60`, whose comment said "a bound on
 * bytes, not a filter" while the code counted chunks. Chunks are not the
 * same size — 172 to 402 bytes per campsite, and 6 kB to 419 kB per
 * file — so the count said nothing about what the reader downloads.
 * Driving the real index over 5 520 detail-zoom windows (4.73° × 1.56°,
 * step ¼ window, 27.09.2026): only 42 windows exceeded 60 chunks, and
 * the heaviest window the old bound LET THROUGH was 15 chunks, 7 334
 * campsites, 1.96 MB — while the windows it blocked were mostly cheap
 * (the worst, 127 chunks, weighed 0.41 MB). It was blocking the wrong
 * views and passing the expensive ones.
 *
 * 1.5 MB, because both ends of that are measured too:
 *
 *  · The ceiling. CAMP-127 argued one world file was unviable at 2.4 MB
 *    for 9 830 markers. A bound that allows almost that much is not a
 *    bound; 1.5 MB sits well under the number this architecture was
 *    built to escape.
 *
 *  · The floor. A chunk is a WHOLE region, so zooming in does not make
 *    it smaller — at the worst point in EU-27 (lon 10.196, lat 49.406,
 *    where the Bayern, Baden-Württemberg and Hessen bboxes overlap) any
 *    view, however tight, pulls 0.92 MB. A budget below that would make
 *    "zoom in to see them individually" a promise the map can never
 *    keep, anywhere in southern Germany. 1.5 MB clears it by 1.6×.
 *
 * At 1.5 MB, 98 of those 5 520 windows (1.8%) are refused — so it fires,
 * which is the point, and it fires on the dense Benelux–Rhineland views
 * that really are megabytes.
 */
export const VIEW_BUDGET_BYTES = 1_500_000;

/**
 * The most a single campsite has ever weighed in a chunk, measured.
 *
 * 🔴 Only a fallback, and only for one case: an index served from a
 * cache that predates `bytes`. `undefined` would make the sum NaN, and
 * `NaN > budget` is false — so a stale index would switch the safeguard
 * off silently, which is the exact failure shape this project keeps
 * finding. Measured 27.09.2026 across all 812 chunks: 172 B per
 * campsite at best, 253 median, 402 at worst. The worst case is the
 * only honest number to guess with.
 */
const WORST_BYTES_PER_CAMPSITE = 402;

const weightOf = (r: RegionSummary): number =>
  Number.isFinite(r.bytes) ? r.bytes : r.count * WORST_BYTES_PER_CAMPSITE;

/**
 * Which chunks a viewport needs, nearest the middle first.
 *
 * 🔴 Ordered, because the order is what the reader sees. Fetches are
 * started in this order, so the centre of the screen fills in before the
 * edge.
 *
 * `budgetBytes` is a bound on bytes and is now spent in bytes: crossing
 * it means the view is too heavy for markers, and the caller must say so
 * rather than draw a part of the answer as if it were all of it.
 */
export function chunksInView(
  index: readonly RegionSummary[],
  view: Bounds,
  budgetBytes = VIEW_BUDGET_BYTES,
): { keys: string[]; tooMany: boolean; bytes: number } {
  const midLon = (view.west + view.east) / 2;
  const midLat = (view.south + view.north) / 2;
  const hit = index.filter((r) => overlaps(view, r));
  hit.sort(
    (a, b) =>
      (a.lon - midLon) ** 2 +
      (a.lat - midLat) ** 2 -
      ((b.lon - midLon) ** 2 + (b.lat - midLat) ** 2),
  );
  // 🔴 Distinct keys. Two region NAMES can slugify to one chunk
  // key — `slugifyRegion` strips punctuation, so "Nord-Pas-de-Calais"
  // and "Nord Pas de Calais" would collide — and the caller fetches
  // each key it is given. A repeated key therefore means the same file
  // appended twice and every campsite in it drawn twice.
  //
  // Not reachable in today's data (measured 25.09.2026: 812 regions,
  // 812 distinct keys), and one line keeps it that way. The sibling
  // defect, where the loop claimed keys one at a time and a concurrent
  // refresh grabbed a later one, WAS reachable and was measured.
  //
  // 🔴 The weight is summed over the DISTINCT keys, for the same
  // reason: the reader downloads each file once, so counting a
  // collided region twice would refuse a view that costs one file.
  const seen = new Set<string>();
  const keys: string[] = [];
  let bytes = 0;
  for (const r of hit) {
    const key = chunkKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    bytes += weightOf(r);
  }
  return { keys, tooMany: bytes > budgetBytes, bytes };
}

/** How many campsites the index says are in view, without fetching any. */
export function countInView(
  index: readonly RegionSummary[],
  view: Bounds,
): number {
  return index.reduce((n, r) => (overlaps(view, r) ? n + r.count : n), 0);
}

/** How many bytes the chunks a view needs weigh, without fetching any. */
export function bytesInView(
  index: readonly RegionSummary[],
  view: Bounds,
): number {
  return chunksInView(index, view, Infinity).bytes;
}

/**
 * The campsites that are actually on screen.
 *
 * 🔴 The one rule for "in view", used by the panel's count and by the
 * attributes the specs read. It was written out by hand in two places in
 * campsite-map.tsx — twice inside the same function — and a rule with
 * three copies is a rule waiting to disagree with itself.
 *
 * 🔴 And this set is COMPLETE, which is what makes it usable as a
 * denominator. A campsite inside the view lies inside its own region's
 * bounding box, so that box overlaps the view, so `chunksInView` asked
 * for that chunk. Once the map reports `ready` every such chunk is in
 * hand — so "N of M in view" is a statement about the world and not
 * about which way the reader has been dragging. The unit test drives
 * exactly that argument.
 */
export function withinView<
  F extends { geometry: { coordinates: [number, number] } },
>(features: readonly F[], view: Bounds): F[] {
  return features.filter((f) => {
    const [lon, lat] = f.geometry.coordinates;
    return (
      lon >= view.west &&
      lon <= view.east &&
      lat >= view.south &&
      lat <= view.north
    );
  });
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
  | { kind: 'failed'; what: string; loaded: number };

export function dataMessage(state: MapDataState): string | null {
  switch (state.kind) {
    case 'loading':
      return 'Loading campsites…';
    case 'wide':
      // 🔴 "in the regions in view", not "in view".
      //
      // `countInView` sums WHOLE regions whose bbox touches the
      // viewport, because at this zoom no individual campsite has been
      // fetched — that is the entire point of the region view. So the
      // number is real but it is not a count of what is on screen:
      // measured against the API for the same box, 3 116 against 2 456
      // (+27%) at the opening view and 13 380 against 9 479 (+41%)
      // zoomed further out.
      //
      // The old sentence claimed the viewport. Rather than invent a
      // precision we do not have, it now says which set it counted —
      // and the circles on screen are exactly those regions.
      return `${state.count.toLocaleString('en-GB')} campsites in the regions in view — zoom in to see them individually. The circles are those regions, sized by how many each holds.`;
    case 'failed':
      // 🔴 An empty map and a partly-loaded one are different
      // sentences. `refresh` reaches this state when ONE chunk of many
      // fails: measured, 13 of 14 loaded, 848 campsites drawn on
      // screen, and the page said "This map is empty because of that".
      return state.loaded > 0
        ? `Some campsites could not be loaded (${state.what}). The ${state.loaded.toLocaleString('en-GB')} shown here are real; others are missing, so do not read this map as complete.`
        : `The campsites could not be loaded (${state.what}). This map is empty because of that, not because there is nothing here.`;
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
 *
 * 🔴 Both numbers are about the VISIBLE AREA, and the sentence says so.
 *
 * The denominator used to be every campsite loaded so far. Chunks are
 * deliberately never discarded, so that number grew as the reader
 * dragged the map: the same screen said "306 of 1 308" and, after a pan
 * out and back, "306 of 4 100". It matched neither the screen nor the
 * database — and the heading above it said 61 422. A denominator that
 * only makes sense if you know which way somebody has been dragging is
 * not a denominator.
 *
 * "In view" is a set the reader can see and check by counting the
 * markers, and `withinView` explains why it is complete.
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
          ? ` of ${counts.total.toLocaleString('en-GB')} campsites in view`
          : ' campsites in view',
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
      // 🔴 Not "0", and not silence. The message above says what
      // failed; this says why, so the two agree.
      //
      // And when SOME loaded, the number of those is real — saying
      // "not counted" over 848 visible campsites was its own small lie.
      //
      // 🔴 "that loaded", not "in view": this is the one state where the
      // in-view set is NOT complete, because a chunk covering part of
      // this screen is missing. The sentence has to stop claiming the
      // area and claim only the fetch.
      return state.loaded > 0
        ? {
            value: counts.shown,
            text: counts.filtering
              ? ` of ${counts.total.toLocaleString('en-GB')} campsites in view that loaded`
              : ' campsites in view that loaded',
          }
        : { value: null, text: 'Not counted — the campsites did not load.' };
  }
}
