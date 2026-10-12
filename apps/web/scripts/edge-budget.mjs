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
// This repository configures no deployment target: no vercel.json, no
// wrangler config, nothing in .github that names a host. So the number
// that stops a deploy rests on a platform nobody has chosen yet. It is
// probably the right order of magnitude and it is not a measurement.
//
// Which is why the message at 100% refuses to pick between raising the
// cap and moving the file out of the bundle: that choice needs a host,
// and a host is somebody's decision about money, not this script's.

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
 * 🔴 Both boundaries, planted rather than waited for.
 *
 * The card that created this asked for exactly one thing: show that 76%
 * warns and 101% fails. A cap nobody has watched reject anything is a
 * number in a file.
 */
function selfTest() {
  const cap = 1000;
  const cases = [
    { name: 'well under', size: 100, warns: false, throws: false },
    { name: 'just under the warning', size: 749, warns: false, throws: false },
    { name: 'at the warning', size: 750, warns: true, throws: false },
    { name: '76 per cent', size: 760, warns: true, throws: false },
    { name: 'exactly at the cap', size: 1000, warns: true, throws: false },
    // 🔴 Over the cap it throws and does NOT also warn: the error says
    // everything the warning would, and two messages about one number
    // make a reader look for two problems. The size is still logged
    // first — a build that fails without saying how far over it went
    // tells nobody what to do next.
    { name: '101 per cent', size: 1010, warns: false, throws: true },
  ];
  let bad = 0;
  for (const c of cases) {
    const body = 'x'.repeat(c.size);
    let warned = false;
    let threw = false;
    let logged = false;
    try {
      enforceEdgeBudget('probe', body, cap, {
        log: () => {
          logged = true;
        },
        warn: () => {
          warned = true;
        },
      });
    } catch {
      threw = true;
    }
    // 🔴 The size is reported even when it throws: a build that fails
    // without saying how far over it went tells nobody what to do next.
    const ok = warned === c.warns && threw === c.throws && logged;
    if (!ok) {
      console.error(
        `  ✗ ${c.name}: warned=${warned} threw=${threw} logged=${logged}`,
      );
      bad++;
    }
  }
  console.log(
    bad === 0
      ? `✓ ${cases.length}/${cases.length} edge-budget boundaries`
      : `✗ ${bad} of ${cases.length} failed`,
  );
  if (bad > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  if (process.argv.includes('--self-test')) selfTest();
}
