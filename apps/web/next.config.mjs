import { SECURITY_HEADERS } from './scripts/security-headers.mjs';

/** @type {import('next').NextConfig} */

// CAMP-90: `X-Robots-Tag` at the transport level, not only in a meta tag.
//
// 🔴 A meta tag lives inside HTML. It does nothing for the sitemap XML,
// llms.txt, the woff2 fonts, or any JSON or PDF we ever serve — and
// those get indexed too. The header covers every response regardless of
// content type, which is the whole reason the card asks for it.
//
// This path covers a Node runtime (`next start`, and our own checks).
// Cloudflare Pages serves static files and ignores it, so the same
// directive is also written into `public/_headers` by
// scripts/gen-headers.mjs before every build. Two mechanisms, one
// source of truth in src/lib/environment.ts — and the pre-launch
// checker verifies both agree.

const isPublic = process.env.NEXT_PUBLIC_SITE_MODE === 'public';

const nextConfig = {
  // 🔴 Do not announce the framework. It tells an attacker which
  // advisory list to read and tells a reader nothing.
  poweredByHeader: false,

  images: {
    // 🔴 Off, because we do not use it and it is the one endpoint in a
    // Next server that decodes attacker-supplied binary.
    //
    // /_next/image exists whether or not the app renders <Image>: it
    // answered requests here before this line, and it is the route
    // behind the AVIF/libheif remote-code-execution advisory
    // (GHSA-2xp9-vwfh-vxw4). We ship no images, so switching it off
    // costs nothing and removes the surface rather than relying on
    // "nobody points it at an image".
    unoptimized: true,
  },

  async headers() {
    const headers = Object.entries(SECURITY_HEADERS).map(([key, value]) => ({
      key,
      value,
    }));
    if (!isPublic) {
      headers.push({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
    }
    // 🔴 The security headers are NOT conditional on the build mode.
    // They were, in effect, before this: the only `headers()` entry was
    // the robots one, so a public build sent no security headers at all
    // from `next start` — the mode that will one day be production.
    return [{ source: '/:path*', headers }];
  },
};

export default nextConfig;
