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

// 🔴 `REDUNDANT = ['WARNCELLID', 'CISORP']` stood here and nothing read
// it: `plans` keeps a scheme when `SOURCES` has geometry for it, which
// already excludes those two. Its only test asserted the constant
// against itself — green forever, proving nothing. Removed rather than
// left as documentation that looks like code.

/**
 * Irish codes the source split after MeteoAlarm's list was made.
 *
 * Natural Earth resolves 22 of Ireland's 26 county codes directly. The
 * other four are not missing: they are counties that were subdivided,
 * and the source carries the parts under new codes. Written down here
 * rather than guessed at join time.
 */
export const FIPS_SPLIT = {
  // Dublin into four, Tipperary into two: genuinely DIFFERENT places,
  // each one feature.
  EI07: ['EI33', 'EI34', 'EI35', 'EI39'],
  EI26: ['EI38', 'EI40'],
};

/**
 * Codes resolved by ISO subdivision instead of `fips`.
 *
 * 🔴 `EI27` WAS LISTED AS A SPLIT AND IT IS NOT ONE. It was
 * `['EI32', 'EI41']`, and review measured that `EI32` sits on BOTH
 * Waterford and Cork in Natural Earth — so `EI27` resolved to nothing,
 * reported as an ambiguous code, while `EI27` is live in Ireland's feed
 * right now. It was also the only entry in that table with no test of
 * its own: the suite checked `EI07` by value and `EI26` by length, so
 * correcting `EI27` to anything at all left it green.
 *
 * Waterford is in the source TWICE — `EI32` and `EI41`, both carrying
 * `IE-WD`. That is one place in two pieces, not two places, and naming
 * either `fips` would be a guess about which piece is meant. The ISO
 * code names the place and takes both.
 */
export const FIPS_BY_ISO = { EI22: 'IE-MN', EI27: 'IE-WD' };



/**
 * 🔴 `fips` IS NOT UNIQUE IN NATURAL EARTH, so a naive join is WRONG
 * rather than incomplete.
 *
 * Measured on all 34 Irish features: `EI32` is on BOTH Waterford and
 * Cork, and that is the ONLY duplicated code. "Find the first feature
 * with this fips" would put a Waterford storm warning over County Cork
 * — a warning shown for the wrong place, which is worse than none.
 *
 * ⚠️ This paragraph used to name `EI16`/`EI37` and `EI10`/`EI36` as the
 * same trap. They are not: those are two codes that each match exactly
 * one feature, both happening to be called Limerick and Galway. Two
 * names for one county is not an ambiguous lookup, and listing them
 * here made the real case look ordinary.
 *
 * So a lookup returns EVERY match and the caller must refuse an
 * ambiguous one rather than pick.
 */
export function lookup(features, scheme, value, idField) {
  const field = idField ?? SOURCES[scheme]?.idField;
  if (!field) return { matches: [], why: `no source for scheme ${scheme}` };
  return { matches: features.filter((f) => f?.properties?.[field] === value), why: null };
}

/**
 * EVERY way we could look one area up, best first.
 *
 * 🔴 THE FIRST VERSION TOOK THE FIRST USABLE SCHEME AND GAVE UP ON IT.
 * Croatia's coverage fell to 50% and the guard said "the nomenclature
 * has probably moved under us". Half right, and I misread it twice:
 * first I blamed the six marine zones — HR801–HR806, the bura warnings
 * DHMZ issues for the Adriatic channels — and excluded them. Measured
 * against the actual geometry file, those six ARE in it and resolve
 * perfectly. The six that fail are the COUNTIES: the feed codes them
 * HR018, HR019, HR023, HR025, HR027, HR028 while MeteoAlarm's own
 * geocode file (2026-07-31) knows only HR001–HR008. EMMA_ID really has
 * moved for Croatia.
 *
 * But each of those counties also carries a NUTS3 code, and all six —
 * HR031 to HR036 — are in NUTS 2013. The data to place them was sitting
 * on the same area the whole time; we committed to one scheme before
 * knowing whether it would answer.
 *
 * So an area is resolvable when ANY of its schemes resolves. That is
 * also why `SOURCES` order matters: it is a preference, not a claim that
 * the first one works.
 */
/** One place, as one scheme names it — after the Irish splits. */
export function placeFor(scheme, value) {
  if (scheme === 'FIPS') {
    if (FIPS_SPLIT[value]) return { values: FIPS_SPLIT[value], split: value };
    if (FIPS_BY_ISO[value]) return { values: [FIPS_BY_ISO[value]], idField: 'iso_3166_2' };
  }
  return { values: [value] };
}

