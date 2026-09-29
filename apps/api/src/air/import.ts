// CAMP-164: put the EU's air quality stations, their latest reported
// hour, and the 1 km modelled index for the campsites with no station
// nearby into the database.
//
//   DATABASE_URL=postgres://… npx ts-node src/air/import.ts           # dry run
//   DATABASE_URL=postgres://… npx ts-node src/air/import.ts --apply
//
// 🔴 A dry run by default, and a real one — it fetches everything and
// writes everything inside one transaction that is then rolled back, so
// the tallies it prints are the ones `--apply` would produce.
//
// 🔴 The database is NOT defaulted to the development one for a reason:
// there is no `?? 'camptribe_dev'` below. This job rewrites every
// station's reading and every modelled value, and an import that lands
// in the wrong database is not a thing to discover afterwards.
//
// 🔴 ONE BAD RECORD COSTS ONE RECORD. Every refusal is counted by reason
// and the rest of the import continues. The things that DO abort are
// failures of the whole — a roster that shrank by more than a tenth, a
// raster batch that came back short, an hour the raster does not hold —
// and each of them leaves the previous values in place to age out,
// which the page renders as "no fresh data".
//
// 🔴 THE REFRESH IS NOT SCHEDULED BY THIS CARD, and the design assumes
// it. A page whose newest reading is older than AIR_FRESH_FOR_HOURS says
// "no fresh data" on its own; a dead pipeline therefore looks like a dead
// pipeline rather than like last Tuesday's air. What it costs to run, so
// that whoever schedules it decides with the number: one roster
// (1.8 MB); 4 018 station files, of which 3 504 answer (about 66 KB each —
// 230.6 MB downloaded in the run of 29.09.2026 20:53 UTC) and 514 answer
// 404; six at a time; and 79 raster requests for the 39 284 campsites
// with no station within AIR_RADIUS_M. Two minutes four seconds end to end.

import 'dotenv/config';
import { Client } from 'pg';
import {
  fetchModelledBands,
  fetchRoster,
  fetchStationFile,
  mapPool,
  rasterWindow,
} from './fetch';
import {
  hourStart,
  parseStation,
  pickStationReading,
  type RosterRow,
  type StationRecord,
  type StationRejectReason,
  type StationReading,
} from './parse';
import { AIR_RADIUS_M } from './source';

const DB_URL = process.env.DATABASE_URL;

/** Station files fetched at once. Polite to a public blob store. */
const CONCURRENCY = 6;

const BATCH = 500;

// ---------------------------------------------------------------------
// The roster.
// ---------------------------------------------------------------------

export type StationRefusal = StationRejectReason | 'duplicate-code';

export interface StationTally {
  read: number;
  kept: number;
  refused: Record<StationRefusal, number>;
  /** Which prefixes were refused, and how many stations each. */
  outsideEu27: Record<string, number>;
  /** 🔴 The prefixes nobody has classified. Must be empty. */
  unrecognised: Record<string, number>;
}

export function emptyStationTally(): StationTally {
  return {
    read: 0,
    kept: 0,
    refused: {
      'no-code': 0,
      'malformed-code': 0,
      'outside-eu27': 0,
      'unrecognised-country': 0,
      'not-operational': 0,
      'no-name': 0,
      'unknown-station-type': 0,
      'no-coordinates': 0,
      'coordinates-out-of-range': 0,
      'duplicate-code': 0,
    },
    outsideEu27: {},
    unrecognised: {},
  };
}

/**
 * Roster rows in, storable EU-27 stations out, every refusal counted.
 *
 * 🔴 The tally RECONCILES — kept + every refusal = read — and a test
 * asserts it, because a counter that does not add up is how an importer
 * reports success over rows it threw away.
 */
