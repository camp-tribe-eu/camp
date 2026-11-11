# Image sources and rights (CAMP-469)

The card says: no image without a record of its source and rights. This
file is that record for the four decorative images in
`apps/web/public/banners/`. There is no public page of image credits yet;
until there is one, this file is the only place the record lives.

## What these images are, and are not

Decorative, generated, **showing no real place**. The site prints "No stock
photography and no AI-generated images of places nobody has visited". These
four show a tent, a road, a forest, a night sky, a camper and an abstract
dawn. None of them is a photograph and none claims to be a place. They must
never be captioned, alt-texted or described as a real location.

## Common to all four

| | |
|---|---|
| Generator | FAL, model `fal-ai/flux/schnell` (FLUX.1 [schnell], 4 steps) |
| Model licence | Apache-2.0 (read from the model's Hugging Face API record, 11.11.2026; fal.ai's model page states commercial use) |
| Rights in the output | no third-party source image, no photograph, no author to credit. We hold the output as the party that ran the generation; FAL's terms govern the service |
| Reproduce | `FAL_KEY=... node scripts/images/generate-banners.mjs` (prompts and seeds live in that script) |
| Guard | `node scripts/images/check-banners.mjs` |
| Generated | 11.11.2026 |

The same seed and prompt are recorded below, but a hosted model can change
under the same name; regenerating later may give a different picture.

## Per image

### eu-dawn.webp
- Slot: page banner background, 16:9. Delivered 1920x1080.
- Prompt: Abstract dawn over a gentle dark treeline, a single small tent silhouette at the horizon, sky fading from deep blue to warm peach, soft painterly flat illustration, muted palette, calm, plenty of empty space for a headline, low contrast, generic anonymous landscape, no recognisable place, no landmark, no buildings, no text, no letters, no logos, no people
- seed 4690001
- Shows: orange dawn glow, smooth anonymous hills, dark conifer silhouettes, a tiny tent shape at the horizon.

### about.webp
- Slot: `/about` background and About banner, 16:7. Delivered 1920x840.
- Prompt: Quiet night sky full of stars above a dark forest edge, a faint glow from a small camp fire far away, deep navy and slate tones, soft painterly flat illustration, muted palette, calm, plenty of empty space for a headline, low contrast, generic anonymous landscape, no recognisable place, no landmark, no buildings, no text, no letters, no logos, no people
- seed 4690002
- Shows: starry navy sky, a low distant ridge, tree line, one small camp fire, a bare tree at the right.

### camper.webp
- Slot: "Rent a camper" card, 1:1. Delivered 1200x1200.
- Prompt: A small simple camper van parked on an empty country road among green fields and trees, golden morning light, side view, soft painterly flat illustration, muted palette, calm, plenty of empty space for a headline, low contrast, generic anonymous landscape, no recognisable place, no landmark, no buildings, no text, no letters, no logos, no people
- seed 4690003
- Shows: a cream-and-green camper van on a straight empty road, fields, a leafy tree, utility poles, hazy hills.

### tent.webp
- Slot: "Find a campsite" card, 1:1. Delivered 1200x1200.
- Prompt: A lone dome tent on a grassy clearing at dusk, warm light glowing inside, pine forest behind, first stars, soft painterly flat illustration, muted palette, calm, plenty of empty space for a headline, low contrast, generic anonymous landscape, no recognisable place, no landmark, no buildings, no text, no letters, no logos, no people
- seed 4690004
- Shows: a lit dome tent in a dark meadow, spruce forest behind, dusk sky with stars.

## Not in scope here

The `.svg` files next to the `.webp` files are the previous hand-drawn
placeholders. They are kept as the fallback and as evidence of what was
there. Switching the components from `.svg` to `.webp` is a separate change
in `src/components` and `src/app`.
