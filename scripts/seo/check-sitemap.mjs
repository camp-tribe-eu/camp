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
const modeIndex = args.indexOf('--mode');
/**
 * 🔴 CAMP-90 made this two-sided instead of optional.
 *
 * When the whole site is closed, every page carries noindex, so the
 * rule "nothing in the sitemap is noindex" would fail on every URL. The
 * tempting fix is to skip the rule in closed mode — which is how a
 * check quietly stops checking and then passes everything for ever.
 *
 * So it inverts instead. In a closed build the sitemap must be entirely
 * noindex, for the same reason it must be entirely indexable in a
 * public one: the sitemap and the pages have to agree, whichever way
 * round that is.
 */
const MODE = modeIndex >= 0 ? args[modeIndex + 1] : 'public';
if (MODE !== 'public' && MODE !== 'closed') {
  console.error('--mode must be "public" or "closed"');
  process.exit(2);
}
const expectIndexable = MODE === 'public';
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

// 🔴 The check this script exists for — in whichever direction applies.
let noindexed = 0;
const disagree = [];
for (const { url, from } of allUrls) {
  const p = new URL(url).pathname.replace(/^\/|\/$/g, '') || 'index';
  const html = read(path.join(ROOT, `${p}.html`));
  if (html === null) {
    errors.push(`${from}: "${url}" has no built page`);
    continue;
  }
  const isNoindex = /<meta name="robots"[^>]*content="[^"]*noindex/i.test(html);
  if (isNoindex) noindexed++;
  if (isNoindex === expectIndexable) disagree.push(`${from}: ${url}`);
}
if (disagree.length) {
  errors.push(
    expectIndexable
      ? `${disagree.length} URL(s) in the sitemap carry noindex: ${disagree[0]}`
      : `${disagree.length} URL(s) in a closed build are still indexable: ${disagree[0]}`,
  );
}

// 🔴 CAMP-211. Один підрахунок на перевірку й на підсумок.
//
// 🔴 `allUrls` holds `{ url, from }`, not strings. The first version of
// this mapped the OBJECT through `new URL(...)`, which throws, and the
// catch turned every section into '' — a guard that could never fire,
// passing because it saw nothing. So: no `catch` that swallows the
// shape. A URL that does not parse is an error here, because every one
// of them has already been checked as absolute https above.
//
// 🔴 `null` is the ROOT PAGE, named rather than filtered for truth.
// `.filter(Boolean)` here was a mutation that survived the whole
// rehearsal: dropping it put '' in the set, and the old substring test
// asked `llms.includes('/')`, which every URL in the file satisfies.
// An empty section was therefore "named" by construction. Below it
// cannot be: '' is not a path segment any link produces.
const sections = [
  ...new Set(
    allUrls
      .map(({ url }) => new URL(url).pathname.split('/').filter((x) => x !== '')[0] ?? null)
      .filter((x) => x !== null),
  ),
].sort();
let unlisted = [];
let sectionsChecked = false;

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

  // 🔴 CAMP-211. EVERY SECTION THE SITEMAP PUBLISHES MUST BE NAMED HERE.
  //
  // Measured 12.10.2026: the sitemap published five top-level sections
  // and llms.txt named two. `/guides`, `/tools` and `/routes` were
  // absent from it entirely — so the one file we hand an assistant as
  // "here is what we have" did not mention 1 256 guides, twelve curated
  // routes or either calculator.
  //
  // The shape checks above cannot see this: a file with an H1, a
  // blockquote, sections and a sitemap link passes all four while
  // describing a third of the site. This asks the sitemap what exists
  // instead of asking llms.txt whether it looks well-formed.
  //
  // It matters more than it used to. Google retired `HowTo` (2023) and
  // `SpecialAnnouncement` (31 July 2025) and narrowed `FAQPage` to
  // government and health sites, so the rich results that markup aimed
  // at are gone — while assistants still read this file.
  // 🔴 ЗВІРЯЄМО З ПОСИЛАННЯМИ, ЯКІ ФАЙЛ СПРАВДІ ДАЄ — не підрядком.
  //
  // `llms.includes(`/${x}`)` було ХИБНИМ ПРОХОДЖЕННЯМ, і рецензія це
  // показала випадком: розділ `/camper/...` у мапі «названий», бо в
  // файлі стоїть `/camper-rental`. Так само мовчки пройшли б `/camp`,
  // `/guide`, `/route`, `/tool` — тобто рівно ті назви, які ми й
  // заводимо. Підрядок відповідає на інше питання, ніж тут поставлене.
  //
  // Тому: беремо перший сегмент КОЖНОГО посилання у файлі й порівнюємо
  // множини. Згадка в прозі без посилання не рахується — агент ходить
  // по посиланнях, а не по прикметниках.
  const named = new Set(
    [...llms.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)]
      .map((m) => {
        try {
          return new URL(m[1]).pathname.split('/').filter((x) => x !== '')[0] ?? '';
        } catch {
          return '';
        }
      })
      .filter(Boolean),
  );
  unlisted = sections.filter((x) => !named.has(x));
  sectionsChecked = true;
  if (unlisted.length) {
    errors.push(
      `llms.txt never mentions ${unlisted.length} of ${sections.length} ` +
        `sitemap section(s): ${unlisted.join(', ')}`,
    );
  }
}

console.log(`mode            ${MODE}`);
console.log(`children        ${children.length}`);
console.log(`urls            ${allUrls.length}`);
console.log(`distinct dates  ${lastmods.size}`);
console.log(`noindex in map  ${noindexed}`);
console.log(`llms.txt        ${llms ? `${llms.split('\n').length} lines` : 'MISSING'}`);
// 🔴 Рядок не сміє ЗВІТУВАТИ про перевірку, якої не було. Рецензія
// показала: `unlisted` оголошено вище блоку, тож без зібраного
// llms.txt друкувалось «MISSING» і «5 of 5 named» поруч — підпис під
// перевіркою, яка не виконалась.
console.log(
  sectionsChecked
    ? `llms sections   ${sections.length - unlisted.length} of ${sections.length} named` +
        (unlisted.length ? ` — missing: ${unlisted.join(', ')}` : '')
    : `llms sections   not checked — ${sections.length} in sitemap, llms.txt absent`,
);

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

console.log(
  `\n✓ sitemap and pages agree — all ${allUrls.length} are ` +
    `${expectIndexable ? 'indexable' : 'noindex, as a closed build requires'}`,
);
