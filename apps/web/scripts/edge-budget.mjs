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
    { name: '101 per cent', body: 'x'.repeat(1010), warns: false, throws: true },
    // 🔴 Bytes, not characters. 400 euro signs are 1 200 bytes and 400
    // units of length; measuring the wrong one hides a third of the file
    // from the budget. Nothing in the map is non-ASCII today — which is
    // exactly why no other case would catch it.
    { name: 'multi-byte', body: '\u20ac'.repeat(400), warns: false, throws: true },
  ];
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
      if (!String(err.message).includes(kb(bytes))) {
        fail(`${c.name}: the error does not say the size (${kb(bytes)})`);
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
    if (c.warns && !warns[0].includes(pct(bytes))) {
      fail(`${c.name}: the warning does not say the share`);
    }
  }

  // 🔴 And once through the handlers a caller actually gets.
  const realLog = console.log;
  const realWarn = console.warn;
  const seen = { log: 0, warn: 0 };
  console.log = () => {
    seen.log++;
  };
  console.warn = () => {
    seen.warn++;
  };
  try {
    enforceEdgeBudget('probe', 'x'.repeat(800), cap);
  } finally {
    console.log = realLog;
    console.warn = realWarn;
  }
  if (seen.log !== 1 || seen.warn !== 1) {
    fail(`the default handlers were not used (log=${seen.log}, warn=${seen.warn})`);
  }

  console.log(
    bad === 0
      ? `\u2713 ${cases.length} edge-budget boundaries, messages read`
      : `\u2717 ${bad} check(s) failed`,
  );
  if (bad > 0) process.exit(1);
}

// 🔴 The canonical form, and the sloppy one it replaced is worth a line.
//
// It was `import.meta.url.endsWith(argv[1].split('/').pop())` — a suffix
// test on a URL, not a comparison of paths. A review wrote a file called
// `budget.mjs` that merely IMPORTS this module, ran it, and watched this
// module's self-test execute on import: `budget.mjs` is a suffix of
// `edge-budget.mjs`. On Windows the split on '/' would have failed the
// other way and the self-test would never have run at all, silently,
// with exit 0.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--self-test')) selfTest();
}
