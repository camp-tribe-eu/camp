import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { countryName, getCountries, getRegions } from '@/lib/api';
import { breadcrumbList, collectionGraph, jsonLdProps } from '@/lib/jsonld';

// CAMP-71, level 1: the country hub.
//
// 🔴 Every region is listed here, including the ones with a single
// campsite. Those region pages carry `noindex`, but they must still be
// linked: if the country page hid them, their campsites would be
// reachable only from the sitemap, and the four-click path in the card
// would be a claim about 80% of the data rather than all of it.

type Params = { country: string };

// 🔴 CAMP-73. Without this, a URL that is not in the build is rendered
// on demand, calls notFound(), and Next answers with its client-side
// error shell: the 404 content travels inside the RSC payload instead of
// as markup, so the page is perfect in a browser and blank to anyone
// without JavaScript — a crawler included. `false` sends unknown params
// to the prerendered 404, which is real HTML.
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Params[]> {
  return (await getCountries()).map((c) => ({ country: c.country }));
}

export async function generateMetadata(
  props: {
    params: Promise<Params>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const name = countryName(params.country);
  const regions = await getRegions(params.country);
  const spots = regions.reduce((n, r) => n + r.spots, 0);

  return {
    title: `Campsites in ${name}`,
    description: `${spots} campsites and motorhome parks across ${regions.length} regions of ${name}. Facilities, locations and nearby sites.`,
    alternates: { canonical: `/camping/${params.country}` },
  };
}

export default async function CountryHub(props: { params: Promise<Params> }) {
  const params = await props.params;
  const regions = await getRegions(params.country);
  if (regions.length === 0) notFound();

  const name = countryName(params.country);
  const spots = regions.reduce((n, r) => n + r.spots, 0);

  return (
    <main className="mx-auto max-w-wrap px-4 py-8 xl:px-6">
      <script
        {...jsonLdProps(
          collectionGraph({
            name: `Campsites in ${name}`,
            description: `${spots} campsites across ${regions.length} regions of ${name}.`,
            path: `/camping/${params.country}`,
            items: regions.map((r) => ({
              name: r.region,
              path: `/camping/${params.country}/${r.slug}`,
            })),
          }),
        )}
      />
      <script
        {...jsonLdProps(
          breadcrumbList([
            { name: 'Camping', path: '/camping' },
            { name, path: `/camping/${params.country}` },
          ]),
        )}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <ol className="flex flex-wrap items-center gap-x-2">
          <li>
            <Link href="/camping" className="hover:text-heading">
              Camping
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{name}</li>
        </ol>
      </nav>

      <h1 className="mt-4 text-3xl font-bold md:text-[42px]">
        Campsites in {name}
      </h1>
      <p className="mt-3 max-w-prose text-ink-2">
        {spots.toLocaleString('en-GB')} campsites, motorhome parks and camper
        stops across {regions.length} regions. Facilities come from
        OpenStreetMap, and where nobody has recorded them we say so rather
        than guessing.
      </p>

      <h2 className="mt-8 text-xl font-bold md:text-[25px]">Regions</h2>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {regions.map((r) => (
          <li key={r.slug}>
            <Link
              href={`/camping/${params.country}/${r.slug}`}
              className="flex items-baseline justify-between gap-3 rounded border border-line-2 bg-surface px-3 py-2 transition-colors hover:border-line-blue"
            >
              <span className="text-heading">{r.region}</span>
              <span className="tabular-nums text-sm text-ink-2">{r.spots}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
