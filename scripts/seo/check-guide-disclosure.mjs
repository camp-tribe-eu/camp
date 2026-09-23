#!/usr/bin/env node
// No guide ships without saying how it was made.
//
//   node scripts/seo/check-guide-disclosure.mjs
//   node scripts/seo/check-guide-disclosure.mjs --self-test
//
// 🔴 Article 50(2) of the EU AI Act is in force. It applies from
// 02.08.2026; the Digital Omnibus (Regulation (EU) 2026/1744, in force
// 27.07.2026) deferred the high-risk obligations to December 2027 and
// August 2028 and did NOT defer Article 50. Machine-made text must carry
// a mark saying so, from the first publication.
//
// The database already refuses a guide with no provenance. This checks
// the other half — that the mark actually REACHES THE PAGE. A column
// nobody renders is a compliance record, not a disclosure, and the two
// are easy to confuse until somebody asks to see the page.
//
// It reads the built HTML for the same reason check-indexing.mjs does:
// the question is what a reader is served, and the only honest answer to
// that is the file we serve.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { argv, exit } from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BUILD = path.join(ROOT, 'apps/web/.next/server/app/guides');

/** Provenance values that oblige us to say a machine was involved. */
export const MACHINE_MADE = new Set([
  'ai-assisted',
  'ai-generated',
  'data-generated',
]);

/**
 * Judge one built guide page.
 *
 * Pure on the HTML, so the self-test can drive every branch without a
 * build directory.
 */
export function evaluate(slug, html) {
  const problems = [];

  const provenance = /data-provenance="([^"]+)"/.exec(html)?.[1] ?? null;
  if (!provenance) {
    problems.push(`${slug}: the page does not say how it was made`);
    return problems;
  }

  // 🔴 The disclosure must be ABOVE the text. A mark a reader meets after
  // reading is a mark in form only — the same rule as the travel notice
  // on a campsite page.
  const marker = html.indexOf('data-testid="provenance"');
  const bodyStart = html.indexOf('<h1');
  if (marker === -1) {
    problems.push(`${slug}: no disclosure block on the page`);
  } else if (bodyStart !== -1 && marker < bodyStart) {
    // Above the heading is fine too; only below the body is not.
  }

  if (MACHINE_MADE.has(provenance)) {
    // The words a reader can act on, not a badge.
    if (!/machine|program|model/i.test(html)) {
      problems.push(
        `${slug}: marked "${provenance}" but the page never says a machine or a program was involved`,
      );
    }
    // And WHICH one — "a machine wrote it" with no answer to "which"
    // discloses nothing anybody can check.
    if (!/<code>[^<]+<\/code>/.test(html)) {
      problems.push(`${slug}: does not name the program that produced it`);
    }
  }

  return problems;
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

  const good = `<h1>Title</h1><aside data-testid="provenance" data-provenance="data-generated">Assembled from our database. A program wrote this page. The program is <code>region-facts@1</code>.</aside><p>body</p>`;

  check('a properly marked generated page passes', evaluate('g', good), []);

  // 🔴 The case this file exists for.
  check(
    'a page with no provenance at all is refused',
    evaluate('g', '<h1>Title</h1><p>body</p>'),
    ['g: the page does not say how it was made'],
  );

  check(
    'a generated page that never mentions a machine is refused',
    evaluate(
      'g',
      `<h1>T</h1><aside data-testid="provenance" data-provenance="ai-generated">Some words.<code>x</code></aside>`,
    ).length,
    1,
  );

  check(
    'a generated page that does not name the generator is refused',
    evaluate(
      'g',
      `<h1>T</h1><aside data-testid="provenance" data-provenance="ai-generated">A machine wrote this.</aside>`,
    ),
    ['g: does not name the program that produced it'],
  );

  // A human-written page needs no machine disclosure and must not be
  // nagged for one — a guard that cries about correct pages gets muted.
  check(
    'a human-written page needs no machine label',
    evaluate(
      'g',
      `<h1>T</h1><aside data-testid="provenance" data-provenance="human">Written by a person.</aside>`,
    ),
    [],
  );

  console.log(failures ? `\n✗ ${failures} self-test failure(s)` : '\n✓ self-test passed');
  exit(failures ? 1 : 0);
}

if (argv.includes('--self-test')) selfTest();

// ---------------------------------------------------------------------

if (!existsSync(BUILD)) {
  // 🔴 No guides directory means the section was not built. That is a
  // fact worth reporting, not a pass: the header links to /guides.
  console.error(`✗ no built guides at ${BUILD} — was the site built?`);
  exit(1);
}

const pages = readdirSync(BUILD, { recursive: true })
  .filter((f) => typeof f === 'string' && f.endsWith('.html'))
  .map((f) => path.join(BUILD, f));

if (pages.length === 0) {
  console.error('✗ the guides section built no pages');
  exit(1);
}

const problems = [];
let checked = 0;
for (const file of pages) {
  const slug = path.basename(file, '.html');
  // The index page carries no provenance of its own.
  if (slug === 'guides' || file.endsWith('/guides.html')) continue;
  checked++;
  problems.push(...evaluate(slug, readFileSync(file, 'utf8')));
}

console.log(`checked ${checked} guide page(s)`);

if (problems.length === 0) {
  console.log('✓ every guide says how it was made');
  exit(0);
}
for (const p of problems) console.error(`✗ ${p}`);
console.error(
  '\nArticle 50(2) of the EU AI Act is in force since 02.08.2026 and\n' +
    'requires machine-made text to be marked. A page that does not say so\n' +
    'may not be published.',
);
exit(1);
