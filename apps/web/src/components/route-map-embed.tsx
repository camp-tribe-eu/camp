'use client';

import dynamic from 'next/dynamic';
import type { RouteMapProps } from './route-map';

// The client-side boundary around the route map.
//
// 🔴 This file exists because of a framework rule, not a preference.
// Next 15 refuses `ssr: false` inside a Server Component — the build
// fails outright — so the dynamic import has to live in a Client
// Component. The route page itself stays a Server Component, which is
// what keeps the stage list, the campsite links and the structured data
// in the HTML for readers and crawlers that do not run JavaScript.
//
// 🔴 `ssr: false` is not optional either. MapLibre reaches for `window`
// and a WebGL canvas the moment it is imported, so rendering it on the
// server throws during prerender and takes the whole page down.
const RouteMap = dynamic(() => import('./route-map'), {
  ssr: false,
  loading: () => (
    <div className="mt-3 flex h-[46vh] min-h-[320px] w-full items-center justify-center rounded-card border border-line-2 bg-surface text-sm text-ink-2">
      Loading the map…
    </div>
  ),
});

export default function RouteMapEmbed(props: RouteMapProps) {
  return <RouteMap {...props} />;
}
