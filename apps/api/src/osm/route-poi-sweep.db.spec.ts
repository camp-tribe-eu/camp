import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import type { QueryRunner } from 'typeorm';
import { RoutePoi1790572800000 } from '../migrations/1790572800000-RoutePoi';
import { RoutePoiFacilities1791400000000 } from '../migrations/1791400000000-RoutePoiFacilities';
import { RoutePoiGas1791700000000 } from '../migrations/1791700000000-RoutePoiGas';
import {
  ACCESS_EXCLUDED,
  listRulesError,
  type ListRulesSummary,
  STORED_POI_KINDS,
  STORED_POI_RULES,
} from './route-poi';
import { exportedTags } from './route-poi-export';
import {
  buildRoutePoiInsertSql,
  EU_SQL_LIST,
  listRulesSummarySql,
} from './route-poi-sql';

// CAMP-327 — THE ORACLE AND THE SQL, ON THE SAME TAGS: about nine hundred of
// them, each in the shape OpenStreetMap writes it.
//
// scripts/osm-pipeline/count-list-tags.mjs is a second implementation of the
// rules in JavaScript — it counts the raw extracts the reload is reconciled
// against — and two implementations of one rule only help when they are made to
// disagree out loud. route-poi-facilities.spec.ts compares its rules with
// STORED_POI_RULES as DATA; this runs it, and compares what it ANSWERS with
// what the loader's SQL answers over a real PostgreSQL.
//
// 🔴 A SEPARATE FILE, with a staging table of its own. route-poi-sql.db.spec.ts
// counts its fixtures by hand — gas rows, flags, the guard's per-kind numbers —
// and nine hundred more objects, most of them deliberately refused shapes, would
// change every one of those numbers. Here the staging table holds the sweep and
// nothing else, so the sweep's statistics are the sweep's.
//
// 🔴 IT TOUCHES NOTHING THAT IS NOT ITS OWN: a schema made for this process and
// dropped afterwards, first on the search_path, as every database spec here.
// An unreachable database is a FAILING spec, not a skipped one.

jest.setTimeout(120_000);

const URL =
  process.env.CI_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://localhost:5432/camptribe_dev';

const SCHEMA = `camp327_sweep_${process.pid}`;

type Tags = Record<string, string>;

/**
 * Every (key, value) of the loader in thirteen shapes: the word alone, first,
 * last, behind a blank, in capitals, with a trailing or a leading `;`, in a `,`
 * list (both ends), inside another word (both ends), followed by a space, and
 * as `key=value` — the shapes the card's own data holds.
 */
const SHAPES: readonly ((v: string) => string)[] = [
  (v) => v,
  (v) => `${v};bench`,
  (v) => `bench;${v}`,
  (v) => `bench; ${v}`,
  (v) => ` ${v.toUpperCase()} `,
  (v) => `${v};`,
  (v) => `;${v}`,
  (v) => `${v},bench`,
  (v) => `bench,${v}`,
  (v) => `x_${v}`,
  (v) => `${v}_x`,
  (v) => `${v} bench`,
  (v) => `key=${v}`,
];

/**
 * The pairs come from STORED_POI_RULES — that is only what to WRITE. What each
 * must COME OUT AS is asked of the oracle, which is not derived from them: the
 * expectation is an independent implementation, run below.
 */
const PAIRS: (readonly [string, string])[] = STORED_POI_KINDS.flatMap((kind) =>
  STORED_POI_RULES[kind].flatMap((r) =>
    r.values.map((v) => [r.key, v] as const),
  ),
);

/**
 * One tag set per case: each pair in each shape, then every ordered pair of
 * pairs — as ONE list when the key is the same (`fuel;restaurant`: the CASE
 * order decides), as TWO tags when it is not (`amenity=fuel;bench` beside
 * `shop=supermarket`: the CASE order decides again).
 */
const TAG_SETS: Tags[] = (() => {
  const sets: Tags[] = [];
  for (const [key, v] of PAIRS) {
    for (const shape of SHAPES) sets.push({ [key]: shape(v) });
  }
  for (const [k1, v1] of PAIRS) {
    for (const [k2, v2] of PAIRS) {
      sets.push(
        k1 === k2 ? { [k1]: `${v1};${v2}` } : { [k1]: `${v1};bench`, [k2]: v2 },
      );
    }
  }
  return sets;
})();

const idOf = (i: number) => `n${String(i + 1).padStart(5, '0')}`;

