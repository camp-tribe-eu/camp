import { formatDistance } from '@/lib/api';
import { formatKm, STRAIGHT_LINE_LABEL } from '@/lib/routes';
import {
  AVERAGE_BADGE,
  displayPrices,
  FUEL_ATTRIBUTION,
  FUEL_BULLETIN_DATE,
  FUEL_SOURCE,
  NO_STATION_PRICE,
  PRICE_STALE_AFTER_DAYS,
  SERVICE_ABSENT,
  SERVICE_KINDS,
  SERVICE_LABEL,
  SERVICE_RADIUS_M,
  SERVICE_UNNAMED,
  serviceOf,
  type DisplayPrice,
  type RouteFuelPrice,
  type RouteServicePoint,
  type ServiceKind,
  type StageServices,
} from '@/lib/route-services';

// CAMP-113 — what a driver needs between the campsites, beside each stop.
//
// 🔴 EVERY ROW IS RENDERED, INCLUDING THE ONES WITH NOTHING IN THEM.
//
// This is the card's acceptance criterion and it is the same argument
// route-figures.tsx makes about the empty road-distance box. Seven kinds
// are listed at every stage whether or not we hold one: a kind that is
// simply missing from the list reads as an oversight, and a blank cell
// beside "Phone" reads as "this place has no phone" — which is a claim
// about the world, where the truth is a claim about our data.
//
// Measured against the 67 published stages on 28.09.2026, this is not a
// rare path. Six kinds are found within 25 km of all 67; chemical-toilet
// disposal is found at 51, so 16 stages print the absent line. Within
// the ones we do find, the nearest drinking-water point is unnamed at 65
// stages of 67 and the nearest disposal point at 49 of 51. Opening hours
// exist for 50.6% of shops and 43.5% of fuel stations, and for 1.5% of
// drinking water and 2.6% of places to sleep.
//
// 🔴 NO STARS AND NO PICTURES. There is no prop here to carry either,
// deliberately — see the header of lib/route-services.ts.

/**
 * 🔴 Verbatim, monospaced, and labelled as OpenStreetMap's own syntax.
 *
 * The campsite page already does this and CAMP-141 says why. The scar is
 * older: raw OSM `opening_hours` was published as schema.org
 * `openingHours` and 2 045 of 2 182 values — 93.7% — were not
 * schema.org syntax at all. jsonld.ts settled it with an all-or-nothing
 * translation: a value translates completely or it is not published,
 * because dropping a qualifier changes what the rest means ("Mo-Su
 * 08:00-20:00; PH off" becomes "open every day", on the public holiday
 * when the place is shut).
 *
 * The measurement here is worse than the campsites'. Of the 2 248 490
 * rows behind this block, 683 603 carry opening hours at all; 108 574 of
 * those are `24/7` and 174 557 are a single simple day-range rule, so
 * 41.4% would translate and 117 544 carry months, `PH`, `off`,
 * `sunrise` or a quoted comment. A parser would have to be right about
 * the other 58.6% in order to print "open now" — and "open now" is a
 * claim a driver acts on at 21:40 with a quarter of a tank.
 *
 * So: no "open now", no prose rewrite, no traffic-light dot. The string
 * as the map holds it, in a monospace font so it reads as a code rather
 * than as a sentence, and one line saying what it is.
 */
function Hours({ value }: { value: string | null }) {
  if (!value) {
    return (
      <span className="text-ink-3">
        Opening hours unknown
        <span className="sr-only"> — not recorded in OpenStreetMap</span>
      </span>
    );
  }
  return (
    <span className="font-mono text-ink-2" data-testid="service-hours">
      {value}
    </span>
  );
}

function Phone({ value }: { value: string | null }) {
  if (!value) return <span className="text-ink-3">Phone unknown</span>;
  return (
    // 🔴 One number in the href whatever the tag holds. OSM separates
    // several with ';' and a `tel:` with two glued together dials
    // neither — 157 live campsite rows were doing exactly that before
    // CAMP-141. The import already keeps the first; this is the second
    // belt, the same one the campsite page wears.
    <a
      href={`tel:${value.split(';')[0].replace(/[^+\d]/g, '')}`}
      className="underline underline-offset-2"
    >
      {value}
    </a>
  );
}

/** "26 September 2026" — the same long form the rest of the site uses. */
const longDay = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

