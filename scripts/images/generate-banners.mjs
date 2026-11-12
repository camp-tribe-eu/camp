// CAMP-469: decorative images for the site, generated through FAL.
// Second pass: the owner asked for photographs, not illustrations.
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
const MODEL = 'fal-ai/flux-pro/v1.1-ultra';

// Delivered size is what the slot needs: 1920px for the wide banners (the
// container is 1704px), 1200px for the square cards. The model returns
// ~2-4 MP at its own aspect ratio (16:9, 21:9, 1:1); sharp's `cover` crops
// to the exact slot ratio and downsizes.
//
// 🔴 PHOTOREALISTIC means it reads as a real photograph of a real place.
// So every prompt forbids the things that pin a picture to a place or a
// person: country, mountain, city, landmark, sign, number plate, flag,
// text, people, brand marks. Look at every output before committing it,
// and look for objects floating without a shadow.
const NO_PLACE =
  'generic unremarkable landscape that cannot be tied to any country, no mountains, no landmark, no buildings, no signs, no text, no number plates, no license plate, no lettering, no emblems, no flags, no logos, no people';
const PHOTO = 'photograph, natural light, shot on a full-frame camera, 35mm lens, fine detail, editorial magazine quality';

export const IMAGES = [
  {
    name: 'eu-dawn', aspect: '16:9',
    width: 1920, height: 1080, seed: 4690011, quality: 62,
    prompt: `Misty flat meadow at first light, a single small green dome tent far in the middle distance with long soft shadow on the dewy grass, a line of deciduous trees on the horizon, pale pink and gold sky, wide empty sky above, ${PHOTO}, ${NO_PLACE}`,
  },
  {
    name: 'about', aspect: '21:9',
    width: 1920, height: 840, seed: 4690012, quality: 62,
    prompt: `Clear night sky with the Milky Way over a dark silhouetted pine forest edge and a quiet open field, long exposure astrophotography, deep blue tones, ${PHOTO}, ${NO_PLACE}`,
  },
  {
    name: 'camper', aspect: '1:1',
    width: 1200, height: 1200, seed: 4690043, quality: 66,
    prompt: `Telephoto photograph compressing a long straight empty country road lined with green fields, a small white camper van with a smooth blank rear, far down the road driving away from the camera along its own lane, seen from behind, the van occupies less than one tenth of the frame width, wheels on the asphalt with a short soft shadow under and beside it, warm low morning sun, ${PHOTO}, ${NO_PLACE}`,
  },
  {
    name: 'tent', aspect: '1:1',
    width: 1200, height: 1200, seed: 4690014, quality: 66,
    prompt: `A lone orange dome tent pitched on a grassy clearing at blue hour, warm light glowing from inside, guy lines pegged into the grass, tall spruce forest behind, first stars, ${PHOTO}, ${NO_PLACE}`,
  },
  {
    name: 'guides', aspect: '16:9',
    width: 1920, height: 1080, seed: 4690021, quality: 62,
    prompt: `Flat lay on a weathered wooden outdoor table in soft morning light, a closed plain linen-bound notebook with no cover text, a wooden pencil, a steaming plain enamel mug, grass softly blurred behind, shallow depth of field, ${PHOTO}, ${NO_PLACE}`,
  },
  {
    name: 'routes', aspect: '16:9',
    width: 1920, height: 1080, seed: 4690042, quality: 45,
    prompt: `Empty gravel track curving gently through a quiet pine forest in soft overcast light with light mist between the trunks, dense trees along both edges of the track, nothing on or beside the track, no benches, no bins, no objects, no vehicles, muted greens, ${PHOTO}, ${NO_PLACE}`,
  },
  {
    name: 'tools', aspect: '16:9',
    width: 1920, height: 1080, seed: 4690033, quality: 62,
    prompt: `Close photograph of camping gear on a canvas groundsheet in soft daylight, a dented plain steel kettle, coiled natural rope, a folded wool blanket, wooden tent pegs and a wooden mallet, no gas canister, no labels, plain unmarked objects, shallow depth of field, ${PHOTO}, ${NO_PLACE}`,
  },
  {
    name: 'lake', aspect: '16:9',
    width: 1920, height: 1080, seed: 4690024, quality: 62,
    prompt: `Calm lake at dawn with thin mist on the water, reeds in the foreground, low wooded shore with pines and birches on the far side, soft pastel sky reflected in still water, ${PHOTO}, ${NO_PLACE}`,
  },
];

async function generate(img, key) {
  const res = await fetch(`https://fal.run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: img.prompt,
      aspect_ratio: img.aspect,
      num_images: 1,
      seed: img.seed,
      raw: true,
      safety_tolerance: '2',
      enable_safety_checker: true,
      output_format: 'jpeg',
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
