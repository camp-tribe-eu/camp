#!/usr/bin/env node
// The site may not go public with legal pages no lawyer has read.
//
//   node scripts/seo/check-legal-review.mjs --expect closed   # informational
//   node scripts/seo/check-legal-review.mjs --expect public   # a gate
//   node scripts/seo/check-legal-review.mjs --self-test
//
// 🔴 Why this is a build step and not a note in a card.
//
// I held PR #23 unmerged for a day on the rule "do not merge without a
// Belgian lawyer". That was the wrong place for the rule, and holding it
// there cost us: merging publishes nothing — the site has no deploy
// workflow at all, camptribe.eu answers nothing, every build defaults to
// `closed`, and the text was already readable by anyone in the open pull
// request on a public repository. The merge was never the moment of
// exposure. The LAUNCH is.
//
// So the rule moves to the launch, and it moves out of anyone's memory.
// A line in a card saying "remember the lawyer" is exactly what gets
// forgotten three months and two hundred commits later, on the day
// somebody finally flips NEXT_PUBLIC_SITE_MODE=public because the
// domains are expiring and everyone is in a hurry. A build that refuses
// is not forgotten.
//
// 🔴 And it re-opens by itself. The record names a VERSION per page, not
// a page. Edit the terms, bump `version` in lib/legal.ts, and this gate
// closes again until the new text is reviewed too — which is the honest
// behaviour, because a lawyer read version 1.0, not "the terms".

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { argv, exit } from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BUILD = path.join(ROOT, 'apps/web/.next/server/app/legal');
const RECORD = path.join(ROOT, 'scripts/seo/legal-review.json');

/**
 * Pull the version each built legal page states.
 *
 * Read from the BUILT page, not from lib/legal.ts. The question this
 * guard answers is "what does the site tell a reader is in force", and
 * the only honest source for that is what the site actually renders —
 * the same reason check-indexing.mjs reads built output rather than
 * config.
 */
export function versionsFrom(pages) {
  const found = {};
  for (const [slug, html] of Object.entries(pages)) {
    // data-testid="legal-version" … "Version 1.0 · in force since"
    const block = /data-testid="legal-version"[\s\S]{0,400}?Version[^0-9]{0,10}([0-9]+(?:\.[0-9]+)*)/.exec(html);
    found[slug] = block ? block[1] : null;
  }
  return found;
}

/**
 * Decide whether this build may be published.
 *
 * Pure: `mode`, the versions the build states, and the record. The
 * self-test drives every branch without a build directory.
 */
export function evaluate(mode, versions, record, today = new Date()) {
  const problems = [];
  const warnings = [];
  const slugs = Object.keys(versions).sort();

  if (slugs.length === 0) {
    // 🔴 No legal pages found is a failure, not a pass. The likeliest
    // cause is that this guard is looking in the wrong place after a
    // build-output change — and a gate that silently checks nothing is
    // worse than no gate, because it reports safety.
    problems.push('no legal pages were found in the build — this guard is not checking anything');
    return { ok: false, problems, warnings, slugs };
  }

  for (const slug of slugs) {
    if (versions[slug] === null) {
      problems.push(`/legal/${slug} does not state a version`);
    }
  }

  if (mode !== 'public') {
    return { ok: problems.length === 0, problems, warnings, slugs };
  }

  // 🔴 A dated acknowledgement, not a permanent exemption.
  //
  // The obvious design — fail every public build until a lawyer signs —
  // would turn the `public-build` CI job red on every commit from now
  // until that happens, and a job that is always red is a job everybody
  // stops reading. Then the day it goes red for a REAL reason, nobody
  // notices. That is a worse outcome than the risk it was guarding.
  //
  // So it is the same shape the dependency guard already uses and that
  // we already trust: a debt somebody has actually looked at, carrying
  // the date it stops being acceptable. Before that date this warns
  // loudly; after it, it fails, and no amount of hurry on launch day can
  // talk it out of failing.
  const until = record.acknowledgedUntil
    ? new Date(record.acknowledgedUntil)
    : null;
  const stillAcknowledged =
    until !== null && !Number.isNaN(until.getTime()) && today <= until;

  // Only a public build is gated on the review.
  const say = (text) => (stillAcknowledged ? warnings : problems).push(text);

  if (!record.reviewedBy || !record.reviewedOn) {
    say('no legal review is recorded — a public build needs one (owner debt #4, Belgian lawyer)');
  }
  for (const slug of slugs) {
    const version = versions[slug];
    if (version === null) continue;
    const reviewed = record.pages?.[slug];
    if (!reviewed) {
      say(`/legal/${slug} version ${version} has never been reviewed`);
    } else if (reviewed !== version) {
      // 🔴 A CHANGED page is never merely a warning. The acknowledgement
      // covers text nobody has read yet; it cannot cover text that was
      // reviewed and then edited, because that is us changing a legal
      // document after the review and shipping it under the review's
      // cover.
      problems.push(
        `/legal/${slug} is at version ${version} but only ${reviewed} was reviewed — the text changed since`,
      );
    }
  }

  return { ok: problems.length === 0, problems, warnings, slugs };
}

// ---------------------------------------------------------------------