/**
 * CAMP-154 — the price of a litre on THIS forecourt.
 *
 * 🔴 THE THREE THINGS THAT MAKE THIS DIFFERENT FROM THE BLOCK BELOW,
 * AND WHY EACH IS ON THE PAGE RATHER THAN IN A COMMENT.
 *
 * 1. **The date.** Not decoration — measured 28.09.2026, only 3 350 of
 *    France's 8 760 diesel prices were under a day old, 1 193 were
 *    eight to thirty days old, and the two grades on one Bologna
 *    forecourt were filed a day apart. A fuel price with no date is a
 *    rumour, and this one is the source's own stamp, never our fetch.
 *
 * 2. **The product name, as the source publishes it.** France sells
 *    95-octane as SP95 and as E10 at different prices, and 5 619 of its
 *    stations post only E10. "Petrol €2.21" would be the wrong fuel at
 *    a third of French stations; "E10 €2.209" is what is in the tank.
 *
 * 3. **The source.** Named beside the number, with a link, because a
 *    reader who thinks the price is wrong should be one click from the
 *    ministry that published it. It is also the licence condition on
 *    all three feeds.
 *
 * 🔴 AND THE ONE THING THAT MUST NOT HAPPEN HERE: no country average
 * ever renders inside this component. The average lives in
 * `RouteFuelPrices`, at route level, under a badge that says so. There
 * is no code path from one to the other — different props, different
 * types — which is the only reliable way to keep the two apart.
 */
