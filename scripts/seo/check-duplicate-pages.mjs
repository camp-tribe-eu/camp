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

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

const MAX_SIMILARITY = opt('max', 0.8);
const SAMPLE = opt('sample', 150);
const ROOT = 'apps/web/.next/server/app/camping';

/** Deterministic sample: the same pages every run, so a rise is a change. */
function seeded(n) {
  let s = 20260921;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * n;
}

function visibleText(file) {
  let html = readFileSync(file, 'utf8');
  const main = /<main[^>]*>([\s\S]*?)<\/main>/.exec(html);
  html = main ? main[1] : html;
  return html
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

const files = [];
for await (const f of glob(`${ROOT}/**/*.html`)) {
  // Campsite pages only: country and region hubs are a different shape
  // and legitimately share more of their wording.
  const depth = path.relative(ROOT, f).split(path.sep).length;
  if (depth === 3 && !f.includes(`${path.sep}page${path.sep}`)) files.push(f);
}

if (files.length === 0) {
  console.error(
    `No generated pages under ${ROOT}. Run the build first:\n` +
      '  cd apps/web && npx next build',
  );
  process.exit(1);
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
const words = [...texts.values()].map((t) => t.split(' ').length).sort((a, b) => a - b);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const short = (f) => path.relative(ROOT, f).replace(/\.html$/, '');

console.log(`pages          ${files.length}`);
console.log(`sampled        ${sample.length}  (${pairs.length} pairs)`);
console.log(`median         ${pct(at(0.5))}`);
console.log(`p90            ${pct(at(0.9))}`);
console.log(`p99            ${pct(at(0.99))}`);
console.log(`max            ${pct(sims[sims.length - 1])}`);
console.log(`words / page   median ${words[Math.floor(words.length / 2)]}, min ${words[0]}, max ${words[words.length - 1]}`);

const over = pairs.filter(([s]) => s > MAX_SIMILARITY);
if (over.length) {
  console.error(`\n✗ ${over.length} pair(s) above ${pct(MAX_SIMILARITY)}:`);
  for (const [s, a, b] of over.slice(-10)) {
    console.error(`   ${pct(s)}  ${short(a)}  ↔  ${short(b)}`);
  }
  console.error(
    '\nThese pages differ by little more than a substituted value.\n' +
      'Either give them something of their own, or do not publish both.',
  );
  process.exit(1);
}

console.log(`\n✓ no pair above ${pct(MAX_SIMILARITY)}`);
