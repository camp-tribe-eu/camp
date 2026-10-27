import type { Metadata } from 'next';
import { permanentRedirect } from 'next/navigation';
import { countryName } from '@/lib/api';
import RegionListing, { regionMeta } from '@/components/region-listing';
import {
  describeQuery,
  hubHref,
  parseHubQuery,
  receivedSearch,
  type SearchParams,
} from '@/lib/hub-filters';

// The region hub with a filter, a sort or both: /camping/{c}/{r}/filter?…
//
// 🔴 WHY A SEPARATE ROUTE AND NOT `?types=` ON THE REGION ITSELF. A page
// that reads `searchParams` is rendered on request, every request. The
// region page is one of the ~1 500 hubs the build writes as HTML, and
// `dynamicParams = false` on it is what sends an unknown region to the
// prerendered 404 (CAMP-73). Reading the query string there would give
// up both for every reader, filtered or not. This route gives them up
// only for the filtered view, and the plain hub stays exactly the page
// the build made.
//
// 🔴 NOT IN THE INDEX. Every combination has one stable address — a
// reader can send it, a crawler can follow it to the campsites on it —
// but 5 types × 10 facilities × 3 sorts per region is a doorway farm if
// each one is allowed to rank. `noindex, follow` here; the region page
// itself keeps its CAMP-71 threshold rule. Same reasoning as page 2.
//
// 🔴 ONE ADDRESS PER STATE, IN BOTH DIRECTIONS. `/filter` with nothing
// to filter is the region page under a second URL, so it redirects (308)
// to the one the build made; page N of nothing goes to `/page/N`. And a
// state asked for under another spelling — `&page=1`, `&sort=name`, the
// parameters in another order, a value we do not know — redirects to
// its one canonical spelling, or there are two addresses for it after all.

type Params = { country: string; region: string };

type Props = {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const meta = await regionMeta(params.country, params.region);
  if (!meta) return { title: 'Region not found' };

  const q = parseHubQuery(await props.searchParams);
  const cName = countryName(params.country);
  const base = `/camping/${params.country}/${params.region}`;

  return {
    title: `${describeQuery(q)} in ${meta.region}, ${cName}`,
    description: `${describeQuery(q)} in ${meta.region}, ${cName} — filtered from ${meta.spots} listed campsites and motorhome parks.`,
    // A filtered view is a variant of the region page, not a page of
    // its own: the canonical says which one is the page.
    alternates: { canonical: base },
    robots: { index: false, follow: true },
  };
}

export default async function FilteredRegionPage(props: Props) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const q = parseHubQuery(searchParams);
  const base = `/camping/${params.country}/${params.region}`;

  const here = hubHref(base, q);
  if (here !== `${base}/filter?${receivedSearch(searchParams)}`) {
    permanentRedirect(here);
  }

  return (
    <RegionListing
      country={params.country}
      region={params.region}
      page={q.page}
      searchParams={searchParams}
      live
    />
  );
}
