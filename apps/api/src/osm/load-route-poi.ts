// CAMP-113: staging rows → osm_route_poi.
//
//   cd apps/api && npx ts-node src/osm/load-route-poi.ts
//
// Normally run for you by scripts/osm-pipeline/load-route-poi.sh, which
// produces the staging table this reads.
//
// 🔴 CAMP-119: this now loads the stopping places (`rest_area`,
// `service_area`) and the facility tags (toilets, shower, fee, …) of
// every row, as yes / no / unknown — see route-poi-facilities.ts. The
// statement itself is buildRoutePoiInsertSql in route-poi-sql.ts, so a
// spec runs exactly what runs here. It prints the `dump` count together
// with the formula that makes it a count of OSM objects.
//
// 🔴 CAMP-258 added `gas_exchange` (`shop=gas`, stored and not served) and
// the `lpg` column (`fuel:lpg`, yes / no / unknown). The per-kind check
// below covers the first — a kind nobody filters for loads nothing and
// the run rolls back — and `lpgArrivalError` covers the second.
//
// 🔴 One statement, inside one transaction, and never a TRUNCATE
// followed by an INSERT outside one. The API is reading this table while
// the weekly import runs; a truncate that is visible before its insert
// finishes is a route page that renders "no fuel station within 25 km"
// for a minute and a half, which is a false statement about the ground
// rather than an outage anybody would notice.

