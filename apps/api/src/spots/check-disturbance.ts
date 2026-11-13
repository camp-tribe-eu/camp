// CAMP-502: is the «Possible disturbance» block actually drawn anywhere?
//
//   cd apps/api
//   npx ts-node src/spots/check-disturbance.ts          # measure the database
//   node dist/spots/check-disturbance.js                # the same, on the machine
//
// 🔴 WHY THIS SENTRY EXISTS (review of #557). The migration creates
// `osm_ctx_hazard` EMPTY so that a deploy does not break the campsite page,
// and an empty table means "no computed distance", and the page then draws no
// block. Correct — and silent: after a deploy the block is missing on every
// one of the campsite pages, exactly as it is for a campsite that really has
// nothing near it. Only a count in the database tells the two apart.
//
// 🔴 IT MEASURES THE DATABASE WITH THE PAGE'S OWN SQL. `disturbanceSql` and
// `DISTURBANCE_FILTER` are imported, not copied: a copy of the rule would go on
// counting rows the page had stopped reading.
//
// 🔴 THE DENOMINATOR IS ALWAYS PRINTED, IN GREEN TOO: «block on 9 114 of
// 57 128 campsites with a page». "0 of 0" is not green — it is a sentry that
// lost its subject.
//
// WHAT TURNS IT RED:
//   • the layer has no rows at all, or no rows of one kind (a layer with
//     roads and railways and no airport is a broken export, not a continent);
//   • no campsite has the block;
//   • a country with at least MIN_COUNTRY_LIVE campsites has the block on
//     none of them. That is the loader's oldest trap: load one country and the
//     other twenty-six are silently gone (load-context.sh, "PASS EVERY
//     REGION"). At the measured rates (road 13%, rail 23% within 1 km) a
//     hundred campsites with zero blocks does not happen by itself.
//
// WHERE IT RUNS: on the machine, daily, from
// infra/systemd/camptribe-disturbance-check.timer. Not in CI against the
// fixture: the fixture holds a handful of rows by design.
//
// Read-only by construction (one READ ONLY transaction, read-only.ts).

import 'dotenv/config';
import { Client } from 'pg';
import { inReadOnlyTransaction, Queryable } from '../planner/read-only';
import { plannerPopulationSql } from '../planner/population';
import {
  DISTURBANCE_FILTER,
  DISTURBANCE_KINDS,
  DisturbanceKind,
  disturbanceSql,
} from './disturbance';

/** A country with fewer campsites than this may honestly have no block. */
export const MIN_COUNTRY_LIVE = 100;

export interface DisturbanceCoverage {
  /** Rows in `osm_ctx_hazard`. */
  rows: number;
  /** Rows the page's own filter keeps, per kind. */
  byKind: Record<DisturbanceKind, number>;
  /** Per country: campsites that have a page, and those with the block. */
  countries: Array<{ country: string; live: number; drawn: number }>;
}

const int = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`the database answered ${JSON.stringify(v)}, not a count`);
  return n;
};

export const LAYER_SQL = `SELECT count(*)::text AS rows, ${DISTURBANCE_KINDS.map(
  (k) => `count(*) FILTER (WHERE ${DISTURBANCE_FILTER[k]})::text AS ${k}`,
).join(', ')} FROM osm_ctx_hazard x`;

export const COVERAGE_SQL = `
  SELECT s.country,
         count(*)::text AS live,
         count(*) FILTER (WHERE jsonb_array_length(d.v) > 0)::text AS drawn
    FROM camping_spots s
   CROSS JOIN LATERAL (SELECT ${disturbanceSql('s.location')} AS v) d
   WHERE ${plannerPopulationSql('s')}
   GROUP BY s.country
   ORDER BY s.country`;

export async function measure(db: Queryable): Promise<DisturbanceCoverage> {
  const layer = (await db.query(LAYER_SQL)).rows[0];
  const byKind = {} as Record<DisturbanceKind, number>;
  for (const k of DISTURBANCE_KINDS) byKind[k] = int(layer[k]);
  const countries = (await db.query(COVERAGE_SQL)).rows.map((r) => ({
    country: String(r.country),
    live: int(r.live),
    drawn: int(r.drawn),
  }));
  return { rows: int(layer.rows), byKind, countries };
}

const fmt = (n: number): string => n.toLocaleString('en-GB').replace(/,/g, ' ');

/** The verdict for one measurement. Every line carries its denominator. */
export function verdict(c: DisturbanceCoverage): {
  ok: boolean;
  lines: string[];
} {
  const live = c.countries.reduce((a, x) => a + x.live, 0);
  const drawn = c.countries.reduce((a, x) => a + x.drawn, 0);
  const kinds = DISTURBANCE_KINDS.map((k) => `${k} ${fmt(c.byKind[k])}`).join(
    ', ',
  );
  const big = c.countries.filter((x) => x.live >= MIN_COUNTRY_LIVE);
  const dark = big.filter((x) => x.drawn === 0);
  const layer = `layer osm_ctx_hazard: ${fmt(c.rows)} rows, of which the page reads ${kinds}`;
  const block = `block on ${fmt(drawn)} of ${fmt(live)} campsites with a page`;
  const lit = `countries with the block: ${big.length - dark.length} of ${big.length} that have ${MIN_COUNTRY_LIVE}+ campsites`;

  const red: string[] = [];
  if (live === 0)
    red.push(
      `✗ 0 campsites with a page — the sentry has nothing to measure (${block})`,
    );
  if (c.rows === 0)
    red.push(
      `✗ osm_ctx_hazard is EMPTY (0 rows): «Possible disturbance» is drawn on 0 of ${fmt(live)} campsite pages. ` +
        'Fill it: scripts/osm-pipeline/load-hazard.mjs (docs/data-path-to-production.md, «Шар hazard»)',
    );
  else {
    for (const k of DISTURBANCE_KINDS)
      if (c.byKind[k] === 0)
        red.push(
          `✗ the layer holds no ${k} the page would read (0 of ${fmt(c.rows)} rows) — a broken export, not a continent without one`,
        );
    if (live > 0 && drawn === 0)
      red.push(
        `✗ the layer has ${fmt(c.rows)} rows and still the ${block}: the rows are not where the campsites are`,
      );
    else if (dark.length > 0)
      red.push(
        `✗ no block in ${dark.length} of ${big.length} countries with ${MIN_COUNTRY_LIVE}+ campsites: ` +
          dark.map((x) => `${x.country} (0 of ${fmt(x.live)})`).join(', ') +
          ' — the layer was loaded without them; pass EVERY region to load-context.sh',
      );
  }
  if (red.length > 0) return { ok: false, lines: [...red, `  ${layer}`] };
  return { ok: true, lines: [`✓ ${block}; ${lit}; ${layer}`] };
}

export async function main(argv: string[]): Promise<number> {
  if (argv.length > 0) {
    console.error(
      `usage: check-disturbance.ts  (takes no arguments, got: ${argv.join(' ')})`,
    );
    return 2;
  }
  if (!process.env.DATABASE_URL) {
    console.error(
      '✗ DATABASE_URL is not set: the sentry would have gone blind quietly',
    );
    return 2;
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let c: DisturbanceCoverage;
  try {
    c = await inReadOnlyTransaction(client, () => measure(client));
  } finally {
    await client.end();
  }
  const v = verdict(c);
  for (const l of v.lines) (v.ok ? console.log : console.error)(l);
  return v.ok ? 0 : 1;
}

// Guarded like every other script here: an import must not run it.
if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}
