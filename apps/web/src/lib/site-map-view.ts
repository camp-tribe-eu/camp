// CAMP-502 — what the single-campsite map frames, and what a disturbance pin is.
//
// 🔴 WHY THIS IS ITS OWN FILE. `site-map.tsx` imports MapLibre, which reaches
// for `window` at import time, so nothing in it can be tested without a
// browser. The two decisions below are arithmetic and attributes; kept here,
// a unit test reads them directly, and the component only applies them.
//
// 🔴 A FAR PIN DOES NOT ZOOM THE MAP OUT (review of #557). The first version
// fitted the view to EVERY pin. An airport is reported up to 5 km away, so one
// airport turned a map whose subject is a campsite into a map of the district
// with the campsite as a dot — on the page whose point is "this is where it
// is". Roads and railway lines are reported within 1 km and are framed; a pin
// farther than FIT_PIN_WITHIN_M stays on the map, off the first view, and the
// line under the map names it with its distance (campsite-media.tsx).

import type { DisturbanceMarker } from '@/lib/disturbance';

export type Box = [[number, number], [number, number]];

/** Zoom, на якому видно ділянку і дорогу до неї, але ще читається село. */
export const SITE_ZOOM = 15;

/**
 * A pin farther than this does not widen the first view. Just over the
 * 1 000 m radius of roads and railways (disturbance.ts on the API side), so
 * every road and railway pin is framed and only a distant airport is not.
 */
export const FIT_PIN_WITHIN_M = 1_200;

/** The pin's colour: white on it is 5.0:1. */
export const DISTURBANCE_PIN_COLOUR = '#B45309';

/** Where a pin's click leads when the note is not enough: the block itself. */
export const DISTURBANCE_BLOCK_ID = 'camp-disturbance-heading';

const RAD = Math.PI / 180;

/** Great-circle metres (haversine); exact enough at 5 km to choose a frame. */
export function metresBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The pins near enough to be framed with the campsite. */
export function framedPins(
  lat: number,
  lon: number,
  pins: readonly DisturbanceMarker[],
): DisturbanceMarker[] {
  return pins.filter((d) => metresBetween(lat, lon, d.lat, d.lon) <= FIT_PIN_WITHIN_M);
}

/**
 * The box the first view fits: the outline (when there is one), the campsite's
 * own point, and the NEAR pins. `null` when there is nothing to fit — no
 * outline and no near pin — so the map keeps its centre and SITE_ZOOM.
 */
export function fitBox(
  lat: number,
  lon: number,
  outline: Box | null,
  pins: readonly DisturbanceMarker[],
): Box | null {
  const near = framedPins(lat, lon, pins);
  if (!outline && near.length === 0) return null;
  let [[w, s], [e, n]] = outline ?? [
    [lon, lat],
    [lon, lat],
  ];
  for (const p of [{ lon, lat }, ...near]) {
    w = Math.min(w, p.lon);
    e = Math.max(e, p.lon);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return [
    [w, s],
    [e, n],
  ];
}

/**
 * The attributes of a pin's element.
 *
 * 🔴 A BUTTON, NOT A PICTURE WITH A TOOLTIP. The first version was
 * `role="img"` with a `title`: a `title` does not exist on a touch screen and
 * is not reachable from a keyboard, so on a phone the pin was an unexplained
 * «!». Now it can be focused and pressed, and pressing it shows the label AND
 * the sentence that we did not measure noise (site-map.tsx, `disturbance-note`).
 */
export function pinAttributes(d: DisturbanceMarker, open: boolean): Record<string, string> {
  return {
    'data-testid': 'disturbance-marker',
    'data-kind': d.kind,
    role: 'button',
    tabindex: '0',
    'aria-label': d.label,
    'aria-expanded': open ? 'true' : 'false',
    'aria-controls': 'disturbance-note',
  };
}
