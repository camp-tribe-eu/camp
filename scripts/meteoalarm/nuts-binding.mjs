#!/usr/bin/env node
// CAMP-GISCO: a warning that names its area in NUTS, placed on a MeteoAlarm
// zone — by NAME, because that is the only thing the two lists share.
//
//   node scripts/meteoalarm/nuts-binding.mjs --self-test
//   node scripts/meteoalarm/nuts-binding.mjs --refresh-table
//
// 🔴 WHY THIS FILE EXISTS. Six countries publish their warnings in a NUTS
// scheme (FR, BG, RO in NUTS3; HU, BE in NUTS2; HR beside its EMMA_ID),
// and the campsite column was filled by looking each point up in the
// EuroGeographics GISCO polygons. GISCO's licence says "the data will not
// be used for commercial purposes", measured 02.11.2026 on ALL SEVEN
// vintages (2003…2024), and CampTribe is going to be commercial. The
// source is removed, not negotiated.
//
// 🔴 THE REPLACEMENT IS NOT NEW DATA. MeteoAlarm publishes its own zone
// list (`MeteoAlarm_Geocodes_*.json`: code, country, name) and we already
// download it for 16 countries. Next to every NUTS code the feed carries
// the area's `areaDesc`, so the two are tied by name:
//
//     NUTS3:FR812 "Hérault"   ──name──▶   EMMA_ID:FR020 "Hérault"
//
// 🔴 THE JOIN IS DONE ON THE WARNING, NOT ON THE CAMPSITE. This is the one
// decision the card did not spell out, and it is measured, not assumed.
// Tying the campsite to a NUTS code needs a list of EVERY NUTS code with
// its name — which only the licensed file had. Live feeds carry a few:
// France 6 of ~96 départements today, so the literal route (live codes
// only) gave France 1 194 campsites of 21 759 (5.5%; GISCO: 99.6%).
// Whereas EMMA's own list is complete — 97 French zones — so campsites
// carry the EMMA zone they sit in, and each NUTS-coded warning area gets
// that zone's code ADDED next to its own. Same set-intersection the
// matchers already do; no consumer changes.
//
// 🔴 TWO NAMES THAT DO NOT MEET are data, below, not an `if` in the loop.
// Everything else is unique-name equality inside one country.

import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where the zone names came from. Not read at run time — see `--refresh-table`. */
export const EMMA_URL =
  'https://gitlab.com/meteoalarm-pm-group/documents/-/raw/master/MeteoAlarm_Geocodes_2026_07_31.json';

/**
 * The countries whose NUTS-coded areas are tied to an EMMA zone by name.
 *
 * 🔴 Croatia is NOT here, deliberately. MeteoAlarm's list knows HR001-008
 * and HR801-806 — marine zones and regions — while the feed's counties
 * carry HR018.. which are in no list; names like "Knin region" tie to no
 * county. Croatian counties are placed by OpenStreetMap instead
 * (`osm-hr-counties.mjs`).
 */
export const BINDABLE = Object.freeze(['BE', 'BG', 'FR', 'HU', 'RO']);

/** The NUTS schemes a feed uses for areas we tie by name. */
export const NUTS_SCHEMES = Object.freeze(['NUTS2', 'NUTS3']);

