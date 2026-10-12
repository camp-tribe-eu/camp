import { NextResponse, type NextRequest } from 'next/server';
import GONE_PATHS from '@/generated/gone-paths.json';
import SPOT_REDIRECTS from '@/generated/spot-redirects.json';

// 🔴 CAMP-284: NOTHING IN THIS REPOSITORY DEPLOYS THIS FILE.
//
// Measured on 12.10.2026, after a `next build` of this app:
//
//     .next/server/middleware-manifest.json   1 entry, matcher ^/.*$
//     .next/server/middleware.js              1 575 362 B   (378 222 gz)
//     .next/server/edge-runtime-webpack.js       44 654 B     (8 601 gz)
//     src/generated/spot-redirects.json       4 455 rules, 420 858 B
//
// So the build DOES emit an edge function over every path. What is
// missing is everything that would run it:
//
//   * `next.config.mjs` has no `output: 'export'`, so the build leaves
//     `.next/` and no `out/` — there is no directory of static files to
//     upload to Pages in the first place;
//   * there is no `@cloudflare/next-on-pages`, no wrangler config and
//     no `pages:build` script anywhere in the repository;
//   * no workflow deploys anything: `grep -rl 'deploy\|wrangler\|cloudflare'
//     .github/workflows/` is empty.
//
// Cloudflare's own Next.js guide (fetched 12.10.2026) points Pages at
// static exports and says full-stack features "including server-side
// rendering, React Server Components, Server Actions, route handlers,
// and middleware" belong on Workers. The neighbouring comment in
// scripts/security-headers.mjs — "Cloudflare Pages serves the built
// files and never runs Next's headers()" — is the same observation from
// the other side.
//
// 🔴 AND `_redirects` CANNOT HOLD THIS. Cloudflare documents the Pages
// `_redirects` file as "limited to 2,000 static redirects and 100
// dynamic redirects, for a combined total of 2,100", with no support
// for 404 or 410. We have 4 455 redirects — 2.1× the ceiling — and the
// 410 list has no expression in that format at all.
//
// This file is therefore correct and unreachable until somebody decides
// where the site runs. That decision costs money and an account, so it
// is the owner's; the numbers above are what it should be decided with.
// Until then, every 301 and every 410 written here is a promise the
// project has not yet been able to keep.

// CAMP-73 — 410 Gone for campsites OpenStreetMap has dropped.
//
// 🔴 Why this needs middleware at all. Every campsite page is
// prerendered, so a removed campsite simply stops being built and its
// URL falls through to the 404. That is not wrong, but it is weaker than
// it should be: Google treats a 404 as possibly temporary and keeps
// recrawling the URL for months, while a 410 says "gone on purpose" and
// drops it far sooner. With a weekly import we will produce a steady
// trickle of these, and we would rather spend crawl budget on campsites
// that exist.
//
// 🔴 Why the body is fetched rather than written here. Middleware runs
// on the edge runtime and cannot render React, so the alternative was a
// second copy of the page as a string in this file — which would drift
// from the real one the first time anybody changed the design. Instead
// the prerendered /gone document is fetched and returned under a 410.
// These requests are rare by definition: one per dead URL a crawler
// still remembers.

const GONE = new Set(GONE_PATHS as string[]);

// CAMP-144 — 301 for a campsite that is now shown on another page.
//
// 🔴 Two sources described one campsite and we published both. The rows
// are still there and neither was deleted: the other page carries the
// contacts from one and the official star rating from the other, so this
// URL's content did not disappear, it moved. 301 is the only status that
// says that — a 404 would discard whatever the URL had earned, and the
// 410 above would tell a crawler a business that is open has closed.
//
// 🔴 Checked BEFORE the gone list, not after. A campsite cannot honestly
// be both, but if a bug ever put one in both lists, "it moved here" is
// the answer that loses nothing, and "it is gone for ever" is the one
// that cannot be taken back out of an index.
const REDIRECTS = new Map<string, string>(
  Object.entries(SPOT_REDIRECTS as Record<string, string>),
);

export function middleware(request: NextRequest) {
  // Trailing slashes and casing both reach us from old links and from
  // crawlers, and neither should decide whether a URL is gone.
  const pathname = request.nextUrl.pathname.replace(/\/+$/, '').toLowerCase();

  const moved = REDIRECTS.get(pathname);
  if (moved) {
    // 🔴 The query string is carried across. A reader arriving from a
    // shared link with `?from=map` should land where they were going
    // with what they were carrying; dropping it is a silent data loss
    // that only shows up as a broken referrer report weeks later.
    const target = new URL(moved, request.nextUrl.origin);
    target.search = request.nextUrl.search;
    return NextResponse.redirect(target, 301);
  }

  if (!GONE.has(pathname)) return NextResponse.next();

  return serveGone(request);
}

async function serveGone(request: NextRequest) {
  const url = new URL('/gone', request.nextUrl.origin);
  const res = await fetch(url, { headers: { 'x-ct-gone': '1' } });

  // If even that cannot be fetched, a bare 410 is still the right answer
  // — the status is the part search engines act on, and a plain body
  // beats a 500 that says nothing.
  if (!res.ok) {
    return new NextResponse('This campsite is no longer listed.', {
      status: 410,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return new NextResponse(await res.text(), {
    status: 410,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // 🔴 Never cached at the edge under the campsite's own URL. The
      // /gone body is identical for every gone campsite and the reader's
      // browser fills in which one from the path, so a cached copy is
      // harmless — but a stale one would keep answering 410 after the
      // campsite came back, and objects deleted from OSM by mistake do
      // come back.
      'cache-control': 'no-store',
    },
  });
}

export const config = {
  // Only campsite URLs can be gone, and keeping the matcher narrow means
  // the middleware never runs for assets, the sitemap or the map data.
  matcher: ['/camping/:path*'],
};
