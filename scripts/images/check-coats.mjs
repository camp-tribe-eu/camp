// CAMP-441 guard: the coats of arms we serve are exactly the ones we
// recorded, every one of them is Public domain or CC0, and none carries
// script. Also: llms.txt says what the emblems are whenever there is one.
//
//   node scripts/images/check-coats.mjs
//   node scripts/images/check-coats.mjs --self-test
//
// 🔴 It reads the files ON DISK and the manifest, not the fetcher's rules:
// a file dropped into public/coats/ by hand, or a licence edited in the
// manifest, never passed through the fetcher at all.
import { readFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';
import { isCleanLicense, svgProblems, stem, NOT_THIS_REGIONS_ARMS } from './coats-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(root, 'apps/web/public/coats');
const MANIFEST = path.join(root, 'apps/web/src/data/coats.json');
const REGIONS = path.join(root, 'scripts/images/coat-regions.json');
const LLMS = path.join(root, 'apps/web/src/app/llms.txt/route.ts');
const SOURCES_ROUTE = path.join(root, 'apps/web/src/app/coats/sources.json/route.ts');
const MAX_BYTES = 64 * 1024;
// EU-27 plus Åland (a Finnish region with its own ISO code); never Cyprus (CAMP-490).
const COUNTRIES = new Set(('AT BE BG HR CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE AX').split(' '));

/**
 * Problems with a set of files and a manifest; empty means fine.
 * `files` = { name: Buffer|string }, `manifest` = parsed coats.json,
 * `known` = the set of ISO codes the site can show (coat-regions.json).
 */
export function coatProblems(files, manifest, known) {
  const out = [];
  const referenced = new Set();
  for (const [iso, e] of Object.entries(manifest)) {
    const at = `${iso}:`;
    if (!/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(iso) || !COUNTRIES.has(iso.slice(0, 2))) out.push(`${at} not an EU-27 ISO 3166-2 code`);
    else if (known && !known.has(iso)) out.push(`${at} no region of the site has this code`);
    if (NOT_THIS_REGIONS_ARMS[iso]) out.push(`${at} is on the list of files that are not this region's arms`);
    if (!isCleanLicense(e.license)) out.push(`${at} licence "${e.license}" is not Public domain or CC0`);
    if (!/^https:\/\/commons\.wikimedia\.org\/wiki\/File:\S+$/.test(e.source ?? '')) out.push(`${at} source is not a Commons file page`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.checkedOn ?? '')) out.push(`${at} checkedOn is not a date`);
    if (!(e.author === null || typeof e.author === 'string')) out.push(`${at} author must be text or null`);
    const m = /^\/coats\/([^/]+)$/.exec(e.file ?? '');
    if (!m) { out.push(`${at} file "${e.file}" is not under /coats/`); continue; }
    if (m[1] !== `${stem(iso)}.svg` && m[1] !== `${stem(iso)}.png`) out.push(`${at} file name ${m[1]} is not ${stem(iso)}.svg|png`);
    referenced.add(m[1]);
    if (!(m[1] in files)) out.push(`${at} ${m[1]} is in the manifest but not in public/coats/`);
  }
  for (const [name, body] of Object.entries(files)) {
    if (!referenced.has(name)) out.push(`${name}: in public/coats/ but not in the manifest`);
    const size = Buffer.byteLength(body);
    if (size > MAX_BYTES) out.push(`${name}: ${size} bytes > ${MAX_BYTES}`);
    if (name.endsWith('.svg')) for (const p of svgProblems(String(body))) out.push(`${name}: ${p}`);
    else if (!name.endsWith('.png')) out.push(`${name}: neither .svg nor .png`);
  }
  return out;
}

