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
  formatDistance,
  SPOT_TYPE_LABEL,
  TERRAIN_LABEL,
  WATER_LABEL,
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
    // No superlatives and no invented detail: the description carries the
    // computed facts (CAMP-33) because those are the part that differs
    // from site to site and the part a person is actually choosing on.
    // A description built only from the template would be the same
    // sentence 291 times with the name swapped.
    description: describe(spot, where),
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

      <Around spot={spot} />

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
          {spot.context.station && (
            <>
              <dt className="text-ink-2">Nearest station</dt>
              <dd>
                {spot.context.station.name ?? 'Railway station'}
                {', '}
                <span className="tabular-nums">
                  {formatDistance(spot.context.station.m)}
                </span>
              </dd>
            </>
          )}
          {spot.context.town && (
            <>
              <dt className="text-ink-2">Nearest town</dt>
              <dd>
                {spot.context.town.name ?? 'Town'}
                {', '}
                <span className="tabular-nums">
                  {formatDistance(spot.context.town.m)}
                </span>
              </dd>
            </>
          )}
          <dt className="text-ink-2">Coordinates</dt>
          <dd className="tabular-nums">
            {spot.lat.toFixed(5)}, {spot.lon.toFixed(5)}
          </dd>
        </dl>
        <p className="mt-4 text-xs text-ink-2">
          Distances are straight-line, measured from the centre of the site —
          the road will always be longer.
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

/** Search-result description, built from what this site actually has. */
function describe(spot: Spot, where: string): string {
  const c = spot.context ?? {};
  const bits: string[] = [];
  if (c.water) {
    bits.push(
      `${formatDistance(c.water.m)} from ${
        c.water.name ?? WATER_LABEL[c.water.kind].toLowerCase()
      }`,
    );
  }
  if (c.elevation !== undefined) bits.push(`${c.elevation} m above sea level`);
  if (c.town) {
    bits.push(`${formatDistance(c.town.m)} from ${c.town.name ?? 'town'}`);
  }

  const head = `${SPOT_TYPE_LABEL[spot.type]} in ${where}`;
  // Under ~155 characters is where Google stops showing it; the facts are
  // ordered so the most distinguishing one survives a truncation.
  return bits.length
    ? `${head} — ${bits.join(', ')}. Facilities and nearby sites, from OpenStreetMap.`
    : `${head}. Location, facilities and nearby campsites — from OpenStreetMap, with gaps shown as gaps.`;
}

/**
 * 🔴 CAMP-33 — the section that justifies the page existing.
 *
 * Without photographs and with two thirds of amenities unrecorded, this
 * is the only thing here that a reader cannot get from Park4Night,
 * Campercontact or ACSI: none of them publish how far the lake is, how
 * high the site sits, or whether a train stops within walking distance.
 * It is also the shape of fact an assistant quotes when someone asks for
 * "a campsite by a lake near Bled".
 *
 * The prose line first, the numbers under it. A reader takes the
 * sentence; a machine takes the list. Writing only the list would make
 * the page a spreadsheet, and writing only the sentence would lose the
 * precision that makes it worth quoting.
 */
function Around({ spot }: { spot: Spot }) {
  const c = spot.context ?? {};
  const facts: { label: string; value: string }[] = [];

  if (c.water) {
    facts.push({
      label: c.water.name ?? WATER_LABEL[c.water.kind],
      value: formatDistance(c.water.m),
    });
  }
  if (c.town) {
    facts.push({
      label: c.town.name ?? 'Nearest town',
      value: formatDistance(c.town.m),
    });
  }
  if (c.supermarket) {
    facts.push({ label: 'Supermarket', value: formatDistance(c.supermarket.m) });
  }
  if (c.station) {
    facts.push({
      label: c.station.name ? `${c.station.name} station` : 'Railway station',
      value: formatDistance(c.station.m),
    });
  }
  if (c.elevation !== undefined) {
    facts.push({ label: 'Elevation', value: `${c.elevation} m` });
  }
  if (c.terrain) {
    facts.push({
      label: 'Terrain',
      value: `${TERRAIN_LABEL[c.terrain.type]} (${c.terrain.relief} m relief)`,
    });
  }

  if (facts.length === 0) {
    return (
      <Section title="What&rsquo;s around it">
        <p className="max-w-prose text-sm text-ink-2">
          The surroundings of this site have not been calculated yet.
        </p>
      </Section>
    );
  }

  return (
    <Section title="What&rsquo;s around it">
      <p className="max-w-prose">{summarise(spot)}</p>
      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map((f) => (
          <div
            key={f.label}
            className="flex items-baseline justify-between gap-3 border-b border-line-2 py-1.5 text-sm"
          >
            <dt className="text-ink-2">{f.label}</dt>
            <dd className="tabular-nums text-heading">{f.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-ink-2">
        Calculated by us from OpenStreetMap geometry and the Copernicus
        elevation model. Straight-line distances.
      </p>
    </Section>
  );
}

/**
 * One sentence built from whatever is actually known.
 *
 * Deliberately not a template with slots: a sentence that reads "is 2.6 km
 * from and 412 m from" when two facts are missing is worse than a shorter
 * sentence. Clauses are assembled only for the facts that exist.
 */
function summarise(spot: Spot): string {
  const c = spot.context ?? {};
  const what = SPOT_TYPE_LABEL[spot.type].toLowerCase();
  const parts: string[] = [];

  if (c.terrain && c.elevation !== undefined) {
    parts.push(
      `This ${what} sits at ${c.elevation} m above sea level in ${TERRAIN_LABEL[
        c.terrain.type
      ].toLowerCase()} country`,
    );
  } else if (c.elevation !== undefined) {
    parts.push(`This ${what} sits at ${c.elevation} m above sea level`);
  } else {
    parts.push(`This ${what}`);
  }

  if (c.water) {
    const named = c.water.name
      ? `${c.water.name}`
      : `the nearest ${WATER_LABEL[c.water.kind].toLowerCase()}`;
    parts.push(`${formatDistance(c.water.m)} from ${named}`);
  }
  if (c.town) {
    parts.push(
      `${formatDistance(c.town.m)} from ${c.town.name ?? 'the nearest town'}`,
    );
  }
  if (c.station) {
    parts.push(
      `${formatDistance(c.station.m)} from ${
        c.station.name ? `${c.station.name} station` : 'a railway station'
      }`,
    );
  }

  const [head, ...rest] = parts;
  if (rest.length === 0) return `${head}.`;
  const last = rest.pop() as string;
  return rest.length
    ? `${head}, ${rest.join(', ')} and ${last}.`
    : `${head}, ${last}.`;
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
