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
// 🔴 IT IS THE CLASS NAME THAT COUNTS, NOT THE FILE NAME, and the first
// version of this guard measured the wrong one. TypeORM reads the stamp
// out of the class:
//
//     migration/MigrationExecutor.js:432
//     parseInt(migrationClassName.slice(-13), 10)
//
// So a file called `1790900000000-Gotcha.ts` whose class is
// `Gotcha1790662800000` collides in reality while a file-name check calls
// the directory clean — review built exactly that and this guard printed
// "every timestamp distinct". Both are read now, and a file whose own two
// stamps disagree is itself reported: that disagreement is how the blind
// spot opens in the first place.

import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = join(HERE, '..', '..', 'apps', 'api', 'src', 'migrations');

/** The last 13 digits of a class name — what TypeORM actually sorts by. */
const stampOfClass = (className) => /(\d{13})$/.exec(className)?.[1] ?? null;

/** `1790662800000-FuelStationPrices.ts` → `1790662800000`. */
const stampOfFile = (file) => /^(\d+)-/.exec(file)?.[1] ?? null;

/**
 * Read a migration directory into `{file, className, fileStamp, classStamp}`.
 *
 * A file with no `export class …` is not a migration and is skipped —
 * barrels and helpers live here too.
 */
export function readEntries(dir) {
  const out = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue;
    const src = readFileSync(join(dir, file), 'utf8');
    const className = /export\s+class\s+([A-Za-z0-9_]+)/.exec(src)?.[1] ?? null;
    if (!className) continue;
    out.push({
      file,
      className,
      fileStamp: stampOfFile(file),
      classStamp: stampOfClass(className),
    });
  }
  return out;
}

/** Everything wrong with a set of migrations, as plain findings. */
export function findings(entries) {
  const problems = [];

  for (const e of entries) {
    if (!e.classStamp) {
      problems.push({
        kind: 'no-stamp',
        detail: `${e.file}: class ${e.className} does not end in 13 digits, so TypeORM cannot order it`,
      });
      continue;
    }
    if (e.fileStamp && e.fileStamp !== e.classStamp) {
      problems.push({
        kind: 'mismatch',
        detail: `${e.file}: file says ${e.fileStamp}, class ${e.className} says ${e.classStamp} — TypeORM believes the class`,
      });
    }
  }

  const byStamp = new Map();
  for (const e of entries) {
    if (!e.classStamp) continue;
    byStamp.set(e.classStamp, [...(byStamp.get(e.classStamp) ?? []), e]);
  }
  for (const [stamp, group] of byStamp) {
    if (group.length > 1) {
      problems.push({
        kind: 'collision',
        detail: `${stamp} is carried by ${group.map((e) => e.className).join(' and ')}`,
      });
    }
  }

  return problems;
}

function run(dir) {
  const entries = readEntries(dir);
  const problems = findings(entries);

  if (problems.length > 0) {
    console.error('✗ Migrations TypeORM cannot order reliably:\n');
    for (const p of problems) console.error(`  [${p.kind}] ${p.detail}`);
    console.error('\n  TypeORM sorts by the 13 digits at the END OF THE CLASS');
    console.error('  NAME. Two migrations on one stamp are ordered by the');
    console.error('  directory read order, which differs between macOS and');
    console.error('  the CI runner. Move one on by a second and rename its');
    console.error('  class to match; 1790662801000-FuelStationPrices.ts shows');
    console.error('  how to clear the old row, and why that is safe there.');
    return 1;
  }

  console.log(`✓ ${entries.length} migrations, every class stamp distinct`);
  return 0;
}

// 🔴 The rehearsal runs the WHOLE SCRIPT, not the pure function.
//
// The first version only called `findings()` and was green under two
// mutations review found: loosening the gate to `problems.length > 1`,
// and turning the failing exit into `process.exit(0)`. Both left a real
// collision reported as success. A rehearsal that stops short of the
// exit code does not rehearse the thing CI reads.
function selfTest() {
  const root = mkdtempSync(join(tmpdir(), 'migstamp-'));
  const self = fileURLToPath(import.meta.url);
  let rc = 0;

  const scenario = (name, files) => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    for (const [file, className] of files) {
      writeFileSync(
        join(dir, file),
        `export class ${className} { async up() {} }\n`,
      );
    }
    const out = spawnSync(process.execPath, [self, '--dir', dir], {
      encoding: 'utf8',
    });
    return out.status;
  };

  const expect = (label, actual, wanted) => {
    if (actual !== wanted) {
      console.error(
        `✗ REHEARSAL FAILED: ${label} exited ${actual}, expected ${wanted}.`,
      );
      rc = 1;
    }
  };

  expect(
    'two classes on one stamp',
    scenario('collide', [
      ['1790662800000-BathingWaters.ts', 'BathingWaters1790662800000'],
      ['1790662800000-FuelStationPrices.ts', 'FuelStationPrices1790662800000'],
    ]),
    1,
  );

  // The blind spot the first version had: the file names differ, so a
  // file-name check sees nothing, while TypeORM sees one stamp twice.
  expect(
    'classes collide although the file names do not',
    scenario('gotcha', [
      ['1790662800000-BathingWaters.ts', 'BathingWaters1790662800000'],
      ['1790900000000-Gotcha.ts', 'Gotcha1790662800000'],
    ]),
    1,
  );

  expect(
    'a file whose own two stamps disagree',
    scenario('mismatch', [
      ['1790900000000-Drifted.ts', 'Drifted1790662801000'],
    ]),
    1,
  );

  expect(
    'a class that ends in no stamp at all',
    scenario('unstamped', [['1790900000000-NoStamp.ts', 'NoStamp']]),
    1,
  );

  // 🔴 The case above does NOT reach the no-stamp check on its own: the
  // file name carries a stamp, so the mismatch check fires first and the
  // two guards cover for each other. Deleting the no-stamp check left
  // the rehearsal green until this scenario existed. Neither name here
  // carries a stamp, so only one check can speak.
  expect(
    'a migration class with no stamp in either name',
    scenario('bare', [['helpers.ts', 'Helpers']]),
    1,
  );

  // And the other direction, so the rehearsal cannot be satisfied by a
  // check that simply always fails.
  expect(
    'distinct stamps',
    scenario('clean', [
      ['1790662800000-BathingWaters.ts', 'BathingWaters1790662800000'],
      ['1790662801000-FuelStationPrices.ts', 'FuelStationPrices1790662801000'],
    ]),
    0,
  );

  if (rc === 0) {
    console.log(
      '✓ rehearsal: the check exits 1 on a collision — including one the\n' +
        '  file names hide — on a drifted stamp and on a missing one, and\n' +
        '  exits 0 on a clean directory.',
    );
  }
  return rc;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest());
}

const dirFlag = process.argv.indexOf('--dir');
process.exit(run(dirFlag > -1 ? process.argv[dirFlag + 1] : DEFAULT_DIR));
