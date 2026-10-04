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

import { readFileSync, realpathSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

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

/**
 * Remove every element carrying `data-boilerplate`, with everything
 * inside it, however deeply nested.
 *
 * Walks the tag stream counting opens and closes of the same name, so a
 * block that contains links, <time>, or another element of its own kind
 * is removed whole.
 */
export function stripBoilerplate(html) {
  const OPEN = /<([a-z]+)([^>]*)>/gi;
  let out = '';
  let at = 0;
  OPEN.lastIndex = 0;
  for (let m = OPEN.exec(html); m; m = OPEN.exec(html)) {
    if (!/\sdata-boilerplate=/i.test(m[2])) continue;
    const name = m[1].toLowerCase();
    // Self-closing or void: nothing inside to remove.
    if (m[2].trimEnd().endsWith('/')) {
      out += html.slice(at, m.index) + ' ';
      at = OPEN.lastIndex;
      continue;
    }
    const TAG = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi');
    TAG.lastIndex = OPEN.lastIndex;
    let depth = 1;
    let end = html.length;
    for (let t = TAG.exec(html); t; t = TAG.exec(html)) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = TAG.lastIndex;
        break;
      }
    }
    out += html.slice(at, m.index) + ' ';
    at = end;
    OPEN.lastIndex = end;
  }
  return out + html.slice(at);
}

export function visibleText(file) {
  let html = readFileSync(file, 'utf8');
  const main = /<main[^>]*>([\s\S]*?)<\/main>/.exec(html);
  html = main ? main[1] : html;
  return stripBoilerplate(html)
    // 🔴 Blocks that are identical on every page by construction are
    // stripped before comparing.
    //
    // The attribution block (CAMP-101) and the travel notice (CAMP-56)
    // are word-for-word the same everywhere, because both are promises
    // we make about every campsite rather than statements about one.
    // Counting them inflates every pair's similarity equally: adding the
    // attribution block pushed hr/zadarska/autocamp-tabor and
    // autocamp-punta from below the line to 80.7%, which is a true
    // measurement of the wrong thing.
    //
    // The rule for adding `data-boilerplate` is strict: the block must be
    // identical on every page it appears on. Anything that varies with
    // the subject stays in the comparison, because that is exactly what
    // the guard is for.
    // 🔴 BALANCED, not lazy-to-the-first-close. The old pattern was
    // `[\s\S]*?<\/[a-z]+>`, which stops at the FIRST closing tag — so a
    // boilerplate block containing a link or a <time> had only its first
    // fragment removed and the rest of its words went on being compared
    // as if they were about the campsite.
    //
    // Measured 04.10.2026: a credit paragraph holding two <a> and a
    // <time> kept "· CDI v4.1.1 · CEMS terms · Read on 4 October 2026.
    // Contains modified Copernicus…" in the comparison. Every existing
    // `data-boilerplate` block with a nested element was under-stripped
    // the same way, which inflated every pair in the same direction.
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const shingles = (text, n = 5) => {
  const w = text.split(' ');
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
};

const jaccard = (a, b) => {
  let shared = 0;
  for (const s of a) if (b.has(s)) shared++;
  return shared / (a.size + b.size - shared);
};

/**
 * Prove the stripper bites. No build, no filesystem.
 *
 * 🔴 This file had no rehearsal at all, and that is how the lazy pattern
 * survived: it was only ever exercised against real pages, where a
 * partially-stripped block still LOOKS like it was handled.
 */
function selfTest() {
  let rc = 0;
  const bad = (m) => {
    console.error(`✗ REHEARSAL FAILED: ${m}`);
    rc = 1;
  };
  const gone = (html, ...words) => {
    const out = stripBoilerplate(html);
    for (const w of words) if (out.includes(w)) bad(`"${w}" survived: ${out}`);
    return out;
  };

  gone('<p data-boilerplate="x">plain</p>', 'plain');

  // 🔴 The case the old pattern got wrong, and the reason this exists.
  gone(
    '<p data-boilerplate="c"><a href="#">Source</a> · v4 · <time>4 October</time>. Contains modified.</p>',
    'Source', 'v4', '4 October', 'Contains modified',
  );

  // Nested element of the SAME name must not end the block early.
  gone('<div data-boilerplate="n">a<div>b</div>c</div>', 'a', 'b', 'c');

  // What is NOT boilerplate must survive, untouched.
  const kept = stripBoilerplate('<p>keep me</p><p data-boilerplate="x">drop me</p><p>and me</p>');
  if (!kept.includes('keep me') || !kept.includes('and me')) bad(`real content was removed: ${kept}`);
  if (kept.includes('drop me')) bad('boilerplate survived beside real content');

  // An unclosed block removes to the end rather than silently keeping it.
  gone('<p data-boilerplate="x">never closed', 'never closed');

  // A page with no boilerplate comes back unchanged.
  const plain = '<p>one</p><p>two</p>';
  if (stripBoilerplate(plain) !== plain) bad('a page with no boilerplate was altered');

  // 🔴 And the attribute must be the attribute, not a word in the text.
  const lookalike = '<p>we use data-boilerplate= in our markup</p>';
  if (!stripBoilerplate(lookalike).includes('we use')) bad('a mention of the attribute removed real text');

  if (rc === 0) {
    console.log(
      '✓ rehearsal: a boilerplate block is removed whole — with its links,\n' +
        '  its <time>, and a nested element of its own name — while content\n' +
        '  beside it is untouched and a page without any is unchanged.',
    );
  }
  return rc;
}

const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (!invokedDirectly) {
  // imported for its functions
} else if (args.includes('--self-test')) {
  process.exit(selfTest());
} else {
  await main();
}

async function main() {

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

if (failed > 0) {
  console.error(
    '\nThese pages differ by little more than a substituted value.\n' +
      'Either give them something of their own, or do not publish both.',
  );
  process.exit(1);
}

console.log(`\n✓ ${analysed} generated pages, no pair above ${(MAX_SIMILARITY * 100).toFixed(1)}%`);
}
