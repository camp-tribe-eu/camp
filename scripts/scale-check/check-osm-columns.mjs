#!/usr/bin/env node
// CAMP-134, defect 1 of six: `ERROR: tables can have at most 1600 columns`.
//
//   node scripts/scale-check/check-osm-columns.mjs
//   node scripts/scale-check/check-osm-columns.mjs --self-test
//   node scripts/scale-check/check-osm-columns.mjs --work-dir ~/camptribe-osm
//
// 🔴 WHY THIS CHECK IS NOT A TEST.
//
// On 25.09.2026 the context loader worked on three countries and died on
// twenty-seven with a message that names no cause. `osmium export` writes
// every OSM tag as a property, `ogr2ogr` makes a column of each, and
// Postgres refuses a CREATE TABLE past 1 600 of them. Nothing loaded, the
// previous contents stayed in place, and they looked like data.
//
// No test on a fixture can see this, and that is not a gap in the tests.
// Measured here, 27.09.2026, with `osmium tags-count` over the very
// extracts the pipeline merges:
//
//   slovenia                    206 distinct keys on the water layer
//   croatia                     317
//   france                    1 055
//   germany                   1 458
//   slovenia+croatia+france   1 149   ← the three it was developed on
//   EU-27, merged             3 381   ← where it dies
//
// So THREE WHOLE COUNTRIES, France included, stay under the ceiling. A
// fixture only crosses 1 600 by being most of the real extracts, which is
// the card's fourth question answered with a number rather than a
// preference: making the fixture bigger does not reach this defect.
//
// 🔴 WHAT IT CHECKS, therefore: not "is the data too diverse" — it always
// will be — but "does the export still narrow it". The pipeline passes
// osmium an `include_tags` allowlist; if that ever comes off, the column
// count is the census above and the load dies. This reads the pipeline
// (never writes to it) and prices the export against the real census.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Postgres's own ceiling. Not a budget we chose and not one we may raise:
 * `MaxHeapAttributeNumber` in `access/htup_details.h`, and the error the
 * loader hit quotes it verbatim.
 */
const POSTGRES_MAX_COLUMNS = 1600;

/**
 * Columns ogr2ogr adds that are not tags — measured, not assumed, against
 * the live database on 27.09.2026:
 *
 *   osm_ctx_water  7 columns, 4 tags in the allowlist
 *   osm_ctx_place  5 columns, 2 tags
 *   osm_ctx_poi    6 columns, 3 tags
 *
 * Three every time: the fid, the geometry, and the object id `-u type_id`
 * carries.
 *
 * 🔴 Deliberately slack, and no test pins it: against a ceiling of 1 600
 * this term is a rounding. Changing it to 0 moves nothing — 3 381 still
 * fires, 1 149 still passes, 4 still passes. It is here so the printed
 * number is the number Postgres sees, not because the verdict turns on
 * it.
 */
const NON_TAG_COLUMNS = 3;

/** The layers load-context.sh builds, and the file each one merges into. */
const LAYERS = ['water', 'place', 'poi'];

const DEFAULT_PIPELINE = 'scripts/osm-pipeline/load-context.sh';

/**
 * What the export will actually emit, read out of the pipeline script.
 *
 * 🔴 Read, never executed and never rewritten. scripts/osm-pipeline is
 * owned elsewhere; this check exists to price it, not to change it.
 *
 * Two shapes are possible and they are the whole point:
 *  - `--config=export-<layer>.json` present → the export is an allowlist,
 *    and the column count is however many tags that allowlist names;
 *  - absent → the export is every tag in the input, and the column count
 *    is whatever the real extracts hold.
 */
