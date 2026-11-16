import Link from 'next/link';
import { SPOT_TYPE_LABEL, type PlanB } from '@/lib/api';
import { TrustMark } from '@/components/trust';
import { fieldOrigin, trustOf, type Origin, type TrustStatus } from '@/lib/trust';

// CAMP-524 — «If it's full here»: up to three other places within 15 km.
//
// 🔴 IT NEVER SAYS A PLACE HAS ROOM. We hold no availability data for any
// campsite, and the block says so in its own words: these are places to
// try, nothing more. The words "available", "free spots" and "vacancy"
// do not appear, and a test reads the served HTML for them.
//
// 🔴 NO RANKING SENTENCE, NO BLOCK. The order is a ranking, and the
// sentence that explains it (Dir. 2005/29/EC art. 7(4a)) comes from the
// same API module that builds the ORDER BY. A response without it is not
// drawn at all rather than drawn with an unexplained order.
//
// 🔴 EMPTY IS NOT DRAWN. No candidate within the radius — no block, no
// "nothing found" heading promising something that is not there.

// 🔴 THE WORDS ARE DERIVED, NEVER TYPED (CAMP-521). Each figure names what
// stands behind it and `trustOf` turns that into the word:
//   distance — worked out by us from two coordinates       → derived
//   height   — worked out by us from the elevation model   → derived
//   type     — the record's own imported field             → import
// Handing the block another origin changes the word; a test proves it.
export interface PlanBOrigins {
  distance: Origin;
  height: Origin;
  type: Origin;
}
export const PLAN_B_ORIGINS: PlanBOrigins = {
  distance: { kind: 'derived', sourceId: 'osm' },
  height: { kind: 'derived', sourceId: 'copernicus-dem' },
  // The API does not send the alternative's source list, so only the
  // fact that it is an imported field is known: no age, no "outdated".
  type: fieldOrigin({}, 'type'),
};

/** The words this block puts on a page, for the page's legend. */
export function planBStatuses(
  planB: PlanB | null | undefined,
  origins: PlanBOrigins = PLAN_B_ORIGINS,
): TrustStatus[] {
  if (!planB || !planB.ranking || planB.items.length === 0) return [];
  const out = [trustOf(origins.distance), trustOf(origins.type)];
  if (planB.items.some((i) => i.elevation !== null)) out.push(trustOf(origins.height));
  return out;
}

const km = (m: number): string =>
  m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;

function height(item: PlanB['items'][number]): string | null {
  if (item.elevation === null) return null;
  const d = item.elevationDelta;
  // Under 10 m the DEM (90 m cells) cannot tell the two apart.
  const rel =
    d === null || Math.abs(d) < 10
      ? ''
      : d > 0
        ? ` (+${d} m higher)`
        : ` (${-d} m lower)`;
  return `${item.elevation} m above sea level${rel}`;
}

export default function PlanBBlock({
  planB,
  origins = PLAN_B_ORIGINS,
}: {
  planB: PlanB | null | undefined;
  /** A seam for the test that proves the words are derived; production passes none. */
  origins?: PlanBOrigins;
}) {
  const dist = trustOf(origins.distance);
  const kind = trustOf(origins.type);
  const high = trustOf(origins.height);
  const mark = (st: TrustStatus) => (
    <>
      {' '}
      <TrustMark status={st} className="text-xs text-ink-2" />
    </>
  );
  if (!planB || !planB.ranking || planB.items.length === 0) return null;
  return (
    <section className="mt-8" data-testid="plan-b">
      <h2 className="text-xl md:text-[25px]">If it&rsquo;s full here</h2>
      <div className="mt-3">
        <p className="text-sm text-ink-2" data-testid="plan-b-note">
          We do not know whether any of these has room &mdash; we hold no
          information on who is staying where. They are other places within{' '}
          {planB.radiusM / 1000} km in a straight line, worth a call or a look.
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {planB.items.map((i) => {
            const h = height(i);
            // One word at the end of the line when every figure on it has
            // the same status; a word beside each figure when they differ.
            const words = h ? [kind, dist, high] : [kind, dist];
            const each = new Set(words).size > 1;
            return (
              <li
                key={i.slug}
                className="rounded-card border border-line-2 bg-surface p-4 shadow-card"
                data-testid="plan-b-item"
              >
                <Link href={i.path} className="font-semibold text-heading hover:underline">
                  {i.name ?? SPOT_TYPE_LABEL[i.type as keyof typeof SPOT_TYPE_LABEL] ?? 'Campsite'}
                </Link>
                <p className="mt-1 text-sm text-ink-2">
                  {SPOT_TYPE_LABEL[i.type as keyof typeof SPOT_TYPE_LABEL] ?? 'Campsite'}
                  {each ? mark(kind) : null} ·{' '}
                  <span className="tabular-nums">{km(i.metres)}</span> away
                  {each ? mark(dist) : null}
                  {h ? (
                    <>
                      {' '}
                      · <span className="tabular-nums">{h}</span>
                      {each ? mark(high) : null}
                    </>
                  ) : null}
                  {each ? null : mark(kind)}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-ink-2" data-testid="plan-b-ranking">
          {planB.ranking}
        </p>
        {/* Origin of the figures, in a sentence (the trust-status ledger
            lists this block as NOT_YET: no per-figure status word). The
            elevation credit is repeated here because a page whose OWN
            surroundings carry no height still prints other places'. */}
        <p className="mt-1 text-xs text-ink-2" data-testid="plan-b-origin">
          Distances are straight lines between points in our OpenStreetMap-based
          records, not driving distances.
          {planB.items.some((i) => i.elevation !== null) ? (
            <>
              {' Heights are approximate, from the '}
              <a
                href="https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model"
                className="underline"
                rel="noopener"
              >
                Copernicus elevation model
              </a>
              {' (90 m grid), reached through '}
              <a href="https://open-meteo.com/" className="underline" rel="noopener">
                Open-Meteo
              </a>
              .
            </>
          ) : null}
        </p>
      </div>
    </section>
  );
}
