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
export const DROUGHT_RASTER_OPACITY = 0.76;

/**
 * How each class is drawn: THE SOURCE'S OWN COLOURS, with two classes that are
 * ours. The legend and the pixels both read this one table, so they cannot
 * drift apart.
 *
 * 🔴 CAMP-315, DECISION OF THE OWNER, 14.10.2026 — WHAT CHANGED, AND WHY.
 * Until now this was OUR palette: one warm hue pale to dark for the three
 * drought classes (and no red, because the campsite markers are red — CAMP-162),
 * and ONE cool colour for the three recovery classes, which `droughtLegend`
 * printed as one row. The first CAMP-315 rounds then argued about how saturated
 * that palette could be on our basemaps. The owner decided to stop drawing our
 * own series and draw what the source publishes: the Copernicus EDO Combined
 * Drought Indicator v4.1.1 (fact sheet
 * https://drought.emergency.copernicus.eu/data/factsheets/factsheet_combinedDroughtIndicator_v4.pdf,
 * style config `combinedDroughtIndicatorAllClassesStyle`, and the colours
 * `GetMap` returns; the three agree, measured 14.10.2026):
 *
 *   0 no drought  white / transparent     4 Recovery                    #CAB2D6
 *   1 Watch       #F0E442                 5 Temporary Soil Moisture     #CC79A7
 *   2 Warning     #E69F00                   recovery
 *   3 Alert       #DC050C                 6 Temporary vegetation        #009E73
 *                                           recovery
 *
 * So, DELIBERATELY AND NOT BY OVERSIGHT:
 *  · Classes 4, 5 and 6 are THREE colours now. EDO draws them apart; merging them
 *    into one cool colour was our decision, not the source's. The legend prints
 *    three rows (it merges classes only when hex and alpha are identical).
 *  · Class 3 is RED, `#DC050C`. "NOT A TRAFFIC LIGHT" was our own rule about our
 *    own palette (red is the campsite markers' colour, `#C83D28`/`#D5412A`); the
 *    source draws Alert red, and a map that shows Alert in another colour is not
 *    showing what EDO published. 🔴 CHECKED, so that the next reader does not
 *    think it was forgotten: the markers drawn over the Alert pixel hold 3:1 —
 *    the lowest of the seven classes, 3.32:1 over liberty's water, and still
 *    over the line. The red markers are told from a red layer by their dark ring
 *    (`MARKER_STROKE`), not by their fill. Rule 3 of `check-map-palette.mjs`
 *    measures it on every run.
 *  · The old order rules are gone with the palette they described: class 0 the
 *    lightest, the ladder darkening and warming, hue bands. The ladder is EDO's.
 *
 * 🔴 TWO CLASSES ARE OURS, BY NAME, and the palette guard holds them to
 * "visible on our map" and "markers readable" only — not to equal the source:
 *
 *  · CLASS 0, `#9CFE84`, unchanged from CAMP-200. EDO draws "no drought" white or
 *    transparent. On our map BARE means "the indicator does not look here" (the
 *    sea, Malta), so "covered and fine" has to be drawn, or the map says about
 *    Malta exactly what the mask exists to stop it saying.
 *  · CLASS 4, `#757591`. EDO's `#CAB2D6` is a pale lilac that clears NO opacity on
 *    our pale land, white roads and pale water: at 0.65 it is ΔE 14.1–20.7 from
 *    eight of the eleven basemap colours, and at its best, over the 100 steps
 *    (opacity 0.99), the worst is still ΔE 21.9 (positron's water) — measured
 *    14.10.2026. `#757591` is the colour nearest to it in ΔE (CIE76 on the guard's
 *    own Lab: 26.98 from `#CAB2D6`) of ALL 16.7 million RGB colours that clear ΔE
 *    >= 25 from the eleven basemap colours and from the other six classes, and the
 *    markers, at the shipped opacity. That distance is how far we have moved
 *    from the source on this class: a slate violet at lightness 50 for a lilac at
 *    76, the same side of the hue wheel (292° against 315°), much less colour
 *    (chroma 16 against 21).
 *
 * 🔴 THE OPACITY, 0.76, IS THE LOWEST AT WHICH EVERYTHING BUT CLASS 4 HOLDS.
 * Scanned in steps of 0.01 from 0.01 to 1.00 with the guard itself on classes 0,
 * 1, 2, 3, 5 and 6: nothing below 0.76 holds, and everything from 0.76 to 1.00
 * does. What sets it is Watch against Warning, the two EDO colours closest to
 * each other: ΔE 21.3 apart at the old 0.65 (over liberty's green), 24.87 at 0.74,
 * 24.998 at 0.75 (over liberty's water: a miss of 0.002) and 25.40 at 0.76. Lower
 * is better — the basemap should stay visible under the layer — so it is not
 * higher than it must be. The markers are not what sets it: over Alert they fall
 * with opacity, from 3.56:1 at 0.65 to 3.32:1 at 0.76, and still clear.
 *
 * THE SEVEN, AS `check-map-palette.mjs` PRINTS THEM (14.10.2026): the worst case
 * over the eleven basemap colours, so each is a floor and not an average.
 *
 *   class  colour   equals EDO        ΔE vs basemap       ΔE vs another class   markers
 *   0      #9CFE84  named exception  38.0 liberty.trunk   34.9 class 1          12.20:1
 *   1      #F0E442  yes              33.2 liberty.trunk   25.4 class 2          11.59:1
 *   2      #E69F00  yes              42.8 liberty.trunk   25.4 class 1           7.53:1
 *   3      #DC050C  yes              79.8 liberty.trunk   57.0 class 5           3.32:1
 *   4      #757591  named exception  25.2 bright.water    25.1 class 5           4.75:1
 *   5      #CC79A7  yes              32.6 liberty.water   25.1 class 4           6.09:1
 *   6      #009E73  yes              41.5 liberty.green   39.7 class 0           5.55:1
 *
 * WHAT THE GUARD ASKS, in three rules (see it for the reasons): the five source
 * classes EQUAL the values recorded there byte for byte; every class is ΔE >= 25
 * from each basemap colour and from every other class; the markers stay >= 3:1
 * over every class's pixel.
 */
export const DROUGHT_COLOURS: Readonly<Record<number, { hex: string; alpha: number }>> = {
  0: { hex: '#9CFE84', alpha: 255 },
  1: { hex: '#F0E442', alpha: 255 },
  2: { hex: '#E69F00', alpha: 255 },
  3: { hex: '#DC050C', alpha: 255 },
  4: { hex: '#757591', alpha: 255 },
  5: { hex: '#CC79A7', alpha: 255 },
  6: { hex: '#009E73', alpha: 255 },
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
