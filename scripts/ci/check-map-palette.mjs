#!/usr/bin/env node
/**
 * The map's colours must stay legible, and that is measured here.
 *
 * 🔴 WHAT THE FIRST VERSION OF THIS FILE GOT WRONG, all three found by
 * review rather than by CI:
 *
 * 1. IT PARSED THE SOURCE WITH A REGEX that only matched a six-digit hex
 *    in quotes. `#FC3`, `rgb(255, 200, 60)` and `#FFC83CFF` are all
 *    accepted by MapLibre and all slipped through unmeasured — review
 *    put the rejected brand yellow back in three notations and this
 *    script said "all >= 3:1" each time. It now IMPORTS the module, so
 *    there is no notation to miss, and rejects any value that is not a
 *    plain six-digit hex rather than silently skipping it.
 *
 * 2. IT MEASURED FIVE OF THE SIX FILLS THE MAP DRAWS. `UNKNOWN_COLOUR`
 *    is painted by the point layer and was not in the measured set; its
 *    ΔE to the old `rv_park` was 17.9 against this file's own floor of
 *    25. The line "5 colours, all fine" was true of what it measured
 *    and not of the map.
 *
 * 3. IT MEASURED AGAINST THE MOST FAVOURABLE BACKGROUND. Contrast was
 *    taken against the stroke alone, which was white — and white has
 *    ~1.09 against the map's paper, so on land the ring is invisible and
 *    the fill carries the marker by itself. Against real basemap
 *    colours four of five fills were under 3:1, one at 1.81 over water.
 *    The stroke is now dark and BOTH are measured.
 *
 * 🔴 And the twin implementations are compared here, exhaustively,
 * because the comment claiming they agree was the only thing asserting
 * it. Review found the one input out of 1024 where they did not.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';
import { expression } from '@maplibre/maplibre-gl-style-spec';
import SERVED from '../../apps/web/src/data/basemap-colours.json' with { type: 'json' };
import {
  HAZARD_COLOUR,
  LINE_GUESS,
  MARKER_STROKE,
  ROUTE_LINE,
  TYPE_COLOUR,
  UNKNOWN_COLOUR,
  dominantColourExpression,
  dominantType,
} from '../../apps/web/src/lib/map-palette.ts';
// 🔴 CAMP-200. A module with no imports of its own, so that this file can
// read it: `lib/drought.ts` imports `./cems`, which `--experimental-strip-types`
// cannot resolve. The drought colours are painted over every campsite on the
// map and this guard did not know they existed.
import {
  DROUGHT_COLOURS,
  DROUGHT_RASTER_OPACITY,
  effectiveOpacity,
} from '../../apps/web/src/lib/drought-colours.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** WCAG 1.4.11: a non-text graphic needs 3:1 against the colour beside it. */
export const MIN_CONTRAST = 3;
/** Below this, two fills read as one colour on a 7px dot. */
export const MIN_DELTA_E = 25;

/**
 * What the marker actually sits on.
 *
 * 🔴 THE DESIGN'S OWN VALUES, not my estimates of them. The first version
 * of this file guessed at typical OpenFreeMap colours — and `_base.css`
 * in the mockups had been carrying `--map-land`, `--map-green`,
 * `--map-water`, `--map-road` and `--map-road-2` all along. I had read
 * `00-design-system.html` and concluded the design said nothing about
 * the map; it says it in the other file.
 *
 * Measuring against the real values is kinder than my guesses were:
 * worst visibility 11.23:1 rather than the 9.00 the estimates gave.
 *
 * 🔴 `_base.css` ALSO defines a dark set, and against it this palette
 * fails — the dark stroke reaches 1.30 on dark land, and three fills
 * drop to about 2.1. That is not a defect today: all three basemap
 * styles this site serves are light, which is why the dark set is not
 * in this object. It is a trap for whoever adds a dark basemap, so it is
 * written down rather than left to be discovered.
 */
/**
 * 🔴 THE TILES WE ACTUALLY SERVE, not tokens describing a map we do not.
 * This was the design's `--map-*` values, and the repository had already
 * written down why that is wrong: `check-design-tokens.mjs` lists every
 * one of them in `NOT_OURS` because "we serve hosted styles and do not
 * recolour them (CAMP-236)". A guard built on them measured a basemap
 * nobody is shown.
 *
 * Review caught it on CAMP-237. Against the real default — `liberty`,
 * which is `MAP_SOURCES[0]` — the route colour read **2.69** where the
 * token said 3.36, because liberty's water is `#9EBDFF`, not `#BFD6E4`.
 *
 * All three served styles are flattened into one object: a reader does
 * not pick a style per page, the map remembers theirs, so a colour has
 * to hold on whichever one they are on.
 */
export const BASEMAP = Object.fromEntries(
  Object.entries(SERVED.styles).flatMap(([style, colours]) =>
    Object.entries(colours).map(([surface, hex]) => [`${style}.${surface}`, hex])
  )
);

/**
 * The dark basemap the mockups define and this site does not serve.
 * (Still the design's tokens, deliberately: there is no served dark
 * style to read, which is CAMP-236's first question.)
 * Exported so the day somebody adds one, the check has the numbers
 * ready and this palette has to be re-decided rather than assumed.
 */
export const BASEMAP_DARK = {
  land: '#2B3140',
  green: '#2C3B35',
  water: '#233444',
  road: '#3C4457',
  roadCasing: '#4A4433',
};

const HEX = /^#[0-9A-Fa-f]{6}$/;