describe('the oracle and the loader, on the same tags', () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({ connectionString: URL });
    await db.connect();
    await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
    await db.query(`CREATE SCHEMA ${SCHEMA}`);
    await db.query(`SET search_path = ${SCHEMA}, public`);

    const qr = {
      query: (sql: string) => db.query(sql),
    } as unknown as QueryRunner;
    await new RoutePoi1790572800000().up(qr);
    await new RoutePoiFacilities1791400000000().up(qr);
    await new RoutePoiGas1791700000000().up(qr);

    await db.query(
      `CREATE TABLE ne_admin1 (geom geometry(MultiPolygon, 4326), iso_a2 text, admin text)`,
    );
    await db.query(
      `INSERT INTO ne_admin1
       VALUES (ST_Multi(ST_MakeEnvelope(13, 45, 17, 47, 4326)), 'SI', 'Slovenia')`,
    );
    const tagColumns = exportedTags()
      .map((t) => `"${t}" text`)
      .join(', ');
    await db.query(
      `CREATE TABLE osm_route_poi_staging (id text, geom geometry, ${tagColumns})`,
    );

    // one statement per tag set, over the columns it names; 900 rows
    for (let i = 0; i < TAG_SETS.length; i++) {
      const tags = TAG_SETS[i];
      const cols = Object.keys(tags);
      await db.query(
        `INSERT INTO osm_route_poi_staging (id, geom, ${cols.map((c) => `"${c}"`).join(', ')})
         VALUES ($1, ST_Multi(ST_GeomFromText($2, 4326)), ${cols.map((_, j) => `$${j + 3}`).join(', ')})`,
        [
          idOf(i),
          // spread out, inside the box: no two rows share a place
          `POINT(${13.2 + (i % 70) * 0.05} ${45.2 + Math.floor(i / 70) * 0.05})`,
          ...cols.map((c) => tags[c]),
        ],
      );
    }
    await db.query(buildRoutePoiInsertSql(), [
      new Date().toISOString(),
      ACCESS_EXCLUDED,
      EU_SQL_LIST,
    ]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.query('RESET search_path');
    await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await db.end();
  });

  /** The oracle's answer for every tag set — run, in a child process. */
  const oracleKinds = (): (string | null)[] => {
    const url = pathToFileURL(
      join(__dirname, '../../../../scripts/osm-pipeline/count-list-tags.mjs'),
    ).href;
    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { readFileSync } from 'node:fs';
         import { kindOf } from ${JSON.stringify(url)};
         const sets = JSON.parse(readFileSync(0, 'utf8'));
         console.log(JSON.stringify(sets.map((t) => kindOf(t, 'list'))));`,
      ],
      { input: JSON.stringify(TAG_SETS), encoding: 'utf8' },
    );
    return JSON.parse(out) as (string | null)[];
  };

  // 🔴 THE TWO IMPLEMENTATIONS, MADE TO DISAGREE OUT LOUD: the SQL the loader
  // runs and the JavaScript the reload is reconciled with. A disagreement is
  // one of them reading a tag the other does not — the oracle counting a number
  // the loader never produces, or the loader taking something the oracle's
  // reconciliation would call an error.
  //
  // MUTATION: change one rule's key in count-list-tags.mjs, or its `;` split
  // (a `,`), or the order of its RULES; or put an `IN (…)` into one rule of
  // rulesTestSql; or read a `,` as a separator in tagPartsSql.
  it('gives, for every shape of every value, the kind the oracle gives', async () => {
    const oracle = oracleKinds();
    expect(oracle).toHaveLength(TAG_SETS.length);
    const stored = new Map(
      (
        await db.query<{ osm_ref: string; kind: string }>(
          `SELECT osm_ref, kind FROM osm_route_poi`,
        )
      ).rows.map((r) => [r.osm_ref, r.kind]),
    );
    const disagree = TAG_SETS.flatMap((tags, i) =>
      (stored.get(idOf(i)) ?? null) === oracle[i]
        ? []
        : [
            `${idOf(i)} ${JSON.stringify(tags)}: sql ${stored.get(idOf(i)) ?? 'no row'}, oracle ${oracle[i]}`,
          ],
    );
    expect(disagree).toEqual([]);

    // Both answers occur, in numbers: two implementations that said "nothing"
    // for everything would agree. Counted by hand from the shapes, not from
    // the run: six of the thirteen shapes are NOT lists of ours (`x_v`, `v_x`,
    // `key=v`, `v,bench`, `bench,v`, `v bench`), and there are 18 values, so
    // 108 single-word objects are refused; the other seven shapes are taken,
    // and so is every one of the 18 × 18 combinations (a word of ours is in
    // each). 18 × 13 + 18 × 18 = 558 objects.
    const taken = oracle.filter((k) => k !== null);
    expect(TAG_SETS).toHaveLength(558);
    expect(oracle.length - taken.length).toBe(108);
    expect(taken.length).toBe(450);
    expect(new Set(taken).size).toBe(STORED_POI_KINDS.length);
  });

  // The check of the rule, over the same objects: for every one of them the
  // CASE and the guard's second reading agree, so `missed` and `extra` — the
  // two that fail at any count — are zero for every kind; and `wide_only`,
  // which is data, is NOT, because the sweep is full of `,` lists and words
  // inside words and says so. A guard that answered zero for everything would
  // be as green as one that was working.
  it('agrees with the guard: nothing missed, nothing extra, and the refusals are counted', async () => {
    const rows = (await db.query<ListRulesSummary>(listRulesSummarySql())).rows;
    expect(rows).toHaveLength(STORED_POI_KINDS.length);
    for (const r of rows) {
      expect(`${r.kind} missed ${r.missed} extra ${r.extra}`).toBe(
        `${r.kind} missed 0 extra 0`,
      );
      expect(Number(r.listed)).toBeGreaterThan(5);
      expect(Number(r.wide_only)).toBeGreaterThan(5);
    }
    // …and the ONLY thing that fails is the systematic share of spellings
    // nobody reads — which is what it is for. By hand: each value is written
    // in six refused shapes, so a kind of N values has 6 × N objects that
    // mention it and are not taken, and the floor is 10: water (3 values),
    // food (3), shelter (4) and groceries (2) are over it, the six kinds of
    // one value (6 objects) are not. One odd record never costs a run.
    const error = listRulesError(rows) ?? '';
    for (const [kind, n] of [
      ['water', 18],
      ['food', 18],
      ['shelter', 24],
      ['groceries', 12],
    ] as const) {
      expect(error).toContain(`${kind}: ${n} of `);
    }
    for (const kind of [
      'fuel',
      'charging',
      'dump',
      'rest_area',
      'service_area',
      'gas_exchange',
    ]) {
      expect(error).not.toContain(`${kind}: `);
    }
    expect(error).not.toMatch(/staged objects say its words/);
    expect(error).not.toMatch(/objects were made/);
  });
});
