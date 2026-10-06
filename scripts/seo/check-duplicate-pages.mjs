#!/usr/bin/env node
// CAMP-36: refuse to ship near-identical generated pages.
//
//   node scripts/seo/check-duplicate-pages.mjs [--max 0.80] [--sample 150]
//
// The card's acceptance criterion is "no page duplicates another by
// nothing more than a swapped place name". That is a property of the
// built output, not of the code, so nothing in a unit test can see it —
// it only becomes visible after generation, across pages, at scale.
//
// 🔴 Why this matters more here than on a normal site: growth is meant to
// be 100% organic, so these generated pages are not "content", they are
// the entire acquisition channel. A few hundred pages that differ only in
// a name are the textbook definition of thin, templated content, and the
// cost of shipping them is not a lost page — it is the domain.
//
// Method: 5-word shingles of the visible <main> text, Jaccard similarity
// over a random sample of pages. Shingles rather than word counts because
// two pages can share every word and still read differently; a shared
// run of five words in order is a much better sign of one template with
// a substitution.

import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import { visibleHtmlText, shingles, jaccard, selfTest, nestedMarks } from './page-text.mjs';

// 🔴 `--self-test` needs no build and no database, so CI can run it on
// every push: the stripping rule decides what this guard is allowed to
// ignore, and a hole in it goes GREEN rather than red.
if (process.argv.includes('--self-test')) process.exit(selfTest() ? 1 : 0);

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

const MAX_SIMILARITY = opt('max', 0.8);
const SAMPLE = opt('sample', 150);
const BUILD = 'apps/web/.next/server/app';

/**
 * 🔴 Two families of generated pages, not one.
 *
 * This guard was written for campsite pages, and for as long as it has
 * existed those were the only generated pages we had. CAMP-55 added
 * twenty-seven more — one per EU member state, same template, different
 * price — and they were invisible here because the root was hard-coded
 * to /camping.
 *
 * Measured the day they were written, before they were covered: two
 * pairs sat at 88.5% and 86.7%, above the 80% line this file exists to
 * hold. The remedy was to give each page something of its own — what
 * fuel costs across each of that country's land borders, and how petrol
 * and diesel compare there — and not to leave the directory unwatched.
 *
 * Families are compared WITHIN themselves, never across. A campsite page
 * and a fuel-price page share almost no wording; pooling them would
 * lower every percentile and hide exactly what this measures.
 */
const FAMILIES = [
  {
    name: 'campsites',
    root: `${BUILD}/camping`,
    // Campsite pages only: country and region hubs are a different shape
    // and legitimately share more of their wording.
    keep: (rel) =>
      rel.split(path.sep).length === 3 && !rel.includes(`${path.sep}page${path.sep}`),
  },
  {
    name: 'trip cost by country',
    root: `${BUILD}/tools/camper-trip-cost`,
    keep: (rel) => rel.split(path.sep).length === 1,
  },
  // 🔴 CAMP-4 / CAMP-54. The rental country pages, watched from the day
  // they were written rather than from the day somebody noticed them —
  // which is the lesson of the paragraph above, where twenty-seven pages
  // sat unmeasured because the root was hard-coded to /camping.
  //
  // This family is the one with the strongest reason to be here. The card
  // asked for 200–300 city pages and we published twelve country pages
  // instead, on the argument that pages differing only by a place name are
  // scaled content abuse and cost the whole domain. That argument is a
  // claim about these files, and this is what turns it into a measurement.
  {
    name: 'camper rental by country',
    root: `${BUILD}/camper-rental`,
    keep: (rel) => rel.split(path.sep).length === 1,
  },
  // 🔴 CAMP-3 / CAMP-45. A fourth family, added WITH the pages rather
  // than after somebody notices.
  //
  // The comment on the family above says the remedy was "to give each
  // page something of its own — and not to leave the directory
  // unwatched". Route pages are the highest-risk family this site has:
  // the card asked for ~50, and 50 pages of "N days in <place>" built
  // from one paragraph is the textbook scaled-content pattern. Twelve
  // were written instead, each with its own argument.
  //
  // Measured on the rendered pages the day they were written: the most
  // similar pair of the 66 sits at 8.2% and the median at 6.8%, against
  // this guard's 80% ceiling and against campsite pages that live near
  // it. There is a very long way to fall before this fails — which is
  // the point of wiring it up now, while the distance is real.
  {
    name: 'curated routes',
    root: `${BUILD}/routes`,
    keep: (rel) => rel.split(path.sep).length === 1,
  },
];

/** Deterministic sample: the same pages every run, so a rise is a change. */
function seeded(n) {
  let s = 20260921;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * n;
}

