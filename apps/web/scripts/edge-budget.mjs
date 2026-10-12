#!/usr/bin/env node
// CAMP-282: the one place that decides what a generated edge file may weigh.
//
// 🔴 TWO GENERATORS HAD THIS RULE, SEPARATELY, AND IT SHOWED.
//
// `gen-links.mjs` and `gen-gone.mjs` both bundle a JSON file into the
// edge middleware, both enforced a cap, and both said nothing at all
// until the day they refused to build. The redirect map reached 80.0% of
// its cap on 12.10.2026 with nobody told, while the comment beside the
// cap still quoted 56% from the first run months earlier. A reader had
// every reason to believe there was twice the room there was.
//
// A ceiling that only speaks when it is hit is not a budget, it is a
// trap: the message arrives in a red CI run, which is the worst moment
// to decide between raising the cap and moving the file out of the
// bundle.
//
// So: the size is printed on EVERY run, a warning starts well before the
// wall, and both boundaries are rehearsed by `--self-test` rather than
// discovered.

// 🔴 WHOSE LIMIT IS THE CAP, ACTUALLY.
//
// Each caller passes its own number: 512 KB for the redirect map, 256 KB
// for the gone list. Both descend from one sentence in gen-gone.mjs —
// "1 MB on Cloudflare Workers" — and that is the whole provenance.
//
// 🔴 The host is Cloudflare PAGES, not Workers. `public/_headers` is a
// Pages file, written by gen-headers.mjs in prebuild and checked in CI
// by scripts/seo/check-indexing.mjs; security-headers.mjs says plainly
// that "Cloudflare Pages serves the built files and never runs Next's
// headers()". An earlier version of this comment claimed no host was
// configured at all, which was simply wrong — a review found the file.
//
// So the cap is a Workers number applied to a Pages deployment, and the
// two are not the same product. Nobody has measured what Pages allows a
// middleware bundle to weigh, or indeed whether it runs the middleware:
// without an adapter this build's middleware may never execute in
// production, which would make this budget a guard on something that is
// not deployed. That question is too big for a size check and has its
// own card.
//
// Which is why the message at 100% refuses to pick between raising the
// cap and moving the file out of the bundle: that choice needs a
// measured limit for the platform actually in use, and it is somebody's
// decision about money, not this script's.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Warn from here on, as a fraction of the cap. */
export const WARN_AT = 0.75;

/**
 * Report the size of a generated edge file and refuse the oversized one.
 *
 * Returns the bytes, so a caller can do its own reporting without
 * measuring twice.
 */
export function enforceEdgeBudget(
  name,
  body,
  maxBytes,
  { log = console.log, warn = console.warn } = {},
) {
  const bytes = Buffer.byteLength(body);
  const share = bytes / maxBytes;
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  log(
    `${name}: ${kb(bytes)} of ${kb(maxBytes)} (${(share * 100).toFixed(1)}%)`,
  );
  if (bytes > maxBytes) {
    throw new Error(
      `${name} is ${kb(bytes)}, over its ${kb(maxBytes)} edge budget. ` +
        'It is bundled into the middleware, so this is a deploy-stopping ' +
        'size. Two ways out, and the choice is not this script’s: raise ' +
        'the cap once somebody has measured what the edge bundle actually ' +
        'allows, or move the file to a lookup outside the bundle.',
    );
  }
  if (share >= WARN_AT) {
    warn(
      `⚠ ${name} is at ${(share * 100).toFixed(1)}% of its edge budget ` +
        `(${kb(maxBytes - bytes)} left). Decide what happens at 100% now, ` +
        'not in the build that fails.',
    );
  }
  return bytes;
}

/**
 * 🔴 Both boundaries, planted rather than waited for — and the MESSAGES
 * read, not merely counted.
 *
 * The first version recorded three booleans: did it log, did it warn,
 * did it throw. A review walked straight through it: printing the CAP
 * instead of the size passed 6/6, and so did multiplying the percentage
 * by ten, and so did emptying every message to a blank string. Printing
 * a constant where the measurement belongs is the exact bug this card
 * exists to fix, and the test for it could not see it.
 *
 * It also never called the DEFAULT handlers. Replacing them with no-ops
 * passed 6/6 while both generators printed nothing at all — the card's
 * one promise, unguarded.
 */