/**
 * Codes whose name does not equal any zone's name — written down, with
 * the reason and the zone they land on.
 *
 * 🔴 TWO KINDS, AND THE SECOND WAS MISSED. `BG334` and `RO321` were found
 * from LIVE codes (02.11.2026). Review then checked codes that were NOT in
 * the feeds that day, and Belgium's three Brabant regions found no zone:
 * MeteoAlarm has ONE zone, `BE004 "Brabant"`, for Brussels, Flemish
 * Brabant and Walloon Brabant together, and no name of the three equals
 * it. Belgium's own feed already publishes that area as `EMMA_ID:BE004`,
 * so the day a warning names `NUTS2:BE24` it would have reached nobody —
 * with a "⚠ unbound" line and exit code 0. The three are listed here with
 * the same second check (the GISCO polygon of each region overlaps BE004
 * more than any other zone: BE10 100%, BE24 89%, BE31 87% of the region
 * lies inside it; a one-off measurement, not shipped).
 *
 * The price of a shared zone is a shared warning: Flemish Brabant's
 * warning also reaches campsites in Walloon Brabant, because MeteoAlarm's
 * own polygon cannot tell them apart. That is the list's granularity, not a
 * choice made here.
 *
 * 🔴 `zoneName` is not decoration: `bindCode` refuses an exception whose
 * zone no longer carries that name, so the table cannot rot into a
 * binding to a zone that was renumbered under it.
 *
 * Both entries were verified a SECOND way, independent of names: the
 * 2013 GISCO polygon of each code overlaps this zone more than any other
 * zone of its country (one-off measurement 02.11.2026; the polygons are
 * not shipped and not used at run time).
 */
export const NAME_EXCEPTIONS = Object.freeze({
  BG334: {
    zone: 'BG023',
    zoneName: 'Targovoshte',
    why: 'the feed spells the province Targovishte, MeteoAlarm Targovoshte — one vowel apart in transliteration',
  },
  BE10: {
    zone: 'BE004',
    zoneName: 'Brabant',
    why: 'Brussels-Capital Region has no zone of its own: MeteoAlarm\'s single "Brabant" zone covers it together with both Brabant provinces',
  },
  BE24: {
    zone: 'BE004',
    zoneName: 'Brabant',
    why: 'Flemish Brabant — MeteoAlarm\'s single "Brabant" zone covers both Brabant provinces and Brussels, and no spelling of the province equals it',
  },
  BE31: {
    zone: 'BE004',
    zoneName: 'Brabant',
    why: 'Walloon Brabant (Brabant wallon) — MeteoAlarm\'s single "Brabant" zone covers both Brabant provinces and Brussels',
  },
  RO321: {
    zone: 'RO027',
    zoneName: 'MUNICIPIUL BUCURESTI',
    why: 'the feed says București, MeteoAlarm says MUNICIPIUL BUCURESTI — the same city, once as a name and once as an administrative unit',
  },
});

/**
 * A name reduced to what two spellings of one place have in common.
 *
 * 🔴 EACH STEP IS THERE BECAUSE A LIVE NAME NEEDS IT. Diacritics:
 * `Neamț` / `NEAMT`, `Brașov` / `BRASOV`, `Liège` / `Liege`. Case: EMMA
 * writes all of Romania in capitals. Punctuation and spacing: `Oost-
 * Vlaanderen` / `Oost Vlaanderen`. Letters that Unicode does not take
 * apart (`ł`, `đ`, `ø`) are spelled out, since NFD leaves them whole.
 */
