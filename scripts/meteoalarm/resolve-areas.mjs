#!/usr/bin/env node
// CAMP-149: turning a warning's area code into geometry.
//
//   node scripts/meteoalarm/resolve-areas.mjs --self-test
//
// 🔴 A WARNING CARRIES A CODE, NOT A SHAPE, and the codes are not one
// scheme. Measured across all 27 live feeds on 05.10.2026:
//
//   EMMA_ID      26 318   most member states
//   NUTS3         6 586   France, Bulgaria
//   WARNCELLID    5 672   Germany
//   NUTS2           566   Belgium, Hungary
//   FIPS            393   Ireland
//   CISORP            6   Czechia
//
// The card planned one geometry file for all of them. Measured, that is
// wrong in both directions, and both corrections matter:
//
// 🔴 TWO OF THE SIX NEED NO SOURCE AT ALL. Germany and Czechia send
// `WARNCELLID` and `CISORP` ALONGSIDE `EMMA_ID`, never instead:
// 5 678 areas of 5 678 carry an EMMA_ID. Checked per AREA, not per
// code — 334 German EMMA_IDs against 333 WARNCELLIDs looked like
// parity, and "almost" is where a silently dropped warning lives.
//
// 🔴 AND `NUTS3` NEEDS A VINTAGE, NOT JUST A NAME. The feed uses the
// 2013 nomenclature. Against France's 82 live codes:
//
//   NUTS 2024 (current)   8 of 82
//   NUTS 2016             8 of 82
//   NUTS 2013            82 of 82
//
// France renumbered in 2016, so `FR712` means Ain in the old list and
// nothing in the new one. Reaching for the newest file — the obvious
// move — resolves one code in ten and loses the rest without a word.

/** Where each scheme's geometry comes from. */
export const SOURCES = {
  EMMA_ID: {
    id: 'meteoalarm-geocodes',
    url: 'https://gitlab.com/meteoalarm-pm-group/documents/-/raw/master/MeteoAlarm_Geocodes_2026_07_31.json',
    idField: 'code',
  },
  NUTS3: {
    id: 'eurostat-nuts-2013-l3',
    url: 'https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_01M_2013_4326_LEVL_3.geojson',
    idField: 'NUTS_ID',
  },
  NUTS2: {
    id: 'eurostat-nuts-2013-l2',
    url: 'https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_01M_2013_4326_LEVL_2.geojson',
    idField: 'NUTS_ID',
  },
  FIPS: {
    id: 'natural-earth-admin-1',
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson',
    idField: 'fips',
  },
};

/** Schemes that always travel beside one we can resolve. */
export const REDUNDANT = ['WARNCELLID', 'CISORP'];

/**
 * Irish codes the source split after MeteoAlarm's list was made.
 *
 * Natural Earth resolves 22 of Ireland's 26 county codes directly. The
 * other four are not missing: they are counties that were subdivided,
 * and the source carries the parts under new codes. Written down here
 * rather than guessed at join time.
 */
export const FIPS_SPLIT = {
  EI07: ['EI33', 'EI34', 'EI35', 'EI39'],
  EI26: ['EI38', 'EI40'],
  EI27: ['EI32', 'EI41'],
};

/** Monaghan carries no `fips` in Natural Earth; its geometry is there. */
export const FIPS_BY_ISO = { EI22: 'IE-MN' };

/**
 * 🔴 `fips` IS NOT UNIQUE IN NATURAL EARTH, so a naive join is WRONG
 * rather than incomplete.
 *
 * Measured: `EI32` is on BOTH Cork and Waterford; `EI16`/`EI37` are
 * both Limerick; `EI10`/`EI36` both Galway. "Find the first feature
 * with this fips" would put a Waterford storm warning over County Cork
 * — a warning shown for the wrong place, which is worse than none.
 *
 * So a lookup returns EVERY match and the caller must refuse an
 * ambiguous one rather than pick.
 */
export function lookup(features, scheme, value, idField) {
  const field = idField ?? SOURCES[scheme]?.idField;
  if (!field) return { matches: [], why: `no source for scheme ${scheme}` };
  return { matches: features.filter((f) => f?.properties?.[field] === value), why: null };
}

/** The codes to look up for one area, after redundancy and the splits. */
export function plan(codes) {
  const parsed = codes
    .map((c) => {
      const at = String(c).indexOf(':');
      return at === -1 ? null : { scheme: String(c).slice(0, at), value: String(c).slice(at + 1) };
    })
    .filter(Boolean);

  if (parsed.length === 0) return { scheme: null, values: [], why: 'the area carries no code' };

  // 🔴 Prefer a scheme we have geometry for. A German area carries both
  // WARNCELLID and EMMA_ID; taking the first listed would send us
  // looking for a source we deliberately do not have.
  const usable = parsed.find((p) => SOURCES[p.scheme]);
  if (!usable) {
    const schemes = [...new Set(parsed.map((p) => p.scheme))].join(', ');
    return { scheme: null, values: [], why: `no resolvable scheme among: ${schemes}` };
  }

  if (usable.scheme === 'FIPS') {
    if (FIPS_SPLIT[usable.value]) {
      return { scheme: 'FIPS', values: FIPS_SPLIT[usable.value], why: null, split: usable.value };
    }
    if (FIPS_BY_ISO[usable.value]) {
      return { scheme: 'FIPS', values: [FIPS_BY_ISO[usable.value]], idField: 'iso_3166_2', why: null };
    }
  }
  return { scheme: usable.scheme, values: [usable.value], why: null };
}