function selfTest() {
  const cap = 1000;
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  const pct = (n) => `${((n / cap) * 100).toFixed(1)}%`;
  const cases = [
    { name: 'well under', body: 'x'.repeat(100), warns: false, throws: false },
    {
      name: 'just under the warning',
      body: 'x'.repeat(749),
      warns: false,
      throws: false,
    },
    { name: 'at the warning', body: 'x'.repeat(750), warns: true, throws: false },
    { name: '76 per cent', body: 'x'.repeat(760), warns: true, throws: false },
    {
      name: 'exactly at the cap',
      body: 'x'.repeat(1000),
      warns: true,
      throws: false,
    },
    // 🔴 Over the cap it throws and does NOT also warn: the error says
    // everything the warning would, and two messages about one number
    // make a reader look for two problems. The size is still logged
    // first — a build that fails without saying how far over it went
    // tells nobody what to do next.
    // 🔴 One byte over, not ten per cent over. A tolerance of a handful
    // of bytes slipped through every other case: 1 000 passes and 1 010
    // fails, so nothing between them was ever asked.
    { name: 'one byte over', body: 'x'.repeat(1001), warns: false, throws: true },
    { name: '101 per cent', body: 'x'.repeat(1010), warns: false, throws: true },
    // Nothing to write is a real outcome — the gone list is empty today
    // — and it must still report, not skip.
    { name: 'empty', body: '', warns: false, throws: false },
    // 🔴 Bytes, not characters. 400 euro signs are 1 200 bytes and 400
    // units of length; measuring the wrong one hides a third of the file
    // from the budget. Nothing in the map is non-ASCII today — which is
    // exactly why no other case would catch it.
    { name: 'multi-byte', body: '\u20ac'.repeat(400), warns: false, throws: true },
  ];
  // 🔴 The count is held HERE, not in the CI line that greps the output.
  //
  // That line matches "1 edge-budget boundaries" as happily as "9", so
  // deleting cases would stay green. Pinning the number in the grep
  // would work and would have to be edited from another workspace every
  // time a case is added — which is how such a line gets loosened back.
  // So the script refuses instead: removing a case is a deliberate act
  // that touches both this constant and the list below it.
  const EXPECTED_CASES = 9;
  let bad = 0;
  const fail = (what) => {
    console.error(`  \u2717 ${what}`);
    bad++;
  };
  for (const c of cases) {
    const bytes = Buffer.byteLength(c.body);
    const logs = [];
    const warns = [];
    let threw = false;
    try {
      enforceEdgeBudget('probe', c.body, cap, {
        log: (m) => logs.push(m),
        warn: (m) => warns.push(m),
      });
    } catch (err) {
      threw = true;
      // The error has to name the size too, or a red build says only
      // that something is too big.
      for (const want of ['probe', kb(bytes), kb(cap)]) {
        if (!String(err.message).includes(want)) {
          fail(`${c.name}: the error is missing ${JSON.stringify(want)}`);
        }
      }
    }
    if (threw !== c.throws) fail(`${c.name}: threw=${threw}`);
    if (warns.length > 0 !== c.warns) fail(`${c.name}: warned=${warns.length > 0}`);
    if (logs.length !== 1) {
      fail(`${c.name}: logged ${logs.length} line(s), expected 1`);
      continue;
    }
    // 🔴 What it SAID, not that it said something.
    const line = logs[0];
    for (const want of ['probe', kb(bytes), kb(cap), pct(bytes)]) {
      if (!line.includes(want)) {
        fail(`${c.name}: the line is missing ${JSON.stringify(want)}: ${line}`);
      }
    }
    if (c.warns) {
      // The share, the name, and how much room is left: a warning that
      // says only "getting full" leaves the reader to measure again.
      for (const want of ['probe', pct(bytes), kb(cap - bytes)]) {
        if (!warns[0].includes(want)) {
          fail(`${c.name}: the warning is missing ${JSON.stringify(want)}`);
        }
      }
    }
  }

  // 🔴 And once through the handlers a caller actually gets.
  const realLog = console.log;
  const realWarn = console.warn;
  const seen = { log: [], warn: [] };
  console.log = (m) => seen.log.push(m);
  console.warn = (m) => seen.warn.push(m);
  try {
    enforceEdgeBudget('probe', 'x'.repeat(800), cap);
  } finally {
    console.log = realLog;
    console.warn = realWarn;
  }
  // 🔴 Which channel said WHAT, not how many times each spoke. Swapping
  // the two defaults left the counts at one and one, and sent the size
  // to stderr and the warning to stdout.
  if (seen.log.length !== 1 || !seen.log[0]?.includes(kb(800))) {
    fail(`the size did not go to console.log: ${JSON.stringify(seen.log)}`);
  }
  if (seen.warn.length !== 1 || !seen.warn[0]?.startsWith('\u26a0')) {
    fail(`the warning did not go to console.warn: ${JSON.stringify(seen.warn)}`);
  }

  if (cases.length !== EXPECTED_CASES) {
    fail(
      `${cases.length} cases, expected ${EXPECTED_CASES}. If a boundary ` +
        'is genuinely gone, say so by changing both.',
    );
  }
  console.log(
    bad === 0
      ? `\u2713 ${cases.length} edge-budget boundaries, messages read`
      : `\u2717 ${bad} check(s) failed`,
  );
  if (bad > 0) process.exit(1);
}

