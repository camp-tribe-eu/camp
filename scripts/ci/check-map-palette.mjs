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

/**
 * The hue of a colour in CIELAB, degrees 0–360 (CAMP-315). Measured: the
 * marker reds `#C83D28` / `#D5412A` are 39°, the brown `#A5541B` 57°, amber
 * 65–80°, pure yellow 102°, class 0's green 136°, a teal 190°, blue 265°.
 * "Warmer" is read as "nearer red", which is a SMALLER angle through this
 * range — the drought series is yellow, then orange, then brown.
 */
export const hue = (hex) => {
  const [, a, b] = lab(hex);
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
};

/**
 * How much colour there is, in CIELAB. 🔴 A hue is only a hue when this is not
 * near zero: a grey has an angle too, and it is noise — `#808080` can come out
 * "cool" or "warm" by a rounding error. The warm and cool checks refuse a
 * colour under `MIN_CHROMA` instead of reading an angle off it.
 */
export const chroma = (hex) => {
  const [, a, b] = lab(hex);
  return Math.hypot(a, b);
};
/** Measured: the shipped drought colours are 35–84; the washed-out `#8FB8CC` that was refused is 17. */
export const MIN_CHROMA = 20;

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
 * 🔴 CAMP-200 / CAMP-315. THE DROUGHT PICTURE, measured as a reader sees it.
 *
 * A class is drawn at its own alpha and then at the layer's
 * `raster-opacity`, so the pixel over a basemap colour is the class colour at
 * `alpha/255 × raster-opacity` — not the hex in the table, and not the alpha
 * in it either. The first version of the table was read by nobody here and
 * drew "no drought" at 22.9%: ΔE 4.0–13.2 over the eleven basemap colours,
 * under the 25 this file holds every "do these read alike" question to, which
 * made the one distinction the card exists for — covered and fine, against
 * not covered — a shade of green on a shade of green.
 *
 * 🔴 CAMP-315: THE SAME DEFECT WAS IN THE OTHER FIVE, and this guard let it
 * through because it held class 0 alone. Measured 14.10.2026 on the table as
 * it stood: class 1 `#F2D98A` was ΔE 6.6 from liberty's trunk roads, class 4–6
 * `#8FB8CC` was ΔE 6.0 from bright's water, class 2 was 22.3 — "less rain than
 * normal" over a motorway and "recovering" over a lake read as a bare map, i.e.
 * as "we do not measure here". All seven classes are held now.
 *
 * THE CLASSES COME AS FIVE COLOURS, NOT SEVEN. 4, 5 and 6 (recovered, soil
 * recovering, vegetation recovering) are one GROUP and are drawn in ONE cool
 * colour on purpose (the legend prints them as one row). The group is held to
 * be one colour — three shades of it is a different legend — and the group is
 * compared with the other four, never with itself: ΔE 0 between two of its own
 * members is the design, not a defect. 🔴 It is a list HERE, not read from the
 * table: a group derived from the colours the table holds would let the table
 * excuse itself, and "class 2 drawn exactly like class 1" would be one group.
 *
 * FOUR THINGS ARE HELD:
 *
 *  1. EVERY CLASS is told from the map beneath it and from every other colour:
 *     its pixel is `MIN_DELTA_E` away from every basemap colour we serve and
 *     from the pixel of every class outside its own group.
 *  2. EVERY CLASS leaves the campsite markers legible (`MIN_CONTRAST`). The
 *     markers are drawn on top of the picture, so their background is the
 *     PIXEL, not the basemap — a thing `problems()` above never measures.
 *  3. THE SCALE IS THE RIGHT WAY ROUND. The `lightest` class (0, "no drought")
 *     is lighter than every other class on every basemap colour. A scale turned
 *     upside down is a defect even when every number above passes: an earlier
 *     version of this check also demanded 3:1 of class 0 against the basemap,
 *     and the only colours that met it were dark enough to make "no drought"
 *     the heaviest thing on the map.
 *  4. THE TWO SCALES ARE TOLD APART, and each is checked by what it is.
 *     - The DROUGHT SERIES 0 → 1 → 2 → 3 is a ladder: every rung darker than the
 *       one above it on every surface, and rungs 1–3 get WARMER (their CIELAB
 *       hue falls) inside a yellow-to-brown band that stops short of red.
 *     - The RECOVERY GROUP is checked on its own and is NOT a rung. It is a COOL
 *       colour (hue in `COOL_HUE`), and its lightness is deliberately left out of
 *       the chain: a cool teal has no place between two ambers, and a rule that
 *       chained it in would force one — measured on the shipped table, over a
 *       flat #E8E8E8 its luminance (0.36) falls between class 2 (0.51) and
 *       class 3 (0.29). "Class 0 is the lightest of all seven" stays true and
 *       still covers it; nothing else orders it.
 *
 * 🔴 WHAT IS DELIBERATELY NOT HELD: A CONTRAST OF A FILL AGAINST THE MAP.
 * `MIN_CONTRAST` answers "can a mark or a word be read on this colour" — it is
 * why the markers are held to it above. Whether a FILL can be told from the
 * absence of one is a question of colour DIFFERENCE, and that is ΔE. Applying
 * the contrast to the fill would also be applying it to a class that cannot
 * meet it: the best of the seven is under 3:1 on every background, so the rule
 * would have been written for a colour it was never true of. Said here, not
 * left out quietly.
 *
 * 🔴 WHY THE BANDS ARE WHERE THEY ARE. `WARM_HUE` starts at 45° because the
 * campsite markers are red (`#C83D28`, `#D5412A`: 39°) and CAMP-162 keeps red
 * for them — a drought class in that hue is a traffic light drawn under a
 * marker of the same colour. It ends at 105° because yellow is 102° and past
 * it the colour is green, the colour of class 0. `COOL_HUE` is the cyan-to-
 * blue half of the wheel; the water the basemaps paint sits in it too, and
 * that is what the ΔE against the basemap is for.
 */
