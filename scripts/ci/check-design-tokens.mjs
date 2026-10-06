#!/usr/bin/env node
/**
 * Every token the design system defines must exist in globals.css, with
 * the same value.
 *
 * 🔴 CAMP-217: TWELVE of them had quietly failed to arrive, and nothing
 * noticed for months because nothing compared. The site therefore had one
 * transition speed where the design has four, no secondary button at all,
 * and no state-label colours — each of which looks like a styling choice
 * rather than a missing line.
 *
 * 🔴 It compares against a SNAPSHOT in the repo, not against the mockups.
 * The mockups live in the owner's brain folder, which CI cannot read, and
 * a check that only runs on one laptop is a check that stops running. The
 * snapshot's provenance and date are inside the file.
 *
 * 🔴 LIGHT THEME ONLY, and that is a decision rather than an oversight.
 * Our dark values are tuned per token and deliberately differ from the
 * mockups'; snapshotting them would turn a decision into a failure every
 * time CI runs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

/**
 * Tokens the design defines that this site deliberately does not carry.
 * Each one needs a reason, because "we decided not to" and "we forgot"
 * look identical in a diff.
 */
export const NOT_OURS = {
  '--map-land': 'basemap theming: we serve hosted styles and do not recolour them (CAMP-236)',
  '--map-green': 'basemap theming — see --map-land',
  '--map-water': 'basemap theming — see --map-land',
  '--map-road': 'basemap theming — see --map-land',
  '--map-road-2': 'basemap theming — see --map-land',
};

/** The `:root` block, with comments removed and braces counted rather than guessed. */
export function rootBlock(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = clean.indexOf(':root');
  if (at < 0) throw new Error('no :root block — the check read nothing');
  const open = clean.indexOf('{', at);
  let depth = 0;
  let end = -1;
  for (let i = open; i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    else if (clean[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  // 🔴 Counted, not `indexOf('}')`. The first version of this comparison
  // stopped at the first closing brace and found TWO tokens in a file
  // holding thirty-five — then reported every remaining one as missing.
  if (end < 0) throw new Error(':root is never closed — the check read nothing');
  const out = {};
  for (const [, name, value] of clean
    .slice(open, end)
    .matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g))
    out[name] = value.replace(/\s+/g, ' ').trim();
  if (Object.keys(out).length === 0)
    throw new Error(':root is empty — the check read nothing');
  return out;
}

/** Same value, ignoring the spacing and leading zeros prettier adds. */
export const same = (a, b) =>
  a.replace(/\s+/g, '').replace(/\b0\./g, '.').toLowerCase() ===
  b.replace(/\s+/g, '').replace(/\b0\./g, '.').toLowerCase();

/** Our names for the design's names. */
const RENAMED = {
  '--radius-card': '--r-lg',
  '--shadow-card': '--shadow',
  '--radius': '--r',
  '--radius-sm': '--r-sm',
  '--radius-xs': '--r-xs',
};
const ours = (name) => RENAMED[name] ?? name.replace(/^--color-/, '--');

export function problems(design, live, skip = NOT_OURS) {
  const have = Object.fromEntries(
    Object.entries(live).map(([k, v]) => [ours(k), v])
  );
  const out = [];
  for (const [name, value] of Object.entries(design)) {
    if (name in skip) continue;
    const mine = have[ours(name)];
    if (mine === undefined) out.push(`${name} is missing (design has ${value})`);
    else if (!same(value, mine))
      out.push(`${name}: design ${value}, ours ${mine}`);
  }
  return out;
}

function selfTest() {
  const fails = [];
  if (problems({ '--x': '#fff' }, {}).length === 0)
    fails.push('a missing token was accepted');
  if (problems({ '--x': '#fff' }, { '--x': '#000' }).length === 0)
    fails.push('a changed value was accepted');
  if (problems({ '--x': '#fff' }, { '--x': '#FFF' }).length !== 0)
    fails.push('case alone was reported as a difference');
  if (problems({ '--t': '.2s' }, { '--t': '0.2s' }).length !== 0)
    fails.push('a prettier-normalised number was reported as a difference');
  if (problems({ '--map-land': '#eee' }, {}).length !== 0)
    fails.push('a deliberately-skipped token was reported as missing');
  for (const broken of ['', 'body { color: red }', ':root { }'])
    try {
      rootBlock(broken);
      fails.push(`an unreadable stylesheet was accepted: ${JSON.stringify(broken)}`);
    } catch {
      /* expected */
    }
  if (fails.length) {
    console.error('SELF-TEST FAILED:\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log(
    'self-test ok: still catches a missing token, a changed value, and an unreadable stylesheet; still ignores case, zero-padding and the documented skips'
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const snap = JSON.parse(
    readFileSync(join(ROOT, 'apps/web/src/data/design/tokens.json'), 'utf8')
  );
  const live = rootBlock(
    readFileSync(join(ROOT, 'apps/web/src/app/globals.css'), 'utf8')
  );
  const found = problems(snap.tokens, live);
  const checked = Object.keys(snap.tokens).length - Object.keys(NOT_OURS).length;
  if (found.length) {
    console.error(
      `design tokens have drifted from ${snap.source} (snapshot ${snap.takenOn}):\n  ` +
        found.join('\n  ')
    );
    process.exit(1);
  }
  console.log(
    `${checked} design tokens present and equal; ${Object.keys(NOT_OURS).length} deliberately not carried, each with a reason.`
  );
}
