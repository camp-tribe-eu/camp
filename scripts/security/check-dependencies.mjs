#!/usr/bin/env node
// Dependency watchdog: tell us the day a NEW advisory appears.
//
// 🔴 Why a baseline rather than "fail on any vulnerability".
//
// Most of what npm reports here is transitive and unreachable: mysql2
// arrives inside TypeORM and we use Postgres, multer inside Nest's
// Express adapter and we accept no uploads, postcss inside Next's build.
// A check that failed on all of them would be switched off within a
// week, and then the one that mattered would arrive unseen.
//
// So the known set is written down, with a reason each, and this fails
// on anything that is NOT in it. That is the alert: something changed.
//
//   node scripts/security/check-dependencies.mjs             # check
//   node scripts/security/check-dependencies.mjs --update    # accept
//   node scripts/security/check-dependencies.mjs --self-test # prove it works
//
// 🔴 Why the workspace list is derived, not written down. It used to be
// `const WORKSPACES = ['apps/api', 'apps/web']` — a hand-written list,
// while package.json declares `workspaces: ["apps/*"]`. apps/cms was
// added on 21.09.2026 and this file never noticed. Measured the next
// day: 11 advisories in apps/api, 3 in apps/web, and 49 in apps/cms
// including the only critical in the repository. The guard had been
// printing "✓ no new dependency advisories" over all of it.
//
// The lesson is not "add cms to the list" — it is that a guard whose
// scope is maintained by hand will silently stop covering the thing it
// was bought for. The scope now comes from the same declaration npm
// itself uses, so a new workspace is covered the day it appears.
//
// 🔴 Why a critical can be accepted, but only with a date. The earlier
// rule was that a critical always fails, even from the baseline. That is
// right in spirit and wrong in practice: we hold one (tar inside
// @directus/api) for which no fix exists at any version — Directus 12.3.1
// is the latest release and pins it exactly, and an npm `overrides` entry
// is silently ignored in this tree (verified: overriding tar to a version
// that does not exist at all still exits 0 and changes nothing). A rule
// that cannot be satisfied produces a permanently red build, which is the
// same as no build check at all.
//
// So a critical may sit in the baseline only with an explicit
// `acceptedUntil` date. Past that date it fails again, and somebody has
// to look at it and either fix it or re-argue the case. The decision
// stays out loud; it just stops being a decision we take every morning.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const BASELINE = path.join(here, 'known-advisories.json');

/**
 * Read a JSON file, or null if it is not there.
 *
 * 🔴 Never `existsSync` then `readFileSync`. CodeQL failed this file on
 * exactly that pair (js/file-system-race, high) the first time it ran,
 * as it had failed check-secrets.mjs the day before: between the check
 * and the use, the path can become something else. One syscall, and a
 * missing file answered by its own error, has no window to exploit.
 *
 * Only ENOENT becomes null. A malformed package.json or baseline still
 * throws, because "cannot parse" must never read as "not there" — that
 * is how a guard turns into a no-op.
 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Every workspace npm would install, read from the same `workspaces`
 * declaration npm reads. Only a single `*` segment is supported, which
 * is what the declaration uses; anything fancier should fail loudly
 * rather than quietly match nothing.
 */
export function discoverWorkspaces(root, readPkg, readDir) {
  const pkg = readPkg(path.join(root, 'package.json'));
  const globs = Array.isArray(pkg.workspaces)
    ? pkg.workspaces
    : (pkg.workspaces?.packages ?? []);

  const out = [];
  for (const glob of globs) {
    const segments = glob.split('/');
    if (segments.filter((s) => s.includes('*')).length > 1) {
      throw new Error(
        `workspace glob "${glob}" is more than this can expand — ` +
          'teach it the new shape rather than letting it match nothing',
      );
    }
    const star = segments.indexOf('*');
    if (star === -1) {
      if (readPkg(path.join(root, glob, 'package.json'))) out.push(glob);
      continue;
    }
    if (star !== segments.length - 1) {
      throw new Error(`workspace glob "${glob}" has * before the last segment`);
    }
    const parent = segments.slice(0, star).join('/');
    for (const entry of readDir(path.join(root, parent)).sort()) {
      const rel = `${parent}/${entry}`;
      if (readPkg(path.join(root, rel, 'package.json'))) out.push(rel);
    }
  }
  return out;
}

