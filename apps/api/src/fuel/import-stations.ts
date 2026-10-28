// CAMP-154: fetch the three per-station fuel feeds, match them to the
// route POI layer, and write the prices.
//
//   npx ts-node src/fuel/import-stations.ts --report
//   npx ts-node src/fuel/import-stations.ts --from-dir /path/to/cached
//   npx ts-node src/fuel/import-stations.ts --dry-run
//
// 🔴 THE RUN RECONCILES BY CONSTRUCTION.
//
// `--report` prints, per source: records the feed contained, stations
// kept, records rejected ITEMISED BY REASON, and kept + rejected adding
// up to the feed's own count. A coverage number that does not reconcile
// is a number somebody will quote.
//
// 🔴 AND THE COVERAGE FIGURE IS NOT COMPUTED FROM THE COLUMN THAT MAY BE
// EMPTY. `fuel_station_prices.osm_ref` is nullable and the unmatched
// rows are stored, so "matched / total" is counted over rows that exist
// either way. A coverage figure derived only from the matched rows
// would confirm itself — this project has caught that shape four times
// in one day.
//
// 🔴 ONE BAD RECORD COSTS ONE RECORD. Nothing below aborts a country
// because a row is malformed; the parsers collect rejections and this
// file prints them. A single backwards date range aborted a 12 402-row
// import on this project today, which is the failure this rule exists
// for.

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';
import {
  FUEL_GRADES,
  isPriceDroppable,
  isPriceStale,
  MIN_MATCH_RATE,
  MIN_PRICES_PER_GRADE,
  MIN_STATIONS,
  parseFrance,
  parseItaly,
  parseSpain,
  PRICE_DROP_AFTER_DAYS,
  PRICE_STALE_AFTER_DAYS,
  SOURCES,
  type FuelGrade,
  type ParseResult,
  type Rejection,
  type Station,
} from './stations';
import {
  assignOneToOne,
  buildCandidateSql,
  MATCH_CANDIDATES,
  MATCH_RADIUS_M,
  type MatchCandidate,
} from './match';

const stationKey = (s: Station) => `${s.source}:${s.ref}`;

/**
 * Price rows per grade — the number the PAGE shows, as against the
 * station count the other floors use.
 *
 * 🔴 `FUEL_GRADES` rather than the keys actually present, so a grade
 * that has vanished entirely reports 0 and trips its floor, instead of
 * being absent from the object and silently skipped by the check.
 */
function countByGrade(stations: Station[]): Record<FuelGrade, number> {
  const out = Object.fromEntries(FUEL_GRADES.map((g) => [g, 0])) as Record<
    FuelGrade,
    number
  >;
  for (const s of stations) for (const p of s.prices) out[p.grade] += 1;
  return out;
}

/**
 * 🔴 A generous timeout and ONE attempt per URL.
 *
 * Spain's snapshot is 12.2 MB and took 16.7 s when measured; a 30 s
 * default would fail on a slow morning and the import would report an
 * empty country as though Spain had stopped publishing. No retry loop,
 * because these are read-only public endpoints with no key and a retry
 * that hides an outage is how a stale table survives a week.
 */
const FETCH_TIMEOUT_MS = 180_000;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json, text/csv, */*' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`${url} answered HTTP ${res.status}`);
  }
  return res.text();
}

/** Local cache file names, so a run can be repeated without three fetches. */
export const CACHE_FILES: Record<string, string[]> = {
  'es-minetur': ['es.json'],
  'fr-data-economie': ['fr.json'],
  'it-mimit': ['it-stations.csv', 'it-prices.csv'],
};

async function loadSource(
  sourceId: string,
  fromDir: string | null,
): Promise<string[]> {
  const source = SOURCES.find((s) => s.id === sourceId);
  if (!source) throw new Error(`unknown source ${sourceId}`);
  if (fromDir) {
    return Promise.all(
      CACHE_FILES[sourceId].map((f) => readFile(join(fromDir, f), 'utf8')),
    );
  }
  const out: string[] = [];
  for (const url of source.urls) out.push(await fetchText(url));
  return out;
}

export async function parseSource(
  sourceId: string,
  texts: string[],
  now: Date,
): Promise<ParseResult> {
  switch (sourceId) {
    case 'es-minetur':
      return parseSpain(JSON.parse(texts[0]), now);
    case 'fr-data-economie':
      return parseFrance(JSON.parse(texts[0]), now);
    case 'it-mimit':
      return parseItaly({ stations: texts[0], prices: texts[1] }, now);
    default:
      throw new Error(`unknown source ${sourceId}`);
  }
}