function visibleText(file) {
  const html = readFileSync(file, 'utf8');
  // 🔴 ASKED ON THE BUILT PAGE, WHICH IS THE ONLY PLACE A WRAPPER EXISTS.
  //
  // `data-boilerplate` on an element that contains another marked one
  // removes everything between them from the comparison. A unit test
  // that renders one component cannot see a mark added in `page.tsx`
  // around it — review found exactly that gap — but this file reads the
  // page as served, wrappers and all.
  //
  // It fails the run rather than warning: the symptom of the mistake is
  // a guard that goes green, so nothing quieter would ever be noticed.
  for (const { outer, inner } of nestedMarks(html)) {
    nestingProblems.push(
      `${path.relative(BUILD, file)}: data-boilerplate="${outer}" contains ` +
        `data-boilerplate="${inner}" — everything between them is being ` +
        'dropped from the duplicate comparison, including whatever varies',
    );
  }
  return visibleHtmlText(html);
}

/** Collected while reading, reported once, and they fail the run. */
const nestingProblems = [];

let failed = 0;
let analysed = 0;

for (const family of FAMILIES) {
  const files = [];
  for await (const f of glob(`${family.root}/**/*.html`)) {
    if (family.keep(path.relative(family.root, f))) files.push(f);
  }

  if (files.length === 0) {
    // 🔴 An empty family is a failure, not a pass. A renamed directory or
    // a half-finished build would otherwise make this guard report
    // success over nothing at all — the same silent-zero shape that let a
    // throttled build ship 580 pages and exit 0.
    console.error(
      `\n✗ no generated pages under ${family.root} (${family.name}).\n` +
        '   Run the build first:  cd apps/web && npx next build',
    );
    failed++;
    continue;
  }

  const texts = new Map(files.map((f) => [f, visibleText(f)]));
  const sets = new Map([...texts].map(([f, t]) => [f, shingles(t)]));

  const rnd = seeded(files.length);
  const picked = new Set();
  while (picked.size < Math.min(SAMPLE, files.length)) {
    picked.add(files[Math.floor(rnd())]);
  }
  const sample = [...picked];

  const pairs = [];
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const a = sets.get(sample[i]);
      const b = sets.get(sample[j]);
      if (a.size && b.size) pairs.push([jaccard(a, b), sample[i], sample[j]]);
    }
  }
  pairs.sort((x, y) => x[0] - y[0]);

  const sims = pairs.map((p) => p[0]);
  const at = (q) => sims[Math.min(sims.length - 1, Math.floor(sims.length * q))];
  const words = [...texts.values()]
    .map((t) => t.split(' ').length)
    .sort((a, b) => a - b);
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const short = (f) => path.relative(family.root, f).replace(/\.html$/, '');

  analysed += files.length;
  console.log(`\n── ${family.name}`);
  console.log(`pages          ${files.length}`);
  console.log(`sampled        ${sample.length}  (${pairs.length} pairs)`);
  if (sims.length > 0) {
    console.log(`median         ${pct(at(0.5))}`);
    console.log(`p90            ${pct(at(0.9))}`);
    console.log(`p99            ${pct(at(0.99))}`);
    console.log(`max            ${pct(sims[sims.length - 1])}`);
  }
  console.log(
    `words / page   median ${words[Math.floor(words.length / 2)]}, min ${words[0]}, max ${words[words.length - 1]}`,
  );

  const over = pairs.filter(([s]) => s > MAX_SIMILARITY);
  if (over.length) {
    console.error(`\n✗ ${family.name}: ${over.length} pair(s) above ${pct(MAX_SIMILARITY)}:`);
    for (const [s, a, b] of over.slice(-10)) {
      console.error(`   ${pct(s)}  ${short(a)}  ↔  ${short(b)}`);
    }
    failed++;
  }
}

if (nestingProblems.length > 0) {
  console.error(`\n✗ ${nestingProblems.length} nested \`data-boilerplate\` block(s):\n`);
  for (const p of nestingProblems.slice(0, 20)) console.error(`   ${p}`);
  console.error(
    '\n  Unwrap one of them. A mark may cover a block that is word for word\n' +
      '  the same on every page — never a container holding one.',
  );
  process.exit(1);
}

if (failed > 0) {
  console.error(
    '\nThese pages differ by little more than a substituted value.\n' +
      'Either give them something of their own, or do not publish both.',
  );
  process.exit(1);
}

console.log(`\n✓ ${analysed} generated pages, no pair above ${(MAX_SIMILARITY * 100).toFixed(1)}%`);