function StationPrices({ prices }: { prices: DisplayPrice[] }) {
  // 🔴 The absent case is a SENTENCE, never a blank. This rule has been
  // broken twice in this codebase and caught both times, and here the
  // blank would be the most misleading of all: an empty space beside a
  // pump on a page whose whole promise is the price beside the pump.
  if (prices.length === 0) {
    return (
      <span className="text-ink-3" data-testid="station-price-absent">
        {NO_STATION_PRICE}
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      {prices.map((p) => (
        <span
          key={`${p.grade}-${p.product}`}
          data-testid={`station-price-${p.grade}`}
          data-price-state={p.state}
          className={
            p.state === 'stale'
              ? 'text-ink-3'
              : 'font-semibold text-heading'
          }
        >
          {/* The source's own product name, not the word "petrol". */}
          {p.product}{' '}
          <span className="tabular-nums">€{p.price}</span>
          {'/l '}
          <span className="font-normal text-ink-3">
            {/* 🔴 The date is inside the same element as the price, so
                no layout change can separate a number from its stamp.
                A stale one says so in words as well: "on 3 September"
                alone leaves the reader to do the arithmetic, and the
                whole point of the threshold is that we do it for them. */}
            {p.state === 'stale' ? 'last reported ' : 'measured '}
            <time dateTime={p.measuredAt}>{longDay(p.measuredAt)}</time>
            {p.state === 'stale'
              ? `, over ${PRICE_STALE_AFTER_DAYS} days ago — it may have moved since`
              : ''}
          </span>
        </span>
      ))}
    </span>
  );
}

function ServiceRow({
  kind,
  point,
  now,
}: {
  kind: ServiceKind;
  point: RouteServicePoint | null;
  /** 🔴 Passed in, never `new Date()` here. See `priceFreshness`. */
  now: Date;
}) {
  const label = SERVICE_LABEL[kind];

  if (!point) {
    return (
      <div
        className="grid grid-cols-1 gap-x-4 border-t border-line-2 py-2 sm:grid-cols-[11rem_1fr]"
        data-testid={`service-${kind}-absent`}
      >
        <dt className="text-sm font-semibold text-heading">{label}</dt>
        <dd className="text-sm leading-6 text-ink-3">
          {/* 🔴 "Our database holds none", never "there is none". We can
              make the first statement and not the second, and a driver
              deciding whether to detour deserves to know which one this
              is. */}
          Our database holds {SERVICE_ABSENT[kind]} within{' '}
          {formatKm(SERVICE_RADIUS_M)} of this stop.
        </dd>
      </div>
    );
  }

  // 🔴 An unnamed point is shown, never hidden. It is the usual case for
  // water and disposal, and a tap you can find at a coordinate is worth
  // more than a blank row. Same rule the campsite list follows for the
  // 26% of campsites OpenStreetMap holds with no name at all.
  const name = point.name ?? SERVICE_UNNAMED[kind];

  return (
    <div
      className="grid grid-cols-1 gap-x-4 border-t border-line-2 py-2 sm:grid-cols-[11rem_1fr]"
      data-testid={`service-${kind}`}
    >
      <dt className="text-sm font-semibold text-heading">{label}</dt>
      <dd className="text-sm leading-6">
        <span className={point.name ? 'text-heading' : 'text-ink-2 italic'}>
          {name}
        </span>
        <span className="text-ink-2">
          {' · '}
          {/* 🔴 STRAIGHT_LINE_LABEL, not the words typed again. lib/routes
              exports the phrase precisely so it cannot drift on one
              surface, and there is a test asserting the page contains
              it wherever it prints a distance. There is no road distance
              anywhere on this site. */}
          {formatDistance(point.metres)} away {STRAIGHT_LINE_LABEL}
        </span>
        {/* 🔴 CAMP-154: only on the fuel row, and on EVERY fuel row.
            Gating it on `point.prices` being present would make the
            absent case invisible — 41.8% of the fuel points we show in
            Spain, France and Italy have no price, and 100% of those in
            the other 24 member states, and all of them must say so
            rather than look like a row that forgot something. */}
        {kind === 'fuel' ? (
          <div className="mt-0.5 text-xs" data-testid="station-price">
            {/* 🔴 `now` is spent HERE, in `displayPrices`, not inside the
                component. What reaches StationPrices has already been
                filtered and classified against the build's clock, so
                the renderer cannot reach a different verdict from the
                one the filter reached. */}
            <StationPrices prices={displayPrices(point, now)} />
          </div>
        ) : null}
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
          <Hours value={point.openingHours} />
          <Phone value={point.phone} />
          {point.website ? (
            <a
              href={point.website}
              rel="nofollow ugc noopener"
              target="_blank"
              className="underline underline-offset-2"
            >
              Website
            </a>
          ) : (
            <span className="text-ink-3">Website unknown</span>
          )}
        </div>
      </dd>
    </div>
  );
}

/**
 * This week's NATIONAL AVERAGES for the countries the route crosses.
 *
 * 🔴 WHY THIS IS NOT BESIDE THE FUEL STATION — AND WHY IT NOW WEARS A
 * BADGE SAYING SO.
 *
 * It is the European Commission's Weekly Oil Bulletin (CAMP-55), and it
 * is a NATIONAL AVERAGE FOR A WEEK. Printed next to "Diskonttank,
 * 614 m" it would read as what that pump charges. So it sits at route
 * level, against the country, with the Thursday it was published.
 *
 * That placement was the whole defence until CAMP-154, and placement is
 * not enough any more. Since that card, some fuel rows DO carry a real
 * per-station price — three countries' worth — so the same page now
 * shows two kinds of number that look alike, and a reader who scrolled
 * past the station price and landed here has no positional cue left.
 * Hence `AVERAGE_BADGE`, printed where it cannot be missed, and a
 * prose line that names the difference outright.
 *
 * 🔴 The badge is a CONSTANT shared with the spec, and the spec asserts
 * it against the RENDERED HTML with tags stripped — not against a
 * class name, not against an `sr-only` caption. A check must not assert
 * a property it cannot see, and this project has already shipped a
 * price panel whose every visible marker had been deleted while 457
 * tests stayed green.
 */
export function RouteFuelPrices({ prices }: { prices: RouteFuelPrice[] }) {
  if (prices.length === 0) return null;
  const bulletin = new Date(FUEL_BULLETIN_DATE).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div
      className="mt-6 rounded-card border border-line-2 bg-surface-2 p-4"
      data-testid="route-fuel-prices"
    >
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
        What a litre costs on this route
        {/* 🔴 The badge, in the heading, before any number is read.
            Not a footnote under the list: a reader who takes the first
            figure as a pump price has already been misled by the time a
            footnote could correct them. */}
        <span
          className="ml-2 rounded-full border border-line-2 bg-surface px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-normal text-ink-2"
          data-testid="country-average-badge"
        >
          {AVERAGE_BADGE}
        </span>
      </h3>
      <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {prices.map((c) => (
          <li key={c.code} className="text-ink-2">
            <span className="font-semibold text-heading">{c.name}</span>
            {' — '}
            {/* 🔴 A country with no price for one fuel says so rather
                than borrowing the other. lib/fuel.ts keeps them as
                separate nullable numbers for exactly this. */}
            {c.diesel !== null ? `diesel €${c.diesel.toFixed(3)}` : 'diesel not reported'}
            {', '}
            {c.petrol !== null ? `petrol €${c.petrol.toFixed(3)}` : 'petrol not reported'}
          </li>
        ))}
      </ul>
      {/* Identical on every route page (the bulletin is one weekly
          publication), so it is boilerplate to the duplicate guard. The
          prices themselves are above and are NOT marked: they differ per
          route and are exactly what the guard should compare. */}
      <p
        className="mt-2 max-w-prose text-xs leading-5 text-ink-3"
        data-boilerplate="fuel-bulletin"
      >
        {/* 🔴 THIS SENTENCE WAS FALSE THE MOMENT CAMP-154 MERGED, and
            correcting it is part of the card rather than tidying after
            it. It used to end "we hold no per-station prices, and we are
            not going to guess at one." We now hold them for Spain,
            France and Italy — so leaving the old wording would have the
            page denying, in print, the prices printed a few lines
            above it. */}
        The national consumer average published by the European Commission for
        the week of <time dateTime={FUEL_BULLETIN_DATE}>{bulletin}</time>, taxes
        included. It is a figure for the whole country and for that week — not
        for any station listed above. Where we do hold the price on a particular
        forecourt, it is printed on that station&rsquo;s own row with the day it
        was measured and the ministry that published it; three countries publish
        per station on terms that let us, and for the other twenty-four this
        average is all anyone has.
        {/* 🔴 The attribution string itself, not a paraphrase. CC BY 4.0
            is a condition on reuse, and components/fuel-price-table.tsx
            prints the same FUEL.attribution for the same reason. A
            second, shorter wording here would be a second thing to keep
            right. */}{' '}
        Source: {FUEL_ATTRIBUTION},{' '}
        <a className="underline" href={FUEL_SOURCE}>
          published every Thursday
        </a>
        .
      </p>
    </div>
  );
}