export function exportPlan(script) {
  const configured = /--config=(["']?)export-\$\{?name\}?\.json\1/.test(script);

  // 🔴 WHICH key the config writes, not merely that a config is written.
  //
  // Review drove this mutation and it survived: change the printf to
  // `{"exclude_tags":[…]}` and the export emits every tag EXCEPT those
  // four. The load dies with the 1 600-column error and a check that
  // only looked for `--config=` reported four columns and a tick. One
  // word, opposite meaning, guard silent.
  const key = /printf\s+'\{"(\w+)":\s*\[%s\]\}/.exec(script)?.[1] ?? null;

  const tags = {};
  const body = /case\s+"\$name"\s+in([\s\S]*?)esac/.exec(script);
  if (body) {
    for (const layer of LAYERS) {
      const line = new RegExp(`\\b${layer}\\)\\s*TAGS='([^']*)'`).exec(body[1]);
      if (line) {
        tags[layer] = line[1]
          .split(',')
          .map((t) => t.trim().replace(/^"|"$/g, ''))
          .filter(Boolean);
      }
    }
  }

  /**
   * `allowlist` — only the named tags become columns.
   * `excludelist` — everything but the named tags does.
   * `everything` — no config, so every key in the input does.
   */
  const mode = !configured
    ? 'everything'
    : key === 'include_tags'
      ? 'allowlist'
      : key === 'exclude_tags'
        ? 'excludelist'
        : 'unknown';

  return { configured, key, mode, tags };
}

/**
 * How many distinct tag keys the merged extract for a layer carries.
 *
 * `osmium tags-count` prints one line per key. Measured on the EU-27
 * merged water layer (797 MB): 2.6 s wall, 3 381 keys. That is the whole
 * cost of this probe.
 */
export function census(workDir, layer) {
  const file = join(workDir, `merged.${layer}.pbf`);
  if (!existsSync(file)) {
    throw new Error(
      `${file} is not there.\n` +
        'This check prices the export against the REAL extracts — the thing\n' +
        'a fixture cannot stand in for. Run the loader once, or point this at\n' +
        'the directory that holds them: --work-dir <dir>.',
    );
  }
  const out = execFileSync('osmium', ['tags-count', file], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const keys = out.split('\n').filter((l) => l.trim() !== '').length;
  if (keys === 0) {
    // An empty census is a failed census. A zero here would price every
    // export at three columns and pass forever.
    throw new Error(`osmium found no tags at all in ${file}`);
  }
  return keys;
}

/**
 * Columns the CREATE TABLE will ask for, per layer.
 *
 * 🔴 The census runs on EVERY path, including the one that passes.
 *
 * It used to short-circuit: with an allowlist in place the answer is its
 * length, so `censusOf` was never called and the extracts were never
 * read. Review measured the consequence —
 *
 *   WORK_DIR=/nonexistent node scripts/scale-check/check-osm-columns.mjs
 *   ✓ every layer fits: worst is 7 of 1600 columns    exit 0
 *
 * — so on the passing path this file was a grep of a shell script, and it
 * would have gone on saying "priced against the real extracts" on a
 * runner where the 797 MB merged layer had vanished. That is the one
 * thing the `camptribe-data` label is a promise about, and the check that
 * claims to verify it could not see it.
 *
 * It costs a few seconds and it buys the difference between a
 * measurement and an assertion about a string.
 */
export function columnsPerLayer(plan, censusOf) {
  return LAYERS.map((layer) => {
    const keys = censusOf(layer);
    const named = plan.tags[layer]?.length ?? 0;
    const tagColumns =
      plan.mode === 'allowlist' && named > 0
        ? named
        : plan.mode === 'excludelist'
          ? Math.max(0, keys - named)
          : keys;
    return {
      layer,
      mode: plan.mode,
      keys,
      tagColumns,
      columns: tagColumns + NON_TAG_COLUMNS,
    };
  });
}

function report(rows) {
  for (const r of rows) {
    const how =
      r.mode === 'allowlist' && r.tagColumns < r.keys
        ? `${r.tagColumns} of ${r.keys} keys in the extract are allowlisted`
        : r.mode === 'excludelist'
          ? `${r.tagColumns} of ${r.keys} keys survive an EXCLUDE list`
          : `${r.keys} distinct keys in the extract — nothing narrows them`;
    console.log(
      `  ${r.layer.padEnd(6)} ${String(r.columns).padStart(5)} columns  (${how})`,
    );
  }
}

function verdict(rows) {
  return rows.filter((r) => r.columns > POSTGRES_MAX_COLUMNS);
}

function run(argv) {
  const workDir = argFor(argv, '--work-dir') ?? defaultWorkDir();
  const pipeline = argFor(argv, '--pipeline') ?? DEFAULT_PIPELINE;
  const script = readFileSync(pipeline, 'utf8');
  const plan = exportPlan(script);

  console.log(`pipeline: ${pipeline}`);
  console.log(`extracts: ${workDir}`);
  console.log(`export config: ${plan.key ?? 'none'} (${plan.mode})`);

  // 🔴 An export config whose key we do not recognise is not a pass.
  // `include_tags` and `exclude_tags` differ by one word and mean
  // opposite things; a third spelling means osmium is doing something
  // this check cannot price.
  if (plan.mode === 'unknown') {
    console.error(
      `\n✗ the export writes {"${plan.key}": …}, which this check does not ` +
        'know how to price.\nosmium\'s allowlist key is `include_tags`. Until ' +
        'this file learns the new one,\nit cannot tell you how many columns ' +
        'the load will ask for.\n',
    );
    process.exit(1);
  }

  const rows = columnsPerLayer(plan, (layer) => census(workDir, layer));
  report(rows);

  const over = verdict(rows);
  if (over.length > 0) {
    console.error(
      `\n✗ ${over.length} layer(s) would ask Postgres for more than ` +
        `${POSTGRES_MAX_COLUMNS} columns:\n`,
    );
    for (const r of over) {
      console.error(`   ${r.layer}: ${r.columns}`);
    }
    console.error(
      '\nThis is the failure of 25.09.2026, and its symptom is\n' +
        '  ERROR:  tables can have at most 1600 columns\n' +
        'with nothing in it that names the cause. Nothing loads and the old\n' +
        'contents stay in place looking like data.\n\n' +
        'The export has to name the tags it wants. It is not a size problem:\n' +
        "measured on Malta's water layer, narrowing 87 tags to 4 shrinks the\n" +
        'file by 3%. It does not make the export smaller; it makes the table\n' +
        'possible.\n',
    );
    process.exit(1);
  }

  const worst = Math.max(...rows.map((r) => r.columns));
  console.log(
    `\n✓ every layer fits: worst is ${worst} of ${POSTGRES_MAX_COLUMNS} columns`,
  );
}

/**
 * 🔴 The rehearsal, and it has two halves because the defect has two.
 *
 * Half one: take the real pipeline, remove the one flag that narrows the
 * export, and price it against the REAL EU-27 extracts. The check must
 * fail. Without this the check is a comment.
 *
 * Half two — the half that makes this a scale check rather than a test:
 * price that same broken pipeline against the three countries it was
 * developed on. The check must PASS. That is the defect's actual shape:
 * the code is equally broken in both runs, and only the data makes it
 * visible.
 */
function selfTest(argv) {
  const workDir = argFor(argv, '--work-dir') ?? defaultWorkDir();
  const real = readFileSync(DEFAULT_PIPELINE, 'utf8');
  const broken = real.replace(/^\s*--config=.*\n/m, '');
  if (broken === real) {
    console.error(
      '✗ could not find the --config= line in the pipeline, so the rehearsal\n' +
        '  would have been against an unbroken copy. That is the failure this\n' +
        '  whole file is about: a guard rehearsing nothing and reporting green.',
    );
    return false;
  }

  const brokenPlan = exportPlan(broken);
  const realPlan = exportPlan(real);
  let ok = true;

  // 🔴 The mutation review drove and this check survived: one word in the
  // printf turns an allowlist into its opposite. Rehearsed here, because
  // a defect found once in review and not pinned by a test comes back.
  const inverted = exportPlan(real.replace('"include_tags"', '"exclude_tags"'));
  const invertedRows = columnsPerLayer(inverted, (l) => census(workDir, l));
  console.log('\nthe pipeline with include_tags turned into exclude_tags:');
  report(invertedRows);
  if (verdict(invertedRows).length === 0) {
    console.error(
      '✗ inverting the config left the check quiet. Exporting every tag BUT\n' +
        '  four is the same 1 600-column death as exporting all of them.',
    );
    ok = false;
  } else {
    console.log('  ✓ fires');
  }

  // Half one: EU-27, the real merged extracts.
  const atScale = columnsPerLayer(brokenPlan, (l) => census(workDir, l));
  console.log('\nthe pipeline with its allowlist removed, priced on EU-27:');
  report(atScale);
  if (verdict(atScale).length === 0) {
    console.error('✗ the check did not fire on the broken pipeline at EU-27 scale');
    ok = false;
  } else {
    console.log('  ✓ fires, as it must');
  }

  // Half two: the same broken pipeline on the three countries it was
  // written against. Union of the per-country censuses, because that is
  // what merging them gives.
  const three = ['slovenia', 'croatia', 'france'];
  const small = columnsPerLayer(brokenPlan, (layer) =>
    unionOfKeys(workDir, three, layer),
  );
  console.log('\nthe same broken pipeline, priced on slovenia+croatia+france:');
  report(small);
  if (verdict(small).length > 0) {
    console.error(
      '✗ the broken pipeline failed on three countries too, so this defect\n' +
        '  was never scale-only and the story in this file is wrong.',
    );
    ok = false;
  } else {
    console.log('  ✓ passes — which is exactly why CI never saw this');
  }

  // And the real pipeline must pass at full scale, or the check is
  // failing the thing it is meant to bless.
  const fixed = columnsPerLayer(realPlan, (l) => census(workDir, l));
  console.log('\nthe pipeline as it stands, priced on EU-27:');
  report(fixed);
  if (verdict(fixed).length > 0) {
    console.error('✗ the shipped pipeline does not pass its own check');
    ok = false;
  } else {
    console.log('  ✓ passes');
  }

  console.log(
    ok
      ? '\n✓ rehearsed: the check fires on the broken export at EU-27 and not at three countries'
      : '\n✗ rehearsal failed',
  );
  return ok;
}

/** The union of tag keys across several single-country extracts. */
function unionOfKeys(workDir, countries, layer) {
  const keys = new Set();
  for (const c of countries) {
    const file = join(workDir, `europe-${c}.${layer}.pbf`);
    if (!existsSync(file)) {
      throw new Error(`${file} is not there — the rehearsal needs it`);
    }
    const out = execFileSync('osmium', ['tags-count', file], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    for (const line of out.split('\n')) {
      // count \t "key"
      const m = /^\d+\t"((?:[^"]|"")*)"/.exec(line);
      if (m) keys.add(m[1]);
    }
  }
  if (keys.size === 0) throw new Error('the rehearsal census found no tags');
  return keys.size;
}

function defaultWorkDir() {
  // 🔴 `||`, not `??`. GitHub sets an unset repository variable to the
  // EMPTY STRING, which is defined, so `??` would leave WORK_DIR as ''
  // and `join('', 'merged.water.pbf')` would resolve against the repo
  // root — a missing-extracts run wearing the name of a configured one.
  // load-context.sh has always had this right with `${WORK_DIR:-…}`.
  return process.env.WORK_DIR || join(process.env.HOME ?? '', 'camptribe-osm');
}

function argFor(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  if (process.argv.includes('--self-test')) {
    process.exit(selfTest(process.argv) ? 0 : 1);
  } else {
    run(process.argv);
  }
}
