import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  countryName,
  getRegions,
  getRegionSpots,
  REGION_PER_PAGE,
  SPOT_TYPE_LABEL,
  type SpotCard,
} from '@/lib/api';

// CAMP-71, level 2: the region hub. Shared by /camping/{c}/{r} and
// /camping/{c}/{r}/page/{n} so the first page and the rest cannot drift.

export async function regionMeta(country: string, region: string) {
  const all = await getRegions(country);
  return all.find((r) => r.slug === region) ?? null;
}

export default async function RegionListing({
  country,
  region,
  page,
}: {
  country: string;
  region: string;
  page: number;
}) {
  const meta = await regionMeta(country, region);
  const data = await getRegionSpots(country, region, page);
  if (!meta || !data.region || data.items.length === 0) notFound();

  const pages = Math.max(1, Math.ceil(data.total / REGION_PER_PAGE));
  const cName = countryName(country);
  const base = `/camping/${country}/${region}`;

  return (
    <main className="mx-auto max-w-wrap px-4 py-8 xl:px-6">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <ol className="flex flex-wrap items-center gap-x-2">
          <li>
            <Link href="/camping" className="hover:text-heading">
              Camping
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href={`/camping/${country}`} className="hover:text-heading">
              {cName}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{data.region}</li>
        </ol>
      </nav>

      <h1 className="mt-4 text-3xl font-bold md:text-[42px]">
        Campsites in {data.region}
      </h1>
      <p className="mt-3 max-w-prose text-ink-2">
        {data.total} {data.total === 1 ? 'site' : 'sites'} in {data.region},{' '}
        {cName}
        {pages > 1 && ` — page ${page} of ${pages}`}.
      </p>

      <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.items.map((s) => (
          <SpotListCard
            key={s.slug}
            spot={s}
            href={`/camping/${country}/${region}/${s.slug}`}
          />
        ))}
      </ul>

      {pages > 1 && (
        <Pagination base={base} page={page} pages={pages} />
      )}

      <RegionNeighbours
        country={country}
        current={region}
        cName={cName}
      />

      <footer className="mt-10 border-t border-line-2 pt-4 text-xs text-ink-2">
        Campsite data ©{' '}
        <a
          href="https://www.openstreetmap.org/copyright"
          className="underline"
          rel="noopener"
        >
          OpenStreetMap contributors
        </a>
        , available under the{' '}
        <a
          href="https://opendatacommons.org/licenses/odbl/"
          className="underline"
          rel="noopener"
        >
          Open Database License
        </a>
        .
      </footer>
    </main>
  );
}

function SpotListCard({ spot, href }: { spot: SpotCard; href: string }) {
  // Only what is actually recorded. A card that prints five grey icons for
  // five unknown amenities says "we know nothing" five times; one honest
  // line says it once and leaves room for what we do know.
  const known = (
    [
      ['electricity', 'Electricity'],
      ['water', 'Water'],
      ['shower', 'Showers'],
      ['dogFriendly', 'Dogs'],
      ['wifi', 'Wi-Fi'],
    ] as const
  ).filter(([k]) => spot.amenities?.[k] === 'yes');

  return (
    <li className="rounded-card border border-line-2 bg-surface p-4 shadow-card">
      <Link href={href} className="font-semibold text-heading hover:underline">
        {spot.name ?? SPOT_TYPE_LABEL[spot.type]}
      </Link>
      <p className="mt-1 text-sm text-ink-2">{SPOT_TYPE_LABEL[spot.type]}</p>
      {known.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {known.map(([k, label]) => (
            <li
              key={k}
              className="rounded-xs border border-ok/50 bg-ok/10 px-2 py-0.5 text-xs text-heading"
            >
              {label}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-ink-2">Facilities not recorded</p>
      )}
    </li>
  );
}

/**
 * Plain links, no JavaScript — the card's criterion is an unaided crawl,
 * and a paginator built on a click handler is invisible to it.
 */
function Pagination({
  base,
  page,
  pages,
}: {
  base: string;
  page: number;
  pages: number;
}) {
  const href = (n: number) => (n === 1 ? base : `${base}/page/${n}`);
  return (
    <nav aria-label="Pagination" className="mt-8 flex flex-wrap gap-2">
      {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
        <Link
          key={n}
          href={href(n)}
          aria-current={n === page ? 'page' : undefined}
          className={`inline-flex h-9 min-w-9 items-center justify-center rounded-sm border px-3 text-sm tabular-nums ${
            n === page
              ? 'border-line-blue bg-accent-surface font-semibold text-heading'
              : 'border-line-2 bg-surface text-ink-2 hover:border-line-blue'
          }`}
        >
          {n}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Sideways links, as the card asks. Not "neighbours" geographically — that
 * would need adjacency we do not have — but the largest other regions of
 * the same country, which is what gives a reader somewhere to go and gives
 * the crawler a second route into each region.
 */
async function RegionNeighbours({
  country,
  current,
  cName,
}: {
  country: string;
  current: string;
  cName: string;
}) {
  const others = (await getRegions(country))
    .filter((r) => r.slug !== current)
    .slice(0, 12);
  if (others.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold md:text-[25px]">
        Other regions in {cName}
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {others.map((r) => (
          <li key={r.slug}>
            <Link
              href={`/camping/${country}/${r.slug}`}
              className="inline-flex h-9 items-center gap-2 rounded-sm border border-line-2 bg-surface px-3 text-sm text-heading hover:border-line-blue"
            >
              {r.region}
              <span className="tabular-nums text-ink-2">{r.spots}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm">
        <Link href={`/camping/${country}`} className="text-ink-2 underline">
          All regions in {cName}
        </Link>
      </p>
    </section>
  );
}
