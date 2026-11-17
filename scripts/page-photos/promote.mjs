#!/usr/bin/env node
// Promotes CHOSEN generated images into the site.
//
// The process (17.11.2026, after the first Krea batch was 43% defective):
//   1. prompts.py — one prompt per country / route / topic, written to rules:
//      at most one vehicle, parked, whole; tents only on campsites; no text;
//   2. three candidates each from Seedream 5.5 (fal.run);
//   3. a written checklist review (vehicle anatomy, traffic law, scale,
//      bodies, lettering, geography) by an inspector, then by me at full size;
//   4. the owner approves; only then this script runs.
//
// Usage: node scripts/page-photos/promote.mjs <chosen.json>
//   chosen.json: [{ "kind", "slug", "file", "prompt", "alt" }]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const MANIFEST = path.join(ROOT, 'apps/web/src/data/page-photos.json');
const OUT = path.join(ROOT, 'apps/web/public/photos');
const MODEL = 'bytedance/seedream/v5.5';

const chosen = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const manifest = {};
for (const c of chosen) {
  mkdirSync(path.join(OUT, c.kind), { recursive: true });
  await sharp(c.file).resize({ width: 1600 }).webp({ quality: 78 }).toFile(path.join(OUT, c.kind, `${c.slug}.webp`));
  (manifest[c.kind] ??= {})[c.slug] = {
    src: `/photos/${c.kind}/${c.slug}.webp`,
    alt: c.alt,
    model: MODEL,
    prompt: c.prompt,
    generated: '2026-11-17',
  };
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
console.log(`${chosen.length} pictures promoted`);
