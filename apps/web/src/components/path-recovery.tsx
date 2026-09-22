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
// The places come in as a prop, rendered into the page at build time.
// A 404 page that fetches from the API is a 404 page that breaks
// precisely when things are already going wrong.

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

export default function PathRecovery({ places }: { places: Place[] }) {
  // 🔴 Resolved in an effect, not during render. The page is prerendered
  // on the server where there is no location, and reading it during
  // render would make the server and client markup disagree — React
  // then throws away the whole tree, which on a 404 page means the
  // reader sees a flash of nothing.
  const [guess, setGuess] = useState<Guess | null>(null);
  useEffect(() => {
    setGuess(readPath(window.location.pathname, places));
  }, [places]);

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
