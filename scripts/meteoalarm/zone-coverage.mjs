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

import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';
import { warningsFrom } from './fetch-warnings.mjs';
import { BINDABLE } from './nuts-binding.mjs';
import { HR_COUNTIES, HR_COUNTIES_URL, HR_HEADERS, hrCountiesFeatures } from './osm-hr-counties.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Which geocode scheme each member state's campsites are matched on.
 *
 * 🔴 THIS USED TO BE "WHAT THE FEED PUBLISHES AND WE CAN RESOLVE", AND IT IS
 * NOT ANY MORE. Until 02.11.2026 France was joined on `NUTS3` because that
 * is what its feed publishes, against GISCO polygons whose licence forbids
 * commercial use. Now France, Bulgaria, Romania, Hungary and Belgium are
 * joined on `EMMA_ID` — MeteoAlarm's own zones — while their feeds still
 * publish NUTS. That is only sound because `fetch-warnings.mjs` adds the
 * zone's `EMMA_ID` to every NUTS-coded area it keeps (`nuts-binding.mjs`,
 * by name). The self-test below ties the two: a country may be joined on a
 * scheme its feed does not publish ONLY if the binder has a zone table for
 * it, and the SQL test reads the codes the real `warningsFrom` emits.
 *
 * Croatia keeps `NUTS3`, from OpenStreetMap's county relations: its zone
 * list has no counties at all (see `osm-hr-counties.mjs`).
 *
 * 🔴 Czechia publishes `CISORP` and Germany `WARNCELLID`, and neither is
 * here, because no geometry source exists for either — Germany's feed also
 * publishes `EMMA_ID`, so German campsites are placed anyway.
 *
 * 🔴 LATVIA IS HERE AND IS NOT WHOLE. The census prints it on its own
 * line — `partly coded: latvia 32/204` — so 172 of its 204 areas carry
 * no code at all. This map lists `LV` beside countries that code
 * everything, and that flattening is deliberate but lossy: a Latvian
 * campsite can be placed, and the warning that reaches it still may not
 * be. The matcher's `unlocatable` is what catches the rest.
 */
export const SCHEMES_USED = Object.freeze({
  AT: ['EMMA_ID'], BE: ['EMMA_ID'], BG: ['EMMA_ID'], CZ: ['EMMA_ID'],
  DE: ['EMMA_ID'], DK: ['EMMA_ID'], ES: ['EMMA_ID'], FI: ['EMMA_ID'],
  FR: ['EMMA_ID'], GR: ['EMMA_ID'], HR: ['EMMA_ID', 'NUTS3'], HU: ['EMMA_ID'],
  IE: ['EMMA_ID'], IT: ['EMMA_ID'], LT: ['EMMA_ID'], LV: ['EMMA_ID'],
  NL: ['EMMA_ID'], PL: ['EMMA_ID'], PT: ['EMMA_ID'], RO: ['EMMA_ID'],
});

/**
 * Member states whose feeds carry no geocode on any area at all.
 *
 * 🔴 DATA, NOT A SENTENCE IN A COMMENT. Together with `SCHEMES_USED`
 * this must be exactly the EU-27, and the self-test checks that against
 * `eu-member-states.json` — the file `check-eu-scope.mjs` and
 * `drop-non-eu.mjs` already read. That cross-check is the only thing
 * here with a corpus I did not write myself, and it is what catches a
 * country silently spelled the other way: `EL` for Greece is absent
 * from that file, so the swap fails loudly instead of dropping 596
 * campsites without a word.
 */
export const SILENT = Object.freeze(['CY', 'EE', 'LU', 'MT', 'SE', 'SI', 'SK']);

