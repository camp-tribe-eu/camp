#!/usr/bin/env node
// 🔴 No two migrations may carry the same timestamp.
//
// CAMP-179. The timestamp is the ONLY thing TypeORM sorts migrations by.
// Give two of them the same number and their order is decided by whatever
// order the directory happened to be read in — which is not the same on
// macOS as on the Linux runner CI uses.
//
// It cost nothing the day it happened: `BathingWaters` and
// `FuelStationPrices` both landed on 1790662800000, and the two tables
// never referenced each other. That is luck, not safety. The day a third
// migration puts a foreign key between two same-stamped tables, it fails
// on one machine and passes on another, and the cause — directory read
// order — is the last place anyone looks.
//
// The card that found this said the check matters more than the rename,
// and it is right: the rename fixes one collision, this stops the next.
// Two cards finishing on the same day is all it takes.

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', '..', 'apps', 'api', 'src', 'migrations');

/** `1790662800000-FuelStationPrices.ts` → `1790662800000`. */
const stampOf = (file) => /^(\d+)-/.exec(file)?.[1] ?? null;

/**
 * Every stamp carried by more than one file, with its files.
 *
 * Kept as a pure function of a file list so the rehearsal can hand it a
 * list it made up, instead of needing a directory full of fakes.
 */
export function duplicateStamps(files) {
  const byStamp = new Map();
  for (const file of files) {
    if (!file.endsWith('.ts')) continue;
    const stamp = stampOf(file);
    if (!stamp) continue;
    byStamp.set(stamp, [...(byStamp.get(stamp) ?? []), file]);
  }
  return [...byStamp.entries()].filter(([, group]) => group.length > 1);
}

// Prove the check can fail. Nothing here reads the real directory.
function selfTest() {
  let rc = 0;

  const colliding = [
    '1790662800000-BathingWaters.ts',
    '1790662800000-FuelStationPrices.ts',
    '1790749200000-AirQuality.ts',
  ];
  if (duplicateStamps(colliding).length !== 1) {
    console.error('✗ REHEARSAL FAILED: two files on one stamp went unreported.');
    console.error('  This check cannot see the collision it exists for.');
    rc = 1;
  }

  // And the other direction, so the rehearsal cannot be satisfied by a
  // check that simply always complains.
  const distinct = [
    '1790662800000-BathingWaters.ts',
    '1790662801000-FuelStationPrices.ts',
    '1790749200000-AirQuality.ts',
  ];
  if (duplicateStamps(distinct).length !== 0) {
    console.error('✗ REHEARSAL FAILED: distinct stamps were reported as a collision.');
    rc = 1;
  }

  // A name that carries no stamp must not be read as sharing one with
  // every other unstamped name.
  if (duplicateStamps(['README.md', 'index.ts', 'helpers.ts']).length !== 0) {
    console.error('✗ REHEARSAL FAILED: unstamped files were grouped together.');
    rc = 1;
  }

  if (rc === 0) {
    console.log(
      '✓ rehearsal: the check reports a shared stamp, stays quiet on distinct\n' +
        '  ones, and does not group files that carry no stamp at all.',
    );
  }
  return rc;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest());
}

const duplicates = duplicateStamps(readdirSync(MIGRATIONS));

if (duplicates.length > 0) {
  console.error('✗ Two migrations share a timestamp, and TypeORM sorts by');
  console.error('  nothing else. Their order is the directory read order,');
  console.error('  which differs between macOS and the CI runner.\n');
  for (const [stamp, group] of duplicates) {
    console.error(`  ${stamp}`);
    for (const file of group) console.error(`    ${file}`);
  }
  console.error('\n  Move one of them on by a second and rename its class to');
  console.error('  match. If the old name may already be recorded in a live');
  console.error('  `migrations` table, delete that row from inside the');
  console.error('  renamed migration — 1790662801000-FuelStationPrices.ts');
  console.error('  shows how, and why it is safe there.');
  process.exit(1);
}

console.log(
  `✓ ${readdirSync(MIGRATIONS).filter((f) => f.endsWith('.ts')).length} migrations, every timestamp distinct`,
);
