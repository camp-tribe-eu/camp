import PHOTOS from "@/data/page-photos.json";

/**
 * Generated page photos (owner's decision 17.11.2026: «скрізь нагенерити
 * картинки, а я вже які не сподобаються поміняю»).
 *
 * 🔴 ORDER, everywhere: the owner's own picture from the CMS → the
 * generated picture of THIS page → the shared drawing. A generated picture
 * never hides one the owner has set.
 *
 * 🔴 NEVER FOR A CAMPSITE OR A BUSINESS. Kinds are landscapes of a country,
 * a route or a topic. A campsite page promises «no AI-generated images of
 * places nobody has visited», and a generated "photo" of a real business
 * would show it as something nobody photographed.
 *
 * 🔴 EVERY ONE IS LABELLED where it is shown (`ai: true` → «AI illustration»
 * on the picture): AI Act Art. 50(4) — an image resembling real places must
 * be disclosed as generated, at first sight, not on another page. Prompt,
 * and model of each are in `data/page-photos.json`, the full prompt set in
 * `scripts/page-photos/prompts-*.py` (`promote.mjs` writes the manifest).
 *
 * 🔴 ONE PICTURE PER COUNTRY, ROUTE AND TOPIC — owner, 17.11.2026, variant (b):
 * a region, a rental page and a provider show their COUNTRY's picture; a
 * region guide shows its TOPIC's. The first Krea batch (577 images, 43%
 * defective: vans on beaches, tents on roads) was thrown away; every picture
 * here passed a written checklist twice before it was kept.
 */
export type PagePhotoKind = "country" | "route" | "topic";

export interface PagePhoto {
  src: string;
  alt: string;
  ai: true;
}

type Entry = { src: string; alt: string };
const TABLE = PHOTOS as unknown as Partial<Record<PagePhotoKind, Record<string, Entry>>>;

export function pagePhoto(kind: PagePhotoKind, slug: string | null | undefined): PagePhoto | null {
  if (!slug) return null;
  const e = TABLE[kind]?.[slug.toLowerCase()];
  return e ? { src: e.src, alt: e.alt, ai: true } : null;
}

/** The label printed on every generated picture. One string, for the page and its tests. */
export const AI_LABEL = "AI illustration";

/**
 * Share picture for a page with a generated photo (og:image / twitter).
 *
 * Next REPLACES a parent's `openGraph` object instead of merging it, so the
 * page repeats the site name and type; title and description come from the
 * page. The 1024px version: ~60 kB is plenty for a preview card.
 */
export function shareImage(photo: PagePhoto | null, title: string, description?: string) {
  if (!photo) return {};
  const url = photo.src.replace(/\.webp$/, "-1024.webp");
  const images = [{ url, width: 1024, height: 576, alt: photo.alt }];
  return {
    openGraph: { type: "website" as const, siteName: "CampTribe", title, description, images },
    twitter: { card: "summary_large_image" as const, title, description, images: [url] },
  };
}
