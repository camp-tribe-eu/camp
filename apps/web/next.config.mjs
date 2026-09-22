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
  async headers() {
    if (isPublic) return [];
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