// 🔴 The canonical form, and the two sloppier ones it replaced.
//
// First it was `import.meta.url.endsWith(argv[1].split('/').pop())` — a
// suffix test on a URL, not a comparison of paths. A review wrote a file
// called `budget.mjs` that merely IMPORTS this module, ran it, and
// watched this module's self-test execute on import: `budget.mjs` is a
// suffix of `edge-budget.mjs`.
//
// Then it was a plain `pathToFileURL(argv[1])` comparison, which a
// symlink defeats with no mutation at all: Node resolves
// `import.meta.url` through the real path and leaves `argv[1]` as the
// link, so the two never match and the self-test silently does not run.
// Exit 0, no output, green CI step.
//
// 🔴 And the last line is the one that matters: asking for the self-test
// and not getting it must be LOUD. Every way of failing to start —
// inverted guard, renamed flag, symlink, imported by mistake — used to
// look exactly like seven passing checks.
// 🔴 The entry-point test comes FIRST, and that ordering is a fix too.
//
// A draft asked "was --self-test requested?" before "am I the entry
// point", so importing this module from a process that happened to
// carry that flag threw — `node gen-links.mjs --self-test` would have
// crashed instead of generating, and check-script-entrypoints.mjs said
// so: a module may not do work when it is imported.
// 🔴 The house form, from scripts/windy/fetch-webcams.mjs, and each
// piece of it is a bug this guard has already had.
//
// `realpathSync` on the argv side, because Node resolves
// `import.meta.url` through the real path and leaves argv[1] as written:
// without it a symlink made the two never match, the self-test silently
// did not run, and the CI step was green with no output.
//
// Inside an IIFE with try/catch, because the previous version called
// realpathSync IN the `if` condition — which runs on every import. A
// review imported this module from a process whose argv[1] was not a
// file and got ENOENT: the module had become unimportable, and
// check-script-entrypoints cannot see that, since it reads what a branch
// does and not what the condition costs.
//
// And `import.meta.url` stands in the comparison rather than behind a
// local, because that check recognises a guard by reading the
// comparison itself.
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else {
    // 🔴 Run directly with no flag this module knows. Its only purpose
    // as an entry point IS the self-test, so silence here is one of the
    // three ways the green nothing used to happen: rename the flag in
    // CI and the step keeps passing while nothing runs.
    throw new Error(
      'edge-budget.mjs does nothing when run without --self-test. ' +
        `Got: ${process.argv.slice(2).join(' ') || '(no arguments)'}`,
    );
  }
}
