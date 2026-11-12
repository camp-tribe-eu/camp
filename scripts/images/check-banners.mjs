// CAMP-469 guard: every generated banner exists, has the ratio its slot
// needs, is webp (not png), stays under its weight budget, and has a
// record in docs/image-sources.md with its prompt and seed.
//
//   node scripts/images/check-banners.mjs
//   node scripts/images/check-banners.mjs --self-test
//
// 🔴 AND the other half of the promise: if public/banners holds any raster
// file (.webp/.jpg/.jpeg/.png/.avif), the text of llms.txt must carry the
// sentence that the decorative banners are generated and show no real
// place. Otherwise the next person removes the line or adds a picture and
// the site states something untrue, silently. This reads the route's
// source with its string concatenations joined, not the served file: the
// e2e test in tests/e2e/sitemap.spec.ts reads the served one.
import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IMAGES } from './generate-banners.mjs';
import { chooseAction } from '../lib/entrypoint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'apps/web/public/banners');
const LLMS = path.join(root, 'apps/web/src/app/llms.txt/route.ts');
const RASTER = /\.(webp|jpe?g|png|avif)$/i;
// The first four had hand-drawn .svg placeholders that stay as fallback; the
// four added on 12.11.2026 never had one.
const FALLBACK_SVG = ['eu-dawn', 'about', 'camper', 'tent'];
const BUDGET = 200 * 1024; // per file (raised from 160 for the forest-track banner, 12.11.2026)
const TOTAL_BUDGET = 700 * 1000; // 12.11.2026: eight images; was 400 000 for the first four

/** Raster files in a directory listing. */
export function rastersIn(names) {
  return names.filter((n) => RASTER.test(n));
}

/** The route's source with `"a" +\n "b"` joined, so a sentence is one string. */
export function joinedText(src) {
  // 🔴 Comments first: the route's own comment names these three words, and
  // a guard satisfied by a comment is satisfied by nothing a reader sees.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/["'`]\s*\+\s*["'`]/g, '');
}

/** True when ONE pushed line (bullet) says: decorative, AI-generated, no real place. */
export function hasBannerDisclosure(src) {
  const bullets = joinedText(src).split(/["'`]\s*,?\s*\)\s*;?/);
  return bullets.some((t) => /decorative/i.test(t) && /AI-generated/i.test(t) && /no real place/i.test(t));
}

/** Problems with the pairing of rasters and the disclosure; empty means fine. */
export function disclosureProblems(names, llmsSrc) {
  const r = rastersIn(names);
  if (r.length && !hasBannerDisclosure(llmsSrc))
    return [`public/banners holds ${r.join(', ')} but llms.txt has no sentence that the decorative banners are AI-generated and show no real place`];
  return [];
}

async function live() {
  const doc = readFileSync(path.join(root, 'docs/image-sources.md'), 'utf8');
  const sharp = createRequire(import.meta.url)('sharp');
  const problems = [];
  let total = 0;
  for (const img of IMAGES) {
    const file = path.join(dir, `${img.name}.webp`);
    if (!existsSync(file)) { problems.push(`${img.name}: no .webp`); continue; }
    const m = await sharp(file).metadata();
    if (m.format !== 'webp') problems.push(`${img.name}: format is ${m.format}`);
    if (m.width !== img.width || m.height !== img.height)
      problems.push(`${img.name}: ${m.width}x${m.height}, expected ${img.width}x${img.height}`);
    const size = statSync(file).size;
    total += size;
    if (size > BUDGET) problems.push(`${img.name}: ${size} bytes > budget ${BUDGET}`);
    if (FALLBACK_SVG.includes(img.name) && !existsSync(path.join(dir, `${img.name}.svg`))) problems.push(`${img.name}: fallback .svg is gone`);
    // The record must carry THIS image's prompt and seed, not just its name.
    if (!doc.includes(img.prompt)) problems.push(`${img.name}: prompt in docs/image-sources.md differs from the script`);
    if (!doc.includes(`seed ${img.seed}`)) problems.push(`${img.name}: seed ${img.seed} not recorded`);
  }
  if (total > TOTAL_BUDGET) problems.push(`total ${total} bytes > ${TOTAL_BUDGET}`);
  // The disclosure that these are AI-generated and not photographs of a place.
  if (!/NOT photographs of any place/.test(doc)) problems.push('docs/image-sources.md lost the AI-generated disclosure');
  // 🔴 Every raster in the folder, not only our four: a fifth must be covered too.
  problems.push(...disclosureProblems(readdirSync(dir), readFileSync(LLMS, 'utf8')));
  if (problems.length) { console.error(problems.join('\n')); return 1; }
  console.log(`ok: ${IMAGES.length} banners checked, ${total} bytes`);
  return 0;
}

function selfTest() {
  const cases = [];
  const is = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) console.error(`✗ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    cases.push(ok);
  };
  // The real route, then mutated: the guard must go red on exactly the edits
  // a careless change would make.
  const real = readFileSync(LLMS, 'utf8');
  const withRaster = ['a.svg', 'eu-dawn.webp'];
  is('real route carries the disclosure', hasBannerDisclosure(real), true);
  is('real route with rasters is fine', disclosureProblems(withRaster, real).length, 0);
  const cut = real.replace(/no real place/g, 'a place');
  is('disclosure removed + raster present = red', disclosureProblems(withRaster, cut).length, 1);
  is('word AI-generated dropped = red', disclosureProblems(withRaster, real.replace(/and AI-generated/, 'and made')).length, 1);
  is('word decorative dropped = red', disclosureProblems(withRaster, real.replace(/The decorative banners/, 'The banners')).length, 1);
  is('new .jpg added, text without disclosure = red', disclosureProblems(['a.svg', 'x.jpg'], cut).length, 1);
  is('new .png added, text without disclosure = red', disclosureProblems(['x.png'], cut).length, 1);
  is('new .avif added, text without disclosure = red', disclosureProblems(['x.avif'], cut).length, 1);
  is('only svg, no disclosure = fine (nothing to disclose)', disclosureProblems(['a.svg'], cut).length, 0);
  // The three words in different bullets must not add up to a disclosure.
  const split = 'lines.push("- the decorative thing.",\n);\nlines.push("- AI-generated stuff.",\n);\nlines.push("- no real place here.",\n);';
  is('words spread over three bullets = red', disclosureProblems(['x.webp'], split).length, 1);
  is('rasters recognised', rastersIn(['a.svg', 'b.WEBP', 'c.jpeg', 'd.png', 'e.avif', 'f.webp.txt']), ['b.WEBP', 'c.jpeg', 'd.png', 'e.avif']);
  is('disclosure only in a comment = red',
    disclosureProblems(['x.webp'], '// The decorative banners are AI-generated and show no real place.\nlines.push("- hi.");').length, 1);
  const EXPECTED = 12;
  let rc = cases.some((c) => !c) ? 1 : 0;
  if (cases.length !== EXPECTED) { console.error(`✗ ran ${cases.length} cases, expected ${EXPECTED}`); rc = 1; }
  if (rc === 0) console.log(`✓ check-banners self-test: ${cases.length} cases`);
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

if (invokedDirectly) {
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'check-banners.mjs');
  if (action.has('--self-test')) process.exit(selfTest());
  process.exit(await live());
}