function itemise(rejections: Rejection[]): [string, number][] {
  const byReason = new Map<string, number>();
  for (const r of rejections) {
    // Collapse the variable part so the itemisation is readable: a
    // thousand distinct coordinates are one reason, not a thousand.
    const key = r.reason.replace(/[:(].*$/, '').trim();
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  return [...byReason.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Fetch, parse and VET one source: everything that can say "do not write
 * this one". It throws on a failed fetch, on a feed that does not
 * reconcile, and on a floor — and a throw here costs THAT source and no
 * other (see `gatherSources`).
 */
async function loadAndVet(
  source: (typeof SOURCES)[number],
  fromDir: string | null,
  now: Date,
): Promise<ParseResult> {
  const texts = await loadSource(source.id, fromDir);
  const result = await parseSource(source.id, texts, now);

  // 🔴 The reconciliation runs whether or not anybody asked for the
  // report, and it throws. Kept + rejected must equal what the feed
  // held; when it does not, some records went somewhere unnamed, and
  // every coverage figure downstream is quoting a denominator nobody
  // can account for.
  const rejectedStations = countRejectedStations(result);
  const accounted = result.stations.length + rejectedStations;
  if (accounted !== result.feedRecords) {
    throw new Error(
      `${source.id}: ${result.stations.length} kept + ${rejectedStations} rejected ` +
        `= ${accounted}, but the feed held ${result.feedRecords}`,
    );
  }

  // 🔴 A second reconciliation for a source whose prices live in their
  // own file. Italy's price list was checked against nothing at all;
  // see the note in parseItaly.
  if (result.priceRecords) {
    const pr = result.priceRecords;
    const seen = pr.kept + pr.unknownStation + pr.unknownProduct;
    if (seen !== pr.rows) {
      throw new Error(
        `${source.id}: price file has ${pr.rows} rows but ${seen} were accounted for`,
      );
    }
  }

  // 🔴 And a floor, because the reconciliation above passes perfectly
  // on an EMPTY feed: 0 kept + 0 rejected = 0 records. This import
  // replaces the source's rows, so a ministry serving a truncated file
  // would delete a country's prices and exit 0, and every page in
  // that country would say we hold no price. See MIN_STATIONS.
  const floor = MIN_STATIONS[source.id] ?? 0;
  if (result.stations.length < floor) {
    throw new Error(
      `${source.id}: only ${result.stations.length} stations, below the floor of ` +
        `${floor}. The endpoint answered, so this is a truncated or empty ` +
        `payload rather than an outage — nothing has been written. ` +
        `Check the feed before lowering this number.`,
    );
  }

  // 🔴 AND A FLOOR PER GRADE. A forecourt survives losing half its
  // prices, so the station floor above cannot see a grade disappear.
  // Renaming Italy's `Benzina` upstream halved the price rows with
  // every other counter unmoved. See MIN_PRICES_PER_GRADE.
  const perGrade = countByGrade(result.stations);
  const gradeFloors = MIN_PRICES_PER_GRADE[source.id];
  if (gradeFloors) {
    for (const grade of FUEL_GRADES) {
      if (perGrade[grade] < gradeFloors[grade]) {
        throw new Error(
          `${source.id}: only ${perGrade[grade]} ${grade} prices, below the floor ` +
            `of ${gradeFloors[grade]}. A grade does not halve on its own — check ` +
            `whether the source renamed the product before lowering this number. ` +
            `Nothing has been written.`,
        );
      }
    }
  }
  return result;
}

/** Why a source failed, with the network error's own cause when it has one. */
export function whyFailed(err: unknown): string {
  const e = err as {
    message?: string;
    cause?: { message?: string; code?: string };
  };
  const base = String(e?.message ?? err).split('\n')[0];
  const cause = e?.cause?.message ?? e?.cause?.code;
  return cause ? `${base} (${cause})` : base;
}

/**
 * 🔴 ONE SOURCE'S BAD DAY COSTS THAT SOURCE, NOT THE TABLE.
 *
 * Measured 28.10.2026 from the production machine: www.mimit.gov.it did
 * not answer a TCP connection at all (curl: connect timeout, http and
 * https, the site root too — from a second network as well). This loop
 * used to be inline in main() and let that throw escape, so Italy being
 * unreachable aborted the run before Spain and France were even read,
 * and 39 800 forecourts went stale because of the other 42 000. The same
 * rule the OSM workflow states for its matrix: one country's bad day
 * costs that country only.
 *
 * A failed source is not written and not deleted: its old rows stay,
 * dated, and the page already marks a price older than the stale line.
 * It is NOT quiet, though — the caller prints it, and the freshness check
 * reads the age of each source separately, so a source that stays unread
 * goes red there when it passes its budget.
 */
export async function gatherSources<S extends { id: string }>(
  sources: readonly S[],
  vet: (source: S) => Promise<ParseResult>,
): Promise<{
  ok: { source: S; result: ParseResult }[];
  failed: { source: S; why: string }[];
}> {
  const ok: { source: S; result: ParseResult }[] = [];
  const failed: { source: S; why: string }[] = [];
  for (const source of sources) {
    try {
      ok.push({ source, result: await vet(source) });
    } catch (err) {
      failed.push({ source, why: whyFailed(err) });
    }
  }
  return { ok, failed };
}

/** A run that read nothing has nothing to write — and says so by throwing. */
export function requireOneSource(
  parsed: readonly unknown[],
  failed: readonly { source: { id: string } }[],
): void {
  if (parsed.length > 0) return;
  throw new Error(
    `every source failed (${failed.map((f) => f.source.id).join(', ')}) — nothing has been written`,
  );
}

/**
 * The statement that makes room for a run's rows: only the sources that
 * were just read successfully. The same statement with no WHERE would take
 * a failed source's last good rows with it.
 */
export const DELETE_REFRESHED_SQL =
  'DELETE FROM fuel_station_prices WHERE source = ANY($1::text[])';

/** Every flag this script acts on. Anything else starting with `-` is a typo. */
export const KNOWN_FLAGS = ['--report', '--dry-run', '--from-dir'] as const;

/**
 * The arguments that are neither a known flag nor the value of `--from-dir`.
 *
 * 🔴 `--dryrun` used to be read as no flag at all, and a run the person
 * believed to write nothing replaced the table. The house rule (CAMP-285)
 * is that a flag the script does not know is an error, not a shrug.
 */
export function unknownArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--from-dir') {
      i += 1; // its value, whatever it looks like
      continue;
    }
    if ((KNOWN_FLAGS as readonly string[]).includes(a)) continue;
    out.push(a);
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const stray = unknownArgs(args);
  if (stray.length > 0) {
    throw new Error(
      `unknown argument(s): ${stray.join(' ')} — this script knows ${KNOWN_FLAGS.join(', ')}. ` +
        'Nothing has been read or written.',
    );
  }
  const report = args.includes('--report');
  const dryRun = args.includes('--dry-run');
  const dirFlag = args.indexOf('--from-dir');
  const fromDir = dirFlag >= 0 ? args[dirFlag + 1] : null;
  const now = new Date();

  const { ok: parsed, failed } = await gatherSources(SOURCES, (source) =>
    loadAndVet(source, fromDir, now),
  );
  for (const f of failed) {
    console.error(
      `✗ ${f.source.id}: ${f.why} — its rows are left as they were`,
    );
  }
  requireOneSource(parsed, failed);
  const all: Station[] = parsed.flatMap((p) => p.result.stations);

  if (dryRun) {
    console.log(`\nDry run: parsed ${all.length} stations, wrote nothing.`);
    return;
  }

  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev',
  });
  await client.connect();

  try {
    // 🔴 The whole write is one transaction. A route page reading this
    // table halfway through a swap would show a station's diesel and
    // its neighbour's petrol.
    await client.query('BEGIN');

    await client.query(`
      CREATE TEMP TABLE fuel_station_staging (
        station_key text PRIMARY KEY,
        country     char(2) NOT NULL,
        location    geometry(Point, 4326) NOT NULL
      ) ON COMMIT DROP
    `);

    // Batched inserts; 45 000 single statements is a minute of round trips.
    const BATCH = 1_000;
    for (let i = 0; i < all.length; i += BATCH) {
      const slice = all.slice(i, i + BATCH);
      const values: unknown[] = [];
      const tuples = slice.map((s, j) => {
        values.push(stationKey(s), s.country, s.lon, s.lat);
        const b = j * 4;
        return `($${b + 1}, $${b + 2}, ST_SetSRID(ST_MakePoint($${b + 3}::float8, $${b + 4}::float8), 4326))`;
      });
      await client.query(
        `INSERT INTO fuel_station_staging (station_key, country, location)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (station_key) DO NOTHING`,
        values,
      );
    }
    await client.query(
      'CREATE INDEX ON fuel_station_staging USING GIST (location)',
    );
    await client.query('ANALYZE fuel_station_staging');

    const candidates = await client.query<{
      station_key: string;
      osm_ref: string;
      metres: string;
    }>(buildCandidateSql(), [MATCH_CANDIDATES, MATCH_RADIUS_M]);

    const assignments = assignOneToOne(
      candidates.rows.map((r): MatchCandidate => ({
        stationKey: r.station_key,
        osmRef: r.osm_ref,
        metres: Number(r.metres),
      })),
    );
    const matched = new Map(assignments.map((a) => [a.stationKey, a]));

    // 🔴 THE REPORT IS PRINTED HERE, NOT IN THE PARSE LOOP, AND THAT IS
    // THE WHOLE POINT OF MOVING IT.
    //
    // `--report` used to run entirely BEFORE `client.connect()`, so it
    // structurally could not know a match count: it printed feed
    // records, kept, rejected and price rows, and no matched line at
    // all. The PR quoted per-country match rates and named `--report` as
    // the way to reproduce them, and the command could not produce them.
    // A figure nobody can re-derive from the branch is not a
    // measurement, so the report now runs after the join.
    for (const { source, result } of parsed) {
      const rejectedStations = countRejectedStations(result);
      const perGrade = countByGrade(result.stations);
      const hit = result.stations.filter((st) =>
        matched.has(stationKey(st)),
      ).length;
      // 🔴 How much of what we are about to publish is ALREADY past the
      // staleness line the page marks at. Not a failure — a forecourt
      // that files weekly is normal — but the number a human should see,
      // because a source going quiet shows up here long before it trips
      // any floor. `isPriceStale` had no caller outside its own spec,
      // which is how a rule ends up stated in two places and applied in
      // one.
      let stale = 0;
      for (const st of result.stations) {
        for (const pr of st.prices)
          if (isPriceStale(pr.measuredAt, now)) stale += 1;
      }
      const priceRows = result.stations.reduce(
        (a, st) => a + st.prices.length,
        0,
      );
      const rate =
        result.stations.length > 0 ? hit / result.stations.length : 0;

      if (report) {
        console.log(`\n── ${source.id} (${source.country}) ──`);
        console.log(
          `  snapshot stamp    ${result.snapshotAt?.toISOString() ?? '(none)'}`,
        );
        console.log(`  feed records      ${result.feedRecords}`);
        console.log(`  stations kept     ${result.stations.length}`);
        console.log(`  records rejected  ${rejectedStations}`);
        for (const [reason, n] of itemise(result.rejected)) {
          console.log(`    ${String(n).padStart(6)}  ${reason}`);
        }
        if (result.priceRecords) {
          const pr = result.priceRecords;
          console.log(`  price file rows   ${pr.rows}`);
          console.log(`    ${String(pr.kept).padStart(6)}  plain grade, kept`);
          console.log(
            `    ${String(pr.unknownProduct).padStart(6)}  other product (premium blend, gas)`,
          );
          console.log(
            `    ${String(pr.unknownStation).padStart(6)}  station not in the register`,
          );
        }
        for (const grade of FUEL_GRADES) {
          console.log(`  ${grade.padEnd(16)}  ${perGrade[grade]} prices`);
        }
        console.log(
          `  already stale     ${stale} of ${priceRows} price rows are older ` +
            `than ${PRICE_STALE_AFTER_DAYS} days and will render marked`,
        );
        console.log(
          `  matched           ${hit} of ${result.stations.length} ` +
            `(${(rate * 100).toFixed(1)}%) to an osm_route_poi fuel point ` +
            `within ${MATCH_RADIUS_M} m`,
        );
      }

      // 🔴 THE FLOOR ON THE OTHER SIDE OF THE JOIN.
      //
      // `osm_route_poi` is rebuilt weekly by a DIFFERENT job (CAMP-28,
      // with `-overwrite`), and these prices are worth nothing without
      // it. Emptying that table and re-running this import wrote 39 216
      // price rows, matched 0 stations and exited 0 — after which every
      // fuel row in three countries reads "We hold no price for this
      // station", which is exactly the failure every other floor here
      // exists to prevent, arriving through the one door that had none.
      //
      // Checked inside the transaction and before the write, so a
      // collapsed join rolls back rather than replacing a good table
      // with an unjoinable one.
      if (rate < MIN_MATCH_RATE) {
        throw new Error(
          `${source.id}: only ${hit} of ${result.stations.length} stations ` +
            `(${(rate * 100).toFixed(1)}%) matched an osm_route_poi fuel point, ` +
            `below the floor of ${(MIN_MATCH_RATE * 100).toFixed(0)}%. The prices ` +
            `parsed cleanly, so look at osm_route_poi — it is rebuilt by a ` +
            `separate weekly job and nothing here owns it. Nothing has been written.`,
        );
      }
    }

    // 🔴 DELETE then INSERT inside the transaction, not UPSERT.
    //
    // A station that has stopped publishing must LOSE its price, not
    // keep last week's for ever. An upsert leaves the old row in place
    // and nothing on the page says it was not refreshed — which is the
    // shape of a stale table that looks healthy. Readers see either the
    // old set or the new one, never a mixture.
    await client.query(DELETE_REFRESHED_SQL, [parsed.map((p) => p.source.id)]);

    let written = 0;
    const rows: unknown[][] = [];
    let droppedAsExpired = 0;
    for (const s of all) {
      const m = matched.get(stationKey(s));
      for (const p of s.prices) {
        // 🔴 The staleness rule enforced at the DATA boundary as well as
        // at the page. `isPriceDroppable` had no caller outside its own
        // spec — a rule stated in two places and applied in one — so a
        // price the page will never show still sat in a public API's
        // table waiting for a caller who does not run the web app's
        // filter. It also returns true on an Invalid Date now, which is
        // the direction it must fail in.
        if (isPriceDroppable(p.measuredAt, now)) {
          droppedAsExpired += 1;
          continue;
        }
        rows.push([
          s.source,
          s.ref,
          p.grade,
          s.country,
          p.product,
          p.price,
          p.measuredAt,
          now,
          s.lon,
          s.lat,
          s.name,
          m?.osmRef ?? null,
          m ? m.metres : null,
        ]);
      }
    }
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const values: unknown[] = [];
      const tuples = slice.map((r, j) => {
        values.push(...r);
        const b = j * 13;
        return (
          `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, ` +
          `$${b + 7}, $${b + 8}, ` +
          `ST_SetSRID(ST_MakePoint($${b + 9}::float8, $${b + 10}::float8), 4326), ` +
          `$${b + 11}, $${b + 12}, $${b + 13})`
        );
      });
      await client.query(
        `INSERT INTO fuel_station_prices
           (source, station_ref, grade, country, product, price_eur,
            measured_at, fetched_at, location, station_name, osm_ref, match_metres)
         VALUES ${tuples.join(', ')}`,
        values,
      );
      written += slice.length;
    }

    await client.query('COMMIT');
    console.log(
      `\nWrote ${written} price rows for ${all.length} stations; ` +
        `${matched.size} stations matched an osm_route_poi fuel point ` +
        `within ${MATCH_RADIUS_M} m` +
        (droppedAsExpired > 0
          ? `; ${droppedAsExpired} price rows dropped as older than ` +
            `${PRICE_DROP_AFTER_DAYS} days`
          : '') +
        `.`,
    );
    // 🔴 SAID AFTER THE COMMIT, LOUDLY, AND NOT AS AN EXIT CODE — on
    // purpose. A source that stays unread is not a quiet day, but a
    // transient outage of one ministry's server is not a failed run either:
    // the other sources were written. What must not happen is that nobody
    // learns Italy has been stale for a month, and that is the freshness
    // check's job, per source (`check-data-freshness.mjs`, `groupBy`): it
    // goes red when the OLDEST source is past its 2-day budget. Failing the
    // unit as well would send the owner two letters a day about one
    // outage, from two sentries, and the second would be read as noise.
    if (failed.length > 0) {
      console.error(
        `\n${failed.length} of ${SOURCES.length} sources were NOT refreshed: ` +
          failed.map((f) => f.source.id).join(', ') +
          ' — their rows are as they were; the freshness check names the age',
      );
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

/**
 * How many of the feed's own records ended as a rejection.
 *
 * 🔴 Counted by distinct ref, not by rejection, because one station can
 * raise two (a bad diesel price and a bad petrol price) and double
 * counting would make kept + rejected exceed the feed's record count —
 * the reconciliation would then never balance and nobody would trust it.
 */
function countRejectedStations(result: ParseResult): number {
  const refs = new Set<string>();
  const kept = new Set(result.stations.map((s) => s.ref));
  for (const r of result.rejected) if (!kept.has(r.ref)) refs.add(r.ref);
  return refs.size;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