export function selectStations(rows: unknown[]): {
  stations: StationRecord[];
  tally: StationTally;
} {
  const tally = emptyStationTally();
  const stations: StationRecord[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    tally.read += 1;
    const record = parseStation(
      (row && typeof row === 'object' ? row : {}) as RosterRow,
      (reason, detail) => {
        tally.refused[reason] += 1;
        if (reason === 'outside-eu27' && detail) {
          tally.outsideEu27[detail] = (tally.outsideEu27[detail] ?? 0) + 1;
        }
        if (reason === 'unrecognised-country' && detail) {
          tally.unrecognised[detail] = (tally.unrecognised[detail] ?? 0) + 1;
        }
      },
    );
    if (!record) continue;
    // No duplicates in 4 643 rows today. The guard is here so that one
    // future duplicate costs one station rather than the INSERT batch
    // of 500 it lands in.
    if (seen.has(record.code)) {
      tally.refused['duplicate-code'] += 1;
      continue;
    }
    seen.add(record.code);
    stations.push(record);
    tally.kept += 1;
  }
  return { stations, tally };
}

export function stationTallyReconciles(t: StationTally): boolean {
  const refused = Object.values(t.refused).reduce((a, b) => a + b, 0);
  return t.kept + refused === t.read;
}

/**
 * 🔴 A roster that shrank by more than a tenth is a truncated read, not
 * a restructured network. Stations that are not in the newest roster are
 * DELETED (a closed station left in place would stay the "nearest" one
 * for its campsites forever, and its reading would age into "no fresh
 * data" for good), so the deletion has to be refused when the roster it
 * is judged by looks wrong. 0.9 of what is stored, or anything at all
 * when nothing is.
 */
export function rosterShrinkOk(existing: number, kept: number): boolean {
  return existing === 0 || kept >= Math.ceil(existing * 0.9);
}

// ---------------------------------------------------------------------
// The readings.
// ---------------------------------------------------------------------

export type ReadingAction =
  | { action: 'set'; code: string; reading: StationReading }
  | {
      action: 'clear';
      code: string;
      why: 'no-file' | 'no-reported-hour' | 'unreadable';
    }
  | { action: 'keep'; code: string };

export interface ReadingTally {
  /** Bytes of station files read — what the run cost the EEA's blob store. */
  bytes: number;
  set: number;
  clear: Record<'no-file' | 'no-reported-hour' | 'unreadable', number>;
  /** Fetch failures. The previous reading is left in place. */
  keep: number;
  malformedSlots: number;
  basis: Record<'reported' | 'mixed', number>;
  /** Whole hours before the current one, for the readings set. */
  ageHours: Record<string, number>;
}

export function emptyReadingTally(): ReadingTally {
  return {
    bytes: 0,
    set: 0,
    clear: { 'no-file': 0, 'no-reported-hour': 0, unreadable: 0 },
    keep: 0,
    malformedSlots: 0,
    basis: { reported: 0, mixed: 0 },
    ageHours: {},
  };
}

/**
 * One station's fetch result → what to do with its stored reading.
 *
 * 🔴 `failed` is `keep`, never `clear`. A timeout says nothing about the
 * station; storing it as silent would say the station stopped reporting
 * because OUR request failed.
 */
export function planReading(
  code: string,
  file:
    | { outcome: 'ok'; body: unknown; bytes?: number }
    | { outcome: 'no-file' }
    | { outcome: 'failed'; detail: string },
  now: Date,
  tally: ReadingTally,
): ReadingAction {
  if (file.outcome === 'failed') {
    tally.keep += 1;
    return { action: 'keep', code };
  }
  if (file.outcome === 'no-file') {
    tally.clear['no-file'] += 1;
    return { action: 'clear', code, why: 'no-file' };
  }
  tally.bytes += file.bytes ?? 0;
  const { reading, malformedSlots } = pickStationReading(file.body, now);
  tally.malformedSlots += malformedSlots;
  if (!reading) {
    const why = malformedSlots > 0 ? 'unreadable' : 'no-reported-hour';
    tally.clear[why] += 1;
    return { action: 'clear', code, why };
  }
  tally.set += 1;
  tally.basis[reading.basis] += 1;
  const age = (hourStart(now) - Date.parse(reading.hour)) / 3_600_000;
  const key = age <= 6 ? String(age) : age <= 24 ? '7-24' : '>24';
  tally.ageHours[key] = (tally.ageHours[key] ?? 0) + 1;
  return { action: 'set', code, reading };
}

