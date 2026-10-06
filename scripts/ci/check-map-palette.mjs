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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expression } from '@maplibre/maplibre-gl-style-spec';
import SERVED from '../../apps/web/src/data/basemap-colours.json' with { type: 'json' };
import {
  LINE_GUESS,
  MARKER_STROKE,
  ROUTE_LINE,
  TYPE_COLOUR,
  UNKNOWN_COLOUR,
  dominantColourExpression,
  dominantType,
} from '../../apps/web/src/lib/map-palette.ts';

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
export const everyFill = (types = TYPE_COLOUR, unknown = UNKNOWN_COLOUR) => [
  ...Object.entries(types),
  ['«unknown»', unknown],
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

/** 🔴 Rehearsed, not trusted. Each case is one the real check must still refuse. */
function selfTest() {
  const fails = [];
  const dark = '#181D26';
  if (problems([['x', '#FFC83C']], '#FFFFFF').length === 0)
    fails.push('a 1.55:1 fill against a white stroke was accepted');
  // The notations that walked past the old regex.
  for (const bad of ['#FC3', 'rgb(255, 200, 60)', '#FFC83CFF', 'gold'])
    if (problems([['x', bad]], dark).length === 0)
      fails.push(`the unmeasurable value ${bad} was accepted`);
  if (problems([['a', '#D5412A'], ['b', '#C83D28']], dark).length === 0)
    fails.push('two colours at ΔE 4.8 were accepted');
  // A fill that passes against its stroke but vanishes on water.
  // 🔴 THESE THREE CALLED `fail()`, WHICH DOES NOT EXIST IN THIS FILE.
  // The self-test did exit non-zero, so it was not blind — but it exited
  // on a ReferenceError, so it named the wrong thing, and a guard that
  // reports the wrong thing is read wrong. Review found it.
  const bare = (hex) => ({ L: { colour: hex, casing: null, opacity: 1 } });
  if (lineProblems(bare('#8A93A6')).length === 0)
    fails.push('an uncased line at 1.56:1 over liberty water was accepted');
  if (lineProblems(bare('#343D50')).length !== 0)
    fails.push('an uncased line at 5.79:1 over its worst surface was refused');
  // 🔴 ΔE 4.8, not 8 — the old text said 8 and the pair is 4.8.
  if (
    lineProblems({
      A: { colour: '#C83D28', casing: null, opacity: 1 },
      B: { colour: '#D5412A', casing: null, opacity: 1 },
    }).length === 0
  )
    fails.push('two lines ΔE 4.8 apart were accepted as distinguishable');
  if (lineProblems({ L: { colour: '#C83D28', casing: '#D5412A', opacity: 1 } }).length === 0)
    fails.push('a line ΔE 4.8 from its own casing was accepted');
  if (lineProblems({ L: { colour: '#C83D28', casing: '#FFFFFF', opacity: 1 } }).length === 0)
    fails.push('a casing invisible on a white road was accepted');
  if (lineProblems({ L: { colour: '#343D50', casing: null, opacity: 0.15 } }).length === 0)
    fails.push('a line at opacity 0.15 was measured as if it were solid');
  // 🔴 The mutation review used. Without this the palette can be perfect
  // and the map can ignore it.
  if (literalLineColours(`'line-color': '#8A93A6',`).length === 0)
    fails.push('a hex line colour written into the component was accepted');
  if (literalLineColours(`'line-color': ROUTE_LINE,`).length !== 0)
    fails.push('an imported line colour was reported as a literal');
  if (problems([['x', '#7C92B7']], '#FFFFFF', { water: '#A0C8F0' }).length === 0)
    fails.push('a fill invisible over water was accepted');
  if (fails.length) {
    console.error('SELF-TEST FAILED:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log(
    'self-test ok: 13 cases — a faint fill, four unmeasurable notations, a\n' +
      'lookalike pair, a marker lost over water, an uncased line too close to\n' +
      'the map, a line too close to its own casing, a casing lost on a road, a\n' +
      'line whose opacity was ignored, and a colour the component wrote itself'
  );
}

if (process.argv.includes('--self-test')) {
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
  const split = twinsDisagree();
  if (lines.length) console.error('\nroute lines are not legible:\n  ' + lines.join('\n  '));
  if (literals.length)
    console.error('\nroute-map.tsx does not use the measured palette:\n  ' + literals.join('\n  '));
  if (found.length || split.length || lines.length || literals.length) {
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
}
