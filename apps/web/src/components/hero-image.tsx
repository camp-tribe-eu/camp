"use client";

import type { ImgHTMLAttributes } from "react";

/**
 * The page's main picture, loaded first (`fetchPriority="high"`).
 *
 * 🔴 WHY A CLIENT COMPONENT (18.11.2026, measured on prod): rendered from
 * a Server Component, a high-priority `<img>` becomes a preload hint in
 * the page's RSC payload too. Next prefetches every page the header links
 * to, the browser applies those hints, and a campsite page downloaded the
 * banners of all 26 country pages and the five hubs it never opened —
 * 33 pictures, in Chromium and WebKit alike. From here the preload is
 * written only into the HTML of the page that is actually open.
 *
 * Props are plain strings: the srcset is computed by the server caller,
 * so the variants manifest never ships to the browser.
 */
export function HeroImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return <img {...props} fetchPriority="high" />;
}