export function normalise(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd')
    .replace(/ø/g, 'o')
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** `{ FR: { FR001: 'Ain', … }, … }` as committed in `emma-zone-names.json`. */
export function loadZones(file = path.join(here, 'emma-zone-names.json')) {
  return JSON.parse(readFileSync(file, 'utf8')).zones;
}

export const ZONES = loadZones();

/** The country a NUTS code belongs to: its first two letters. */
export const countryOf = (nutsCode) => String(nutsCode).slice(0, 2).toUpperCase();

/**
 * One NUTS code, tied to one zone — or told why not.
 *
 * `names` is every spelling the feed gave for this code, in every
 * language: Belgium's `BE23` is `Oost-Vlaanderen`, `Flandre Orientale`,
 * `East Flanders` and `Ostflandern`, and only the first one is also
 * MeteoAlarm's.
 *
 * 🔴 UNIQUE OR NOTHING. Two zones with the same name are a guess about
 * which was meant; a warning shown on the wrong place is worse than one
 * we say we cannot place.
 */
export function bindCode(code, names, zones = ZONES, exceptions = NAME_EXCEPTIONS) {
  const country = countryOf(code);
  const table = zones[country];
  if (!table) return { zone: null, why: `no zone names for ${country}` };

  const exception = exceptions[code];
  if (exception) {
    if (table[exception.zone] !== exception.zoneName) {
      return {
        zone: null,
        why: `the exception for ${code} names ${exception.zone} "${exception.zoneName}", which is now "${table[exception.zone] ?? 'absent'}"`,
      };
    }
    return { zone: exception.zone, how: 'exception' };
  }

  const wanted = new Set([...names].map(normalise).filter(Boolean));
  const hits = Object.entries(table)
    .filter(([, zoneName]) => wanted.has(normalise(zoneName)))
    .map(([zoneCode]) => zoneCode);
  if (hits.length === 1) return { zone: hits[0], how: 'name' };
  if (hits.length === 0) return { zone: null, why: `no ${country} zone is named ${[...names].join(' / ') || '(no name given)'}` };
  return { zone: null, why: `${hits.join(', ')} all carry the name ${[...names].join(' / ')}` };
}

/** Every NUTS code of an alert with every name it was given, across its language blocks. */
export function namesByNuts(infos) {
  const out = new Map();
  for (const info of infos ?? []) {
    for (const area of info?.area ?? []) {
      const name = typeof area?.areaDesc === 'string' ? area.areaDesc.trim() : '';
      for (const g of area?.geocode ?? []) {
        if (!NUTS_SCHEMES.includes(g?.valueName) || !g?.value) continue;
        if (!out.has(g.value)) out.set(g.value, new Set());
        if (name) out.get(g.value).add(name);
      }
    }
  }
  return out;
}

/**
 * The zone for every NUTS code an alert uses, and the ones that found none.
 *
 * 🔴 PER ALERT, ALL LANGUAGE BLOCKS. A warning is published once per
 * language and the kept row is the English one, but MeteoAlarm's own
 * name for a Belgian province is Dutch. Reading names from the kept
 * block alone binds 2 of Belgium's 5 live codes; all blocks bind 5.
 */
export function bindAlert(infos, zones = ZONES, exceptions = NAME_EXCEPTIONS) {
  const bound = new Map();
  const unbound = [];
  for (const [code, names] of namesByNuts(infos)) {
    // Croatia's counties (and anything outside the table) are not ours to
    // tie here; they are neither bound nor "unbound".
    if (!BINDABLE.includes(countryOf(code))) continue;
    const found = bindCode(code, names, zones, exceptions);
    if (found.zone) bound.set(code, found.zone);
    else unbound.push({ code, why: found.why });
  }
  return { bound, unbound };
}

/**
 * Areas with the zone's code added beside each NUTS code that has one.
 *
 * Pure: the areas that came in are not touched. The NUTS code stays — it
 * is what the issuer published — and the zone code joins it.
 */
export function withZones(areas, bound) {
  return areas.map((area) => {
    const have = new Set(area.codes.map((c) => c.toLowerCase()));
    const extra = [];
    for (const c of area.codes) {
      const at = c.indexOf(':');
      if (at === -1 || !NUTS_SCHEMES.includes(c.slice(0, at))) continue;
      const zone = bound.get(c.slice(at + 1));
      const joined = zone ? `EMMA_ID:${zone}` : null;
      if (joined && !have.has(joined.toLowerCase())) {
        have.add(joined.toLowerCase());
        extra.push(joined);
      }
    }
    return extra.length ? { ...area, codes: [...area.codes, ...extra] } : area;
  });
}

// ------------------------------------------------------------ the table

/** The bindable countries' zone names out of MeteoAlarm's own file, ordered. */
export function tableFrom(collection) {
  const zones = {};
  for (const c of BINDABLE) zones[c] = {};
  for (const f of collection?.features ?? []) {
    const { code, country, name } = f?.properties ?? {};
    if (BINDABLE.includes(country) && code && name) zones[country][code] = name;
  }
  for (const c of BINDABLE) {
    zones[c] = Object.fromEntries(Object.entries(zones[c]).sort(([a], [b]) => a.localeCompare(b)));
  }
  return { source: EMMA_URL, zones };
}

async function refreshTable() {
  const res = await fetch(EMMA_URL);
  if (!res.ok) throw new Error(`GET ${EMMA_URL} returned ${res.status}`);
  const table = tableFrom(await res.json());
  const counts = BINDABLE.map((c) => `${c} ${Object.keys(table.zones[c]).length}`).join(', ');
  const file = path.join(here, 'emma-zone-names.json');
  writeFileSync(file, `${JSON.stringify(table, null, 1)}\n`);
  console.log(`wrote ${file}: ${counts}`);
}

// ------------------------------------------------------------ self-test

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
  const zones = {
    FR: { FR020: 'Hérault', FR035: 'Haute-Savoie' },
    RO: { RO004: 'BRASOV', RO010: 'NEAMT', RO027: 'MUNICIPIUL BUCURESTI' },
    BE: { BE003: 'Oost Vlaanderen', BE010: 'Twin', BE011: 'Twin' },
    BG: { BG023: 'Targovoshte' },
  };

  // 🔴 EACH STEP OF `normalise` ON A NAME THAT NEEDS IT.
  check(normalise('Neamț') === normalise('NEAMT'), 'Neamț and NEAMT are one name: diacritics and case');
  check(normalise('Neamț') === 'neamt', 'the folded form is lower-case ASCII, not just equal to its twin');
  check(normalise('Oost-Vlaanderen') === normalise('Oost Vlaanderen'), 'a hyphen and a space are one separator');
  check(normalise('  Haute   Savoie ') === 'haute savoie', 'runs of spaces collapse and the ends are trimmed');
  check(normalise('Łódź') === 'lodz' && normalise('Đakovo') === 'dakovo', 'ł and đ, which NFD leaves whole, are spelled out');
  check(normalise(null) === '' && normalise(undefined) === '', 'a missing name is the empty name, not "null"');

  // The binding itself.
  check(bindCode('FR812', ['Hérault'], zones, {}).zone === 'FR020', 'an identical name binds');
  check(bindCode('RO101', ['Brașov'], zones, {}).zone === 'RO004', 'a name that differs only by diacritics and case binds');
  check(
    bindCode('BE23', ['East Flanders', 'Oost-Vlaanderen'], zones, {}).zone === 'BE003',
    'one of several language spellings is enough',
  );
  check(bindCode('BE23', ['East Flanders'], zones, {}).zone === null, 'a spelling no zone carries binds nothing');
  check(/no BE zone is named East Flanders/.test(bindCode('BE23', ['East Flanders'], zones, {}).why), 'and says which name it looked for');
  check(bindCode('BE99', ['Twin'], zones, {}).zone === null, '🔴 two zones with one name are refused, not guessed');
  check(/BE010, BE011/.test(bindCode('BE99', ['Twin'], zones, {}).why), 'and both are named');
  check(bindCode('FR812', ['Hérault'], { RO: zones.RO }, {}).zone === null, 'a country with no table binds nothing');
  // A name must be looked for inside ITS OWN country.
  check(bindCode('RO101', ['Hérault'], zones, {}).zone === null, '🔴 a French name does not bind a Romanian code');

  // Exceptions are data and are checked against the zone they name.
  const exc = { BG334: { zone: 'BG023', zoneName: 'Targovoshte', why: 'x' } };
  check(bindCode('BG334', ['Targovishte'], zones, exc).zone === 'BG023', 'an exception binds what the name could not');
  check(bindCode('BG334', ['Targovishte'], zones, exc).how === 'exception', 'and says it was an exception');
  check(
    bindCode('BG334', ['Targovishte'], { BG: { BG023: 'Renamed' } }, exc).zone === null,
    '🔴 an exception whose zone changed its name is refused, not followed',
  );
  check(
    /BG023 "Targovoshte", which is now "Renamed"/.test(bindCode('BG334', ['x'], { BG: { BG023: 'Renamed' } }, exc).why),
    'and the refusal names both the old name and the new one',
  );
  check(Object.values(NAME_EXCEPTIONS).every((e) => e.why.length > 20 && e.zoneName), 'every real exception carries a reason and a zone name');
  check(
    Object.keys(NAME_EXCEPTIONS).sort().join() === 'BE10,BE24,BE31,BG334,RO321',
    'the exceptions are the two measured on live codes (02.11.2026) and the three Belgian Brabant regions that review found were not live that day',
  );
  check(
    ['BE10', 'BE24', 'BE31'].every((c) => bindCode(c, ['Brussels', 'Flemish Brabant', 'Vlaams-Brabant', 'Brabant wallon']).zone === 'BE004'),
    '🔴 the three Brabant regions land on BE004 whatever name the feed gives them — the day Belgium names one, it reaches somebody',
  );
  check(
    ['BE10', 'BE24', 'BE31'].every((c) => bindCode(c, ['Brussels', 'Flemish Brabant', 'Vlaams-Brabant', 'Brabant wallon'], ZONES, {}).zone === null),
    'and without the exceptions they bind nothing — they are exceptions, not accidents of the name rule',
  );
  for (const [code, e] of Object.entries(NAME_EXCEPTIONS)) {
    check(ZONES[countryOf(code)]?.[e.zone] === e.zoneName, `${code} lands on ${e.zone}, which the committed table still names ${e.zoneName}`);
  }

  // An alert, across its language blocks.
  const infos = [
    { language: 'en-GB', area: [{ areaDesc: 'East Flanders', geocode: [{ valueName: 'NUTS2', value: 'BE23' }] }] },
    { language: 'nl-BE', area: [{ areaDesc: 'Oost-Vlaanderen', geocode: [{ valueName: 'NUTS2', value: 'BE23' }] }] },
    { language: 'en-GB', area: [{ areaDesc: 'Nowhere', geocode: [{ valueName: 'NUTS3', value: 'FR999' }] }] },
    { language: 'en-GB', area: [{ areaDesc: 'Split', geocode: [{ valueName: 'NUTS3', value: 'HR031' }, { valueName: 'EMMA_ID', value: 'HR018' }] }] },
  ];
  const got = bindAlert(infos, zones, {});
  check(got.bound.get('BE23') === 'BE003', 'a code is bound from the language block that happens to carry the zone\'s name');
  check(got.unbound.length === 1 && got.unbound[0].code === 'FR999', '🔴 a code nothing binds is REPORTED, not dropped');
  check(!got.bound.has('HR031') && !got.unbound.some((u) => u.code === 'HR031'), 'Croatia is neither bound nor reported here');
  check(
    bindAlert([infos[0]], zones, {}).bound.size === 0 && bindAlert([infos[0]], zones, {}).unbound.length === 1,
    'read from the English block alone it would not have bound — which is why every block is read',
  );

  // Adding the zone code to the area.
  const areas = [
    { name: 'a', codes: ['NUTS2:BE23'], polygons: [], circles: [] },
    { name: 'b', codes: ['NUTS3:FR999'], polygons: [], circles: [] },
    { name: 'c', codes: ['EMMA_ID:BE004'], polygons: [], circles: [] },
    { name: 'd', codes: ['NUTS3:HR031', 'EMMA_ID:HR018'], polygons: [], circles: [] },
  ];
  const out = withZones(areas, new Map([['BE23', 'BE003']]));
  check(out[0].codes.join() === 'NUTS2:BE23,EMMA_ID:BE003', 'the zone code joins the NUTS code, which stays');
  check(out[1] === areas[1] && out[2] === areas[2] && out[3] === areas[3], 'an area with nothing to add comes back untouched');
  check(areas[0].codes.length === 1, '🔴 the area that came in is not modified');
  check(
    withZones([{ codes: ['NUTS2:BE23', 'EMMA_ID:BE003'] }], new Map([['BE23', 'BE003']]))[0].codes.length === 2,
    'a zone already on the area is not added twice',
  );
  check(
    withZones([{ codes: ['NUTS2:BE23', 'emma_id:be003'] }], new Map([['BE23', 'BE003']]))[0].codes.length === 2,
    'and "already there" ignores case, like the matchers do',
  );
  check(
    withZones([{ codes: ['EMMA_ID:BE23'] }], new Map([['BE23', 'BE003']]))[0].codes.join() === 'EMMA_ID:BE23',
    'only a NUTS code is replaced: an EMMA code that happens to look the same is left alone',
  );

  // The committed table against MeteoAlarm's own file shape.
  const t = tableFrom({
    features: [
      { properties: { code: 'FR002', country: 'FR', name: 'B' } },
      { properties: { code: 'FR001', country: 'FR', name: 'A' } },
      { properties: { code: 'DE001', country: 'DE', name: 'Not ours' } },
      { properties: { code: '', country: 'FR', name: 'Nameless code' } },
    ],
  });
  check(Object.keys(t.zones.FR).join() === 'FR001,FR002', 'the table is ordered by code, so a refresh makes a small diff');
  check(!('DE' in t.zones) && Object.keys(t.zones).join() === BINDABLE.join(), 'only the bindable countries are kept');
  check(Object.keys(ZONES).join() === BINDABLE.join(), 'the committed table holds exactly the bindable countries');
  check(
    Object.entries(ZONES).every(([c, z]) => Object.keys(z).length > 0 && Object.keys(z).every((k) => k.startsWith(c))),
    'every committed zone code starts with its own country',
  );

  // 🔴 THE LIVE CORPUS: the only place here where the answer is not mine.
  //
  // Everything above feeds the binder fixtures I wrote, which would pass
  // for any binder that is consistent with itself. The corpus is the 88
  // codes the five feeds were actually using on 02.11.2026, with every
  // name they gave, and `zone` is what geography says (largest polygon
  // overlap), not what this module answers.
  {
    const corpus = JSON.parse(readFileSync(path.join(here, 'nuts-live-corpus.json'), 'utf8')).entries;
    check(corpus.length === 88, `the corpus holds the 88 live codes, got ${corpus.length}`);
    check(
      new Set(corpus.map((e) => e.code.slice(0, 2))).size === BINDABLE.length,
      'and it covers every bindable country, so no country is silently unmeasured',
    );
    const run = (exceptions) =>
      corpus.map((e) => ({ e, got: bindCode(e.code, e.names, ZONES, exceptions) }));
    const byName = run({});
    const named = byName.filter((r) => r.got.zone);
    const missed = byName.filter((r) => !r.got.zone).map((r) => r.e.code).sort();
    // 🔴 THE NUMBER THE CARD MEASURED, REMEASURED: 86 of 88 by name alone
    // (the card said 81 of 83; the feeds moved by five codes, the two
    // that fail are the same two). A binder that loses diacritics or case
    // handling drops below it, and THIS is the case that goes red.
    check(named.length === 86, `🔴 86 of 88 live codes bind by name alone, got ${named.length} of ${corpus.length}`);
    check(missed.join() === 'BG334,RO321', `the two that do not are exactly BG334 and RO321, got ${missed.join()}`);
    check(
      named.every((r) => r.got.zone === r.e.zone),
      `🔴 every code bound by name lands on the zone geography says — wrong: ${named.filter((r) => r.got.zone !== r.e.zone).map((r) => r.e.code).join()}`,
    );
    const withExc = run(NAME_EXCEPTIONS);
    check(
      withExc.filter((r) => r.got.zone === r.e.zone).length === 88,
      `with the two exceptions all 88 land on the zone geography says, got ${withExc.filter((r) => r.got.zone === r.e.zone).length}`,
    );
  }

  // 🔴 EXPECTED_CASES, because a case that stopped being reached prints
  // what a passing case prints.
  const EXPECTED_CASES = 48;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ REHEARSAL FAILED: ${cases.length} cases ran, expected ${EXPECTED_CASES}`);
    rc = 1;
  }
  console.log(
    rc === 0
      ? `✓ nuts-binding self-test: ${cases.length} cases over the name binding`
      : `✗ nuts-binding self-test: ${cases.length} cases, at least one failed`,
  );
  return rc;
}

const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const action = chooseAction(process.argv.slice(2), ['--self-test', '--refresh-table'], 'nuts-binding.mjs');
  if (action.has('--self-test')) process.exit(selfTest());
  if (action.has('--refresh-table')) await refreshTable();
}