export default function RouteStageServices({
  group,
  looked,
  now,
}: {
  group: StageServices | undefined;
  /**
   * 🔴 The build's clock, passed in from the page. Every station price
   * on one route page is dated against the SAME instant; a component
   * calling `new Date()` for itself would date two stages differently
   * and could show one as fresh and its neighbour as stale on the same
   * second. It is also what makes the staleness wording testable.
   */
  now: Date;
  /**
   * 🔴 Whether we actually asked. See RouteServicesResult — without this
   * the block rendered seven "our database holds none within 25 km"
   * lines per stage whenever the API call failed, which on a seven-stage
   * route is 49 false statements about the ground.
   */
  looked: boolean;
}) {
  if (!looked) {
    return (
      <div className="mt-4" data-testid="stage-services">
        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
          Between here and the next stop
        </h4>
        {/* 🔴 "We could not look" — which is a fact about US, and is a
            different statement from "there is nothing here", which is a
            fact about the ground that we would have no basis for. The
            rest of the page is unaffected: the stages, the campsites and
            the reasons are all still there. */}
        <p
          className="mt-2 max-w-prose text-sm leading-6 text-ink-3"
          data-testid="stage-services-unavailable"
        >
          We could not reach our own database when this page was built, so
          there is nothing to show here. That is a fault of ours, not a
          statement that this stop has no fuel, water or shops.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4" data-testid="stage-services">
      <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
        Between here and the next stop
      </h4>
      <dl className="mt-1">
        {SERVICE_KINDS.map((kind) => (
          <ServiceRow
            key={kind}
            kind={kind}
            point={serviceOf(group, kind)}
            now={now}
          />
        ))}
      </dl>
      {/* 🔴 The selection rule on the page, as the campsite list states
          its own. It is the ODbL Produced Work boundary and it is also
          the plain truth: this is one of each, not a listing.

          🔴 Marked boilerplate for the near-duplicate guard, which is
          what the attribution and licence lines already do. It is
          word-for-word the same on every stage of every route, which is
          the guard's stated rule for the attribute — it is a promise we
          make about every stop, not a statement about this one.
          Measured on the twelve route pages before marking anything:
          the services block moved the family's worst pair from 11.9% to
          12.6% against a ceiling of 80%, so this is headroom rather
          than a rescue. */}
      <p
        className="mt-2 max-w-prose text-xs leading-5 text-ink-3"
        data-boilerplate="route-services-selection"
      >
        The nearest one of each, from OpenStreetMap, within{' '}
        {formatKm(SERVICE_RADIUS_M)}. Opening
        hours are printed in OpenStreetMap&rsquo;s own syntax, unchanged — we do
        not translate them into &ldquo;open now&rdquo;, because most of them
        carry seasons and exceptions a rewrite would lose. We have not phoned
        ahead, and we hold no ratings or photographs of these places.
      </p>
    </div>
  );
}