/**
 * Whether a set of matched features is ONE place.
 *
 * 🔴 ONE FEATURE IS NOT THE ONLY HONEST ANSWER. Waterford is in Natural
 * Earth twice — `EI32` and `EI41`, both carrying `IE-WD` — because the
 * county is mapped in two pieces. Refusing that as ambiguous loses a
 * real county; accepting any multiple would accept `EI32`, which also
 * sits on Cork. Several features are one place when they agree on the
 * ISO subdivision they belong to, and `EI32` fails that test because
 * Waterford says `IE-WD` and Cork says `IE-CO`.
 *
 * Sources without `iso_3166_2` (NUTS, EMMA_ID) cannot satisfy this, so
 * for them exactly one match remains the only answer.
 */
export function settles(matches) {
  if (matches.length === 1) return true;
  if (matches.length === 0) return false;
  const isos = new Set(matches.map((f) => f?.properties?.iso_3166_2 ?? null));
  return isos.size === 1 && !isos.has(null);
}

export function plans(codes) {
  const parsed = codes
    .map((c) => {
      const at = String(c).indexOf(':');
      return at === -1 ? null : { scheme: String(c).slice(0, at), value: String(c).slice(at + 1) };
    })
    .filter(Boolean);

  if (parsed.length === 0) return [{ scheme: null, places: [], why: 'the area carries no code' }];

  const usable = parsed.filter((p) => SOURCES[p.scheme]);
  if (usable.length === 0) {
    const schemes = [...new Set(parsed.map((p) => p.scheme))].join(', ');
    return [{ scheme: null, places: [], why: `no resolvable scheme among: ${schemes}` }];
  }

  // 🔴 ORDERED BY `SOURCES`, NOT BY THE FEED. The comment above claimed
  // this was a preference and it was not: `plans` returned whatever
  // order the source listed its geocodes in, and the test that said
  // otherwise passed only because its fixture happened to list EMMA_ID
  // first. The fixture was the answer.
  const order = Object.keys(SOURCES);
  const names = [...new Set(usable.map((p) => p.scheme))].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b),
  );

  return names.map((scheme) => ({
    scheme,
    places: usable.filter((p) => p.scheme === scheme).map((p) => placeFor(scheme, p.value)),
    why: null,
  }));
}

/** The preferred way to look one area up. Kept for callers wanting one. */
export const plan = (codes) => plans(codes)[0];


// ------------------------------------------------------- placing one area

/**
 * A CAP polygon string → a GeoJSON ring.
 *
 * 🔴 CAP WRITES `lat,lon`; GEOJSON WANTS `[lon, lat]`. Swapping them
 * silently puts an Estonian warning in the Indian Ocean — 58,25 is
 * Jarva county, 25,58 is open water off Somalia — and nothing throws,
 * because both readings are valid coordinates. The test below uses a
 * point whose two readings are on different continents, so a swap
 * cannot pass unnoticed.
 */
export function ringFrom(cap) {
  const ring = String(cap)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => {
      const [lat, lon] = pair.split(',').map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error(`"${pair}" is not a CAP lat,lon pair`);
      }
      if (lat < -90 || lat > 90) {
        throw new Error(`latitude ${lat} is out of range — are lat and lon swapped?`);
      }
      return [lon, lat];
    });
  if (ring.length < 4) throw new Error(`a ring needs at least four points, got ${ring.length}`);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  // 🔴 RFC 7946 §3.1.6 WANTS EXTERIOR RINGS COUNTER-CLOCKWISE, and the
  // source does not care: of the 67 rings Estonia, Slovenia and Sweden
  // send live, 43 run clockwise and 24 the other way. MapLibre and
  // Leaflet tolerate either; PostGIS geography and any winding-number
  // point-in-polygon read a clockwise exterior as the whole Earth MINUS
  // the county — a warning that applies everywhere except where it was
  // issued. Nothing consumes these yet, which is exactly why this is
  // the moment to normalise them rather than leave a trap.
  return isCounterClockwise(ring) ? ring : ring.reverse();
}

/** Twice the signed area of a ring in `[lon, lat]`; positive is CCW. */
export function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum;
}

export const isCounterClockwise = (ring) => signedArea(ring) > 0;

/**
 * A CAP circle string → a centre and a radius.
 *
 * 🔴 THE CIRCLE BRANCH VALIDATED NOTHING AND CONVERTED NOTHING. Review
 * measured `resolveArea({codes: [], circles: ['total nonsense']})`
 * returning `{by: 'circle', circles: ['total nonsense']}` with no throw,
 * while byte-identical rubbish on the POLYGON branch threw. Its only
 * test asserted `by === 'circle'` and nothing about the content, so it
 * was green for any input at all — and `--join` counted such an area as
 * successfully placed.
 *
 * Worse for the one thing this card is about: the `lat,lon` → `[lon,
 * lat]` conversion was applied to rings only, so a consumer reading both
 * the same way would put the circle in the Indian Ocean. CAP writes
 * `lat,lon radius` with the radius in kilometres.
 */
