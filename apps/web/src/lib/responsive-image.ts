import VARIANTS from "@/data/image-variants.json";

/**
 * `srcset` for our own pictures (scripts/images/make-variants.mjs).
 *
 * 🔴 A phone must not download the desktop file. Measured 17.11.2026: every
 * page photo was one 1600px webp (~224 kB) sent to a 375px screen — the
 * page's LCP image, 4× the pixels it can show. Each picture under /photos
 * and /banners now has 640 and 1024 versions; the browser picks by `sizes`.
 *
 * A src that is not ours (a CMS file through /media/…, an owner's upload)
 * has no entry and gets no srcset: plain `src`, as before.
 */
const TABLE = VARIANTS as unknown as Record<string, Array<[string, number]>>;

export function srcSetFor(src: string | undefined | null): string | undefined {
  if (!src) return undefined;
  const set = TABLE[src];
  if (!set || set.length < 2) return undefined;
  return set.map(([url, w]) => `${url} ${w}w`).join(", ");
}

/** `sizes` for the four slots. One place, so a layout change is one edit. */
export const SIZES = {
  /** Full-width banner / hero (container caps at 1704px). */
  full: "(min-width: 1760px) 1704px, 100vw",
  /** Two cards side by side from 768px. */
  half: "(min-width: 768px) 50vw, 100vw",
  /** Box banner: the picture takes most of the row on a desktop. */
  wide: "(min-width: 768px) 66vw, 100vw",
} as const;