/** Every advisory npm reports for a workspace's production dependencies. */
function advisoriesFor(ws) {
  let raw;
  try {
    raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      cwd: path.join(ROOT, ws),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      // npm exits non-zero when it finds anything; that is not an error
      // here, the report is what we want.
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    raw = err.stdout;
    if (!raw) {
      throw new Error(`npm audit produced no output in ${ws} — cannot check`);
    }
  }

  const report = JSON.parse(raw);
  const out = new Map();
  for (const [pkg, v] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of v.via ?? []) {
      if (typeof via !== 'object' || !via.url) continue;
      const id = via.url.replace(/.*\//, '');
      out.set(id, {
        severity: via.severity,
        package: pkg,
        title: (via.title ?? '').slice(0, 90),
      });
    }
  }
  return out;
}

/**
 * The whole decision, with no filesystem and no network in it, so the
 * self-test can drive it through every branch.
 *
 * @param found    {ws: Map<id, {severity, package, title}>}
 * @param baseline {ws: {id: {severity, package, title, why, acceptedUntil?}}}
 * @param today    Date
 */
export function evaluate(found, baseline, today) {
  const problems = [];
  const notes = [];

  for (const ws of Object.keys(found)) {
    const known = baseline[ws] ?? {};
    const current = found[ws];

    for (const [id, v] of current) {
      const entry = known[id];

      if (!entry) {
        problems.push({
          ws,
          id,
          kind: 'new',
          text: `NEW ${v.severity} ${id} ${v.package} — ${v.title}`,
        });
        continue;
      }

      // 🔴 A critical is the only severity that can go stale in the
      // baseline. Everything else is reviewed when it arrives; a
      // critical is reviewed again, on a date somebody wrote down.
      if (v.severity === 'critical') {
        if (!entry.acceptedUntil) {
          problems.push({
            ws,
            id,
            kind: 'critical-undated',
            text:
              `CRITICAL ${id} ${v.package} is in the baseline with no ` +
              '"acceptedUntil" — a critical needs a review date, not just a reason',
          });
        } else if (new Date(entry.acceptedUntil) < today) {
          problems.push({
            ws,
            id,
            kind: 'critical-expired',
            text:
              `CRITICAL ${id} ${v.package} was accepted until ` +
              `${entry.acceptedUntil}; that date has passed — look at it again`,
          });
        } else {
          notes.push({
            ws,
            text: `critical ${id} (${v.package}) accepted until ${entry.acceptedUntil}`,
          });
        }
      }
    }

    // Not a failure — but worth saying, so the baseline does not rot
    // into a list of things that stopped being true.
    for (const id of Object.keys(known)) {
      if (!current.has(id)) {
        notes.push({ ws, text: `fixed upstream, drop from the baseline: ${id}` });
      }
    }
  }

  return { problems, notes };
}

// ---------------------------------------------------------------------

