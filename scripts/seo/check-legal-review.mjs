#!/usr/bin/env node
// The site may not go public with legal pages nobody has reviewed against
// what the site actually does.
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
// A line in a card saying "remember the review" is exactly what gets
// forgotten three months and two hundred commits later, on the day
// somebody finally flips NEXT_PUBLIC_SITE_MODE=public because the
// domains are expiring and everyone is in a hurry. A build that refuses
// is not forgotten.
//
// 🔴 WHOSE REVIEW. Until 27.10.2026 this gate waited for a Belgian lawyer
// (owner debt #4). On that day the owner said, word for word, that there
// is no lawyer and no money for one, and that the legal work is ours.
// A gate that keeps waiting for a person who is not coming blocks every
// public build forever, and a gate that is always red is a gate nobody
// reads. So the record it checks is now OUR review — the processing
// register (docs/GDPR-REGISTER.md, GDPR Art. 30), the legal bases and
// retention terms decided and written down, and the policy versions
// those decisions were written into. The record does not pretend to be
// a lawyer's opinion, and this file does not pretend that a record can
// prove a review was careful. What it CAN prove is that the record is
// CURRENT, and that is the whole job here:
//
//   · the record names a VERSION per page, not a page. Edit the terms,
//     bump `version` in lib/legal.ts, and this gate closes again until
//     the new text is reviewed too — because somebody read version 1.0,
//     not "the terms";
//   · the record names the exact CONTENT of the processing register it
//     was made against (a sha256 of docs/GDPR-REGISTER.md). The register
//     describes what the site actually does to personal data; the
//     privacy policy promises it. When the register changes, the policy
//     may no longer be true, so the gate closes until somebody re-reads
//     the policy against the new register and says so in the record.
//     A date would not do here: the register is legitimately edited
//     AFTER a policy version ships (to point at it), so "policy newer
//     than register" would be wrong in both directions. Content is the
//     only honest binding.
//
// 🔴 What this gate cannot see, said plainly: the text itself lives in
// the database (CAMP-365) and the owner can edit it in the CMS without
// bumping the version. This gate reads the version the BUILT page
// states; a changed body under an unchanged version is invisible to it,
// as it always was. The records that live outside the repository (the
// project brain) are also invisible to CI, so they are pointed at from
// the record rather than checked by it.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chooseAction, flagValue } from '../lib/entrypoint.mjs';
import path from 'node:path';
import { argv, exit } from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BUILD = path.join(ROOT, 'apps/web/.next/server/app/legal');
const RECORD = path.join(ROOT, 'scripts/seo/legal-review.json');
/** The processing register the review is bound to. */
export const REGISTER = 'docs/GDPR-REGISTER.md';

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
    // data-testid="legal-version" … "Version <!-- -->2.3 · in force since"
    // (React leaves a comment node between the literal and the value).
    const block = /data-testid="legal-version"[\s\S]{0,400}?Version[^0-9]{0,10}([0-9]+(?:\.[0-9]+)*)/.exec(html);
    found[slug] = block ? block[1] : null;
  }
  return found;
}

/**
 * sha256 of the register's content, line endings normalised so a
 * Windows checkout does not read as a changed register. `null` when the
 * file cannot be read — the caller decides what that means.
 */
