// CAMP-255 — what a reader is told about staying the night.
//
// The API decides the answer (osm/tag-mapping.ts `mapOvernight`, gated in
// spots/overnight.ts). This file is the WEB side of the same rule: how an
// answer is read off the wire, how it is worded, and what a reader is told
// to check when there is none.
//
// 🔴 THE THREE STATES, AND THE ONE THAT MATTERS. `unknown` is "nobody wrote
// it down where we could read it". On this question that is the large
// majority of places, and printing it as `forbidden` turns away a customer
// the site could have sent, while printing it as `allowed` is a fine in
// our name. It is never rewritten into either, and it is never hidden: it
// is a sentence on the page.

export type OvernightStatus = 'allowed' | 'forbidden' | 'unknown';

export interface OvernightFacts {
  status: OvernightStatus;
  /** `osm:motorhome=yes`. Non-null exactly when `status` is not unknown. */
  source: string | null;
  /** `YYYY-MM-DD`: the day we last read that source's tag. */
  checkedAt: string | null;
}

export const UNKNOWN_OVERNIGHT: OvernightFacts = {
  status: 'unknown',
  source: null,
  checkedAt: null,
};

/**
 * The sources that may stand behind an answer, by the id before the colon.
 * Only OpenStreetMap today. An id missing from this list is NOT published
 * as an answer — a claim whose source we cannot name in words is a claim
 * without a source, which is the one thing this card forbids.
 */
export const OVERNIGHT_SOURCES: Record<string, { name: string; url: string }> = {
  osm: { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/' },
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An API payload → what the page may print.
 *
 * 🔴 The second lock on "no source, no claim". The API already refuses to
 * send an answer without one (a CHECK in the table, a gate in every
 * query), and this refuses again on the way to the screen, because
 * `getSpot` is a cached `res.json()` and the API deploys separately: an
 * older payload has no `overnight` at all, and that must read as "not
 * known" — true about a page that never asked — never as a crash and
 * never as a no.
 */
export function readOvernight(raw: unknown): OvernightFacts {
  if (typeof raw !== 'object' || raw === null) return UNKNOWN_OVERNIGHT;
  const { status, source, checkedAt } = raw as Record<string, unknown>;
  if (
    (status === 'allowed' || status === 'forbidden') &&
    typeof source === 'string' &&
    typeof checkedAt === 'string' &&
    DAY.test(checkedAt) &&
    !Number.isNaN(new Date(`${checkedAt}T00:00:00Z`).getTime()) &&
    describeOvernightSource(source) !== null
  ) {
    return { status, source, checkedAt };
  }
  return UNKNOWN_OVERNIGHT;
}

/** `osm:motorhome=yes` → who, and which tag. Null when it is not nameable. */
export function describeOvernightSource(
  source: string,
): { name: string; url: string; tag: string } | null {
  const at = source.indexOf(':');
  if (at <= 0) return null;
  const known = OVERNIGHT_SOURCES[source.slice(0, at)];
  const tag = source.slice(at + 1);
  if (!known || tag === '' || /\s/.test(tag)) return null;
  return { ...known, tag };
}

/** `2026-10-12` → "12 October 2026", in UTC so no time zone moves the day. */
export function formatOvernightDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The three words, as a reader reads them. */
export const OVERNIGHT_LABEL: Record<OvernightStatus, string> = {
  allowed: 'Allowed',
  forbidden: 'Not allowed',
  unknown: 'Not known',
};

/**
 * What to check when nobody has told us — the card's own three, in the
 * order a person arriving at a place meets them.
 *
 * 🔴 Fixed text, identical on every page that has no answer, and marked
 * `data-boilerplate` where it is rendered (the duplicate-page guard).
 */
export const OVERNIGHT_CHECKLIST: readonly { what: string; detail: string }[] = [
  {
    what: 'Signs at the place',
    detail:
      'a no-overnight, no-camping or no-motorhome sign at the entrance or along the road in',
  },
  {
    what: 'The municipal rule',
    detail:
      'many towns and regions ban overnight parking or camping by local ordinance, and it is usually on the municipality’s website',
  },
  {
    what: 'Seasonal or time limits',
    detail:
      'a maximum stay, a closed season, or hours when staying is not allowed',
  },
];

/**
 * 🔴 The words for a country or region where nothing is known — and the
 * words for a country where something is, from OUR rows and with the day
 * they were read.
 *
 * `known` is allowed + forbidden. `unknown` is what is left, derived here
 * and nowhere else, so the three can never add up to something else.
 * No share is computed: "2%" of a denominator that moves is a number
 * that is wrong by next Monday, and the page already says how many.
 */
export interface OvernightCoverage {
  spots: number;
  allowed: number;
  forbidden: number;
  unknown: number;
  /** `YYYY-MM-DD`, or null when no campsite has been read at all. */
  readAt: string | null;
}

export interface RegionOvernightCounts {
  spots: number;
  overnightAllowed?: number;
  overnightForbidden?: number;
  overnightReadAt?: string | null;
}

export function overnightCoverage(
  regions: readonly RegionOvernightCounts[],
): OvernightCoverage {
  let spots = 0;
  let allowed = 0;
  let forbidden = 0;
  let readAt: string | null = null;
  for (const r of regions) {
    spots += r.spots;
    // An API that does not send the counts has told us nothing about
    // overnight stay, and nothing is the right thing to add up: the
    // places stay unknown rather than being counted as anything.
    allowed += r.overnightAllowed ?? 0;
    forbidden += r.overnightForbidden ?? 0;
    const day = r.overnightReadAt;
    if (typeof day === 'string' && DAY.test(day) && (readAt === null || day > readAt)) {
      readAt = day;
    }
  }
  // Never negative, never more than the whole: a payload that disagrees
  // with itself is clamped, and the rest is unknown BY SUBTRACTION — so
  // the three always add up to `spots` and unknown is never counted as
  // anything.
  const a = Math.max(0, Math.min(allowed, spots));
  const f = Math.max(0, Math.min(forbidden, spots - a));
  return { spots, allowed: a, forbidden: f, unknown: spots - a - f, readAt };
}
