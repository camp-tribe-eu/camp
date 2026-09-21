import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Amenities,
  AmenityValue,
  getSpot,
  getSpotIndex,
  NearbySpot,
  Spot,
  SPOT_TYPE_LABEL,
  withOwnerOverrides,
} from '@/lib/api';

// CAMP-34 — the campsite page.
//
// The point of this page is not the layout, it is the honesty of it. We
// have no photographs and, for most sites, no idea whether there is a
// shower. Two temptations follow, and the card rejects both:
//
//   stock imagery   — a picture of "a campsite" for a place nobody has
//                     seen is a misleading commercial practice under
//                     UCPD art. 6(1). The owner rejected it outright.
//   a tidy "no"     — printing "no shower" because a tag is absent turns
//                     a gap in OpenStreetMap into a false statement about
//                     a real business. Hence the tri-state (CAMP-27).
//
// What is left is genuinely ours: an honest gap is a reason for the owner
// to claim the listing (CAMP-86), which is the whole content strategy.

type Params = { country: string; region: string; slug: string };

export const dynamicParams = true;

export async function generateStaticParams(): Promise<Params[]> {
  const index = await getSpotIndex();
  return index.map(({ country, region, slug }) => ({ country, region, slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const data = await getSpot(params.country, params.region, params.slug);
  if (!data) return { title: 'Campsite not found' };

  const spot = withOwnerOverrides(data.spot);
  const name = spot.name ?? `${SPOT_TYPE_LABEL[spot.type]} near ${spot.region}`;
  const where = [spot.region, spot.country.toUpperCase()]
    .filter(Boolean)
    .join(', ');

  return {
    title: `${name} — ${where}`,
    // No superlatives and no invented detail: the description says only
    // what the row actually contains, because a description that promises
    // what the page lacks is the fastest way to earn a bounce.
    description: `${SPOT_TYPE_LABEL[spot.type]} in ${where}. Location, facilities and nearby campsites — from OpenStreetMap, with gaps shown as gaps.`,
    alternates: {
      canonical: `/camping/${params.country}/${params.region}/${params.slug}`,
    },
    // A campsite OSM has dropped is kept reachable but must stop ranking
    // until it comes back (the four-import rule, CAMP-87).
    robots: spot.missingSince ? { index: false, follow: true } : undefined,
  };
}

export default async function CampsitePage({ params }: { params: Params }) {
  const data = await getSpot(params.country, params.region, params.slug);
  if (!data) notFound();

  const spot = withOwnerOverrides(data.spot);
  const name = spot.name;
  const known = Object.values(spot.amenities).filter(
    (v) => v !== 'unknown',
  ).length;

  return (
    <main className="mx-auto max-w-wrap px-4 py-8 xl:px-6">
      <Breadcrumbs spot={spot} params={params} />

      <header className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-2">
          {SPOT_TYPE_LABEL[spot.type]}
        </p>
        <h1 className="mt-2 text-3xl font-bold leading-tight md:text-[42px]">
          {/* An unnamed site still needs a heading a person can read and a
              search engine can rank. "Campsite" alone is neither, and it
              would also disagree with the <title>. */}
          {name ?? `${SPOT_TYPE_LABEL[spot.type]} near ${spot.region}`}
        </h1>
        <p className="mt-2 text-ink-2">
          {[spot.region, spot.country.toUpperCase()].filter(Boolean).join(', ')}
        </p>
        {!name && (
          // 26% of campsites in OSM carry no name at all (measured on 448
          // Slovenian sites). Dropping them would remove a quarter of the
          // map; inventing a name would be worse.
          <p className="mt-3 max-w-prose text-sm text-ink-2">
            This site has no name in OpenStreetMap. The location is real — the
            name simply has not been recorded by anyone yet.
          </p>
        )}
      </header>

      {spot.missingSince && <MissingNotice since={spot.missingSince} />}

      <NoPhotos />

      <Section title="Facilities">
        {known === 0 ? (
          <p className="max-w-prose text-sm text-ink-2">
            Nothing has been recorded about this site&rsquo;s facilities. That
            is a gap in the data, not a statement that it has none.
          </p>
        ) : null}
        <ul className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ['electricity', 'Electricity'],
              ['water', 'Drinking water'],
              ['shower', 'Showers'],
              ['dogFriendly', 'Dogs allowed'],
              ['wifi', 'Wi-Fi'],
            ] as [keyof Amenities, string][]
          ).map(([key, label]) => (
            <Amenity key={key} label={label} value={spot.amenities[key]} />
          ))}
        </ul>
      </Section>

      <Section title="Getting there">
        <dl className="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-ink-2">Coordinates</dt>
          <dd className="tabular-nums">
            {spot.lat.toFixed(5)}, {spot.lon.toFixed(5)}
          </dd>
        </dl>
        <p className="mt-4 text-sm text-ink-2">
          Distances to water, towns and the elevation profile are not
          calculated yet.
        </p>
      </Section>

      <Section title="Weather on site">
        <p className="max-w-prose text-sm text-ink-2">
          Forecast is not connected yet.
        </p>
      </Section>

      {data.nearby.length > 0 && (
        <Section title="Campsites nearby">
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.nearby.map((n) => (
              <NearbyCard key={n.slug} spot={n} />
            ))}
          </ul>
        </Section>
      )}

      <Attribution lastSeenAt={spot.lastSeenAt} />
    </main>
  );
}