/**
 * The census output, quoted: what each country's feed PUBLISHES.
 *
 * 🔴 ДВА ЛІТЕРАЛИ ГІРШІ ЗА ОДИН, АЛЕ КРАЩІ ЗА ЖОДНОГО. Рецензія
 * заміряла, що 21 пара країна-схема з 22 не захищена нічим. Це —
 * дослівні рядки `fetch-warnings.mjs --census` від 13.10.2026: не моє
 * тлумачення, а цитата виводу, яку можна переперевірити однією командою.
 *
 * 🔴 ЦЕ БІЛЬШЕ НЕ ТЕ САМЕ, ЩО `SCHEMES_USED`, І ТАК МАЄ БУТИ. До
 * 02.11.2026 мапа інвертувалась у перепис рівно. Тепер п'ять країн, чиї
 * фіди публікують NUTS, зіставляються за EMMA_ID — бо кемпінг несе зону
 * MeteoAlarm, а не NUTS (ліцензія GISCO забороняє комерційне
 * використання). Самотест вимагає: пара `(країна, EMMA_ID)` без EMMA у
 * переписі допустима лише для країни, чий NUTS фід публікує І для якої
 * `nuts-binding.mjs` має таблицю зон.
 *
 * Тут немає `WARNCELLID` і `CISORP`: вони в переписі є, але геометрії
 * для них не існує. `FIPS` виключений за ціною — 8 входжень на 40.7 МБ.
 */
export const CENSUS_2026_10_13 = Object.freeze({
  EMMA_ID: ['AT', 'BE', 'HR', 'CZ', 'DK', 'FI', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'NL', 'PL', 'PT', 'ES'],
  NUTS3: ['BG', 'HR', 'FR', 'RO'],
  NUTS2: ['BE', 'HU'],
});

/**
 * The two sources that earn their download.
 *
 * 🔴 `NUTS3` HERE IS CROATIA'S COUNTIES FROM OPENSTREETMAP, not GISCO — the
 * key is the scheme the feed publishes (`NUTS3:HR031`), the source is what
 * draws it. `NUTS2` is gone: Belgium and Hungary are joined on EMMA_ID.
 *
 * 🔴 `file` IS THE CACHE NAME AND IT IS NOT `NUTS3.json` ON PURPOSE. A
 * server that ran the old resolver has the GISCO polygons cached under
 * exactly that name, and `existsSync` would have fed them to this source
 * as Croatia's counties, silently, forever.
 */
export const USED_SOURCES = Object.freeze({
  EMMA_ID: {
    url: 'https://gitlab.com/meteoalarm-pm-group/documents/-/raw/master/MeteoAlarm_Geocodes_2026_07_31.json',
    idField: 'code',
    zones: 2006,
    file: 'EMMA_ID.json',
  },
  NUTS3: {
    url: HR_COUNTIES_URL,
    headers: HR_HEADERS,
    // Nominatim's answer → features keyed by NUTS code, minus the counties
    // OSM no longer vouches for (named in `rejected`, never the whole run).
    select: hrCountiesFeatures,
    idField: 'NUTS_ID',
    zones: Object.keys(HR_COUNTIES).length,
    file: 'osm-hr-counties.json',
  },
});

/**
 * Cache files an earlier version of the resolver wrote and this one must
 * not leave lying about: they hold EuroGeographics GISCO polygons, whose
 * licence forbids commercial use. Removed on every run.
 */
export const OBSOLETE_CACHE = Object.freeze(['NUTS3.json', 'NUTS2.json']);

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

/**
 * Найменше, що ще є роботою, а не поломкою.
 *
 * 🔴 ПІДЛОГИ НЕ БУЛО, І ЦЕ ЗНАЙШЛА РЕЦЕНЗІЯ. `verdict` віддавав `ok` на
 * 1 кемпінгу з 57 082 — тобто на 0.0% — і падав лише на рівно нулі.
 * Разом із тим, що звіт не читав колонки, це означало: мутація, яка
 * стирає колонку начисто, друкує успіх.
 *
 * Числа — зріз 13.10.2026: 52 907 із 57 082 = 92.7%. Підлога нижча за
 * нього з запасом, бо джерела й дані рухаються; вона ловить катастрофу,
 * а не коливання.
 */
export const FLOOR_SHARE = 80;
export const FLOOR_TOTAL = 40_000;

/** The verdict: a share, and the countries that carry the shortfall. */
export function verdict(total, placed, perCountry) {
  if (total === 0) {
    return { ok: false, why: 'no live campsites were read at all' };
  }
  if (total < FLOOR_TOTAL) {
    return { ok: false, why: `only ${total} live campsites were read, under the ${FLOOR_TOTAL} floor — the denominator collapsed` };
  }
  const share = Math.round((1000 * placed) / total) / 10;
  if (share < FLOOR_SHARE) {
    return { ok: false, why: `only ${share}% could be placed, under the ${FLOOR_SHARE}% floor — measured 92.7% on 13.10.2026` };
  }
  const short = perCountry
    .filter((c) => c.missing > 0)
    .sort((a, b) => b.missing - a.missing);
  return { ok: true, share, short };
}

