'use client';

import { useEffect, useState } from 'react';
import SiteSearch from './site-search';

// CAMP-67: the client boundary for the search box.
//
// 🔴 Its own file for the same reason map-embed.tsx exists: /search is a
// Server Component so that the country list under the box survives with
// JavaScript switched off, and Next 15 will not allow a client-only
// concern to be expressed inside one.
//
// 🔴 The initial query is read from the URL here rather than through
// `useSearchParams`. The page is prerendered as static HTML; reading
// search params through the router would opt the whole route into
// dynamic rendering, and there is nothing on it that needs a server.

export default function SearchEmbed() {
  const [initial, setInitial] = useState<string | null>(null);

  useEffect(() => {
    setInitial(new URLSearchParams(window.location.search).get('q') ?? '');
  }, []);

  // Until the URL has been read there is nothing honest to render: an
  // empty box would flash before a shared link's query appeared in it.
  if (initial === null) {
    return (
      <div
        aria-hidden="true"
        className="h-11 w-full rounded-sm border border-line-2 bg-surface-2"
      />
    );
  }

  return <SiteSearch initialQuery={initial} />;
}
