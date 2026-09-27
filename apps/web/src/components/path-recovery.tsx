'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Place } from '@/lib/api';

// CAMP-73: work out what the reader was probably looking for.
//
// 🔴 A client component, because Next gives `not-found.tsx` no access to
// the requested path. That is not a workaround around a limitation so
// much as the only honest place for it: the 404 itself is produced and
// cached as one static document for every dead URL on the site, so
// anything specific to the URL has to be worked out in the browser.
//
// 🔴 The places are FETCHED, from a static file on our own site, and
// were a prop until CAMP-143 measured what that prop cost.
//
// The old note here said: "A 404 page that fetches from the API is a
// 404 page that breaks precisely when things are already going wrong."
// That rule is right and is kept — /data/places.json is not the API. It
// is a static document built at build time from the same getPlaces(),
// so it is there whether or not the backend is.
//
// What the prop cost, measured 27.09.2026 on the production build:
// Next serialises the not-found boundary into the flight payload of
// EVERY statically generated page, so the 27 countries and 800 regions
// sat in all 65 435 of them — 47 919 bytes, 37% of a 126 512-byte page.
// One file, fetched once and cached, replaces 65 435 uncacheable copies.
//
// 🔴 And it is fetched only when the path could possibly match. Three
// quarters of dead URLs are not /camping/... at all, and those readers
// should not pull 41 KB to be told nothing.

interface Guess {
  country?: Place;
  region?: Place['regions'][number];
  /** The slug that did not match anything, for saying so out loud. */
  missing?: string;
}

/** `/camping/si/radovljica/some-camp` → what of that we recognise. */
export function readPath(path: string, places: Place[]): Guess {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'camping') return {};

  const country = places.find((p) => p.country === parts[1]?.toLowerCase());
  if (!country) return {};

  const region = country.regions.find(
    (r) => r.slug === parts[2]?.toLowerCase(),
  );
  return { country, region, missing: parts[3] ?? parts[2] };
}

export default function PathRecovery() {
  // 🔴 Resolved in an effect, not during render. The page is prerendered
  // on the server where there is no location, and reading it during
  // render would make the server and client markup disagree — React
  // then throws away the whole tree, which on a 404 page means the
  // reader sees a flash of nothing.
  const [guess, setGuess] = useState<Guess | null>(null);
  useEffect(() => {
    const path = window.location.pathname;
    // Nothing to recover unless the URL is shaped like a campsite one.
    // readPath would return {} for these anyway; this just declines to
    // pay 41 KB to find that out.
    if (path.split('/').filter(Boolean)[0] !== 'camping') return;

    let alive = true;
    fetch('/data/places.json')
      .then((r) => (r.ok ? (r.json() as Promise<Place[]>) : null))
      .then((places) => {
        // 🔴 Silence on failure, deliberately. This block is a bonus on
        // top of a page that already works: the country hubs, the search
        // box and the apology below are all server-rendered. A 404 that
        // announces a second failure helps nobody.
        if (alive && places) setGuess(readPath(path, places));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!guess?.country) return null;

  const { country, region } = guess;

  return (
    <div className="mt-8 rounded-card border border-line-2 bg-surface p-5">
      <h2 className="text-lg font-bold text-heading">
        You were probably looking for {region ? region.name : country.name}
      </h2>
      <p className="mt-2 text-sm text-ink-2">
        {region
          ? `That campsite is not one we hold, but we have ${region.spots} in ${region.name}.`
          : `That address does not match a campsite we hold. Here is everything we have in ${country.name}.`}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {region && (
          <Link
            href={`/camping/${country.country}/${region.slug}`}
            className="inline-flex h-9 items-center rounded-sm border border-line-blue bg-accent-surface px-3 text-sm font-semibold text-heading"
          >
            {region.name} · {region.spots}
          </Link>
        )}
        <Link
          href={`/camping/${country.country}`}
          className="inline-flex h-9 items-center rounded-sm border border-line-2 bg-surface px-3 text-sm text-heading hover:border-line-blue"
        >
          All of {country.name}
        </Link>
      </div>
    </div>
  );
}