// ------------------------------------------------------------- coverage
//
// 🔴 EVERY NUMBER IN THE HEADER IS A DATE, NOT A FACT.
//
// The schemes, the vintage and the Irish splits are all how the feed
// behaved on 05.10.2026. France moved from NUTS 2013 to 2016 once
// already; when it happens again our join silently stops resolving and
// the warnings quietly stop appearing — the exact failure CAMP-149 was
// written to forbid, arriving from the supplier instead of from us.
//
// So the measurement is repeatable and it FAILS BY ITSELF. It is not a
// per-pull-request check: it downloads ~90 MB and asks the live feeds,
// so it belongs on a schedule and in the hands of whoever is about to
// trust the join.

const CACHE = process.env.RESOLVE_CACHE ?? '/tmp/camp-149-cache';

async function cached(name, url) {
  const { mkdir, readFile, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await mkdir(CACHE, { recursive: true });
  const at = join(CACHE, name);
  try {
    return JSON.parse(await readFile(at, 'utf8'));
  } catch {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const text = await res.text();
    await writeFile(at, text, 'utf8');
    return JSON.parse(text);
  }
}

/** Distinct `SCHEME:VALUE` codes a feed carries, by country. */
export function codesIn(payload) {
  const out = new Set();
  for (const w of payload?.warnings ?? []) {
    for (const info of w.alert?.info ?? []) {
      for (const area of info.area ?? []) {
        const codes = (area.geocode ?? [])
          .filter((g) => g?.valueName && g?.value)
          .map((g) => `${g.valueName}:${g.value}`);
        if (codes.length) out.add(codes.join('||'));
      }
    }
  }
  return [...out];
}

/** What fraction of a country's areas we can put on a map, and why not. */
export function coverageOf(areaCodes, geometry) {
  let resolved = 0;
  const unresolved = new Map();
  for (const joined of areaCodes) {
    const p = plan(joined.split('||'));
    if (!p.scheme) {
      unresolved.set(p.why, (unresolved.get(p.why) ?? 0) + 1);
      continue;
    }
    const features = geometry[p.scheme] ?? [];
    const hits = p.values.map((v) => lookup(features, p.scheme, v, p.idField).matches);
    if (hits.every((h) => h.length === 1)) resolved += 1;
    else if (hits.some((h) => h.length > 1)) {
      unresolved.set('ambiguous code', (unresolved.get('ambiguous code') ?? 0) + 1);
    } else {
      unresolved.set(`${p.scheme} code not in its source`, (unresolved.get(`${p.scheme} code not in its source`) ?? 0) + 1);
    }
  }
  return { total: areaCodes.length, resolved, unresolved: [...unresolved.entries()] };
}

/** Below this, the join has stopped working and somebody must look. */
export const MIN_COVERAGE = 0.95;

async function coverage() {
  const { COUNTRIES, feedUrl } = await import('./fetch-warnings.mjs');
  const geometry = {};
  for (const [scheme, src] of Object.entries(SOURCES)) {
    const doc = await cached(`${src.id}.json`, src.url);
    geometry[scheme] = doc.features ?? [];
    console.log(`  ${scheme.padEnd(9)} ${String(geometry[scheme].length).padStart(5)} features  (${src.id})`);
  }
  console.log('');

  let worst = 2;
  let worstCountry = null;
  let anyAreas = 0;
  // 🔴 Counted and named, not skipped. A country that returns no coded
  // area is invisible in a report that only prints percentages — and
  // "invisible" is how a feed that quietly stopped carrying codes would
  // look. Seven member states are in this state by design (they send a
  // polygon, or nothing); an eighth appearing here is news.
  const noCodes = [];
  for (const country of COUNTRIES) {
    let payload;
    try {
      payload = await (await fetch(feedUrl(country))).json();
    } catch (err) {
      console.log(`  ${country.padEnd(12)} feed unreadable: ${String(err.message).slice(0, 40)}`);
      continue;
    }
    const codes = codesIn(payload);
    if (codes.length === 0) {
      noCodes.push(country);
      continue;
    }
    anyAreas += codes.length;
    const c = coverageOf(codes, geometry);
    const pct = c.resolved / c.total;
    if (pct < worst) {
      worst = pct;
      worstCountry = country;
    }
    const why = c.unresolved.map(([k, n]) => `${n} ${k}`).join(', ');
    console.log(
      `  ${country.padEnd(12)} ${String(c.resolved).padStart(5)}/${String(c.total).padEnd(5)} ` +
        `${(pct * 100).toFixed(1).padStart(5)}%${why ? `   ${why}` : ''}`,
    );
  }

  // 🔴 Nothing to measure is a failure, not a pass. A run where every
  // feed was empty or every fetch failed would otherwise report perfect
  // coverage of nothing.
  console.log(
    `\n${noCodes.length} countries returned no coded area: ${noCodes.join(', ') || '(none)'}`,
  );

  if (anyAreas === 0) throw new Error('no country returned a single coded area — that is a fetch failure');
  if (worst < MIN_COVERAGE) {
    throw new Error(
      `${worstCountry} resolves ${(worst * 100).toFixed(1)}% of its areas, below ${MIN_COVERAGE * 100}% — ` +
        'the nomenclature has probably moved under us; read the unresolved reasons above',
    );
  }
  // 🔴 Named even when nothing is wrong. "worst country: null" is what
  // this printed when every country resolved perfectly, because the
  // variable was only ever set on a failure — a report that says
  // nothing precisely when the news is good.
  console.log(
    worst >= 1
      ? `every one of the ${COUNTRIES.length - noCodes.length} countries with codes resolved completely`
      : `worst country: ${worstCountry} at ${(worst * 100).toFixed(1)}%`,
  );
}

function selfTest() {
  let bad = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) console.log(`ok   ${name}`);
    else {
      bad += 1;
      console.log(`x    ${name}${detail ? `  ${detail}` : ''}`);
    }
  };

  ok('a plain EMMA_ID resolves to itself', plan(['EMMA_ID:PL803']).values[0] === 'PL803');

  const de = plan(['WARNCELLID:109176000', 'EMMA_ID:DE303']);
  ok('a German area is resolved by its EMMA_ID, not its WARNCELLID',
    de.scheme === 'EMMA_ID' && de.values[0] === 'DE303', JSON.stringify(de));
  ok('...whichever order the source lists them in',
    plan(['EMMA_ID:DE303', 'WARNCELLID:109176000']).scheme === 'EMMA_ID');
  ok('...and the same for Czechia CISORP',
    plan(['CISORP:5102', 'EMMA_ID:CZ05102']).scheme === 'EMMA_ID');

  ok('NUTS3 is kept as NUTS3', plan(['NUTS3:FR712']).scheme === 'NUTS3');
  ok('NUTS2 is a different source from NUTS3',
    SOURCES.NUTS2.url !== SOURCES.NUTS3.url && /LEVL_2/.test(SOURCES.NUTS2.url));
  ok('the NUTS source is pinned to the 2013 vintage',
    /_2013_/.test(SOURCES.NUTS3.url) && /_2013_/.test(SOURCES.NUTS2.url), SOURCES.NUTS3.url);

  ok('Dublin legacy code expands to the four counties it became',
    plan(['FIPS:EI07']).values.join(',') === 'EI33,EI34,EI35,EI39');
  ok('...Tipperary to its two ridings', plan(['FIPS:EI26']).values.length === 2);
  ok('...and Monaghan is matched by ISO, because its fips field is empty',
    plan(['FIPS:EI22']).idField === 'iso_3166_2');
  ok('an ordinary Irish county is not expanded', plan(['FIPS:EI06']).values.join(',') === 'EI06');

  ok('an area with no code says so', plan([]).why === 'the area carries no code');
  ok('a code with no source names the scheme rather than vanishing',
    /SOMETHING_NEW/.test(plan(['SOMETHING_NEW:1']).why ?? ''));
  ok('...and a malformed code is not mistaken for a scheme',
    plan(['justastring']).why === 'the area carries no code');

  const features = [
    { properties: { fips: 'EI32', name: 'Cork', iso_3166_2: 'IE-CO' } },
    { properties: { fips: 'EI32', name: 'Waterford', iso_3166_2: 'IE-WD' } },
    { properties: { fips: 'EI06', name: 'Donegal', iso_3166_2: 'IE-DL' } },
  ];
  ok('a duplicated fips returns BOTH matches, so the caller must refuse',
    lookup(features, 'FIPS', 'EI32').matches.length === 2);
  ok('...while an unambiguous one returns exactly one',
    lookup(features, 'FIPS', 'EI06').matches.length === 1);
  ok('...and an unknown code returns none, not a guess',
    lookup(features, 'FIPS', 'EI99').matches.length === 0);

  ok('the redundant schemes are named, not inferred',
    REDUNDANT.includes('WARNCELLID') && REDUNDANT.includes('CISORP'));
  ok('every source has a url and an id field',
    Object.values(SOURCES).every((s) => s.url && s.idField && s.id));

  console.log(bad ? `\nx ${bad} self-test failure(s)` : `\nself-test passed`);
  return bad;
}

import { pathToFileURL } from 'node:url';
const RUN_DIRECTLY =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (RUN_DIRECTLY) {
  if (process.argv.includes('--self-test')) process.exit(selfTest() ? 1 : 0);
  if (process.argv.includes('--coverage')) await coverage();
}
