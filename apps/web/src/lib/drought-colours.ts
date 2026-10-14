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
 * 0.65 that is 22.9% — ΔE 4.0 to 13.2 and a contrast of 1.01 to 1.15 over
 * the eleven basemap colours we serve, against the 25 and 3 this repository
 * holds everything else to (measured 14.10.2026 by `check-map-palette.mjs`,
 * which now reads this table). The distinction the
 * card exists to make had moved from the data into the rendering, where it
 * was one shade of green on another.
 *
 * 🔴 WHY THE TINT IS DARK, AND WHAT IT COSTS. A contrast of 3:1 against
 * every basemap colour — the darkest being liberty's water, `#9EBDFF` —
 * means the pixel itself has to be about as dark as relative luminance
 * 0.136. At the layer's ceiling of 65% that takes a very dark green: of the
 * 262 144 colours on a 4-step grid, 22 546 pass both thresholds, and
 * `#1C4418` is among the greens nearest the line (3.0001:1 on liberty's
 * water, ΔE 40.4 at the worst basemap colour; it sits ON the line on
 * purpose, because every step lighter is a step under 3:1).
 *
 * The cost is on the campsite markers that sit on top. Their dark ring needs
 * 3:1 against the SAME pixel, which asks for a luminance of at least 0.1366
 * — and the two windows do not meet (0.1363 against 0.1366). The best any
 * colour manages is 2.998:1, for a `free` marker over a tinted lake in
 * liberty and nowhere else. `check-map-palette.mjs` reports exactly that
 * line, and it is the one thing left for a decision: see the pull request.
 */
export const DROUGHT_COLOURS: Readonly<Record<number, { hex: string; alpha: number }>> = {
  0: { hex: '#1C4418', alpha: 255 },
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