export function circleFrom(cap) {
  const [point, radius, ...rest] = String(cap).trim().split(/\s+/);
  if (rest.length > 0) throw new Error(`"${cap}" has more than a point and a radius`);
  const [lat, lon] = String(point ?? '').split(',').map(Number);
  const km = Number(radius);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(`"${point}" is not a CAP lat,lon pair`);
  }
  if (lat < -90 || lat > 90) throw new Error(`latitude ${lat} is out of range`);
  if (lon < -180 || lon > 180) throw new Error(`longitude ${lon} is out of range`);
  if (!Number.isFinite(km) || km < 0) throw new Error(`"${radius}" is not a radius in km`);
  return { centre: [lon, lat], radiusKm: km };
}

/**
 * Where one warning area is — or a loud failure.
 *
 * 🔴 CAMP-149: "fail LOUDLY on an unrecognised code, rather than quietly
 * dropping the warning. A silently lost ice warning is exactly the case
 * this card exists for." So a code we cannot resolve throws, naming the
 * code and the area; it does NOT quietly fall through to a shape.
 *
 * The shape is for areas carrying NO code at all — Estonia, Slovenia and
 * Sweden send 192, 8 and 22 such areas and not one geocode between them.
 * For those the polygon is the only thing there is.
 */
export function resolveArea(area, geometry) {
  const codes = area?.codes ?? [];
  const polygons = area?.polygons ?? [];
  const circles = area?.circles ?? [];
  const where = area?.name ? `"${area.name}"` : 'an unnamed area';

  if (codes.length > 0) {
    const candidates = plans(codes);
    if (candidates[0].scheme) {
      for (const c of candidates) {
        const found = c.places.map((pl) =>
          pl.values.flatMap((v) => lookup(geometry[c.scheme] ?? [], c.scheme, v, pl.idField).matches),
        );
        if (found.every(settles)) return { by: 'code', scheme: c.scheme, features: found.flat() };
      }
    }
    // ⚠️ "not in its source" and "we carry no source for that scheme" are
    // different problems with different fixes, and `plans()` already
    // says which. Throwing one message for both sent the reader looking
    // for a missing row in a file we never downloaded.
    const why = candidates[0].why ?? 'not one of them is in its source';
    throw new Error(
      `${where} carries ${codes.join(', ')} — ${why}; refusing to drop the warning silently`,
    );
  }

  if (polygons.length > 0) return { by: 'polygon', rings: polygons.map(ringFrom) };
  if (circles.length > 0) return { by: 'circle', circles: circles.map(circleFrom) };
  throw new Error(`${where} has neither a code nor a shape — there is no way to place it`);
}

/**
 * Places every area of every live warning, or dies naming the one it
 * could not place. This is CAMP-149's acceptance criterion end to end.
 */
async function join() {
  const { COUNTRIES, feedUrl, warningsFrom } = await import('./fetch-warnings.mjs');
  const geometry = {};
  for (const [scheme, src] of Object.entries(SOURCES)) {
    const doc = await cached(`${src.id}.json`, src.url);
    geometry[scheme] = doc.features ?? [];
  }
  const now = new Date();
  const tally = { code: 0, polygon: 0, circle: 0 };
  const byCountry = {};
  for (const country of COUNTRIES) {
    let payload;
    try {
      payload = await (await fetch(feedUrl(country))).json();
    } catch (err) {
      console.log(`  ${country.padEnd(12)} feed unreadable: ${String(err.message).slice(0, 40)}`);
      continue;
    }
    const { kept } = warningsFrom(payload, country, now);
    const seen = { code: 0, polygon: 0, circle: 0 };
    for (const w of kept) {
      for (const area of w.areas) {
        // 🔴 No try/catch. A warning we cannot place must stop the run,
        // which is the whole point of the card.
        const placed = resolveArea(area, geometry);
        seen[placed.by] += 1;
        tally[placed.by] += 1;
      }
    }
    if (kept.length) {
      byCountry[country] = seen;
      console.log(
        `  ${country.padEnd(12)} ${String(kept.length).padStart(4)} warnings  ` +
          `code ${String(seen.code).padStart(4)}  polygon ${String(seen.polygon).padStart(4)}  circle ${seen.circle}`,
      );
    }
  }
  console.log(`\nplaced by code ${tally.code}, by polygon ${tally.polygon}, by circle ${tally.circle}`);
  const shaped = Object.entries(byCountry).filter(([, v]) => v.polygon > 0).map(([c]) => c);
  console.log(`countries placed by shape: ${shaped.join(', ') || '(none)'}`);
  if (tally.code + tally.polygon + tally.circle === 0) {
    throw new Error('nothing was placed at all — that is a failure, not an empty Europe');
  }
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
  let uncoded = 0;
  for (const w of payload?.warnings ?? []) {
    for (const info of w.alert?.info ?? []) {
      for (const area of info.area ?? []) {
        const codes = (area.geocode ?? [])
          .filter((g) => g?.valueName && g?.value)
          .map((g) => `${g.valueName}:${g.value}`);
        // 🔴 AN AREA WITH NO CODE USED TO VANISH, which RAISED coverage:
        // four areas in, three uncoded, and the measure reported 1 of 1.
        // Losing the codes we need made the number look better.
        if (codes.length) out.add(codes.join('||'));
        else uncoded += 1;
      }
    }
  }
  return [...out, ...Array.from({ length: uncoded }, () => '')];
}

