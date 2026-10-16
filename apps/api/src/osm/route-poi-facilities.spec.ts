import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RoutePoiFacilities1791400000000 } from '../migrations/1791400000000-RoutePoiFacilities';
import { RoutePoiGas1791700000000 } from '../migrations/1791700000000-RoutePoiGas';
import { exportedTags } from './route-poi-export';
import {
  asciiLower,
  BLANK_CODE_POINTS,
  BLANKS_SQL,
  CYLINDER_SWAP,
  facilitySelectSql,
  FACILITY_COLUMNS,
  FACILITY_TAGS,
  lpgArrivalError,
  LPG,
  LPG_GUARD_MIN_FUEL_ROWS,
  lpgSelectSql,
  normalisedSql,
  normaliseTag,
  resolveTriState,
  resolveVerbatim,
  ROW_FACILITY_COLUMNS,
  ROW_FACILITY_TAGS,
  SEPARATOR_SQL,
  tagParts,
  tagPartsSql,
  TRISTATE_COLUMNS,
  TRISTATE_FACILITIES,
  triStateSql,
  VERBATIM_FACILITIES,
} from './route-poi-facilities';
import {
  ACCESS_EXCLUDED,
  classifyCaseSql,
  GAS_WIDE_MAX_PERCENT,
  GAS_WIDE_MIN_OBJECTS,
  gasLayerError,
  isAccessExcluded,
  osmiumFiltersFor,
  REST_STOP_KINDS,
  rulesTestSql,
  STORED_POI_KINDS,
  STORED_POI_RULES,
} from './route-poi';
import {
  buildRoutePoiInsertSql,
  canonicalRefSql,
  cylinderSwapSelectSql,
  GAS_LAYER_SUMMARY_SQL,
  LPG_SUMMARY_SQL,
} from './route-poi-sql';
import { FALSY, TRUTHY } from './tag-mapping';

// CAMP-119 — what a stopping place says about itself, and the contract
// between the tag list the pipeline exports and the tags the loader reads.
//
// 🔴 Every test here was written against a MUTATION and shown to fail on
// it; the mutation is named above the test that covers it. The VALUES —
// that an absent tag lands as 'unknown' and not 'no' — are asserted
// against a real PostgreSQL in route-poi-sql.db.spec.ts. What is here is
// the part that needs no database: the vocabulary, the second
// implementation, and the files that must agree with each other.

const SCRIPTS = join(__dirname, '../../../../scripts/osm-pipeline');

describe('the vocabulary is the campsites', () => {
  const byColumn = (c: string) =>
    TRISTATE_FACILITIES.find((f) => f.column === c)!.vocabulary;

  // 🔴 MUTATION: copy the words into this file instead of importing them.
  // Two lists of "what counts as yes" drift, and the page then says one
  // thing about a toilet at a campsite and another about the same tag at
  // a service area. Identity, not equality: a copy would be equal today.
  it("reads the availability tags through tag-mapping.ts's own sets", () => {
    for (const column of [
      'toilets',
      'shower',
      'drinking_water',
      'sanitary_dump_station',
    ]) {
      expect(byColumn(column).yes).toBe(TRUTHY);
      expect(byColumn(column).no).toBe(FALSY);
    }
  });

  // 🔴 MUTATION (CAMP-258): copy the words into the LPG constant instead of
  // importing them. Identity, as above: a copy is equal today.
  it('reads `fuel:lpg` through the same sets as the other availability tags', () => {
    expect(LPG.vocabulary.yes).toBe(TRUTHY);
    expect(LPG.vocabulary.no).toBe(FALSY);
  });

  // 🔴 MUTATION: give `fee` the availability vocabulary. `fee=private`
  // would then read as "no fee" — the claim "this is free", made from a
  // nonsense value, which is the one claim this card refuses to make.
  it('reads `fee` through a narrower vocabulary on purpose', () => {
    const fee = byColumn('fee');
    expect([...fee.yes].sort()).toEqual(['1', 'true', 'yes']);
    expect([...fee.no].sort()).toEqual(['0', 'false', 'no']);
    for (const word of ['private', 'none', 'customers', 'public', 'donation']) {
      expect(resolveTriState(word, fee)).toBe('unknown');
    }
  });
});

