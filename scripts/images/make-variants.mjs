#!/usr/bin/env node
// Responsive sizes for our own pictures (owner, 17.11.2026: «оптимізував
// контент?» — measured: one 1600px file, ~224 kB, sent to a 375px phone).
//
// For every <name>.webp under apps/web/public/photos/** and
// apps/web/public/banners/ (the full-size file stays as it is), writes
// <name>-640.webp and <name>-1024.webp next to it when the original is wider
// than that, and records them in apps/web/src/data/image-variants.json:
//   { "/photos/country/fr.webp": [["/photos/country/fr-640.webp", 640], …, ["/photos/country/fr.webp", 1600]] }
// Components turn that into `srcset`; a src not in the file gets no srcset.
//
//   node scripts/images/make-variants.mjs [--recompress-from <chosen.json>]
//
// --recompress-from: re-encode the page photos from their source JPEGs at
// PHOTO_QUALITY instead of re-encoding an already compressed webp.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pub = path.join(root, 'apps/web/public');
const OUT = path.join(root, 'apps/web/src/data/image-variants.json');
const sharp = createRequire(import.meta.url)('sharp');

export const WIDTHS = [640, 1024];
export const PHOTO_WIDTH = 1600;
export const PHOTO_QUALITY = 62;
const VARIANT = /-(\d+)\.webp$/;

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

async function main() {
  const at = process.argv.indexOf('--recompress-from');
  if (at > 0) {
    const chosen = JSON.parse(readFileSync(process.argv[at + 1], 'utf8'));
    for (const c of chosen) {
      const file = path.join(pub, 'photos', c.kind, `${c.slug}.webp`);
      await sharp(c.file).resize({ width: PHOTO_WIDTH }).webp({ quality: PHOTO_QUALITY, effort: 6 }).toFile(file);
    }
    console.log(`recompressed ${chosen.length} page photos at q${PHOTO_QUALITY}`);
  }
  const files = [...walk(path.join(pub, 'photos')), ...walk(path.join(pub, 'banners'))]
    .filter((f) => f.endsWith('.webp') && !VARIANT.test(f));
  const out = {};
  for (const f of files.sort()) {
    const { width } = await sharp(f).metadata();
    const url = '/' + path.relative(pub, f).split(path.sep).join('/');
    const set = [];
    for (const w of WIDTHS) {
      if (w >= width) continue;
      const v = f.replace(/\.webp$/, `-${w}.webp`);
      await sharp(f).resize({ width: w }).webp({ quality: 66, effort: 6 }).toFile(v);
      set.push([url.replace(/\.webp$/, `-${w}.webp`), w]);
    }
    set.push([url, width]);
    out[url] = set;
  }
  writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`${files.length} pictures, variants recorded in ${path.relative(root, OUT)}`);
}
if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