export function readingTallyReconciles(
  t: ReadingTally,
  stations: number,
): boolean {
  const cleared = Object.values(t.clear).reduce((a, b) => a + b, 0);
  return t.set + cleared + t.keep === stations;
}

// ---------------------------------------------------------------------
// The database.
// ---------------------------------------------------------------------

async function upsertStations(
  db: Client,
  roster: string,
  rows: StationRecord[],
) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values: unknown[] = [];
    const tuples = chunk.map((r, k) => {
      const b = k * 8;
      values.push(
        r.code,
        r.name,
        r.municipality,
        r.country,
        r.type,
        r.area,
        // 🔴 ST_MakePoint takes LONGITUDE first. Swapped, every station in
        // Europe lands in the Indian Ocean and every campsite reports none
        // nearby — a failure that looks exactly like honest emptiness,
        // which is why the coverage report prints a country breakdown.
        `SRID=4326;POINT(${r.lon} ${r.lat})`,
        roster,
      );
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}::geography, $${b + 8})`;
    });
    await db.query(
      `INSERT INTO air_quality_stations
         (code, name, municipality, country, station_type,
          area_classification, location, roster_file)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         municipality = EXCLUDED.municipality,
         country = EXCLUDED.country,
         station_type = EXCLUDED.station_type,
         area_classification = EXCLUDED.area_classification,
         location = EXCLUDED.location,
         roster_file = EXCLUDED.roster_file`,
      values,
    );
  }
}

async function writeReadings(db: Client, actions: ReadingAction[], at: Date) {
  const sets = actions.filter(
    (a): a is Extract<ReadingAction, { action: 'set' }> => a.action === 'set',
  );
  for (let i = 0; i < sets.length; i += BATCH) {
    const chunk = sets.slice(i, i + BATCH);
    const values: unknown[] = [];
    const tuples = chunk.map((a, k) => {
      const b = k * 8;
      const r = a.reading;
      values.push(
        a.code,
        r.hour,
        r.index,
        r.band,
        r.basis,
        r.culprit,
        JSON.stringify(r.pollutants),
        at.toISOString(),
      );
      return `($${b + 1}, $${b + 2}::timestamptz, $${b + 3}::numeric, $${b + 4}::smallint, $${b + 5}, $${b + 6}, $${b + 7}::jsonb, $${b + 8}::timestamptz)`;
    });
    await db.query(
      `UPDATE air_quality_stations st SET
         reading_hour = v.hour, reading_index = v.idx, reading_band = v.band,
         reading_basis = v.basis, reading_culprit = v.culprit,
         reading_pollutants = v.pollutants, read_at = v.read_at
        FROM (VALUES ${tuples.join(', ')})
             AS v(code, hour, idx, band, basis, culprit, pollutants, read_at)
       WHERE st.code = v.code`,
      values,
    );
  }
  const cleared = actions
    .filter((a) => a.action === 'clear')
    .map((a) => a.code);
  for (let i = 0; i < cleared.length; i += 2000) {
    await db.query(
      `UPDATE air_quality_stations SET
         reading_hour = NULL, reading_index = NULL, reading_band = NULL,
         reading_basis = NULL, reading_culprit = NULL,
         reading_pollutants = NULL, read_at = $2::timestamptz
       WHERE code = ANY($1)`,
      [cleared.slice(i, i + 2000), at.toISOString()],
    );
  }
}

export interface ModelledTally {
  needing: number;
  withValue: number;
  outsideModel: number;
  badValues: number;
  byBand: Record<string, number>;
}

/** The campsites that will show the model: none of our stations within AIR_RADIUS_M. */
const SPOTS_WITHOUT_STATION_SQL = `
  SELECT s.id, ST_X(s.location::geometry) AS lon, ST_Y(s.location::geometry) AS lat
    FROM camping_spots s
   WHERE s.missing_since IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM air_quality_stations st
        WHERE ST_DWithin(s.location::geography, st.location, ${AIR_RADIUS_M}))
   ORDER BY s.id`;

async function refreshModelled(
  db: Client,
  now: Date,
  fetchImpl: typeof fetch,
): Promise<ModelledTally> {
  const hourMs = hourStart(now);
  const win = await rasterWindow(fetchImpl);
  if (hourMs < win.start || hourMs > win.end) {
    throw new Error(
      `the raster holds ${new Date(win.start).toISOString()} to ${new Date(win.end).toISOString()}, ` +
        `not ${new Date(hourMs).toISOString()} — has the EEA moved to a new AQMobile_<year> service?`,
    );
  }

  const spots: { id: string; lon: number; lat: number }[] = (
    await db.query(SPOTS_WITHOUT_STATION_SQL)
  ).rows;
  const { bands, badValues } = await fetchModelledBands(
    spots,
    hourMs,
    fetchImpl,
  );

  const tally: ModelledTally = {
    needing: spots.length,
    withValue: 0,
    outsideModel: 0,
    badValues,
    byBand: {},
  };
  const rows: { id: string; band: number }[] = [];
  spots.forEach((s, i) => {
    const band = bands[i];
    if (band === null) {
      tally.outsideModel += 1;
      return;
    }
    tally.withValue += 1;
    tally.byBand[band] = (tally.byBand[band] ?? 0) + 1;
    rows.push({ id: s.id, band });
  });

  // Replaced whole. A row for a campsite that now has a station, or that
  // the model no longer covers, must not survive to be read.
  await db.query('DELETE FROM air_quality_modelled');
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const values: unknown[] = [];
    const tuples = chunk.map((r, k) => {
      const b = k * 4;
      values.push(
        r.id,
        new Date(hourMs).toISOString(),
        r.band,
        now.toISOString(),
      );
      return `($${b + 1}::uuid, $${b + 2}::timestamptz, $${b + 3}::smallint, $${b + 4}::timestamptz)`;
    });
    await db.query(
      `INSERT INTO air_quality_modelled (spot_id, hour, band, read_at) VALUES ${tuples.join(', ')}`,
      values,
    );
  }
  return tally;
}

// ---------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------

function printPrefixes(label: string, m: Record<string, number>) {
  const keys = Object.keys(m).sort();
  console.log(
    `  ${label.padEnd(36)}${keys.length}  ${keys.map((k) => `${k} ${m[k]}`).join(' · ')}`,
  );
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!DB_URL) {
    console.error(
      'DATABASE_URL is not set. This importer has no default database.',
    );
    process.exit(2);
  }
  const now = new Date();

  console.log(`run at ${now.toISOString()}\n\nroster`);
  const roster = await fetchRoster();
  const { stations, tally: st } = selectStations(roster.rows);
  console.log(`  file                                ${roster.file}`);
  console.log(`  rows read                           ${st.read}`);
  console.log(`  EU-27 stations kept                 ${st.kept}`);
  for (const [reason, n] of Object.entries(st.refused)) {
    if (n) console.log(`  refused: ${reason.padEnd(27)}${n}`);
  }
  printPrefixes('outside the Union (declared), prefixes', st.outsideEu27);
  printPrefixes('UNRECOGNISED prefixes', st.unrecognised);
  console.log(
    `  reconciles                          ${stationTallyReconciles(st) ? 'yes' : 'NO'}`,
  );
  if (!stationTallyReconciles(st)) {
    throw new Error('the roster tally does not reconcile — refusing to write');
  }

  console.log(`\nstation files (${CONCURRENCY} at a time)`);
  const rt = emptyReadingTally();
  let done = 0;
  const actions = await mapPool(stations, CONCURRENCY, async (s) => {
    const file = await fetchStationFile(s.code);
    if (++done % 500 === 0) console.log(`  … ${done} of ${stations.length}`);
    return planReading(s.code, file, now, rt);
  });
  console.log(
    `  downloaded                          ${(rt.bytes / 1e6).toFixed(1)} MB`,
  );
  console.log(`  readings set                        ${rt.set}`);
  console.log(`    reported                          ${rt.basis.reported}`);
  console.log(`    partly modelled (mixed)           ${rt.basis.mixed}`);
  console.log(`  cleared: no file                    ${rt.clear['no-file']}`);
  console.log(
    `  cleared: no reported hour           ${rt.clear['no-reported-hour']}`,
  );
  console.log(`  cleared: unreadable                 ${rt.clear.unreadable}`);
  console.log(`  fetch failed, reading kept          ${rt.keep}`);
  console.log(`  malformed slots skipped             ${rt.malformedSlots}`);
  console.log(
    `  age of the readings set (whole hours before the current one)  ${JSON.stringify(rt.ageHours)}`,
  );
  const readingsReconcile = readingTallyReconciles(rt, stations.length);
  console.log(
    `  reconciles                          ${readingsReconcile ? 'yes' : 'NO'}`,
  );
  if (!readingsReconcile) {
    throw new Error('the reading tally does not reconcile — refusing to write');
  }

  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  let modelledError: Error | null = null;
  try {
    await db.query('BEGIN');

    const existing = Number(
      (await db.query('SELECT count(*) AS n FROM air_quality_stations')).rows[0]
        .n,
    );
    if (!rosterShrinkOk(existing, stations.length)) {
      throw new Error(
        `the roster kept ${stations.length} stations but ${existing} are stored — ` +
          'that is more than a tenth fewer; refusing to delete the rest on the strength of it',
      );
    }
    await upsertStations(db, roster.file, stations);
    await writeReadings(db, actions, now);
    const gone = await db.query(
      'DELETE FROM air_quality_stations WHERE roster_file <> $1',
      [roster.file],
    );
    console.log(
      `\ndatabase\n  stations upserted                   ${stations.length}`,
    );
    console.log(
      `  stations no longer in the roster    ${gone.rowCount} deleted`,
    );

    await db.query('SAVEPOINT stations_done');
    try {
      console.log('\nmodelled raster');
      const mt = await refreshModelled(db, now, fetch);
      console.log(
        `  campsites with no station in ${AIR_RADIUS_M / 1000} km   ${mt.needing}`,
      );
      console.log(
        `  with a modelled value               ${mt.withValue}  by level ${JSON.stringify(mt.byBand)}`,
      );
      console.log(`  outside the model                   ${mt.outsideModel}`);
      console.log(`  values that were not a level 1–6    ${mt.badValues}`);
      if (mt.withValue + mt.outsideModel + mt.badValues !== mt.needing) {
        throw new Error('the modelled tally does not reconcile');
      }
    } catch (err) {
      // The stations are good; the raster is not. Keep the first, say
      // so, and exit non-zero after committing.
      modelledError = err as Error;
      await db.query('ROLLBACK TO SAVEPOINT stations_done');
    }

    if (apply) {
      await db.query('COMMIT');
      console.log('\n✓ committed');
    } else {
      await db.query('ROLLBACK');
      console.log(
        '\n(dry run — everything above was rolled back; pass --apply)',
      );
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await db.end();
  }

  if (modelledError) {
    console.error(
      `\n✗ the modelled raster was NOT refreshed: ${modelledError.message}`,
    );
    process.exitCode = 1;
  }
  if (Object.keys(st.unrecognised).length) {
    console.error(
      `\n✗ ${Object.keys(st.unrecognised).length} country prefix(es) in the roster that nobody has classified: ` +
        `${Object.keys(st.unrecognised).join(', ')}. Their stations were refused, not dropped silently — ` +
        'decide each (EU-27 or AIR_KNOWN_OUTSIDE_EU27 in source.ts) and rerun.',
    );
    process.exitCode = 3;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
