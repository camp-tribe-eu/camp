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

import { readFileSync, realpathSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
function validateNode(node, where, errors, inStarRating = false) {
  if (Array.isArray(node)) {
    node.forEach((n, i) => validateNode(n, `${where}[${i}]`, errors, inStarRating));
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
    // 🔴 `@graph` is JSON-LD syntax, but its CONTENTS are not.
    //
    // Skipping the key skipped everything inside it, so a document that
    // wrapped its nodes in a @graph was never validated at all — an
    // invented @type, a misspelled property and a fabricated
    // aggregateRating all passed. Found in review. The key itself is
    // still not a schema.org property; the walk continues into it.
    if (key === '@graph') {
      validateNode(value, `${where}.@graph`, errors, false);
      continue;
    }
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
    validateNode(value, `${where}.${key}`, errors, key === 'starRating');
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
  // any rating OF OUR OWN would be fabricated, which is both a lie and
  // the fastest route to a manual action from Google.
  //
  // ⚠️ This used to ban `ratingValue` outright, and that was one word too
  // broad. CAMP-114 added `starRating` — the national classification a
  // state authority publishes (France's classement; OpenStreetMap carries
  // none), which lives in `spot.stars` and is printed on the page as
  // somebody else's rating. That is a recorded fact about the business,
  // not an opinion we formed, and schema.org has a separate property for
  // exactly that distinction.
  //
  // So the rule is narrowed, not weakened: aggregates stay banned
  // everywhere, and a bare ratingValue stays banned everywhere EXCEPT
  // inside a starRating, where it must be a complete Rating.
  if (node.aggregateRating || node.reviewCount || node.ratingCount) {
    errors.push(
      `${where}: aggregate rating markup, but the site has no reviews yet (CAMP-53)`,
    );
  }
  // 🔴 An AggregateRating is never acceptable, wherever it stands.
  //
  // Review found the narrowing had a hole the blanket ban did not: the
  // exemption asked `types.includes('Rating')`, and AggregateRating
  // INHERITS from Rating, so `starRating: {"@type":"AggregateRating",
  // "ratingValue":4.8,"bestRating":5}` was accepted — a rating derived
  // from reviews we do not have, dressed as a state classification. The
  // type is banned by name, before anything else is considered.
  if (types.includes('AggregateRating')) {
    errors.push(
      `${where}: AggregateRating — the site has no reviews at all (CAMP-53)`,
    );
  }
  if (node.ratingValue !== undefined && !inStarRating) {
    errors.push(
      `${where}: ratingValue outside a starRating — we rate nothing (CAMP-53)`,
    );
  }
  if (inStarRating && types.length > 0) {
    // 🔴 Exactly Rating, not "something that inherits from Rating".
    if (types.length !== 1 || types[0] !== 'Rating') {
      errors.push(
        `${where}: a starRating must be a plain Rating, not ${types.join('/')}`,
      );
    }
    // A star rating without its scale is unreadable: 3 out of what?
    if (node.ratingValue === undefined) {
      errors.push(`${where}: starRating without a ratingValue`);
    }
    if (node.bestRating === undefined) {
      errors.push(`${where}: starRating without a bestRating — 3 out of what?`);
    }
    // And a value outside its own scale is not a classification.
    const v = Number(node.ratingValue);
    const best = Number(node.bestRating);
    const worst = node.worstRating === undefined ? 1 : Number(node.worstRating);
    if (Number.isFinite(v) && Number.isFinite(best) && (v > best || v < worst)) {
      errors.push(
        `${where}: starRating ${node.ratingValue} is outside its own ${worst}-${best} scale`,
      );
    }
  }

  // 🔴 A type that claims content it does not carry.
  //
  // CAMP-114's rule, in the validator rather than in a comment: an empty
  // FAQPage is worse than no FAQPage, because it tells an assistant there
  // are answers here and then has none.
  if (types.includes('FAQPage')) {
    const qs = [].concat(node.mainEntity ?? []);
    if (qs.length === 0) errors.push(`${where}: FAQPage with no questions`);
    qs.forEach((q, i) => {
      if (!q?.name) errors.push(`${where}: question ${i} has no text`);
      if (!q?.acceptedAnswer?.text) {
        errors.push(`${where}: question ${i} has no answer`);
      }
    });
  }

  // A PropertyValue whose value is missing describes nothing, and a
  // distance without a unit is a number nobody can use.
  if (types.includes('PropertyValue')) {
    if (node.value === undefined || node.value === null) {
      errors.push(`${where}: PropertyValue without a value`);
    }
    if (typeof node.value === 'number' && !node.unitCode) {
      errors.push(`${where}: numeric PropertyValue without a unitCode`);
    }
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

export function validateHtml(html, label) {
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
    // 🔴 Anchored, and CodeQL is the reason this is not just
    // `/schema\.org/`.
    //
    // Unanchored, the test passes for "https://evil.example/schema.org-x"
    // and for "schema.org.attacker.test" — a validator that accepts a
    // context pointing anywhere is not validating the context at all.
    // The real vocabulary is served from exactly these, with or without
    // a trailing slash.
    if (typeof ctx !== 'string' || !/^https?:\/\/schema\.org\/?$/.test(ctx)) {
      errors.push(`${where}: @context is not schema.org (${JSON.stringify(ctx)})`);
    }
    if (parsed === null || typeof parsed !== 'object') {
      errors.push(`${where}: the block is not a JSON-LD object`);
      return;
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
    // 🔴 The case CodeQL asked for. Before the anchor, both of these
    // passed: the check only looked for "schema.org" ANYWHERE in the
    // string, so a context served from someone else's domain satisfied
    // it. Found by CodeQL on 22.09.2026, in this file.
    ['@context on a lookalike domain', false, {
      '@context': 'https://evil.example/schema.org-fake',
      '@type': 'Campground',
      name: 'x',
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
    }],
    ['@context on a subdomain of an attacker', false, {
      '@context': 'https://schema.org.attacker.test/',
      '@type': 'Campground',
      name: 'x',
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
    }],
    ['@context with a trailing slash is still fine', true, {
      '@context': 'https://schema.org/',
      '@type': 'Campground',
      name: 'x',
      url: 'https://camptribe.eu/x',
      address: { '@type': 'PostalAddress', addressCountry: 'SI' },
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
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

    // ── CAMP-114 ──────────────────────────────────────────────────────
    // The narrowed rating rule, proved in both directions: the official
    // classification is accepted, and every other shape of rating is not.
    ['official star classification', true, {
      '@context': 'https://schema.org',
      '@type': 'Campground',
      name: 'x',
      url: 'https://camptribe.eu/x',
      address: { '@type': 'PostalAddress', addressCountry: 'FR' },
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
      starRating: { '@type': 'Rating', ratingValue: 4, bestRating: 5, worstRating: 1 },
    }],
    ['a rating of our own, dressed as a star rating', false, {
      '@context': 'https://schema.org',
      '@type': 'Campground',
      name: 'x',
      url: 'https://camptribe.eu/x',
      address: { '@type': 'PostalAddress', addressCountry: 'FR' },
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
      starRating: {
        '@type': 'Rating', ratingValue: 4.8, bestRating: 5, ratingCount: 149,
      },
    }],
    ['a star rating with no scale', false, {
      '@context': 'https://schema.org',
      '@type': 'Campground',
      name: 'x',
      url: 'https://camptribe.eu/x',
      address: { '@type': 'PostalAddress', addressCountry: 'FR' },
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
      starRating: { '@type': 'Rating', ratingValue: 4 },
    }],
    ['a bare ratingValue anywhere else', false, {
      '@context': 'https://schema.org',
      '@type': 'Campground',
      name: 'x',
      url: 'https://camptribe.eu/x',
      address: { '@type': 'PostalAddress', addressCountry: 'FR' },
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
      ratingValue: 5,
    }],

    ['an FAQ with questions', true, {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [{
        '@type': 'Question',
        name: 'How far is the nearest water?',
        acceptedAnswer: { '@type': 'Answer', text: '365 m to Lake Bled.' },
      }],
    }],
    ['an FAQ that promises answers and has none', false, {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [],
    }],
    ['a question with no answer', false, {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [{ '@type': 'Question', name: 'How far is the water?' }],
    }],

    ['a measured distance with its unit', true, {
      '@context': 'https://schema.org',
      '@type': 'Campground',
      name: 'x',
      url: 'https://camptribe.eu/x',
      address: { '@type': 'PostalAddress', addressCountry: 'SI' },
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
      additionalProperty: [
        { '@type': 'PropertyValue', name: 'Distance to Lake Bled', value: 365, unitCode: 'MTR' },
      ],
    }],
    ['a number with no unit — 365 of what?', false, {
      '@context': 'https://schema.org',
      '@type': 'Campground',
      name: 'x',
      url: 'https://camptribe.eu/x',
      address: { '@type': 'PostalAddress', addressCountry: 'SI' },
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
      additionalProperty: [
        { '@type': 'PropertyValue', name: 'Distance to Lake Bled', value: 365 },
      ],
    }],
    // 🔴 The cases that prove the NEW lines, not the old domain check.
    //
    // Review deleted all three new rating rules and found only one case
    // went red — the other two were being rejected by the pre-existing
    // "is this property legal on this type" check, so the rules that
    // replaced a blanket ban were untested in both directions.
    ['an aggregate rating smuggled in as a star rating', false, {
      '@context': 'https://schema.org',
      '@type': 'Campground',
      name: 'x',
      url: 'https://camptribe.eu/x',
      address: { '@type': 'PostalAddress', addressCountry: 'FR' },
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
      starRating: { '@type': 'AggregateRating', ratingValue: 4.8, bestRating: 5 },
    }],
    // ratingValue IS legal on a Rating by the vocabulary, and this one
    // stands outside any starRating — so the domain check passes it and
    // only the new rule can reject it. That is the point: the previous
    // version of this case was rejected by the domain check instead, and
    // deleting the rule left it green.
    ['a bare Rating block of our own', false, {
      '@context': 'https://schema.org',
      '@type': 'Rating',
      ratingValue: 5,
      bestRating: 5,
    }],
    ['four stars out of five is fine', true, {
      '@context': 'https://schema.org',
      '@type': 'Campground',
      name: 'x',
      url: 'https://camptribe.eu/x',
      address: { '@type': 'PostalAddress', addressCountry: 'FR' },
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
      starRating: { '@type': 'Rating', ratingValue: 4, bestRating: 5, worstRating: 1 },
    }],
    ['nine stars out of five is not', false, {
      '@context': 'https://schema.org',
      '@type': 'Campground',
      name: 'x',
      url: 'https://camptribe.eu/x',
      address: { '@type': 'PostalAddress', addressCountry: 'FR' },
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
      starRating: { '@type': 'Rating', ratingValue: 9, bestRating: 5, worstRating: 1 },
    }],
    ['zero stars is below the scale it declares', false, {
      '@context': 'https://schema.org',
      '@type': 'Campground',
      name: 'x',
      url: 'https://camptribe.eu/x',
      address: { '@type': 'PostalAddress', addressCountry: 'FR' },
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
      starRating: { '@type': 'Rating', ratingValue: 0, bestRating: 5, worstRating: 1 },
    }],

    // 🔴 @graph used to hide everything inside it from every check.
    ['a fabricated rating inside a @graph', false, {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Campground',
        name: 'x',
        url: 'https://camptribe.eu/x',
        address: { '@type': 'PostalAddress', addressCountry: 'FR' },
        geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
        aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.9, reviewCount: 3000 },
      }],
    }],
    ['an invented type inside a @graph', false, {
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'TotallyInventedType', name: 'x' }],
    }],
    ['a well-formed @graph still passes', true, {
      '@context': 'https://schema.org',
      '@graph': [{
        '@type': 'Campground',
        name: 'x',
        url: 'https://camptribe.eu/x',
        address: { '@type': 'PostalAddress', addressCountry: 'FR' },
        geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
      }],
    }],

    ['a property that carries no value at all', false, {
      '@context': 'https://schema.org',
      '@type': 'Campground',
      name: 'x',
      url: 'https://camptribe.eu/x',
      address: { '@type': 'PostalAddress', addressCountry: 'SI' },
      geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 },
      additionalProperty: [{ '@type': 'PropertyValue', name: 'Elevation' }],
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

// 🔴 Only when run as a command, never when imported.
//
// Everything below is top-level, so a unit test that wants `validateHtml`
// would otherwise walk .next/server/app and exit the process. The tests
// for CAMP-114's markup check the same rules this file enforces, against
// the same vocabulary index — importing it is how the two cannot drift.
// 🔴 REALPATH ON BOTH SIDES, or this guard silently switches CI off.
//
// `import.meta.url` is resolved through symlinks; `process.argv[1]` is
// not. One symlink anywhere in the path makes them differ, `main()` never
// runs, and the process prints nothing and exits 0 — a validator that has
// quietly stopped validating, which is the exact failure this whole file
// exists to prevent. Reproduced by review on macOS, where /tmp is a
// symlink to /private/tmp:
//
//   direct   exit=1  "No built pages under … Build first."
//   symlink  exit=0  (nothing at all)
//
// GitHub's runner path happens to be symlink-free today, so CI was not
// broken — it would have broken the first time a checkout path gained a
// symlink, and nothing would have said so.
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  // 🔴 `.catch`, not top-level `await`. A module with top-level await is
  // an async ESM graph, and `require()` refuses to load one — which shut
  // out every CommonJS consumer, including ts-node. Nothing here needs to
  // block the module's evaluation, so nothing does.
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

async function main() {
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
// `gone` (CAMP-73) is served as the body of a 410 at the address of a
// campsite that no longer exists — the same case exactly: describing a
// Campground there would assert in machine-readable form that a place
// exists where we are telling the crawler it does not.
const ERROR_PAGES = new Set(['_not-found', '404', '500', 'gone']);
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
}
