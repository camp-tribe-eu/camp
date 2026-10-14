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
 * #C83D28. One warm family — yellow, then orange, then brown — for the
 * three drought classes, and ONE cool colour for the three recovery ones.
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
 * 🔴 SEVEN CLASSES, FIVE COLOURS: 0, 1, 2, 3 and ONE for 4–6. Those three are
 * the RECOVERY group (recovered, soil recovering, vegetation recovering), drawn
 * alike on purpose and printed as one legend row; do not split them. What EDO
 * calls them is in `drought.json`'s `meta.classes`.
 *
 * 🔴 WHAT EVERY ONE OF THE FIVE IS HELD TO. `check-map-palette.mjs` measures all
 * seven classes, as the reader sees them (alpha × `DROUGHT_RASTER_OPACITY`, over
 * each of the eleven basemap colours we serve):
 *
 *  1. ΔE >= 25 against every basemap colour, and against every other colour:
 *     "covered and fine", "a drought class" and "recovering" are each told from
 *     "not covered" and from one another. Until CAMP-315 only class 0 was held,
 *     and the rest were not under the line: class 1 `#F2D98A` was ΔE 6.6 from
 *     liberty's trunk roads, 4–6 `#8FB8CC` was ΔE 6.0 from bright's water,
 *     class 2 `#D9A441` was 22.3 (measured 14.10.2026 by that script). "Less rain
 *     than normal" over a motorway and "recovering" over a lake read as a bare
 *     map, which says "we do not measure here" — the very conflation the mask
 *     exists to stop, on other classes.
 *  2. The campsite markers, which are drawn on top, stay >= 3:1 over its pixel.
 *  3. THE SCALE STAYS THE RIGHT WAY ROUND. Class 0 is the LIGHTEST of all seven.
 *     The drought series 0 → 1 → 2 → 3 gets darker AND warmer at every step
 *     (yellow, orange, brown — hue falling towards red, never into it). The
 *     recovery colour is COOL and is not a rung of that series: its lightness is
 *     not ordered against 1–3 (a teal does not belong between two ambers).
 *     A scale turned upside down is a defect even when every number above
 *     passes — the version that held class 0 to 3:1 against the basemap made "no
 *     drought" the darkest thing on the map, darker than "vegetation under
 *     stress".
 *
 * It is NOT held to a contrast against the basemap. Contrast answers "can a
 * mark or a word be read on this colour"; whether a FILL can be told from the
 * absence of one is a question of colour difference, which is ΔE.
 *
 * THE FIVE, AS `check-map-palette.mjs` PRINTS THEM (14.10.2026): the worst case
 * over the eleven basemap colours, so each is a floor and not an average.
 *
 *   class  colour    ΔE vs basemap          ΔE vs another colour        markers
 *   0      #9CFE84   32.6 liberty.trunk     33.7 class 1                11.66:1
 *   1      #F2E02E   33.8 liberty.trunk     31.0 class 2                10.88:1
 *   2      #FF8E00   43.2 liberty.trunk     30.8 class 3                 7.33:1
 *   3      #A5541B   38.2 liberty.trunk     30.8 class 2                 4.43:1
 *   4–6    #00938A   29.3 bright.water      44.2 class 0                 5.62:1
 *
 * HOW 1, 2 AND 4–6 WERE CHOSEN, so the next person can redo it rather than trust
 * it. Class 0 (`#9CFE84`) and class 3 (`#A5541B`) were not touched. Colours on
 * an RGB grid were dropped unless they cleared items 1–3 against the basemap and
 * against 0 and 3, and the survivors were searched for the yellow–orange pair
 * and the recovery colour with the widest worst case. The room is small: yellow
 * and orange are sandwiched between a pale-yellow trunk road, a light green
 * class 0 and a brown class 3, and in the search with their chroma capped at 65
 * the best pair found reached ΔE 23.5 — under the line. Hence the saturated
 * yellow and orange; the pixel is 35% basemap, so on the map they read softer.
 * The recovery colour has far more room (several hundred teals clear everything);
 * it is a middling teal so that "recovered" is not the heaviest thing on the
 * map, and not a blue, because the basemaps' water is blue.
 *
 * `#9CFE84` is a light green. 3 401 of the 140 608 colours on a 5-step grid
 * clear class 0's three rules (and are lighter than the classes beside them on
 * every basemap colour); it was picked from the best-separated of them in
 * CAMP-200, and its markers are at 11.66:1.
 */
export const DROUGHT_COLOURS: Readonly<Record<number, { hex: string; alpha: number }>> = {
  0: { hex: '#9CFE84', alpha: 255 },
  1: { hex: '#F2E02E', alpha: 255 },
  2: { hex: '#FF8E00', alpha: 255 },
  3: { hex: '#A5541B', alpha: 255 },
  4: { hex: '#00938A', alpha: 255 },
  5: { hex: '#00938A', alpha: 255 },
  6: { hex: '#00938A', alpha: 255 },
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
