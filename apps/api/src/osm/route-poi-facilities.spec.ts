import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RoutePoiFacilities1791400000000 } from '../migrations/1791400000000-RoutePoiFacilities';
import { exportedTags } from './route-poi-export';
import {
  FACILITY_COLUMNS,
  FACILITY_TAGS,
  resolveTriState,
  resolveVerbatim,
  TRISTATE_COLUMNS,
  TRISTATE_FACILITIES,
  triStateSql,
  VERBATIM_FACILITIES,
} from './route-poi-facilities';
import {
  ACCESS_EXCLUDED,
  REST_STOP_KINDS,
  STORED_POI_RULES,
} from './route-poi';
import { buildRoutePoiInsertSql, canonicalRefSql } from './route-poi-sql';
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
});
