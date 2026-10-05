#!/usr/bin/env node
/**
 * The map's type colours must stay legible, and that is measured here.
 *
 * 🔴 WHY THIS IS A CI CHECK AND NOT A COMMENT. The palette was chosen by
 * measurement — the headline theme colours were rejected because Success
 * reaches 2.91 and Brand 1.55 against the marker's white stroke, under
 * the 3.0 WCAG 1.4.11 asks of a non-text graphic. A number that decided
 * something and is then never checked again is a number that drifts: the
 * next person picks a nicer green, nothing fails, and the map quietly
 * stops being readable for the people who needed the contrast.
 *
 * 🔴 It reads the SOURCE FILE rather than importing it. The palette lives
 * in TypeScript and this is a plain script, but that is not the reason —
 * reading the text means a colour written anywhere in that object is
 * caught, including one added without touching this file.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, '..', '..', 'apps/web/src/lib/map-palette.ts');

/** WCAG 1.4.11: a non-text graphic needs 3:1 against the colour beside it. */
export const MIN_CONTRAST = 3;
/** Below this two fills read as the same colour on a 7px dot. */
export const MIN_DELTA_E = 25;

const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function luminance(hex) {
  const [r, g, b] = [0, 1, 2].map((i) => linear(channel(hex, i)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function lab(hex) {
  const [r, g, b] = [0, 1, 2].map((i) => linear(channel(hex, i)));
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE(a, b) {
  const [la, lb] = [lab(a), lab(b)];
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/**
 * The colours the source file actually declares.
 *
 * 🔴 Throws when it finds nothing. A parser that silently returns an
 * empty set turns this whole check into a green light — the exact shape
 * of failure the project has been bitten by before.
 */
export function paletteFrom(source) {
  const block = source.match(
    /export const TYPE_COLOUR[^=]*=\s*\{([\s\S]*?)\n\};/
  );
  if (!block) throw new Error('TYPE_COLOUR not found — the check read nothing');
  const entries = [...block[1].matchAll(/(\w+):\s*['"](#[0-9A-Fa-f]{6})['"]/g)].map(
    (m) => [m[1], m[2]]
  );
  if (entries.length === 0)
    throw new Error('TYPE_COLOUR is empty — the check read nothing');
  const stroke = source.match(/MARKER_STROKE\s*=\s*['"](#[0-9A-Fa-f]{6})['"]/);
  if (!stroke) throw new Error('MARKER_STROKE not found');
  return { entries, stroke: stroke[1] };
}

export function problems({ entries, stroke }) {
  const out = [];
  for (const [name, hex] of entries) {
    const c = contrast(hex, stroke);
    if (c < MIN_CONTRAST)
      out.push(`${name} ${hex}: ${c.toFixed(2)} against ${stroke}, needs ${MIN_CONTRAST}`);
  }
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      const d = deltaE(entries[i][1], entries[j][1]);
      if (d < MIN_DELTA_E)
        out.push(
          `${entries[i][0]} and ${entries[j][0]} read alike: ΔE ${d.toFixed(1)}, needs ${MIN_DELTA_E}`
        );
    }
  return out;
}

/** 🔴 Rehearsed, not trusted: prove the check still fails on a bad palette. */
function selfTest() {
  const faint = { entries: [['x', '#FFE81B']], stroke: '#FFFFFF' };
  const alike = {
    entries: [['a', '#D5412A'], ['b', '#C83D28']],
    stroke: '#FFFFFF',
  };
  const fails = [];
  if (problems(faint).length === 0) fails.push('a 1.25:1 fill was accepted');
  if (problems(alike).length === 0) fails.push('two colours at ΔE 4.8 were accepted');
  try {
    paletteFrom('nothing here');
    fails.push('an unreadable source was accepted');
  } catch {
    /* expected */
  }
  if (fails.length) {
    console.error('SELF-TEST FAILED:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log('self-test ok: the check still rejects a faint fill, a lookalike pair and an unreadable source');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const palette = paletteFrom(readFileSync(SOURCE, 'utf8'));
  const found = problems(palette);
  for (const [name, hex] of palette.entries)
    console.log(`  ${name.padEnd(12)} ${hex}  ${contrast(hex, palette.stroke).toFixed(2)}:1`);
  if (found.length) {
    console.error('\nmap palette is not legible:\n  ' + found.join('\n  '));
    process.exit(1);
  }
  console.log(`\n${palette.entries.length} colours, all >= ${MIN_CONTRAST}:1 against ${palette.stroke} and >= ΔE ${MIN_DELTA_E} apart`);
}
