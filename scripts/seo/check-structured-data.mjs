#!/usr/bin/env node
// CAMP-37: validate every JSON-LD block in the built site.
//
//   node scripts/seo/check-structured-data.mjs [--dir apps/web/.next/server/app]
//   node scripts/seo/check-structured-data.mjs --self-test
//
// 🔴 The gap this closes, in the card's words: "broken markup silently
// stops working, and we find out from a traffic drop rather than a test".
// Lighthouse scores SEO but never validates the graph — a page can score
// 100 with a @type that does not exist.
//
// What is checked, against the real schema.org vocabulary rather than a
// list somebody typed:
//
//   1. the block is valid JSON at all;
//   2. @context points at schema.org;
//   3. every @type exists in the vocabulary;
//   4. every property exists AND is allowed on that type, following the
//      subclass chain (amenityFeature is legal on Campground only
//      because Campground inherits from LodgingBusiness);
//   5. our own rules on top: a Campground needs a name and geo, a
//      BreadcrumbList needs positions starting at 1 and increasing.
//
// Anything not in the vocabulary is an error, not a warning. A typo in a
// property name is invisible to a human reviewer and invisible to
// Lighthouse, which is exactly why it needs a machine.

import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const SELF_TEST = args.includes('--self-test');
const dirIndex = args.indexOf('--dir');
const ROOT =
  dirIndex >= 0 && args[dirIndex + 1]
    ? args[dirIndex + 1]
    : 'apps/web/.next/server/app';

const INDEX = JSON.parse(
  readFileSync(new URL('./schema-index.json', import.meta.url), 'utf8'),
);

/** Every ancestor of a type, itself included. */
function ancestors(type, seen = new Set()) {
  if (seen.has(type)) return seen;
  seen.add(type);
  for (const parent of INDEX.parents[type] ?? []) ancestors(parent, seen);
  return seen;
}

/** Keys that are JSON-LD syntax rather than schema.org properties. */
const KEYWORDS = new Set([
  '@context',
  '@type',
  '@id',
  '@graph',
  '@value',
  '@language',
  '@list',
]);

/**
 * Walks one node and everything nested inside it.
 * Errors carry a path so a failure names the offending key, not the file.
 */
function validateNode(node, where, errors) {
  if (Array.isArray(node)) {
    node.forEach((n, i) => validateNode(n, `${where}[${i}]`, errors));
    return;
  }
  if (!node || typeof node !== 'object') return;

  const types = [].concat(node['@type'] ?? []);
  for (const t of types) {
    if (!INDEX.types.includes(t)) {
      errors.push(`${where}: @type "${t}" is not a schema.org type`);
    }
  }

  const allowed = new Set();
  for (const t of types) for (const a of ancestors(t)) allowed.add(a);

  for (const [key, value] of Object.entries(node)) {
    if (KEYWORDS.has(key)) continue;

    const domains = INDEX.properties[key];
    if (domains === undefined) {
      errors.push(`${where}: "${key}" is not a schema.org property`);
    } else if (
      types.length &&
      domains.length &&
      !domains.some((d) => allowed.has(d))
    ) {
      errors.push(
        `${where}: "${key}" is not allowed on ${types.join('/')} ` +
          `(valid on ${domains.slice(0, 4).join(', ')})`,
      );
    }
    validateNode(value, `${where}.${key}`, errors);
  }

  // ── beyond "is it legal vocabulary" ───────────────────────────────────
  //
  // Google's Rich Results Test needs a publicly reachable URL, and the
  // site is not deployed until CAMP-61 — so it cannot be part of CI
  // today, and claiming otherwise would be a checkbox rather than a
  // check. What can be enforced now are the properties Google documents
  // as REQUIRED for the rich results these types actually produce.
  // Anything the vocabulary permits but Google needs is caught here.

  // Campground descends from LocalBusiness, which is where Google's
  // local rich result comes from: name and address are required there,
  // and geo is what makes the result locatable at all.
  if (types.includes('Campground')) {
    if (!node.name) errors.push(`${where}: Campground without a name`);
    if (!node.geo) errors.push(`${where}: Campground without geo coordinates`);
    if (!node.address) errors.push(`${where}: Campground without an address`);
    if (!node.url) errors.push(`${where}: Campground without a url`);
  }

  // Breadcrumbs are dropped in full if a single position is wrong, and
  // nothing on the page shows it — the most silent failure of the lot.
  if (types.includes('BreadcrumbList')) {
    const items = [].concat(node.itemListElement ?? []);
    if (items.length < 2) {
      errors.push(`${where}: BreadcrumbList with fewer than 2 items`);
    }
    items.forEach((item, i) => {
      if (item?.position !== i + 1) {
        errors.push(
          `${where}: breadcrumb ${i} has position ${item?.position}, expected ${i + 1}`,
        );
      }
      if (!item?.name) errors.push(`${where}: breadcrumb ${i} has no name`);
      if (!item?.item && i < items.length - 1) {
        // The last crumb may omit `item` — it is the current page.
        errors.push(`${where}: breadcrumb ${i} has no item URL`);
      }
    });
  }

  // 🔴 Ratings we do not have. Reviews arrive with CAMP-53; until then
  // any rating markup would be fabricated, which is both a lie and the
  // fastest route to a manual action from Google.
  if (node.aggregateRating || node.reviewCount || node.ratingValue) {
    errors.push(
      `${where}: rating markup, but the site has no reviews yet (CAMP-53)`,
    );
  }
}