describe('the JavaScript twin of the three states', () => {
  const availability = TRISTATE_FACILITIES[0].vocabulary;

  // 🔴 MUTATION: let an absent tag fall through to 'no'. This is the
  // card's whole point and the first row of every table in it.
  it('says unknown, not no, where nobody wrote anything', () => {
    for (const raw of [undefined, null, '', '   ', '\t']) {
      expect(resolveTriState(raw, availability)).toBe('unknown');
    }
  });

  it('says what was written when it is a plain answer', () => {
    expect(resolveTriState('yes', availability)).toBe('yes');
    expect(resolveTriState('no', availability)).toBe('no');
    expect(resolveTriState(' YES ', availability)).toBe('yes');
    expect(resolveTriState('designated', availability)).toBe('yes');
    expect(resolveTriState('private', availability)).toBe('no');
  });

  // 🔴 MUTATION: map an unrecognised value to 'no'. `toilets=separate`
  // is somebody describing a toilet; "no toilet" is the opposite of what
  // they said.
  it('keeps a value nobody has met as unknown, never as no', () => {
    for (const raw of ['maybe', 'separate', 'outside', 'fixme', 'hot', '?']) {
      expect(resolveTriState(raw, availability)).toBe('unknown');
    }
  });

  // Same rule as tag-mapping.ts's readValueRule: ANY part yes wins, and it
  // is a no only if EVERY part is.
  it('reads a semicolon list part by part', () => {
    expect(resolveTriState('yes;no', availability)).toBe('yes');
    expect(resolveTriState('no;no', availability)).toBe('no');
    expect(resolveTriState('no;maybe', availability)).toBe('unknown');
    expect(resolveTriState('no;', availability)).toBe('no');
    expect(resolveTriState(';', availability)).toBe('unknown');
  });

  it('keeps a value-carrying tag as written, and unknown where absent', () => {
    expect(resolveVerbatim(' Customers ')).toBe('customers');
    expect(resolveVerbatim('3.5')).toBe('3.5');
    expect(resolveVerbatim(undefined)).toBe('unknown');
    expect(resolveVerbatim('')).toBe('unknown');
    expect(resolveVerbatim('  ')).toBe('unknown');
  });
});

// ── WHAT A BLANK IS (CAMP-119 review, defects 1 and 2) ───────────────────
describe('what a blank is, in JavaScript and in SQL', () => {
  // Every code point there is, asked of the engine itself.
  const engineTrims: number[] = [];
  const engineBackslashS: number[] = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    const ch = String.fromCodePoint(cp);
    if (ch.trim() === '') engineTrims.push(cp);
    if (/\s/.test(ch)) engineBackslashS.push(cp);
  }

  // 🔴 MUTATION: delete U+FEFF (or any one) from BLANK_CODE_POINTS, or add
  // U+0085 to it. The SQL is built from this list and not from `\s`, so
  // this is the only thing that ties it to what `trim()` means — and it
  // is what makes the oracle (which uses `trim()`) count the loader's rule.
  it('is exactly the code points trim() strips and \\s matches — all 1 114 112', () => {
    expect([...BLANK_CODE_POINTS]).toEqual(engineTrims);
    expect(engineBackslashS).toEqual(engineTrims);
    expect(BLANK_CODE_POINTS).toHaveLength(25);
  });

  // 🔴 MUTATION: change one escape in the migration's BLANKS_SQL. The
  // migration freezes its own copy, on purpose; this keeps the two equal.
  it("is the set the migration's CHECK strips, character for character", () => {
    expect(RoutePoiFacilities1791400000000.BLANKS_SQL).toBe(BLANKS_SQL);
  });

  // 🔴 MUTATION: put `btrim(x)` or `lower(x)` back in a facility column.
  // The first strips U+0020 and the second follows the locale — and the
  // database spec only sees the one this machine's locale happens to be.
  it('is how every facility column is trimmed, and none of them uses lower()', () => {
    const sql = facilitySelectSql('s');
    expect(sql).not.toMatch(/\blower\(/);
    const trims = [...sql.matchAll(/btrim\(([^()]*)\)/g)];
    expect(trims.length).toBeGreaterThan(9);
    for (const m of trims) expect(m[1]).toContain(`, ${BLANKS_SQL}`);
  });

  it('is written as escapes, so no invisible character sits in the SQL', () => {
    // eslint-disable-next-line no-control-regex
    expect(BLANKS_SQL).toMatch(/^E'(\\u[0-9a-f]{4})+'$/);
    // eslint-disable-next-line no-control-regex
    expect(`${BLANKS_SQL}${SEPARATOR_SQL}`).not.toMatch(
      /[\u0000-\u001f\u0080-\uffff]/,
    );
  });

  // 🔴 MUTATION: the old `trim()` → a plain-space strip, or `\s*;\s*` → ` *; *`
  // — the review's own mutation, which left 102 tests green.
  it('is stripped from both ends of a value, and around a `;`', () => {
    for (const cp of BLANK_CODE_POINTS) {
      const b = String.fromCodePoint(cp);
      expect(normaliseTag(`${b}Yes${b}`)).toBe('yes');
      expect(
        resolveTriState(`${b}yes`, TRISTATE_FACILITIES[0].vocabulary),
      ).toBe('yes');
      expect(resolveVerbatim(`${b}${b}`)).toBe('unknown');
      expect(resolveVerbatim(`${b}3.5${b}`)).toBe('3.5');
      expect(tagParts(`no${b};${b}No`)).toEqual(['no', 'no']);
    }
  });

  // …and the converse: overreach is a defect as well.
  it('is not stripped when it only looks like a blank', () => {
    for (const b of ['\u0085', '\u180e', '\u200b', '\u2060', '\u00ad']) {
      expect(normaliseTag(`${b}yes`)).toBe(`${b}yes`);
      expect(tagParts(`no${b};no`)).toEqual([`no${b}`, 'no']);
    }
  });
});

