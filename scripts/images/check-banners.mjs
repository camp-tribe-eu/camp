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
const SELF = fileURLToPath(import.meta.url);
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

// 🔴 CAMP-498, hole 2. The attribution page says every generated picture
// was made "from a text prompt alone: no photograph or other picture was
// supplied". That is the most expensive sentence on it — a supplied picture
// carries somebody else's rights — and until 18.11.2026 nothing held it:
// adding `image_url` to the request body left every check green.
//
// So: every script under scripts/ that mentions fal.run must not put an
// input-image field in what it sends. The list is explicit on purpose —
// these are the names fal's image-to-image and edit endpoints take. A new
// name is added here, not guessed at by a looser pattern: `image_size` and
// reading `body.images` from the RESPONSE are legitimate and must stay green.
export const INPUT_IMAGE_FIELDS = [
  'image_url', 'image_urls', 'image', 'init_image', 'input_image',
  'control_image', 'reference_image', 'reference_images', 'mask_url',
  'style_image', 'style_image_url', 'subject_image',
];

/** Input-image fields used as an object key in this source (comments ignored). */
export function inputImageFields(src) {
  const code = joinedText(src).replace(/^\s*#.*$/gm, ''); // python comments too
  return INPUT_IMAGE_FIELDS.filter((f) =>
    new RegExp(`(^|[\\s{,(])["']?${f}["']?\\s*[:=]`, 'm').test(code));
}

/** Every script file under `dir` that mentions fal.run. */
export function falScripts(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...falScripts(p));
    // This file names the forbidden fields in its own self-test.
    else if (p === SELF) continue;
    else if (/\.(m?js|ts|py)$/.test(e.name) && readFileSync(p, 'utf8').includes('fal.run')) out.push(p);
  }
  return out;
}

export function inputImageProblems(files, read = (f) => readFileSync(f, 'utf8')) {
  // A guard that found no generator checks nothing — the banner script must be among them.
  if (!files.some((f) => f.endsWith(path.join('images', 'generate-banners.mjs'))))
    return ['no fal.run generator found under scripts/ — the text-prompt-only check is checking nothing'];
  return files.flatMap((f) => inputImageFields(read(f)).map((field) =>
    `${path.relative(root, f)}: sends "${field}" — the attribution page says pictures are made from a text prompt alone`));
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
    // A model that returns no seed (Seedream) is recorded as such, not left blank.
    // Read THIS image's own section: a phrase present under another image
    // must not satisfy it (mutation 17.11.2026 passed without this).
    const head = `### ${img.name}.webp`;
    const at = doc.indexOf(head);
    const next = at < 0 ? -1 : doc.indexOf('\n### ', at + head.length);
    const section = at < 0 ? '' : doc.slice(at, next < 0 ? undefined : next);
    if (img.seed == null ? !section.includes('seed: none returned by the model')
                         : !doc.includes(`seed ${img.seed}`))
      problems.push(`${img.name}: seed ${img.seed ?? 'none'} not recorded`);
  }
  if (total > TOTAL_BUDGET) problems.push(`total ${total} bytes > ${TOTAL_BUDGET}`);
  // The disclosure that these are AI-generated and not photographs of a place.
  if (!/NOT photographs of any place/.test(doc)) problems.push('docs/image-sources.md lost the AI-generated disclosure');
  // 🔴 Every raster in the folder, not only our four: a fifth must be covered too.
  problems.push(...disclosureProblems(readdirSync(dir), readFileSync(LLMS, 'utf8')));
  const gens = falScripts(path.join(root, 'scripts'));
  problems.push(...inputImageProblems(gens));
  if (problems.length) { console.error(problems.join('\n')); return 1; }
  console.log(`ok: ${IMAGES.length} banners checked, ${total} bytes; ${gens.length} fal.run script(s) send no input image`);
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
  // CAMP-498: text prompt only — the real generator, then mutated.
  const genFile = path.join(root, 'scripts/images/generate-banners.mjs');
  const gen = readFileSync(genFile, 'utf8');
  is('real generator sends no input image', inputImageFields(gen), []);
  is('image_url added to the body = red',
    inputImageFields(gen.replace('prompt: img.prompt,', 'prompt: img.prompt,\n      image_url: img.src,')), ['image_url']);
  is('quoted "init_image" (python/json) = red', inputImageFields('payload = {"prompt": p, "init_image": u}'), ['init_image']);
  is('image_size and reading body.images stay green', inputImageFields('{ image_size: s }\nconst u = body.images?.[0];'), []);
  is('field only in a comment = green', inputImageFields('// image_url: never sent\n# "image_url": no'), []);
  is('problem names the file and field',
    inputImageProblems([genFile], () => 'x = { image_url: u }'),
    ['scripts/images/generate-banners.mjs: sends "image_url" — the attribution page says pictures are made from a text prompt alone']);
  is('no generator found = red, not silence', inputImageProblems([]).length, 1);
  const EXPECTED = 19;
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
