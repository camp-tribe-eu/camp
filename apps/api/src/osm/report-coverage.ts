// CAMP-27 verification: how much of a real country extract do we actually
// understand?
//
// The card asks for a *measurable* recognition rate that goes up when the
// rules improve. Without this script "we added some synonyms" is a feeling;
// with it, it is a number that moved.
//
// Usage:
//   cd apps/api
//   npx ts-node src/osm/report-coverage.ts [staging-table]
//
// Reads the staging table produced by scripts/osm-pipeline/import.sh, which
// keeps every original OSM tag as a column. Read-only: writing mapped rows
// into camping_spots with de-duplication is CAMP-28.

import 'dotenv/config';
import { Client } from 'pg';
import {
  AMENITY_KEYS,
  AmenityKey,
  AmenityValue,
  mapSpotType,
  OsmTags,
  resolveAmenity,
  SpotType,
} from './tag-mapping';

const TABLE = process.argv[2] ?? 'osm_camping_staging';
const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/** Tags we look at, so the "unrecognised values" list stays relevant. */
const WATCHED_KEYS = [
  'power_supply',
  'electricity',
  'socket',
  'drinking_water',
  'water_point',
  'shower',
  'showers',
  'dog',
  'dogs',
  'pets',
  'internet_access',
  'wifi',
  'fee',
  'camp_site',
  'caravan_site',
  'backcountry',
];

interface AmenityStats {
  yes: number;
  no: number;
  unknown: number;
  byRule: Map<string, number>;
}

function pct(part: number, total: number): string {
  if (total === 0) return '  0.0%';
  return `${((part / total) * 100).toFixed(1).padStart(5)}%`;
}

function bar(part: number, total: number, width = 24): string {
  const filled = total === 0 ? 0 : Math.round((part / total) * width);
  return '█'.repeat(filled) + '·'.repeat(width - filled);
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  const exists = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS present`,
    [TABLE],
  );
  if (!exists.rows[0]?.present) {
    console.error(
      `Staging table "${TABLE}" not found.\n` +
        `Run scripts/osm-pipeline/import.sh on a country extract first, e.g.\n` +
        `  curl -o at.osm.pbf https://download.geofabrik.de/europe/austria-latest.osm.pbf\n` +
        `  ./import.sh at.osm.pbf ${TABLE}`,
    );
    await client.end();
    process.exitCode = 1;
    return;
  }

  // ogr2ogr lands each OSM tag as its own column, so read the column list
  // and turn every row back into a plain tag bag.
  const cols = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = $1 AND data_type IN ('text','character varying')`,
    [TABLE],
  );
  const tagColumns = cols.rows.map((r) => r.column_name);

  const rows = await client.query(`SELECT * FROM "${TABLE}"`);
  const total = rows.rowCount ?? 0;

  const stats: Record<AmenityKey, AmenityStats> = {} as never;
  for (const key of AMENITY_KEYS) {
    stats[key] = { yes: 0, no: 0, unknown: 0, byRule: new Map() };
  }

  const typeCounts = new Map<SpotType, number>();
  let typeGuesses = 0;
  /** value -> times seen, for tags we watch but could not read. */
  const unrecognised = new Map<string, number>();

  for (const row of rows.rows) {
    const tags: OsmTags = {};
    for (const col of tagColumns) {
      const v = row[col];
      if (v !== null && v !== undefined && v !== '') tags[col] = String(v);
    }

    for (const key of AMENITY_KEYS) {
      const { value, matchedBy } = resolveAmenity(key, tags);
      if (value === AmenityValue.YES) stats[key].yes++;
      else if (value === AmenityValue.NO) stats[key].no++;
      else stats[key].unknown++;
      if (matchedBy) {
        stats[key].byRule.set(matchedBy, (stats[key].byRule.get(matchedBy) ?? 0) + 1);
      }
    }

    const t = mapSpotType(tags);
    typeCounts.set(t.type, (typeCounts.get(t.type) ?? 0) + 1);
    if (!t.confident) typeGuesses++;

    // A watched tag that is present but produced no answer is a missing
    // rule - exactly the list worth working through next.
    for (const key of WATCHED_KEYS) {
      const raw = tags[key];
      if (!raw) continue;
      const amenity = AMENITY_KEYS.find(
        (a) => resolveAmenity(a, { [key]: raw }).matchedBy !== null,
      );
      const typeReads = ['fee', 'camp_site', 'caravan_site', 'backcountry'];
      if (!amenity && !typeReads.includes(key)) {
        const label = `${key}=${raw.trim().toLowerCase()}`;
        unrecognised.set(label, (unrecognised.get(label) ?? 0) + 1);
      }
    }
  }

  console.log(`\nOSM tag coverage — table "${TABLE}", ${total} features\n`);
  console.log('  amenity        known   unknown  recognition');
  console.log('  ' + '-'.repeat(52));
  for (const key of AMENITY_KEYS) {
    const s = stats[key];
    const known = s.yes + s.no;
    console.log(
      `  ${key.padEnd(13)} ${String(known).padStart(5)} ${String(s.unknown).padStart(9)}` +
        `   ${pct(known, total)}  ${bar(known, total)}`,
    );
  }

  console.log('\n  which tag answered (top rules per amenity)');
  console.log('  ' + '-'.repeat(52));
  for (const key of AMENITY_KEYS) {
    const top = [...stats[key].byRule.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    if (top.length === 0) {
      console.log(`  ${key.padEnd(13)} —`);
      continue;
    }
    console.log(
      `  ${key.padEnd(13)} ` + top.map(([r, n]) => `${r} ×${n}`).join(', '),
    );
  }

  console.log('\n  spot type');
  console.log('  ' + '-'.repeat(52));
  for (const [type, n] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(13)} ${String(n).padStart(5)}   ${pct(n, total)}`);
  }
  console.log(
    `\n  🔴 guessed (no fee tag): ${typeGuesses} of ${total}  ${pct(typeGuesses, total)}`,
  );

  if (unrecognised.size > 0) {
    console.log('\n  unrecognised values — each one is a candidate rule');
    console.log('  ' + '-'.repeat(52));
    for (const [label, n] of [...unrecognised.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)) {
      console.log(`  ${String(n).padStart(4)} ×  ${label}`);
    }
  } else {
    console.log('\n  no unrecognised values in watched tags.');
  }

  console.log('');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
