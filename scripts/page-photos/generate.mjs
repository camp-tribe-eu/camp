#!/usr/bin/env node
// Generates page photos from targets.json with FAL (FLUX.1 Krea [dev]),
// writes apps/web/public/photos/<kind>/<slug>.webp and records prompt, seed
// and model in apps/web/src/data/page-photos.json — the attribution page
// promises "we keep the prompt and the seed of every image on record".
//
// Idempotent: an image already in the manifest is skipped. Run:
//   FAL_KEY=… node scripts/page-photos/generate.mjs [kind ...]
//
// Cost guard: stops before spending more than MAX_USD (default 8).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const TARGETS = path.join(ROOT, 'scripts/page-photos/targets.json');
const MANIFEST = path.join(ROOT, 'apps/web/src/data/page-photos.json');
const OUT = path.join(ROOT, 'apps/web/public/photos');
const MODEL = 'fal-ai/flux/krea';
const W = 1600, H = 896; // 1.43 MP × $0.025/MP ≈ $0.036 per image (pricing read 17.11.2026)
const COST = (W * H / 1e6) * 0.025;
const MAX_USD = Number(process.env.MAX_USD ?? 8);
const KEY = process.env.FAL_KEY;
if (!KEY) { console.error('FAL_KEY missing'); process.exit(2); }

const kinds = process.argv.slice(2);
const targets = JSON.parse(readFileSync(TARGETS, 'utf8')).filter((t) => !kinds.length || kinds.includes(t.kind));
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const save = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');

let spent = 0, made = 0, failed = 0;
async function one(t) {
  if (manifest[t.kind]?.[t.slug]) return;
  if (spent + COST > MAX_USD) throw new Error(`budget ${MAX_USD} USD reached`);
  spent += COST;
  const res = await fetch(`https://fal.run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: t.prompt, image_size: { width: W, height: H }, num_inference_steps: 28, enable_safety_checker: true }),
  });
  if (!res.ok) { failed++; console.error(`✗ ${t.kind}/${t.slug}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); return; }
  const d = await res.json();
  const img = d.images?.[0];
  if (!img?.url || d.has_nsfw_concepts?.[0]) { failed++; console.error(`✗ ${t.kind}/${t.slug}: no image`); return; }
  const raw = Buffer.from(await (await fetch(img.url)).arrayBuffer());
  const dir = path.join(OUT, t.kind);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${t.slug}.webp`);
  await sharp(raw).resize({ width: 1440 }).webp({ quality: 74 }).toFile(file);
  (manifest[t.kind] ??= {})[t.slug] = {
    src: `/photos/${t.kind}/${t.slug}.webp`,
    alt: t.alt,
    model: MODEL,
    seed: d.seed,
    prompt: t.prompt,
    generated: new Date().toISOString().slice(0, 10),
  };
  save();
  made++;
  console.log(`✓ ${t.kind}/${t.slug} seed=${d.seed}`);
}

// Four at a time: fast enough, gentle on the API.
const queue = [...targets];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const t = queue.shift();
    try { await one(t); } catch (e) { console.error(String(e)); queue.length = 0; }
  }
}));
console.log(`made ${made}, failed ${failed}, spent ≈ $${spent.toFixed(2)}`);
process.exit(failed ? 1 : 0);
