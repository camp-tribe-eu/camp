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
  type MapDataState,
  type RegionSummary,
} from '@/lib/map-chunks';

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
  const [tally, setTally] = useState({ shown: 0, total: 0, unknownExcluded: 0 });
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
   * `publishCounts`, reachable from outside the map effect.
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
  const [dataState, setDataState] = useState<MapDataState>({ kind: 'loading' });

  const active =
    MAP_SOURCES.find((s) => s.id === sourceId) ?? MAP_SOURCES[0];

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
    });

    // Clicking a cluster opens it, rather than doing nothing — the most
    // common complaint about clustered maps.
    const onClusterClick = async (e: {
      features?: MapGeoJSONFeature[];
      lngLat: { lng: number; lat: number };
    }) => {
      const feature = e.features?.[0];
      if (!feature) return;
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
    const publishCounts = () => {
      const el = container.current;
      if (!el) return;
      const rendered = (layer: string) =>
        m.getLayer(layer) ? m.queryRenderedFeatures({ layers: [layer] }) : [];
      const points = rendered(POINT_LAYER);
      const clusters = rendered(CLUSTER_LAYER);
      el.dataset.visibleClusters = String(clusters.length);
      el.dataset.visiblePoints = String(points.length);

      // 🔴 CAMP-127: the viewport, and how many of OUR features are in it.
      //
      // The map used to hold every campsite on earth, so a test could
      // compare it against the API asking for the whole world. It now
      // holds the regions in view, so the comparison has to be scoped —
      // and the scope has to come from the map itself, because only the
      // map knows where it is looking. Published together so the two can
      // never describe different moments.
      const b = m.getBounds();
      el.dataset.bounds = [
        b.getWest(),
        b.getSouth(),
        b.getEast(),
        b.getNorth(),
      ]
        .map((n) => n.toFixed(6))
        .join(',');
      // 🔴 WHICH campsites, not only how many \u2014 capped, so this can
      // never become a megabyte of DOM attribute.
      //
      // The spec that compares the map against the API could only say
      // "5 against 3", which names nothing a person can go and look at.
      // The slugs are already public: every one of them is a URL on
      // this site, and each is drawn on screen right now.
      const inside = drawn.current.filter((f) => {
        const [lon, lat] = f.geometry.coordinates;
        return (
          lon >= b.getWest() &&
          lon <= b.getEast() &&
          lat >= b.getSouth() &&
          lat <= b.getNorth()
        );
      });
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

      el.dataset.inView = String(
        drawn.current.filter((f) => {
          const [lon, lat] = f.geometry.coordinates;
          return (
            lon >= b.getWest() &&
            lon <= b.getEast() &&
            lat >= b.getSouth() &&
            lat <= b.getNorth()
          );
        }).length,
      );

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
    m.on('idle', publishCounts);
    // 🔴 And on demand, so the numbers can be republished the moment the
    // data changes rather than whenever the map next happens to idle.
    publishRef.current = publishCounts;

    // 🔴 CAMP-127: the map now fetches what is in view, so moving it is
    // a data event and not only a rendering one. `moveend` rather than
    // `move`: one fetch when the reader stops, not sixty while they drag.
    m.on('moveend', () => {
      void refreshRef.current();
    });

    m.on('click', CLUSTER_LAYER, onClusterClick);
    m.on('click', POINT_LAYER, onPointClick);
    for (const layer of [CLUSTER_LAYER, POINT_LAYER]) {
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

    const b = m.getBounds();
    const view = {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };

    if (m.getZoom() < DETAIL_ZOOM) {
      // Too wide for markers. The index already holds the counts, so
      // this costs nothing and still answers "how many are down there".
      setDataState({ kind: 'wide', count: countInView(index.current, view) });
      hideMarkers(m);
      drawRegions(m, index.current);
      return;
    }

    const { keys, tooMany } = chunksInView(index.current, view);
    if (tooMany) {
      setDataState({ kind: 'wide', count: countInView(index.current, view) });
      hideMarkers(m);
      drawRegions(m, index.current);
      return;
    }

    const missing = keys.filter((k) => !loaded.current.has(k));
    if (missing.length > 0) setDataState({ kind: 'loading' });

    const failures: string[] = [];
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

    for (const key of missing) {
      inFlight.current += 1;
      try {
        const res = await fetch(chunkUrl(key));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const collection = (await res.json()) as { features?: SpotFeature[] };
        everything.current = [
          ...everything.current,
          ...(collection.features ?? []),
        ];
      } catch (err) {
        loaded.current.delete(key);
        failures.push(`${key}: ${(err as Error).message}`);
      } finally {
        inFlight.current -= 1;
      }
    }

    clearRegions(m);
    applyFilterState(filtersRef.current);

    // 🔴 Only the LAST refresh standing may say the map is ready.
    // Anything else is a claim about work another call is still doing.
    if (inFlight.current === 0) {
      // 🔴 Republish BEFORE announcing readiness, so the numbers a
      // reader (or a test) sees alongside `ready` describe the data
      // that is now drawn.
      publishRef.current?.();
      setDataState(
        failures.length > 0
          ? { kind: 'failed', what: failures[0], loaded: everything.current.length }
          : { kind: 'ready' },
      );
    }
  };

  // 🔴 The same reason `filtersRef` exists: the map effect runs once, so
  // it must not close over the first render's `refresh`.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

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
    setTally({ shown: shown.length, total: all.length, unknownExcluded });

    const source = map.current?.getSource(SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    source?.setData({ type: 'FeatureCollection', features: shown });
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
      <div className="flex flex-wrap items-center gap-2">
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
        <MapFilters
          state={filters}
          onChange={setFilters}
          shown={tally.shown}
          total={tally.total}
          unknownExcluded={tally.unknownExcluded}
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
        data-shown={tally.shown}
        data-total={tally.total}
        data-unknown-excluded={tally.unknownExcluded}
        className="h-[60vh] min-h-[360px] w-full overflow-hidden rounded-card border border-line-2"
      />

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
