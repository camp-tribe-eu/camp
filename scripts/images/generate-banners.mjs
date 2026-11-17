// CAMP-469: decorative images for the site, generated through FAL.
// Second pass: the owner asked for photographs, not illustrations.
//
//   FAL_KEY=... node scripts/images/generate-banners.mjs [--only=eu-dawn,tent] [--dry-run]
//
// The key comes ONLY from the FAL_KEY environment variable. It is never
// read from a file in this repository and never written to one.
//
// 🔴 17.11.2026 (owner: photos everywhere, «wow»): these may show the kind
// of landscape a section is about and people, but never a NAMED campsite
// or company. Rules for every prompt: at most a few whole, parked
// vehicles; tents only inside a campsite; no lettering. The old rule
// below applied to the first (FLUX) set and is kept for the record:
// NEVER a recognisable country, city, mountain or landmark. The site prints "No stock photography and no
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
const MODEL = 'bytedance/seedream/v5.5/text-to-image';
// Seedream takes a size, not an aspect name; ~2 MP at the slot's ratio.
const SIZE = { '16:9': [2048, 1152], '21:9': [2688, 1152], '1:1': [2048, 2048] };

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

// 17.11.2026, second redo (owner: «примітивні … вау ефекту немає»): Seedream 5.5,
// three candidates each, picked after a checklist review; the model returns
// no seed, so  and the record says so. The FLUX ultra set they
// replace is listed under «Replaced» in docs/image-sources.md.
export const IMAGES = [
  {
    name: 'eu-dawn', aspect: '16:9',
    width: 1920, height: 1080, seed: null, quality: 56,
    prompt: "A wide view at first light over a lakeside campsite in the Alps of Europe: mist lifting off a calm lake, the first sun touching snowy peaks, a few tents and two campervans small on the terraced meadow of the campsite at the right, one person with a mug standing by the shore. Sense of a whole continent waking up to go camping. Editorial travel photograph for the cover of a European outdoor magazine: real, unstaged, shot on a full-frame camera with a 24-35mm lens, natural light with real depth and atmosphere, rich but true colours, fine natural grain, no HDR, no glossy plastic look. Leave a calm, uncluttered area in the left half of the frame for a headline. Every vehicle whole, correctly built and parked; tents only inside a campsite; people small, natural, not posing; no lettering, logos, signs or number plates anywhere.",
  },
  {
    name: 'about', aspect: '21:9',
    width: 1920, height: 840, seed: null, quality: 56,
    prompt: "Blue hour at a small European campsite on a meadow above a valley: a group of five friends of different ages and backgrounds sit around a campfire in a proper stone fire ring, faces lit warmly, tents and one campervan softly lit behind them inside the campsite, the last light on the mountains. Togetherness, honest and quiet. Editorial travel photograph for the cover of a European outdoor magazine: real, unstaged, shot on a full-frame camera with a 24-35mm lens, natural light with real depth and atmosphere, rich but true colours, fine natural grain, no HDR, no glossy plastic look. Leave a calm, uncluttered area in the left half of the frame for a headline. Every vehicle whole, correctly built and parked; tents only inside a campsite; people small, natural, not posing; no lettering, logos, signs or number plates anywhere.",
  },
  {
    name: 'camper', aspect: '1:1',
    width: 1200, height: 1200, seed: null, quality: 50,
    prompt: "Golden evening on a hedged grass pitch of a campsite in Provence: a white 2010s Fiat Ducato motorhome with its awning out, a table set with bread, cheese and a bottle of rosé, two folding chairs, lavender rows and a hilltop village glowing in the background. Inviting, the feeling of a holiday that has just begun. Editorial travel photograph for the cover of a European outdoor magazine: real, unstaged, shot on a full-frame camera with a 24-35mm lens, natural light with real depth and atmosphere, rich but true colours, fine natural grain, no HDR, no glossy plastic look. Leave a calm, uncluttered area in the left half of the frame for a headline. Every vehicle whole, correctly built and parked; tents only inside a campsite; people small, natural, not posing; no lettering, logos, signs or number plates anywhere.",
  },
  {
    name: 'tent', aspect: '1:1',
    width: 1200, height: 1200, seed: null, quality: 56,
    prompt: "Blue hour on the tent meadow of a lakeside campsite in Scandinavia: a green dome tent glowing warm from a lantern inside, two camping chairs and a small stove in front, other tents faintly lit further along inside the campsite, a still lake reflecting the last light and dark pine forest. Calm and magical but real. Editorial travel photograph for the cover of a European outdoor magazine: real, unstaged, shot on a full-frame camera with a 24-35mm lens, natural light with real depth and atmosphere, rich but true colours, fine natural grain, no HDR, no glossy plastic look. Leave a calm, uncluttered area in the left half of the frame for a headline. Every vehicle whole, correctly built and parked; tents only inside a campsite; people small, natural, not posing; no lettering, logos, signs or number plates anywhere.",
  },
  {
    name: 'guides', aspect: '16:9',
    width: 1920, height: 1080, seed: null, quality: 56,
    prompt: "Morning on a campsite pitch by a lake in the Dolomites: on a weathered wooden camping table, an open paper road map of Europe, a well-used guidebook without readable text, a pencil, a steaming enamel mug and sunglasses; behind, out of focus, the open side door of a campervan and pale mountains. The joy of planning the next stop. Editorial travel photograph for the cover of a European outdoor magazine: real, unstaged, shot on a full-frame camera with a 24-35mm lens, natural light with real depth and atmosphere, rich but true colours, fine natural grain, no HDR, no glossy plastic look. Leave a calm, uncluttered area in the left half of the frame for a headline. Every vehicle whole, correctly built and parked; tents only inside a campsite; people small, natural, not posing; no lettering, logos, signs or number plates anywhere.",
  },
  {
    name: 'routes', aspect: '16:9',
    width: 1920, height: 1080, seed: null, quality: 52,
    prompt: "Sunrise high on an Alpine pass: a long ribbon of empty mountain road with many hairpin bends winding down a green valley, low clouds in the valley below, jagged peaks catching first light. No vehicles. Grand scale, the promise of a road trip. Editorial travel photograph for the cover of a European outdoor magazine: real, unstaged, shot on a full-frame camera with a 24-35mm lens, natural light with real depth and atmosphere, rich but true colours, fine natural grain, no HDR, no glossy plastic look. Leave a calm, uncluttered area in the left half of the frame for a headline. Every vehicle whole, correctly built and parked; tents only inside a campsite; people small, natural, not posing; no lettering, logos, signs or number plates anywhere.",
  },
  {
    name: 'tools', aspect: '16:9',
    width: 1920, height: 1080, seed: null, quality: 50,
    prompt: "Early morning at a campsite in the Black Forest: a couple in their thirties sits on the step of their campervan's open sliding door going through a printed packing list and checking a small gas bottle and a water container on the grass; folding table with a kettle, fir trees and soft mist behind. Practical preparation, warm and human. Editorial travel photograph for the cover of a European outdoor magazine: real, unstaged, shot on a full-frame camera with a 24-35mm lens, natural light with real depth and atmosphere, rich but true colours, fine natural grain, no HDR, no glossy plastic look. Leave a calm, uncluttered area in the left half of the frame for a headline. Every vehicle whole, correctly built and parked; tents only inside a campsite; people small, natural, not posing; no lettering, logos, signs or number plates anywhere.",
  },
  {
    name: 'lake', aspect: '16:9',
    width: 1920, height: 1080, seed: null, quality: 50,
    prompt: "Dawn on a calm Northern European lake: mist over the water, reeds and a wooden jetty in the foreground, birch and pine forest on the far shore, one canoe moored at the jetty, soft pink and gold light. Quiet and very real. Editorial travel photograph for the cover of a European outdoor magazine: real, unstaged, shot on a full-frame camera with a 24-35mm lens, natural light with real depth and atmosphere, rich but true colours, fine natural grain, no HDR, no glossy plastic look. Leave a calm, uncluttered area in the left half of the frame for a headline. Every vehicle whole, correctly built and parked; tents only inside a campsite; people small, natural, not posing; no lettering, logos, signs or number plates anywhere.",
  },
];

async function generate(img, key) {
  const res = await fetch(`https://fal.run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: img.prompt,
      image_size: { width: SIZE[img.aspect][0], height: SIZE[img.aspect][1] },
      num_images: 1,
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
