#!/usr/bin/env node
// A tile we are not licensed to serve is a tile we must not serve.
//
//   node scripts/ci/check-satellite-licences.mjs
//   node scripts/ci/check-satellite-licences.mjs --self-test
//
// 🔴 WHY THIS EXISTS (CAMP-221). The mockup settled the policy — "Esri,
// Bing and Google are closed to us by licence, orthophotos come from
// national open sources" — and a policy is not a licence. "Open" is a
// word somebody used; "CC BY 4.0 scne.es" is a term a lawyer can check.
//
// Every source in `satellite-sources.json` therefore carries four things
// that have to travel together, and this refuses the set when one is
// missing:
//
//   licenceVerbatim  what the service itself says, word for word
//   attribution      the credit the reader is shown
//   readFrom         the URL it was read from
//   readField        which field of that document said it
//
// The last two are the ones that rot quietly. A licence nobody can
// reproduce from a link is a licence we are quoting from memory, and the
// difference only shows up in a letter.
//
// 🔴 AND THE ATTRIBUTION HAS TO REACH THE MAP. The strings being correct
// in a JSON file proves nothing about what a reader sees, so this also
// reads `campsite-map.tsx` and requires the raster source to be built
// with the source's own `attribution` field rather than a literal. That
// is the same lesson as CAMP-237, where the palette was measured and the
// component ignored it.

import { readFileSync, realpathSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = join(ROOT, 'apps/web/src/data/satellite-sources.json');
const MAP = join(ROOT, 'apps/web/src/components/campsite-map.tsx');

// 🔴 THESE THREE LISTS LIVE HERE, NOT IN THE DATA FILE, and that is the
// whole point of the rewrite on 11.10.2026. Before it, every half of
// every proof was free text in `satellite-sources.json`: the guard asked
// "is the licence field non-empty?" and "does `attribution` contain
// `providerShort`?" — both written by the same hand in the same file.
//
// Measured: setting licence and licenceVerbatim to "All rights reserved.
// © Airbus DS. No reuse permitted." and the tiles to mt1.google.com gave
// exit 0 and printed "✓ 2 satellite source(s), each naming a licence".
// The guard printed a forbidden licence and congratulated itself. Google
// is the provider the card names as closed to us.
//
// A rule that travels with the thing it judges is satisfied by one edit.
// Adding a source now takes two: the data, and this file.

/** Hosts we have read a licence from and may serve tiles from. */
const ALLOWED_TILE_HOSTS = new Set(['www.ign.es', 'data.geopf.fr']);

/** Licences that permit what we do. Exact, not "contains". */
const ALLOWED_LICENCES = [
  'CC BY 4.0',
  'CC BY 2.0',
  'Licence Ouverte / Open License',
  'ODbL 1.0',
];

/**
 * Words that must never appear in a licence, a credit, a provider or a
 * tile URL. `caveat` and `readField` are deliberately NOT scanned: the
 * Spanish entry's caveat correctly records that Melilla's imagery is
 * Airbus's, and a guard that punished a source for documenting its own
 * exception would teach us to stop documenting them.
 */
const CLOSED = [
  /google/i, /gstatic/i, /esri\b/i, /arcgisonline/i, /bing/i,
  /virtualearth/i, /maxar/i, /airbus/i, /mapbox/i,
  /all rights reserved/i, /no reuse/i, /tous droits r/i,
];

const SCANNED_FOR_CLOSED = ['licence', 'licenceVerbatim', 'attribution', 'provider', 'providerShort', 'tiles'];

function hostOf(url) {
  try { return new URL(url).host; } catch { return null; }
}

/** Fields that must travel together, with why each one is not optional. */
const REQUIRED = {
  country: 'which country this covers — coverage is national, not global',
  provider: 'who serves it, so a reader knows whose photograph this is',
  licence: 'the licence in short form',
  licenceVerbatim: 'what the service says, word for word, not paraphrased',
  attribution: 'the credit shown to the reader',
  readFrom: 'the URL this was read from, so the next person can check',
  readField: 'which field of that document said it',
  tiles: 'the tile template',
};

/**
 * Line and block comments out, string literals kept.
 *
 * Deliberately simple: it only has to stop a commented-out line from
 * reading as live code. It is rehearsed in the self-test rather than
 * trusted, because a stripper that quietly removes nothing would make
 * every check below pass for the wrong reason.
 */
export function stripComments(src) {
  // 🔴 A regex cannot do this, and my first attempt proved it: the
  // pattern `[^:'"\`]//...` ate the `//` inside `"https://a//b"` because
  // the character before it was `a`. The self-test below catches exactly
  // that, which is why it is there.
  let out = '';
  let i = 0;
  let quote = null; // ', " or `
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      if (c === '\\') { out += c + (next ?? ''); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; out += ' '; continue;
    }
    out += c; i++;
  }
  return out;
}

