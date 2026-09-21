import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  countryName,
  getCountries,
  getRegions,
  getRegionSpots,
  REGION_PER_PAGE,
} from '@/lib/api';
import RegionListing, { regionMeta } from '@/components/region-listing';

// CAMP-71: pages 2..n of a region.
//
// Pagination lives in the path, not in `?page=`, for two reasons: a query
// string makes the route dynamic and gives up static generation, and the
// card's criterion is a crawl with no JavaScript — a path is unambiguous
// to a crawler in a way a parameter is not.
//
// Page 1 is deliberately NOT reachable here; it lives at the bare region
// URL, so there is exactly one address for it.

type Params = { country: string; region: string; n: string };

export async function generateStaticParams(): Promise<Params[]> {
  const out: Params[] = [];
  for (const c of await getCountries()) {
    for (const r of await getRegions(c.country)) {
      const pages = Math.ceil(r.spots / REGION_PER_PAGE);
      for (let n = 2; n <= pages; n++) {
        out.push({ country: c.country, region: r.slug, n: String(n) });
      }
    }
  }
  return out;
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const meta = await regionMeta(params.country, params.region);
  if (!meta) return { title: 'Region not found' };
  const cName = countryName(params.country);

  return {
    title: `Campsites in ${meta.region}, ${cName} — page ${params.n}`,
    description: `Page ${params.n} of campsites and motorhome parks in ${meta.region}, ${cName}.`,
    alternates: {
      canonical: `/camping/${params.country}/${params.region}/page/${params.n}`,
    },
    // Page 2 of a list is not a landing page. It is followed so the
    // campsites on it are found, but it should never rank instead of the
    // region itself — and below the threshold neither should page 1.
    robots: { index: false, follow: true },
  };
}

export default async function RegionPageN({ params }: { params: Params }) {
  const page = Number(params.n);
  if (!Number.isInteger(page) || page < 2) notFound();

  const data = await getRegionSpots(params.country, params.region, page);
  if (data.items.length === 0) notFound();

  return (
    <RegionListing
      country={params.country}
      region={params.region}
      page={page}
    />
  );
}