/** The disclosure half: with any coat served, llms.txt must say what they are and where the sources are. */
export function disclosureProblems(count, llmsSrc, routeSrc) {
  if (count === 0) return [];
  const out = [];
  const text = llmsSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/["'`]\s*\+\s*["'`]/g, '');
  if (!/coats? of arms/i.test(text) || !/public domain/i.test(text) || !/\/coats\/sources\.json/.test(text))
    out.push('llms.txt has no sentence that region emblems are public-domain coats of arms with sources at /coats/sources.json');
  if (!routeSrc) out.push('app/coats/sources.json/route.ts is missing');
  return out;
}

function live() {
  const files = {};
  for (const n of readdirSync(DIR)) if (!n.startsWith('.')) files[n] = readFileSync(path.join(DIR, n));
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const known = new Set(Object.keys(JSON.parse(readFileSync(REGIONS, 'utf8')).regions));
  const problems = coatProblems(files, manifest, known);
  // A guard that looked at nothing says nothing: an empty folder with an empty manifest is a deleted feature.
  if (Object.keys(files).length === 0) problems.push('public/coats/ is empty — the guard is checking nothing');
  let route = null;
  try { route = readFileSync(SOURCES_ROUTE, 'utf8'); } catch { /* reported below */ }
  problems.push(...disclosureProblems(Object.keys(files).length, readFileSync(LLMS, 'utf8'), route));
  if (problems.length) { console.error(problems.join('\n')); return 1; }
  const bytes = Object.keys(files).reduce((a, n) => a + statSync(path.join(DIR, n)).size, 0);
  console.log(`ok: ${Object.keys(files).length} coats, ${bytes} bytes, all Public domain or CC0, all in the manifest`);
  return 0;
}

function selfTest() {
  const cases = [];
  const is = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) console.error(`✗ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    cases.push(ok);
  };
  const entry = (iso, ext = 'svg', over = {}) => ({
    file: `/coats/${stem(iso)}.${ext}`, license: 'Public domain',
    source: 'https://commons.wikimedia.org/wiki/File:X.svg', author: null, checkedOn: '2026-11-20', ...over,
  });
  const SVG = '<svg><path d="M0 0"/></svg>';
  const known = new Set(['HR-01', 'SI-001']);
  const base = () => ({ files: { 'hr-01.svg': SVG }, manifest: { 'HR-01': entry('HR-01') } });
  const run = (f, m, k = known) => coatProblems(f, m, k);
  let b = base();
  is('consistent set is fine', run(b.files, b.manifest), []);
  b = base(); b.files['stray.svg'] = SVG;
  is('stray file in the folder = red', run(b.files, b.manifest).length, 1);
  b = base(); delete b.files['hr-01.svg'];
  is('manifest entry without a file = red', run(b.files, b.manifest).length, 1);
  b = base(); b.manifest['HR-01'].license = 'CC BY-SA 4.0';
  is('CC BY-SA licence = red', run(b.files, b.manifest).length, 1);
  b = base(); b.manifest['HR-01'].license = 'CC0';
  is('CC0 is fine', run(b.files, b.manifest), []);
  b = base(); b.files['hr-01.svg'] = '<svg><script>alert(1)</script></svg>';
  is('script in an SVG = red', run(b.files, b.manifest).length, 1);
  b = base(); b.files['hr-01.svg'] = '<svg onload="x()"><path/></svg>';
  is('event handler in an SVG = red', run(b.files, b.manifest).length, 1);
  b = base(); b.files['hr-01.svg'] = '<svg><image href="https://evil.example/a.png"/></svg>';
  is('external href in an SVG = red', run(b.files, b.manifest).length, 1);
  b = base(); b.manifest['HR-01'].source = 'https://example.com/x';
  is('source that is not Commons = red', run(b.files, b.manifest).length, 1);
  b = base(); b.manifest['CY-01'] = entry('CY-01'); b.files['cy-01.svg'] = SVG;
  is('Cyprus coat = red', run(b.files, b.manifest, new Set([...known, 'CY-01'])).length, 1);
  b = base(); b.manifest['GR-J'] = entry('GR-J'); b.files['gr-j.svg'] = SVG;
  is('a known wrong shield = red', run(b.files, b.manifest, new Set([...known, 'GR-J'])).length, 1);
  b = base(); b.manifest['HR-01'].file = '/elsewhere/hr-01.svg';
  is('file outside /coats/ = red', run(b.files, b.manifest).length >= 1, true);
  b = base(); b.files['hr-01.svg'] = SVG + ' '.repeat(MAX_BYTES);
  is('over the byte budget = red', run(b.files, b.manifest).length, 1);
  b = base();
  is('code no region uses = red', run(b.files, b.manifest, new Set(['SI-001'])).length, 1);
  const real = readFileSync(LLMS, 'utf8');
  const route = 'export const dynamic = "force-static";';
  is('real llms.txt says it', disclosureProblems(1, real, route), []);
  is('sentence cut = red', disclosureProblems(1, real.replace(/coats? of arms/gi, 'pictures'), route).length, 1);
  is('route missing = red', disclosureProblems(1, real, null).length, 1);
  is('no coats, nothing to disclose', disclosureProblems(0, 'x', null), []);
  const EXPECTED = 18;
  let rc = cases.some((c) => !c) ? 1 : 0;
  if (cases.length !== EXPECTED) { console.error(`✗ ran ${cases.length} cases, expected ${EXPECTED}`); rc = 1; }
  if (rc === 0) console.log(`✓ check-coats self-test: ${cases.length} cases`);
  return rc;
}

const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
})();

if (invokedDirectly) {
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'check-coats.mjs');
  if (action.has('--self-test')) process.exit(selfTest());
  process.exit(live());
}
