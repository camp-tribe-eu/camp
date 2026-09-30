import { SOURCES, formatUpdated, type SpotSource } from '@/lib/sources';

// CAMP-3 / CAMP-45 — attribution for the campsites shown on a route
// page, and the ODbL position of the page itself.
//
// 🔴 Two separate obligations, and they are not the same one.
//
// 1. ATTRIBUTION FOR THE CAMPSITE RECORDS. OpenStreetMap under ODbL
//    requires credit. DATAtourisme under Licence Ouverte 2.0 requires
//    credit AND the date the reused information was last updated, and
//    forbids misleading anyone about either — 8 752 French campsites in
//    our database come from it, so a route through France cannot
//    discharge this with a footer line.
//
//    Which is why the dates are here, per record, behind a disclosure
//    rather than omitted. Collapsing 28 dates spanning years into "data
//    from DATAtourisme" is precisely the misleading the licence names.
//
// 2. THE LICENCE POSITION OF THE ROUTE ITSELF. A route page is a
//    Produced Work under ODbL §4.5(a): the stages, the order and every
//    word of the description are ours, they are not a Derivative
//    Database, and share-alike does not reach them. That holds because
//    the page shows a handful of campsites selected by our own
//    editorial criteria — at most 28 on the longest route here — rather
//    than a systematic extract of a region. Stated on the page, because
//    a legal position nobody can read is one we would have to explain
//    from scratch the day it is questioned.

// 🔴 CAMP-113 added a second kind of OSM object to this page, and the
// paragraph at the bottom counts objects for a living.
//
// The Produced Work sentence used to end "this page shows {campsiteCount}".
// With the services block that number stopped being the number of
// objects taken from the database — a seven-stage route showing 28
// campsites also shows up to 49 services — and a licence note that
// undercounts by two thirds is worse than none, because it is the
// document we would point at if the position were ever questioned. So
// the services are counted too, and named separately, because they come
// from OpenStreetMap alone while the campsites do not.

export default function RouteSources({
  sources,
  campsiteCount,
  serviceCount,
  note,
}: {
  /** Every source entry from every campsite shown on this page. */
  sources: SpotSource[];
  campsiteCount: number;
  /**
   * CAMP-113: how many service points (fuel, charging, water, …) the
   * page shows. All of them OpenStreetMap, all of them ODbL.
   */
  serviceCount: number;
  /** The route's own sentence about where its campsite data comes from. */
  note: string;
}) {
  // Group by source id, keeping every date rather than reducing them.
  const byId = new Map<string, SpotSource[]>();
  for (const s of sources ?? []) {
    const list = byId.get(s.id) ?? [];
    list.push(s);
    byId.set(s.id, list);
  }

  return (
    <section
      aria-labelledby="route-sources-heading"
      data-testid="route-sources"
      className="mt-10 rounded-card border border-line-2 bg-surface-2 p-5"
    >
      <h2
        id="route-sources-heading"
        className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-2"
      >
        Where this comes from
      </h2>

      <p className="mt-3 max-w-prose text-sm leading-6 text-ink-2">{note}</p>

      {byId.size > 0 && (
        <ul className="mt-4 space-y-3">
          {[...byId.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([id, entries]) => {
              const info = SOURCES[id];
              return (
                <li key={id} className="text-sm leading-6 text-ink-2">
                  <span className="font-semibold text-heading">
                    {info ? (
                      <a
                        href={info.url}
                        className="underline"
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {info.name}
                      </a>
                    ) : (
                      // 🔴 An unrecognised id is shown, never dropped.
                      // Dropping it silently removes an attribution,
                      // which is the one failure this whole file exists
                      // to prevent.
                      id
                    )}
                  </span>
                  {info && (
                    <>
                      {' · '}
                      <a
                        href={info.licenceUrl}
                        className="underline"
                        rel="license noopener noreferrer"
                        target="_blank"
                        data-boilerplate="licence"
                      >
                        {info.licence}
                      </a>
                    </>
                  )}
                  {' · '}
                  {entries.length} of the {campsiteCount} campsites on this page

                  {/* 🔴 The per-record dates. Licence Ouverte 2.0
                      requires the date the reused information was last
                      updated; a range or an average would be a claim
                      about records it is not true of. Inside a
                      <details> so the page stays readable — present and
                      complete, not prominent. */}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs underline">
                      {info?.dateLabel ?? 'Source dates'} — all {entries.length} dates
                    </summary>
                    <ul className="mt-2 space-y-0.5 text-xs">
                      {entries
                        .slice()
                        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
                        .map((e, i) => {
                          const when = formatUpdated(e.updatedAt);
                          return (
                            <li key={`${e.ref}-${i}`}>
                              <code className="text-ink-3">{e.ref}</code>
                              {when && (
                                <>
                                  {' — '}
                                  <time dateTime={e.updatedAt}>{when}</time>
                                </>
                              )}
                            </li>
                          );
                        })}
                    </ul>
                  </details>
                </li>
              );
            })}
        </ul>
      )}

      {/* The Produced Work position. Wording is identical on every route
          page, so it is marked as boilerplate for the near-duplicate
          guard — the same treatment the campsite pages give their
          licence line. */}
      <p
        className="mt-4 max-w-prose text-xs leading-5 text-ink-2"
        data-boilerplate="odbl-produced-work"
      >
        This route — its stages, their order and everything written about them —
        is our own work. Under the Open Database License it is a Produced Work
        rather than a derivative database, so the share-alike term does not
        apply to it. The campsites and services shown beside each stop are a
        small selection made on our own criteria, never a listing of everything
        in the region; this page shows {campsiteCount} campsites and{' '}
        {serviceCount} service points, {campsiteCount + serviceCount} objects in
        all.
      </p>

      {/* 🔴 NOT behind `serviceCount > 0`, and that was a real bug.
          Gating it that way removed the explanation exactly when the
          block is all-absent or could not be built — which is precisely
          when a reader needs to be told that the only source is
          OpenStreetMap and that a gap in it is not a gap in the world. */}
      <p
        className="mt-3 max-w-prose text-xs leading-5 text-ink-2"
        data-boilerplate="route-services-source"
      >
        {/* 🔴 CAMP-113 is deliberately scoped to one source, and saying so
            here is the difference between a narrowing and an omission.
            Somebody reading this page should not conclude that a charging
            point absent from OpenStreetMap does not exist. */}
        Fuel, charging, water, disposal points, shops, places to eat and places
        to sleep all come from OpenStreetMap alone. Other sources for them —
        Open Charge Map, the national fuel portals — are not settled yet, so
        what is here is what volunteers have mapped and no more. We hold no
        ratings and no photographs of these places, and we will not take either
        from somebody else&rsquo;s site.
      </p>
    </section>
  );
}
