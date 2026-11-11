// CAMP-469 guard: every generated banner exists, has the ratio its slot
// needs, is webp (not png), stays under its weight budget, and has a
// record in docs/image-sources.md with its prompt and seed.
//
//   node scripts/images/check-banners.mjs
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGES } from './generate-banners.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'apps/web/public/banners');
const doc = readFileSync(path.join(root, 'docs/image-sources.md'), 'utf8');
const sharp = createRequire(import.meta.url)('sharp');
const BUDGET = 160 * 1024; // per file
const TOTAL_BUDGET = 400 * 1000; // owner's cap for all four, 11.11.2026
let total = 0;
const problems = [];

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
  if (!existsSync(path.join(dir, `${img.name}.svg`))) problems.push(`${img.name}: fallback .svg is gone`);
  // The record must carry THIS image's prompt and seed, not just its name.
  if (!doc.includes(img.prompt)) problems.push(`${img.name}: prompt in docs/image-sources.md differs from the script`);
  if (!doc.includes(`seed ${img.seed}`)) problems.push(`${img.name}: seed ${img.seed} not recorded`);
}
if (total > TOTAL_BUDGET) problems.push(`total ${total} bytes > ${TOTAL_BUDGET}`);
// The disclosure that these are AI-generated and not photographs of a place.
if (!/NOT photographs of any place/.test(doc)) problems.push('docs/image-sources.md lost the AI-generated disclosure');
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`ok: ${IMAGES.length} banners checked, ${total} bytes`);