export const DROUGHT_HELD = [0, 1, 2, 3, 4, 5, 6];
/** The class the scale starts from: "no drought", and the lightest. */
export const DROUGHT_LIGHTEST = 0;
/** The drought series, lightest to darkest. Class 0 is its first rung and green, so the warm band skips it. */
export const DROUGHT_LADDER = [0, 1, 2, 3];
/** The recovery group: three classes, one cool colour, not a rung of the ladder. */
export const DROUGHT_RECOVERY = [4, 5, 6];
/** CIELAB hue, degrees. Orange-brown to yellow; not red (39°), not green (136°). */
export const WARM_HUE = [45, 105];
/** CIELAB hue, degrees. Cyan to blue. */
export const COOL_HUE = [170, 290];

/** What one class looks like over one basemap colour, and how well it separates. */
export function droughtPixel(hex, alpha, bg, rasterOpacity) {
  const eff = (alpha / 255) * rasterOpacity;
  const pixel = blend(hex, bg, eff);
  return { eff, pixel, contrast: contrast(pixel, bg), deltaE: deltaE(pixel, bg) };
}

export function droughtProblems(
  colours = DROUGHT_COLOURS,
  rasterOpacity = DROUGHT_RASTER_OPACITY,
  backgrounds = BASEMAP,
  held = DROUGHT_HELD,
  fills = everyFill(),
  stroke = MARKER_STROKE,
  lightest = DROUGHT_LIGHTEST,
  ladder = DROUGHT_LADDER,
  recovery = DROUGHT_RECOVERY,
) {
  const out = [];
  const classes = Object.entries(colours).map(([v, c]) => [Number(v), c]);
  // Two members of the recovery group are one colour BY DESIGN: they are not
  // compared with each other, only with the rest (see the comment above).
  const sameGroup = (a, b) => recovery.includes(a) && recovery.includes(b);

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
        if (w === v || (held.includes(w) && w < v) || sameGroup(v, w)) continue;
        const o = droughtPixel(other.hex, other.alpha, bg, rasterOpacity);
        const d = deltaE(r.pixel, o.pixel);
        if (d < MIN_DELTA_E)
          out.push(
            `drought classes ${v} and ${w} read alike on ${where} ${bg}: ΔE ${d.toFixed(1)}, needs ${MIN_DELTA_E}`
          );
      }
    }
  }

  // The scale, the right way round: the lightest class is lighter than the
  // rest, by the pixel the reader sees, on every surface.
  if (colours[lightest]) {
    for (const [where, bg] of bgs) {
      const mine = droughtPixel(colours[lightest].hex, colours[lightest].alpha, bg, rasterOpacity);
      for (const [w, other] of classes) {
        if (w === lightest) continue;
        const o = droughtPixel(other.hex, other.alpha, bg, rasterOpacity);
        if (luminance(mine.pixel) <= luminance(o.pixel))
          out.push(
            `drought class ${lightest} is not lighter than class ${w} on ${where} ${bg}: ` +
              `luminance ${luminance(mine.pixel).toFixed(3)} against ${luminance(o.pixel).toFixed(3)} — ` +
              'the scale runs the wrong way round'
          );
      }
    }
  }

  // The drought series is a ladder: each rung darker than the one above it, by
  // the pixel the reader sees, on every surface. The first rung is `lightest`,
  // whose comparison with everything is the block above — said once, not twice.
  const rungs = ladder.filter((v) => colours[v]);
  for (let i = 1; i < rungs.length; i++) {
    const [a, b] = [rungs[i - 1], rungs[i]];
    if (a === lightest) continue;
    for (const [where, bg] of bgs) {
      const la = luminance(droughtPixel(colours[a].hex, colours[a].alpha, bg, rasterOpacity).pixel);
      const lb = luminance(droughtPixel(colours[b].hex, colours[b].alpha, bg, rasterOpacity).pixel);
      if (lb >= la)
        out.push(
          `drought class ${b} is not darker than class ${a} on ${where} ${bg}: ` +
            `luminance ${lb.toFixed(3)} against ${la.toFixed(3)} — the drought series runs the wrong way round`
        );
    }
  }

  // Rungs 1–3 are WARM, and get warmer: inside the yellow-to-brown band, hue
  // falling towards red. Class 0 (green) starts the ladder and is not in it.
  const warm = rungs.filter((v) => v !== lightest);
  for (const v of warm) {
    const { hex } = colours[v];
    const [h, c] = [hue(hex), chroma(hex)];
    if (c < MIN_CHROMA)
      out.push(`drought class ${v} ${hex} has chroma ${c.toFixed(0)}, under ${MIN_CHROMA}: too grey to have a hue to read`);
    else if (h < WARM_HUE[0] || h > WARM_HUE[1])
      out.push(
        `drought class ${v} ${hex} has hue ${h.toFixed(0)}°, outside ${WARM_HUE[0]}–${WARM_HUE[1]}°: ` +
          'the drought series is orange-brown to yellow — not red (the campsite markers), not green, not cool'
      );
  }
  for (let i = 1; i < warm.length; i++) {
    const [a, b] = [warm[i - 1], warm[i]];
    const [ha, hb] = [hue(colours[a].hex), hue(colours[b].hex)];
    if (hb >= ha)
      out.push(
        `drought class ${b} ${colours[b].hex} (hue ${hb.toFixed(0)}°) is not warmer than class ${a} ` +
          `${colours[a].hex} (${ha.toFixed(0)}°): the series runs from yellow towards red, so the hue must fall`
      );
  }

  // The recovery group: one colour, and a cool one. Its lightness is NOT part of
  // the ladder — see "THE TWO SCALES ARE TOLD APART" above.
  const rec = recovery.filter((v) => colours[v]);
  for (const v of rec.slice(1)) {
    const [a, b] = [colours[rec[0]], colours[v]];
    if (a.hex.toUpperCase() !== b.hex.toUpperCase() || a.alpha !== b.alpha)
      out.push(
        `recovery classes ${rec[0]} and ${v} are drawn ${a.hex}/${a.alpha} and ${b.hex}/${b.alpha}: ` +
          'they are one group and one colour'
      );
  }
  for (const v of rec) {
    const { hex } = colours[v];
    const [h, c] = [hue(hex), chroma(hex)];
    if (c < MIN_CHROMA)
      out.push(`recovery class ${v} ${hex} has chroma ${c.toFixed(0)}, under ${MIN_CHROMA}: too grey to be called cool`);
    else if (h < COOL_HUE[0] || h > COOL_HUE[1])
      out.push(
        `recovery class ${v} ${hex} has hue ${h.toFixed(0)}°, outside ${COOL_HUE[0]}–${COOL_HUE[1]}°: ` +
          'recovery is drawn in a cool colour, apart from the warm series'
      );
  }

  // The markers, on the pixel. Grouped by class and surface, naming the
  // worst marker: five fills sharing one ring would otherwise print five
  // lines for one fact.
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
 * printed table at the bottom of this file shows, kept as a function so that
 * a number in a report and a number the check compares are one computation.
 * `other` leaves out the class's own recovery group: two of its members are
 * one colour by design.
 */
