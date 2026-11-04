// CAMP-168: put the EU's bathing waters into the database.
//
//   npx ts-node src/bathing/import.ts              # dry run
//   npx ts-node src/bathing/import.ts --apply
//   npx ts-node src/bathing/import.ts --file bw.json --apply
//
// 🔴 A dry run by default, like every other importer here. This writes an
// OFFICIAL CLASSIFICATION onto pages that rank, and the reader who acts
// on a wrong one finds out standing in the water.
//
// 🔴 ONE BAD RECORD COSTS ONE RECORD. Every refusal is counted by reason
// and the rest of the import continues; nothing here aborts a run of
// 22 010 rows because one of them is malformed. The two things that DO
// abort are a short read from the server (fetch.ts) and a total that
// does not reconcile (below) — both are failures of the whole, not of a
// row.
//
// 🔴 CAMP-440: AND THE SOURCE BEING DOWN IS NEITHER. A 5xx or an
// unreachable host after every retry is `UpstreamUnavailable`
// (upstream.ts): named in words, counted in $STATE_DIRECTORY, and it
// fails the unit only on every third consecutive run. Anything else
// still fails the unit on the spot, stack trace and all.

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { fetchAllFeatures } from './fetch';
import {
  UpstreamUnavailable,
  clearStreak,
  failsTheUnit,
  recordFailure,
  stateDirectory,
  upstreamVerdict,
} from './upstream';
import { parseBathingFeature } from './parse';
import type {
  BathingFeatureAttributes,
  BathingRejectReason,
  BathingWaterRecord,
} from './parse';
import { BATHING_LAYER_URL, BATHING_SEASON, BATHING_SOURCE_ID } from './source';

/** Rows per INSERT. 500 × 10 columns is well inside Postgres' limits. */
const BATCH = 500;

export interface ImportTally {
  read: number;
  stored: number;
  refused: Record<BathingRejectReason | 'duplicate-ref', number>;
}

export function emptyTally(): ImportTally {
  return {
    read: 0,
    stored: 0,
    refused: {
      'no-ref': 0,
      'no-name': 0,
      'not-eu27': 0,
      'unknown-country': 0,
      'no-coordinates': 0,
      'coordinates-out-of-range': 0,
      'unknown-status': 0,
      'duplicate-ref': 0,
    },
  };
}

/**
 * Features in, storable records out, with every refusal counted.
 *
 * 🔴 The tally RECONCILES: stored + every refusal = read. A test asserts
 * it, because a counter that does not add up is how an importer reports
 * success over data it threw away.
 */
export function selectRecords(features: BathingFeatureAttributes[]): {
  records: BathingWaterRecord[];
  tally: ImportTally;
} {
  const tally = emptyTally();
  const records: BathingWaterRecord[] = [];
  const seen = new Set<string>();

  for (const attrs of features) {
    tally.read += 1;
    const record = parseBathingFeature(attrs, BATHING_SEASON, (reason) => {
      tally.refused[reason] += 1;
    });
    if (!record) continue;
    // The layer has no duplicate identifiers today (22 010 rows, 22 010
    // distinct refs, measured 28.09.2026). The guard is here because the
    // unique index would otherwise turn one future duplicate into a
    // failed batch of 500 — one bad record costing 499 good ones.
    if (seen.has(record.ref)) {
      tally.refused['duplicate-ref'] += 1;
      continue;
    }
    seen.add(record.ref);
    records.push(record);
    tally.stored += 1;
  }

  return { records, tally };
}

export function tallyReconciles(tally: ImportTally): boolean {
  const refused = Object.values(tally.refused).reduce((a, b) => a + b, 0);
  return tally.stored + refused === tally.read;
}

async function insertBatch(db: Client, rows: BathingWaterRecord[]) {
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    const b = i * 9;
    values.push(
      BATHING_SOURCE_ID,
      r.ref,
      r.name,
      r.country,
      r.category,
      r.season,
      r.status,
      r.profileUrl,
      // 🔴 ST_MakePoint takes LONGITUDE first. Swapped, every bathing
      // water in Europe lands in the Indian Ocean and every campsite
      // reports none nearby — a failure that looks exactly like honest
      // emptiness, which is why the coverage report below prints a
      // country breakdown rather than one number.
      `SRID=4326;POINT(${r.lon} ${r.lat})`,
    );
    return (
      `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, ` +
      `$${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}::geography)`
    );
  });

  await db.query(
    `INSERT INTO bathing_waters
       (source_id, ref, name, country, category, season, status,
        profile_url, location)
     VALUES ${tuples.join(', ')}
     ON CONFLICT (source_id, ref, season) DO UPDATE SET
       name        = EXCLUDED.name,
       country     = EXCLUDED.country,
       category    = EXCLUDED.category,
       status      = EXCLUDED.status,
       profile_url = EXCLUDED.profile_url,
       location    = EXCLUDED.location`,
    values,
  );
}

