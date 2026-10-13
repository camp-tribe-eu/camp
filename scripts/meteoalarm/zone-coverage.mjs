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

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Which geocode schemes each member state publishes AND we can resolve.
 *
 * 🔴 THE NAME OF THIS MAP USED TO OVERSTATE IT, and review caught the
 * difference. It is not "what each feed publishes": Czechia publishes
 * `CISORP` and Germany publishes `WARNCELLID`, and neither is here,
 * because no geometry source exists for either. It is the INTERSECTION —
 * published and resolvable — and reading the verdict means knowing that.
 *
 * 🔴 From `fetch-warnings.mjs --census` on 13.10.2026, not from the
 * scheme list in `resolve-areas.mjs`: that one says what we COULD
 * resolve, this says what anybody actually sends.
 *
 * 🔴 LATVIA IS HERE AND IS NOT WHOLE. The census prints it on its own
 * line — `partly coded: latvia 32/204` — so 172 of its 204 areas carry
 * no code at all. This map lists `LV` beside countries that code
 * everything, and that flattening is deliberate but lossy: a Latvian
 * campsite can be placed, and the warning that reaches it still may not
 * be. The matcher's `unlocatable` is what catches the rest.
 */
export const SCHEMES_USED = Object.freeze({
  AT: ['EMMA_ID'], BE: ['EMMA_ID', 'NUTS2'], BG: ['NUTS3'], CZ: ['EMMA_ID'],
  DE: ['EMMA_ID'], DK: ['EMMA_ID'], ES: ['EMMA_ID'], FI: ['EMMA_ID'],
  FR: ['NUTS3'], GR: ['EMMA_ID'], HR: ['EMMA_ID', 'NUTS3'], HU: ['NUTS2'],
  IE: ['EMMA_ID'], IT: ['EMMA_ID'], LT: ['EMMA_ID'], LV: ['EMMA_ID'],
  NL: ['EMMA_ID'], PL: ['EMMA_ID'], PT: ['EMMA_ID'], RO: ['NUTS3'],
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
 * The census output, quoted, so the map above has something to answer to.
 *
 * 🔴 ДВА ЛІТЕРАЛИ ГІРШІ ЗА ОДИН, АЛЕ КРАЩІ ЗА ЖОДНОГО. Рецензія
 * заміряла, що 21 пара країна-схема з 22 не захищена нічим: `BG:NUTS3`
 * можна було поміняти на `BG:EMMA_ID` і прогін лишався зеленим. Звірка
 * з `eu-member-states.json` цього не ловить — вона про КРАЇНИ, а тут
 * зіпсована СХЕМА.
 *
 * Корпус для живих фідів у модульний тест не затягнути, тож це —
 * дослівні рядки `fetch-warnings.mjs --census` від 13.10.2026. Вони не
 * моє тлумачення, а цитата виводу, яку можна переперевірити однією
 * командою. `SCHEMES_USED` мусить інвертуватись рівно в них.
 *
 * Тут немає `WARNCELLID` і `CISORP`: вони в переписі є, але геометрії
 * для них не існує, тож у мапі їх і не повинно бути. `FIPS` виключений
 * за ціною — 8 входжень на 40.7 МБ.
 */
export const CENSUS_2026_10_13 = Object.freeze({
  EMMA_ID: ['AT', 'BE', 'HR', 'CZ', 'DK', 'FI', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'NL', 'PL', 'PT', 'ES'],
  NUTS3: ['BG', 'HR', 'FR', 'RO'],
  NUTS2: ['BE', 'HU'],
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

  // 🔴 ІНВЕРСІЯ МАПИ МУСИТЬ ДОРІВНЮВАТИ ПЕРЕПИСОВІ. Без цього випадку
  // 21 пара з 22 не була захищена нічим.
  {
    const inverted = {};
    for (const [country, scheme] of pairs) (inverted[scheme] ??= []).push(country);
    for (const scheme of Object.keys(CENSUS_2026_10_13)) {
      const want = [...CENSUS_2026_10_13[scheme]].sort().join(',');
      const got = [...(inverted[scheme] ?? [])].sort().join(',');
      check(got === want, `${scheme} is published by exactly the census's countries — got ${got}`);
    }
    check(
      Object.keys(inverted).sort().join(',') === Object.keys(CENSUS_2026_10_13).sort().join(','),
      'the map names no scheme the census did not',
    );
  }
  check(
    pairs.some(([c, s]) => c === 'FR' && s === 'NUTS3'),
    'France is joined on NUTS3 — the scheme its own feed publishes',
  );
  check(
    !pairs.some(([c, s]) => c === 'FR' && s === 'EMMA_ID'),
    '🔴 France must NOT be joined on EMMA_ID: 97.5% of its campsites sit inside those polygons and none of its warnings name them',
  );
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
  // 🔴 Поля джерел НІХТО не читав, тож `idField: 'code' → 'XXXX'` і
  // `zones: 2006 → 1` переживали прогін: об'єкт був інертний, окрім
  // двох перевірок `in`. Завантажувач, який прийде за цим PR, читатиме
  // саме їх.
  for (const [scheme, src] of Object.entries(USED_SOURCES)) {
    check(
      /^https:\/\/\S+$/.test(src.url) && src.idField.length > 0 && src.zones > 0,
      `${scheme} names an https source, the property its codes live in, and how many zones it had`,
    );
  }
  check(USED_SOURCES.EMMA_ID.idField === 'code', 'EMMA zones carry their code in `code`');
  check(USED_SOURCES.NUTS3.idField === 'NUTS_ID', 'NUTS zones carry theirs in `NUTS_ID`');
  check(
    USED_SOURCES.EMMA_ID.zones === 2006 &&
      USED_SOURCES.NUTS3.zones === 1480 &&
      USED_SOURCES.NUTS2.zones === 320,
    'the zone counts are the ones measured on 13.10.2026',
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

  // 🔴 Літерал, і він спіймав мене тричі за цю сесію. Лічба: 3 про
  // схеми + 7 мовчазних + 5 про область + 7 про джерела + 5 про рядки +
  // 12 про вирок + 2 про порядок + 4 про інверсію перепису = 45.
  const EXPECTED_CASES = 45;
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
