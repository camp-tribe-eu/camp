#!/usr/bin/env node
// CAMP-287 step 1, measured before it is built.
//
//   node scripts/meteoalarm/zone-coverage.mjs [--self-test]
//
// 🔴 THE COLUMN COMES AFTER THIS NUMBER, NOT BEFORE IT.
//
// The card asks for `warning_areas text[]` on `camping_spots`, filled by
// resolving each campsite's point into the zone codes a warning can name.
// Before adding a column it is worth knowing what would go in it: a
// resolver that places 40% of campsites is a different product decision
// from one that places 93%.
//
// 🔴 COVERAGE IS NOT MATCHABILITY, AND THAT TRAP IS WHY THIS FILE EXISTS.
//
// France is inside MeteoAlarm's own `EMMA_ID` polygons for 97.5% of its
// 21 702 campsites — and French warnings are published in `NUTS3`. Codes
// in a scheme the country never uses match nothing. So the question is
// per country: does this campsite carry a code in a scheme ITS OWN feed
// publishes? `SCHEMES_USED` below is that question's data, and it comes
// from `fetch-warnings.mjs --census`, not from an opinion.
//
// 🔴 MEASURED 13.10.2026, all 27 live feeds, 42 135 code occurrences:
//
//     EMMA_ID     26 969   16 countries
//     WARNCELLID   8 312   germany only      — no geometry source exists
//     NUTS3        6 140   bg, hr, fr, ro
//     NUTS2          614   be, hu
//     CISORP          92   czechia           — no geometry source exists
//     FIPS             8   ireland
//
// Two conclusions the card did not have. `WARNCELLID` is a fifth of all
// codes and nothing can resolve it — but Germany's feed also publishes
// `EMMA_ID`, so German campsites are placed anyway. And `FIPS` is EIGHT
// occurrences in one country, for which `SOURCES` downloads Natural
// Earth: 40.7 MB, the largest of the four, and the one this repository
// already knows is systematically wrong within 1–2 km of a border. It is
// not used here.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';

/**
 * Which geocode schemes each member state's own feed publishes.
 *
 * 🔴 From `fetch-warnings.mjs --census` on 13.10.2026, not from the
 * scheme list in `resolve-areas.mjs`: that one says what we COULD
 * resolve, this says what anybody actually sends. The two disagree, and
 * the disagreement is the whole subject.
 *
 * Absent from this map, deliberately: `EE`, `SE`, `SI`, `SK`, `LU`,
 * `CY`, `MT`. Their feeds carry no geocode on any area at all — four of
 * them served no area in that run. For their campsites the honest answer
 * is the `unlocatable` state added in CAMP-287's matcher, not a code.
 */
export const SCHEMES_USED = Object.freeze({
  AT: ['EMMA_ID'], BE: ['EMMA_ID', 'NUTS2'], BG: ['NUTS3'], CZ: ['EMMA_ID'],
  DE: ['EMMA_ID'], DK: ['EMMA_ID'], ES: ['EMMA_ID'], FI: ['EMMA_ID'],
  FR: ['NUTS3'], GR: ['EMMA_ID'], HR: ['EMMA_ID', 'NUTS3'], HU: ['NUTS2'],
  IE: ['EMMA_ID'], IT: ['EMMA_ID'], LT: ['EMMA_ID'], LV: ['EMMA_ID'],
  NL: ['EMMA_ID'], PL: ['EMMA_ID'], PT: ['EMMA_ID'], RO: ['NUTS3'],
});

/** The three sources that earn their download. */
export const USED_SOURCES = Object.freeze({
  EMMA_ID: {
    url: 'https://gitlab.com/meteoalarm-pm-group/documents/-/raw/master/MeteoAlarm_Geocodes_2026_07_31.json',
    idField: 'code',
    zones: 2006,
  },
  NUTS3: {
    url: 'https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_01M_2013_4326_LEVL_3.geojson',
    idField: 'NUTS_ID',
    zones: 1480,
  },
  NUTS2: {
    url: 'https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_01M_2013_4326_LEVL_2.geojson',
    idField: 'NUTS_ID',
    zones: 320,
  },
});

/**
 * `(country, scheme)` pairs, as SQL `VALUES`, from the map above.
 *
 * Built rather than written out, so the query and the census cannot
 * drift apart: a country added to `SCHEMES_USED` reaches the join with
 * no second edit.
 */
export function usesPairs(schemes = SCHEMES_USED) {
  const rows = [];
  for (const country of Object.keys(schemes).sort()) {
    for (const scheme of schemes[country]) rows.push([country, scheme]);
  }
  return rows;
}

/**
 * One GeoJSON feature collection as `scheme\tcode\tgeometry` lines.
 *
 * 🔴 A feature whose geometry or id is missing is DROPPED AND COUNTED,
 * never written as an empty row: a zone with no shape contains nothing,
 * and a silent skip would lower coverage for a reason no number names.
 */
export function rowsFrom(collection, scheme, idField) {
  const out = [];
  let dropped = 0;
  for (const f of collection?.features ?? []) {
    const code = String(f?.properties?.[idField] ?? '').trim();
    const geometry = f?.geometry;
    if (!code || !geometry) {
      dropped += 1;
      continue;
    }
    // 🔴 THE GUARD THAT USED TO BE HERE COULD NEVER FIRE, and the test
    // that "proved" it was the giveaway. It refused a payload holding a
    // tab or a newline, because either would split the `\copy` row. But
    // `JSON.stringify` escapes both as two characters — measured:
    // `JSON.stringify({a:'x\ty'})` is `{"a":"x\\ty"}`, and
    // `.includes('\t')` on it is false. Unreachable code wearing a
    // guard's clothes is worse than no guard: it reads as a handled
    // case. The tab in the row below is therefore ours alone.
    out.push(`${scheme}\t${code}\t${JSON.stringify(geometry)}`);
  }
  return { lines: out, dropped };
}