function selfTest() {
  let failures = 0;
  const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      console.error(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
      failures++;
    } else {
      console.log(`  ✓ ${name}`);
    }
  };

  const today = new Date('2026-09-22');
  const map = (o) => new Map(Object.entries(o));
  const kinds = (r) => r.problems.map((p) => `${p.ws}:${p.kind}`).sort();

  // — the bug this file was written to stop having ——————————————
  const fakeTree = {
    '/r/package.json': { workspaces: ['apps/*'] },
    '/r/apps/api/package.json': { name: 'api' },
    '/r/apps/web/package.json': { name: 'web' },
    '/r/apps/cms/package.json': { name: 'cms' },
  };
  const readPkg = (p) => fakeTree[p.split(path.sep).join('/')] ?? null;
  const readDir = () => ['web', 'api', 'cms', 'uploads-not-a-package'];
  check(
    'a workspace added later is discovered, not forgotten',
    discoverWorkspaces('/r', readPkg, readDir),
    ['apps/api', 'apps/cms', 'apps/web'],
  );

  check(
    'the real repository still resolves all three workspaces',
    discoverWorkspaces(ROOT, readJson, (d) => readdirSync(d)),
    ['apps/api', 'apps/cms', 'apps/web'],
  );

  let threw = false;
  try {
    discoverWorkspaces(
      '/r',
      () => ({ workspaces: ['a/*/b/*'] }),
      () => [],
    );
  } catch {
    threw = true;
  }
  check('a glob it cannot expand fails loudly', threw, true);

  // — reading, without a check-then-use window ——————————————————
  check(
    'a file that is not there reads as null, not as an error',
    readJson(path.join(tmpdir(), `nope-${process.pid}.json`)),
    null,
  );

  const broken = path.join(tmpdir(), `broken-${process.pid}.json`);
  writeFileSync(broken, '{ this is not json');
  let parseThrew = false;
  try {
    readJson(broken);
  } catch {
    parseThrew = true;
  }
  rmSync(broken, { force: true });
  check('a file it cannot parse throws, and never reads as absent', parseThrew, true);

  // — the baseline decision ————————————————————————————————
  const moderate = { severity: 'moderate', package: 'p', title: 't' };
  const critical = { severity: 'critical', package: 'tar', title: 't' };

  check(
    'a known advisory passes',
    kinds(evaluate({ w: map({ A: moderate }) }, { w: { A: { why: 'x' } } }, today)),
    [],
  );
  check(
    'an unknown advisory fails',
    kinds(evaluate({ w: map({ A: moderate }) }, { w: {} }, today)),
    ['w:new'],
  );
  check(
    'a critical with no review date fails',
    kinds(evaluate({ w: map({ A: critical }) }, { w: { A: { why: 'x' } } }, today)),
    ['w:critical-undated'],
  );
  check(
    'a critical accepted until a future date passes',
    kinds(
      evaluate(
        { w: map({ A: critical }) },
        { w: { A: { why: 'x', acceptedUntil: '2026-12-22' } } },
        today,
      ),
    ),
    [],
  );
  check(
    'a critical whose date has passed fails again',
    kinds(
      evaluate(
        { w: map({ A: critical }) },
        { w: { A: { why: 'x', acceptedUntil: '2026-09-21' } } },
        today,
      ),
    ),
    ['w:critical-expired'],
  );
  check(
    'a workspace with no baseline at all fails on every advisory',
    kinds(evaluate({ cms: map({ A: moderate, B: critical }) }, {}, today)),
    ['cms:new', 'cms:new'],
  );
  check(
    'an advisory that disappeared is reported, not failed',
    evaluate({ w: map({}) }, { w: { A: { why: 'x' } } }, today).notes.map((n) => n.text),
    ['fixed upstream, drop from the baseline: A'],
  );

  console.log(failures ? `\n✗ ${failures} self-test failure(s)` : '\n✓ self-test passed');
  process.exit(failures ? 1 : 0);
}

// ---------------------------------------------------------------------

if (process.argv.includes('--self-test')) selfTest();

const WORKSPACES = discoverWorkspaces(ROOT, readJson, (d) => readdirSync(d));

const found = {};
for (const ws of WORKSPACES) found[ws] = advisoriesFor(ws);

if (process.argv.includes('--update')) {
  const previous = readJson(BASELINE) ?? {};
  const baseline = {};
  for (const ws of WORKSPACES) {
    baseline[ws] = Object.fromEntries(
      [...found[ws]].sort().map(([id, v]) => [
        id,
        {
          severity: v.severity,
          package: v.package,
          title: v.title,
          // Keep a reason somebody already wrote; only ask about the new ones.
          why: previous[ws]?.[id]?.why ?? 'REVIEW ME — say why this is accepted, or fix it',
          ...(previous[ws]?.[id]?.acceptedUntil
            ? { acceptedUntil: previous[ws][id].acceptedUntil }
            : {}),
        },
      ]),
    );
  }
  writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`baseline written: ${BASELINE}`);
  console.log('🔴 Every entry needs a real "why" before this is committed.');
  process.exit(0);
}

const baseline = readJson(BASELINE);
if (!baseline) {
  console.error(
    `No baseline at ${BASELINE}. Run with --update and write a reason for ` +
      'each entry. A check with nothing to compare against is not a check.',
  );
  process.exit(1);
}

const { problems, notes } = evaluate(found, baseline, new Date());

for (const ws of WORKSPACES) {
  const counts = {};
  for (const [, v] of found[ws]) counts[v.severity] = (counts[v.severity] ?? 0) + 1;
  console.log(
    `${ws}: ${found[ws].size} advisories ` +
      `(${Object.entries(counts).map(([s, n]) => `${s}:${n}`).join(', ') || 'none'})`,
  );
  for (const n of notes.filter((n) => n.ws === ws)) console.log(`  · ${n.text}`);
  for (const p of problems.filter((p) => p.ws === ws)) console.error(`  🔴 ${p.text}`);
}

if (problems.length) {
  console.error(
    '\n✗ A dependency advisory appeared that nobody has looked at.\n' +
      '  Fix it, or run --update and write down why it is accepted.',
  );
  process.exit(1);
}
console.log('\n✓ no new dependency advisories');
