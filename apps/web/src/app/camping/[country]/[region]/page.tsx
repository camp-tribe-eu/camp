import type { Metadata } from 'next';
import { countryName, getCountries, getRegions } from '@/lib/api';
import RegionListing, { regionMeta } from '@/components/region-listing';
import { alternatesFor } from '@/lib/i18n';

type Params = { country: string; region: string };

// 🔴 CAMP-73. Without this, a URL that is not in the build is rendered
// on demand, calls notFound(), and Next answers with its client-side
// error shell: the 404 content travels inside the RSC payload instead of
// as markup, so the page is perfect in a browser and blank to anyone
// without JavaScript — a crawler included. `false` sends unknown params
// to the prerendered 404, which is real HTML.
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Params[]> {
  const countries = await getCountries();
  const out: Params[] = [];
  for (const c of countries) {
    for (const r of await getRegions(c.country)) {
      out.push({ country: c.country, region: r.slug });
    }
  }
  return out;
}

export async function generateMetadata(
  props: {
    params: Promise<Params>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const meta = await regionMeta(params.country, params.region);
  if (!meta) return { title: 'Region not found' };

  const cName = countryName(params.country);

  return {
    title: `Campsites in ${meta.region}, ${cName}`,
    description: `${meta.spots} campsites and motorhome parks in ${meta.region}, ${cName}, with facilities and locations.`,
    alternates: alternatesFor(`/camping/${params.country}/${params.region}`),
    // 🔴 The threshold from CAMP-71: a hub listing one or two campsites is
    // a duplicate of those campsites' own pages. It stays crawlable
    // (`follow`) because it is the only path down to them without the map,
    // but it must not compete in the index as a landing page.
    //
    // Spread rather than `robots: undefined` — see the campsite page:
    // an explicitly-undefined key overwrites the root's value.
    ...(meta.indexable ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function RegionPage(props: { params: Promise<Params> }) {
  const params = await props.params;
  return (
    <RegionListing
      country={params.country}
      region={params.region}
      page={1}
    />
  );
}
