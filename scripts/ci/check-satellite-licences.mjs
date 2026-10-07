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

import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = join(ROOT, 'apps/web/src/data/satellite-sources.json');
const MAP = join(ROOT, 'apps/web/src/components/campsite-map.tsx');

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

  // And the component must use the field, not a string of its own.
  if (mapSource !== null) {
    if (!/attribution:\s*source\.attribution/.test(mapSource)) {
      out.push(
        'campsite-map.tsx does not build the raster source with ' +
          '`attribution: source.attribution` — a credit the component writes ' +
          'itself is a credit nothing here can check',
      );
    }
    for (const s of sources) {
      if (s.tiles && mapSource.includes(s.tiles)) {
        out.push(`${s.id}: its tile URL is written into the component as a literal`);
      }
    }
  }
  return out;
}

const SELF_TEST = [
  [
    'a source with everything passes',
    {
      sources: [
        {
          id: 'x',
          country: 'es',
          provider: 'Instituto Geográfico Nacional',
          providerShort: 'Instituto Geográfico Nacional',
          licence: 'CC BY 4.0',
          licenceVerbatim: 'CC BY 4.0 scne.es',
          attribution: 'Orthophoto © Instituto Geográfico Nacional',
          readFrom: 'https://example.test/caps',
          readField: 'ows:AccessConstraints',
          tiles: 'https://t/{z}/{x}/{y}.jpg',
        },
      ],
      notYet: [],
    },
    0,
  ],
  [
    '🔴 a source with no licence at all is refused',
    { sources: [{ id: 'x', country: 'es', provider: 'P', providerShort: 'P', attribution: 'c P', readFrom: 'https://a', readField: 'f', tiles: '{z}' }] },
    2, // licence and licenceVerbatim
  ],
  [
    '🔴 a licence with no link to where it was read is refused',
    { sources: [{ id: 'x', country: 'es', provider: 'P', providerShort: 'P', licence: 'CC BY', licenceVerbatim: 'CC BY', attribution: 'c P', readField: 'f', tiles: '{z}' }] },
    1,
  ],
  [
    '…and a readFrom that is not a URL is refused',
    { sources: [{ id: 'x', country: 'es', provider: 'P', providerShort: 'P', licence: 'CC BY', licenceVerbatim: 'CC BY', attribution: 'c P', readFrom: 'see the website', readField: 'f', tiles: '{z}' }] },
    1,
  ],
  [
    '🔴 an attribution that names nobody is refused',
    { sources: [{ id: 'x', country: 'es', provider: 'Instituto Geográfico Nacional', providerShort: 'Instituto Geográfico Nacional', licence: 'CC BY', licenceVerbatim: 'CC BY', attribution: 'Satellite imagery', readFrom: 'https://a', readField: 'f', tiles: '{z}' }] },
    1,
  ],
  [
    'two sources for one country is an unanswered question',
    {
      sources: [
        { id: 'a', country: 'es', provider: 'P', providerShort: 'P', licence: 'L', licenceVerbatim: 'L', attribution: 'c P', readFrom: 'https://a', readField: 'f', tiles: '{z}' },
        { id: 'b', country: 'es', provider: 'P', providerShort: 'P', licence: 'L', licenceVerbatim: 'L', attribution: 'c P', readFrom: 'https://a', readField: 'f', tiles: '{z}' },
      ],
    },
    1,
  ],
  [
    'a country left out must say why and how to close it',
    { sources: [{ id: 'x', country: 'es', provider: 'P', providerShort: 'P', licence: 'L', licenceVerbatim: 'L', attribution: 'c P', readFrom: 'https://a', readField: 'f', tiles: '{z}' }], notYet: [{ country: 'nl' }] },
    2,
  ],
  [
    'a tile template with no {z} is not a template',
    { sources: [{ id: 'x', country: 'es', provider: 'P', providerShort: 'P', licence: 'L', licenceVerbatim: 'L', attribution: 'c P', readFrom: 'https://a', readField: 'f', tiles: 'https://t/jpg' }] },
    1,
  ],
];

if (argv.includes('--self-test')) {
  let failed = 0;
  for (const [what, data, expected] of SELF_TEST) {
    const got = problems(data, null).length;
    const ok = got === expected;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${what} (expected ${expected}, got ${got})`);
  }
  // 🔴 And the component half, which is the one that can rot silently.
  const usesField = problems(
    { sources: [] },
    'm.addSource(S, { type: "raster", attribution: source.attribution })',
  ).filter((p) => p.includes('attribution: source.attribution'));
  if (usesField.length !== 0) {
    failed++;
    console.log('✗ a component that DOES use the field was reported as not');
  } else console.log('✓ a component that uses the field passes');

  const writesItsOwn = problems({ sources: [] }, 'attribution: "Satellite imagery"');
  if (writesItsOwn.length === 0) {
    failed++;
    console.log('✗ a component writing its own credit was accepted');
  } else console.log('✓ a component writing its own credit is refused');

  console.log(
    failed
      ? `\n::error::self-test failed on ${failed} cases`
      : `\n✓ self-test passed: ${SELF_TEST.length + 2} cases`,
  );
  exit(failed ? 1 : 0);
}

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
