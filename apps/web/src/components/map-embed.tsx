'use client';

import dynamic from 'next/dynamic';

// The client-side boundary around the map.
//
// 🔴 This file exists because of a rule, not a preference. Next 15
// refuses `ssr: false` in `next/dynamic` inside a Server Component —
// the build fails outright — so the dynamic import has to live in a
// Client Component. /map stays a Server Component, which is what keeps
// its country list, heading and structured data in the HTML for readers
// and crawlers without JavaScript.
//
// 🔴 `ssr: false` itself is not optional. MapLibre reaches for `window`
// and a WebGL canvas the moment it is imported; rendering it on the
// server throws during prerender and takes the whole page with it —
// which is the same failure CAMP-32 fixed on the browser side for
// missing WebGL.
const CampsiteMap = dynamic(() => import('@/components/campsite-map'), {
  ssr: false,
  loading: () => (
    <div className="mt-3 flex h-[60vh] min-h-[360px] w-full items-center justify-center rounded-card border border-line-2 bg-surface text-sm text-ink-2">
      Loading the map…
    </div>
  ),
});

export default function MapEmbed() {
  return <CampsiteMap />;
}