export function digestOf(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

const short = (hex) => (typeof hex === 'string' ? hex.slice(0, 12) : String(hex));

/**
 * Decide whether this build may be published.
 *
 * Pure: `mode`, the versions the build states, the record, and the
 * digest of the register as it is NOW. The self-test drives every
 * branch without a build directory or a file system.
 */
export function evaluate(mode, versions, record, world = {}) {
  const { registerDigest = null, today = new Date() } = world;
  const problems = [];
  const slugs = Object.keys(versions).sort();

  if (slugs.length === 0) {
    // 🔴 No legal pages found is a failure, not a pass. The likeliest
    // cause is that this guard is looking in the wrong place after a
    // build-output change — and a gate that silently checks nothing is
    // worse than no gate, because it reports safety.
    problems.push('no legal pages were found in the build — this guard is not checking anything');
    return { ok: false, problems, slugs };
  }

  for (const slug of slugs) {
    if (versions[slug] === null) {
      problems.push(`/legal/${slug} does not state a version`);
    }
  }

  if (mode !== 'public') {
    return { ok: problems.length === 0, problems, slugs };
  }

  // 🔴 No dated acknowledgement any more. It existed to keep a job from
  // being red for months while we waited for somebody else; now the
  // review is ours and the fix for a red gate is to do it and record it.
  // A record that still carries the old escape hatch is refused outright
  // so that it cannot quietly come back.
  if (record.acknowledgedUntil !== undefined) {
    problems.push(
      '`acknowledgedUntil` is in the record but this gate no longer honours it — ' +
        'there is no external review to wait for; do the review and record it',
    );
  }

  if (!record.reviewedBy || !record.reviewedOn) {
    problems.push(
      'no legal review is recorded — a public build needs one ' +
        '(ours, since the owner\'s decision of 27.10.2026; fill scripts/seo/legal-review.json)',
    );
  } else {
    const on = new Date(record.reviewedOn);
    if (Number.isNaN(on.getTime())) {
      problems.push(`reviewedOn "${record.reviewedOn}" is not a date`);
    } else if (on > today) {
      problems.push(`reviewedOn ${record.reviewedOn} is in the future — a review cannot be recorded before it happened`);
    }
  }

  for (const slug of slugs) {
    const version = versions[slug];
    if (version === null) continue;
    const reviewed = record.pages?.[slug];
    if (!reviewed) {
      problems.push(`/legal/${slug} version ${version} has never been reviewed`);
    } else if (reviewed !== version) {
      // 🔴 A CHANGED page. This is us changing a legal document after
      // the review and shipping it under the review's cover.
      problems.push(
        `/legal/${slug} is at version ${version} but only ${reviewed} was reviewed — the text changed since`,
      );
    }
  }

  // 🔴 The register binding — the part that makes the record CURRENT
  // rather than merely present.
  const recorded = record.register?.sha256;
  if (!recorded) {
    problems.push(
      `the review does not say which ${REGISTER} it was made against — record its sha256 under "register"`,
    );
  } else if (registerDigest === null) {
    problems.push(`${REGISTER} cannot be read — the review was made against a register that is no longer there`);
  } else if (registerDigest !== recorded) {
    problems.push(
      `${REGISTER} changed since the review of ${record.reviewedOn} ` +
        `(reviewed ${short(recorded)}…, now ${short(registerDigest)}…) — ` +
        're-read the privacy policy against the register and record the review again',
    );
  }

  return { ok: problems.length === 0, problems, slugs };
}

// ---------------------------------------------------------------------

function selfTest() {
  let failures = 0;
  let cases = 0;
  const check = (name, got, want) => {
    cases++;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      console.error(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
      failures++;
    } else console.log(`  ✓ ${name}`);
  };

  const v = { terms: '1.0', privacy: '1.0' };
  const REG = digestOf('# register\n');
  const world = { registerDigest: REG, today: new Date('2026-11-01') };
  const signed = {
    reviewedBy: 'CampTribe coordinator',
    reviewedOn: '2026-10-01',
    pages: { terms: '1.0', privacy: '1.0' },
    register: { path: REGISTER, sha256: REG },
  };
  const unsigned = { reviewedBy: null, reviewedOn: null, pages: {} };

  // 🔴 The case this file exists for.
  check('a public build with no review is refused', evaluate('public', v, unsigned, world).ok, false);
  check(
    'and it says why, in words somebody can act on',
    evaluate('public', v, unsigned, world).problems[0],
    "no legal review is recorded — a public build needs one (ours, since the owner's decision of 27.10.2026; fill scripts/seo/legal-review.json)",
  );

  check('a public build with a current review passes', evaluate('public', v, signed, world), {
    ok: true,
    problems: [],
    slugs: ['privacy', 'terms'],
  });

  // 🔴 The re-opening rule: somebody read a version, not a page.
  check(
    'editing the terms re-closes the gate',
    evaluate('public', { ...v, terms: '1.1' }, signed, world).problems,
    ['/legal/terms is at version 1.1 but only 1.0 was reviewed — the text changed since'],
  );
  check(
    'a NEW legal page is not covered by an old review',
    evaluate('public', { ...v, disclaimer: '1.0' }, signed, world).problems,
    ['/legal/disclaimer version 1.0 has never been reviewed'],
  );

  // 🔴 The register binding: the record is bound to the CONTENT of the
  // register it was made against, and it names both digests.
  check(
    'a changed processing register re-closes the gate and names the drift',
    evaluate('public', v, signed, { ...world, registerDigest: digestOf('# register\nchanged\n') }).problems,
    [
      `${REGISTER} changed since the review of 2026-10-01 (reviewed ${REG.slice(0, 12)}…, now ${digestOf('# register\nchanged\n').slice(0, 12)}…) — re-read the privacy policy against the register and record the review again`,
    ],
  );
  check(
    'a review that does not say which register it read is not current',
    evaluate('public', v, { ...signed, register: undefined }, world).problems,
    [`the review does not say which ${REGISTER} it was made against — record its sha256 under "register"`],
  );
  check(
    'a register that cannot be read is a failure, not a pass',
    evaluate('public', v, signed, { ...world, registerDigest: null }).ok,
    false,
  );

  // The record's own date has to be a date that has happened.
  check(
    'a review dated in the future is refused',
    evaluate('public', v, { ...signed, reviewedOn: '2027-01-01' }, world).problems,
    ['reviewedOn 2027-01-01 is in the future — a review cannot be recorded before it happened'],
  );
  check(
    'a nonsense review date is refused',
    evaluate('public', v, { ...signed, reviewedOn: 'soon' }, world).problems,
    ['reviewedOn "soon" is not a date'],
  );

  // 🔴 The old escape hatch may not come back.
  check(
    'the retired acknowledgedUntil is refused rather than honoured',
    evaluate('public', v, { ...signed, acknowledgedUntil: '2099-01-01' }, world).ok,
    false,
  );

  // A closed build is not gated — that is the whole point of the split.
  check('a closed build is not blocked by a missing review', evaluate('closed', v, unsigned, world).ok, true);

  // But a page with no version at all is wrong in either mode.
  check(
    'a page that states no version fails even when closed',
    evaluate('closed', { terms: null }, signed, world).ok,
    false,
  );

  // 🔴 A guard that finds nothing must fail.
  check('finding no legal pages is a failure, not a pass', evaluate('public', {}, signed, world).ok, false);

  // The parser, on the real markup shape — copied from a built page,
  // comment node and all.
  check(
    'the version is read out of the rendered page, React comment included',
    versionsFrom({
      privacy:
        '<p data-testid="legal-version" class="mt-3 text-xs text-ink-2">Version <!-- -->2.3<!-- --> · in force since <time dateTime="2026-11-01">1 November 2026</time></p>',
    }),
    { privacy: '2.3' },
  );
  check(
    'a page without the marker reports null rather than guessing',
    versionsFrom({ terms: '<p>Version 9.9 somewhere else entirely</p>' }),
    { terms: null },
  );

  // The digest ignores line endings and nothing else.
  check(
    'CRLF and LF read as the same register; one more character does not',
    [digestOf('a\r\nb\n') === digestOf('a\nb\n'), digestOf('a\nb\n') === digestOf('a\nb\n\n')],
    [true, false],
  );

  // 🔴 CAMP-286: counted, and named after this file. "✓ self-test
  // passed" is a line five scripts in this repository printed, so a CI
  // step grepping for it could be satisfied by somebody else's run; and
  // a case that stopped being reached prints what a passing case prints.
  const EXPECTED_CASES = 17;
  if (cases !== EXPECTED_CASES) {
    console.log(`✗ ${cases} cases ran, expected ${EXPECTED_CASES}`);
    failures++;
  }
  console.log(
    failures
      ? `\n✗ check-legal-review self-test: ${failures} failure(s)`
      : `\n✓ check-legal-review self-test: ${cases} cases`,
  );
  exit(failures ? 1 : 0);
}

// 🔴 CAMP-286: the house guard, written out rather than called, because
// check-script-entrypoints.mjs recognises a guard by READING this
// comparison. `realpathSync` on the argv side because Node resolves
// `import.meta.url` through the real path and leaves argv[1] as written.
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) main();

