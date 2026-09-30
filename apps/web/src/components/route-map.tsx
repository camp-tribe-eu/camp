'use client';

import { useEffect, useRef, useState } from 'react';
// 🔴 Named imports. maplibre-gl 6 is ESM-only and dropped its default
// export, so `import maplibregl from 'maplibre-gl'` typechecks and then
// fails at bundle time. Most examples online still show the old form.
import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DEFAULT_SOURCE_ID, MAP_SOURCES } from '@/lib/map-sources';

// CAMP-3 / CAMP-45 — the map on a curated route page.
//
// 🔴 Its own component, not the campsite map. /map is a filterable view
// of 61 422 points with clustering and chunked loading; this draws at
// most seven stages and twenty-eight campsites and never fetches
// anything. Sharing one component would mean carrying all of that
// machinery onto a page that needs none of it, and would couple two
// pages that are being worked on in parallel.
//
// 🔴 THE LINE BETWEEN THE STAGES IS DASHED, AND THAT IS NOT DECORATION.
//
// We have no road geometry (see lib/route-geometry.ts: it needs our own
// routing engine, which needs a VPS that is not paid for). What we can
// draw honestly is the straight line between consecutive stages. A solid
// line on a map reads as a road — every map anyone has ever used has
// taught them that — so this one is dashed, thin, and captioned in the
// legend underneath as "straight lines between stops, not the road".
//
// The moment a real provider is wired in, `road` arrives as a polyline
// and is drawn SOLID underneath, with the dashed line removed. The
// switch is a single change in lib/route-geometry.ts; nothing in this
// file needs editing for it.

setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

const STAGE_SOURCE = 'route-stages';
const LEG_SOURCE = 'route-legs';
const ROAD_SOURCE = 'route-road';
const SPOT_SOURCE = 'route-spots';

export interface RouteMapStage {
  name: string;
  lat: number;
  lon: number;
  nights: number;
}

export interface RouteMapSpot {
  name: string | null;
  href: string;
  lat: number;
  lon: number;
  typeLabel: string;
  metres: number;
}

export interface RouteMapProps {
  stages: RouteMapStage[];
  spots: RouteMapSpot[];
  /**
   * The real road line, [lon, lat] pairs, once a routing engine exists.
   * Undefined today — see the header.
   */
  road?: [number, number][];
}

/** The bounding box of everything we are about to draw, with padding. */
function extent(points: { lat: number; lon: number }[]) {
  let minLon = 180;
  let minLat = 90;
  let maxLon = -180;
  let maxLat = -90;
  for (const p of points) {
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ] as [[number, number], [number, number]];
}

