// CAMP-441: coats of arms for the region cards.
//
//   node scripts/images/fetch-coats.mjs            # fetch, write files + manifest
//   node scripts/images/fetch-coats.mjs --self-test
//
// What it does, in order:
//   1. reads scripts/images/coat-regions.json (ISO 3166-2 → region we show);
//   2. asks Wikidata for each code's coat of arms (P300 → P94);
//   3. asks Commons for each file's licence and restrictions (50 per call);
//   4. keeps ONLY files that are Public domain or CC0 with NO restriction
//      value (see coats-lib.mjs), SVG or a PNG <= 64 KB, and SVGs that pass
//      the sanitiser;
//   5. writes apps/web/public/coats/<iso>.<svg|png> and
//      apps/web/src/data/coats.json, and removes files it no longer lists.
//
// 🔴 NEVER DRAWS ONE. A region with no clean file gets none, and the card
// shows the country flag. A made-up coat on a real region is a false
// official symbol (owner, 20.11.2026).
//
// coat-regions.json comes from production (SELECT only):
//   with r as (select distinct upper(country) c, region from camping_spots
//              where region is not null and missing_since is null)
//   select n.iso_3166_2, r.c, r.region from r join ne_admin1 n
//     on n.name = r.region and n.iso_a2 = r.c where n.iso_3166_2 <> ''
//   -- then dropped: Cyprus (unpublished), a code shared by two region
//   -- names, a name with two codes (the API returns null for those too).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';
import { rejectReason, plainText, svgProblems, stem, NOT_THIS_REGIONS_ARMS } from './coats-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REGIONS = path.join(root, 'scripts/images/coat-regions.json');
const OUT_DIR = path.join(root, 'apps/web/public/coats');
const MANIFEST = path.join(root, 'apps/web/src/data/coats.json');
const UA = 'CampTribeResearch/1.0 (https://camptribe.eu)';
const PNG_MAX = 64 * 1024;
const SVG_MAX = 64 * 1024;
const BATCH = 50;
const SLEEP_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, init = {}, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers ?? {}) } });
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 4000 * 2 ** i;
      console.error(`  ${res.status} on ${url.slice(0, 80)}… waiting ${wait} ms`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res;
  }
  throw new Error(`gave up after ${tries} tries: ${url}`);
}

/** Wikidata: ISO code → [{ item, file }] (best-rank P94 values only). */
async function wikidata(codes) {
  const found = new Map();
  for (let i = 0; i < codes.length; i += 100) {
    const vals = codes.slice(i, i + 100).map((c) => `"${c}"`).join(' ');
    const q = `SELECT ?iso ?item ?coa WHERE { VALUES ?iso { ${vals} } ?item wdt:P300 ?iso . ?item wdt:P94 ?coa }`;
    const res = await get('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q),
      { headers: { Accept: 'application/sparql-results+json' } });
    for (const b of (await res.json()).results.bindings) {
      const file = decodeURIComponent(b.coa.value.split('/Special:FilePath/')[1] ?? '').replace(/_/g, ' ');
      if (!file) continue;
      const list = found.get(b.iso.value) ?? [];
      list.push({ item: b.item.value, file });
      found.set(b.iso.value, list);
    }
    await sleep(SLEEP_MS);
  }
  return found;
}

/** Commons: title → { license, restr, mime, size, url, author, source }. */
async function commons(titles) {
  const meta = new Map();
  for (let i = 0; i < titles.length; i += BATCH) {
    const batch = titles.slice(i, i + BATCH).map((t) => 'File:' + t);
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1' +
      '&prop=imageinfo&iiprop=extmetadata|mime|size|url&titles=' + encodeURIComponent(batch.join('|'));
    const data = await (await get(url)).json();
    const back = new Map();
    for (const r of data.query.redirects ?? []) back.set(r.to, r.from);
    for (const n of data.query.normalized ?? []) back.set(n.to, n.from);
    for (const p of data.query.pages) {
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      const m = ii.extmetadata ?? {};
      const row = {
        license: m.LicenseShortName?.value ?? null,
        restr: m.Restrictions?.value ?? '',
        mime: ii.mime, size: ii.size, url: ii.url,
        author: plainText(m.Artist?.value),
        source: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(p.title.replace(/ /g, '_')).replace(/%3A/g, ':'),
      };
      let t = p.title;
      meta.set(t.replace(/^File:/, ''), row);
      // The file may have been asked for under a redirect's or an unnormalised name.
      for (let k = 0; k < 3 && back.has(t); k++) { t = back.get(t); meta.set(t.replace(/^File:/, ''), row); }
    }
    await sleep(SLEEP_MS);
  }
  return meta;
}