/**
 * What the six countries that used to ride on GISCO got from it, on the
 * SAME 57 128 live campsites this resolver now reads (a copy of the dev
 * database, 02.11.2026), by running the previous resolver unchanged.
 * `[total, placed]`: placed = has at least one zone code.
 *
 * Kept so the run can print the loss next to the figure, and so a reader
 * of a red run sees what "before" was without a git archaeology.
 */
export const BEFORE_GISCO = Object.freeze({
  BE: [748, 748],
  BG: [275, 266],
  FR: [21759, 21669],
  HR: [642, 639],
  HU: [615, 615],
  RO: [567, 557],
});

/**
 * 🔴 THE FLOOR PER COUNTRY, because the global one cannot see these.
 *
 * Croatia is 642 of 57 128 campsites. Losing every one of them moves the
 * global share from 91.8% to 90.7% — over its 80% floor, no word printed —
 * while a whole country has no warnings. The six below are the ones whose
 * join changed on 02.11.2026, so they are the ones that can lose
 * campsites without anyone noticing.
 *
 * Percent of live campsites with at least one zone code, from the run
 * after GISCO was removed (02.11.2026), less about one point so that
 * ordinary drift of the import does not trip them:
 *
 *             before (GISCO)   after        floor
 *   BE         748/748 100.0%  738/748 98.7%   97.5
 *   BG         266/275  96.7%  247/275 89.8%   88.5
 *   FR      21 669/21 759 99.6%  21 217/21 759 97.5%   96.5
 *   HR         639/642  99.5%  638/642 99.4%   98.5
 *   HU         615/615 100.0%  612/615 99.5%   98.5
 *   RO         557/567  98.2%  556/567 98.1%   97.0
 *
 * These are a cost, not a pass: France lost 452 campsites net (502 had a
 * zone before and none now, 50 the other way), 429 of the 502 within a
 * kilometre of a MeteoAlarm polygon — its zones are coarser at the coast
 * than GISCO's. Whether to pull a campsite to the nearest zone within a
 * distance is a decision for the owner and is not made here.
 */
export const COUNTRY_FLOORS = Object.freeze({ BE: 97.5, BG: 88.5, FR: 96.5, HR: 98.5, HU: 98.5, RO: 97.0 });