const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export const luminance = (hex) => {
  const [r, g, b] = [0, 1, 2].map((i) => linear(channel(hex, i)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

function lab(hex) {
  const [r, g, b] = [0, 1, 2].map((i) => linear(channel(hex, i)));
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export const deltaE = (a, b) => {
  const [la, lb] = [lab(a), lab(b)];
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
};

/** Every fill the map can paint — including the one for a kind we have no colour for. */
/**
 * 🔴 CAMP-112. Кільце попередження малюється з тією самою темною
 * обводкою, що й маркери, тож міряється там само — проти неї, а не
 * проти підкладки. Без цього рядка колір, якого мапа вже малює, не
 * міряв би ніхто, і сторож казав би «усі проходять» про множину, що
 * його не містить — рівно та помилка, якої цей файл уже припускався
 * з `UNKNOWN_COLOUR`.
 */
export const everyFill = (
  types = TYPE_COLOUR,
  unknown = UNKNOWN_COLOUR,
  hazard = HAZARD_COLOUR,
) => [
  ...Object.entries(types),
  ['«unknown»', unknown],
  // 🔴 CAMP-112: кільце попередження. Воно малюється з тією самою
  // темною обводкою, тож і міряється тут, а не окремо.
  ['«hazard»', hazard],
];

/** Can this marker be seen on that background — by its fill, or by its ring? */
const visibility = (fill, stroke, bg) =>
  Math.max(contrast(fill, bg), contrast(stroke, bg));

export function problems(fills, stroke, backgrounds = BASEMAP) {
  const out = [];

  // 🔴 A value we cannot measure is a failure, never a skip. This is the
  // line that `rgb(255, 200, 60)` walked past in the first version.
  if (!HEX.test(stroke)) out.push(`stroke ${stroke} is not a six-digit hex`);
  for (const [name, hex] of fills)
    if (!HEX.test(hex)) out.push(`${name} ${hex} is not a six-digit hex`);
  if (out.length) return out;

  for (const [name, hex] of fills) {
    const sep = contrast(hex, stroke);
    if (sep < MIN_CONTRAST)
      out.push(
        `${name} ${hex}: ${sep.toFixed(2)} against its own stroke ${stroke}, needs ${MIN_CONTRAST}`
      );
    for (const [where, bg] of Object.entries(backgrounds)) {
      const seen = visibility(hex, stroke, bg);
      if (seen < MIN_CONTRAST)
        out.push(
          `${name} ${hex} on ${where} ${bg}: ${seen.toFixed(2)}, needs ${MIN_CONTRAST}`
        );
    }
  }

  for (let i = 0; i < fills.length; i++)
    for (let j = i + 1; j < fills.length; j++) {
      const d = deltaE(fills[i][1], fills[j][1]);
      if (d < MIN_DELTA_E)
        out.push(
          `${fills[i][0]} and ${fills[j][0]} read alike: ΔE ${d.toFixed(1)}, needs ${MIN_DELTA_E}`
        );
    }
  return out;
}

/**
 * The MapLibre expression and the TypeScript twin must answer the same
 * thing for every cluster that can exist.
 *
 * 🔴 Driven through MapLibre's OWN evaluator, not a re-implementation.
 * A check that re-implements the thing it is checking agrees with
 * itself.
 */
export function twinsDisagree(types = Object.keys(TYPE_COLOUR), max = 3) {
  const compiled = expression.createExpression(dominantColourExpression(), {
    type: 'color',
    'property-type': 'data-driven',
    expression: { interpolated: false, parameters: ['feature'] },
  });
  if (compiled.result !== 'success')
    return [`the cluster expression does not compile: ${compiled.value?.[0]?.message ?? '?'}`];

  const bad = [];
  const total = (max + 1) ** types.length;
  for (let n = 0; n < total; n++) {
    const counts = {};
    let rest = n;
    for (const t of types) {
      counts[t] = rest % (max + 1);
      rest = Math.floor(rest / (max + 1));
    }
    // 🔴 String(), not the r/g/b fields. This evaluator hands back a
    // colour as a plain hex string, and reading `.r` off it gave NaN —
    // which rendered as "#NANNANNAN" and made EVERY vector look like a
    // disagreement. A comparison that fails on all 1024 inputs is not a
    // strict check, it is a broken one, and it would have hidden the
    // real single-input defect this function exists to catch.
    const asHex = String(
      compiled.value.evaluate({ zoom: 0 }, { properties: counts })
    ).toUpperCase();
    const t = dominantType(counts);
    const expected = (t ? TYPE_COLOUR[t] : UNKNOWN_COLOUR).toUpperCase();
    if (asHex !== expected)
      bad.push(`${JSON.stringify(counts)}: map ${asHex}, TypeScript ${expected}`);
    if (bad.length > 3) break;
  }
  return bad;
}

/**
 * What each line on the route map is made of.
 *
 * 🔴 A LINE CAN HAVE AN OUTLINE TOO, and the first version of this check
 * assumed it could not. That assumption produced a wrong conclusion:
 * uncased, `--route` has to clear 3:1 against the map by itself, and
 * against the tiles we actually serve it reads **2.69 on liberty's
 * water** — so the designer's colour would have had to be overruled.
 *
 * It does not. A casing under the line is what every map does, it is the
 * shape the campsite markers already use (CAMP-222), and it moves the
 * burden where it can be met: the casing clears every served basemap
 * colour at 8.99, and `--route` only separates from the casing, at 3.34.
 *
 * `opacity` is here because it was missing and it mattered: review found
 * `line-opacity: 0.9` on the live dashed line, measured here as solid.
 * Blended, 5.79 becomes 4.72 — still passing, so the fix was real, but
 * not by the margin claimed. Both lines now draw solid and the field
 * stays so the next 0.9 is measured rather than assumed.
 */
export const LINES = {
  ROUTE_LINE: { colour: ROUTE_LINE, casing: MARKER_STROKE, opacity: 1 },
  // No casing under a dashed line: it would fill the gaps and destroy
  // the one signal the dashes carry — that this is a guess, not a road.
  LINE_GUESS: { colour: LINE_GUESS, casing: null, opacity: 1 },
};

/** `colour` drawn at `alpha` over `bg`, as the pixel that results. */
export const blend = (colour, bg, alpha) => {
  if (alpha >= 1) return colour;
  const at = (c, i) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  return (
    '#' +
    [0, 1, 2]
      .map((i) => Math.round(alpha * at(colour, i) + (1 - alpha) * at(bg, i)))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
};

/**
 * Lines a reader cannot pick out from the map they cross.
 *
 * A cased line is judged like a marker: the casing against every basemap
 * colour, the line against its casing. An uncased one clears the map.
 */
export function lineProblems(lines = LINES, backgrounds = BASEMAP) {
  const out = [];
  for (const [name, { colour, casing, opacity }] of Object.entries(lines)) {
    if (casing) {
      for (const [surface, bg] of Object.entries(backgrounds)) {
        const r = contrast(casing, bg);
        if (r < MIN_CONTRAST)
          out.push(`${name}: its casing ${casing} is ${r.toFixed(2)}:1 on ${surface} ${bg}`);
      }
      const r = contrast(blend(colour, casing, opacity), casing);
      if (r < MIN_CONTRAST)
        out.push(
          `${name} ${colour} is ${r.toFixed(2)}:1 against its own casing ${casing}` +
            `${opacity < 1 ? ` at opacity ${opacity}` : ''}`
        );
    } else {
      for (const [surface, bg] of Object.entries(backgrounds)) {
        const r = contrast(blend(colour, bg, opacity), bg);
        if (r < MIN_CONTRAST)
          out.push(
            `${name} ${colour} is ${r.toFixed(2)}:1 on ${surface} ${bg}` +
              `${opacity < 1 ? ` at opacity ${opacity}` : ''} — it has no casing, ` +
              `so it must clear ${MIN_CONTRAST}:1 against the map itself`
          );
      }
    }
  }
  const names = Object.keys(lines);
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const d = deltaE(lines[names[i]].colour, lines[names[j]].colour);
      if (d < MIN_DELTA_E)
        out.push(`${names[i]} and ${names[j]} are ΔE ${d.toFixed(1)} apart, under ${MIN_DELTA_E}`);
    }
  return out;
}

/**
 * Line colours written straight into the component.
 *
 * 🔴 THE GUARD WATCHED THE CONSTANTS AND NOT THEIR USE, and review
 * proved it the only way that counts: it put `'line-color': '#8A93A6'`
 * — the exact defect this card fixes — back into `route-map.tsx`,
 * touched no constant, and both checks exited 0. Nothing in `scripts/ci`
 * read the component; the e2e specs assert visibility, not colour; the
 * visual baselines mask the canvas.
 *
 * A palette measured here means nothing unless the map uses it.
 *
 * Only `line-color`: a line is the case with no casing to fall back on,
 * and the circle colours in that file are design tokens the card checked
 * by hand. Widening this is a change with its own argument.
 */
export function literalLineColours(source) {
  const out = [];
  const re = /'line-color':\s*'(#[0-9A-Fa-f]{3,8}|rgb[^']*|hsl[^']*)'/g;
  for (const m of source.matchAll(re))
    out.push(
      `'line-color': '${m[1]}' is written into the component — a colour nobody ` +
        'measured. Import it from lib/map-palette.ts, where the check can see it.'
    );
  return out;
}

/**
 * 🔴 CAMP-315, REWRITTEN 14.10.2026 BY THE OWNER'S DECISION: THE DROUGHT PICTURE
 * MIRRORS THE SOURCE, AND THIS GUARD NOW ASKS THREE DIFFERENT QUESTIONS.
 *
 * WHAT IT ASKED BEFORE, AND WHY THAT STOPPED MAKING SENSE. Through CAMP-200 and
 * the first CAMP-315 rounds the palette was OURS, so the guard judged whether
 * our colours were good: class 0 the lightest, a ladder that darkens and warms
 * (a CIELAB hue band for yellow-to-brown, no red), recovery one cool colour,
 * and for a while one named pair allowed under the bar. Every one of those was
 * a rule about a design WE had drawn. The owner decided to draw what the source
 * publishes instead (EDO's own CDI v4.1.1 colours), and when the series comes
 * from the source, "are our colours well chosen" is not the question any more —
 * "did we show what they published" is. So, DELETED, not forgotten:
 *
 *  · `WARM_HUE` / `COOL_HUE` and the hue check: EDO's yellow, orange, red and
 *    its three recovery colours (lilac, pink, green) are not our bands.
 *  · "the recovery classes are ONE colour": that was our merge. EDO draws 4, 5
 *    and 6 in three different colours, and the legend now prints three rows.
 *  · the order rules (class 0 the lightest, 0 → 1 → 2 → 3 darker): the ladder is
 *    EDO's now. 🔴 What goes with them: nothing stops a future class 0 from
 *    being dark. Class 0 is one of the two named exceptions below, and what is
 *    asked of it is rules 2 and 3 — which a dark class 0 over the campsite
 *    markers fails on its own (that is how CAMP-200 found it).
 *  · "NOT A TRAFFIC LIGHT / no red": CAMP-162 kept red for the campsite markers
 *    (`#C83D28`, `#D5412A`) and the first rounds barred it from the drought
 *    series. EDO draws Alert `#DC050C`. 🔴 THIS WAS CHECKED, NOT FORGOTTEN:
 *    markers over the Alert pixel hold 3:1 (rule 3 measures it every run; at
 *    the shipped opacity the worst is printed for class 3 in the table below —
 *    over liberty's water — and it is the lowest of all seven). The red markers
 *    are told from a red layer by their dark ring, not by their fill.
 *  · the named pair exception for 2–3: it belonged to our muted palette.
 *
 * THE THREE RULES, in the order a reader of the table meets them:
 *
 *  1. CONFORMITY TO THE SOURCE. Classes 1, 2, 3, 5 and 6 EQUAL the values
 *     recorded in `EDO_SOURCE` — the hex, and alpha 255, byte for byte. This
 *     catches the thing that matters most: somebody nudges a colour and we stop
 *     showing what the source published.
 *  2. VISIBILITY ON OUR MAP. Every class, as the reader sees it (alpha ×
 *     `DROUGHT_RASTER_OPACITY`): ΔE >= `MIN_DELTA_E` from each of the eleven
 *     basemap colours we serve, and from every other class. "Is the layer
 *     there at all" and "can these two classes be told apart" — the colours
 *     the source chose were made for its own white map, not for our pale land,
 *     white roads and pale water.
 *  3. THE MARKERS. The campsite markers drawn on top stay >= `MIN_CONTRAST`
 *     over the pixel of every class.
 *
 * TWO CLASSES ARE OURS, BY NAME, and are held to rules 2 and 3 only — never
 * rule 1 (`EDO_SOURCE.own`, each with its reason and its date):
 *
 *  · class 0: EDO draws "no drought" white/transparent. Bare on OUR map means
 *    "the indicator does not look here" (Malta, the sea), so class 0 must be
 *    drawn or the map says about Malta what the mask exists to stop it saying.
 *    It stays `#9CFE84`, proved in CAMP-200.
 *  · class 4 "Recovery": EDO's `#CAB2D6` is a pale lilac and clears no
XX Ours is the colour nearest to it, in
 *    ΔE, that clears rules 2 and 3 at the shipped opacity.
 *
 * THE OPACITY IS ITS OWN QUESTION, and the guard is why it has a number. The
 * pixel over a basemap colour is the class colour at `alpha/255 ×
 * raster-opacity`, so the same EDO colours that read as one at one opacity read
 * as two at another. The shipped value is the LOWEST (step 0.01) at which
 * classes 0, 1, 2, 3, 5 and 6 clear rules 2 and 3 together — lower is better,
 * because the basemap should stay visible under the layer. What sets it, as the
 * guard measures it: Watch against Warning, which are ΔE 21.3 apart at 0.65 and
 * 24.87 at 0.74.
 *
 * 🔴 WHAT IS DELIBERATELY NOT HELD: A CONTRAST OF A FILL AGAINST THE MAP.
 * `MIN_CONTRAST` answers "can a mark or a word be read on this colour" — it is
 * why the markers are held to it. Whether a FILL can be told from the absence
 * of one is a question of colour DIFFERENCE, and that is ΔE.
 */

/**
 * WHAT THE SOURCE PUBLISHES, recorded next to where it is measured.
 *
 * Measured 14.10.2026 from three independent places that agree: the CDI v4.1.1
 * fact sheet, the style config `combinedDroughtIndicatorAllClassesStyle`, and
 * the colours a `GetMap` request returns. The fact sheet (Table 1, v4.1.1, July
 * 2026) shows the seven levels as colour swatches and prints no hex codes, so
 * the values come from the config and the render; the swatches in the PDF
 * match them by eye (yellow, orange, red; lilac, pink, green).
 */
export const EDO_SOURCE = {
  indicator: 'Combined Drought Indicator (CDI) v4.1.1',
  factsheet: 'https://drought.emergency.copernicus.eu/data/factsheets/factsheet_combinedDroughtIndicator_v4.pdf',
  styleConfig: 'combinedDroughtIndicatorAllClassesStyle',
  measured: '2026-10-14',
  /** class -> the hex the source draws it in (its alpha is 255: the layer's opacity is OURS). */
  colours: {
    1: '#F0E442', // Watch
    2: '#E69F00', // Warning
    3: '#DC050C', // Alert
    5: '#CC79A7', // Temporary Soil Moisture recovery
    6: '#009E73', // Temporary vegetation recovery
  },
  /** The classes that are OURS: not required to equal anything, required to clear rules 2 and 3. */
  own: {
    0: {
      edo: '#FFFFFF (transparent)',
      reason:
        'EDO draws "no drought" white/transparent; on our map bare means "the indicator does not look here", ' +
        'so "covered and fine" must be drawn (CAMP-200)',
      decided: '2026-10-14',
    },
    4: {
      edo: '#CAB2D6',
      reason:
        'EDO\'s pale lilac clears no opacity on our pale basemaps (best worst-case ΔE 21.9 at opacity 0.99); ' +
        'ours is the colour nearest to it that clears rules 2 and 3',
      decided: '2026-10-14',
    },
  },
};
/** Every class is held to rules 2 and 3, the two named exceptions included. */
export const DROUGHT_HELD = [0, 1, 2, 3, 4, 5, 6];

/** `#RRGGBB` of the opaque colour: what rule 1 compares, upper-cased. */
const sameHex = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toUpperCase() === b.toUpperCase();

/**
 * The record itself must be one a reader can follow up: a source, a date, a
 * six-digit colour per class, and for each named exception its reason and date.
 * 🔴 A record that cannot be checked is a failure, never a skip — the same rule
 * as every unmeasurable value in this file.
 */
export function sourceRecordProblems(source = EDO_SOURCE) {
  const out = [];
  if (!/^https:\/\/\S+$/.test(source.factsheet ?? ''))
    out.push(`the source record has no fact-sheet URL (${source.factsheet})`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.measured ?? ''))
    out.push(`the source record has no date it was measured on (${source.measured})`);
  for (const [v, hex] of Object.entries(source.colours ?? {}))
    if (!HEX.test(hex)) out.push(`source class ${v}: ${hex} is not a six-digit hex`);
  for (const [v, own] of Object.entries(source.own ?? {})) {
    if (source.colours?.[v] !== undefined)
      out.push(`class ${v} is both a source colour and a named exception`);
    if (typeof own.reason !== 'string' || own.reason.trim().length < 20)
      out.push(`the named exception for class ${v} has no reason`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(own.decided ?? ''))
      out.push(`the named exception for class ${v} has no date`);
  }
  return out;
}

/**
 * RULE 1. The classes the source publishes equal the source, byte for byte; the
 * classes that are ours are named; nothing else exists.
 */
export function sourceProblems(colours, source = EDO_SOURCE) {
  const out = sourceRecordProblems(source);
  if (out.length) return out;
  for (const [v, hex] of Object.entries(source.colours)) {
    const mine = colours[v];
    if (!mine) {
      out.push(`class ${v}: the source publishes ${hex} and the table has no colour for it`);
      continue;
    }
    if (!sameHex(mine.hex, hex))
      out.push(
        `class ${v} is drawn ${mine.hex} but the source publishes ${hex} (${source.indicator}, measured ${source.measured}, ` +
          `${source.factsheet}): a class that is not a named exception must equal it`
      );
    if (mine.alpha !== 255)
      out.push(`class ${v} is drawn at alpha ${mine.alpha}: the source's colour is opaque, and the layer's opacity is the one place ours is applied`);
  }
  for (const v of Object.keys(source.own))
    if (!colours[v]) out.push(`class ${v} is a named exception and has no colour`);
  for (const v of Object.keys(colours))
    if (source.colours[v] === undefined && source.own[v] === undefined)
      out.push(`class ${v} is neither in the source record nor a named exception: say which`);
  return out;
}

/** What one class looks like over one basemap colour, and how well it separates. */
export function droughtPixel(hex, alpha, bg, rasterOpacity) {
  const eff = (alpha / 255) * rasterOpacity;
  const pixel = blend(hex, bg, eff);
  return { eff, pixel, contrast: contrast(pixel, bg), deltaE: deltaE(pixel, bg) };
}

/**
 * The three rules, on `colours` at `rasterOpacity`. `source` is rule 1's record;
 * `null` leaves rule 1 out, which is how the self-test below asks about rules 2
 * and 3 with small hand-made tables.
 */
export function droughtProblems(
  colours = DROUGHT_COLOURS,
  rasterOpacity = DROUGHT_RASTER_OPACITY,
  backgrounds = BASEMAP,
  held = DROUGHT_HELD,
  fills = everyFill(),
  stroke = MARKER_STROKE,
  source = EDO_SOURCE,
) {
  const out = [];
  const classes = Object.entries(colours).map(([v, c]) => [Number(v), c]);

  // 🔴 A value we cannot measure is a failure, never a skip.
  if (!(rasterOpacity > 0 && rasterOpacity <= 1))
    out.push(`raster-opacity ${rasterOpacity} is not in (0, 1]`);
  for (const [v, { hex, alpha }] of classes) {
    if (!HEX.test(hex)) out.push(`drought class ${v}: ${hex} is not a six-digit hex`);
    if (!Number.isInteger(alpha) || alpha < 0 || alpha > 255)
      out.push(`drought class ${v}: alpha ${alpha} is not an integer from 0 to 255`);
  }
  for (const v of held)
    if (!colours[v]) out.push(`drought class ${v} is held to the thresholds and has no colour`);
  if (out.length) return out;

  // RULE 1.
  if (source) out.push(...sourceProblems(colours, source));

  // RULE 2. Against every basemap colour, and against every other class once.
  const bgs = Object.entries(backgrounds);
  for (const v of held) {
    const { hex, alpha } = colours[v];
    for (const [where, bg] of bgs) {
      const r = droughtPixel(hex, alpha, bg, rasterOpacity);
      // 🔴 ΔE and not a contrast: see "WHAT IS DELIBERATELY NOT HELD" above.
      if (r.deltaE < MIN_DELTA_E)
        out.push(
          `drought class ${v} ${hex} at ${(r.eff * 100).toFixed(1)}% reads like ${where} ${bg}: ` +
            `ΔE ${r.deltaE.toFixed(1)}, needs ${MIN_DELTA_E}`
        );
      for (const [w, other] of classes) {
        if (w === v || (held.includes(w) && w < v)) continue;
        const o = droughtPixel(other.hex, other.alpha, bg, rasterOpacity);
        const d = deltaE(r.pixel, o.pixel);
        if (d < MIN_DELTA_E)
          out.push(
            `drought classes ${v} and ${w} read alike on ${where} ${bg}: ΔE ${d.toFixed(1)}, needs ${MIN_DELTA_E}`
          );
      }
    }
  }

  // RULE 3. The markers, on the pixel. Grouped by class and surface, naming the
  // worst marker: five fills sharing one ring would otherwise print five lines
  // for one fact.
  for (const [v, { hex, alpha }] of classes) {
    for (const [where, bg] of bgs) {
      const { pixel } = droughtPixel(hex, alpha, bg, rasterOpacity);
      let worst = null;
      for (const [name, fill] of fills) {
        const seen = visibility(fill, stroke, pixel);
        if (worst === null || seen < worst.seen) worst = { name, seen };
      }
      if (worst && worst.seen < MIN_CONTRAST)
        out.push(
          `markers over drought class ${v} on ${where} ${bg} (pixel ${pixel}): ` +
            `the worst, ${worst.name}, is ${worst.seen.toFixed(4)}:1, needs ${MIN_CONTRAST}`
        );
    }
  }
  return out;
}

/**
 * The worst figure each class reaches, over every basemap colour — what the
 * printed table at the bottom of this file shows, kept as a function so that a
 * number in a report and a number the check compares are one computation.
 */
export function droughtWorst(
  colours = DROUGHT_COLOURS,
  rasterOpacity = DROUGHT_RASTER_OPACITY,
  backgrounds = BASEMAP,
  fills = everyFill(),
  stroke = MARKER_STROKE,
  source = EDO_SOURCE,
) {
  const out = {};
  for (const [v, { hex, alpha }] of Object.entries(colours)) {
    const worst = {
      matches: source?.colours?.[v] === undefined ? null : sameHex(hex, source.colours[v]) && alpha === 255,
      basemap: { deltaE: Infinity, where: null },
      other: { deltaE: Infinity, where: null },
      markers: { seen: Infinity, where: null },
    };
    for (const [where, bg] of Object.entries(backgrounds)) {
      const r = droughtPixel(hex, alpha, bg, rasterOpacity);
      if (r.deltaE < worst.basemap.deltaE) worst.basemap = { deltaE: r.deltaE, where };
      for (const [u, other] of Object.entries(colours)) {
        if (u === v) continue;
        const d = deltaE(r.pixel, droughtPixel(other.hex, other.alpha, bg, rasterOpacity).pixel);
        if (d < worst.other.deltaE) worst.other = { deltaE: d, where: `class ${u} on ${where}` };
      }
      for (const [, fill] of fills) {
        const seen = visibility(fill, stroke, r.pixel);
        if (seen < worst.markers.seen) worst.markers = { seen, where };
      }
    }
    out[v] = worst;
  }
  return out;
}

/**
 * Whether the map paints the drought picture with the number this file
 * measured.
 *
 * 🔴 A palette measured here means nothing unless the map uses it — the
 * lesson `literalLineColours` records. The measurement above multiplies by
 * `DROUGHT_RASTER_OPACITY`; if `campsite-map.tsx` painted its own `0.4`, or
 * left the property out (MapLibre's default is 1), every number printed here
 * would be about a picture nobody sees.
 */
export function rasterOpacityProblems(source) {
  const out = [];
  const re = /['"]raster-opacity['"]\s*:\s*([^,}\n]+)/g;
  const found = [...source.matchAll(re)].map((m) => m[1].trim());
  if (found.length === 0)
    out.push(
      'no `raster-opacity` is set on the drought layer: MapLibre would draw it at 1, ' +
        'and the colours measured here assume DROUGHT_RASTER_OPACITY'
    );
  for (const value of found)
    if (value !== 'DROUGHT_RASTER_OPACITY')
      out.push(
        `\`raster-opacity: ${value}\` is written into the component — a number the palette ` +
          'check does not multiply by. Import DROUGHT_RASTER_OPACITY from lib/drought-colours.ts.'
      );
  return out;
}

/** 🔴 Rehearsed, not trusted. Each case is one the real check must still refuse. */
function selfTest() {
  const fails = [];
  let cases = 0;
  // 🔴 CAMP-315: `dp` is `droughtProblems` for rules 2 and 3 alone: no source
  // record, because the hand-made tables below are not EDO's. The cases that ask
  // about rule 1 call `droughtProblems` with the record, through `three`.
  const dp = (colours, rasterOpacity, backgrounds, held, fills, stroke, source = null) =>
    droughtProblems(colours, rasterOpacity, backgrounds, held, fills, stroke, source);
  const dark = '#181D26';
  cases++;
  if (problems([['x', '#FFC83C']], '#FFFFFF').length === 0)
    fails.push('a 1.55:1 fill against a white stroke was accepted');
  // The notations that walked past the old regex.
  for (const bad of ['#FC3', 'rgb(255, 200, 60)', '#FFC83CFF', 'gold'])
    // 🔴 Counted INSIDE the loop. The first version counted the `if`
    // statements it could see at one indent and missed these four
    // entirely, which is how "13 cases" survived beside 15 assertions.
    if (cases++, problems([['x', bad]], dark).length === 0)
      fails.push(`the unmeasurable value ${bad} was accepted`);
  cases++;
  if (problems([['a', '#D5412A'], ['b', '#C83D28']], dark).length === 0)
    fails.push('two colours at ΔE 4.8 were accepted');
  // A fill that passes against its stroke but vanishes on water.
  // 🔴 THESE THREE CALLED `fail()`, WHICH DOES NOT EXIST IN THIS FILE.
  // The self-test did exit non-zero, so it was not blind — but it exited
  // on a ReferenceError, so it named the wrong thing, and a guard that
  // reports the wrong thing is read wrong. Review found it.
  const bare = (hex) => ({ L: { colour: hex, casing: null, opacity: 1 } });
  cases++;
  if (lineProblems(bare('#8A93A6')).length === 0)
    fails.push('an uncased line at 1.56:1 over liberty water was accepted');
  cases++;
  if (lineProblems(bare('#343D50')).length !== 0)
    fails.push('an uncased line at 5.79:1 over its worst surface was refused');
  // 🔴 ΔE 4.8, not 8 — the old text said 8 and the pair is 4.8.
  cases++;
  if (
    lineProblems({
      A: { colour: '#C83D28', casing: null, opacity: 1 },
      B: { colour: '#D5412A', casing: null, opacity: 1 },
    }).length === 0
  )
    fails.push('two lines ΔE 4.8 apart were accepted as distinguishable');
  cases++;
  if (lineProblems({ L: { colour: '#C83D28', casing: '#D5412A', opacity: 1 } }).length === 0)
    fails.push('a line ΔE 4.8 from its own casing was accepted');
  cases++;
  if (lineProblems({ L: { colour: '#C83D28', casing: '#FFFFFF', opacity: 1 } }).length === 0)
    fails.push('a casing invisible on a white road was accepted');
  cases++;
  if (lineProblems({ L: { colour: '#343D50', casing: null, opacity: 0.15 } }).length === 0)
    fails.push('a line at opacity 0.15 was measured as if it were solid');
  // 🔴 The mutation review used. Without this the palette can be perfect
  // and the map can ignore it.
  cases++;
  if (literalLineColours(`'line-color': '#8A93A6',`).length === 0)
    fails.push('a hex line colour written into the component was accepted');
  cases++;
  if (literalLineColours(`'line-color': ROUTE_LINE,`).length !== 0)
    fails.push('an imported line colour was reported as a literal');
  cases++;
  if (problems([['x', '#7C92B7']], '#FFFFFF', { water: '#A0C8F0' }).length === 0)
    fails.push('a fill invisible over water was accepted');
  // 🔴 CAMP-200. THE DROUGHT PICTURE, RULES 2 AND 3. Each case is one the real
  // run on the shipped table has to be able to fail — and the shipped table is
  // not used here at all, so the rehearsal does not move when the colours do.
  //
  // The tables are small and hand-made. `oldZero` is the first version of
  // class 0 (measured: ΔE 4.0 over the map). `goodZero` is a light class 0
  // that clears everything. `darkZero` is the colour an earlier version of
  // this check demanded — dark enough for 3:1 against the map — which clears
  // ΔE and costs the markers. `midZero` keeps the markers and fails ΔE.
  // `dp` leaves rule 1 (the source) out: these tables are not EDO's.
  const oldZero = { 0: { hex: '#9CC5A1', alpha: 90 } };
  const goodZero = { 0: { hex: '#9CFE84', alpha: 255 } };
  const darkZero = { 0: { hex: '#1C4418', alpha: 255 } };
  const midZero = { 0: { hex: '#6E7889', alpha: 255 } };
  const paleOne = { hex: '#F2D98A', alpha: 255 };
  const ring = dark; // the marker stroke, declared at the top of this function
  const blackRing = '#000000';
  const has = (list, re) => list.some((l) => re.test(l));
  cases++;
  if (!has(dp(oldZero, 0.65, BASEMAP, [0]), /class 0 .*at 22\.9%.*ΔE 4\.0/))
    fails.push('the first version of class 0, 22.9% over the map at ΔE 4, was accepted');
  // 🔴 The alpha IN THE TABLE is not what is seen. Same colour, same alpha:
  // at the layer's own opacity it clears; at 0.3 it does not.
  cases++;
  if (dp(goodZero, 1, BASEMAP, [0], [], ring).length !== 0)
    fails.push('a light class 0 at full strength was refused although it clears ΔE');
  cases++;
  if (!has(dp(goodZero, 0.3, BASEMAP, [0], [], ring), /class 0 .*ΔE/))
    fails.push('the layer raster-opacity was ignored: a class that fails at 30% was measured as if it were solid');
  // The cost of a dark tint, and the way out of it. One ring, one pixel.
  cases++;
  if (!has(dp(darkZero, 0.65, BASEMAP, [0], undefined, ring), /markers over drought class 0 /))
    fails.push('a tint that leaves a campsite marker under 3:1 on the pixel was accepted');
  cases++;
  if (dp(darkZero, 0.65, BASEMAP, [0], undefined, blackRing).length !== 0)
    fails.push('a dark class 0 with a dark enough ring was refused');
  cases++;
  if (!has(dp(midZero, 0.65, BASEMAP, [0], [], ring), /class 0 .*ΔE/))
    fails.push('a class 0 at ΔE 20 from its map was accepted');
  // 🔴 NOT HELD TO A CONTRAST. The light class 0 is 1.3:1 against some
  // surface and must not be refused for it: whether a fill is told from
  // the map is ΔE's question.
  cases++;
  if (dp(goodZero, 0.65, BASEMAP, [0], [], ring).length !== 0)
    fails.push('a light class 0 that clears ΔE and the markers was refused for its contrast');
  // Only what is held is held to the bare map; everything is held to the markers.
  cases++;
  if (has(dp({ ...goodZero, 1: paleOne }, 0.65, BASEMAP, [0], [], ring), /class 1 .*ΔE/))
    fails.push('a class that is not held was reported against the bare map');
  cases++;
  if (!has(dp({ ...goodZero, 1: { hex: '#9DFE85', alpha: 255 } }, 0.65, BASEMAP, [0], [], ring), /classes 0 and 1 read alike/))
    fails.push('class 0 and a class one shade away were accepted as two things');
  // Values that cannot be measured.
  cases++;
  if (dp({ 0: { hex: '#FC3', alpha: 255 } }, 0.65, BASEMAP, []).length === 0)
    fails.push('a drought colour in three-digit notation was accepted');
  // 🔴 `[]` for the fills and `[0]` for the held class on the next two, and
  // not the defaults: with the defaults this table is refused for the markers
  // anyway, so a validation that had been deleted would still have been
  // "caught" by something else. Measured by deleting it: both survived.
  cases++;
  if (dp({ 0: { hex: '#9CFE84', alpha: 300 } }, 0.65, BASEMAP, [0], [], ring).length === 0)
    fails.push('an alpha of 300 was accepted');
  cases++;
  if (dp(goodZero, 0, BASEMAP, [], [], ring).length === 0)
    fails.push('a raster-opacity of 0 was accepted');
  cases++;
  if (dp(goodZero, 1.5, BASEMAP, [], [], ring).length === 0)
    fails.push('a raster-opacity above 1 was accepted');
  // A marker is seen by its fill OR by its ring. Over a pixel so dark that the
  // ring is lost (2.7:1), a pale fill still carries it (4+:1) — and a check
  // that looked at the ring alone would refuse a table that is fine.
  cases++;
  if (
    dp(
      { 0: { hex: '#101010', alpha: 255 } },
      0.65,
      BASEMAP,
      [],
      [['rv_park', '#C9D3E4']],
      ring
    ).length !== 0
  )
    fails.push('a marker carried by its pale fill over a dark pixel was refused');
  // The map must use the number that was measured.
  cases++;
  if (rasterOpacityProblems('paint: { "raster-opacity": 0.65, }').length === 0)
    fails.push('a literal raster-opacity written into the component was accepted');
  cases++;
  if (rasterOpacityProblems('paint: { "raster-opacity": DROUGHT_RASTER_OPACITY, }').length !== 0)
    fails.push('the imported raster-opacity was refused');
  cases++;
  if (rasterOpacityProblems('paint: { "raster-resampling": "nearest" }').length === 0)
    fails.push('a drought layer with no raster-opacity at all was accepted');

  // 🔴 CAMP-315 (owner, 14.10.2026): THE PICTURE MIRRORS THE SOURCE. `GOOD` is the
  // whole table written out by hand — EDO's five colours, class 0 and the colour
  // of class 4 that are ours — at the opacity measured, so the rehearsal does not
  // move when the shipped table does. Every case below is ONE thing wrong with
  // it, or the one thing it is allowed.
  const OPACITY = 0.76;
  const edo = EDO_SOURCE.colours;
  const GOOD = {
    0: { hex: '#9CFE84', alpha: 255 },
    1: { hex: edo[1], alpha: 255 },
    2: { hex: edo[2], alpha: 255 },
    3: { hex: edo[3], alpha: 255 },
    4: { hex: '#757591', alpha: 255 },
    5: { hex: edo[5], alpha: 255 },
    6: { hex: edo[6], alpha: 255 },
  };
  const ALL = [0, 1, 2, 3, 4, 5, 6];
  const three = (table, opacity = OPACITY, held = ALL, fills = undefined, stroke = ring) =>
    droughtProblems(table, opacity, BASEMAP, held, fills, stroke, EDO_SOURCE);
  // The positive control. With the source's five colours required byte for byte,
  // a check that refused every table would "catch" every case below.
  cases++;
  if (three(GOOD).length !== 0)
    fails.push('the right table (EDO\'s five colours, ours for 0 and 4, opacity 0.76) was refused by one of the three rules');
  // RULE 1: each of the five equals the source — one step off in one channel is a different colour.
  const nudge = (hex) => {
    const n = parseInt(hex.slice(1, 3), 16);
    return '#' + (n < 255 ? n + 1 : n - 1).toString(16).padStart(2, '0').toUpperCase() + hex.slice(3);
  };
  for (const v of [1, 2, 3, 5, 6])
    if (
      cases++,
      !has(three({ ...GOOD, [v]: { hex: nudge(edo[v]), alpha: 255 } }, OPACITY, []), new RegExp(`class ${v} is drawn #\\w+ but the source publishes ${edo[v]}`))
    )
      fails.push(`class ${v} drawn one step off the source's ${edo[v]} was accepted`);
  cases++;
  if (!has(three({ ...GOOD, 2: { hex: '#D95F02', alpha: 255 } }, OPACITY, []), /class 2 is drawn #D95F02 but the source publishes #E69F00/))
    fails.push('class 2 swapped for another colour altogether was accepted');
  cases++;
  if (!has(three({ ...GOOD, 3: { hex: edo[3], alpha: 254 } }, OPACITY, []), /class 3 is drawn at alpha 254/))
    fails.push('an EDO class drawn at alpha 254 was accepted as the source\'s colour');
  cases++;
  const { 6: _sixth, ...withoutSix } = GOOD;
  if (!has(three(withoutSix, OPACITY, []), /class 6: the source publishes #009E73 and the table has no colour/))
    fails.push('a class the source publishes, missing from the table, was accepted');
  cases++;
  if (!has(three({ ...GOOD, 7: { hex: '#123456', alpha: 255 } }, OPACITY, []), /class 7 is neither in the source record nor a named exception/))
    fails.push('a class that is neither the source\'s nor a named exception was accepted');
  // THE TWO NAMED EXCEPTIONS are held to rules 2 and 3 and NOT to rule 1: class 0
  // is `#9CFE84` and EDO draws it white, class 4 is not `#CAB2D6`, and `GOOD`
  // (above) passes. Here: they are still held to rule 2 — EDO's own white for
  // class 0 vanishes into our white roads, EDO's own lilac for class 4 into our
  // pale land — and neither is reported for differing from the source.
  cases++;
  {
    const p = three({ ...GOOD, 4: { hex: '#CAB2D6', alpha: 255 } });
    if (!has(p, /drought class 4 #CAB2D6 .*reads like .*ΔE/) || has(p, /class 4 is drawn/))
      fails.push('class 4 at EDO\'s #CAB2D6 was accepted, or was refused for differing from the source instead of for ΔE');
  }
  cases++;
  {
    const p = three({ ...GOOD, 0: { hex: '#FFFFFF', alpha: 255 } });
    if (!has(p, /drought class 0 #FFFFFF .*reads like liberty\.road/) || has(p, /class 0 is drawn/))
      fails.push('class 0 at EDO\'s white was accepted, or was refused for differing from the source instead of for ΔE');
  }
  // The named exceptions are exactly the two the owner named, so a third cannot be
  // slipped in to excuse a class from rule 1 without this literal changing too.
  cases++;
  if (JSON.stringify(Object.keys(EDO_SOURCE.own)) !== JSON.stringify(['0', '4']))
    fails.push(`the named exceptions are ${Object.keys(EDO_SOURCE.own)}, not 0 and 4`);
  // RULE 2, the opacity: the EDO palette at the layer's old 0.65 has Watch and
  // Warning at ΔE 21.3 from each other — the reason the opacity is what it is.
  cases++;
  if (!has(three(GOOD, 0.65), /classes 1 and 2 read alike on .*ΔE 2[01]\./))
    fails.push('the EDO palette at opacity 0.65, Watch and Warning ΔE 21 apart, was accepted');
  // RULE 3: the markers over EDO's Alert red. A ring too light to carry them is lost over it.
  cases++;
  if (!has(three(GOOD, OPACITY, ALL, undefined, '#808080'), /markers over drought class 3 /))
    fails.push('markers over the Alert red with a ring that does not carry them were accepted');
  // The record itself must be one a reader can follow up.
  cases++;
  if (sourceRecordProblems(EDO_SOURCE).length !== 0)
    fails.push('the source record was refused: ' + sourceRecordProblems(EDO_SOURCE)[0]);
  cases++;
  if (!has(sourceRecordProblems({ ...EDO_SOURCE, factsheet: '' }), /no fact-sheet URL/))
    fails.push('a source record with no fact-sheet URL was accepted');
  cases++;
  if (!has(sourceRecordProblems({ ...EDO_SOURCE, measured: 'yesterday' }), /no date it was measured on/))
    fails.push('a source record with no measurement date was accepted');
  cases++;
  if (!has(sourceRecordProblems({ ...EDO_SOURCE, own: { ...EDO_SOURCE.own, 0: { ...EDO_SOURCE.own[0], reason: '' } } }), /named exception for class 0 has no reason/))
    fails.push('a named exception with no reason was accepted');
  cases++;
  if (!has(sourceRecordProblems({ ...EDO_SOURCE, own: { ...EDO_SOURCE.own, 4: { ...EDO_SOURCE.own[4], decided: undefined } } }), /named exception for class 4 has no date/))
    fails.push('a named exception with no date was accepted');
  cases++;
  if (!has(sourceRecordProblems({ ...EDO_SOURCE, own: { ...EDO_SOURCE.own, 2: EDO_SOURCE.own[4] } }), /class 2 is both a source colour and a named exception/))
    fails.push('a class that is both a source colour and a named exception was accepted');
  // 🔴 WHICH CLASSES EXIST comes from the data file, not from this script: a
  // class EDO adds, or one the held list quietly stopped naming, must be red.
  const FILE_CLASSES = JSON.parse(
    readFileSync(join(ROOT, 'apps/web/src/data/drought.json'), 'utf8')
  ).meta.classes.map((c) => c.value);
  cases++;
  if (FILE_CLASSES.length < 7 || FILE_CLASSES.some((v) => !DROUGHT_HELD.includes(v)))
    fails.push(`a class the data file describes is not held to the thresholds: ${FILE_CLASSES} against ${DROUGHT_HELD}`);
  cases++;
  if (FILE_CLASSES.some((v) => EDO_SOURCE.colours[v] === undefined && EDO_SOURCE.own[v] === undefined))
    fails.push('a class the data file describes is neither in the source record nor a named exception');
  // The printed table is the check's own figure, not a second computation.
  cases++;
  {
    const w = droughtWorst({ ...goodZero, 1: paleOne }, 0.65, BASEMAP, [], ring, null);
    if (w[1].basemap.where !== 'liberty.trunk' || Math.abs(w[1].basemap.deltaE - 6.6) > 0.05)
      fails.push(`the printed worst basemap ΔE for #F2D98A is ${w[1].basemap.deltaE.toFixed(2)} on ${w[1].basemap.where}, not 6.6 on liberty.trunk`);
  }
  cases++;
  {
    const w = droughtWorst(GOOD, OPACITY, BASEMAP, [], ring, EDO_SOURCE);
    const off = droughtWorst({ ...GOOD, 2: { hex: nudge(edo[2]), alpha: 255 } }, OPACITY, BASEMAP, [], ring, EDO_SOURCE);
    if (w[2].matches !== true || off[2].matches !== false || w[0].matches !== null || w[4].matches !== null)
      fails.push('the printed table says a class equals the source when it does not (or the reverse), or judges a named exception against it');
  }

  // 🔴 CAMP-286: counted, because "13 cases" was prose. An assertion
  // that stopped being reached printed exactly what a passing one
  // printed, and the sentence below went on claiming thirteen.
  const EXPECTED_CASES = 57;
  if (cases !== EXPECTED_CASES) {
    fails.push(`${cases} assertions ran, expected ${EXPECTED_CASES}`);
  }
  if (fails.length) {
    console.error('SELF-TEST FAILED:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log(`\n✓ check-map-palette self-test: ${cases} cases`);
  console.log(
    // 🔴 The sentence said "13 cases" and 15 assertions ran: four of
    // them live inside a loop and were never in anyone's count. The
    // number now comes from the counter, and the list stays prose.
    `self-test ok: ${cases} cases — a faint fill, four unmeasurable notations, a\n` +
      'lookalike pair, a marker lost over water, an uncased line too close to\n' +
      'the map, a line too close to its own casing, a casing lost on a road, a\n' +
      'line whose opacity was ignored, a colour the component wrote itself,\n' +
      'a drought class lost in the map beneath it, a layer opacity the\n' +
      'measurement ignored, a tint that leaves a campsite marker unreadable,\n' +
      'and (CAMP-315, the picture mirrors the source) a class drawn one step off\n' +
      'the source, at the wrong alpha, missing or unnamed, the named exceptions\n' +
      'held to ΔE and the markers but not to the source, the old opacity that\n' +
      'merges Watch and Warning, markers lost over the Alert red, and a source\n' +
      'record with no URL, no date or an exception with no reason'
  );
}

// 🔴 CAMP-286: the house guard, written out rather than called, because
// check-script-entrypoints.mjs recognises a guard by READING it.
// `realpathSync` on the argv side: Node resolves `import.meta.url`
// through the real path and leaves argv[1] as written.
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'check-map-palette.mjs');
  if (action.has('--self-test')) {
  selfTest();
} else {
  const fills = everyFill();
  const found = problems(fills, MARKER_STROKE);
  for (const [name, hex] of fills) {
    const seen = Math.min(
      ...Object.values(BASEMAP).map((bg) => visibility(hex, MARKER_STROKE, bg))
    );
    console.log(
      `  ${name.padEnd(12)} ${hex}  stroke ${contrast(hex, MARKER_STROKE).toFixed(2)}:1   worst basemap ${seen.toFixed(2)}:1`
    );
  }
  const lines = lineProblems();
  // 🔴 And that the map actually uses them.
  const literals = literalLineColours(
    readFileSync(join(ROOT, 'apps/web/src/components/route-map.tsx'), 'utf8')
  );
  // 🔴 Report what was MEASURED: this printed "worst basemap" for every
  // line, including the cased one, where that number is not the test.
  for (const [name, { colour, casing, opacity }] of Object.entries(LINES)) {
    const said = casing
      ? `${contrast(blend(colour, casing, opacity), casing).toFixed(2)}:1 against its casing ${casing}` +
        ` (casing ${Math.min(...Object.values(BASEMAP).map((bg) => contrast(casing, bg))).toFixed(2)}:1 on the map)`
      : `${Math.min(
          ...Object.values(BASEMAP).map((bg) => contrast(blend(colour, bg, opacity), bg))
        ).toFixed(2)}:1 on the map, uncased`;
    console.log(`  ${name.padEnd(12)} ${colour}  ${said}`);
  }
  // 🔴 CAMP-200 / CAMP-315. The drought picture, every class, as a reader sees
  // it: the colour at its own alpha and then at the layer's raster-opacity,
  // over each basemap colour we serve. All seven are held (see DROUGHT_HELD).
  const droughtFound = droughtProblems();
  const droughtLiterals = rasterOpacityProblems(
    readFileSync(join(ROOT, 'apps/web/src/components/campsite-map.tsx'), 'utf8')
  );
  // Per class: does it equal the source (rule 1), the worst ΔE against the
  // basemap and against another class (rule 2), the worst marker (rule 3).
  const worst = droughtWorst();
  for (const [value, { hex, alpha }] of Object.entries(DROUGHT_COLOURS)) {
    const w = worst[value];
    console.log(
      `  drought ${value}`.padEnd(14) +
        ` ${hex}  ${(effectiveOpacity(alpha) * 100).toFixed(1)}% drawn   ` +
        `EDO ${w.matches === null ? 'named exception' : w.matches ? 'yes' : 'NO'}`.padEnd(24) +
        `ΔE ${w.basemap.deltaE.toFixed(1)} basemap (${w.basemap.where})   ` +
        `ΔE ${w.other.deltaE.toFixed(1)} other (${w.other.where})   ` +
        `markers ${w.markers.seen.toFixed(2)}:1 (${w.markers.where})`
    );
  }
  for (const [v, own] of Object.entries(EDO_SOURCE.own))
    console.log(
      `  named exception, class ${v} (EDO draws ${own.edo}), decided ${own.decided}: held to rules 2 and 3 only. ${own.reason}`
    );
  console.log(
    `  source: ${EDO_SOURCE.indicator}, measured ${EDO_SOURCE.measured}, ${EDO_SOURCE.factsheet}`
  );
  const split = twinsDisagree();
  if (droughtFound.length)
    console.error('\nthe drought picture is not legible:\n  ' + droughtFound.join('\n  '));
  if (droughtLiterals.length)
    console.error('\ncampsite-map.tsx does not use the measured opacity:\n  ' + droughtLiterals.join('\n  '));
  if (lines.length) console.error('\nroute lines are not legible:\n  ' + lines.join('\n  '));
  if (literals.length)
    console.error('\nroute-map.tsx does not use the measured palette:\n  ' + literals.join('\n  '));
  if (found.length || split.length || lines.length || literals.length || droughtFound.length || droughtLiterals.length) {
    if (found.length) console.error('\nmap palette is not legible:\n  ' + found.join('\n  '));
    if (split.length)
      console.error(
        '\nthe cluster expression and dominantType disagree:\n  ' + split.join('\n  ')
      );
    process.exit(1);
  }
  console.log(
    `\n${fills.length} fills, all >= ${MIN_CONTRAST}:1 against stroke ${MARKER_STROKE} and on every basemap colour, all >= ΔE ${MIN_DELTA_E} apart.`
  );
  console.log(
    `the cluster expression agrees with dominantType on all ${4 ** Object.keys(TYPE_COLOUR).length} count vectors`
  );
  console.log(
    `${Object.keys(DROUGHT_COLOURS).length} drought classes at raster-opacity ${DROUGHT_RASTER_OPACITY}: ` +
      `classes ${Object.keys(EDO_SOURCE.colours).join(', ')} equal ${EDO_SOURCE.indicator}'s colours, ` +
      `classes ${Object.keys(EDO_SOURCE.own).join(' and ')} are named exceptions; every class is >= ΔE ${MIN_DELTA_E} ` +
      `from every basemap colour and from every other class, and leaves every marker >= ${MIN_CONTRAST}:1`
  );
}
}