/** The verdict: a share, and the countries that carry the shortfall. */
export function verdict(total, placed, perCountry) {
  if (total === 0) {
    return { ok: false, why: 'no live campsites were read at all' };
  }
  const short = perCountry
    .filter((c) => c.missing > 0)
    .sort((a, b) => b.missing - a.missing);
  return {
    ok: true,
    share: Math.round((1000 * placed) / total) / 10,
    short,
  };
}

function selfTest() {
  let rc = 0;
  const cases = [];
  const check = (cond, m) => {
    cases.push(m);
    if (!cond) {
      console.error(`✗ REHEARSAL FAILED: ${m}`);
      rc = 1;
    }
  };

  const pairs = usesPairs();
  check(pairs.length === 22, `the census yields 22 (country, scheme) pairs, got ${pairs.length}`);
  check(
    pairs.some(([c, s]) => c === 'FR' && s === 'NUTS3'),
    'France is joined on NUTS3 — the scheme its own feed publishes',
  );
  check(
    !pairs.some(([c, s]) => c === 'FR' && s === 'EMMA_ID'),
    '🔴 France must NOT be joined on EMMA_ID: 97.5% of its campsites sit inside those polygons and none of its warnings name them',
  );
  for (const silent of ['EE', 'SE', 'SI', 'SK', 'LU', 'CY', 'MT']) {
    check(
      !(silent in SCHEMES_USED),
      `${silent} publishes no geocode at all and must not be claimed as matchable`,
    );
  }
  check(!('FIPS' in USED_SOURCES), 'FIPS is 8 occurrences and 40.7 MB of a border-inaccurate source');
  check(!('WARNCELLID' in USED_SOURCES), 'WARNCELLID has no geometry source to download');

  const collection = {
    features: [
      { properties: { code: 'BE001' }, geometry: { type: 'Polygon', coordinates: [] } },
      { properties: { code: '' }, geometry: { type: 'Polygon', coordinates: [] } },
      { properties: { code: 'NOGEOM' }, geometry: null },
    ],
  };
  const made = rowsFrom(collection, 'EMMA_ID', 'code');
  check(made.lines.length === 1, 'one usable feature became one row');
  check(made.dropped === 2, 'the two unusable features were COUNTED, not silently skipped');
  check(made.lines[0].split('\t').length === 3, 'the row has exactly three columns');

  // The payload cannot carry a raw tab, so the row cannot be split by
  // one: this asserts the property the removed guard pretended to give.
  const tabbed = rowsFrom(
    { features: [{ properties: { code: 'X' }, geometry: { type: 'P', note: 'a\tb' } }] },
    'EMMA_ID',
    'code',
  );
  check(
    tabbed.lines.length === 1 && tabbed.lines[0].split('\t').length === 3,
    'a geometry holding a tab character still produced exactly three columns',
  );

  // 🔴 ВХІДНИЙ ПОРЯДОК НАВМИСНО НЕ ЗБІГАЄТЬСЯ З ОЧІКУВАНИМ. Перша
  // редакція подавала SE(10), FR(1), IT(0) — уже за спаданням, тож
  // фікстура обирала правильну відповідь за мене: мутація «прибрати
  // `.sort()`» переживала весь прогін. Тепер найбільша нестача стоїть
  // у вході ОСТАННЬОЮ.
  const v = verdict(100, 93, [
    { country: 'FR', total: 50, missing: 1 },
    { country: 'IT', total: 40, missing: 0 },
    { country: 'SE', total: 10, missing: 10 },
  ]);
  check(v.share === 93, `the share is 93, got ${v.share}`);
  check(v.short.length === 2, 'only the countries with a shortfall are listed');
  check(v.short[0].country === 'SE', 'the largest shortfall is named first');
  check(verdict(0, 0, []).ok === false, '🔴 reading no campsites at all is a failure, not 0%');

  // 🔴 Літерал, і він спіймав мене двічі за цю сесію. Лічба: 3 про
  // схеми + 7 мовчазних країн + 2 про джерела + 4 про рядки + 4 про
  // вирок = 20.
  const EXPECTED_CASES = 20;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ REHEARSAL FAILED: ${cases.length} cases ran, expected ${EXPECTED_CASES}`);
    rc = 1;
  }
  console.log(
    rc === 0
      ? `✓ zone-coverage self-test: ${cases.length} cases over what can be placed`
      : `✗ zone-coverage self-test: ${cases.length} cases, at least one failed`,
  );
  return rc;
}

// 🔴 BEHIND THE ENTRY POINT, and yesterday is why. In CAMP-275 I left
// `chooseAction` and `process.exit` at module level in a file that
// exported a function; importing it would have parsed argv and killed
// the importer. `check-script-entrypoints.mjs` did not catch it
// (CAMP-303), so the habit has to hold without the guard.
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'zone-coverage.mjs');
  if (action.has('--self-test')) process.exit(selfTest());
  console.error(
    'This module carries the census and the shaping; the measurement it\n' +
      'documents was run on 13.10.2026 and its numbers are in the header.\n' +
      'Run with --self-test.',
  );
  process.exit(1);
}