function blocksIn(html) {
  const out = [];
  const re =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function validateHtml(html, label) {
  const errors = [];
  const blocks = blocksIn(html);
  blocks.forEach((raw, i) => {
    const where = blocks.length > 1 ? `${label}#${i}` : label;
    let parsed;
    try {
      // Next escapes `<` in JSON-LD; undo it before parsing.
      parsed = JSON.parse(raw.replace(/\\u003c/gi, '<'));
    } catch (err) {
      errors.push(`${where}: not valid JSON — ${err.message}`);
      return;
    }
    const ctx = parsed['@context'];
    if (typeof ctx !== 'string' || !/schema\.org/.test(ctx)) {
      errors.push(`${where}: @context is not schema.org (${JSON.stringify(ctx)})`);
    }
    validateNode(parsed, where, errors);
  });
  return { count: blocks.length, errors };
}

// ── the card's own acceptance criterion ──────────────────────────────────
// "the validator fails on deliberately broken markup". A checker nobody
// has seen fail is not evidence of anything, so the broken cases live
// here and run on demand.
if (SELF_TEST) {
  const cases = [
    ['valid Campground', true, {
      '@context': 'https://schema.org',
      '@type': 'Campground',
      name: 'Camping Bled',
      url: 'https://camptribe.eu/camping/si/bled/camping-bled',
      address: { '@type': 'PostalAddress', addressCountry: 'SI' },
      geo: { '@type': 'GeoCoordinates', latitude: 46.36, longitude: 14.07 },
      amenityFeature: [
        { '@type': 'LocationFeatureSpecification', name: 'Wi-Fi', value: true },
      ],
    }],
    ['invented @type', false, {
      '@context': 'https://schema.org',
      '@type': 'CampingSpotThing',
      name: 'x',
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
    }],
    ['misspelled property', false, {
      '@context': 'https://schema.org',
      '@type': 'Campground',
      nmae: 'typo',
      name: 'x',
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
    }],
    ['property on the wrong type', false, {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      amenityFeature: 'nonsense',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'a', item: 'https://x/' },
        { '@type': 'ListItem', position: 2, name: 'b', item: 'https://y/' },
      ],
    }],
    ['breadcrumb positions out of order', false, {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'a', item: 'https://x/' },
        { '@type': 'ListItem', position: 3, name: 'b', item: 'https://y/' },
      ],
    }],
    ['Campground with no coordinates', false, {
      '@context': 'https://schema.org',
      '@type': 'Campground',
      name: 'x',
    }],
    ['invented rating', false, {
      '@context': 'https://schema.org',
      '@type': 'Campground',
      name: 'x',
      url: 'https://camptribe.eu/x',
      address: { '@type': 'PostalAddress', addressCountry: 'SI' },
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
      aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.8, reviewCount: 120 },
    }],
    ['wrong @context', false, {
      '@context': 'https://example.com',
      '@type': 'Campground',
      name: 'x',
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
    }],
  ];

  let failures = 0;
  for (const [name, shouldPass, doc] of cases) {
    const html = `<script type="application/ld+json">${JSON.stringify(doc)}</script>`;
    const { errors } = validateHtml(html, name);
    const passed = errors.length === 0;
    const ok = passed === shouldPass;
    if (!ok) failures++;
    console.log(
      `${ok ? '✓' : '✗'} ${name}: ` +
        (passed ? 'accepted' : `rejected (${errors[0]})`),
    );
  }
  // Broken JSON, which cannot be expressed as an object literal.
  const broken = validateHtml(
    '<script type="application/ld+json">{"@type": Campground}</script>',
    'malformed JSON',
  );
  const ok = broken.errors.length > 0;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} malformed JSON: ${broken.errors[0] ?? 'ACCEPTED'}`);

  console.log(
    failures === 0
      ? '\n✓ the validator rejects every broken case and accepts the good one'
      : `\n✗ ${failures} self-test case(s) behaved wrongly`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

// ── the real run ─────────────────────────────────────────────────────────
const files = [];
for await (const f of glob(`${ROOT}/**/*.html`)) files.push(f);

if (files.length === 0) {
  console.error(`No built pages under ${ROOT}. Build first.`);
  process.exit(1);
}

let blocks = 0;
let withMarkup = 0;
const allErrors = [];
const seenTypes = new Map();

for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const label = path.relative(ROOT, file).replace(/\.html$/, '');
  const { count, errors } = validateHtml(html, label);
  blocks += count;
  if (count) withMarkup++;
  allErrors.push(...errors);
  for (const m of html.matchAll(/"@type"\s*:\s*"([A-Za-z]+)"/g)) {
    seenTypes.set(m[1], (seenTypes.get(m[1]) ?? 0) + 1);
  }
}

console.log(`pages           ${files.length}`);
console.log(`with JSON-LD    ${withMarkup}`);
console.log(`blocks          ${blocks}`);
console.log(
  `types           ${[...seenTypes]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t}×${n}`)
    .join(', ')}`,
);
console.log(`vocabulary      schema.org ${INDEX.generated}`);

if (allErrors.length) {
  console.error(`\n✗ ${allErrors.length} structured-data error(s):`);
  for (const e of allErrors.slice(0, 25)) console.error(`   ${e}`);
  if (allErrors.length > 25) {
    console.error(`   … and ${allErrors.length - 25} more`);
  }
  process.exit(1);
}

// Every page is expected to describe itself — except the error pages.
// 🔴 Marking up a 404 would be a lie in machine-readable form: it claims
// a thing exists at a URL where nothing does. Their absence is correct,
// so they are named here rather than being allowed to weaken the rule
// for everyone.
const ERROR_PAGES = new Set(['_not-found', '404', '500']);
const missing = files
  .map((f) => path.relative(ROOT, f).replace(/\.html$/, ''))
  .filter(
    (label) =>
      !ERROR_PAGES.has(label) &&
      !readFileSync(path.join(ROOT, `${label}.html`), 'utf8').includes(
        'application/ld+json',
      ),
  );

if (missing.length) {
  console.error(`\n✗ ${missing.length} page(s) carry no JSON-LD at all:`);
  for (const m of missing.slice(0, 10)) console.error(`   ${m}`);
  process.exit(1);
}

console.log('\n✓ every block validates against the schema.org vocabulary');