/** What fraction of a country's areas we can put on a map, and why not. */
export function coverageOf(areaCodes, geometry) {
  let resolved = 0;
  let total = 0;
  let uncoded = 0;
  const unresolved = new Map();
  const note = (why, n) => unresolved.set(why, (unresolved.get(why) ?? 0) + n);

  for (const joined of areaCodes) {
    const candidates = plans(joined ? joined.split('||') : []);
    if (!candidates[0].scheme) {
      // 🔴 AN AREA WITH NO CODE IS NOT A FAILED JOIN — and counting it
      // as one was my own over-correction. Review was right that
      // dropping these silently let a feed LOSING its codes look like
      // improving coverage; my first fix put them in the denominator
      // and took Latvia from 100% to 0.8%, Estonia, Slovenia and Sweden
      // to zero. Those countries send a polygon instead of a code: a
      // different way to place a warning, not a broken one.
      //
      // So they are counted and named, outside the ratio. A feed that
      // quietly stops carrying codes shows up as a number that moves,
      // and a country appearing in that list for the first time is news
      // — the same shape as the no-codes list, for the same reason.
      if (candidates[0].why === 'the area carries no code') uncoded += 1;
      else {
        total += 1;
        note(candidates[0].why, 1);
      }
      continue;
    }

    // 🔴 CODES OF ONE SCHEME ARE DIFFERENT PLACES; DIFFERENT SCHEMES ARE
    // THE SAME PLACES UNDER DIFFERENT NAMES. The first version joined
    // every code on an area with `||` and treated them all as
    // alternatives for one place. That is right for Croatia, whose
    // county carries a dead EMMA_ID beside a live NUTS3 — and wrong for
    // Ireland, which puts TWENTY-SIX counties in a single CAP `<area>`.
    // Review measured the consequence: Ireland reported 2/2 = 100%
    // where the counties themselves are 25/26, and
    // `FIPS:EI01||FIPS:ZZ99||FIPS:ZZ98` resolved completely — one live
    // code laundering any number of dead ones, ambiguity included.
    let best = null;
    for (const c of candidates) {
      const features = geometry[c.scheme] ?? [];
      let hit = 0;
      let ambiguous = 0;
      for (const place of c.places) {
        const found = place.values.map((v) => lookup(features, c.scheme, v, place.idField).matches);
        if (found.every(settles)) hit += 1;
        else if (found.some((m) => m.length > 1)) ambiguous += 1;
      }
      if (!best || hit > best.hit) best = { hit, ambiguous, size: c.places.length };
    }

    total += best.size;
    resolved += best.hit;
    const missed = best.size - best.hit;
    if (missed > 0) {
      const tried = candidates.map((c) => c.scheme).join('/');
      note(best.ambiguous > 0 ? 'ambiguous code' : `no source holds the code (tried ${tried})`, missed);
    }
  }

  return { total, resolved, uncoded, unresolved: [...unresolved.entries()] };
}

/**
 * Too little of the union measured to call the result a coverage figure.
 *
 * Seven member states carry no code by design, so the floor sits below
 * that: two thirds of the union must have been read AND coded.
 */
/**
 * A country that placed no code on anything it sent.
 *
 * 🔴 This used to be `codes.length === 0`, which stopped being true the
 * moment uncoded areas started being counted: a country sending 154
 * areas and no codes became a country measured at 0%, printing `NaN%`.
 * The test that would have caught it did not exist — a mutation back to
 * the old form stayed green.
 */
export const servesNoCode = (codes) => codes.every((c) => c === '');

