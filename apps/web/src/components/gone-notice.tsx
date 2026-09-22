'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatDistance, type GoneSpot } from '@/lib/api';

// CAMP-73: which campsite the reader asked for, on a page that is served
// at that campsite's own address.
//
// 🔴 The browser's URL is still the old campsite URL — middleware
// returns this page's body there with a 410 status rather than
// redirecting, because a redirect would lose the fact that the object is
// gone. So the component can read the path and say which one it was.

export default function GoneNotice({ gone }: { gone: GoneSpot[] }) {
  const [spot, setSpot] = useState<GoneSpot | null>(null);
  useEffect(() => {
    const here = window.location.pathname.replace(/\/+$/, '');
    setSpot(gone.find((g) => g.path === here) ?? null);
  }, [gone]);

  if (!spot) return null;

  return (
    <div className="mt-8 rounded-card border border-line-2 bg-surface p-5">
      <h2 className="text-lg font-bold text-heading">
        {spot.name ?? 'This campsite'} is no longer listed
      </h2>
      <p className="mt-2 text-sm text-ink-2">
        It stopped appearing in OpenStreetMap on{' '}
        {new Date(spot.missingSince).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
        , and has been absent from every weekly import since. That usually
        means it closed.
      </p>

      {spot.nearest && (
        <>
          {/* 🔴 A link, not a redirect. "The nearest campsite to one that
              closed" is a guess; sending the reader there automatically
              would also tell Google the two are the same place. The
              distance is printed so the reader can judge it. */}
          <p className="mt-4 text-sm text-ink-2">
            The closest one we still hold is{' '}
            <Link href={spot.nearest.path} className="font-semibold underline">
              {spot.nearest.name ?? 'an unnamed campsite'}
            </Link>
            , {formatDistance(spot.nearest.metres)} away.
          </p>
        </>
      )}
    </div>
  );
}
