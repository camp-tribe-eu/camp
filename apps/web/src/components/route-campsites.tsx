import Link from 'next/link';
import { formatDistance, SPOT_TYPE_LABEL, type Spot } from '@/lib/api';
import {
  formatKm,
  STAGE_RADIUS_M,
  STRAIGHT_LINE_LABEL,
  type RouteNeighbour,
  type StageNeighbours,
} from '@/lib/routes';

// CAMP-3 / CAMP-45, and CAMP-160 — the campsites beside one stop.
//
// 🔴 THREE STATES, AND THE PAGE MUST BE ABLE TO TELL THEM APART.
//
//   1. We looked and found campsites  → the list.
//   2. We looked and found none       → "Our database holds no campsite
//                                        within 25 km of this stop."
//   3. We could not look              → "We could not reach our own
//                                        database…"
//
// Until CAMP-160 there were two: states 2 and 3 both arrived as an empty
// array, and the page printed state 2's sentence for both. On a dead API
// that meant every stop on every route said our database holds no
// campsite near it — a statement about the ground made by code that had
// not looked at it. The services block beside it had already been fixed
// (CAMP-113, `RouteStageServices`); this is the same third state, in the
// same shape, so the two blocks now fail the same way.
//
// 🔴 The two sentences share no clause that could be mistaken for the
// other: the failure one never contains "holds no campsite", so a page
// check for that phrase means what it says.

/** One campsite in the list beside a stage. */
function SpotLink({ spot }: { spot: RouteNeighbour }) {
  const label = SPOT_TYPE_LABEL[spot.type as Spot['type']] ?? 'Campsite';
  // 🔴 26% of campsites in OpenStreetMap carry no name at all. Saying so
  // is the honest rendering; inventing one is not, and dropping them
  // would remove a quarter of the map.
  const name = spot.name ?? `Unnamed ${label.toLowerCase()}`;

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-sm leading-6">
      {/* 🔴 A campsite with no region has no page (canonicalPath returns
          null). It is still shown — it is a real place near this stop —
          but it is NOT linked, because a link that promises a page and
          lands on a 404 is worse than no link. */}
      {spot.path ? (
        <Link href={spot.path} className="font-semibold text-heading underline">
          {name}
        </Link>
      ) : (
        <span className="font-semibold text-heading">{name}</span>
      )}
      <span className="text-ink-2">
        {label} ·{' '}
        <span>
          {formatDistance(spot.metres)} away {STRAIGHT_LINE_LABEL}
        </span>
      </span>
    </li>
  );
}

export default function RouteStageCampsites({
  group,
  looked,
}: {
  group: StageNeighbours | undefined;
  /**
   * 🔴 Whether we actually asked. See `RouteNeighboursResult` — without
   * this the block printed "Our database holds no campsite within 25 km
   * of this stop" under every stop whenever the API call failed.
   */
  looked: boolean;
}) {
  const spots = group?.spots ?? [];

  return (
    <div className="mt-4" data-testid="stage-campsites">
      <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
        Campsites near this stop
      </h4>
      {!looked ? (
        // 🔴 "We could not look" — a fact about US. It is a different
        // statement from "we hold none" (a fact about our data) and from
        // "there is none" (a fact about the ground, which we can never
        // make). The rest of the page is unaffected: the stages, the
        // reasons and the services block are all still there.
        <p
          className="mt-2 max-w-prose text-sm leading-6 text-ink-3"
          data-testid="stage-campsites-unavailable"
        >
          We could not reach our own database when this page was built, so the
          campsites near this stop are not listed here. That is a fault of
          ours, not a statement that nothing is there.
        </p>
      ) : spots.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {spots.map((s) => (
            <SpotLink key={s.slug} spot={s} />
          ))}
        </ul>
      ) : (
        // 🔴 An empty stage we DID look at is stated, never hidden. "We
        // have nothing within 25 km" is a real and useful fact — and it
        // is a different statement from "there is nothing here", which
        // we cannot make.
        <p
          className="mt-2 max-w-prose text-sm text-ink-2"
          data-testid="stage-no-campsites"
        >
          Our database holds no campsite within {formatKm(STAGE_RADIUS_M)} of
          this stop. That is a gap in what has been recorded, not a statement
          that nothing is there.
        </p>
      )}
    </div>
  );
}
