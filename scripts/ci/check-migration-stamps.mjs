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

import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction, flagValue } from '../lib/entrypoint.mjs';


const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REL = 'apps/api/src/migrations';
const REPO_ROOT = join(HERE, '..', '..');
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


// 🔴 CAMP-497. THE GUARD ABOVE ONLY EVER SEES ITS OWN TREE, so two
// branches that each pick the same stamp are each green, and the
// collision is born at the SECOND merge. It happened three times in two
// days (the last: `AttributionBannerImages` in #549 and
// `SeedTestBlogPosts` on main, both 1796500000000). Nothing in a single
// checkout can see it — the other half lives on another branch.
//
// So this branch's class stamps are also compared with those on
// `origin/main` and on the head of EVERY OPEN PR, read with
// `git fetch` + `git ls-tree` + `git show`, never a checkout.
//
// What counts as a collision: the same 13-digit stamp on a DIFFERENT
// class. The same class name and stamp is the same migration — a branch
// that fell a week behind main still carries main's old migrations, and
// must not go red for them.
//
// 🔴 PRICE OF A FALSE ALARM, which decides red vs warning when the
// other branches cannot be read (no network, no token, GitHub down):
// a red here blocks every PR on a GitHub hiccup, and the author can do
// nothing about it. Silence costs less than that, because the
// single-tree check still runs on `main` after the merge and catches the
// collision there (late, which is the very cost this card exists to cut
// — but loud, not lost). So: NOT red — a separate explicit line,
// "parallel branches NOT checked", plus a CI warning annotation. It is
// never the green line.

const git = (repo, args) =>
  spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

/** Same shape as `readEntries`, but from a commit-ish, with no checkout. */
export function readEntriesFromRef(repo, ref, rel = DEFAULT_REL) {
  const ls = git(repo, ['ls-tree', '-r', '--name-only', ref, '--', `${rel}/`]);
  if (ls.status !== 0) throw new Error(`ls-tree ${ref}: ${ls.stderr.trim()}`);
  const out = [];
  for (const path of ls.stdout.split('\n').filter((f) => f.endsWith('.ts'))) {
    const show = git(repo, ['show', `${ref}:${path}`]);
    if (show.status !== 0) throw new Error(`show ${ref}:${path}`);
    const className =
      /export\s+class\s+([A-Za-z0-9_]+)/.exec(show.stdout)?.[1] ?? null;
    if (!className) continue;
    const file = path.slice(path.lastIndexOf('/') + 1);
    out.push({
      file,
      className,
      fileStamp: stampOfFile(file),
      classStamp: stampOfClass(className),
    });
  }
  return out;
}

/**
 * This branch against the others: one finding per stamp carried by a
 * different class on a different branch. `others` is
 * `[{label, entries}]`.
 */
export function crossFindings(own, others) {
  const problems = [];
  for (const { label, entries } of others) {
    for (const theirs of entries) {
      if (!theirs.classStamp) continue;
      for (const mine of own) {
        if (mine.classStamp === theirs.classStamp && mine.className !== theirs.className) {
          problems.push({
            kind: 'parallel-collision',
            detail:
              `${mine.classStamp} is carried by ${mine.className} (this branch) ` +
              `and ${theirs.className} (${label})`,
          });
        }
      }
    }
  }
  return problems;
}

/** Open PRs as `[{number, headRefName}]` — injectable file for rehearsal. */
function listOpenPrs(prsJson) {
  if (prsJson) return JSON.parse(readFileSync(prsJson, 'utf8'));
  const res = spawnSync(
    'gh',
    ['pr', 'list', '--state', 'open', '--limit', '300', '--json', 'number,headRefName'],
    { encoding: 'utf8' },
  );
  if (res.status !== 0) throw new Error(`gh pr list: ${(res.stderr || res.error || '').toString().trim()}`);
  return JSON.parse(res.stdout);
}

/**
 * Read origin/main and every open PR head. Never throws: what could not
 * be read is counted, so the caller prints the denominator honestly.
 */
export function gatherOthers({ repo, remote, rel, self, prsJson }) {
  const others = [];
  let unread = 0;
  const failure = [];
  const fetchRead = (label, refspec, local) => {
    const f = git(repo, ['fetch', '--no-tags', '--depth=1', '--quiet', remote, `+${refspec}:${local}`]);
    if (f.status !== 0) {
      unread += 1;
      failure.push(`${label}: ${f.stderr.trim().split('\n')[0]}`);
      return;
    }
    try {
      others.push({ label, entries: readEntriesFromRef(repo, local, rel) });
    } catch (e) {
      unread += 1;
      failure.push(`${label}: ${e.message}`);
    }
  };

  let prs = [];
  let listError = null;
  try {
    prs = listOpenPrs(prsJson).filter((p) => p.headRefName !== self);
  } catch (e) {
    listError = e.message;
  }
  if (self !== 'main') fetchRead('origin/main', 'refs/heads/main', 'refs/camp-stamps/main');
  for (const pr of prs) {
    fetchRead(`PR #${pr.number} ${pr.headRefName}`, `refs/pull/${pr.number}/head`, `refs/camp-stamps/pr-${pr.number}`);
  }
  return { others, unread, failure, listError, total: prs.length + (self !== 'main' ? 1 : 0) };
}

