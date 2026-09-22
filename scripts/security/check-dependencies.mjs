#!/usr/bin/env node
// Dependency watchdog: tell us the day a NEW advisory appears.
//
// 🔴 Why a baseline rather than "fail on any vulnerability".
//
// Measured on 22.09.2026: 22 distinct advisories in apps/api and 4 in
// apps/web, every one of them transitive — mysql2 arrives inside
// TypeORM and we use Postgres, multer inside Nest's Express adapter and
// we accept no uploads, postcss and picomatch inside Next's build. None
// is reachable from code we wrote. A check that fails on all of them
// would be switched off within a week, and then the one that mattered
// would arrive unseen.
//
// So the known set is written down, with a reason each, and this fails
// on anything that is NOT in it. That is the alert: something changed.
//
//   node scripts/security/check-dependencies.mjs           # check
//   node scripts/security/check-dependencies.mjs --update  # accept the
//                                                          # current set
//
// 🔴 A critical fails even when it is in the baseline. Nothing critical
// should ever sit on an "accepted" list quietly; if one genuinely must
// be tolerated, that is a decision to take out loud, not by editing a
// JSON file.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const BASELINE = path.join(here, 'known-advisories.json');
const WORKSPACES = ['apps/api', 'apps/web'];
const update = process.argv.includes('--update');

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

const found = {};
for (const ws of WORKSPACES) found[ws] = advisoriesFor(ws);

if (update) {
  const baseline = {};
  for (const ws of WORKSPACES) {
    baseline[ws] = Object.fromEntries(
      [...found[ws]].sort().map(([id, v]) => [
        id,
        {
          severity: v.severity,
          package: v.package,
          title: v.title,
          why: 'REVIEW ME — say why this is accepted, or fix it',
        },
      ]),
    );
  }
  writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`baseline written: ${BASELINE}`);
  console.log('🔴 Every entry needs a real "why" before this is committed.');
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(
    `No baseline at ${BASELINE}. Run with --update and write a reason for ` +
      'each entry. A check with nothing to compare against is not a check.',
  );
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));

let failed = false;
for (const ws of WORKSPACES) {
  const known = baseline[ws] ?? {};
  const current = found[ws];
  const fresh = [...current].filter(([id]) => !(id in known));
  const gone = Object.keys(known).filter((id) => !current.has(id));
  const criticals = [...current].filter(([, v]) => v.severity === 'critical');

  const counts = {};
  for (const [, v] of current) counts[v.severity] = (counts[v.severity] ?? 0) + 1;
  console.log(
    `${ws}: ${current.size} advisories ` +
      `(${Object.entries(counts).map(([s, n]) => `${s}:${n}`).join(', ') || 'none'})`,
  );

  for (const [id, v] of fresh) {
    console.error(`  🔴 NEW  ${v.severity.padEnd(8)} ${id}  ${v.package} — ${v.title}`);
    failed = true;
  }
  for (const [id, v] of criticals) {
    console.error(`  🔴 CRITICAL ${id}  ${v.package} — ${v.title}`);
    failed = true;
  }
  // Not a failure — but worth saying, so the baseline does not rot into a
  // list of things that stopped being true.
  for (const id of gone) {
    console.log(`  ✓ fixed upstream, drop from the baseline: ${id}`);
  }
}

if (failed) {
  console.error(
    '\n✗ A dependency advisory appeared that nobody has looked at.\n' +
      '  Fix it, or run --update and write down why it is accepted.',
  );
  process.exit(1);
}
console.log('\n✓ no new dependency advisories');
