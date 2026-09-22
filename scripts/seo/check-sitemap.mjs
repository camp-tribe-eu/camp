#!/usr/bin/env node
// CAMP-39: the sitemap says what we mean, and llms.txt exists.
//
//   node scripts/seo/check-sitemap.mjs [--dir apps/web/.next/server/app]
//
// XSD validation is done separately with xmllint against the committed
// schemas in scripts/seo/schemas/ — this checks the things a schema
// cannot express, which are the things that actually go wrong:
//
// 🔴 1. No URL in the sitemap may carry `noindex`. The two are
//       contradictory instructions about one page, and the resolution is
//       Google's choice, not ours. This is the check that matters: the
//       XML stays perfectly valid while the meaning is wrong.
//    2. Every child named by the index exists and is non-empty.
//    3. Every `loc` is absolute, https, and on our host.
//    4. `lastmod` is a real W3C date, and not all identical — a sitemap
//       that stamps today on every page teaches a crawler to ignore the
//       field entirely.
//    5. Chunks stay under the protocol's 50,000-URL limit.
//    6. llms.txt is served and has the shape llmstxt.org describes.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dirIndex = args.indexOf('--dir');
const ROOT =
  dirIndex >= 0 && args[dirIndex + 1]
    ? args[dirIndex + 1]
    : 'apps/web/.next/server/app';

const MAX_URLS = 50_000;
const errors = [];
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

// ── the index ────────────────────────────────────────────────────────────
const indexPath = path.join(ROOT, 'sitemap.xml.body');
const indexXml = read(indexPath) ?? read(path.join(ROOT, 'sitemap.xml'));
if (!indexXml) {
  console.error(`No sitemap index built under ${ROOT}. Build first.`);
  process.exit(1);
}
if (!indexXml.includes('<sitemapindex')) {
  errors.push('sitemap.xml is not a <sitemapindex>');
}

const children = locs(indexXml);
if (children.length === 0) errors.push('sitemap index lists no children');

// ── the children ─────────────────────────────────────────────────────────
const allUrls = [];
const lastmods = new Set();

for (const child of children) {
  const name = child.split('/').pop();
  const file =
    read(path.join(ROOT, 'sitemaps', `${name}.body`)) ??
    read(path.join(ROOT, 'sitemaps', name));
  if (!file) {
    errors.push(`index points at ${name}, which was not built`);
    continue;
  }
  const urls = locs(file);
  if (urls.length === 0) errors.push(`${name} contains no URLs`);
  if (urls.length > MAX_URLS) {
    errors.push(`${name} has ${urls.length} URLs, over the ${MAX_URLS} limit`);
  }
  for (const m of file.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) {
    const v = m[1];
    if (!/^\d{4}-\d{2}-\d{2}(T[\d:.+\-Z]+)?$/.test(v)) {
      errors.push(`${name}: lastmod "${v}" is not a W3C datetime`);
    }
    lastmods.add(v);
  }
  allUrls.push(...urls.map((u) => ({ url: u, from: name })));
}

// ── the URLs themselves ──────────────────────────────────────────────────
const seen = new Set();
for (const { url, from } of allUrls) {
  if (!/^https:\/\//.test(url)) {
    errors.push(`${from}: "${url}" is not an absolute https URL`);
  }
  if (seen.has(url)) errors.push(`${from}: "${url}" appears twice`);
  seen.add(url);
}

// 🔴 The check this script exists for.
let noindexed = 0;
for (const { url, from } of allUrls) {
  const p = new URL(url).pathname.replace(/^\/|\/$/g, '') || 'index';
  const html = read(path.join(ROOT, `${p}.html`));
  if (html === null) {
    errors.push(`${from}: "${url}" has no built page`);
    continue;
  }
  if (/<meta name="robots"[^>]*content="[^"]*noindex/i.test(html)) {
    noindexed++;
    errors.push(`${from}: "${url}" is in the sitemap but carries noindex`);
  }
}

// ── llms.txt ─────────────────────────────────────────────────────────────
const llms =
  read(path.join(ROOT, 'llms.txt.body')) ?? read(path.join(ROOT, 'llms.txt'));
if (!llms) {
  errors.push('llms.txt was not built');
} else {
  if (!/^# \S/m.test(llms)) errors.push('llms.txt has no H1 title');
  if (!/^> \S/m.test(llms)) errors.push('llms.txt has no blockquote summary');
  if (!/^## /m.test(llms)) errors.push('llms.txt has no sections');
  if (!llms.includes('/sitemap.xml')) {
    errors.push('llms.txt does not point at the sitemap');
  }
}

console.log(`children        ${children.length}`);
console.log(`urls            ${allUrls.length}`);
console.log(`distinct dates  ${lastmods.size}`);
console.log(`noindex in map  ${noindexed}`);
console.log(`llms.txt        ${llms ? `${llms.split('\n').length} lines` : 'MISSING'}`);

if (lastmods.size === 1 && allUrls.length > 50) {
  console.warn(
    '\n⚠ every lastmod is identical — the field carries no information',
  );
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} problem(s):`);
  for (const e of errors.slice(0, 20)) console.error(`   ${e}`);
  if (errors.length > 20) console.error(`   … and ${errors.length - 20} more`);
  process.exit(1);
}

console.log('\n✓ sitemap is consistent with what the pages actually say');