export const tooFewMeasured = (measured, asked) => measured < Math.ceil((asked * 2) / 3);

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
  // Countries that code SOME of their areas. A name appearing here for
  // the first time means a feed started dropping codes.
  const partlyCoded = [];
  // 🔴 AND AN UNREADABLE FEED USED TO LAND IN NEITHER LIST. Review drove
  // 26 feeds throwing with only Poland answering: the run exited 0,
  // printed "0 countries returned no coded area: (none)" and declared
  // "every one of the 27 countries with codes resolved completely" —
  // because the count was `COUNTRIES.length - noCodes.length`, which
  // counts countries that were never successfully asked.
  const unreadable = [];
  for (const country of COUNTRIES) {
    let payload;
    try {
      payload = await (await fetch(feedUrl(country))).json();
    } catch (err) {
      console.log(`  ${country.padEnd(12)} feed unreadable: ${String(err.message).slice(0, 40)}`);
      unreadable.push(country);
      continue;
    }
    const codes = codesIn(payload);
    if (servesNoCode(codes)) {
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
    if (c.uncoded > 0) partlyCoded.push(`${country} ${c.uncoded}/${c.uncoded + c.total}`);
    const why = [
      ...c.unresolved.map(([k, n]) => `${n} ${k}`),
      ...(c.uncoded ? [`${c.uncoded} area(s) carry no code`] : []),
    ].join(', ');
    console.log(
      `  ${country.padEnd(12)} ${String(c.resolved).padStart(5)}/${String(c.total).padEnd(5)} ` +
        `${(pct * 100).toFixed(1).padStart(5)}%${why ? `   ${why}` : ''}`,
    );
  }

  // 🔴 Nothing to measure is a failure, not a pass. A run where every
  // feed was empty or every fetch failed would otherwise report perfect
  // coverage of nothing.
  const measured = COUNTRIES.length - noCodes.length - unreadable.length;
  console.log(
    `\n${noCodes.length} countries returned no coded area: ${noCodes.join(', ') || '(none)'}`,
  );
  if (unreadable.length) {
    console.log(`${unreadable.length} feeds were unreadable: ${unreadable.join(', ')}`);
  }
  console.log(`partly coded: ${partlyCoded.join(', ') || '(none)'}`);

  if (anyAreas === 0) throw new Error('no country returned a single coded area — that is a fetch failure');
  // A measure of one country in 27 is not a measure of Europe, and the
  // threshold below would pass it without this.
  if (tooFewMeasured(measured, COUNTRIES.length)) {
    throw new Error(
      `only ${measured} of ${COUNTRIES.length} countries were measured ` +
        `(${unreadable.length} unreadable, ${noCodes.length} with no codes) — ` +
        'that is not a measurement of Europe',
    );
  }
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

  ok('a plain EMMA_ID resolves to itself', plan(['EMMA_ID:PL803']).places[0].values[0] === 'PL803');

  const de = plan(['WARNCELLID:109176000', 'EMMA_ID:DE303']);
  ok('a German area is resolved by its EMMA_ID, not its WARNCELLID',
    de.scheme === 'EMMA_ID' && de.places[0].values[0] === 'DE303', JSON.stringify(de));
  ok('...whichever order the source lists them in',
    plan(['EMMA_ID:DE303', 'WARNCELLID:109176000']).scheme === 'EMMA_ID');
  ok('...and the same for Czechia CISORP',
    plan(['CISORP:5102', 'EMMA_ID:CZ05102']).scheme === 'EMMA_ID');

  ok('NUTS3 is kept as NUTS3', plan(['NUTS3:FR712']).scheme === 'NUTS3');
  // 🔴 The preference is `SOURCES` order, NOT the order the feed lists
  // its geocodes in. The old test for this passed only because its
  // fixture happened to put the expected scheme first.
  ok('the preferred scheme wins however the feed orders them',
    plan(['NUTS3:HR031', 'EMMA_ID:HR018']).scheme === 'EMMA_ID',
    plans(['NUTS3:HR031', 'EMMA_ID:HR018']).map((c) => c.scheme).join());
  ok('…and both are still offered, preferred first',
    plans(['NUTS3:HR031', 'EMMA_ID:HR018']).map((c) => c.scheme).join() === 'EMMA_ID,NUTS3');
  ok('NUTS2 is a different source from NUTS3',
    SOURCES.NUTS2.url !== SOURCES.NUTS3.url && /LEVL_2/.test(SOURCES.NUTS2.url));
  ok('the NUTS source is pinned to the 2013 vintage',
    /_2013_/.test(SOURCES.NUTS3.url) && /_2013_/.test(SOURCES.NUTS2.url), SOURCES.NUTS3.url);

  ok('Dublin legacy code expands to the four counties it became',
    plan(['FIPS:EI07']).places[0].values.join(',') === 'EI33,EI34,EI35,EI39');
  ok('...Tipperary to its two ridings', plan(['FIPS:EI26']).places[0].values.join(',') === 'EI38,EI40');
  ok('...and Monaghan is matched by ISO, because its fips field is empty',
    plan(['FIPS:EI22']).places[0].idField === 'iso_3166_2');
  // 🔴 EI27 was listed as a split onto EI32, which sits on Cork as well
  // as Waterford. It is one county in two pieces, taken by ISO.
  ok('...and Waterford too, because EI32 is also Cork',
    plan(['FIPS:EI27']).places[0].idField === 'iso_3166_2'
      && plan(['FIPS:EI27']).places[0].values.join(',') === 'IE-WD');
  ok('an ordinary Irish county is not expanded', plan(['FIPS:EI06']).places[0].values.join(',') === 'EI06');

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

  // 🔴 Croatia, measured: the feed's EMMA_ID (HR018) is not in
  // MeteoAlarm's own geocode file, which knows HR001–HR008; the NUTS3
  // on the SAME area (HR031) is in NUTS 2013. One dead code must not
  // condemn an area that carries a live one.
  {
    const geom = {
      EMMA_ID: [{ properties: { code: 'HR001' } }],
      NUTS3: [{ properties: { NUTS_ID: 'HR031' } }],
    };
    ok('both schemes are offered, not just the first',
      plans(['EMMA_ID:HR018', 'NUTS3:HR031']).map((p) => p.scheme).join() === 'EMMA_ID,NUTS3');
    ok('…and `plan` still answers with the preferred one',
      plan(['EMMA_ID:HR018', 'NUTS3:HR031']).scheme === 'EMMA_ID');
    const rescued = coverageOf(['EMMA_ID:HR018||NUTS3:HR031'], geom);
    ok('a dead EMMA_ID beside a live NUTS3 still resolves', rescued.resolved === 1 && rescued.total === 1);
    const firstWorks = coverageOf(['EMMA_ID:HR001||NUTS3:HR999'], geom);
    ok('…and the preferred scheme answering is enough on its own', firstWorks.resolved === 1);
    const bothDead = coverageOf(['EMMA_ID:HR018||NUTS3:HR999'], geom);
    ok('…while two dead codes are a failure', bothDead.resolved === 0);
    ok('…that names every scheme it tried',
      bothDead.unresolved[0][0] === 'no source holds the code (tried EMMA_ID/NUTS3)',
      bothDead.unresolved[0][0]);
    const marineStillCounts = coverageOf(['EMMA_ID:HR001'], geom);
    ok('a sea zone that IS in the source resolves like anything else', marineStillCounts.resolved === 1);
  }

  // 🔴 IRELAND PUTS 26 COUNTIES IN ONE CAP `<area>` (measured on the
  // live feed today). One live code must not launder the dead ones.
  {
    const geom = { FIPS: [{ properties: { fips: 'EI01', iso_3166_2: 'IE-CW' } }] };
    const one = coverageOf(['FIPS:EI01'], geom);
    ok('one county, one place', one.total === 1 && one.resolved === 1);
    const laundered = coverageOf(['FIPS:EI01||FIPS:ZZ99||FIPS:ZZ98'], geom);
    ok('three codes of ONE scheme are three places, not three names for one',
      laundered.total === 3, JSON.stringify(laundered));
    ok('…so a live code cannot carry two dead ones', laundered.resolved === 1);
    ok('…and the two misses are reported', laundered.unresolved[0][1] === 2);
  }

  // 🔴 Two codes of DIFFERENT schemes remain two names for one place —
  // the Croatian case that this rule must not break.
  {
    const geom = {
      EMMA_ID: [{ properties: { code: 'HR001' } }],
      NUTS3: [{ properties: { NUTS_ID: 'HR031' } }],
    };
    const c = coverageOf(['EMMA_ID:HR018||NUTS3:HR031'], geom);
    ok('a dead EMMA_ID beside a live NUTS3 is still one place, resolved',
      c.total === 1 && c.resolved === 1, JSON.stringify(c));
  }

  // 🔴 Waterford is in the source twice under one ISO; Cork shares its
  // fips. The first is one place, the second is a wrong answer.
  {
    const waterford = [
      { properties: { fips: 'EI32', iso_3166_2: 'IE-WD' } },
      { properties: { fips: 'EI41', iso_3166_2: 'IE-WD' } },
    ];
    ok('two features of one ISO subdivision are one place', settles(waterford));
    ok('…but two different subdivisions are not',
      !settles([{ properties: { fips: 'EI32', iso_3166_2: 'IE-WD' } },
                { properties: { fips: 'EI32', iso_3166_2: 'IE-CO' } }]));
    ok('…and features with no ISO at all need exactly one',
      !settles([{ properties: { code: 'A' } }, { properties: { code: 'A' } }]));
    const geom = { FIPS: [...waterford, { properties: { fips: 'EI32', iso_3166_2: 'IE-CO' } }] };
    const amb = coverageOf(['FIPS:EI32'], geom);
    ok('a code on two different counties is ambiguous, not missing',
      amb.resolved === 0 && amb.unresolved[0][0] === 'ambiguous code', JSON.stringify(amb.unresolved));
    const byIso = coverageOf(['FIPS:EI27'], geom);
    ok('…while EI27 resolves to Waterford by ISO, both pieces', byIso.resolved === 1);
  }

  // 🔴 Losing the codes we need used to RAISE the measure.
  {
    const payload = { warnings: [{ alert: { info: [{ area: [
      { areaDesc: 'A', geocode: [{ valueName: 'FIPS', value: 'EI01' }] },
      { areaDesc: 'B', geocode: [] },
      { areaDesc: 'C' },
    ] }] } }] };
    const codes = codesIn(payload);
    ok('an area with no code still counts', codes.length === 3, JSON.stringify(codes));
    const geom = { FIPS: [{ properties: { fips: 'EI01', iso_3166_2: 'IE-CW' } }] };
    const c = coverageOf(codes, geom);
    ok('…counted outside the ratio, not as a failed join',
      c.total === 1 && c.resolved === 1 && c.uncoded === 2, JSON.stringify(c));
    ok('…so a country that sends polygons is not reported as broken',
      c.resolved / c.total === 1);
    ok('…but the number is there to be watched', c.uncoded === 2);
    const allCoded = coverageOf(['FIPS:EI01'], geom);
    ok('…and a fully coded country reports none', allCoded.uncoded === 0);
  }

  // 🔴 Estonia sends 154 areas and codes none of them. That is "no
  // coded area", not "0% coverage".
  {
    ok('a country that sent nothing serves no code', servesNoCode([]));
    ok('…and one whose every area is uncoded does too', servesNoCode(['', '', '']));
    ok('…but one coded area among many is not nothing', !servesNoCode(['FIPS:EI01', '', '']));
    ok('…nor is a fully coded country', !servesNoCode(['FIPS:EI01']));
  }

  // 🔴 CAP says lat,lon. GeoJSON says [lon, lat].
  {
    const estonia = '58.6791,25.7338 58.6831,25.7703 58.7729,25.8801 58.6791,25.7338';
    const ring = ringFrom(estonia);
    ok('a ring comes back as [lon, lat], not [lat, lon]',
      ring[0][0] === 25.7338 && ring[0][1] === 58.6791, JSON.stringify(ring[0]));
    // 58,25 is Jarva county; 25,58 is open water in the Indian Ocean.
    // Both are valid coordinates, so only this check separates them.
    ok('…so the first point is in Estonia, not off Somalia',
      ring[0][1] > 50 && ring[0][0] < 40);
    ok('…every point is converted, not just the first',
      ring.every(([lon, lat]) => lat > 50 && lon < 40), JSON.stringify(ring));
    ok('a ring that already closes is not closed twice', ring.length === 4, String(ring.length));
    const open = ringFrom('58.1,25.1 58.2,25.2 58.3,25.3 58.4,25.4');
    ok('…and one that does not close is closed', open.length === 5
      && open[0][0] === open[4][0] && open[0][1] === open[4][1]);
    const threw = (f) => { try { f(); return false; } catch { return true; } };
    ok('three points are not a ring', threw(() => ringFrom('58.1,25.1 58.2,25.2 58.3,25.3')));
    // ⚠️ The range check catches a swap only when the longitude is past
    // 90 — Vladivostok at 43,132 swaps to an impossible latitude of 132.
    // It does NOT catch a European swap: Jarva county's 58,25 swaps to
    // 25,58 and both are legal latitudes. That is why the order test
    // above is the real guard and this one is only a backstop.
    ok('a latitude past 90 is refused, which is one kind of swap',
      threw(() => ringFrom('132.1,43.1 132.2,43.2 132.3,43.3 132.1,43.1')));
    ok('…while a European swap passes this check, which is why order is tested',
      !threw(() => ringFrom('25.7,58.6 25.8,58.7 25.9,58.8 25.7,58.6')));
    ok('rubbish is refused', threw(() => ringFrom('x,y a,b c,d e,f')));
  }

  // 🔴 The circle branch used to accept literally anything.
  {
    const threw = (f) => { try { f(); return false; } catch { return true; } };
    const c = circleFrom('58.6791,25.7338 12.5');
    ok('a circle centre comes back as [lon, lat], like a ring',
      c.centre[0] === 25.7338 && c.centre[1] === 58.6791, JSON.stringify(c.centre));
    ok('…and the radius is kilometres', c.radiusKm === 12.5);
    ok('rubbish is refused, as it already was for a polygon',
      threw(() => circleFrom('total nonsense')));
    ok('…a latitude of 999 is refused', threw(() => circleFrom('999,999 10')));
    ok('…a missing radius is refused', threw(() => circleFrom('58.6,25.7')));
    ok('…a negative radius is refused', threw(() => circleFrom('58.6,25.7 -1')));
    ok('…and a third field is refused', threw(() => circleFrom('58.6,25.7 10 extra')));
    const placed = resolveArea({ name: 'X', codes: [], circles: ['58.6,25.7 10'] }, {});
    ok('a placed circle is converted, not passed through raw',
      placed.circles[0].centre[0] === 25.7 && placed.circles[0].radiusKm === 10,
      JSON.stringify(placed.circles[0]));
    ok('…and an area whose circle is rubbish throws rather than being "placed"',
      threw(() => resolveArea({ name: 'X', codes: [], circles: ['nonsense'] }, {})));
  }

  // 🔴 RFC 7946 wants exterior rings counter-clockwise; the source sends
  // 43 clockwise and 24 counter-clockwise.
  {
    // A unit square written clockwise in [lon, lat].
    const cw = '0,0 1,0 1,1 0,1 0,0';
    const ccw = '0,0 0,1 1,1 1,0 0,0';
    ok('a clockwise ring is turned around', isCounterClockwise(ringFrom(cw)), JSON.stringify(ringFrom(cw)));
    ok('…and one already counter-clockwise is left alone', isCounterClockwise(ringFrom(ccw)));
    ok('…both describe the same corners', 
      new Set(ringFrom(cw).map(String)).size === new Set(ringFrom(ccw).map(String)).size);
    ok('the signed area of a square is its area, twice, with a sign',
      signedArea([[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]) === -2
        || signedArea([[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]) === 2,
      String(signedArea([[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]])));
    ok('…and it is zero for a degenerate ring', signedArea([[0, 0], [1, 1], [0, 0]]) === 0);
  }

  // 🔴 An unresolvable code must THROW, not quietly become a shape.
  {
    const geom = { NUTS3: [{ properties: { NUTS_ID: 'HR031' } }] };
    const threw = (f) => { try { f(); return false; } catch { return true; } };
    const byCode = resolveArea({ name: 'Primorsko-goranska', codes: ['NUTS3:HR031'] }, geom);
    ok('an area with a live code is placed by the code', byCode.by === 'code' && byCode.features.length === 1);
    ok('a dead code throws, naming the area',
      threw(() => resolveArea({ name: 'Nowhere', codes: ['NUTS3:ZZ999'] }, geom)));
    ok('…and it STILL throws when a shape is sitting right there',
      threw(() => resolveArea(
        { name: 'Nowhere', codes: ['NUTS3:ZZ999'], polygons: ['58.1,25.1 58.2,25.2 58.3,25.3 58.1,25.1'] },
        geom,
      )));
    const byShape = resolveArea(
      { name: 'Jarva county', codes: [], polygons: ['58.1,25.1 58.2,25.2 58.3,25.3 58.1,25.1'] },
      geom,
    );
    ok('an area with NO code is placed by its polygon', byShape.by === 'polygon' && byShape.rings.length === 1);
    ok('…a circle serves when there is no polygon either',
      resolveArea({ name: 'X', codes: [], circles: ['58.1,25.1 10'] }, geom).by === 'circle');
    ok('…and an area with neither throws rather than vanishing',
      threw(() => resolveArea({ name: 'X', codes: [] }, geom)));
  }

  // 🔴 One country in 27 is not a measurement of Europe.
  {
    ok('twenty measured of 27 is enough', !tooFewMeasured(20, 27));
    ok('…eighteen is the floor and still passes', !tooFewMeasured(18, 27));
    ok('…seventeen is not', tooFewMeasured(17, 27));
    ok('…and one country answering is certainly not', tooFewMeasured(1, 27));
  }

  ok('every source has a url and an id field',
    Object.values(SOURCES).every((s) => s.url && s.idField && s.id));

  console.log(bad ? `\nx ${bad} self-test failure(s)` : `\nself-test passed`);
  return bad;
}

import { pathToFileURL } from 'node:url';
const RUN_DIRECTLY =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

// 🔴 `--self-test=1` used to miss a bare `includes` and fall through
// into a live run. The same defect was measured and fixed in
// fetch-warnings.mjs; it was here too.
const KNOWN_FLAGS = ['self-test', 'coverage', 'join'];
const hasFlag = (argv, name) =>
  argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));

if (RUN_DIRECTLY) {
  const unknown = process.argv
    .slice(2)
    .filter((a) => !KNOWN_FLAGS.some((k) => a === `--${k}` || a.startsWith(`--${k}=`)));
  if (unknown.length) throw new Error(`unknown argument(s): ${unknown.join(', ')}`);
  if (hasFlag(process.argv, 'self-test')) process.exit(selfTest() ? 1 : 0);
  if (hasFlag(process.argv, 'coverage')) await coverage();
  if (hasFlag(process.argv, 'join')) await join();
}
