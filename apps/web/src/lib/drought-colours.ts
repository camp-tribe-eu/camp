// CAMP-200 — how each drought class is DRAWN, and nothing else.
//
// 🔴 A LEAF MODULE ON PURPOSE: it imports nothing. `scripts/ci/check-map-palette.mjs`
// reads these colours under `node --experimental-strip-types`, which cannot
// resolve an extensionless relative import, so a table that lived beside
// `readMeta` (which imports `./cems`) was a table the guard could not see.
// The review of PR #227 found exactly that: the palette check measured the
// campsite markers and the route lines, and the drought colours — the ones
// painted over every campsite — were in nobody's field of view.
// `lib/drought.ts` re-exports everything here, so the page, the map and the
// tests keep asking one place.

/**
 * The `raster-opacity` the map lays the picture on with.
 *
 * 🔴 ONE NUMBER, TWO READERS. The map's paint property and the legend's
 * swatches both take it from here, and so does the palette guard when it
 * works out what a reader actually sees. It used to be typed into
 * `campsite-map.tsx` as a bare `0.65`, so a class drawn at alpha 90 reached
 * the screen at 90/255 × 0.65 = 22.9% while every other place in the repo
 * that described the class said "alpha 90" — and nothing could tell the two
 * apart.
 */
export const DROUGHT_RASTER_OPACITY = 0.65;

/**
 * How each class is drawn. The legend and the pixels both read this one
 * table, so they cannot drift apart.
 *
 * 🔴 NOT a traffic light. Red on a class of drought is the CAMP-162
 * vocabulary rendered in CSS, and the campsite markers are already
 * #C83D28. One hue, pale to dark, for the three drought classes, and a
 * cool colour for the three recovery ones.
 *
 * 🔴 Class 0 IS DRAWN, and drawn so that it can be told from a place the
 * indicator does not look at. That is what the mask is for: where the
 * indicator measured normal conditions the map is tinted, and where it
 * does not look at all (the sea, the places outside its domain) it is left
 * bare. If 0 were invisible, "bare" would mean either, and the map would
 * say about Malta exactly what the mask exists to stop it saying.
 *
 * The first version drew 0 as `#9CC5A1` at alpha 90. Through the layer's
 * 0.65 that is 22.9% — ΔE 4.0 to 13.2 over the eleven basemap colours we
 * serve, against the 25 this repository holds every "do these read alike"
 * question to (measured 14.10.2026 by `check-map-palette.mjs`, which now
 * reads this table). The distinction the card exists to make had moved from
 * the data into the rendering, where it was one shade of green on another.
 *
 * 🔴 WHAT CLASS 0 IS HELD TO, AND WHAT IT IS NOT. Three things, all measured
 * by `check-map-palette.mjs`:
 *
 *  1. ΔE >= 25 against every basemap colour, and against every other class:
 *     "covered and fine" is told from "not covered" and from a drought class.
 *  2. The campsite markers, which are drawn on top, stay >= 3:1 over its pixel.
 *  3. THE SCALE STAYS THE RIGHT WAY ROUND: class 0 is the LIGHTEST class and
 *     the drought classes get darker and warmer with severity. A scale
 *     turned upside down is a defect even when every number above passes —
 *     the version that held class 0 to 3:1 against the basemap made "no
 *     drought" the darkest thing on the map, darker than "vegetation under
 *     stress".
 *
 * It is NOT held to a contrast against the basemap. Contrast answers "can a
 * mark or a word be read on this colour"; whether a FILL can be told from the
 * absence of one is a question of colour difference, which is ΔE. And the
 * other six classes are not held to 3:1 either — the best of them reaches
 * 2.03 — so the rule would have been applied to the one class it hurt.
 *
 * `#9CFE84` is a light green. 3 401 of the 140 608 colours on a 5-step grid
 * clear all three (and are lighter than the classes beside them on every
 * basemap colour); it was picked from the best-separated of them, and its
 * worst figures are ΔE 32.6 from a basemap colour (liberty's trunk roads),
 * ΔE 32.2 from another class, and markers at 11.66:1.
 */
export const DROUGHT_COLOURS: Readonly<Record<number, { hex: string; alpha: number }>> = {
  0: { hex: '#9CFE84', alpha: 255 },
  1: { hex: '#F2D98A', alpha: 255 },
  2: { hex: '#D9A441', alpha: 255 },
  3: { hex: '#A5541B', alpha: 255 },
  4: { hex: '#8FB8CC', alpha: 255 },
  5: { hex: '#8FB8CC', alpha: 255 },
  6: { hex: '#8FB8CC', alpha: 255 },
};

export const hexRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * How much of a class's colour reaches the screen: its own alpha, then the
 * layer's `raster-opacity` on top. 🔴 This is the number to measure and to
 * show — the alpha in the table alone says what the CANVAS holds, not what
 * a reader sees.
 */
export const effectiveOpacity = (alpha: number): number => (alpha / 255) * DROUGHT_RASTER_OPACITY;

/**
 * The colour the legend's swatches sit on: what two of the three basemaps we
 * serve paint as land (`basemap-colours.json`, liberty and bright). A swatch
 * is a translucent colour, so what it LOOKS like depends on what is behind
 * it, and a panel in dark mode is not what is behind the picture on the map.
 */
export const LEGEND_BACKING = '#F8F4F0';