export default function RouteMap({ stages, spots, road }: RouteMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<InstanceType<typeof MapLibreMap> | null>(null);
  const popup = useRef<InstanceType<typeof Popup> | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  const source = MAP_SOURCES.find((s) => s.id === DEFAULT_SOURCE_ID) ?? MAP_SOURCES[0];

  useEffect(() => {
    if (!container.current || map.current || stages.length === 0) return;

    let m: InstanceType<typeof MapLibreMap>;
    try {
      // 🔴 The constructor throws when the browser cannot hand it a WebGL
      // context, and unhandled that exception escapes into React's
      // render — Next then replaces the ENTIRE page with its client-side
      // error shell, taking the stage list and the campsite links with
      // it. The map is the part of this page that can be missing; the
      // itinerary is not.
      m = new MapLibreMap({
        container: container.current,
        style: source.style,
        bounds: extent([...stages, ...spots]),
        fitBoundsOptions: { padding: 48, maxZoom: 11 },
        attributionControl: false,
        // 🔴 Found by scrolling the actual page, not by any test.
        //
        // This map sits in the MIDDLE of a long article. With the
        // default settings the wheel zooms the map, so scrolling down
        // the page stops dead over the map and zooms out to the whole
        // of western Europe instead — measured: three wheel notches
        // took the French route from its own coastline to a view
        // containing Switzerland, and the page never moved.
        //
        // /map does not have this problem because there the map IS the
        // page. Here it is a figure inside prose, and a figure must not
        // capture the scroll.
        //
        // `cooperativeGestures` is MapLibre's answer: the wheel scrolls
        // the page, ctrl/⌘+wheel zooms the map, and touch needs two
        // fingers to pan. It also renders its own explanatory overlay,
        // so the behaviour is discoverable rather than mysterious.
        cooperativeGestures: true,
      });
    } catch {
      setUnsupported(true);
      return;
    }

    map.current = m;
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    // 🔴 No `customAttribution`, and this was a real bug caught by
    // looking at the rendered page rather than by any test.
    //
    // OpenFreeMap's styles already declare their own attribution, and
    // MapLibre APPENDS ours to it rather than replacing it — so the
    // credit rendered twice on one line: "OpenFreeMap © OpenMapTiles ·
    // Data from OpenStreetMap | OpenFreeMap © OpenMapTiles Data from
    // OpenStreetMap". campsite-map.tsx carries a comment saying exactly
    // this, and this component repeated the mistake anyway.
    //
    // The control shows whatever the current style claims; the paragraph
    // below the map is our own guarantee that the credit is present even
    // if a style ever omits it, and that it survives the control being
    // collapsed on a narrow screen.
    m.addControl(new AttributionControl({ compact: true }));

    m.on('load', () => {
      // ── the legs: straight lines, drawn as straight lines ────────────
      if (stages.length > 1) {
        m.addSource(LEG_SOURCE, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: stages.map((s) => [s.lon, s.lat]),
            },
          },
        });
        m.addLayer({
          id: 'route-leg-line',
          type: 'line',
          source: LEG_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#8A93A6',
            'line-width': 2,
            // 🔴 The dash pattern IS the honesty. Solid means road.
            'line-dasharray': [1.5, 2],
            'line-opacity': road ? 0 : 0.9,
          },
        });
      }

      // ── the road, when there is one ──────────────────────────────────
      //
      // Nothing here runs today, because `road` is always undefined until
      // a provider is configured. It is written now so that switching
      // the provider on is genuinely one change and not a second
      // afternoon's work in this file.
      if (road && road.length > 1) {
        m.addSource(ROAD_SOURCE, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: road },
          },
        });
        m.addLayer(
          {
            id: 'route-road-line',
            type: 'line',
            source: ROAD_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#2F6FDB', 'line-width': 4, 'line-opacity': 0.9 },
          },
          'route-leg-line',
        );
      }

      // ── the campsites ────────────────────────────────────────────────
      m.addSource(SPOT_SOURCE, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: spots.map((s) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
            properties: {
              name: s.name ?? '',
              href: s.href,
              typeLabel: s.typeLabel,
              metres: s.metres,
            },
          })),
        },
      });
      m.addLayer({
        id: 'route-spot-points',
        type: 'circle',
        source: SPOT_SOURCE,
        paint: {
          'circle-radius': 5,
          'circle-color': '#4BA883',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#FFFFFF',
        },
      });

      // ── the stages, numbered ─────────────────────────────────────────
      m.addSource(STAGE_SOURCE, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: stages.map((s, i) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
            properties: { label: String(i + 1), name: s.name, nights: s.nights },
          })),
        },
      });
      m.addLayer({
        id: 'route-stage-circles',
        type: 'circle',
        source: STAGE_SOURCE,
        paint: {
          'circle-radius': 12,
          'circle-color': '#404B62',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#FFFFFF',
        },
      });
      m.addLayer({
        id: 'route-stage-labels',
        type: 'symbol',
        source: STAGE_SOURCE,
        layout: {
          'text-field': ['get', 'label'],
          // 🔴 Every style in MAP_SOURCES serves exactly Noto Sans
          // Regular/Bold/Italic — checked, not assumed. A font a style
          // does not serve renders as nothing at all, and a missing
          // glyph range is a console warning rather than an error, so
          // the numbers would silently vanish.
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#FFFFFF' },
      });

      // ── what a marker says ───────────────────────────────────────────
      const openSpot = (e: { features?: unknown[]; lngLat: { lng: number; lat: number } }) => {
        const f = e.features?.[0] as
          | { properties: Record<string, string | number> }
          | undefined;
        if (!f) return;
        const p = f.properties;
        popup.current?.remove();
        // 🔴 Built with the DOM, not with an HTML string. A campsite name
        // comes from OpenStreetMap, which is to say from a stranger, and
        // `innerHTML` with a stranger's text in it is the one XSS this
        // page could have. `textContent` cannot be escaped out of.
        const el = document.createElement('div');
        // A campsite with no region has no page, so it gets no link —
        // the same rule the stage list follows.
        const href = String(p.href ?? '');
        const title = document.createElement(href ? 'a' : 'strong');
        if (href) (title as HTMLAnchorElement).href = href;
        title.className = 'font-semibold underline';
        title.textContent = String(p.name || 'Unnamed campsite');
        el.appendChild(title);
        const meta = document.createElement('p');
        meta.className = 'mt-1 text-xs';
        // The distance is labelled on every surface it appears, and this
        // is a surface.
        meta.textContent = `${p.typeLabel} · ${
          Number(p.metres) < 1000
            ? `${p.metres} m`
            : `${(Number(p.metres) / 1000).toFixed(1)} km`
        } from the stop, in a straight line`;
        el.appendChild(meta);
        popup.current = new Popup({ closeButton: true, offset: 10 })
          .setLngLat([e.lngLat.lng, e.lngLat.lat])
          .setDOMContent(el)
          .addTo(m);
      };

      m.on('click', 'route-spot-points', openSpot);
      m.on('mouseenter', 'route-spot-points', () => {
        m.getCanvas().style.cursor = 'pointer';
      });
      m.on('mouseleave', 'route-spot-points', () => {
        m.getCanvas().style.cursor = '';
      });
    });

    return () => {
      popup.current?.remove();
      popup.current = null;
      m.remove();
      map.current = null;
    };
  }, [stages, spots, road, source.style, source.attribution]);

  if (unsupported) {
    return (
      <div
        data-testid="route-map-unsupported"
        className="mt-3 rounded-card border border-line-2 bg-surface p-4 text-sm text-ink-2"
      >
        Your browser cannot draw the map — it needs WebGL. The stages and the
        campsites beside them are listed in full below, and nothing on this page
        depends on the map.
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div
        ref={container}
        data-testid="route-map"
        className="h-[46vh] min-h-[320px] w-full overflow-hidden rounded-card border border-line-2"
      />
      {/* 🔴 The legend is part of the honesty, not an accessory. The
          dashed line is the only thing on this map that could be
          mistaken for a claim we are not making. */}
      <p className="mt-2 text-xs text-ink-2">
        <span aria-hidden="true">— — —</span> The dashed line joins the stops in
        order <strong className="font-semibold">in a straight line</strong>. It
        is not the road, and it is not the distance you will drive.
      </p>
      {/* 🔴 Our own attribution, in the page rather than only in the
          map control. A licence condition should not depend on a
          collapsible widget, or on a third-party style continuing to
          declare its own credit. */}
      <p className="mt-1 text-xs text-ink-2" data-boilerplate="map-attribution">
        Map tiles: {source.attribution}.
      </p>
    </div>
  );
}