/** Every country under its own floor, named, or ok. */
export function floorsVerdict(perCountry, floors = COUNTRY_FLOORS, before = BEFORE_GISCO) {
  const rows = new Map(perCountry.map((r) => [r.country, r]));
  const under = [];
  const table = [];
  for (const [country, floor] of Object.entries(floors)) {
    const row = rows.get(country);
    if (!row || !(row.total > 0)) {
      under.push(`${country}: no campsites were read at all`);
      continue;
    }
    const placed = row.total - row.missing;
    const share = Math.round((1000 * placed) / row.total) / 10;
    const was = before[country];
    table.push({
      country,
      total: row.total,
      placed,
      share,
      floor,
      was: was ? { total: was[0], placed: was[1], share: Math.round((1000 * was[1]) / was[0]) / 10 } : null,
    });
    if (share < floor) {
      under.push(
        `${country}: ${placed} of ${row.total} (${share}%) are placed, under its ${floor}% floor` +
          (was ? ` — GISCO gave ${was[1]} of ${was[0]}` : ''),
      );
    }
  }
  return under.length ? { ok: false, why: under.join('; '), table } : { ok: true, table };
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
  check(pairs.length === 21, `the map yields 21 (country, scheme) pairs, got ${pairs.length}`);
  // 🔴 Стабільний порядок: інакше диф мапи шумить, а мутація
  // «прибрати `.sort()`» непомітна.
  check(
    pairs[0][0] === 'AT' && pairs[0][1] === 'EMMA_ID',
    `the pairs come out in a settled order, first is ${pairs[0].join(':')}`,
  );
  // 🔴 ПЕРЕВІРЯЄМО ФУНКЦІЮ, А НЕ ПОТОЧНІ ДАНІ. `SCHEMES_USED` записана
  // за абеткою, тож на ній `.sort()` — порожня дія, і мутація «прибрати
  // сортування» переживала прогін. `usesPairs` бере набір аргументом
  // саме для цього: даємо навмисно переплутаний і вимагаємо порядку.
  check(
    usesPairs({ SE: ['NUTS2'], AT: ['EMMA_ID'], DE: ['EMMA_ID'] })
      .map(([c]) => c)
      .join(',') === 'AT,DE,SE',
    'an unsorted input still comes out in a settled order',
  );

  // 🔴 КОЖНА ПАРА (КРАЇНА, СХЕМА) МУСИТЬ БУТИ ОБҐРУНТОВАНА. Раніше мапа
  // інвертувалась у перепис рівно; тепер п'ять країн зіставляються за
  // схемою, якої їхній фід не публікує, і це чесно лише доти, доки
  // `nuts-binding.mjs` справді дописує зону до їхніх NUTS-областей.
  const nutsCountries = new Set(Object.keys(HR_COUNTIES).map((k) => k.slice(0, 2)));
  {
    const published = (c, s) => (CENSUS_2026_10_13[s] ?? []).includes(c);
    const publishesNuts = (c) => published(c, 'NUTS2') || published(c, 'NUTS3');
    const unsound = pairs.filter(
      ([c, s]) => !(published(c, s) || (s === 'EMMA_ID' && publishesNuts(c) && BINDABLE.includes(c))),
    );
    check(
      unsound.length === 0,
      `🔴 every pair is published by the country's feed, or is an EMMA_ID tied to its NUTS by name — unsound: ${unsound.map((x) => x.join(':')).join(', ')}`,
    );
    check(
      BINDABLE.every((c) => SCHEMES_USED[c]?.includes('EMMA_ID')),
      '🔴 every country whose NUTS is tied to a zone is joined on EMMA_ID — otherwise the codes the warnings gain match nothing',
    );
    // Geometry exists for every pair: EMMA zones for any country, and
    // NUTS3 only for the countries whose counties we actually draw.
    const bare = pairs.filter(([c, s]) => !(s === 'EMMA_ID' || (s === 'NUTS3' && nutsCountries.has(c))));
    check(bare.length === 0, `🔴 every pair has geometry behind it — none for: ${bare.map((x) => x.join(':')).join(', ')}`);
    // A country that publishes NUTS and is neither tied by name nor drawn
    // by OSM is a country whose warnings place nowhere.
    const stranded = [...new Set([...(CENSUS_2026_10_13.NUTS2 ?? []), ...(CENSUS_2026_10_13.NUTS3 ?? [])])].filter(
      (c) => !BINDABLE.includes(c) && !nutsCountries.has(c),
    );
    check(stranded.length === 0, `no country publishes NUTS with nothing to place it — stranded: ${stranded.join(', ')}`);
  }

  // 🔴 КІНЕЦЬ У КІНЕЦЬ, НА ЖИВИХ КОДАХ. Кемпінг, що стоїть у зоні, яку
  // називає географія, мусить нести код, який ВИДАЄ `warningsFrom` для
  // попередження про цей NUTS. Корпус — 88 кодів із живих фідів 02.11.2026
  // з відповіддю з накладання полігонів, а не з імен.
  {
    const corpus = JSON.parse(readFileSync(path.join(here, 'nuts-live-corpus.json'), 'utf8')).entries;
    const now = new Date('2026-11-02T12:00:00Z');
    const unmatched = corpus.filter((e) => {
      const country = e.code.slice(0, 2);
      const infos = e.names.map((name, i) => ({
        language: i === 0 ? 'en-GB' : `x${i}`,
        event: 'Wind',
        headline: 'Wind warning',
        expires: '2026-11-03T00:00:00Z',
        parameter: [
          { valueName: 'awareness_level', value: '3; orange; Severe' },
          { valueName: 'awareness_type', value: '1; Wind' },
        ],
        area: [{ areaDesc: name, geocode: [{ valueName: e.scheme, value: e.code }] }],
      }));
      const out = warningsFrom({ warnings: [{ alert: { identifier: 'T', info: infos } }] }, 'x', now);
      const warned = new Set((out.kept[0]?.areas ?? []).flatMap((a) => a.codes).map((c) => c.toLowerCase()));
      const spot = (SCHEMES_USED[country] ?? []).map((sch) => `${sch}:${e.zone}`.toLowerCase());
      return !spot.some((c) => warned.has(c));
    });
    check(
      unmatched.length === 0,
      `🔴 a campsite in the zone geography names holds a code the warning carries: ${corpus.length - unmatched.length} of ${corpus.length} live NUTS codes — unmatched: ${unmatched.map((e) => e.code).join(',')}`,
    );
  }
  for (const silent of SILENT) {
    check(
      !(silent in SCHEMES_USED),
      `${silent} publishes no geocode at all and must not be claimed as matchable`,
    );
  }

  // 🔴 ЄДИНИЙ КОРПУС ТУТ, ЯКОГО НЕ ПИСАВ Я САМ.
  //
  // Усе інше в цьому файлі — мій літерал, і тести звіряють його сам із
  // собою. Рецензія заміряла ціну: 21 пара країна-схема з 22 не була
  // захищена нічим, і серед мутацій, що пережили прогін, була
  // `GR:` → `EL:` — Греція під написанням, якого ISO не знає. Вона
  // забрала б 596 кемпінгів мовчки.
  //
  // `eu-member-states.json` — це область проєкту (CAMP-118), те саме
  // джерело, що читають `check-eu-scope.mjs` і `drop-non-eu.mjs`. Разом
  // ці два списки мусять бути РІВНО ним.
  {
    const raw = readFileSync(
      path.join(here, '..', '..', 'apps', 'api', 'src', 'osm', 'eu-member-states.json'),
      'utf8',
    );
    const members = JSON.parse(raw).members;
    check(Object.keys(members).length === 27, 'the scope file holds 27 member states');

    const scope = new Set(Object.keys(members).map((c) => c.toUpperCase()));
    const claimed = [...Object.keys(SCHEMES_USED), ...SILENT].sort();
    check(new Set(claimed).size === claimed.length, 'no country is both coded and silent');
    check(claimed.length === 27, `the two lists together are 27 countries, got ${claimed.length}`);
    check(
      claimed.filter((c) => !scope.has(c)).join(',') === '',
      `every country named here is in the scope file — stray: ${claimed.filter((c) => !scope.has(c)).join(',')}`,
    );
    check(
      [...scope].filter((c) => !claimed.includes(c)).join(',') === '',
      `every member state is accounted for — missing: ${[...scope].filter((c) => !claimed.includes(c)).join(',')}`,
    );
  }
  check(!('FIPS' in USED_SOURCES), 'FIPS is 8 occurrences and 40.7 MB of a border-inaccurate source');
  check(!('WARNCELLID' in USED_SOURCES), 'WARNCELLID has no geometry source to download');
  check(!('NUTS2' in USED_SOURCES), 'NUTS2 has no geometry source any more: Belgium and Hungary are joined on EMMA_ID');
  // 🔴 ЛІЦЕНЗІЯ, А НЕ СМАК. EuroGeographics: «the data will not be used for
  // commercial purposes» — заміряно 02.11.2026 на всіх семи випусках
  // GISCO NUTS. Жодне джерело, з якого цей скрипт тягне полігони, не
  // сміє вказувати туди.
  check(
    Object.values(USED_SOURCES).every((src) => !/gisco|eurogeographics|europa\.eu/i.test(src.url)),
    '🔴 no source this resolver downloads is GISCO / EuroGeographics',
  );
  check(
    Object.values(USED_SOURCES).every((src) => !OBSOLETE_CACHE.includes(src.file)),
    '🔴 no source is cached under a name an old GISCO run left on the server',
  );
  check(
    OBSOLETE_CACHE.includes('NUTS3.json') && OBSOLETE_CACHE.includes('NUTS2.json'),
    'the cache names the GISCO runs used are marked for removal',
  );
  // 🔴 Поля джерел НІХТО не читав, тож `idField: 'code' → 'XXXX'` і
  // `zones: 2006 → 1` переживали прогін: об'єкт був інертний, окрім
  // двох перевірок `in`. Завантажувач, який прийде за цим PR, читатиме
  // саме їх.
  for (const [scheme, src] of Object.entries(USED_SOURCES)) {
    check(
      /^https:\/\/\S+$/.test(src.url) && src.idField.length > 0 && src.zones > 0 && src.file.endsWith('.json'),
      `${scheme} names an https source, the property its codes live in, how many zones it had and a cache file`,
    );
  }
  check(USED_SOURCES.EMMA_ID.idField === 'code', 'EMMA zones carry their code in `code`');
  check(USED_SOURCES.NUTS3.idField === 'NUTS_ID', 'the county features carry their NUTS code in `NUTS_ID`');
  check(
    USED_SOURCES.EMMA_ID.zones === 2006 && USED_SOURCES.NUTS3.zones === 21,
    'the zone counts are the ones measured: 2 006 EMMA zones (13.10.2026) and 21 Croatian counties (02.11.2026)',
  );
  check(
    USED_SOURCES.NUTS3.zones === Object.keys(HR_COUNTIES).length,
    'the county source expects exactly the counties `osm-hr-counties.mjs` lists',
  );
  check(
    typeof USED_SOURCES.NUTS3.select === 'function' && USED_SOURCES.NUTS3.headers['User-Agent'].includes('camptribe'),
    'the county source filters what OSM vouches for and says who is asking',
  );

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
  // 🔴 ЗМІСТ, А НЕ ЛИЧИЛЬНИК КОЛОНОК. Рецензія внесла три мутації, що
  // пережили весь прогін, бо перевірявся лише `split('\t').length === 3`:
  // свап колонок (`code\tscheme`), втрата `.trim()` і втрата
  // `JSON.stringify` — остання робила кожен рядок `[object Object]`, і
  // ніхто цього не читав.
  check(
    made.lines[0] === 'EMMA_ID\tBE001\t{"type":"Polygon","coordinates":[]}',
    `the row is scheme, then code, then the geometry as JSON — got ${made.lines[0]}`,
  );

  const spaced = rowsFrom(
    { features: [{ properties: { code: '  BE001  ' }, geometry: { type: 'Polygon', coordinates: [] } }] },
    'EMMA_ID',
    'code',
  );
  check(
    spaced.lines[0].split('\t')[1] === 'BE001',
    'a code padded with spaces is trimmed, or it joins nothing',
  );

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
  // 🔴 ФІКСТУРА В СПРАВЖНЬОМУ МАСШТАБІ. Попередня була на 100 кемпінгів
  // — нижче підлоги, якої тоді не існувало. Тепер числа ті самі, що й
  // заміряні 13.10.2026, тож випадок говорить про дійсність.
  const v = verdict(57082, 52907, [
    { country: 'FR', total: 21702, missing: 90 },
    { country: 'IT', total: 4167, missing: 0 },
    { country: 'SE', total: 2290, missing: 2290 },
  ]);
  check(v.share === 92.7, `the share is 92.7, got ${v.share}`);
  // 🔴 ОДИН ЗНАК ПІСЛЯ КОМИ, І ЗАГОЛОВОК PR НА НЬОМУ ТРИМАЄТЬСЯ (92.7).
  // Фікстура вище має total=100, тож арифметика вироджується і мутація
  // `Math.round((100*placed)/total)` переживала її непоміченою.
  check(
    verdict(50000, 46350, []).share === 92.7,
    `46 350 of 50 000 is 92.7, got ${verdict(50000, 46350, []).share}`,
  );

  // 🔴 ПІДЛОГА, ЯКОЇ НЕ БУЛО. Рецензія заміряла: `verdict` віддавав
  // `ok` на 1 кемпінгу з 57 082 — тобто на 0.0%. Разом зі звітом, що
  // не читав колонки, це означало, що мутація, яка стирає колонку
  // начисто, друкує успіх.
  check(verdict(57082, 0, []).ok === false, '🔴 нуль розташованих — це поломка, не 0%');
  check(verdict(57082, 1, []).ok === false, 'один кемпінг із 57 082 теж поломка');
  check(
    /under the 80% floor/.test(verdict(57082, 1, []).why ?? ''),
    'і причина називає підлогу, а не просто «погано»',
  );
  check(verdict(100, 93, []).ok === false, '🔴 схлопнутий знаменник — поломка, навіть якщо частка гарна');
  check(
    /denominator collapsed/.test(verdict(100, 93, []).why ?? ''),
    'і причина називає саме знаменник',
  );
  check(verdict(57082, 52907, []).ok === true, 'заміряна дійсність проходить'); 
  check(v.short.length === 2, 'only the countries with a shortfall are listed');
  check(v.short[0].country === 'SE', 'the largest shortfall is named first');
  check(verdict(0, 0, []).ok === false, '🔴 reading no campsites at all is a failure, not 0%');

  // 🔴 СТОРОЖ НА МОВЧАЗНУ ВТРАТУ ПОКРИТТЯ, ПО КРАЇНАХ. Глобальна підлога
  // не бачить країну в 642 кемпінги: заміряно нижче, 57 128 живих.
  {
    // Заміряна дійсність: рядки `{country, total, missing}` після прибирання GISCO.
    const AFTER = [
      { country: 'BE', total: 748, missing: 10 },
      { country: 'BG', total: 275, missing: 28 },
      { country: 'FR', total: 21759, missing: 542 },
      { country: 'HR', total: 642, missing: 4 },
      { country: 'HU', total: 615, missing: 3 },
      { country: 'RO', total: 567, missing: 11 },
    ];
    const ok = floorsVerdict(AFTER);
    check(ok.ok === true, `the six countries as measured on 02.11.2026 pass their floors: ${ok.why ?? ''}`);
    check(
      ok.table.map((t) => `${t.country} ${t.placed}/${t.total}`).join() ===
        'BE 738/748,BG 247/275,FR 21217/21759,HR 638/642,HU 612/615,RO 556/567',
      'the table is the measured numerator over its denominator, per country',
    );
    check(
      Object.keys(COUNTRY_FLOORS).join() === 'BE,BG,FR,HR,HU,RO' &&
        Object.keys(BEFORE_GISCO).join() === Object.keys(COUNTRY_FLOORS).join(),
      'exactly the six whose join changed have a floor and a before-figure',
    );

    // 🔴 Хорватія ціла зникає, а глобальна частка цього не помічає.
    const croatiaGone = AFTER.map((r) => (r.country === 'HR' ? { ...r, missing: r.total } : r));
    const missingAll = croatiaGone.reduce((n, r) => n + r.missing, 0);
    const globalPlaced = 52469 - 638;
    const g = verdict(57128, globalPlaced, croatiaGone);
    const f = floorsVerdict(croatiaGone);
    check(g.ok === true, `🔴 with all of Croatia gone the GLOBAL verdict still says ok at ${g.share}% — that is the hole`);
    check(
      f.ok === false && /^HR: 0 of 642 \(0%\)/.test(f.why),
      `🔴 …and the per-country floor names it: ${f.why}`,
    );
    check(missingAll > 0, 'the fixture really lost campsites');

    // Кожна підлога тримає САМА: країна рівно на підлозі проходить, на
    // одну десяту нижче — ні. Без цього мутація «підлога 0» на одній
    // країні лишалась би непоміченою.
    for (const [country, floor] of Object.entries(COUNTRY_FLOORS)) {
      const row = AFTER.find((r) => r.country === country);
      const placedAt = (share) => Math.ceil((share / 100) * row.total);
      const at = AFTER.map((r) => (r === row ? { ...r, missing: r.total - placedAt(floor) } : r));
      const below = AFTER.map((r) => (r === row ? { ...r, missing: r.total - placedAt(floor) + Math.ceil(row.total / 100) } : r));
      check(floorsVerdict(at).ok === true, `${country} exactly at its ${floor}% floor passes`);
      const v2 = floorsVerdict(below);
      check(v2.ok === false && v2.why.startsWith(`${country}:`), `${country} a point under its floor is named: ${v2.why ?? 'passed'}`);
    }

    check(
      floorsVerdict(AFTER.filter((r) => r.country !== 'FR')).ok === false &&
        /FR: no campsites were read at all/.test(floorsVerdict(AFTER.filter((r) => r.country !== 'FR')).why),
      '🔴 a country that vanished from the report is a failure, not a pass',
    );
    check(
      floorsVerdict([...AFTER.filter((r) => r.country !== 'BG'), { country: 'BG', total: 0, missing: 0 }]).ok === false,
      'a country with no campsites at all is a failure, not 100% of nothing',
    );
    check(
      /GISCO gave 266 of 275/.test(floorsVerdict(AFTER.map((r) => (r.country === 'BG' ? { ...r, missing: 275 } : r))).why),
      'and the refusal puts the old figure beside the new one',
    );
  }

  // 🔴 Літерал, і він ловить випадок, що перестав досягатись: такий
  // друкує те саме, що друкує випадок, який пройшов. 45 до 02.11.2026,
  // 70 після заміни GISCO (`node … --self-test` рахує сам).
  const EXPECTED_CASES = 70;
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