import 'dotenv/config';
import { Client } from 'pg';
import {
  ACCESS_EXCLUDED,
  DUMP_FORMULA,
  REST_STOP_KINDS,
  STORED_POI_KINDS,
} from './route-poi';
import { ensureStagingColumns, exportedTags } from './route-poi-export';
import {
  lpgArrivalError,
  type LpgSummaryRow,
  TRISTATE_COLUMNS,
} from './route-poi-facilities';
// 🔴 The SQL lives in its own file so it can be unit-tested — a script
// that opens a database connection on import cannot be. See the header
// of route-poi-sql.ts for what got through while it could not.
import {
  buildRoutePoiInsertSql,
  EU_SQL_LIST,
  euLeakGuardSql,
  LPG_SUMMARY_SQL,
} from './route-poi-sql';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  try {
    const staged = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM osm_route_poi_staging`,
    );
    if (Number(staged.rows[0].n) === 0) {
      throw new Error(
        'osm_route_poi_staging is empty — run scripts/osm-pipeline/load-route-poi.sh first',
      );
    }

    await db.query('BEGIN');

    // 🔴 An UPSERT keyed on the OSM ref, plus a delete of what this run
    // did not see — not a truncate. The point is that `last_seen_at` on
    // a row that is still there keeps meaning "our import found it", and
    // a re-run of the same extract does not rewrite 2 248 490 rows.
    const runAt = new Date().toISOString();
    // 🔴 Columns first; see `ensureStagingColumns`. Done inside the
    // transaction, so a failed run leaves no trace on the staging table.
    const absent = await ensureStagingColumns(db, exportedTags());
    if (absent.length > 0) {
      console.log(
        `  no feature in this extract carries: ${absent.join(', ')} ` +
          `(columns added empty, so every row says 'unknown' for them)`,
      );
    }

    const inserted = await db.query(buildRoutePoiInsertSql(), [
      runAt,
      ACCESS_EXCLUDED,
      EU_SQL_LIST,
    ]);

    const gone = await db.query(
      `DELETE FROM osm_route_poi WHERE last_seen_at < $1::timestamptz`,
      [runAt],
    );

    // 🔴 Every kind must have arrived, and the check is inside the
    // transaction so a kind that came back empty rolls the whole thing
    // back rather than being published.
    //
    // This is the guard for the one failure that cannot be seen from a
    // page: the shell script's tag list and STORED_POI_RULES drifting
    // apart. A kind nobody filters for does not break anything — it just
    // quietly says "we hold no charging station within 25 km" on every
    // route in Europe, which reads exactly like an honest gap.
    const byKind = await db.query<{ kind: string; n: string }>(
      `SELECT kind, count(*)::text AS n FROM osm_route_poi GROUP BY kind`,
    );
    const counts = new Map(byKind.rows.map((r) => [r.kind, Number(r.n)]));
    const empty = STORED_POI_KINDS.filter((k) => !counts.get(k));
    if (empty.length > 0) {
      throw new Error(
        `these kinds loaded nothing: ${empty.join(', ')} — the tag list in ` +
          `scripts/osm-pipeline/load-route-poi.sh and STORED_POI_RULES in ` +
          `src/osm/route-poi.ts have drifted apart`,
      );
    }

    // 🔴 CAMP-258: DID `fuel:lpg` ARRIVE. `unknown` is the right answer for
    // 82% of fuel stations, so a column that is `unknown` on all of them
    // looks exactly like a column that was read. The only tell is a fuel
    // population with no `yes` in it — see lpgArrivalError.
    const lpgSummary = await db.query<LpgSummaryRow>(LPG_SUMMARY_SQL);
    const lpgFailure = lpgArrivalError(lpgSummary.rows);
    if (lpgFailure !== null) throw new Error(lpgFailure);
    const lpgBy = new Map<string, LpgSummaryRow>(
      lpgSummary.rows.map((r) => [r.state, r]),
    );

    // 🔴 CAMP-118, CHECKED AGAINST THE GEOMETRY AND NOT AGAINST THE
    // COLUMN THE IMPORT JUST WROTE.
    //
    // The previous check here read `country <> ALL(members)`. Against
    // the live table it returned 0 while 423 foreign rows sat in it,
    // because every one of them had a NULL country and `NULL <> ALL(…)`
    // is NULL, not true. It fired for the blunt break — remove the
    // filter, get "2 268 rows outside the EU-27" — and was blind to the
    // only path anything actually came through. That is the same shape
    // as the failure eu.ts records from CAMP-118: a safeguard that
    // consults the thing it is meant to check.
    //
    // This one drives out from the non-member polygons and compares
    // distances itself, so it does not care what `country` says. It was
    // rehearsed against the live table BEFORE the fix and reported 423,
    // naming Northern Cyprus, the United Kingdom, Monaco, Turkey,
    // Bosnia, Gibraltar and Akrotiri.
    const leaked = await db.query<{
      osm_ref: string;
      name: string | null;
      admin: string;
      foreign_m: string;
      member_m: string;
    }>(euLeakGuardSql('$1'), [EU_SQL_LIST]);
    // (the guard deliberately does not select `country` — see its header)
    if (leaked.rows.length > 0) {
      throw new Error(
        `rows nearer a non-member than the Union reached the table: ` +
          leaked.rows
            .map(
              (r) =>
                `${r.osm_ref} (${r.name ?? 'unnamed'}) ${r.foreign_m} m from ` +
                `${r.admin}, ${r.member_m} m from the Union`,
            )
            .join('; '),
      );
    }

    // 🔴 And the cheap half, kept as well as the geometric one: a NULL
    // country. The column is NOT NULL so this cannot happen — which is
    // exactly why it is asserted, because the day somebody makes it
    // nullable again to "handle coastal points" this is the line that
    // says what that costs.
    const nulls = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM osm_route_poi WHERE country IS NULL`,
    );
    if (Number(nulls.rows[0].n) > 0) {
      throw new Error(
        `${nulls.rows[0].n} rows have no country — the NULL exception is back`,
      );
    }

    await db.query('COMMIT');
    await db.query('ANALYZE osm_route_poi');

    console.log(`  written: ${inserted.rowCount}, removed: ${gone.rowCount}`);
    for (const kind of STORED_POI_KINDS) {
      console.log(`    ${kind.padEnd(13)} ${counts.get(kind)}`);
    }
    // 🔴 The number and the formula that produced it, together. A card
    // once quoted 17 579 for this and no formula reproduces it.
    console.log(`  dump = ${counts.get('dump')}  (${DUMP_FORMULA})`);

    // CAMP-258: what the fuel stations say about LPG. Rows and objects,
    // because only the latter is comparable with a count of OSM objects.
    console.log(
      `  fuel lpg (rows / objects): ` +
        ['yes', 'no', 'unknown']
          .map(
            (st) =>
              `${st} ${lpgBy.get(st)?.rows ?? 0} / ${lpgBy.get(st)?.objects ?? 0}`,
          )
          .join('  '),
    );

    // What the stopping places say about themselves — three words, and
    // the third is not a gap. `unknown` is the answer for most of them.
    const kinds = REST_STOP_KINDS.map((k) => `'${k}'`).join(', ');
    for (const column of TRISTATE_COLUMNS) {
      const states = await db.query<{ kind: string; state: string; n: string }>(
        `SELECT kind, ${column} AS state, count(*)::text AS n
           FROM osm_route_poi WHERE kind IN (${kinds})
          GROUP BY 1, 2 ORDER BY 1, 2`,
      );
      const by = new Map<string, Record<string, string>>();
      for (const r of states.rows) {
        by.set(r.kind, { ...(by.get(r.kind) ?? {}), [r.state]: r.n });
      }
      for (const [kind, st] of by) {
        console.log(
          `    ${kind.padEnd(13)} ${column.padEnd(22)} ` +
            `yes ${st.yes ?? 0}  no ${st.no ?? 0}  unknown ${st.unknown ?? 0}`,
        );
      }
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await db.end();
  }
}

// Guarded like every other script here: an import must not run it.
if (require.main === module) {
  main().catch((err) => {
    console.error(
      `::error::${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
