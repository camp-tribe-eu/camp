'use client';

import { useEffect, useRef, useState } from 'react';
// 🔴 Named imports: maplibre-gl 6 is ESM-only and dropped the default
// export, so `import maplibregl from 'maplibre-gl'` compiles under
// TypeScript and then fails at bundle time with "does not contain a
// default export". Most examples online still show the old form.
import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
  type MapGeoJSONFeature,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  DEFAULT_SOURCE_ID,
  INITIAL_VIEW,
  MAP_SOURCES,
  type MapSource,
} from '@/lib/map-sources';
import {
  AMENITY_KEYS,
  AMENITY_LABEL,
  SPOT_TYPES,
  type AmenityKey,
} from '@/lib/api';
import {
  applyFilters,
  EMPTY_FILTERS,
  fromSearchParams,
  toSearchParams,
  type MapFilterState,
  type SpotProperties as FilterProperties,
} from '@/lib/map-filter';
import MapFilters from './map-filters';
import {
  DETAIL_ZOOM,
  chunkUrl,
  chunksInView,
  countInView,
  dataMessage,
  withinView,
  type Bounds,
  type MapDataState,
  type RegionSummary,
} from '@/lib/map-chunks';
import {
  DEFAULT_LAYERS,
  LAYERS,
  toggleLayer,
  type LayerId,
} from '@/lib/map-layers';
import {
  WILDFIRE_URL,
  firesInView,
  formatDay,
  formatInstant,
  readFeed,
  wildfireNote,
  wildfireState,
  type WildfireFeature,
  type WildfireState,
} from '@/lib/wildfires';

/** One campsite in the collection the map draws. */
interface SpotFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: FilterProperties;
}

// CAMP-31/32: the map, the switch that makes its supplier replaceable,
// and the markers.
//
// The two cards' acceptance criteria are behaviours, and each is
// implemented deliberately rather than falling out of the library:
//
//   1. the switch really changes the tile source — proven by the browser
//      fetching a different style document, not by the button changing
//      colour;
//   2. when one source is unavailable the map keeps working;
//   3. points cluster at low zoom, because 55 000 separate circles over
//      Europe is neither readable nor drawable;
//   4. a marker says what we actually know about a campsite, and never
//      more than that.

const INDEX_URL = '/data/spots/index.json';
const SOURCE_ID = 'campsites';
const REGION_SOURCE = 'campsite-regions';
const REGION_CIRCLE = 'campsite-region-circles';
const REGION_COUNT = 'campsite-region-count';
const CLUSTER_LAYER = 'campsite-clusters';
const COUNT_LAYER = 'campsite-cluster-count';
const POINT_LAYER = 'campsite-points';
// CAMP-153: the Copernicus burnt-area perimeters.
const FIRE_SOURCE = 'wildfires';
const FIRE_FILL = 'wildfire-areas';
const FIRE_LINE = 'wildfire-outlines';
/** Invisible, and the only thing a reader can realistically hit. */
const FIRE_HIT = 'wildfire-hit';
/** Everything under the pointer that means "a burnt area": the inside of a
 * big perimeter and the halo around a small one. */
const FIRE_CLICK_LAYERS = [FIRE_FILL, FIRE_HIT];

// 🔴 Tell MapLibre where its worker really is.
//
// The library locates the worker itself, with
// `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. After bundling,
// import.meta.url is the Next chunk, so it asks for a file that does not
// exist there, gets the HTML 404 page, and the browser rejects it:
// "non-JavaScript MIME type of text/html".
//
// That failure is quiet in the worst way. The map still appears, the
// controls still work, raster layers still draw — and every VECTOR layer
// is missing, ours included, because parsing vector tiles is the worker's
// whole job. It reads as a data or styling bug, and it cost real time.
//
// scripts/copy-maplibre-worker.mjs puts the worker and its one dependency
// in public/maplibre/ at build time; this points the library at them.
// Module scope, so it runs before any map is constructed.
setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

/**
 * 🔴 The one font every source in MAP_SOURCES serves.
 *
 * Checked, not assumed: all three OpenFreeMap styles declare exactly
 * `Noto Sans Regular/Bold/Italic` and the same glyph endpoint. A style
 * added later that serves different fonts would render the cluster
 * counts as nothing at all — silently, because a missing glyph range is
 * a console warning, not an error. Any new entry in MAP_SOURCES has to
 * be checked against this.
 */
const CLUSTER_FONT = ['Noto Sans Bold'];

/** What a campsite feature carries. Flat, because cluster leaves are flat. */
type SpotProperties = {
  slug: string;
  name: string | null;
  type: string;
  href: string;
} & Record<AmenityKey, string>;

/**
 * The closest thing we hold to a price. OSM records whether a site
 * charges, not how much — so this says which kind of place it is and
 * stops there. Inventing a number would be the easiest thing on this
 * page to get wrong and the hardest for a reader to check.
 */
const TYPE_LABEL: Record<string, string> = {
  free: 'Free',
  paid: 'Charges a fee',
  wild: 'Wild camping',
  camper_stop: 'Camper stop, free',
  rv_park: 'Motorhome park',
};

/**
 * CAMP-127: one circle per region, for a view too wide for markers.
 *
 * 🔴 Drawn from the index, which is already in hand — so the wide view
 * costs nothing beyond what was fetched to decide what is in view. The
 * alternative was an empty map with a note saying to zoom in, and a
 * reader looking at an empty map does not read notes.
 *
 * The circle sits on the CENTROID OF THE CAMPSITES, not of the region's
 * shape: a region whose sites are all on one coast would otherwise put
 * its circle inland, where zooming in finds nothing.
 */
function drawRegions(
  m: InstanceType<typeof MapLibreMap>,
  regions: readonly RegionSummary[],
) {
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: regions.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
      properties: { count: r.count, label: String(r.count) },
    })),
  };

  const existing = m.getSource(REGION_SOURCE) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data);
  } else {
    m.addSource(REGION_SOURCE, { type: 'geojson', data });
  }

  if (!m.getLayer(REGION_CIRCLE)) {
    m.addLayer({
      id: REGION_CIRCLE,
      type: 'circle',
      source: REGION_SOURCE,
      paint: {
        'circle-color': '#404B62',
        'circle-opacity': 0.85,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#0B0F17',
        // Area in proportion to the count, so a region with four times
        // as many looks twice as wide — the honest encoding. Clamped,
        // because Bayern's 1 433 against a median of 26 would otherwise
        // swallow half the continent.
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['sqrt', ['get', 'count']],
          1,
          6,
          38,
          26,
        ],
      },
    });
  }
  if (!m.getLayer(REGION_COUNT)) {
    m.addLayer({
      id: REGION_COUNT,
      type: 'symbol',
      source: REGION_SOURCE,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': CLUSTER_FONT,
        'text-size': 11,
        'text-allow-overlap': false,
      },
      paint: { 'text-color': '#FFFFFF' },
    });
  }
}

/**
 * Where the map is looking, in the shape every rule in map-chunks takes.
 *
 * 🔴 One conversion from MapLibre's LngLatBounds, because three copies
 * of it were already drifting: `refresh` built one object, `publishCounts`
 * called the four getters inline for `data-bounds` and then called them
 * again for `data-in-view`. A count and the box it is supposedly inside
 * have to come from the same four numbers.
 */
function boundsOf(m: InstanceType<typeof MapLibreMap>): Bounds {
  const b = m.getBounds();
  return {
    west: b.getWest(),
    south: b.getSouth(),
    east: b.getEast(),
    north: b.getNorth(),
  };
}

/** Take the region circles away once real markers are on the map. */
function clearRegions(m: InstanceType<typeof MapLibreMap>) {
  for (const id of [REGION_COUNT, REGION_CIRCLE]) {
    if (m.getLayer(id)) m.removeLayer(id);
  }
  if (m.getSource(REGION_SOURCE)) m.removeSource(REGION_SOURCE);
}

