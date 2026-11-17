import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "@playwright/test";

import VARIANTS from "@/data/image-variants.json";
import { LayeredBanner } from "@/components/layered-banner";
import { PhotoFrame } from "@/components/photo-frame";
import { srcSetFor } from "@/lib/responsive-image";

/**
 * 🔴 A phone must not download the desktop picture (owner, 17.11.2026).
 * Every picture of ours has 640 and 1024 versions on disk, recorded in the
 * manifest, and each size stays inside its weight budget — the budget is
 * what keeps the LCP image small, so it is a test, not a hope.
 */
const PUB = path.join(process.cwd(), "public");
const table = VARIANTS as unknown as Record<string, Array<[string, number]>>;
const BUDGET: Record<number, number> = { 640: 60_000, 1024: 120_000 };
const FULL_BUDGET = 240_000;

const ours = ["photos", "banners"].flatMap((d) => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return walk(path.join(PUB, d))
    .filter((f) => f.endsWith(".webp") && !/-\d+\.webp$/.test(f))
    .map((f) => "/" + path.relative(PUB, f).split(path.sep).join("/"));
});

test("every picture of ours is in the manifest with 640, 1024 and its full size, all on disk", () => {
  expect(ours.length, "no pictures found — the check saw nothing").toBeGreaterThan(40);
  for (const src of ours) {
    const set = table[src];
    expect(set, `${src} has no variants — run scripts/images/make-variants.mjs`).toBeTruthy();
    expect(set.map(([, w]) => w).slice(0, 2), src).toEqual([640, 1024]);
    for (const [url] of set) expect(existsSync(path.join(PUB, url)), url).toBe(true);
  }
});

test("🔴 weight budget: 640 ≤ 60 kB, 1024 ≤ 120 kB, full ≤ 240 kB", () => {
  for (const src of ours) {
    for (const [url, w] of table[src]) {
      const size = statSync(path.join(PUB, url)).size;
      const limit = BUDGET[w] ?? FULL_BUDGET;
      expect(size, `${url} (${w}px)`).toBeLessThanOrEqual(limit);
    }
  }
});

test("🔴 the banner and the photo frame send srcset and sizes; a foreign src gets none", () => {
  const src = "/photos/country/fr.webp";
  const banner = renderToStaticMarkup(createElement(LayeredBanner, { background: { src }, tickerText: "F", heading: "H" }));
  expect(banner).toContain(`srcSet="${srcSetFor(src)}"`);
  expect(banner).toMatch(/sizes="[^"]+"/);
  expect(banner).toContain("/photos/country/fr-640.webp 640w");
  const frame = renderToStaticMarkup(createElement(PhotoFrame, { image: { src: "/photos/route/andalusia-in-winter.webp", alt: "" } }));
  expect(frame).toContain("andalusia-in-winter-640.webp 640w");
  expect(srcSetFor("/media/photo/route-hero?f=1")).toBeUndefined();
});

test("🔴 a country page with a generated photo shares it: og:image is its 1024px file, which exists", async () => {
  const { shareImage, pagePhoto } = await import("@/lib/page-photos");
  const m = shareImage(pagePhoto("country", "fr"), "Campsites in France", "d");
  const url = (m.openGraph?.images?.[0] as { url: string }).url;
  expect(url).toBe("/photos/country/fr-1024.webp");
  expect(existsSync(path.join(PUB, url))).toBe(true);
  expect(m.openGraph?.siteName).toBe("CampTribe");
  expect(shareImage(null, "t")).toEqual({});
});