function printTally(tally: ImportTally) {
  console.log(`  features read                       ${tally.read}`);
  console.log(`  records kept                        ${tally.stored}`);
  for (const [reason, n] of Object.entries(tally.refused)) {
    if (n) console.log(`  refused: ${reason.padEnd(26)}${n}`);
  }
  console.log(
    `  reconciles                          ${tallyReconciles(tally) ? 'yes' : 'NO'}`,
  );
}

export interface RunDeps {
  /** The network. Injected by tests and by the CAMP-440 rehearsal driver. */
  fetchImpl?: typeof fetch;
  /** The pause between retries; injected so tests do not wait 30 s. */
  sleep?: (ms: number) => Promise<void>;
  /** Where STATE_DIRECTORY and DATABASE_URL are read from. */
  env?: Record<string, string | undefined>;
}

/**
 * CAMP-440: the source did not answer. Say so in words, count it, and
 * decide — see upstream.ts for why this is neither exit 1 nor silence.
 * Returns the exit code.
 */
function tolerateUpstream(
  err: UpstreamUnavailable,
  apply: boolean,
  stateDir: string | null,
): number {
  console.error(`\n✗ ${err.message}`);
  console.error(
    '  Nothing of ours failed: no row was parsed, no table was touched, and the\n' +
      '  stored season stays valid for 365 days (ANNUAL_HEALTHY_DAYS).',
  );
  if (!apply) {
    console.error(
      '  (dry run — the failure streak is not recorded; exiting 1 so the shell sees it)',
    );
    return 1;
  }
  if (!stateDir) {
    console.error(
      '  No STATE_DIRECTORY, so there is nowhere to count consecutive failures —\n' +
        '  failing the unit as before CAMP-440 (StateDirectory= in the .service is\n' +
        '  what makes an outage tolerable; without it the fallback is loud, not quiet).',
    );
    return 1;
  }
  const streak = recordFailure(stateDir, err.message);
  const verdict = upstreamVerdict(streak);
  console.error(`  ${verdict.say}`);
  console.error(`  streak kept in ${stateDir}`);
  return verdict.failUnit ? 1 : 0;
}

export async function run(argv: string[], deps: RunDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const apply = argv.includes('--apply');
  const fileArg = argv.indexOf('--file');
  const file = fileArg >= 0 ? argv[fileArg + 1] : null;
  const stateDir = stateDirectory(env);

  let features: BathingFeatureAttributes[];
  if (file) {
    features = JSON.parse(
      readFileSync(file, 'utf8'),
    ) as BathingFeatureAttributes[];
  } else {
    try {
      features = await fetchAllFeatures(
        deps.fetchImpl ?? fetch,
        BATHING_LAYER_URL,
        {
          sleep: deps.sleep,
        },
      );
    } catch (err) {
      // 🔴 By TYPE. Anything that is not the source being down — a 404,
      // an error object, a short read, our own parsing — rethrows and
      // fails the unit exactly as before.
      if (failsTheUnit(err)) throw err;
      return tolerateUpstream(err as UpstreamUnavailable, apply, stateDir);
    }
    // The source answered: whatever streak there was is over. Only a
    // real run clears it; a dry run leaves no trace of itself anywhere.
    if (apply && stateDir) clearStreak(stateDir);
  }

  const { records, tally } = selectRecords(features);
  printTally(tally);

  if (!tallyReconciles(tally)) {
    throw new Error('the tally does not reconcile — refusing to write');
  }

  if (!apply) {
    console.log('\n(dry run — nothing written; pass --apply)');
    return 0;
  }

  const db = new Client({
    connectionString:
      env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev',
  });
  await db.connect();
  try {
    await db.query('BEGIN');
    for (let i = 0; i < records.length; i += BATCH) {
      await insertBatch(db, records.slice(i, i + BATCH));
    }
    await db.query('COMMIT');
    console.log(`\n✓ committed ${records.length} bathing waters`);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await db.end();
  }
  return 0;
}

if (require.main === module) {
  run(process.argv)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