/**
 * Hide the individual campsites, leaving the region circles alone.
 *
 * 🔴 Zooming back out used to leave the markers underneath. The
 * source keeps whatever was last set, so the map drew clusters AND the
 * circles that stand for the same campsites — measured: 5 circles over
 * 727 clustered campsites, with the status line saying "13,380
 * campsites in the regions in view" and the panel saying "Zoom in to
 * count campsites". Three encodings of one thing on one screen, two of
 * them counting it twice.
 *
 * The features are NOT thrown away, only un-drawn: `everything.current`
 * still holds them, so zooming back in costs no fetch.
 */
function hideMarkers(m: InstanceType<typeof MapLibreMap>) {
  const source = m.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  source?.setData({ type: 'FeatureCollection', features: [] });
}

/**
 * CAMP-153: the burnt areas, as shapes rather than as a picture.
 *
 * 🔴 Two layers, not one. A filled polygon alone disappears at the zoom
 * most readers use: the median burnt area in the measured fortnight is
 * 12 ha, which is under a pixel across Europe. The outline carries a
 * minimum width, so a small fire is still a visible mark in the right
 * place — and the fill, when you zoom in, is the real perimeter.
 *
 * 🔴 Underneath the campsites, always. The question this layer answers is
 * "is there a fire near the place I am going", and the place has to stay
 * visible for the question to make sense.
 */
function attachFires(m: InstanceType<typeof MapLibreMap>) {
  if (!m.getSource(FIRE_SOURCE)) {
    m.addSource(FIRE_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      // 🔴 NO SIMPLIFICATION, and this is what half of the layer hung on.
      //
      // The GeoJSON source runs every shape through geojson-vt, whose
      // default tolerance (0.375) DROPS any polygon smaller than the
      // tolerance at the tile's zoom. Measured 29.09.2026 on the real map
      // with the shipped 278 perimeters, asking MapLibre itself which
      // features it holds: at the opening zoom 138 of 278 were in no tile
      // at all — no fill, no outline, no hit line, nothing to click, and
      // the sentence under the map still counting them. The layer looked
      // like a sparse fortnight when it was half a fortnight. The largest
      // one dropped was 0.011° across, so this is not only the specks.
      //
      // At tolerance 0 nothing is dropped or simplified: 278 of 278 were
      // clickable at the opening zoom afterwards (same measurement). The
      // shapes are already rounded onto a ~110 m grid by the fetch script,
      // so there is little left to simplify; the whole file is 251 KB.
      tolerance: 0,
    });
  }
  if (!m.getLayer(FIRE_FILL)) {
    m.addLayer({
      id: FIRE_FILL,
      type: 'fill',
      source: FIRE_SOURCE,
      paint: {
        // Burnt ground, not alarm red: the campsite markers are already
        // #C83D28, and two reds on one map is a reader guessing which is
        // which. This one reads as scorched earth and stays distinct.
        'fill-color': '#5B3A29',
        'fill-opacity': 0.55,
      },
    });
  }
  if (!m.getLayer(FIRE_LINE)) {
    m.addLayer({
      id: FIRE_LINE,
      type: 'line',
      source: FIRE_SOURCE,
      paint: {
        'line-color': '#8A4B2A',
        // 🔴 Wide enough at low zoom to BE the mark, because the fill is
        // not one. Measured over the shipped 278 perimeters (512 px tiles,
        // as MapLibre draws them): at z6.2 the median is 0.7 px across and
        // 254 of 278 are under 3 px, so what a reader sees on the opening
        // view is this outline and nothing else. It narrows as the real
        // shape grows past it. (An earlier comment here said 0.31 px: it
        // had assumed 256 px tiles and was half the truth.)
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3, 10, 2.5, 14, 2],
        'line-opacity': 0.95,
      },
    });
  }
  // 🔴 THE LAYER A READER CAN ACTUALLY CLICK.
  //
  // Click and cursor used to be bound to FIRE_FILL alone, and the numbers
  // say what that meant: at the zoom /map opens at, the median burnt area
  // is 0.7 px wide, 254 of 278 are under three and the largest is 8 px.
  // The e2e could not see it because its fixture was an 84 px square
  // clicked dead centre — the test was sized around the defect.
  //
  // So: a transparent line, wide enough to hit with a mouse or a thumb,
  // tapering once the perimeter itself is big enough to aim at. Invisible
  // but queryable — MapLibre hit-tests what is rendered, and a fully
  // transparent line still is.
  if (!m.getLayer(FIRE_HIT)) {
    m.addLayer({
      id: FIRE_HIT,
      type: 'line',
      source: FIRE_SOURCE,
      paint: {
        'line-color': '#000000',
        'line-opacity': 0,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 16, 10, 12, 14, 8],
      },
    });
  }
}

/**
 * The card shown when a burnt area is clicked.
 *
 * 🔴 Every sentence here is a report with a date on it, and none of them
 * is an instruction. "A fire was recorded here on 14 September" is
 * Copernicus's statement, which CC BY 4.0 lets us mirror with credit;
 * "do not drive here" would be ours, and no licence covers it and no
 * disclaimer repairs it (docs/road-hazard-sources.md §2).
 *
 * 🔴 DOM, not HTML, for the same reason as markerCard: place names come
 * from somebody else's database and are untrusted input.
 */
function fireCard(p: WildfireFeature['properties'], attribution: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'ct-popup';

  const title = document.createElement('strong');
  title.className = 'ct-popup-title';
  // Never invented: EFFIS leaves the commune blank on some records, and
  // "Unknown place" would be a claim of its own.
  title.textContent = p.place || `Burnt area in ${p.country}`;
  root.append(title);

  const when = document.createElement('p');
  when.className = 'ct-popup-kind';
  const day = formatDay(p.date);
  when.textContent = day
    ? `Fire recorded ${day} — about ${p.hectares.toLocaleString('en-GB')} ha burnt`
    : `About ${p.hectares.toLocaleString('en-GB')} ha burnt`;
  root.append(when);

  const who = document.createElement('p');
  who.className = 'ct-popup-empty';
  who.textContent = attribution;
  root.append(who);

  return root;
}

