// CAMP-469: decorative images for the site, generated through FAL.
//
//   FAL_KEY=... node scripts/images/generate-banners.mjs [--only=eu-dawn,tent] [--dry-run]
//
// The key comes ONLY from the FAL_KEY environment variable. It is never
// read from a file in this repository and never written to one.
//
// 🔴 What these images may show: a tent, a road, a forest, a night sky, a
// camper, gear, an abstract dawn. NEVER a recognisable country, city,
// mountain or landmark. The site prints "No stock photography and no
// AI-generated images of places nobody has visited"; a generated view of a
// real place would break that sentence. Every prompt therefore names the
// subject and forbids a place. Read the output with your eyes before you
// commit it.
//
// Output: apps/web/public/banners/<name>.webp. The old .svg files stay as
// the fallback and as evidence of what was there before.
// docs/image-sources.md records, per image, the model, prompt, seed, size.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../apps/web/public/banners');
const MODEL = 'fal-ai/flux/schnell';

// Delivered size is what the slot needs: 1920px for the wide banners (the
// container is 1704px), 1200px for the square cards. FAL rounds each side
// to a multiple of 16 (1920x1080 came back 1920x1072), so the result is
// cropped to the exact ratio with sharp's `cover`, a sub-1% resample.
const NO_PLACE =
  'generic anonymous landscape, no recognisable place, no landmark, no buildings, no text, no letters, no logos, no people';
const STYLE =
  'soft painterly flat illustration, muted palette, calm, plenty of empty space for a headline, low contrast';

export const IMAGES = [
  {
    name: 'eu-dawn',
    width: 1920, height: 1080, seed: 4690001, quality: 72,
    prompt: `Abstract dawn over a gentle dark treeline, a single small tent silhouette at the horizon, sky fading from deep blue to warm peach, ${STYLE}, ${NO_PLACE}`,
  },
  {
    name: 'about',
    width: 1920, height: 840, seed: 4690002, quality: 72,
    prompt: `Quiet night sky full of stars above a dark forest edge, a faint glow from a small camp fire far away, deep navy and slate tones, ${STYLE}, ${NO_PLACE}`,
  },
  {
    name: 'camper',
    width: 1200, height: 1200, seed: 4690003, quality: 74,
    prompt: `A small simple camper van parked on an empty country road among green fields and trees, golden morning light, side view, ${STYLE}, ${NO_PLACE}`,
  },
  {
    name: 'tent',
    width: 1200, height: 1200, seed: 4690004, quality: 74,
    prompt: `A lone dome tent on a grassy clearing at dusk, warm light glowing inside, pine forest behind, first stars, ${STYLE}, ${NO_PLACE}`,
  },
];

async function generate(img, key) {
  const res = await fetch(`https://fal.run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: img.prompt,
      image_size: { width: img.width, height: img.height },
      num_inference_steps: 4,
      num_images: 1,
      seed: img.seed,
      enable_safety_checker: true,
      output_format: 'png',
    }),
  });
  if (!res.ok) throw new Error(`${img.name}: FAL answered ${res.status}`);
  const body = await res.json();
  const url = body.images?.[0]?.url;
  if (!url) throw new Error(`${img.name}: no image in the FAL answer`);
  const png = Buffer.from(await (await fetch(url)).arrayBuffer());
  return { png, got: body.images[0], seed: body.seed };
}

async function main() {
  const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
  const dry = process.argv.includes('--dry-run');
  const list = IMAGES.filter((i) => !only.length || only.includes(i.name));
  if (dry) { console.log(JSON.stringify(list, null, 2)); return; }
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY is not set');
  const sharp = createRequire(import.meta.url)('sharp');
  mkdirSync(OUT, { recursive: true });
  for (const img of list) {
    const { png, got, seed } = await generate(img, key);
    const webp = await sharp(png).resize(img.width, img.height, { fit: 'cover' }).webp({ quality: img.quality, effort: 6 }).toBuffer();
    const file = path.join(OUT, `${img.name}.webp`);
    writeFileSync(file, webp);
    const meta = await sharp(webp).metadata();
    console.log(`${img.name}: fal ${got.width}x${got.height} -> ${meta.width}x${meta.height}, ${webp.length} bytes, seed ${seed}`);
  }
}
if (existsSync(process.argv[1] ?? '') && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
