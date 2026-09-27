import { formatKm, STRAIGHT_LINE_LABEL } from '@/lib/routes';
import type { RouteGeometryResult } from '@/lib/route-geometry';

// CAMP-3 / CAMP-45 — the numbers at the top of a route page, including
// the ones that are not there.
//
// 🔴 THE EMPTY SLOTS ARE THE FEATURE.
//
// Two of the four figures a reader wants — road distance and driving
// time — cannot be produced honestly today. They need a routing engine
// we host ourselves (CAMP-42), which needs a VPS (CAMP-99). A borrowed
// routing API is ruled out separately, because somebody else's geometry
// arrives with somebody else's licence and would attach it to every page
// that draws it.
//
// So the slots are rendered, empty, with one line saying why — rather
// than quietly omitted. Three reasons, in order of how much they matter:
//
//   1. An omitted figure reads as an oversight. A present-and-empty one
//      with a reason reads as a decision, which is what it is.
//   2. It is the difference between "we don't know" and "we haven't
//      said". This project has published a plausible invented number
//      before (route distances anchored to the wrong town, and a schema
//      field that published pitches as people). Both were plausible.
//      Neither was flagged by anybody for a long time.
//   3. It makes the gap visible to us too. An empty box on a page we
//      look at every day is pressure to fill it properly; a missing
//      paragraph is invisible.

function Figure({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  note?: string;
  testId?: string;
}) {
  return (
    <div
      className="rounded-card border border-line-2 bg-surface p-4"
      data-testid={testId}
    >
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
        {label}
      </dt>
      <dd className="mt-1 text-xl font-bold leading-tight text-heading">
        {value}
      </dd>
      {note && <p className="mt-1 text-xs leading-5 text-ink-2">{note}</p>}
    </div>
  );
}

/**
 * The slot for a figure we cannot produce.
 *
 * 🔴 An em dash, not "0", not "—km", not "TBC" and not "Coming soon".
 * "0 km" is a false claim; "coming soon" is a promise with a date we do
 * not have. An em dash means "nothing here", which is true.
 */
function MissingFigure({
  label,
  note,
  testId,
}: {
  label: string;
  note: string;
  testId: string;
}) {
  return (
    <div
      className="rounded-card border border-dashed border-line-2 bg-surface-2 p-4"
      data-testid={testId}
    >
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
        {label}
      </dt>
      <dd
        className="mt-1 text-xl font-bold leading-tight text-ink-3"
        aria-label="Not available"
      >
        <span aria-hidden="true">—</span>
      </dd>
      <p className="mt-1 text-xs leading-5 text-ink-2">{note}</p>
    </div>
  );
}

export default function RouteFigures({
  days,
  nights,
  stages,
  straightLineTotal,
  road,
}: {
  days: number;
  nights: number;
  stages: number;
  straightLineTotal: number;
  road: RouteGeometryResult;
}) {
  return (
    <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Figure
        label="Duration"
        value={`${days} days`}
        note={`${nights} nights across ${stages} stops, as curated.`}
        testId="figure-duration"
      />

      {/* 🔴 The straight-line total carries its label in the value, not
          only in the note. A reader who scans the big numbers and skips
          the small print must still not come away with a driving
          distance — so the qualifier is inside the thing they read. */}
      <Figure
        label={`Distance, ${STRAIGHT_LINE_LABEL}`}
        value={formatKm(straightLineTotal)}
        note="The sum of the straight lines between consecutive stops. The road is always longer, and on the mountain sections it is much longer."
        testId="figure-straight-line"
      />

      {road.available ? (
        <>
          <Figure
            label="Distance by road"
            value={formatKm(road.geometry.metres)}
            note={`Computed by ${road.geometry.engine}.`}
            testId="figure-road-distance"
          />
          <Figure
            label="Driving time"
            value={`${Math.round(road.geometry.seconds / 3600)} h`}
            note={`Modelled by ${road.geometry.engine}, without stops or traffic.`}
            testId="figure-driving-time"
          />
        </>
      ) : (
        <>
          <MissingFigure
            label="Distance by road"
            note={road.reason}
            testId="figure-road-distance-missing"
          />
          <MissingFigure
            label="Driving time"
            note="Arrives with the routing engine, alongside the road distance. We will not estimate it from the straight line — on these roads that would be wrong by a factor, not by a margin."
            testId="figure-driving-time-missing"
          />
        </>
      )}
    </dl>
  );
}
