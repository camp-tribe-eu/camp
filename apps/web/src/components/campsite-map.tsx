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

const SPOTS_URL = '/data/spots.geojson';
const SOURCE_ID = 'campsites';
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
interface SpotProperties {
  slug: string;
  name: string | null;
  type: string;
  href: string;
  electricity: string;
  water: string;
  shower: string;
  dogFriendly: string;
  wifi: string;
}

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

const AMENITY_LABEL: [keyof SpotProperties, string][] = [
  ['electricity', 'Electricity'],
  ['water', 'Drinking water'],
  ['shower', 'Shower'],
  ['dogFriendly', 'Dogs welcome'],
  ['wifi', 'Wi-Fi'],
];

export default function CampsiteMap() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<InstanceType<typeof MapLibreMap> | null>(null);
  const popup = useRef<InstanceType<typeof Popup> | null>(null);
  const [sourceId, setSourceId] = useState(DEFAULT_SOURCE_ID);
  const [failed, setFailed] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const tried = useRef<Set<string>>(new Set());
  const applied = useRef<string>(MAP_SOURCES[0].style);

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
          data: SPOTS_URL,
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
    m.on('styledata', attach);

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
      el.dataset.visibleClusters = String(rendered(CLUSTER_LAYER).length);
      el.dataset.visiblePoints = String(points.length);

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

      <div
        ref={container}
        data-testid="map"
        data-active-source={active.id}
        className="mt-3 h-[60vh] min-h-[360px] w-full overflow-hidden rounded-card border border-line-2"
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

  const yes = AMENITY_LABEL.filter(([key]) => p[key] === 'yes');
  const no = AMENITY_LABEL.filter(([key]) => p[key] === 'no');

  if (yes.length || no.length) {
    const list = document.createElement('ul');
    list.className = 'ct-popup-amenities';
    for (const [, label] of yes) {
      const li = document.createElement('li');
      li.textContent = label;
      list.append(li);
    }
    for (const [, label] of no) {
      const li = document.createElement('li');
      li.className = 'is-no';
      li.textContent = `No ${label.toLowerCase()}`;
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
