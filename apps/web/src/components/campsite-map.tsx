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
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  DEFAULT_SOURCE_ID,
  INITIAL_VIEW,
  MAP_SOURCES,
  type MapSource,
} from '@/lib/map-sources';

// CAMP-31: the map, and the switch that makes its supplier replaceable.
//
// The card's acceptance criteria are two behaviours, and both are
// implemented deliberately rather than falling out of the library:
//
//   1. the switch really changes the tile source — proven by reading the
//      style URL back off the map after switching, not by the button
//      changing colour;
//   2. when one source is unavailable the map keeps working — MapLibre
//      emits `error` and then sits there grey, so the failure is caught
//      and the next source is loaded in its place.

const SPOTS_URL = '/data/spots.geojson';
const SOURCE_ID = 'campsites';

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

export default function CampsiteMap() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<InstanceType<typeof MapLibreMap> | null>(null);
  const [sourceId, setSourceId] = useState(DEFAULT_SOURCE_ID);
  const [failed, setFailed] = useState<string | null>(null);
  const tried = useRef<Set<string>>(new Set());
  const applied = useRef<string>(MAP_SOURCES[0].style);

  const active =
    MAP_SOURCES.find((s) => s.id === sourceId) ?? MAP_SOURCES[0];

  // Created once. Changing the style afterwards goes through setStyle,
  // because re-creating the map would throw away the reader's position.
  useEffect(() => {
    if (!container.current || map.current) return;

    const m = new MapLibreMap({
      container: container.current,
      style: MAP_SOURCES[0].style,
      center: [INITIAL_VIEW.lng, INITIAL_VIEW.lat],
      zoom: INITIAL_VIEW.zoom,
      attributionControl: false,
    });
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
        m.addSource(SOURCE_ID, { type: 'geojson', data: SPOTS_URL });
      }
      if (!m.getLayer(SOURCE_ID)) {
        m.addLayer({
          id: SOURCE_ID,
          type: 'circle',
          source: SOURCE_ID,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 12, 7],
            'circle-color': '#C83D28',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#FFFFFF',
          },
        });
      }
    };
    m.on('styledata', attach);

    return () => {
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
      // 404 at the edge of coverage constantly, and a map that changed
      // supplier on every missing tile would flicker between providers
      // while the reader pans. Only the style document failing means
      // this supplier is actually unusable.
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
