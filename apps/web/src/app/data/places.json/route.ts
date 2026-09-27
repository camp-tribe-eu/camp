import { getPlaces } from '@/lib/api';

// CAMP-143: the country and region list, as ONE file instead of 65 435 copies.
//
// 🔴 This route exists because of a measurement, not a preference.
//
// `not-found.tsx` awaits `getPlaces()` and hands the result to
// `PathRecovery` as a prop. Next serialises the not-found boundary into
// the flight payload of every statically generated page, so that list
// was embedded in all of them. Measured 27.09.2026 on the production
// build, in `/camping/fr/ain/page/5.html`:
//
//   the 27 countries and 800 regions   47 919 bytes
//   the whole page                    126 512 bytes
//                                     ——— 37% of every page
//
// Across 65 435 pages that is roughly 3.1 GB of the 12.2 GB the build
// produces, and about 48 KB a reader downloads on every page they open
// in order to serve a 404 page most of them never see.
//
// 🔴 The rule the old comment was protecting is KEPT. It said: "A 404
// page that fetches from the API is a 404 page that breaks precisely
// when things are already going wrong." That remains true, and this
// does not break it — the file below is a static document on our own
// site, built at build time from the same `getPlaces()`. If the API is
// down, this file is still there, exactly like the page that used to
// embed it. What changed is only how many copies of it exist.
//
// The reader downloads it once and the browser caches it, instead of
// once per page in a form no cache can share.

export const dynamic = 'force-static';

export async function GET() {
  const places = await getPlaces();
  const body = JSON.stringify(places);

  // 🔴 Said out loud on every build, like the search index beside it.
  // A number nobody prints is a number nobody notices growing — and the
  // whole point of this file is that its size used to be invisible.
  // eslint-disable-next-line no-console
  console.log(
    `places: ${places.length} countries, ` +
      `${places.reduce((n, p) => n + p.regions.length, 0)} regions, ` +
      `${(body.length / 1024).toFixed(1)} KiB`,
  );

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