function Breadcrumbs({ spot, params }: { spot: Spot; params: Params }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
      <ol className="flex flex-wrap items-center gap-x-2">
        <li>
          <Link href="/camping" className="hover:text-heading">
            Camping
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li>
          <Link
            href={`/camping/${params.country}`}
            className="hover:text-heading"
          >
            {spot.country.toUpperCase()}
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li>
          <Link
            href={`/camping/${params.country}/${params.region}`}
            className="hover:text-heading"
          >
            {spot.region}
          </Link>
        </li>
      </ol>
    </nav>
  );
}

/**
 * 🔴 The honest empty state, and the outreach funnel in one block.
 *
 * It says what we will not do and why, then asks the one person who can
 * fix it. Free photo sources cover 0.4% of campsites; roughly 10,000
 * operators have an email address sitting in OSM
 * (Facts/photo-content-strategy.md).
 */
function NoPhotos() {
  return (
    <section className="mt-6 rounded-card border border-line-2 bg-surface p-5 shadow-card">
      <h2 className="text-base font-semibold">
        We don&rsquo;t publish pictures we haven&rsquo;t verified
      </h2>
      <p className="mt-2 max-w-prose text-sm text-ink-2">
        No stock photography and no AI-generated images of places nobody has
        visited. When a photograph appears here, someone stood there and took
        it, and the date it was taken is shown next to it.
      </p>
      <p className="mt-4 text-sm">
        <Link
          href="/owner/claim"
          className="inline-flex h-10 items-center rounded bg-btn px-4 font-semibold text-btn-ink transition-colors hover:bg-btn-hover"
        >
          You own this site? Add your photos
        </Link>
      </p>
    </section>
  );
}

function MissingNotice({ since }: { since: string }) {
  const date = new Date(since);
  return (
    <p
      role="status"
      className="mt-6 rounded border border-warn/40 bg-warn/5 p-4 text-sm text-ink-2"
    >
      This campsite has stopped appearing in OpenStreetMap since{' '}
      <time dateTime={date.toISOString()}>
        {date.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      </time>
      . It may have closed, or the entry may have been removed by mistake — we
      keep the page until several weekly imports agree it is gone.
    </p>
  );
}

function Amenity({ label, value }: { label: string; value: AmenityValue }) {
  const style: Record<AmenityValue, string> = {
    yes: 'border-ok/50 bg-ok/10 text-heading',
    no: 'border-line-2 bg-surface-2 text-ink-2',
    unknown: 'border-dashed border-line bg-transparent text-ink-2',
  };
  const mark: Record<AmenityValue, string> = {
    yes: 'Yes',
    no: 'No',
    // 🔴 Never blank and never a crossed-out icon: an unrecorded amenity
    // must not read as an absent one.
    unknown: 'Not recorded',
  };
  return (
    <li
      className={`flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm ${style[value]}`}
    >
      <span>{label}</span>
      <span className="text-xs font-semibold uppercase tracking-wide">
        {mark[value]}
      </span>
    </li>
  );
}

function NearbyCard({ spot }: { spot: NearbySpot }) {
  const km = spot.metres >= 1000;
  const region = (spot.region ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (
    <li className="rounded-card border border-line-2 bg-surface p-4 shadow-card">
      <Link
        href={`/camping/${spot.country.toLowerCase()}/${region}/${spot.slug}`}
        className="font-semibold text-heading hover:underline"
      >
        {spot.name ?? SPOT_TYPE_LABEL[spot.type]}
      </Link>
      <p className="mt-1 text-sm text-ink-2">
        {SPOT_TYPE_LABEL[spot.type]} ·{' '}
        <span className="tabular-nums">
          {km
            ? `${(spot.metres / 1000).toFixed(1)} km`
            : `${spot.metres} m`}
        </span>{' '}
        away
      </p>
    </li>
  );
}

/**
 * ODbL requires attribution wherever the data is shown, and it has to name
 * the licence, not just the project (CAMP-87). The "checked on" date is
 * ours, not a licence requirement — but a directory that does not say how
 * fresh it is invites the reader to assume the worst.
 */
function Attribution({ lastSeenAt }: { lastSeenAt: string | null }) {
  return (
    <footer className="mt-10 border-t border-line-2 pt-4 text-xs text-ink-2">
      <p>
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
        {lastSeenAt && (
          <>
            {' '}
            Last checked against OpenStreetMap on{' '}
            <time dateTime={new Date(lastSeenAt).toISOString()}>
              {new Date(lastSeenAt).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </time>
            .
          </>
        )}
      </p>
    </footer>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-bold md:text-[25px]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