// ---------------------------------------------------------------------

function main() {
  // 🔴 `--expect` DECIDES WHICH GATE RUNS, so its value is checked.
  // Review measured `--expect publi` — one letter — passing the flag
  // check, falling through to the `closed` branch and printing
  // "✓ legal pages state their versions (a closed build is not gated on
  // review)" with exit 0, on a tree where no legal page had been
  // reviewed at all. The typo had simply moved from the flag's name to
  // its value.
  const action = chooseAction(argv.slice(2), ['--self-test', '--expect'],
    'check-legal-review.mjs', {
      takesValue: ['--expect'],
      values: { '--expect': ['public', 'closed'] },
    });
  if (action.has('--self-test')) selfTest();

  // 🔴 `flagValue`, not `indexOf`: `--expect=public` is a spelling
  // chooseAction accepts, and `indexOf` read it as absent — which meant
  // the PUBLIC gate silently became the closed one (CAMP-286).
  const mode = flagValue(argv.slice(2), '--expect') ?? 'closed';

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

  // Unreadable is `null`, and `evaluate` turns that into a named failure
  // on a public build rather than this file guessing what it means.
  let registerDigest = null;
  try {
    registerDigest = digestOf(readFileSync(path.join(ROOT, REGISTER), 'utf8'));
  } catch {
    registerDigest = null;
  }

  const versions = versionsFrom(pages);
  const { ok, problems, slugs } = evaluate(mode, versions, record, { registerDigest });

  for (const slug of slugs) {
    const reviewed = record.pages?.[slug];
    console.log(
      `  /legal/${slug.padEnd(12)} version ${versions[slug] ?? '—'}  ${
        reviewed === versions[slug] ? 'reviewed' : 'not reviewed'
      }`,
    );
  }
  console.log(
    `  ${REGISTER}  ${short(registerDigest)}…  ${
      registerDigest !== null && registerDigest === record.register?.sha256
        ? `reviewed ${record.reviewedOn}`
        : 'not the register that was reviewed'
    }`,
  );

  if (ok) {
    console.log(
      mode === 'public'
        ? '\n✓ every legal page in this build is covered by a current legal review'
        : '\n✓ legal pages state their versions (a closed build is not gated on review)',
    );
    exit(0);
  }

  console.error('');
  for (const p of problems) console.error(`✗ ${p}`);
  console.error(
    '\nThis build claims to be public. Re-read the legal pages against\n' +
      `${REGISTER} and the decisions it cites, then record the review in\n` +
      'scripts/seo/legal-review.json: the exact page versions, and the\n' +
      `sha256 of ${REGISTER} as read (shasum -a 256 ${REGISTER}).`,
  );
  exit(1);
}