function selfTest() {
  let failures = 0;
  const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      console.error(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
      failures++;
    } else console.log(`  ✓ ${name}`);
  };

  const v = { terms: '1.0', privacy: '1.0' };
  const signed = {
    reviewedBy: 'Someone, Belgian bar',
    reviewedOn: '2026-10-01',
    pages: { terms: '1.0', privacy: '1.0' },
  };
  const unsigned = { reviewedBy: null, reviewedOn: null, pages: {} };
  // The same thing, but acknowledged with a date that has not passed.
  const acked = { ...unsigned, acknowledgedUntil: '2026-10-31' };
  const before = new Date('2026-09-23');
  const after = new Date('2026-11-01');

  // 🔴 The case this file exists for.
  check(
    'a public build with no review is refused',
    evaluate('public', v, unsigned).ok,
    false,
  );
  check(
    'and it says why, in words somebody can act on',
    evaluate('public', v, unsigned).problems[0],
    'no legal review is recorded — a public build needs one (owner debt #4, Belgian lawyer)',
  );

  check('a public build with a full review passes', evaluate('public', v, signed).ok, true);

  // 🔴 The re-opening rule: a lawyer read a version, not a page.
  check(
    'editing the terms re-closes the gate',
    evaluate('public', { ...v, terms: '1.1' }, signed).problems,
    ['/legal/terms is at version 1.1 but only 1.0 was reviewed — the text changed since'],
  );
  check(
    'a NEW legal page is not covered by an old review',
    evaluate('public', { ...v, disclaimer: '1.0' }, signed).problems,
    ['/legal/disclaimer version 1.0 has never been reviewed'],
  );

  // A closed build is not gated — that is the whole point of the split.
  check('a closed build is not blocked by a missing review', evaluate('closed', v, unsigned).ok, true);

  // But a page with no version at all is wrong in either mode.
  check(
    'a page that states no version fails even when closed',
    evaluate('closed', { terms: null }, signed).ok,
    false,
  );

  // 🔴 A guard that finds nothing must fail.
  check(
    'finding no legal pages is a failure, not a pass',
    evaluate('public', {}, signed).ok,
    false,
  );

  // 🔴 The dated acknowledgement. Without these three cases the gate is
  // either always red (and therefore ignored) or always green (and
  // therefore pointless), and only the date tells them apart.
  check(
    'an acknowledged debt warns instead of failing, while the date holds',
    (() => {
      const r = evaluate('public', v, acked, before);
      return [r.ok, r.warnings.length > 0, r.problems.length];
    })(),
    [true, true, 0],
  );
  check(
    'past the date it fails, and hurry cannot argue with it',
    evaluate('public', v, acked, after).ok,
    false,
  );
  check(
    'an acknowledgement with no date at all is not an acknowledgement',
    evaluate('public', v, unsigned, before).ok,
    false,
  );
  check(
    'a nonsense date is not an acknowledgement either',
    evaluate('public', v, { ...unsigned, acknowledgedUntil: 'soon' }, before).ok,
    false,
  );
  // 🔴 And the one thing the acknowledgement may NEVER cover: text that
  // was reviewed and then edited. That is shipping a changed legal
  // document under an old review.
  check(
    'an edit after review fails even inside the acknowledged window',
    evaluate(
      'public',
      { terms: '1.1' },
      { ...signed, acknowledgedUntil: '2026-10-31' },
      before,
    ).ok,
    false,
  );

  // The parser, on the real markup shape.
  check(
    'the version is read out of the rendered page',
    versionsFrom({
      terms: '<p data-testid="legal-version" class="x">Version 2.3 · in force since <time>…</time></p>',
    }),
    { terms: '2.3' },
  );
  check(
    'a page without the marker reports null rather than guessing',
    versionsFrom({ terms: '<p>Version 9.9 somewhere else entirely</p>' }),
    { terms: null },
  );

  console.log(failures ? `\n✗ ${failures} self-test failure(s)` : '\n✓ self-test passed');
  exit(failures ? 1 : 0);
}

if (argv.includes('--self-test')) selfTest();

// ---------------------------------------------------------------------

const modeArg = argv.indexOf('--expect');
const mode = modeArg >= 0 ? argv[modeArg + 1] : 'closed';

let pages;
try {
  pages = Object.fromEntries(
    readdirSync(BUILD)
      .filter((f) => f.endsWith('.html'))
      .map((f) => [f.replace(/\.html$/, ''), readFileSync(path.join(BUILD, f), 'utf8')]),
  );
} catch (err) {
  console.error(`✗ cannot read the built legal pages at ${BUILD}: ${err.message}`);
  exit(1);
}

let record;
try {
  record = JSON.parse(readFileSync(RECORD, 'utf8'));
} catch (err) {
  console.error(`✗ cannot read ${RECORD}: ${err.message}`);
  exit(1);
}

const versions = versionsFrom(pages);
const { ok, problems, warnings, slugs } = evaluate(mode, versions, record);

for (const slug of slugs) {
  const reviewed = record.pages?.[slug];
  console.log(
    `  /legal/${slug.padEnd(12)} version ${versions[slug] ?? '—'}  ${
      reviewed === versions[slug] ? 'reviewed' : 'not reviewed'
    }`,
  );
}

for (const w of warnings) console.error(`⚠ ${w}`);
if (warnings.length > 0) {
  console.error(
    `\n⚠ Acknowledged until ${record.acknowledgedUntil} — after that this fails.`,
  );
}

if (ok) {
  console.log(
    mode === 'public'
      ? warnings.length > 0
        ? '\n✓ build allowed — but on an acknowledgement, not a review'
        : '\n✓ every legal page in this build has been reviewed'
      : '\n✓ legal pages state their versions (a closed build is not gated on review)',
  );
  exit(0);
}

console.error('');
for (const p of problems) console.error(`✗ ${p}`);
console.error(
  '\nThis build claims to be public. Record the review in\n' +
    'scripts/seo/legal-review.json once a Belgian lawyer has read these\n' +
    'exact versions — owner debt #4.',
);
exit(1);