export function droughtWorst(
  colours = DROUGHT_COLOURS,
  rasterOpacity = DROUGHT_RASTER_OPACITY,
  backgrounds = BASEMAP,
  fills = everyFill(),
  stroke = MARKER_STROKE,
  recovery = DROUGHT_RECOVERY,
) {
  const out = {};
  for (const [v, { hex, alpha }] of Object.entries(colours)) {
    const worst = {
      basemap: { deltaE: Infinity, where: null },
      other: { deltaE: Infinity, where: null },
      markers: { seen: Infinity, where: null },
    };
    for (const [where, bg] of Object.entries(backgrounds)) {
      const r = droughtPixel(hex, alpha, bg, rasterOpacity);
      if (r.deltaE < worst.basemap.deltaE) worst.basemap = { deltaE: r.deltaE, where };
      for (const [u, other] of Object.entries(colours)) {
        if (u === v || (recovery.includes(Number(u)) && recovery.includes(Number(v)))) continue;
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
  // 🔴 CAMP-200. THE DROUGHT PICTURE. Each case is one the real run on the
  // shipped table has to be able to fail — and the shipped table is not used
  // here at all, so the rehearsal does not move when the colours do.
  //
  // The tables are small and hand-made. `oldZero` is the first version of
  // class 0 (measured: ΔE 4.0 over the map). `goodZero` is a light class 0
  // that clears everything. `darkZero` is the colour an earlier version of
  // this check demanded — dark enough for 3:1 against the map — which clears
  // ΔE, costs the markers, and turns the scale upside down. `midZero` keeps
  // the markers and fails ΔE.
  const oldZero = { 0: { hex: '#9CC5A1', alpha: 90 } };
  const goodZero = { 0: { hex: '#9CFE84', alpha: 255 } };
  const darkZero = { 0: { hex: '#1C4418', alpha: 255 } };
  const midZero = { 0: { hex: '#6E7889', alpha: 255 } };
  const paleOne = { hex: '#F2D98A', alpha: 255 };
  const ring = dark; // the marker stroke, declared at the top of this function
  const blackRing = '#000000';
  const has = (list, re) => list.some((l) => re.test(l));
  cases++;
  if (!has(droughtProblems(oldZero, 0.65, BASEMAP, [0]), /class 0 .*at 22\.9%.*ΔE 4\.0/))
    fails.push('the first version of class 0, 22.9% over the map at ΔE 4, was accepted');
  // 🔴 The alpha IN THE TABLE is not what is seen. Same colour, same alpha:
  // at the layer's own opacity it clears; at 0.3 it does not.
  cases++;
  if (droughtProblems(goodZero, 1, BASEMAP, [0], [], ring).length !== 0)
    fails.push('a light class 0 at full strength was refused although it clears ΔE');
  cases++;
  if (!has(droughtProblems(goodZero, 0.3, BASEMAP, [0], [], ring), /class 0 .*ΔE/))
    fails.push('the layer raster-opacity was ignored: a class that fails at 30% was measured as if it were solid');
  // The cost of a dark tint, and the way out of it. One ring, one pixel.
  cases++;
  if (!has(droughtProblems(darkZero, 0.65, BASEMAP, [0], undefined, ring), /markers over drought class 0 /))
    fails.push('a tint that leaves a campsite marker under 3:1 on the pixel was accepted');
  cases++;
  if (droughtProblems(darkZero, 0.65, BASEMAP, [0], undefined, blackRing).length !== 0)
    fails.push('a dark class 0 with a dark enough ring was refused');
  cases++;
  if (!has(droughtProblems(midZero, 0.65, BASEMAP, [0], [], ring), /class 0 .*ΔE/))
    fails.push('a class 0 at ΔE 20 from its map was accepted');
  // 🔴 NOT HELD TO A CONTRAST. The light class 0 is 1.3:1 against some
  // surface and must not be refused for it: whether a fill is told from
  // the map is ΔE's question, and the other six classes are under 3:1 too.
  cases++;
  if (droughtProblems(goodZero, 0.65, BASEMAP, [0], [], ring).length !== 0)
    fails.push('a light class 0 that clears ΔE and the markers was refused for its contrast');
  // Only what is held is held to the bare map; everything is held to the markers.
  cases++;
  if (has(droughtProblems({ ...goodZero, 1: paleOne }, 0.65, BASEMAP, [0], [], ring), /class 1 .*ΔE/))
    fails.push('a class that is not held was reported against the bare map');
  cases++;
  if (!has(droughtProblems({ ...goodZero, 1: { hex: '#9DFE85', alpha: 255 } }, 0.65, BASEMAP, [0], [], ring), /classes 0 and 1 read alike/))
    fails.push('class 0 and a class one shade away were accepted as two things');
  // 🔴 THE SCALE, THE RIGHT WAY ROUND. Every number can pass and the scale
  // still be upside down: that is the defect the contrast rule produced.
  // `[]` and `[]` — nothing held, no markers — so only the ordering can speak.
  cases++;
  if (!has(droughtProblems({ ...darkZero, 1: paleOne }, 0.65, BASEMAP, [], [], ring, 0), /class 0 is not lighter than class 1 /))
    fails.push('"no drought" darker than "less rain than normal" was accepted');
  cases++;
  if (!has(droughtProblems({ 0: paleOne, 1: paleOne }, 0.65, BASEMAP, [], [], ring, 0), /class 0 is not lighter than class 1 /))
    fails.push('"no drought" exactly as light as class 1 was accepted as lighter');
  cases++;
  if (droughtProblems({ ...goodZero, 1: paleOne, 2: { hex: '#D9A441', alpha: 255 }, 3: { hex: '#A5541B', alpha: 255 } }, 0.65, BASEMAP, [], [], ring, 0).length !== 0)
    fails.push('the scale the right way round (0 lightest, then 1, 2, 3 darker) was refused');
  // Against EVERY other class, not the first one.
  cases++;
  if (!has(droughtProblems({ ...goodZero, 1: paleOne, 4: { hex: '#FFFFFF', alpha: 255 } }, 0.65, BASEMAP, [], [], ring, 0), /class 0 is not lighter than class 4 /))
    fails.push('class 0 lighter than class 1 but darker than class 4 was accepted');
  // Values that cannot be measured.
  cases++;
  // 🔴 `[]` held, not the default: with all seven held (CAMP-315) this
  // one-class table is refused for "class 1 has no colour" whatever the
  // notation, and a hex check that had been deleted would still be "caught".
  if (droughtProblems({ 0: { hex: '#FC3', alpha: 255 } }, 0.65, BASEMAP, []).length === 0)
    fails.push('a drought colour in three-digit notation was accepted');
  // 🔴 `[]` for the fills and `[0]` for the held class on the next two, and
  // not the defaults: with the defaults this table is refused for the markers
  // anyway, so a validation that had been deleted would still have been
  // "caught" by something else. Measured by deleting it: both survived.
  cases++;
  if (droughtProblems({ 0: { hex: '#9CFE84', alpha: 300 } }, 0.65, BASEMAP, [0], [], ring).length === 0)
    fails.push('an alpha of 300 was accepted');
  cases++;
  if (droughtProblems(goodZero, 0, BASEMAP, [], [], ring).length === 0)
    fails.push('a raster-opacity of 0 was accepted');
  cases++;
  if (droughtProblems(goodZero, 1.5, BASEMAP, [], [], ring).length === 0)
    fails.push('a raster-opacity above 1 was accepted');
  // A marker is seen by its fill OR by its ring. Over a pixel so dark that the
  // ring is lost (2.7:1), a pale fill still carries it (4+:1) — and a check
  // that looked at the ring alone would refuse a table that is fine.
  cases++;
  if (
    droughtProblems(
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
  // 🔴 CAMP-315. ALL SEVEN HELD. Again hand-made tables that do not move when
  // the shipped colours do. `GOOD` is a right one, in the five-colour shape
  // (4–6 one colour); the others are each ONE thing wrong with it.
  const yellow = { hex: '#F2E02E', alpha: 255 };
  const orange = { hex: '#FF8E00', alpha: 255 };
  const brown = { hex: '#A5541B', alpha: 255 };
  const teal = { hex: '#00938A', alpha: 255 };
  const oldRecovery = { hex: '#8FB8CC', alpha: 255 }; // ΔE 6.0 from bright's water
  const GOOD = { ...goodZero, 1: yellow, 2: orange, 3: brown, 4: teal, 5: teal, 6: teal };
  const ALL = [0, 1, 2, 3, 4, 5, 6];
  // 🔴 THE POSITIVE CONTROL. With all seven held, a check that refused every
  // table would "catch" every case below. This is the one that proves it can
  // say yes — and, because 4, 5 and 6 are the same colour in it, that two
  // members of the recovery group are not compared with each other.
  cases++;
  if (droughtProblems(GOOD, 0.65, BASEMAP, ALL, undefined, ring).length !== 0)
    fails.push('a right seven-class table (0 light green, 1 yellow, 2 orange, 3 brown, 4–6 one teal) was refused');
  // 🔴 WHICH CLASSES EXIST comes from the data file, not from this script: a
  // class EDO adds, or one the held list quietly stopped naming, must be red.
  const FILE_CLASSES = JSON.parse(
    readFileSync(join(ROOT, 'apps/web/src/data/drought.json'), 'utf8')
  ).meta.classes.map((c) => c.value);
  cases++;
  if (FILE_CLASSES.length < 7 || FILE_CLASSES.some((v) => !DROUGHT_HELD.includes(v)))
    fails.push(`a class the data file describes is not held to the thresholds: ${FILE_CLASSES} against ${DROUGHT_HELD}`);
  cases++;
  if (FILE_CLASSES.some((v) => !DROUGHT_LADDER.includes(v) && !DROUGHT_RECOVERY.includes(v)))
    fails.push('a class is in neither the drought series nor the recovery group, so nothing checks where it sits');
  // The two the card names, each by its own measured figure.
  cases++;
  if (!has(droughtProblems({ ...goodZero, 1: paleOne }, 0.65, BASEMAP, [1], [], ring), /class 1 #F2D98A .*reads like liberty\.trunk #FFEEAA: ΔE 6\.6/))
    fails.push('class 1 at #F2D98A, ΔE 6.6 from liberty’s trunk roads, was accepted');
  cases++;
  if (!has(droughtProblems({ ...goodZero, 4: oldRecovery, 5: oldRecovery, 6: oldRecovery }, 0.65, BASEMAP, [4, 5, 6], [], ring), /class 4 #8FB8CC .*reads like bright\.water #AECFE2: ΔE 6\.0/))
    fails.push('the recovery group at #8FB8CC, ΔE 6.0 from bright’s water, was accepted');
  // Two classes drawn as one colour, outside the group that is allowed to.
  cases++;
  if (!has(droughtProblems({ ...GOOD, 2: yellow }, 0.65, BASEMAP, ALL, [], ring), /classes 1 and 2 read alike on .*ΔE 0\.0/))
    fails.push('class 2 drawn exactly like class 1 was accepted');
  // The drought series, the right way round: darker at every rung…
  cases++;
  if (!has(droughtProblems({ ...goodZero, 1: { hex: '#D9A441', alpha: 255 }, 2: paleOne }, 0.65, BASEMAP, [], [], ring), /class 2 is not darker than class 1 /))
    fails.push('the series turned over (class 1 darker than class 2) was accepted');
  // …and warmer. ISOLATED from the luminance rule: class 2 here is darker than
  // class 1, as it should be, and its hue goes the wrong way. Both messages
  // are asked for, because a hue rule that also fired on the luminance would
  // be one rule holding the other up.
  cases++;
  {
    const wrongWarmth = droughtProblems(
      { ...goodZero, 1: { hex: '#F59105', alpha: 255 }, 2: { hex: '#8A7A00', alpha: 255 } },
      0.65, BASEMAP, [], [], ring
    );
    if (!has(wrongWarmth, /class 2 #8A7A00 \(hue 95°\) is not warmer than class 1 /) || has(wrongWarmth, /is not darker than/))
      fails.push('a darker rung that is less warm than the one above it was accepted, or was caught by the wrong rule');
  }
  // The warm band: a red rung (the campsite markers' colour) and a cool one.
  cases++;
  if (!has(droughtProblems({ ...goodZero, 1: yellow, 2: { hex: '#D5412A', alpha: 255 } }, 0.65, BASEMAP, [], [], ring), /class 2 #D5412A has hue 39°, outside \d+–\d+°/))
    fails.push('a red drought class (hue 39°, the markers’ colour) was accepted');
  cases++;
  if (!has(droughtProblems({ ...goodZero, 1: teal }, 0.65, BASEMAP, [], [], ring), /class 1 #00938A has hue 188°, outside \d+–\d+°/))
    fails.push('a cool colour in the drought series was accepted');
  cases++;
  if (!has(droughtProblems({ ...goodZero, 1: { hex: '#7FC83C', alpha: 255 } }, 0.65, BASEMAP, [], [], ring), /class 1 #7FC83C has hue 127°, outside \d+–\d+°/))
    fails.push('a green drought class (hue 127°, the colour of "no drought") was accepted');
  // Recovery is cool, and one colour.
  cases++;
  if (!has(droughtProblems({ ...goodZero, 4: orange }, 0.65, BASEMAP, [], [], ring), /recovery class 4 #FF8E00 has hue 65°, outside \d+–\d+°/))
    fails.push('a warm recovery colour was accepted');
  // …and cool means cyan to blue: not the green beside it (164°), not magenta (336°).
  cases++;
  if (!has(droughtProblems({ ...goodZero, 4: { hex: '#3A8266', alpha: 255 } }, 0.65, BASEMAP, [], [], ring), /recovery class 4 #3A8266 has hue 164°, outside \d+–\d+°/))
    fails.push('a green recovery colour (hue 164°) was accepted as cool');
  cases++;
  if (!has(droughtProblems({ ...goodZero, 4: { hex: '#C32BA6', alpha: 255 } }, 0.65, BASEMAP, [], [], ring), /recovery class 4 #C32BA6 has hue 336°, outside \d+–\d+°/))
    fails.push('a magenta recovery colour (hue 336°) was accepted as cool');
  cases++;
  if (!has(droughtProblems({ ...goodZero, 4: teal, 5: { hex: '#0A9388', alpha: 255 } }, 0.65, BASEMAP, [], [], ring), /recovery classes 4 and 5 are drawn #00938A\/255 and #0A9388\/255/))
    fails.push('recovery classes drawn in two shades were accepted as one group');
  // A grey has an angle too, and it is noise: refused, not read.
  cases++;
  if (!has(droughtProblems({ ...goodZero, 1: { hex: '#808080', alpha: 255 } }, 0.65, BASEMAP, [], [], ring), /class 1 #808080 has chroma 0, under 20: too grey/))
    fails.push('a grey drought class was given a hue and accepted');
  cases++;
  if (!has(droughtProblems({ ...goodZero, 4: { hex: '#808080', alpha: 255 } }, 0.65, BASEMAP, [], [], ring), /recovery class 4 #808080 has chroma 0, under 20: too grey/))
    fails.push('a grey recovery colour was given a hue and accepted');
  // The printed table is the check's own figure, not a second computation.
  cases++;
  {
    const w = droughtWorst({ ...goodZero, 1: paleOne }, 0.65, BASEMAP, [], ring);
    if (w[1].basemap.where !== 'liberty.trunk' || Math.abs(w[1].basemap.deltaE - 6.6) > 0.05)
      fails.push(`the printed worst basemap ΔE for #F2D98A is ${w[1].basemap.deltaE.toFixed(2)} on ${w[1].basemap.where}, not 6.6 on liberty.trunk`);
  }
  cases++;
  {
    const w = droughtWorst({ 4: teal, 5: teal }, 0.65, BASEMAP, [], ring);
    const w0 = droughtWorst({ ...goodZero, 4: teal, 5: teal }, 0.65, BASEMAP, [], ring);
    if (w[4].other.deltaE !== Infinity || !(w0[4].other.deltaE > 25 && w0[4].other.deltaE < 100))
      fails.push('the printed "against another colour" figure counted a class’s own recovery group, or lost the others');
  }

  // 🔴 CAMP-286: counted, because "13 cases" was prose. An assertion
  // that stopped being reached printed exactly what a passing one
  // printed, and the sentence below went on claiming thirteen.
  const EXPECTED_CASES = 55;
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
      'a scale with "no drought" darker than a drought class, and (CAMP-315)\n' +
      'a drought colour lost in the basemap that is not class 0, two classes\n' +
      'drawn alike, a series turned over or cooling, a red or grey class, and a\n' +
      'recovery group that is warm or in two shades'
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
  // Per class: the worst ΔE against the basemap, the worst ΔE against another
  // colour (the class's own recovery group left out), the worst marker.
  const worst = droughtWorst();
  for (const [value, { hex, alpha }] of Object.entries(DROUGHT_COLOURS)) {
    const w = worst[value];
    console.log(
      `  drought ${value}`.padEnd(14) +
        ` ${hex}  ${(effectiveOpacity(alpha) * 100).toFixed(1)}% drawn   ` +
        `ΔE ${w.basemap.deltaE.toFixed(1)} basemap (${w.basemap.where})   ` +
        `ΔE ${w.other.deltaE.toFixed(1)} other (${w.other.where})   ` +
        `markers ${w.markers.seen.toFixed(2)}:1 (${w.markers.where})`
    );
  }
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
      `classes ${DROUGHT_HELD.join(', ')} are each >= ΔE ${MIN_DELTA_E} from every basemap colour and from every ` +
      `colour outside their group; class ${DROUGHT_LIGHTEST} is the lightest, ${DROUGHT_LADDER.join(' → ')} ` +
      `runs light to dark and ${DROUGHT_LADDER.slice(1).join(' → ')} yellow to brown, ${DROUGHT_RECOVERY.join(', ')} ` +
      `is one cool colour, and every class leaves every marker >= ${MIN_CONTRAST}:1`
  );
}
}