export function problems(data, mapSource) {
  const out = [];
  const sources = data.sources ?? [];

  if (sources.length === 0) out.push('no satellite sources at all');

  for (const s of sources) {
    const name = s.id ?? '(unnamed)';
    for (const [field, why] of Object.entries(REQUIRED)) {
      if (!s[field] || String(s[field]).trim() === '') {
        out.push(`${name}: ${field} is missing — ${why}`);
      }
    }
    if (s.country && !/^[a-z]{2}$/.test(s.country)) {
      out.push(`${name}: country "${s.country}" is not a lower-case alpha-2 code`);
    }
    if (s.readFrom && !/^https?:\/\//.test(s.readFrom)) {
      out.push(`${name}: readFrom "${s.readFrom}" is not a URL anyone can open`);
    }
    // 🔴 The credit has to name somebody. "Satellite imagery" credits
    // nobody and satisfies no licence.
    //
    // Checked against `providerShort`, not against the legal name, and
    // the first version of this got it wrong: it took the first word of
    // `provider` and so refused the French entry, whose credit is "IGN"
    // while its legal name begins "Institut national de l'information
    // géographique et forestière". The provider decides how it is
    // credited, so that string is data rather than a rule here.
    if (!s.providerShort || String(s.providerShort).trim() === '') {
      out.push(`${name}: providerShort is missing — the name this provider credits itself by`);
    } else if (s.attribution && !s.attribution.includes(s.providerShort)) {
      out.push(
        `${name}: attribution "${s.attribution}" does not contain "${s.providerShort}"`,
      );
    }
    if (s.tiles && !/\{z\}/.test(s.tiles)) {
      out.push(`${name}: the tile template has no {z} — it is not a tile template`);
    }

    // 🔴 The licence must be one we have actually cleared, by name.
    if (s.licence && !ALLOWED_LICENCES.includes(String(s.licence).trim())) {
      out.push(
        `${name}: licence "${s.licence}" is not one this guard has cleared ` +
          `(${ALLOWED_LICENCES.join(', ')}) — clear it here first, in writing`,
      );
    }

    // 🔴 And the tiles must come from a host we read that licence from.
    if (s.tiles) {
      const host = hostOf(s.tiles);
      if (!host) {
        out.push(`${name}: tiles "${String(s.tiles).slice(0, 40)}…" is not a URL`);
      } else if (!ALLOWED_TILE_HOSTS.has(host)) {
        out.push(
          `${name}: tiles are served from "${host}", which is not in this ` +
            "guard's allowlist — a source nobody cleared is a source we are " +
            'not licensed for',
        );
      }
    }

    // 🔴 No closed provider anywhere in the fields that make the claim.
    //
    // `tiles` is scanned by HOST, not as a whole URL, and the first run
    // of this rule showed why: the Spanish template carries
    // `tilematrixset=GoogleMapsCompatible`, which is the OGC name of a
    // tile grid and has nothing to do with Google serving anything. A
    // guard that refuses a correct record teaches people to switch it
    // off, so it is the host that decides who serves the bytes.
    for (const field of SCANNED_FOR_CLOSED) {
      const raw = String(s[field] ?? '');
      const value = field === 'tiles' ? (hostOf(raw) ?? raw) : raw;
      for (const banned of CLOSED) {
        if (banned.test(value)) {
          out.push(`${name}: ${field} matches ${banned} — that provider is closed to us`);
        }
      }
    }

    // 🔴 `providerShort` is the credit, so it must be a real name and it
    // must be the provider's own. Checking it only against `attribution`
    // let `providerShort: "a"` + `attribution: "Satellite imagery"` pass:
    // one hand, one file, both sides of the proof.
    if (s.providerShort && String(s.providerShort).trim().length < 3) {
      out.push(`${name}: providerShort "${s.providerShort}" is too short to credit anyone`);
    }
    if (s.providerShort && s.provider && !String(s.provider).includes(String(s.providerShort))) {
      out.push(
        `${name}: providerShort "${s.providerShort}" does not appear in ` +
          `provider "${s.provider}" — the credit must be the provider's own name`,
      );
    }
  }

  // Every country appears once: two sources for one country is an
  // unanswered question about which one we are allowed to use.
  const byCountry = new Map();
  for (const s of sources) byCountry.set(s.country, (byCountry.get(s.country) ?? 0) + 1);
  for (const [country, n] of byCountry) {
    if (n > 1) out.push(`${country}: ${n} sources — which one are we licensed for?`);
  }

  // 🔴 A country that is NOT enabled must say what is missing, or the
  // next person re-does the research to find out it was already done.
  for (const n of data.notYet ?? []) {
    for (const field of ['country', 'whyNotEnabled', 'howToClose']) {
      if (!n[field]) out.push(`notYet ${n.country ?? '?'}: ${field} is missing`);
    }
  }

  // 🔴 A country cannot be both enabled and not enabled, and nothing used
  // to say so. Adding `sat-nl` to `sources` while leaving nl in `notYet`
  // passed green, and the run printed "NL …" and "NL not enabled" in the
  // same breath. Each list was checked on its own; the contradiction
  // between them lived in the gap.
  const enabled = new Set((sources).map((s) => s.country));
  for (const n of data.notYet ?? []) {
    if (n.country && enabled.has(n.country)) {
      out.push(
        `${n.country}: listed in sources AND in notYet — it is either ` +
          'enabled or it is not, and the page reads both',
      );
    }
  }

  // And the component must use the field, not a string of its own.
  //
  // 🔴 COMMENTS ARE STRIPPED FIRST, and the version before 11.10.2026 did
  // not strip them. It tested the raw file text for
  // `attribution: source.attribution`, so commenting that very line out —
  // `// attribution: source.attribution,` — still matched, and the run
  // went green with no credit on the map at all. A grep cannot tell live
  // code from a note about live code.
  //
  // Stripping is not a proof either, so the shape of the check changed
  // too: the spec is now built by `rasterSourceSpec()` in
  // `satellite-sources.ts`, which has its own unit test, and the
  // component has to call it. There is nowhere left to hand-write a
  // credit, and deleting the call is visible here.
  if (mapSource !== null) {
    const live = stripComments(mapSource);
    if (!/rasterSourceSpec\s*\(\s*source\s*\)/.test(live)) {
      out.push(
        'campsite-map.tsx does not build the raster source with ' +
          '`rasterSourceSpec(source)` — a credit the component writes ' +
          'itself is a credit nothing here can check',
      );
    }
    // 🔴 Anchored on an object KEY, not on the word. The loose version
    // of this matched `feed.meta.attribution : ''` — a ternary colon in
    // the wildfire feed, nowhere near a credit — and refused a file that
    // was correct. A key is preceded by `{` or `,`, never by `.`.
    if (/[{,]\s*attribution\s*:\s*['"`]/.test(live)) {
      out.push(
        'campsite-map.tsx writes an attribution string of its own — the ' +
          'credit belongs to the source record, not to the component',
      );
    }
    // 🔴 A source nobody draws is a credit nobody sees. Deleting the
    // addLayer call left the source in place and this guard happy.
    if (!/addLayer\s*\(\s*\{\s*id:\s*SATELLITE_LAYER/.test(live)) {
      out.push(
        'campsite-map.tsx adds the satellite source but never adds the ' +
          'layer that draws it — MapLibre credits only layers it renders',
      );
    }
    for (const s of sources) {
      if (s.tiles && live.includes(s.tiles)) {
        out.push(`${s.id}: its tile URL is written into the component as a literal`);
      }
    }
  }
  return out;
}

// 🔴 ONE FIELD AT A TIME, FROM ONE WORKING RECORD. The fixtures before
// 11.10.2026 were hand-written per case with values like `licence: 'L'`
// and `tiles: '{z}'`, so each case differed from a passing source in
// several ways at once and a case could go green for a reason other than
// the one in its name. `base()` is a record that passes; every case
// below changes exactly one thing and says what it expects.
const base = () => ({
  id: 'x',
  country: 'es',
  provider: 'Instituto Geográfico Nacional / IDEE',
  providerShort: 'Instituto Geográfico Nacional',
  licence: 'CC BY 4.0',
  licenceVerbatim: 'CC BY 4.0 scne.es',
  attribution: 'Orthophoto © Instituto Geográfico Nacional de España (PNOA), CC BY 4.0 scne.es',
  readFrom: 'https://www.ign.es/wmts/pnoa-ma?request=GetCapabilities&service=WMTS',
  readField: 'ows:AccessConstraints',
  tiles: 'https://www.ign.es/wmts/pnoa-ma?service=WMTS&TileMatrix={z}&TileCol={x}&TileRow={y}',
  maxzoom: 19,
});
const one = (patch) => ({ sources: [{ ...base(), ...patch }], notYet: [] });

const SELF_TEST = [
  ['the base record passes', { sources: [base()], notYet: [] }, 0],

  // --- the three mutations that went green before this rewrite ---
  [
    '🔴 MUTATION 1: "All rights reserved" is not a licence we cleared',
    one({ licence: 'All rights reserved', licenceVerbatim: 'All rights reserved. © Airbus DS. No reuse permitted.' }),
    // not in the allowlist · CLOSED matches licence, licenceVerbatim twice (airbus, all rights reserved, no reuse)
    5,
  ],
  [
    '🔴 MUTATION 1b: tiles moved to Google are refused by host AND by name',
    one({ tiles: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}' }),
    2,
  ],
  [
    '🔴 MUTATION 2: providerShort "a" is too short to credit anyone',
    // 🔴 Counted wrong at first and the self-test said so. With
    // `providerShort: "a"` the OLD pair of checks still passes: "a" is
    // inside "Instituto Geográfico Nacional" and inside almost any
    // credit, so `attribution.includes(providerShort)` is satisfied by
    // nothing. The minimum length is what refuses this, and that is the
    // check worth having — the containment pair never could.
    one({ providerShort: 'a', attribution: 'Satellite imagery' }),
    1,
  ],

  // --- one field at a time ---
  ['a missing licence is refused', one({ licence: '' }), 1],
  ['a missing licenceVerbatim is refused', one({ licenceVerbatim: '' }), 1],
  ['a missing readFrom is refused', one({ readFrom: '' }), 1],
  ['a readFrom that is not a URL is refused', one({ readFrom: 'see the website' }), 1],
  ['a credit that names nobody is refused', one({ attribution: 'Satellite imagery' }), 1],
  ['a tile template with no {z} is not a template', one({ tiles: 'https://www.ign.es/wmts/pnoa-ma?x={x}' }), 1],
  ['a country code that is not alpha-2 is refused', one({ country: 'esp' }), 1],
  [
    'two sources for one country is an unanswered question',
    { sources: [{ ...base(), id: 'a' }, { ...base(), id: 'b' }], notYet: [] },
    1,
  ],
  [
    'a country left out must say why and how to close it',
    { sources: [base()], notYet: [{ country: 'nl' }] },
    2,
  ],
  [
    '🔴 MUTATION 4: a country cannot be enabled AND not enabled',
    {
      sources: [base(), { ...base(), id: 'y', country: 'nl' }],
      notYet: [{ country: 'nl', whyNotEnabled: 'w', howToClose: 'h' }],
    },
    1,
  ],
  ['no sources at all is refused', { sources: [], notYet: [] }, 1],
];

// 🔴 CAMP-286 REPLACED `resolve(argv[1])` WITH `realpathSync`. Node
// resolves `import.meta.url` through the REAL path, while `resolve()`
// only makes argv[1] absolute — it follows no symlink. Through a link
// the two never matched, the self-test silently did not run, and the CI
// step was green with no output. Written out rather than called because
// check-script-entrypoints.mjs recognises a guard by READING it.
const RUN_DIRECTLY = (() => {
  if (argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(argv[1])).href;
  } catch {
    return false;
  }
})();

if (RUN_DIRECTLY) chooseAction(argv.slice(2), ['--self-test'], 'check-satellite-licences.mjs');

if (RUN_DIRECTLY && argv.includes('--self-test')) {
  let failed = 0;
  for (const [what, data, expected] of SELF_TEST) {
    const got = problems(data, null).length;
    const ok = got === expected;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${what} (expected ${expected}, got ${got})`);
  }
  // 🔴 And the component half, which is the one that can rot silently.
  // Each case below is a mutation that WENT GREEN before 11.10.2026.
  const LIVE =
    'm.addSource(S, rasterSourceSpec(source));\n' +
    'm.addLayer({ id: SATELLITE_LAYER, type: "raster", source: S }, below);';

  const componentCases = [
    ['a component that calls rasterSourceSpec and draws the layer passes', LIVE, 0],
    [
      '🔴 MUTATION 3: the call commented out no longer passes a grep',
      LIVE.replace('m.addSource(S, rasterSourceSpec(source));', '// m.addSource(S, rasterSourceSpec(source));'),
      1,
    ],
    [
      '🔴 MUTATION 3b: the layer deleted — a source nobody draws',
      'm.addSource(S, rasterSourceSpec(source));',
      1,
    ],
    [
      '🔴 a component writing its own credit is refused',
      'm.addSource(S, { attribution: "Satellite imagery" });\nm.addLayer({ id: SATELLITE_LAYER });',
      2,
    ],
  ];
  for (const [what, src, expected] of componentCases) {
    const got = problems({ sources: [] }, src).filter((p) => p.includes('campsite-map.tsx')).length;
    const ok = got === expected;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${what} (expected ${expected}, got ${got})`);
  }

  // 🔴 And the stripper itself, because a stripper that removes nothing
  // would make the case above pass for the wrong reason.
  if (stripComments('// gone\nkept').trim() !== 'kept') {
    failed++;
    console.log('✗ stripComments does not remove a line comment');
  } else console.log('✓ stripComments removes a line comment');
  if (!stripComments('const u = "https://a//b";').includes('https://a//b')) {
    failed++;
    console.log('✗ stripComments ate a URL inside a string');
  } else console.log('✓ stripComments leaves a URL inside a string alone');

  console.log(
    failed
      ? `\n::error::self-test failed on ${failed} cases`
      : `\n✓ check-satellite-licences self-test: ${SELF_TEST.length + 6} cases`,
  );
  exit(failed ? 1 : 0);
}

// 🔴 Only when run, not when imported. Without this the file checked the
// real data as a side effect of `import`, so a test that wanted to reuse
// `problems()` or `stripComments()` got a process exit instead — the same
// shape as CAMP-202, where a spec file committed a migration on import.
if (RUN_DIRECTLY) {
const data = JSON.parse(readFileSync(DATA, 'utf8'));
const found = problems(data, readFileSync(MAP, 'utf8'));

for (const s of data.sources ?? []) {
  console.log(`  ${s.country.toUpperCase()}  ${s.licenceVerbatim}`);
  console.log(`      read ${data.takenAt} from ${s.readField}`);
}
for (const n of data.notYet ?? []) {
  console.log(`  ${n.country.toUpperCase()}  not enabled — ${n.whyNotEnabled.slice(0, 90)}…`);
}

if (found.length) {
  console.error('\n✗ satellite sources are not properly licensed:\n  ' + found.join('\n  '));
  exit(1);
}
console.log(
  `\n✓ ${data.sources.length} satellite source(s), each naming a licence, an ` +
    'attribution and where both were read from',
);
}