describe('what lower-case means, in JavaScript and in SQL', () => {
  // 🔴 MUTATION: asciiLower → toLowerCase(). `İ` becomes `i` + U+0307 here
  // and `i` in a UTF-8 libc locale, and stays `İ` under COLLATE "C": no
  // two of them agree, so only ASCII is folded.
  it('folds ASCII letters and nothing else', () => {
    // written out by hand: the expectation is not the implementation again
    expect(asciiLower('YES Customers')).toBe('yes customers');
    expect(asciiLower('İ')).toBe('İ');
    expect(asciiLower('ΑΣ')).toBe('ΑΣ');
    expect(asciiLower('ÉÀ')).toBe('ÉÀ');
    expect(asciiLower('ẞ')).toBe('ẞ');
    expect(asciiLower('\u212a')).toBe('\u212a');
    expect(normaliseTag('DESİGNATED')).toBe('desİgnated');
  });

  it('reads a value a locale could re-spell as the unknown word it is', () => {
    const vocab = TRISTATE_FACILITIES[0].vocabulary;
    expect(resolveTriState('DESİGNATED', vocab)).toBe('unknown');
    expect(resolveTriState('YESİ', vocab)).toBe('unknown');
  });

  // 🔴 MUTATION: normalisedSql → lower(...)
  it('is translate(), not lower(), in the SQL', () => {
    const sql = normalisedSql('x');
    expect(sql).toMatch(/^translate\(btrim\(x, E'/);
    expect(sql).not.toMatch(/lower\(/);
  });
});

describe('the access rule', () => {
  // 🔴 MUTATION: compare the raw value (no normalisation); read a list as
  // excluded only when EVERY part is; drop one word from the comparison.
  it.each([
    ['private', true],
    ['Private', true],
    ['PRIVATE ', true],
    ['\tno\n', true],
    ['\u00a0permit', true],
    ['employees', true],
    ['private;customers', true],
    ['customers;private', true],
    ['delivery;private', true],
    ['no;yes', true],
    ['students;employees', true],
    ['Customers ; PRIVATE', true],
    ['customers', false],
    ['yes', false],
    ['permissive', false],
    ['students', false],
    ['customers;visitors;members', false],
    ['private road', false],
    ['not_private', false],
    ['\u0085private', false],
    ['', false],
    ['   ', false],
    [';', false],
    [null, false],
    [undefined, false],
  ] as const)('says %j keeps the place out: %s', (raw, excluded) => {
    expect(isAccessExcluded(raw)).toBe(excluded);
  });

  it('is told which words exclude, and reads no others', () => {
    expect(isAccessExcluded('customers', ['customers'])).toBe(true);
    expect(isAccessExcluded('private', ['customers'])).toBe(false);
  });
});

describe('the SQL for a yes/no/unknown column', () => {
  const sql = triStateSql('toilets', TRISTATE_FACILITIES[0].vocabulary);

  // 🔴 MUTATION: change any 'unknown' in the expression to 'no'. The
  // database test shows the value; this keeps the SHAPE honest: exactly
  // one way to say no, and it goes through the no-list.
  it('has exactly one branch that answers no, and it reads the list', () => {
    expect(sql.match(/THEN 'no'/g)).toHaveLength(1);
    expect(sql).toMatch(/<@ ARRAY\[[^\]]*'no'[^\]]*\]::text\[\] THEN 'no'/);
    // an EMPTY array is contained in every array, so the no-list test needs
    // a part to test — see triStateSql
    expect(sql).toMatch(/cardinality\(array_remove\([^\n]*\) > 0/);
    expect(sql).toMatch(/IS NULL THEN 'unknown'/);
    expect(sql).toMatch(/ELSE 'unknown'/);
  });

  it('refuses a column name it cannot safely quote', () => {
    expect(() =>
      triStateSql('toilets"; DROP TABLE camping_spots; --', {
        yes: TRUTHY,
        no: FALSY,
      }),
    ).toThrow(/unsafe column/);
  });
});

// ── THE CONTRACT BETWEEN THE EXPORT AND THE LOADER ───────────────────────
//
// 🔴 This is the one that cannot be seen from a page. A tag the loader
// reads and the export does not carry is not a crash — if the staging
// column is missing the INSERT fails, but if it is merely empty every row
// says 'unknown', which reads exactly like an honest gap. `toilets`, `fee`
// and `shower` were dropped by the export for the 7 525 dump stations the
// table already held, and nothing noticed, because a dropped tag looks
// like a tag nobody wrote.
describe('the export carries every tag the loader reads', () => {
  const exported = new Set(exportedTags());

  // 🔴 MUTATION: delete "toilets" from scripts/osm-pipeline/export-rpoi.json.
  it('lists every facility tag', () => {
    expect(FACILITY_TAGS.filter((t) => !exported.has(t))).toEqual([]);
  });

  // The facility list above is what the loader SAYS it reads. This reads
  // the statement itself, so a column added to the SQL and to nothing else
  // is caught too — the loader's own text is the thing under test, not a
  // list somebody maintains beside it.
  //
  // 🔴 MUTATION: add `s.foo` to the INSERT without adding "foo" to the
  // export; or delete "highway" from the export, which the classifier
  // reads.
  it('lists every staging column the INSERT reads', () => {
    const sql = buildRoutePoiInsertSql();
    const read = new Set(
      [...sql.matchAll(/\bs\.("[a-z_:]+"|[a-z_]+)/g)].map((m) =>
        m[1].replace(/"/g, ''),
      ),
    );
    // `id` and `geom` are ogr2ogr's own columns, not exported tags.
    read.delete('id');
    read.delete('geom');
    expect([...read].filter((t) => !exported.has(t)).sort()).toEqual([]);
    // …and it is reading something: an empty set would pass the line above.
    expect(read.size).toBeGreaterThan(15);
  });

  it('lists the key every stored kind is classified by', () => {
    for (const rules of Object.values(STORED_POI_RULES)) {
      for (const rule of rules) expect(exported.has(rule.key)).toBe(true);
    }
  });

  // 🔴 MUTATION: put the tag list back into the shell script as a heredoc.
  // Two copies of one list is how `toilets` was lost the first time.
  it('is the file the shell script hands to osmium, not a copy of it', () => {
    const script = readFileSync(join(SCRIPTS, 'load-route-poi.sh'), 'utf8');
    expect(script).toContain('--config="$EXPORT_CONFIG"');
    expect(script).toContain('scripts/osm-pipeline/export-rpoi.json');
    expect(script).not.toMatch(/include_tags/);
  });
});

describe('the migration and the module describe the same columns', () => {
  it('adds exactly the columns the loader writes', () => {
    expect([...RoutePoiFacilities1791400000000.TRISTATE]).toEqual([
      ...TRISTATE_COLUMNS,
    ]);
    expect([...RoutePoiFacilities1791400000000.VERBATIM]).toEqual([
      ...VERBATIM_FACILITIES,
    ]);
    expect([
      ...RoutePoiFacilities1791400000000.TRISTATE,
      ...RoutePoiFacilities1791400000000.VERBATIM,
    ]).toEqual([...FACILITY_COLUMNS]);
  });

  // 🔴 A kind without its partial index is not an error, it is a
  // sequential scan over 2.2 million rows — the failure that does not
  // announce itself.
  it('indexes exactly the stopping-place kinds', () => {
    expect([...RoutePoiFacilities1791400000000.KINDS]).toEqual([
      ...REST_STOP_KINDS,
    ]);
  });
});

// ── CAMP-258: `lpg` ──────────────────────────────────────────────────────

describe('the lpg column is read from fuel:lpg and written as lpg', () => {
  // 🔴 MUTATION: read `s.lpg` (or `s."lpg"`) in lpgSelectSql. The staging
  // table has no such column — ogr2ogr makes one per OSM key — so the
  // INSERT would die on a real run; and if somebody then "fixed" it by
  // adding an `lpg` column to the staging table, every row would say
  // `unknown`, which is the failure the loader's guard exists for.
  it('names the OSM key on the way in and the column on the way out', () => {
    const sql = lpgSelectSql('s');
    expect(sql).toContain('s."fuel:lpg"');
    expect(sql).not.toMatch(/s\."?lpg"?/);
    expect(sql.trim()).toMatch(/END AS lpg$/);
    expect(LPG.tag).toBe('fuel:lpg');
    expect(LPG.column).toBe('lpg');
  });

  // 🔴 MUTATION: change the 'unknown' branches of triStateSql into 'no'.
  // The database spec shows the values; this keeps lpg on the same shape
  // as every other yes/no/unknown column: one way to say no, through a list.
  it('says no in exactly one place, and it reads the no-list', () => {
    const sql = lpgSelectSql('s');
    expect(sql.match(/THEN 'no'/g)).toHaveLength(1);
    expect(sql).toMatch(/IS NULL THEN 'unknown'/);
    expect(sql).toMatch(/ELSE 'unknown'/);
  });

  // 🔴 MUTATION: delete "fuel:lpg" from scripts/osm-pipeline/export-rpoi.json.
  // Not a crash: the loader adds the missing staging column EMPTY, and 154 183
  // fuel rows say `unknown`, which reads as an honest gap.
  it('is in the export, under the tag and not under the column', () => {
    const exported = new Set(exportedTags());
    expect(exported.has('fuel:lpg')).toBe(true);
    expect(ROW_FACILITY_TAGS.filter((t) => !exported.has(t))).toEqual([]);
  });

  // 🔴 MUTATION: write the INSERT's column list from FACILITY_COLUMNS again.
  // `lpg` would be selected and never inserted, or inserted and never
  // refreshed by ON CONFLICT — the first import right, every later one
  // keeping what it first wrote.
  it('is inserted, selected and refreshed on conflict', () => {
    const sql = buildRoutePoiInsertSql();
    expect([...ROW_FACILITY_COLUMNS]).toEqual([
      ...FACILITY_COLUMNS,
      'lpg',
      'cylinder_swap',
    ]);
    expect(sql).toMatch(/\(osm_ref, kind[^)]*\blpg\b[^)]*\)/);
    expect(sql).toContain('r.lpg');
    expect(sql).toContain('lpg = EXCLUDED.lpg');
  });

  // The page's five and the table's lpg are different groups on purpose —
  // see the section in route-poi-facilities.ts. If `lpg` ever joins the five
  // this is the place that says a page now has to decide about it.
  it('is not one of the five facilities a stopping place prints', () => {
    expect(TRISTATE_COLUMNS).not.toContain('lpg');
    expect(FACILITY_COLUMNS).not.toContain('lpg');
    expect(FACILITY_TAGS).not.toContain('fuel:lpg');
  });
});

describe('the gas migration and the module describe the same columns', () => {
  // 🔴 MUTATION: rename a column in the migration, or in LPG / CYLINDER_SWAP.
  it('adds exactly the columns the loader writes', () => {
    expect([...RoutePoiGas1791700000000.COLUMNS]).toEqual([
      LPG.column,
      CYLINDER_SWAP.column,
    ]);
    // the two migrations between them are the INSERT's column list, once
    expect([
      ...RoutePoiFacilities1791400000000.TRISTATE,
      ...RoutePoiFacilities1791400000000.VERBATIM,
      ...RoutePoiGas1791700000000.COLUMNS,
    ]).toEqual([...ROW_FACILITY_COLUMNS]);
  });
});

// ── CAMP-258: `cylinder_swap` ────────────────────────────────────────────

describe('cylinder_swap is derived from the gas_exchange rule, not from the kind', () => {
  const sql = cylinderSwapSelectSql('s');

  // 🔴 MUTATION: derive the flag from the row's KIND (`k.kind =
  // 'gas_exchange'`). Every table of numbers on a fixture of lone gas shops
  // stays right, and the 4 014 forecourts that also say `shop=gas` lose the
  // one fact that makes them part of the layer.
  it('tests the tag the kind is built from, on the staging row', () => {
    expect(sql).toContain(`${tagPartsSql('s."shop"')} && ARRAY['gas']::text[]`);
    expect(sql).not.toMatch(/\bkind\b/);
    expect(sql.trim()).toMatch(/AS cylinder_swap$/);
  });

  // 🔴 MUTATION: copy the value into the flag by hand ('gass'), or give
  // gas_exchange another rule. The flag and the kind read ONE rule.
  it('reads the very rule the gas_exchange branch of the CASE reads', () => {
    expect(rulesTestSql(STORED_POI_RULES.gas_exchange, 's')).toBe(
      `${tagPartsSql('s."shop"')} && ARRAY['gas']::text[]`,
    );
    expect(classifyCaseSql('s')).toContain(
      `WHEN ${rulesTestSql(STORED_POI_RULES.gas_exchange, 's')} THEN 'gas_exchange'`,
    );
    expect(sql).toContain(rulesTestSql(STORED_POI_RULES.gas_exchange, 's'));
  });

  // 🔴 MUTATION: add a branch that answers 'no'. No tag says "no cylinders
  // here"; absence of `shop=gas` is `unknown`.
  it('answers yes or unknown, and has no way to answer no', () => {
    expect(sql).toContain("THEN 'yes'");
    expect(sql).toContain("ELSE 'unknown'");
    expect(sql).not.toMatch(/'no'/);
  });

  it('is inserted and refreshed on conflict, like every column', () => {
    const insert = buildRoutePoiInsertSql();
    expect(insert).toMatch(/\(osm_ref, kind[^)]*\bcylinder_swap\b[^)]*\)/);
    expect(insert).toContain('r.cylinder_swap');
    expect(insert).toContain('cylinder_swap = EXCLUDED.cylinder_swap');
  });

  it('is not a stopping-place facility and needs no tag of its own', () => {
    expect(TRISTATE_COLUMNS).not.toContain('cylinder_swap');
    expect(FACILITY_COLUMNS).not.toContain('cylinder_swap');
    expect(ROW_FACILITY_TAGS).toEqual([...FACILITY_TAGS, 'fuel:lpg']);
    // `shop` is what it reads, and the export carries it for the classifier
    expect(exportedTags()).toContain('shop');
  });
});

