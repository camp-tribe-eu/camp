// CAMP-256 — how long ago somebody last touched a campsite's record in
// OpenStreetMap, as the page says it.
//
// 🔴 THE SENTENCE IS "WHEN SOMEBODY LAST TOUCHED IT", NOT "THIS IS OLD".
// The card forbids two readings and this file is where they would creep
// in. An edit date says nothing about whether the entry is right: a
// campground whose name, tap and fee have not changed in six years has an
// old record and a correct one, and a record edited yesterday can have
// been vandalised. So the words say what the date IS ("last edited"), the
// age is said as a plain span of time, and no word in this file means
// "stale", "outdated", "old data", "unreliable" or "may be wrong".
// `record-edited.spec.tsx` reads the rendered page for each of them.
//
// 🔴 NOTHING IS HIDDEN. The grade (within a year / one to three years /
// more than three) is a caption beside the date, never a reason to leave
// the date out and never a filter. A record last edited in 2011 is shown
// with its month and the caption.
//
// 🔴 THIS IS NOT `lastSeenAt`. That is the day our importer last found
// the place, and it moves every week; the date here moves only when a
// mapper edits. Nothing in this file accepts `lastSeenAt`, and a missing
// edit date is "Not known", never the other date.

/** A year, for the grade. Not 365.25: the boundaries below are whole days a test can point at. */
export const YEAR_DAYS = 365;

/** OpenStreetMap began in August 2004; an earlier date is not an edit. */
const OSM_EPOCH_MS = Date.UTC(2004, 7, 1);

/** How far ahead of the page's clock an edit may be (build clock vs OSM's). */
const FUTURE_SLACK_MS = 86_400_000;

export type RecordAgeBand = 'fresh' | 'one-to-three' | 'over-three';

/** The caption beside the date. Plain spans of time; no verdict in any of them. */
export const BAND_CAPTION: Record<RecordAgeBand, string> = {
  fresh: 'within the last year',
  'one-to-three': 'between one and three years ago',
  'over-three': 'more than three years ago',
};

export type RecordAgeView =
  | { known: false }
  | {
      known: true;
      band: RecordAgeBand;
      /** `YYYY-MM-DD`, UTC — for `<time dateTime>`. */
      day: string;
      /** "June 2023", UTC — what a reader reads. */
      month: string;
      /** One of BAND_CAPTION. */
      caption: string;
    };

/**
 * The grade of an edit that is `days` old.
 *
 * Whole days, floored: day 364 is still "within the last year", day 365 is
 * the first of "one to three", and day 1095 (three of them) the first of
 * "more than three". The tests pin each edge, because an off-by-one here
 * moves thousands of pages between captions.
 */
export function bandFor(days: number): RecordAgeBand {
  if (days < YEAR_DAYS) return 'fresh';
  if (days < 3 * YEAR_DAYS) return 'one-to-three';
  return 'over-three';
}

/**
 * What the page says about one campsite's OSM edit date.
 *
 * `raw` is whatever the API sent, unchecked: an ISO instant, `null`, or
 * nothing at all. Anything that is not a date OpenStreetMap could have
 * produced is "not known" — an unparseable string, a date before the
 * project existed, a date more than a day past `now`. A date is never
 * guessed at and never replaced by another.
 *
 * UTC throughout, so the build machine's time zone cannot move a record
 * across a month boundary: a record saved at 23:30 UTC on 31 May is May.
 */
export function recordAge(raw: unknown, now: Date): RecordAgeView {
  if (typeof raw !== 'string') return { known: false };
  const at = new Date(raw);
  const ms = at.getTime();
  if (Number.isNaN(ms)) return { known: false };
  if (ms < OSM_EPOCH_MS) return { known: false };
  if (ms > now.getTime() + FUTURE_SLACK_MS) return { known: false };

  // A date a little ahead of the clock is "today", not minus one.
  const days = Math.max(0, Math.floor((now.getTime() - ms) / 86_400_000));
  const band = bandFor(days);
  return {
    known: true,
    band,
    day: at.toISOString().slice(0, 10),
    month: at.toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    caption: BAND_CAPTION[band],
  };
}