export default function CampsiteMap() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<InstanceType<typeof MapLibreMap> | null>(null);
  const popup = useRef<InstanceType<typeof Popup> | null>(null);
  const [sourceId, setSourceId] = useState(DEFAULT_SOURCE_ID);
  const [failed, setFailed] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const tried = useRef<Set<string>>(new Set());
  const applied = useRef<string>(MAP_SOURCES[0].style);

  // CAMP-35. The whole collection, held once, and the filtered view of it.
  //
  // 🔴 The source is fed an object rather than the URL it used to be
  // given. MapLibre clusters when the SOURCE loads, so hiding features
  // with a layer filter leaves the counts computed over everything: a
  // bubble saying twelve that opens to three. Re-setting the data makes
  // it cluster the set the reader asked for.
  const everything = useRef<SpotFeature[]>([]);
  const drawn = useRef<SpotFeature[]>([]);
  // 🔴 Read from the URL at the first render, not in an effect.
  //
  // It was an effect, and the bug was subtle: the effect that WRITES the
  // query string also runs on mount, with the empty state, so it cleared
  // `?amenities=toilets` a tick before the effect that reads it ran.
  // Opening a shared filtered link showed all 1079 campsites and a clean
  // URL, with nothing to indicate anything had been dropped.
  //
  // Safe at render because this component is only ever loaded through
  // map-embed.tsx with `ssr: false`, so there is no server pass — the
  // guard is there for the day somebody changes that.
  const [filters, setFilters] = useState<MapFilterState>(() =>
    typeof window === 'undefined'
      ? EMPTY_FILTERS
      : fromSearchParams(window.location.search, SPOT_TYPES, AMENITY_KEYS),
  );
  /**
   * Two scopes, named apart, because they answer different questions.
   *
   * 🔴 `shown` / `total` / `unknownExcluded` are over everything
   * FETCHED — the map's own bookkeeping, and what the specs use as a
   * barrier for "a chunk has arrived".
   *
   * 🔴 `inView*` are over the visible area, and they are what the
   * reader is shown. CAMP-133: a denominator that only makes sense if
   * you know how far somebody has panned is not a denominator.
   */
  const [tally, setTally] = useState({
    shown: 0,
    total: 0,
    unknownExcluded: 0,
    inViewShown: 0,
    inViewTotal: 0,
    inViewUnknownExcluded: 0,
  });
  // CAMP-127: the table of contents, and which of its chunks are in hand.
  const index = useRef<RegionSummary[]>([]);
  const loaded = useRef<Set<string>>(new Set());
  /**
   * How many chunk fetches are in flight, across ALL refreshes.
   *
   * 🔴 `ready` has to mean "nothing is still coming", and it did not.
   * A `moveend` during a fetch starts a second refresh; if every key it
   * needs is already claimed its `missing` is empty, so it skips the
   * loop and falls straight through to `setDataState({kind:'ready'})`
   * while the first call is still downloading.
   *
   * Measured in the production build: `ready` was published with three
   * fetches outstanding and 7 of 14 chunks loaded — and it never went
   * back, because `loading` is only set when `missing` is non-empty. So
   * the reader was told the map was complete over a third of the data,
   * and the spec that waits on this attribute was comparing a
   * half-loaded map against a complete API answer.
   *
   * Claiming every key up front (the fix for the duplicate chunk) makes
   * the empty-`missing` case MORE common, so that fix needed this one.
   */
  const inFlight = useRef(0);
  /**
   * `publishDrawn`, reachable from outside the map effect.
   *
   * 🔴 The DRAWN numbers only — never the rendered ones, which are true
   * only after a paint. See the two functions for why they are two.
   *
   * 🔴 The counts were published ONLY on the map's `idle` event, and
   * `data-map-state` is set when fetching stops — two different moments.
   * So a reader of the attributes could get numbers from the idle
   * BEFORE the last chunk merged, while the state already said `ready`.
   *
   * Measured: a spec waited for `ready`, then read `data-in-view` as 36
   * where the API, the database and the chunk files all said 54 — the
   * missing 18 were one region that had arrived after the last idle.
   * The map on screen was correct; only its published description was
   * behind.
   */
  const publishRef = useRef<(() => void) | null>(null);
  /**
   * Chunks that failed and have not since succeeded.
   *
   * 🔴 `failures` was local to one `refresh` call, and that is not
   * enough. A call that fails publishes `failed`; a later call whose
   * `missing` is empty reaches the same tail with nothing to report and
   * publishes `ready` over it. The map then claims to be complete while
   * a region it could not fetch is absent, and nothing tries again
   * until the reader happens to move.
   *
   * Kept across calls and cleared per key on success.
   */
  const failedKeys = useRef<Map<string, string>>(new Map());
  /** One pending "try again when the style has loaded", never a queue. */
  const awaitingStyle = useRef(false);
  const [dataState, setDataState] = useState<MapDataState>({ kind: 'loading' });

  // CAMP-153. The fire layer's three pieces of state, kept apart on
  // purpose: what arrived, which layers the reader has on, and how many
  // of the fires fall inside what they are looking at.
  //
  // 🔴 `loading`, not `missing`, until the fetch has actually answered.
  // The two produce the same empty map and the reader cannot tell them
  // apart, so the sentence under the map has to.
  const [fireState, setFireState] = useState<WildfireState>({ kind: 'loading' });
  const fires = useRef<WildfireFeature[]>([]);
  const [firesHere, setFiresHere] = useState<number | null>(null);
  /**
   * The credit, as the feed itself spells it, for the popup.
   *
   * 🔴 A ref and not a constant in this file. CC BY 4.0 asks for credit to
   * whoever the data came from, and a string hard-coded here would keep
   * saying "Copernicus EFFIS" on the day the pipeline starts writing
   * something else — a licence breach that no test of ours would see,
   * because it would be testing the same constant. It travels with the
   * data, and `readFeed` refuses a feed that carries none.
   */
  const attributionRef = useRef('');
  /**
   * Which datasets are drawn.
   *
   * 🔴 Local state, deliberately not in the query string. The filters own
   * the URL through `toSearchParams`, which REPLACES it wholesale on every
   * tick of a checkbox — a `layers=` parameter written beside it would be
   * erased by the next filter change, and a shared link would silently
   * open with different layers from the one that was sent. Joining the two
   * is CAMP-122's job and it is not this card's to do badly.
   */
  const [layers, setLayers] = useState<LayerId[]>(() => DEFAULT_LAYERS());
  const firesOn = layers.includes('wildfire' as LayerId);

  const active =
    MAP_SOURCES.find((s) => s.id === sourceId) ?? MAP_SOURCES[0];
  const fireNote = wildfireNote(fireState, firesHere);

  // Created once. Changing the style afterwards goes through setStyle,
  // because re-creating the map would throw away the reader's position.
  useEffect(() => {
    if (!container.current || map.current) return;

    // 🔴 The constructor throws when the browser cannot give it a WebGL
    // context, and MapLibre needs one for everything it draws.
    //
    // Unhandled, that exception escapes into React's render and Next
    // replaces the ENTIRE page with "Application error: a client-side
    // exception has occurred" — including the country list underneath,
    // which is precisely the fallback that was supposed to make this
    // page survive without the map. One missing capability took out the
    // part that did not need it.
    //
    // It is not a theoretical browser either. This is exactly how the
    // page behaved in headless Firefox with no GPU, and the same is true
    // of a reader who has disabled WebGL or whose driver is
    // blocklisted.
    let m: InstanceType<typeof MapLibreMap>;
    try {
      m = new MapLibreMap({
        container: container.current,
        style: MAP_SOURCES[0].style,
        center: [INITIAL_VIEW.lng, INITIAL_VIEW.lat],
        zoom: INITIAL_VIEW.zoom,
        attributionControl: false,
      });
    } catch {
      setUnsupported(true);
      return;
    }
    map.current = m;

    m.addControl(new NavigationControl({ showCompass: false }));
    // 🔴 No customAttribution here. OpenFreeMap's styles already declare
    // their own, and MapLibre appends ours to it rather than replacing
    // it, so the credit rendered twice on one line. It would also go
    // stale on switching, because the control is built once and the
    // source changes afterwards. The control shows whatever the current
    // style claims; the paragraph below the map is our own guarantee
    // that the credit is there even if a style ever omits it.
    m.addControl(new AttributionControl({ compact: true }));

    // 🔴 setStyle() discards every source and layer we added — they
    // belong to the old style object, not to the map. So the campsites
    // are (re)attached on every styledata event, not once on load.
    // Without this the points vanish the first time someone switches,
    // which looks like the data broke rather than the style changing.
    const attach = () => {
      // 🔴 First, so every campsite marker sits on top of every perimeter.
      // Also here rather than in its own effect because setStyle discards
      // sources and layers wholesale — the fire layer has to be restored
      // on each styledata exactly like the campsites, and the region
      // circles are in this file's history as the thing that was forgotten.
      attachFires(m);
      if (!m.getSource(SOURCE_ID)) {
        m.addSource(SOURCE_ID, {
          type: 'geojson',
          // 🔴 Whatever is currently drawn, not the URL. setStyle drops
          // every source, so this runs again on each style change — and
          // reading the ref means switching the basemap keeps the
          // reader's filters instead of silently restoring all 1079.
          data: { type: 'FeatureCollection', features: drawn.current },
          // CAMP-32. Clustering happens in the worker, over the whole
          // set, so the browser only ever draws what is on screen.
          cluster: true,
          // Above this zoom the reader is looking at one area and wants
          // the individual sites, not a bubble.
          clusterMaxZoom: 11,
          clusterRadius: 48,
        });
      }

      if (!m.getLayer(CLUSTER_LAYER)) {
        m.addLayer({
          id: CLUSTER_LAYER,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#404B62',
            'circle-opacity': 0.9,
            // Size by how many sites are inside, so the shape of the
            // data is visible before anything is clicked.
            'circle-radius': [
              'step',
              ['get', 'point_count'],
              15,
              10,
              20,
              50,
              26,
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF',
          },
        });
      }

      if (!m.getLayer(COUNT_LAYER)) {
        m.addLayer({
          id: COUNT_LAYER,
          type: 'symbol',
          source: SOURCE_ID,
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': CLUSTER_FONT,
            'text-size': 12,
            'text-allow-overlap': true,
          },
          paint: { 'text-color': '#FFFFFF' },
        });
      }

      if (!m.getLayer(POINT_LAYER)) {
        m.addLayer({
          id: POINT_LAYER,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 7],
            'circle-color': '#C83D28',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#FFFFFF',
          },
        });
      }
    };
    m.on('styledata', () => {
      attach();
      // 🔴 The region circles have to come back too.
      //
      // `attach` restores SOURCE_ID and the marker layers, because
      // setStyle drops every source — and the file already says so for
      // markers. The regions were added later and never joined that
      // guard: they live only inside `drawRegions`, which runs from
      // `refresh()`, which runs on `moveend`. Switching the basemap does
      // not move the map, so a reader zoomed out watched the circles
      // disappear under a sentence explaining what the circles mean, and
      // they stayed gone until they panned.
      //
      // `refresh()` redraws whichever of the two the current zoom calls
      // for, and costs no fetch — every chunk it needs is already in
      // `loaded`.
      void refreshRef.current();
      // 🔴 And the perimeters. `attachFires` re-creates the source empty,
      // so without this the fire layer silently emptied itself the first
      // time a reader changed the basemap — an empty fire layer being the
      // one thing this card exists to prevent.
      drawFiresRef.current();
    });

    // Clicking a cluster opens it, rather than doing nothing — the most
    // common complaint about clustered maps.
    const onClusterClick = async (e: {
      features?: MapGeoJSONFeature[];
      lngLat: { lng: number; lat: number };
    }) => {
      const feature = e.features?.[0];
      if (!feature) return;
      // A cluster standing inside a burnt area fires the fire card first
      // (see the registration order below). Opening the cluster is what the
      // reader asked for, so the card must not be left hanging where the
      // map used to be.
      popup.current?.remove();
      const source = m.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      if (!source) return;
      const clusterId = feature.properties?.cluster_id as number;
      try {
        const zoom = await source.getClusterExpansionZoom(clusterId);
        const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
        m.easeTo({ center: [lng, lat], zoom });
      } catch {
        // A cluster id from a stale tile: zooming a little still helps.
        m.easeTo({ center: [e.lngLat.lng, e.lngLat.lat], zoom: m.getZoom() + 2 });
      }
    };

    const onPointClick = (e: {
      features?: MapGeoJSONFeature[];
      lngLat: { lng: number; lat: number };
    }) => {
      const feature = e.features?.[0];
      if (!feature) return;
      popup.current?.remove();
      const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
      popup.current = new Popup({ offset: 12, maxWidth: '260px' })
        .setLngLat([lng, lat])
        // 🔴 DOM, not HTML. Campsite names come from OpenStreetMap,
        // which anyone may edit, so a name is untrusted input. Building
        // the card out of text nodes makes an injected `<script>` render
        // as the characters it is, with no escaping function to get
        // subtly wrong.
        .setDOMContent(markerCard(feature.properties as unknown as SpotProperties))
        .addTo(m);
    };

    // CAMP-153. Clicking a burnt area says what Copernicus recorded and
    // when, with the credit the licence requires on the card itself —
    // not only under the map, because this is where a reader is looking
    // when they are deciding about one particular place.
    const onFireClick = (e: {
      features?: MapGeoJSONFeature[];
      lngLat: { lng: number; lat: number };
    }) => {
      const feature = e.features?.[0];
      if (!feature) return;
      popup.current?.remove();
      popup.current = new Popup({ offset: 12, maxWidth: '260px' })
        .setLngLat([e.lngLat.lng, e.lngLat.lat])
        .setDOMContent(
          fireCard(
            feature.properties as unknown as WildfireFeature['properties'],
            attributionRef.current,
          ),
        )
        .addTo(m);
    };

    const pointer = () => {
      m.getCanvas().style.cursor = 'pointer';
    };
    const noPointer = () => {
      m.getCanvas().style.cursor = '';
    };

    // How many campsite slugs may be published for the tests to read.
  //
  // 🔴 A cap, because this is a DOM attribute on every reader's page,
  // not a debug channel. 200 slugs is about 5 KB; the whole of France in
  // view would be megabytes.
  const SLUG_LIST_CAP = 200;

  // 🔴 What is actually drawn right now, published on the container.
    //
    // Whether the map clusters is the criterion of this card, and it is
    // invisible to every ordinary assertion: the campsites live in a
    // WebGL canvas, so nothing about them reaches the DOM or the
    // accessibility tree. The alternative was to hang the map object on
    // `window` for the tests, which puts a handle on our internals into
    // every reader's browser. These two numbers say only what a person
    // looking at the screen can already see, and they are the first
    // thing worth knowing when the map misbehaves.
    // 🔴 CAMP-133: two groups, two moments of truth, two functions.
    //
    // Everything below `publishDrawn` is derived from `drawn.current` —
    // the set this component decided to draw. It is true the instant
    // that set changes.
    //
    // Everything in `publishRendered` is derived from
    // `queryRenderedFeatures` — what MapLibre has actually put on the
    // canvas. It is true only after a render, and clustering happens in
    // a worker, so it is not true when the data changes.
    //
    // 🔴 They were one function, and I called it from `applyFilterState`
    // so the in-view count would stop being stale. Measured: that one
    // call wrote a correct `data-in-view` of 2 456 and a false
    // `data-clustered-total` of 0 in the same instant, because nothing
    // had been rendered yet. On CI that made
    // "clusters are recounted when filtering" read a zero it was never
    // meant to see: the poll before it is satisfied by 0 (0 ≤ anything)
    // and the assertion after it demands more than 0.
    //
    // A count of what is on screen may only be written by the event
    // that says the screen has been painted.
    const publishRendered = () => {
      const el = container.current;
      if (!el) return;
      const rendered = (layer: string) =>
        m.getLayer(layer) ? m.queryRenderedFeatures({ layers: [layer] }) : [];
      const points = rendered(POINT_LAYER);
      const clusters = rendered(CLUSTER_LAYER);
      el.dataset.visibleClusters = String(clusters.length);
      el.dataset.visiblePoints = String(points.length);
      // 🔴 And the region circles, for the same reason.
      //
      // `drawRegions` is the one call that has to wait for the style,
      // so it is the one that can be quietly skipped and never retried.
      // Without a number for it, a test can only prove that nothing
      // threw — not that the circles arrived.
      el.dataset.visibleRegions = String(rendered(REGION_CIRCLE).length);

      // CAMP-35: how many campsites the bubbles claim to contain, plus
      // the ones drawn individually.
      //
      // 🔴 This is what makes "the filter really re-clustered" checkable.
      // MapLibre clusters when the SOURCE loads, so hiding a LAYER would
      // leave every bubble still counting campsites that are no longer
      // drawn — twelve on the circle, three when you click it. Comparing
      // this sum against the filtered total catches exactly that, and
      // nothing else on the page can: the numbers live in a WebGL canvas.
      el.dataset.clusteredTotal = String(
        clusters.reduce(
          (sum, c) => sum + Number(c.properties?.point_count ?? 0),
          points.length,
        ),
      );

      // Where the first campsite currently sits on screen, in container
      // pixels. Same reasoning as the counts: a marker's position is
      // knowable only by asking the map, and this is what tells us
      // whether a click landed on one.
      const first = points[0];
      if (first) {
        const [lng, lat] = (first.geometry as GeoJSON.Point).coordinates;
        const at = m.project([lng, lat]);
        el.dataset.pointAt = `${Math.round(at.x)},${Math.round(at.y)}`;
      } else {
        delete el.dataset.pointAt;
      }
    };

    const publishDrawn = () => {
      const el = container.current;
      if (!el) return;

      // 🔴 CAMP-127: the viewport, and how many of OUR features are in it.
      //
      // The map used to hold every campsite on earth, so a test could
      // compare it against the API asking for the whole world. It now
      // holds the regions in view, so the comparison has to be scoped —
      // and the scope has to come from the map itself, because only the
      // map knows where it is looking. Published together so the two can
      // never describe different moments.
      const view = boundsOf(m);
      el.dataset.bounds = [view.west, view.south, view.east, view.north]
        .map((n) => n.toFixed(6))
        .join(',');
      // 🔴 WHICH campsites, not only how many \u2014 capped, so this can
      // never become a megabyte of DOM attribute.
      //
      // The spec that compares the map against the API could only say
      // "5 against 3", which names nothing a person can go and look at.
      // The slugs are already public: every one of them is a URL on
      // this site, and each is drawn on screen right now.
      // 🔴 One definition of "in view", shared with the panel's count.
      // This filter was written out by hand here — twice, in the same
      // function, for the list and for the number — while the panel used
      // a third rule of its own. `withinView` is now the only copy.
      const inside = withinView(drawn.current, view);
      // 🔴 Every campsite has a slug, including the 135 with no
      // region and therefore no page — for those it is `path` that is
      // null, not `slug`. An earlier comment here claimed otherwise and
      // the spec was written to match it, so a correct map failed the
      // comparison in any viewport holding one of them.
      //
      // 🔴 A sentinel, not an empty string, when there are too many
      // to list. Empty reads as "none in view", and a spec comparing
      // the map with the API then reported "map 0, API 125" — a
      // frightening number that meant only that the cap had been hit.
      el.dataset.inViewSlugs =
        inside.length <= SLUG_LIST_CAP
          ? inside.map((f) => f.properties.slug).join(',')
          : '(capped)';

      el.dataset.inView = String(inside.length);
    };
    // 🔴 `idle` is the only writer of the rendered numbers, and it
    // writes the drawn ones too so the pair always describes one moment.
    m.on('idle', () => {
      publishDrawn();
      publishRendered();
    });
    // 🔴 On demand, the DRAWN ones only: the moment the set we decided
    // to draw changes, that count is true and the rendered one is not.
    publishRef.current = publishDrawn;

    // 🔴 CAMP-127: the map now fetches what is in view, so moving it is
    // a data event and not only a rendering one. `moveend` rather than
    // `move`: one fetch when the reader stops, not sixty while they drag.
    m.on('moveend', () => {
      void refreshRef.current();
      // 🔴 The fire sentence counts what is in THIS view, so it is only
      // true until the reader moves. Recomputed here rather than left to
      // go quietly wrong — "none of them is in this view" said over a
      // view that now holds four is the same class of lie as an empty map.
      drawFiresRef.current();
    });

    // 🔴 The fire FIRST, and that order is the whole point.
    //
    // MapLibre fires every layer-scoped click handler whose features are
    // under the cursor, so a campsite standing inside a burnt area fires
    // both. Whichever handler runs LAST owns `popup.current`, and the
    // campsite is what the reader aimed at — it is the marker drawn on
    // top. Registering the fire first makes the popup follow the drawing
    // order instead of the registration order.
    //
    // 🔴 BOTH fire layers, by design and not by accident. `FIRE_HIT` is the
    // wide invisible line that makes a 0.7 px perimeter something a thumb
    // can find; `FIRE_FILL` is the inside of a perimeter big enough to have
    // one. Binding only the line (the first repair of the "unclickable
    // layer" defect) fixed the small fires and broke the large ones — a
    // click in the middle of a 4 200 ha burnt area found nothing — and the
    // e2e that clicks dead centre failed on every engine. One registration
    // with both ids, so a click on the outline of a big perimeter (which
    // hits the line AND the fill) opens one card, not two.
    m.on('click', FIRE_CLICK_LAYERS, onFireClick);
    m.on('click', CLUSTER_LAYER, onClusterClick);
    m.on('click', POINT_LAYER, onPointClick);
    for (const layer of [CLUSTER_LAYER, POINT_LAYER, ...FIRE_CLICK_LAYERS]) {
      m.on('mouseenter', layer, pointer);
      m.on('mouseleave', layer, noPointer);
    }

    return () => {
      popup.current?.remove();
      m.remove();
      map.current = null;
    };
  }, []);

  // CAMP-127: the index first, then the chunks the reader is looking at.
  //
  // 🔴 This used to be one fetch of one file. That file carried every
  // campsite on earth, capped at 20 000 — and on 24.09.2026 the EU-27
  // import took us to 61 521, the cap fired, and the map served a 500.
  // Its own comment had predicted the day: "the map calls the same
  // endpoint per viewport instead of reading this file".
  //
  // 🔴 And the failure was SILENT, which was worse than the outage. The
  // old catch swallowed it with a comment saying an empty map "still
  // renders honestly" — and it does not. Seen on screen: the request
  // answered 500 and the panel read "0 campsites", which any reader
  // reads as "there are none here". Every failure below is said out
  // loud, because an empty map is the one thing that must never be
  // quiet.
  useEffect(() => {
    let cancelled = false;
    void fetch(INDEX_URL)
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((regions: RegionSummary[]) => {
        if (cancelled) return;
        if (!Array.isArray(regions) || regions.length === 0) {
          // 🔴 An empty index is a broken build, not an empty continent.
          setDataState({ kind: 'failed', what: 'the index is empty', loaded: 0 });
          return;
        }
        index.current = regions;
        void refresh();
      })
      .catch((err: Error) => {
        if (!cancelled)
          setDataState({ kind: 'failed', what: err.message, loaded: 0 });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Fetch what the current viewport needs, and say what is happening.
   *
   * 🔴 Chunks are never discarded once fetched. A reader who pans away
   * and back should not pay twice, and the memory cost is bounded by how
   * much of Europe one person looks at in a sitting.
   */
  const refresh = async () => {
    const m = map.current;
    if (!m || index.current.length === 0) return;

    // 🔴 Drawing the region circles waits for the style. Saying what is
    // happening does not.
    //
    // `addSource` and `addLayer` run MapLibre's `_checkLoaded()` and
    // THROW — "Style is not done loading" — and `drawRegions` calls
    // both. The index is a local static file and the style is a remote
    // document, so on a normal page load the index wins and this ran
    // first: measured on a production build, every single load of /map
    // threw `Uncaught (in promise) Error: Style is not done loading` out
    // of `drawRegions`.
    //
    // It LOOKED harmless, which is the dangerous part. The `styledata`
    // handler re-runs `refresh()`, so the circles appeared anyway — the
    // first paint was resting on winning a race, and on a slow
    // connection there is no reason to think we win it.
    //
    // 🔴 But ONLY this call is deferred, and the first version of this
    // fix deferred the whole of `refresh`. That would have left the
    // panel reading "Counting campsites…" for as long as a third-party
    // style took to arrive — trading an uncaught error for the exact
    // symptom that is currently failing CI on unrelated pull requests.
    // Nothing else in here needs the style: `getBounds` and `getZoom`
    // are the camera, and `getSource`/`getLayer` answer `undefined`
    // rather than throwing.
    //
    // Waiting on `idle` rather than `styledata`: styledata fires for
    // every sprite and glyph load and can fire with the style still not
    // loaded, while `idle` means the map has nothing left in flight.
    // One pending retry at a time, so a reader dragging the map during
    // a slow style load does not stack up listeners.
    const whenDrawable = (draw: () => void) => {
      if (m.isStyleLoaded()) {
        draw();
        return;
      }
      if (awaitingStyle.current) return;
      awaitingStyle.current = true;
      m.once('idle', () => {
        awaitingStyle.current = false;
        void refreshRef.current();
      });
    };

    const view = boundsOf(m);

    // Too wide, or too heavy, for markers. The index already holds the
    // counts, so this costs nothing and still answers "how many are
    // down there".
    //
    // 🔴 Too HEAVY, not too many. See VIEW_BUDGET_BYTES: the old bound
    // counted chunks, let a 1.96 MB view through and refused one
    // weighing 0.06 MB.
    const detail = m.getZoom() >= DETAIL_ZOOM;
    const { keys, tooMany } = detail
      ? chunksInView(index.current, view)
      : { keys: [] as string[], tooMany: true };

    if (!detail || tooMany) {
      setDataState({ kind: 'wide', count: countInView(index.current, view) });
      hideMarkers(m);
      whenDrawable(() => drawRegions(m, index.current));
      return;
    }

    const missing = keys.filter((k) => !loaded.current.has(k));
    if (missing.length > 0) setDataState({ kind: 'loading' });

    // 🔴 EVERY key is claimed before the first await, not each one
    // when its turn comes.
    //
    // Marking inside the loop looked equivalent and was not. With
    // missing = [X, Y]: this call claims X and awaits it, and while it
    // waits a second `moveend` starts another refresh. That one sees Y
    // still unclaimed, fetches it and appends it. The first call then
    // reaches Y, finds it already in `loaded` — but it is iterating its
    // own list, so it fetches and appends Y a SECOND time.
    //
    // The result is a campsite drawn twice. Found by the spec that
    // compares the map with the API: `spot-n9908191538` appeared twice
    // in one viewport where the API returned it once, and it lives in
    // exactly one chunk (hr/zadarska) — so nothing but this loop could
    // have produced the second copy.
    for (const key of missing) loaded.current.add(key);

    // 🔴 Several at a time, in the order the keys came in.
    //
    // This awaited each fetch before starting the next, which is one
    // round trip per chunk laid end to end. Measured 27.09.2026 by
    // driving the real index over 5 520 detail-zoom windows: of the
    // 5 212 the byte budget admits, the median needs 6 chunks, the 99th
    // percentile 57 and the worst 127 — so a reader in a region-dense
    // corner waited on 127 round trips, one after another, for files
    // whose median is 6 kB. CI has already seen the end of that: a
    // webkit run left the panel on "Counting campsites…" past a
    // five-second assertion.
    //
    // 🔴 Six, and bounded rather than unleashed. Over HTTP/1.1 six is
    // the per-host connection limit, so anything larger queues in the
    // socket pool where we cannot see it; over HTTP/2 there is no such
    // limit, and firing 127 requests at once would simply take the
    // bandwidth away from the basemap tiles the reader is also waiting
    // for. Bounded is the only shape that behaves the same on both.
    //
    // 🔴 The order still matters — `chunksInView` returns the centre of
    // the screen first, and the workers take keys off the front — but
    // `everything` is appended to by whichever finishes first, so the
    // ARRIVAL order is no longer the request order. Nothing downstream
    // depends on it: `applyFilters` and `withinView` both run over the
    // whole array, and the map clusters the set rather than the
    // sequence.
    const CHUNK_CONCURRENCY = 6;
    let next = 0;
    const fetchWorker = async () => {
      for (;;) {
        const i = next++;
        if (i >= missing.length) return;
        const key = missing[i];
        inFlight.current += 1;
        try {
          const res = await fetch(chunkUrl(key));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const collection = (await res.json()) as { features?: SpotFeature[] };
          failedKeys.current.delete(key);
          // 🔴 push, not a fresh array per chunk. Rebuilding
          // `everything` on every arrival is quadratic in the number of
          // chunks, and it also loses features appended by a concurrent
          // refresh between the read and the write — which is precisely
          // the class of bug the claim-every-key-up-front comment above
          // exists for, one level down.
          everything.current.push(...(collection.features ?? []));
        } catch (err) {
          loaded.current.delete(key);
          failedKeys.current.set(key, (err as Error).message);
        } finally {
          inFlight.current -= 1;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CHUNK_CONCURRENCY, missing.length) }, () =>
        fetchWorker(),
      ),
    );

    // 🔴 `clearRegions` calls removeLayer/removeSource, which check the
    // style too — but it only calls them when `getLayer`/`getSource`
    // already found something, and those do not check. Something can
    // only be there because `drawRegions` put it there, which needs a
    // loaded style; and `setStyle` discards it, so mid-swap there is
    // nothing to find. So this needs no guard, and the reason is a
    // property rather than luck.
    clearRegions(m);
    applyFilterState(filtersRef.current);

    // 🔴 Only the LAST refresh standing may say the map is ready.
    // Anything else is a claim about work another call is still doing.
    if (inFlight.current === 0) {
      // 🔴 Republish BEFORE announcing readiness, so the numbers a
      // reader (or a test) sees alongside `ready` describe the data
      // that is now drawn.
      //
      // `applyFilterState` above publishes too, for its own reason —
      // the drawn set changed. This one is about ORDER: nothing may
      // read `ready` next to a count from before the last chunk landed.
      // Two calls, two guarantees, and neither is safe to drop.
      publishRef.current?.();
      // 🔴 Only chunks the reader is LOOKING at count as a failure.
      //
      // A region that failed and has since been panned away from must
      // not keep the current view marked broken — that would tell the
      // reader this map is incomplete because of something off screen.
      // It stays in `failedKeys`, so panning back reports it again.
      const stillWrong = keys.filter((k) => failedKeys.current.has(k));
      setDataState(
        stillWrong.length > 0
          ? {
              kind: 'failed',
              what: `${stillWrong[0]}: ${failedKeys.current.get(stillWrong[0])}`,
              loaded: everything.current.length,
            }
          : { kind: 'ready' },
      );
    }
  };

  // 🔴 The same reason `filtersRef` exists: the map effect runs once, so
  // it must not close over the first render's `refresh`.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  /**
   * CAMP-153: put the perimeters we hold on the map, and say how many of
   * them the reader can see.
   *
   * 🔴 One function for both, because the shapes on the canvas and the
   * number in the sentence under it must describe the same moment. This
   * file's own history is the argument: the counts were published on
   * `idle` while the state was published when fetching stopped, and a
   * reader — and a spec — got numbers from two different instants.
   *
   * 🔴 Switching the layer off empties the SOURCE rather than hiding the
   * layer, so the count and the canvas cannot disagree either.
   */
  const drawFires = () => {
    const m = map.current;
    if (!m) return;
    const source = m.getSource(FIRE_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    const shown = firesOn && fireState.kind === 'fresh' ? fires.current : [];
    source.setData({
      type: 'FeatureCollection',
      features: shown as unknown as GeoJSON.Feature[],
    });
    setFiresHere(firesOn ? firesInView(shown, boundsOf(m)) : null);
  };
  const drawFiresRef = useRef(drawFires);
  drawFiresRef.current = drawFires;

  // The perimeters, once. 🔴 Every outcome sets a state that SAYS
  // something: a network failure, a 404 from a bad deploy and a file that
  // is not the shape we wrote all land on `missing`, which renders "no
  // fresh data" rather than an empty map with no explanation.
  useEffect(() => {
    let cancelled = false;
    void fetch(WILDFIRE_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((body: unknown) => {
        if (cancelled) return;
        const state = wildfireState(body, new Date());
        // 🔴 WHAT ARRIVED, not what we are allowed to draw. These were the
        // same line — `state.kind === 'fresh' ? state.fires : []` — and
        // the mutation run showed what that cost: with the freshness test
        // ALSO here, deleting the one in `drawFires` changed nothing,
        // because a stale feed had already been emptied on the way in. So
        // the test that claims "a stale feed draws nothing" was passing
        // over a deleted guard. One decision, in one place: this holds the
        // perimeters, `drawFires` decides whether they go on the map.
        const feed = readFeed(body);
        fires.current = feed ? feed.features : [];
        // 🔴 Straight from the feed that survived validation. The guard
        // that used to stand here — `state.kind !== 'loading'` — could
        // never be false: `wildfireState` returns `loading` for nothing at
        // all, and a line that cannot fail misleads about what guards what.
        attributionRef.current = feed ? feed.meta.attribution : '';
        setFireState(state);
      })
      .catch(() => {
        if (!cancelled) {
          fires.current = [];
          setFireState({ kind: 'missing' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Whatever changed — the data arriving, the reader switching the layer
  // off — the canvas and the sentence are rebuilt together.
  useEffect(() => {
    drawFiresRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fireState, firesOn]);

  // 🔴 Read through a ref inside the fetch above: that effect runs once,
  // and closing over `filters` would pin it to whatever was set on the
  // first render — so a link opened with filters already in its query
  // string would load, then quietly draw everything.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const applyFilterState = (state: MapFilterState) => {
    const all = everything.current;
    const { shown, unknownExcluded } = applyFilters(all, state);
    drawn.current = shown;

    const source = map.current?.getSource(SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    // 🔴 The map is fed EVERYTHING that matches, not only what is on
    // screen. Chunks are kept, so a pan inside the loaded area must not
    // wait for a re-filter to put markers back.
    source?.setData({ type: 'FeatureCollection', features: shown });

    // 🔴 CAMP-133: what the panel says is about the VISIBLE AREA.
    //
    // `total` used to be `all.length` — every campsite fetched so far.
    // Chunks are deliberately never discarded, so that denominator only
    // ever grew, and it grew with where the reader had been rather than
    // with what was on screen. It answered no question a reader has.
    //
    // The visible area is a set they can see. It is also complete —
    // every chunk overlapping the view is in hand by the time the state
    // is `ready` — which is the argument `withinView` spells out.
    const m = map.current;
    const inView = m ? withinView(all, boundsOf(m)) : [];
    const here = applyFilters(inView, state);
    setTally({
      shown: shown.length,
      total: all.length,
      unknownExcluded,
      inViewShown: here.shown.length,
      inViewTotal: inView.length,
      inViewUnknownExcluded: here.unknownExcluded,
    });

    // 🔴 Republish `data-in-view` NOW, not at the map's next idle.
    //
    // It is derived from `drawn.current`, which this function has just
    // replaced — so leaving it to `idle` publishes a number about the
    // filter the reader had before they clicked.
    //
    // Measured, and it is why this line exists: with the panel reading
    // the idle-published attribute, ticking "also show where this is
    // not recorded" left `data-in-view` at 27 where the panel said 45,
    // and the spec failed on webkit-desktop, mobile-safari, tablet and
    // mobile-chrome while passing on chromium. A number published on an
    // event that may not come is the CAMP-134 shape again.
    //
    // The cluster counts alongside it are queried from what is
    // RENDERED, and clustering happens in a worker, so those stay
    // behind until the map idles and republishes. That is why the specs
    // that read them poll.
    publishRef.current?.();
  };

  useEffect(() => {
    applyFilterState(filters);

    // 🔴 history.replaceState, not the Next router. A filtered map should
    // be a link somebody can send, but routing would re-render the page
    // and tear down the map on every tick of a checkbox — the reader
    // would lose their position mid-filter.
    const qs = toSearchParams(filters);
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Switching sources.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const target = MAP_SOURCES.find((s) => s.id === sourceId);
    if (!target) return;
    // The map is constructed with the first style, and this effect also
    // runs on mount — without the guard every page load fetched that
    // same style document a second time and re-diffed it.
    if (applied.current === target.style) return;
    applied.current = target.style;
    m.setStyle(target.style);
  }, [sourceId]);

  // 🔴 The fallback the card asks for. A style that 404s or times out
  // leaves MapLibre showing an empty grey rectangle with no explanation,
  // which reads as "the site is broken" rather than "one supplier is
  // down". Moving to the next source keeps the map usable and the notice
  // says which one failed.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const current = MAP_SOURCES.find((s) => s.id === sourceId);
    if (!current) return;

    const onError = (ev: { error?: unknown }) => {
      // MapLibre types the payload as a plain ErrorEvent; a network
      // failure carries an AJAXError with the failing url on it.
      // Narrowed rather than cast, so a shape change surfaces as a miss
      // instead of a crash.
      const err = ev.error as { url?: string } | undefined;

      // 🔴 Match on the URL, not on the status code. Individual tiles
      // 404 at the edge of coverage constantly — three did in one
      // ordinary session — and a map that changed supplier on every
      // missing tile would flicker between providers while the reader
      // pans. Only the style document failing means this supplier is
      // actually unusable.
      if (!err?.url?.startsWith(current.style)) return;

      // Each source is tried once. Without this the list wraps and a
      // genuine outage — every supplier down, or the reader offline —
      // becomes an infinite switching loop instead of one clear message.
      tried.current.add(current.id);
      const next = MAP_SOURCES.find((s) => !tried.current.has(s.id));
      setFailed(next ? current.provider : 'all');
      if (next) setSourceId(next.id);
    };

    m.on('error', onError);
    return () => {
      m.off('error', onError);
    };
  }, [sourceId]);

  if (unsupported) {
    // No switcher, no empty frame — those would only invite clicking on
    // something that cannot work. One sentence, and the reader's
    // attention goes to the country list below, which is on this page
    // already and needs nothing but HTML.
    return (
      <p
        role="status"
        data-testid="map-unsupported"
        className="rounded-card border border-line-2 bg-surface p-4 text-sm text-ink-2"
      >
        This browser cannot display the interactive map — it needs WebGL,
        which is switched off or unavailable here. Every campsite is still
        reachable from the country list below.
      </p>
    );
  }

  return (
    <div>
      {/* CAMP-122's registry, finally load-bearing: only layers marked
          live are offered, so a switch is never a promise.

          🔴 And the campsites are deliberately NOT given a switch here.
          Un-drawing them is not one line: the chunk pipeline, the "N
          campsites in view" panel and the wide-view region circles all
          describe that dataset, and a switch that greyed the button while
          61 557 markers stayed on the map would be precisely the promise
          this registry exists to prevent. The filters panel below already
          empties the campsites through its TYPE "None" control. Giving
          them a real switch means a new data state in map-chunks.ts and a
          sentence for it, which is CAMP-122's work and not this card's to
          do badly. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-2">
          Layers
        </span>
        <div role="group" aria-label="Layers" className="flex flex-wrap gap-1.5">
          {LAYERS.filter((l) => l.status === 'live' && l.id !== 'campsites').map((l) => {
            const on = layers.includes(l.id as LayerId);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setLayers((now) => toggleLayer(now, l.id))}
                aria-pressed={on}
                title={l.description}
                data-layer={l.id}
                className={`inline-flex h-8 items-center rounded-sm border px-3 text-sm transition-colors ${
                  on
                    ? 'border-line-blue bg-accent-surface font-semibold text-heading'
                    : 'border-line-2 bg-surface text-ink-2 hover:border-line-blue'
                }`}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-2">
          Map style
        </span>
        <div role="group" aria-label="Map style" className="flex flex-wrap gap-1.5">
          {MAP_SOURCES.map((s: MapSource) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSourceId(s.id)}
              aria-pressed={s.id === sourceId}
              data-source={s.id}
              className={`inline-flex h-8 items-center rounded-sm border px-3 text-sm transition-colors ${
                s.id === sourceId
                  ? 'border-line-blue bg-accent-surface font-semibold text-heading'
                  : 'border-line-2 bg-surface text-ink-2 hover:border-line-blue'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {failed && (
        <p
          role="status"
          data-testid="map-fallback"
          className="mt-3 rounded border border-warn/40 bg-warn/5 p-3 text-sm text-ink-2"
        >
          {failed === 'all' ? (
            <>
              The map could not be loaded from any of our sources. Every
              campsite is still reachable from the country list below.
            </>
          ) : (
            <>
              {failed} did not respond, so the map switched to {active.label}.
            </>
          )}
        </p>
      )}

      {/* 🔴 Above the map, not floating over it. A panel overlaying the
          canvas has to shrink or hide on a phone, and CAMP-35 carries the
          UST-466 lesson about a block that silently vanished in one
          display mode. Here the map gets shorter and every control stays
          exactly where it was. */}
      <div className="mt-3">
        {/* 🔴 The in-view numbers, not the fetched ones. CAMP-133: the
            denominator a reader is given has to be a set they can see. */}
        <MapFilters
          state={filters}
          onChange={setFilters}
          shown={tally.inViewShown}
          total={tally.inViewTotal}
          unknownExcluded={tally.inViewUnknownExcluded}
          dataState={dataState}
        />
      </div>

      {/* 🔴 CAMP-127: what the map is doing, in words, above the canvas.
          
          The defect this replaces: the data request answered 500, the
          catch swallowed it, and the panel read "0 campsites" over an
          empty map. A reader reads that as "there are none here". Now
          loading says loading, a failure says what failed, and a view
          too wide for markers says what the circles are. A working map
          says nothing at all — silence is reserved for the one case
          where it is true. */}
      {dataMessage(dataState) && (
        <p
          role="status"
          data-testid="map-data-state"
          data-kind={dataState.kind}
          className={
            'mt-3 rounded border p-3 text-sm ' +
            (dataState.kind === 'failed'
              ? 'border-warn/40 bg-warn/5 text-ink-2'
              : 'border-line-2 bg-surface text-ink-2')
          }
        >
          {dataMessage(dataState)}
        </p>
      )}

      <div
        ref={container}
        data-testid="map"
        // 🔴 What the map is doing, so a test can wait for a state to
        // BE rather than for a message to be absent.
        //
        // The spec comparing the map against the API read the counts the
        // moment any marker arrived, while the remaining chunks for the
        // viewport were still in flight \u2014 and compared a half-loaded map
        // with a complete API answer. Waiting on the absence of the
        // status line would have the same hole the search had: absent is
        // also true before React has rendered anything.
        data-map-state={dataState.kind}
        data-active-source={active.id}
        // 🔴 Two scopes, and each says which it is.
        //
        // `shown` / `total` / `unknown-excluded` are over everything
        // FETCHED — the map's bookkeeping, and the barrier a spec uses
        // for "a chunk has arrived".
        //
        // `in-view-*` are over the visible area: they are the numbers
        // the panel prints, so a spec can check the sentence against
        // them instead of against a set the reader cannot see.
        // `data-in-view` itself is written by `publishDrawn`, from the
        // same `withinView` rule, whenever the drawn set changes.
        data-shown={tally.shown}
        data-total={tally.total}
        data-unknown-excluded={tally.unknownExcluded}
        data-in-view-total={tally.inViewTotal}
        data-in-view-unknown-excluded={tally.inViewUnknownExcluded}
        className="h-[60vh] min-h-[360px] w-full overflow-hidden rounded-card border border-line-2"
      />

      {/* 🔴 CAMP-153. The fire layer always says something, and that is
          the whole point of it.

          An empty map reads as "all clear". Here that misreading is the
          risk the card exists to remove: a reader who sees no perimeter
          near a campsite in Calabria concludes there is no fire, when
          what happened may be that our last read of Copernicus failed
          three days ago. So every state — loading, missing, stale, none
          recorded, none in view, some in view — has its own sentence, and
          none of them is ever an empty element.

          🔴 And the credit is HERE, next to the shapes, not in a footer
          constant nobody checks. CC BY 4.0 asks for attribution to the
          source with the data's date; both are rendered, and both come
          out of the feed rather than out of this file, so a pipeline that
          started writing something else could not keep saying Copernicus. */}
      <div
        role="status"
        data-testid="wildfire-note"
        data-state={firesOn ? fireState.kind : 'off'}
        data-in-view={firesHere === null ? '' : String(firesHere)}
        className={
          'mt-2 rounded border p-3 text-sm ' +
          (!firesOn
            ? 'border-line-2 bg-surface text-ink-2'
            : fireNote.tone === 'gap'
            ? 'border-warn/40 bg-warn/5 text-ink-2'
            : 'border-line-2 bg-surface text-ink-2')
        }
      >
        {!firesOn ? (
          // Switched off by the reader, and said out loud all the same:
          // an empty map with a control they may have hit by accident is
          // still an empty map.
          <p>
            The wildfire layer is switched off, so no burnt areas are drawn —
            that is this control, not an all-clear.
          </p>
        ) : (
          <>
            <p className="font-semibold text-heading">{fireNote.headline}</p>
            <p className="mt-1">{fireNote.detail}</p>
            {fireState.kind === 'fresh' && (
              <p className="mt-1">
                <a
                  href={fireState.meta.sourceUrl}
                  className="underline"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {fireState.meta.source}
                </a>
                {' · '}
                <a
                  href={fireState.meta.licenceUrl}
                  className="underline"
                  rel="license noopener noreferrer"
                  target="_blank"
                >
                  {fireState.meta.licence}
                </a>
                {' · '}
                <a
                  href={fireState.meta.termsUrl}
                  className="underline"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  CEMS terms
                </a>
                {' · '}
                {/* The date of the DATA, which is what the licence asks
                    for — not the date this page was built. */}
                Read from Copernicus on{' '}
                <time dateTime={fireState.meta.fetchedAt}>
                  {formatInstant(fireState.meta.fetchedAt) ?? fireState.meta.fetchedAt}
                </time>
                {'. '}
                {/* 🔴 The CEMS notice for modified data, word for word as
                    the terms write it, with the year. Rendered, because a
                    credit nobody can see is not a credit — and carried by
                    the feed, so it cannot go stale in a component. */}
                {fireState.meta.attribution}
              </p>
            )}
          </>
        )}
      </div>

      <p className="mt-2 text-xs text-ink-2">{active.attribution}</p>
    </div>
  );
}

/**
 * The card shown when a campsite marker is clicked.
 *
 * 🔴 What it does NOT show is the deliberate part. The design asks for a
 * rating, a photo and a price; we hold none of the three — there are no
 * reviews yet, no photo submissions, and OpenStreetMap records whether a
 * site charges, never how much. Empty stars and a grey placeholder frame
 * would make the map look complete and every campsite look unrated. The
 * card shows what we know and is quiet about the rest, which is the same
 * rule as the three-state amenities: an absence is never rendered as a
 * negative.
 */
function markerCard(p: SpotProperties): HTMLElement {
  const root = document.createElement('div');
  root.className = 'ct-popup';

  const title = document.createElement(p.href ? 'a' : 'strong');
  title.textContent = p.name || 'Unnamed campsite';
  title.className = 'ct-popup-title';
  if (p.href && title instanceof HTMLAnchorElement) title.href = p.href;
  root.append(title);

  const kind = TYPE_LABEL[p.type];
  if (kind) {
    const el = document.createElement('p');
    el.className = 'ct-popup-kind';
    el.textContent = kind;
    root.append(el);
  }

  const yes = AMENITY_KEYS.filter((key) => p[key] === 'yes');
  const no = AMENITY_KEYS.filter((key) => p[key] === 'no');

  if (yes.length || no.length) {
    const list = document.createElement('ul');
    list.className = 'ct-popup-amenities';
    for (const key of yes) {
      const li = document.createElement('li');
      li.textContent = AMENITY_LABEL[key];
      list.append(li);
    }
    for (const key of no) {
      const li = document.createElement('li');
      li.className = 'is-no';
      li.textContent = `No ${AMENITY_LABEL[key].toLowerCase()}`;
      list.append(li);
    }
    root.append(list);
  } else {
    // Every amenity unknown. Saying so is the honest state, and it is
    // also true of a large share of OSM campsites.
    const el = document.createElement('p');
    el.className = 'ct-popup-empty';
    el.textContent = 'Facilities are not recorded for this site yet.';
    root.append(el);
  }

  if (p.href) {
    const more = document.createElement('a');
    more.href = p.href;
    more.className = 'ct-popup-link';
    more.textContent = 'Open campsite page';
    root.append(more);
  }

  return root;
}