async function main() {
  const input = JSON.parse(readFileSync(REGIONS, 'utf8'));
  const codes = Object.keys(input.regions).sort();
  const today = new Date().toISOString().slice(0, 10);
  console.log(`${codes.length} region codes; country prefixes: ${[...new Set(codes.map((c) => c.slice(0, 2)))].join(' ')}`);

  const wd = await wikidata(codes);
  const skipped = [];
  const chosen = new Map(); // iso → file title
  for (const iso of codes) {
    const list = wd.get(iso) ?? [];
    const files = [...new Set(list.map((x) => x.file))];
    if (files.length === 0) skipped.push([iso, 'no coat on Wikidata (P94)']);
    else if (files.length > 1) skipped.push([iso, `ambiguous: ${files.length} coat files for ${list.length} item(s)`]);
    else chosen.set(iso, files[0]);
  }
  console.log(`${chosen.size} codes have exactly one P94 file`);

  const meta = await commons([...new Set(chosen.values())]);
  mkdirSync(OUT_DIR, { recursive: true });
  const manifest = {};
  const keep = new Set();
  for (const [iso, title] of [...chosen].sort()) {
    if (NOT_THIS_REGIONS_ARMS[iso]) { skipped.push([iso, `not this region's arms: ${NOT_THIS_REGIONS_ARMS[iso]}`]); continue; }
    const m = meta.get(title);
    if (!m) { skipped.push([iso, `Commons has no record of ${title}`]); continue; }
    const why = rejectReason(m.license, m.restr);
    if (why) { skipped.push([iso, why]); continue; }
    const ext = m.mime === 'image/svg+xml' ? 'svg' : m.mime === 'image/png' ? 'png' : null;
    if (!ext) { skipped.push([iso, `format ${m.mime}`]); continue; }
    if (ext === 'png' && m.size > PNG_MAX) { skipped.push([iso, `PNG ${m.size} bytes > ${PNG_MAX}`]); continue; }
    const bytes = Buffer.from(await (await get(m.url)).arrayBuffer());
    if (bytes.length > (ext === 'png' ? PNG_MAX : SVG_MAX)) { skipped.push([iso, `${ext.toUpperCase()} ${bytes.length} bytes > ${PNG_MAX}`]); continue; }
    if (ext === 'svg') {
      const bad = svgProblems(bytes.toString('utf8'));
      if (bad.length) { skipped.push([iso, `unsafe SVG: ${bad.join('; ')}`]); continue; }
    }
    writeFileSync(path.join(OUT_DIR, `${stem(iso)}.${ext}`), bytes);
    keep.add(`${stem(iso)}.${ext}`);
    manifest[iso] = { file: `/coats/${stem(iso)}.${ext}`, license: m.license, source: m.source, author: m.author, checkedOn: today };
    await sleep(300);
  }
  for (const f of readdirSync(OUT_DIR)) if (!keep.has(f)) { unlinkSync(path.join(OUT_DIR, f)); console.log(`removed stale ${f}`); }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

  const perCountry = {};
  for (const iso of Object.keys(manifest)) perCountry[iso.slice(0, 2)] = (perCountry[iso.slice(0, 2)] ?? 0) + 1;
  console.log(`\nDOWNLOADED ${Object.keys(manifest).length} of ${codes.length}`);
  console.log('per country: ' + Object.entries(perCountry).sort().map(([c, n]) => `${c} ${n}/${codes.filter((x) => x.startsWith(c)).length}`).join(', '));
  const reasons = {};
  for (const [, r] of skipped) { const k = r.replace(/\d+/g, 'N').replace(/"[^"]*"/g, '"…"'); reasons[k] = (reasons[k] ?? 0) + 1; }
  console.log('skipped by reason:', JSON.stringify(reasons, null, 1));
  for (const [iso, r] of skipped) if (/PNG|SVG|unsafe|format|no record/.test(r)) console.log(`  skip ${iso}: ${r}`);
}

function selfTest() {
  let bad = 0;
  const is = (n, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { console.error(`✗ ${n}: ${JSON.stringify(got)}`); bad++; } };
  is('public domain, no restriction', rejectReason('Public domain', ''), null);
  is('CC0', rejectReason('CC0', ''), null);
  is('insignia rejects', rejectReason('Public domain', 'insignia') !== null, true);
  is('CC BY-SA rejects', rejectReason('CC BY-SA 4.0', '') !== null, true);
  is('author html → text', plainText('<a href="x">Jane &amp; Co</a>'), 'Jane & Co');
  is('svg with script rejected', svgProblems('<svg><script>1</script></svg>').length > 0, true);
  is('clean svg', svgProblems('<svg><path d="M0 0"/></svg>'), []);
  if (!bad) console.log('✓ fetch-coats self-test: 7 cases');
  return bad ? 1 : 0;
}

const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
})();

if (invokedDirectly) {
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'fetch-coats.mjs');
  if (action.has('--self-test')) process.exit(selfTest());
  await main();
}