function run(dir, opts = {}) {
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
  return parallelStep(entries, opts);
}

/** The cross-branch half. Prints its denominator or its blindness, never nothing. */
function parallelStep(entries, opts) {
  if (opts.noParallel) {
    console.log('- parallel branches NOT checked (--no-parallel)');
    return 0;
  }
  const self = opts.self;
  if (self === 'main') {
    console.log('- parallel branches: n/a on main (the single-tree check above is the one that applies)');
    return 0;
  }
  const g = gatherOthers({
    repo: opts.repo,
    remote: opts.remote,
    rel: opts.rel,
    self,
    prsJson: opts.prsJson,
  });
  const found = crossFindings(entries, g.others);
  if (found.length > 0) {
    console.error('\n✗ Stamp already taken on another branch:\n');
    for (const p of found) console.error(`  [${p.kind}] ${p.detail}`);
    console.error('\n  Whichever merges second creates the collision. Move this');
    console.error('  migration on (new 13 digits in the file AND the class name).');
    return 1;
  }
  const read = g.others.length;
  if (g.listError || g.unread > 0 || read === 0) {
    const why = g.listError ? `open-PR list failed: ${g.listError}` : g.failure.join('; ') || 'nothing could be read';
    const line = `parallel branches NOT fully checked: ${read} of ${g.total} read (${why}); the single-tree check above still holds, and main re-runs it after the merge`;
    console.log(`⚠ ${line}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=migration stamps::${line}`);
    return 0;
  }
  console.log(`✓ parallel: ${read} branches compared (origin/main + ${read - (self === 'main' ? 0 : 1)} open PRs), no stamp taken by a different class`);
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
  let cases = 0;

  const scenario = (name, files) => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    for (const [file, className] of files) {
      writeFileSync(
        join(dir, file),
        `export class ${className} { async up() {} }\n`,
      );
    }
    const out = spawnSync(process.execPath, [self, '--dir', dir, '--no-parallel'], {
      encoding: 'utf8',
    });
    return out.status;
  };

  const expect = (label, actual, wanted) => {
    cases += 1;
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

  // 🔴 CAMP-497: the cross-branch half is rehearsed against a REAL git
  // remote (a bare repo with `refs/pull/N/head`), through the whole script
  // and its exit code — not by calling `crossFindings`. Narrowing the
  // guard back to the current tree turns `parallel collision` green.
  const gitIn = (cwd, ...a) =>
    spawnSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  const commitTree = (repoDir, files) => {
    const m = join(repoDir, DEFAULT_REL);
    mkdirSync(m, { recursive: true });
    for (const [file, className] of files) {
      writeFileSync(join(m, file), `export class ${className} { async up() {} }\n`);
    }
    gitIn(repoDir, 'add', '-A');
    gitIn(repoDir, 'commit', '-q', '-m', 'x');
  };
  const parallelScenario = (name, { mainFiles, mainLater = [], prFiles, mine }) => {
    const base = join(root, name);
    const origin = join(base, 'origin.git');
    const work = join(base, 'work');
    mkdirSync(base, { recursive: true });
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    spawnSync('git', ['init', '-q', '-b', 'main', work]);
    gitIn(work, 'remote', 'add', 'origin', origin);
    commitTree(work, mainFiles);
    gitIn(work, 'push', '-q', 'origin', 'main');
    // This branch forks HERE; main moves on afterwards (a stale branch).
    gitIn(work, 'branch', 'mine');
    if (mainLater.length > 0) {
      commitTree(work, mainLater);
      gitIn(work, 'push', '-q', 'origin', 'main');
    }
    const prs = [];
    prFiles.forEach((files, i) => {
      gitIn(work, 'checkout', '-q', '-B', `pr${i}`, 'origin/main');
      commitTree(work, files);
      gitIn(work, 'push', '-q', 'origin', `pr${i}:refs/pull/${i + 1}/head`);
      prs.push({ number: i + 1, headRefName: `feature-${i}` });
    });
    // this branch: a checkout of main plus its own migration(s)
    gitIn(work, 'checkout', '-q', 'mine');
    commitTree(work, mine);
    const prsFile = join(base, 'prs.json');
    writeFileSync(prsFile, JSON.stringify(prs));
    const r = spawnSync(
      process.execPath,
      [self, '--dir', join(work, DEFAULT_REL), '--repo', work, '--prs-json', prsFile, '--self-branch', 'mine'],
      { encoding: 'utf8' },
    );
    return { status: r.status, out: r.stdout + r.stderr };
  };

  const A = ['1796500000000-AttributionBannerImages.ts', 'AttributionBannerImages1796500000000'];
  const B = ['1796500000000-SeedTestBlogPosts.ts', 'SeedTestBlogPosts1796500000000'];
  const C = ['1796600000000-Other.ts', 'Other1796600000000'];
  const OLD = ['1790662800000-BathingWaters.ts', 'BathingWaters1790662800000'];

  // (a) two branches, one stamp: this one against an open PR.
  const vsPr = parallelScenario('par-pr', { mainFiles: [OLD], prFiles: [[B]], mine: [A] });
  expect('same stamp as an OPEN PR on another branch', vsPr.status, 1);
  if (!(vsPr.out.includes('AttributionBannerImages') && vsPr.out.includes('SeedTestBlogPosts') && vsPr.out.includes('feature-0'))) {
    console.error('✗ REHEARSAL FAILED: the finding must name both classes and the other branch');
    rc = 1;
  }
  // ...and against origin/main itself.
  const vsMain = parallelScenario('par-main', { mainFiles: [OLD], mainLater: [B], prFiles: [], mine: [A] });
  expect('same stamp as origin/main', vsMain.status, 1);
  // The denominator is printed on the green path.
  const clean = parallelScenario('par-clean', { mainFiles: [OLD], prFiles: [[B]], mine: [C] });
  expect('distinct from main and every open PR', clean.status, 0);
  if (!/parallel: 2 branches compared \(origin\/main \+ 1 open PRs\)/.test(clean.out)) {
    console.error('✗ REHEARSAL FAILED: the green line must print how many branches were compared');
    rc = 1;
  }
  // A branch that is merely behind: the SAME class on main and here is one migration.
  const behind = parallelScenario('par-behind', { mainFiles: [OLD, B], mainLater: [['1796700000000-Later.ts', 'Later1796700000000']], prFiles: [], mine: [C] });
  expect('a branch that carries main\'s own migration is not a collision', behind.status, 0);
  // Unreachable remote: loud, separate line, not the green one, not red.
  const blind = spawnSync(
    process.execPath,
    [self, '--dir', join(root, 'par-clean', 'work', DEFAULT_REL), '--repo', join(root, 'par-clean', 'work'),
      '--remote', 'nowhere', '--prs-json', join(root, 'par-clean', 'prs.json'), '--self-branch', 'mine'],
    { encoding: 'utf8' },
  );
  expect('an unreachable remote does not block', blind.status, 0);
  if (!/parallel branches NOT fully checked/.test(blind.stdout) || /✓ parallel/.test(blind.stdout)) {
    console.error('✗ REHEARSAL FAILED: an unreadable remote must say NOT checked and never print the green line');
    rc = 1;
  }

  // 🔴 CAMP-286: counted, because a scenario that stopped being
  // rehearsed prints exactly what a passing one prints — nothing.
  const EXPECTED_CASES = 11;
  if (cases !== EXPECTED_CASES) {
    console.error(`✗ ${cases} scenarios ran, expected ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) {
    console.log(
      '✓ rehearsal: the check exits 1 on a collision — including one the\n' +
        '  file names hide — on a drifted stamp and on a missing one, and\n' +
        '  exits 0 on a clean directory.',
    );
    console.log(`\n✓ check-migration-stamps self-test: ${cases} scenarios`);
  }
  return rc;
}

// 🔴 CAMP-286: the house guard, written out rather than called, because
// check-script-entrypoints.mjs recognises a guard by READING it.
// `realpathSync` on the argv side: Node resolves `import.meta.url`
// through the real path and leaves argv[1] as written, so through a
// symlink the two never match and the self-test silently does not run.
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const action = chooseAction(
    process.argv.slice(2),
    ['--self-test', '--dir', '--no-parallel', '--repo', '--remote', '--prs-json', '--self-branch'],
    'check-migration-stamps.mjs',
    { takesValue: ['--dir', '--repo', '--remote', '--prs-json', '--self-branch'] },
  );
  if (action.has('--self-test')) process.exit(selfTest());
  // 🔴 `flagValue`, not `indexOf`. Review measured `--dir=<path>` —
  // a spelling chooseAction accepts — being read as absent, so the check
  // scanned DEFAULT_DIR and printed ✓ over a directory it never looked
  // at (CAMP-286).
  const argv = process.argv.slice(2);
  const repo = flagValue(argv, '--repo') ?? REPO_ROOT;
  process.exit(
    run(flagValue(argv, '--dir') ?? DEFAULT_DIR, {
      noParallel: action.has('--no-parallel'),
      repo,
      remote: flagValue(argv, '--remote') ?? 'origin',
      rel: DEFAULT_REL,
      prsJson: flagValue(argv, '--prs-json'),
      self:
        flagValue(argv, '--self-branch') ??
        process.env.GITHUB_HEAD_REF ??
        (git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() || 'HEAD'),
    }),
  );
}