describe('the loader notices when the gas layer disagrees with the tag', () => {
  const sum = (missing: number, extra: number, wideOnly = 0, wide = 8945) => ({
    own_kind: '2088',
    other_kinds: '5643',
    missing: String(missing),
    extra: String(extra),
    wide_objects: String(wide),
    wide_only: String(wideOnly),
    layer: '7731',
    layer_objects: '6096',
  });

  // These feed the guard a HAND-WRITTEN summary, so they pin what the
  // function does with a number. That the number is ever anything but zero
  // is asserted against a real PostgreSQL in route-poi-sql.db.spec.ts, where
  // a disagreement is planted in the table and the check's own SQL counts it.
  //
  // 🔴 MUTATION: stop reading `missing`, or test it with `< 0`.
  it('says so when objects that say shop=gas lost the flag', () => {
    expect(gasLayerError(sum(5643, 0))).toMatch(
      /5643 rows of objects that say shop=gas do not say cylinder_swap=yes/,
    );
    expect(gasLayerError(sum(1, 0))).not.toBeNull();
  });

  // 🔴 MUTATION: stop reading `extra` — the permissive side, which the first
  // version of this guard did not have at all.
  it('says so when rows say yes and no staged shop=gas explains them', () => {
    expect(gasLayerError(sum(0, 12))).toMatch(
      /12 rows say cylinder_swap=yes and no staged object says shop=gas/,
    );
    expect(gasLayerError(sum(0, 1))).not.toBeNull();
  });

  it('is silent when the flag and the tag agree', () => {
    expect(gasLayerError(sum(0, 0))).toBeNull();
    // …including with today's seven oddly written values (7 of 8 945)
    expect(gasLayerError(sum(0, 0, 7, 8945))).toBeNull();
  });

  // 🔴 THE THIRD DIRECTION, WHICH `missing` AND `extra` CANNOT SEE: the rule
  // reads `shop` more narrowly than OpenStreetMap writes it. The review found
  // `convenience;gas` — 2 804 staged objects of 8 912 — with both counts zero.
  // SYSTEMATIC means at least 10 objects AND more than 1% of those that
  // mention gas; below that it is data, reported and not fatal.
  //
  // 🔴 MUTATION: stop reading `wide_only`, or compare it with `>= wide`, or move
  // either threshold. The numbers are written out, not read from the constants.
  it('says so when a systematic share of the gas objects is not marked', () => {
    expect(gasLayerError(sum(0, 0, 2804, 8912))).toMatch(
      /2804 of 8912 staged objects mention gas as a word in shop/,
    );
  });

  it('is silent for a handful of odd values, and speaks from the thresholds', () => {
    // 9 of 100: under the absolute floor (10), however large the share
    expect(gasLayerError(sum(0, 0, 9, 100))).toBeNull();
    // 10 of 1 000: exactly 1%, which is not MORE than 1%
    expect(gasLayerError(sum(0, 0, 10, 1000))).toBeNull();
    // 10 of 999: just over 1%
    expect(gasLayerError(sum(0, 0, 10, 999))).not.toBeNull();
    // one odd record never costs the run, in any population
    expect(gasLayerError(sum(0, 0, 1, 1))).toBeNull();
    expect(GAS_WIDE_MIN_OBJECTS).toBe(10);
    expect(GAS_WIDE_MAX_PERCENT).toBe(1);
  });

  // Not a floor, and not a count of forecourts: a run with none in it has
  // `missing = 0` honestly, and one lost gas shop is already a rule that has
  // stopped being applied.
  it('has no floor for the code checks: one row either way is enough', () => {
    expect(
      gasLayerError({ ...sum(0, 0), own_kind: '3', other_kinds: '0' }),
    ).toBeNull();
    expect(
      gasLayerError({ ...sum(1, 0), own_kind: '3', other_kinds: '0' }),
    ).not.toBeNull();
    expect(
      gasLayerError({ ...sum(0, 1), own_kind: '3', other_kinds: '0' }),
    ).not.toBeNull();
  });

  // 🔴 MUTATION: build the check from the rule's own expression again
  // (`tagPartsSql` / `rulesTestSql`). The narrow side would then agree with
  // whatever the rule does, and the rule's blind spot would be the check's.
  // This is the defect of BOTH earlier versions of this guard.
  it('reads the tag by two readings of its own, and not by the rule it checks', () => {
    const sql = GAS_LAYER_SUMMARY_SQL;
    // the narrow reading: an element of the `;` list — unnest and btrim, where
    // the rule uses regexp_split_to_array and translate
    expect(sql).toContain("string_to_array(s.shop, ';')");
    expect(sql).toContain(`lower(btrim(e.v, ${BLANKS_SQL})) = 'gas'`);
    expect(sql).not.toContain('regexp_split_to_array');
    expect(sql).not.toContain('translate(');
    // the WIDE reading: gas as a word between any non-alphanumerics
    expect(sql).toContain("'(^|[^a-z0-9])gas([^a-z0-9]|$)'");
    // and the rule it stands in for is exactly this, so widening one without
    // the other is a red test here and not a silent disagreement
    expect(STORED_POI_RULES.gas_exchange).toEqual([
      { key: 'shop', values: ['gas'], list: true },
    ]);
  });

  // 🔴 THE FIRST VERSION OF THIS STATEMENT RAN FOR 19 MINUTES ON THE REAL TABLE.
  // It compared 2.27 million rows with `osm_ref IN (SELECT id FROM gas)` and
  // `NOT IN (SELECT …)`; the planner could not know that `gas` has 9 000 rows
  // and not 1.1 million, so it did not hash the subqueries, and each row was
  // compared with the whole CTE. The same question as joins is 1.6 seconds
  // (measured 15.10.2026 on camptribe_dev). A fixture of 30 rows cannot show
  // this, so it is pinned by SHAPE: no IN-subquery on a staging CTE.
  // MUTATION: put `osm_ref IN (SELECT …)` back.
  it('compares the table with staging by JOIN, not by IN (SELECT …) subqueries', () => {
    expect(GAS_LAYER_SUMMARY_SQL).not.toMatch(/\bIN\s*\(\s*SELECT/i);
    expect(GAS_LAYER_SUMMARY_SQL).toMatch(/LEFT JOIN by_id/);
    expect(GAS_LAYER_SUMMARY_SQL).toMatch(/LEFT JOIN by_cref/);
  });

  it('is asked through the statement the loader runs', () => {
    expect(GAS_LAYER_SUMMARY_SQL).toContain(
      "kind = 'gas_exchange'\n                           OR cylinder_swap = 'yes'",
    );
    expect(GAS_LAYER_SUMMARY_SQL).toContain('count(DISTINCT');
  });
});

describe('a list rule reads the tag as its elements', () => {
  // 🔴 MUTATION: compare the whole tag again (`IN ('gas')`), or drop `list`
  // from the gas_exchange rule. 3 755 rows of `convenience;gas` walk past.
  it('is the SQL of an element test for a list rule, and of an equality for the others', () => {
    expect(
      rulesTestSql([{ key: 'shop', values: ['gas'], list: true }], 's'),
    ).toBe(`${tagPartsSql('s."shop"')} && ARRAY['gas']::text[]`);
    expect(rulesTestSql([{ key: 'shop', values: ['gas'] }], 's')).toBe(
      "s.shop IN ('gas')",
    );
  });

  // 🔴 MUTATION: apply `list` to every rule. A list reading of every rule
  // moves 47 shelter rows to food, 8 food to groceries, 2 groceries to fuel and
  // 2 rest_area to food (measured 15.10.2026 on the staging of camptribe_dev) —
  // rows that exist would change kind. Only the gas rule is a list rule.
  it('is set on the gas rule alone', () => {
    const listed = STORED_POI_KINDS.flatMap((k) =>
      STORED_POI_RULES[k].filter((r) => r.list).map(() => k),
    );
    expect(listed).toEqual(['gas_exchange']);
  });

  it('asks osmium for a substring, because osmium matches the whole value', () => {
    expect(
      osmiumFiltersFor({ key: 'shop', values: ['gas'], list: true }),
    ).toEqual(['shop=*gas*']);
    expect(
      osmiumFiltersFor({ key: 'amenity', values: ['fuel', 'cafe'] }),
    ).toEqual(['amenity=fuel', 'amenity=cafe']);
  });
});

describe('the loader notices when fuel:lpg did not arrive', () => {
  const row = (state: string, rows: number) => ({
    state,
    rows: String(rows),
    objects: String(rows),
  });

  // 🔴 MUTATION: invert the test, drop the floor, or compare `yes` with
  // anything but zero. Each of the four lines below goes red under one.
  it('says so for a big fuel population with no yes in it', () => {
    expect(lpgArrivalError([row('unknown', 154_183)])).toMatch(
      /154183 fuel rows and not one says lpg=yes/,
    );
    expect(
      lpgArrivalError([row('no', 3_000), row('unknown', 151_183)]),
    ).toMatch(/not one says lpg=yes/);
  });

  it('is silent once a single station says yes', () => {
    expect(
      lpgArrivalError([row('yes', 1), row('unknown', 154_182)]),
    ).toBeNull();
    expect(
      lpgArrivalError([
        row('yes', 24_000),
        row('no', 3_000),
        row('unknown', 127_183),
      ]),
    ).toBeNull();
  });

  // 🔴 MUTATION: `<` → `<=` on the floor, or the floor to 100 or 1 000 000.
  // The edge is the thing: a scratch load of one small country must not be
  // refused, and the first population large enough to mean something must.
  // The numbers are WRITTEN OUT and not read from the constant — a test that
  // takes its edge from the thing it tests moves with every edit of it.
  it('speaks from exactly 1 000 fuel rows, and not below', () => {
    expect(lpgArrivalError([row('unknown', 999)])).toBeNull();
    expect(lpgArrivalError([row('no', 500), row('unknown', 499)])).toBeNull();
    expect(lpgArrivalError([row('unknown', 1000)])).not.toBeNull();
    expect(
      lpgArrivalError([row('no', 500), row('unknown', 500)]),
    ).not.toBeNull();
    expect(LPG_GUARD_MIN_FUEL_ROWS).toBe(1000);
  });

  it('is silent for an empty answer, which is a different failure', () => {
    // an empty `fuel` kind is the loader's own empty-kind check, not this
    expect(lpgArrivalError([])).toBeNull();
  });

  // The summary query is the loader's own text, imported — and it reads
  // `lpg` of the fuel kind only, grouped by state, with rows AND objects.
  it('is asked through the statement the loader runs', () => {
    expect(LPG_SUMMARY_SQL).toContain("WHERE kind = 'fuel'");
    expect(LPG_SUMMARY_SQL).toContain('GROUP BY 1');
    expect(LPG_SUMMARY_SQL).toContain('count(DISTINCT');
  });
});

describe('the canonical object id', () => {
  // 🔴 MUTATION: `a` → `w` as a string substitution. `a132953274` is way
  // 66476637 — areas are numbered way × 2 — and the substitution would
  // hand back a real, wrong way. normalise-export.mjs documents making
  // exactly this mistake once.
  it('halves an area id and does not just swap the letter', () => {
    const sql = canonicalRefSql('s.id');
    expect(sql).toContain('/ 2');
    expect(sql).toContain('% 2 = 0');
    expect(sql).toContain("'w' ||");
    expect(sql).toContain("'r' ||");
  });
});

// ── THE ORACLE AGREES WITH THE LOADER ON WHAT IT IS COUNTING ────────────
//
// scripts/osm-pipeline/count-rest-stops.mjs reads the raw extracts and is
// what the import is reconciled against. A `.mjs` cannot import this
// package's `.ts`, so it carries copies of two lists, and a copy that
// drifts is an oracle counting something the loader does not load.
describe('the raw-extract counter reads the same lists as the loader', () => {
  const source = readFileSync(join(SCRIPTS, 'count-rest-stops.mjs'), 'utf8');
  const listIn = (name: string): string[] => {
    const m = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\];`).exec(
      source,
    );
    expect(m).not.toBeNull();
    return [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };

  // 🔴 MUTATION: add 'permissive' to the list in count-rest-stops.mjs.
  it('excludes the same access values', () => {
    expect(listIn('ACCESS_EXCLUDED').sort()).toEqual(
      [...ACCESS_EXCLUDED].sort(),
    );
  });

  // 🔴 MUTATION: change one expression there, e.g. highway=rest_areas.
  it('asks osmium for the tags the three stopping kinds are built from', () => {
    const wanted = (['rest_area', 'service_area', 'dump'] as const).flatMap(
      (kind) =>
        STORED_POI_RULES[kind].flatMap((rule) =>
          rule.values.map((v) => `${rule.key}=${v}`),
        ),
    );
    expect(listIn('EXPRESSIONS').sort()).toEqual(wanted.sort());
  });

  it('asks about every facility tag the loader writes', () => {
    expect(listIn('FACILITY_TAGS').sort()).toEqual([...FACILITY_TAGS].sort());
  });

  // 🔴 CAMP-119 review, defect 3: the counter normalised before the list and
  // the loader did not, so the oracle counted a rule the loader never
  // applied. Reading both as TEXT cannot show that; this RUNS the counter —
  // `isAccessExcluded` and the `add()` that is supposed to call it — over
  // every spelling there is, in a child process (a `.mjs` is not something
  // this CommonJS spec can import), and compares with the loader's rule.
  //
  // 🔴 MUTATION: in count-rest-stops.mjs compare the raw access value, read
  // a list as excluded only when every part is, or stop `add()` calling it.
  describe('applies the same access rule, run on the same inputs', () => {
    const blanks = [...BLANK_CODE_POINTS].map((c) => String.fromCodePoint(c));
    const values: (string | null)[] = [
      null,
      ...ACCESS_EXCLUDED.flatMap((w) => [
        w,
        w.toUpperCase(),
        `${w[0].toUpperCase()}${w.slice(1)}`,
        ...blanks.flatMap((b) => [
          `${b}${w}`,
          `${w}${b}`,
          `${b}${w}${b}`,
          `customers${b};${b}${w}`,
          `${w}${b};${b}customers`,
        ]),
      ]),
      'private;customers',
      'customers;private',
      'delivery;private',
      'no;yes',
      'students;employees',
      'customers;visitors;members',
      'customers',
      'yes',
      'permissive',
      'students',
      'destination',
      'private road',
      'not_private',
      'privateer',
      '\u0085private',
      '\u200bno',
      ...blanks,
      '',
      ';',
    ];

    const asRun = (): { excluded: boolean; candidate: number }[] => {
      const url = pathToFileURL(join(SCRIPTS, 'count-rest-stops.mjs')).href;
      const out = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import { readFileSync } from 'node:fs';
           import { isAccessExcluded, add, emptyTally } from ${JSON.stringify(url)};
           const values = JSON.parse(readFileSync(0, 'utf8'));
           console.log(JSON.stringify(values.map((v) => {
             const t = emptyTally();
             add(t, { type: 'n', id: '1', tags: v === null ? { highway: 'rest_area' } : { highway: 'rest_area', access: v } });
             return { excluded: isAccessExcluded(v), candidate: t.rest_area.loaderCandidates };
           })));`,
        ],
        { input: JSON.stringify(values), encoding: 'utf8' },
      );
      return JSON.parse(out) as { excluded: boolean; candidate: number }[];
    };

    it("gives the loader's verdict on every spelling", () => {
      const run = asRun();
      expect(run).toHaveLength(values.length);
      const disagree = values
        .map((v, i) => ({
          v,
          oracle: run[i].excluded,
          loader: isAccessExcluded(v),
        }))
        .filter((d) => d.oracle !== d.loader);
      expect(disagree).toEqual([]);
      // both verdicts occur: a pair that said "false" everywhere would agree
      expect(run.filter((r) => r.excluded).length).toBeGreaterThan(100);
      expect(run.filter((r) => !r.excluded).length).toBeGreaterThan(20);
    });

    it('counts a node as a loader candidate exactly when the rule lets it in', () => {
      const run = asRun();
      const wrong = values
        .map((v, i) => ({
          v,
          candidate: run[i].candidate,
          excluded: isAccessExcluded(v),
        }))
        .filter((d) => d.candidate !== (d.excluded ? 0 : 1));
      expect(wrong).toEqual([]);
    });
  });
});

// 🔴 The filter and the column are written from ONE expression — that is
// what defect 3 broke (the filter read the raw tag, the column read
// `lower(btrim(...))`). The database spec asserts the VALUES; this keeps
// the two from being built apart again.
describe('the access filter and the access column', () => {
  const sql = buildRoutePoiInsertSql();
  const col = 's."access"';

  // 🔴 MUTATION: `s.access <> ALL ($2::text[])` — the filter as it was.
  it('filter the parts of the NORMALISED value', () => {
    expect(sql).toContain(
      `AND NOT coalesce(${tagPartsSql(col)} && $2::text[], false)`,
    );
    expect(sql).not.toMatch(/s\.access <> ALL/);
  });

  it('store the same normalised value the filter reads', () => {
    expect(sql).toContain(
      `coalesce(nullif(${normalisedSql(col)}, ''), 'unknown') AS access`,
    );
  });
});
