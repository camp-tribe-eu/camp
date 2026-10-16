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
// That is enforced as a PROPERTY, not as a list of words: the visible text
// of the block is compared, in full and by equality, with the template
// (tests/unit/record-edited-text.spec.ts on the component,
// tests/unit/record-edited.spec.ts on the rendered page). A sentence ADDED
// to any grade — in any words — breaks the equality; a word list is beaten
// by the next synonym, and the first version of this guard, which compared
// the caption and checked the fixed sentence by `toContain`, was beaten by a
// sentence simply appended.
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
//
// 🔴 A record that comes only from DATAtourisme has no OpenStreetMap date, but
// the SOURCE dates it: `sources[].updatedAt` of the `datatourisme` entry is the
// source system's own last-update day (see `SourceInfo.datesAre`). It is shown
// in the same words with the source's name beside it — and only for a source
// the registry marks `edited`. The OpenStreetMap entry's `updatedAt` is the
// other date again, and is never read here.

import { SOURCES } from '@/lib/sources';

/** A year, for the grade. Not 365.25: the boundaries below are whole days a test can point at. */
export const YEAR_DAYS = 365;

/** OpenStreetMap began in August 2004; an earlier date is not an edit. */
const OSM_EPOCH_MS = Date.UTC(2004, 7, 1);

/**
 * The earliest date accepted from a source that dates its own records.
 *
 * 🔴 NOT the OpenStreetMap floor. DATAtourisme's legacy records carry real
 * dates from 2002 (the oldest of 8 752, measured 15.10.2026: 2002-05-24), and
 * applying 2004-08 to them would turn the oldest records — the ones a reader
 * most needs to see dated — into "Not known". 1995 only has to refuse the
 * values a failed cast produces (1970, year 1).
 */
const SOURCE_EPOCH_MS = Date.UTC(1995, 0, 1);

/** How far ahead of the page's clock an edit may be (build clock vs OSM's). */
const FUTURE_SLACK_MS = 86_400_000;

const OSM_SOURCE = { id: 'osm', name: 'OpenStreetMap' } as const;

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
      /**
       * Whose date this is. `osm` for the OpenStreetMap edit date; otherwise
       * the id and display name of the source whose own date it is
       * (DATAtourisme). Always set: a date is never printed without it.
       */
      source: { id: string; name: string };
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
export function recordAge(
  raw: unknown,
  now: Date,
  source: { id: string; name: string } = OSM_SOURCE,
): RecordAgeView {
  if (typeof raw !== 'string') return { known: false };
  const at = new Date(raw);
  const ms = at.getTime();
  if (Number.isNaN(ms)) return { known: false };
  if (ms < (source.id === 'osm' ? OSM_EPOCH_MS : SOURCE_EPOCH_MS)) {
    return { known: false };
  }
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
    source,
  };
}


/**
 * Which date the page prints under "Record last edited", and whose it is.
 *
 * The OpenStreetMap edit date wins where there is one. Where there is none —
 * every record that comes only from DATAtourisme, which has no OSM object —
 * the source's OWN date for the record is used instead, with the source named
 * beside it so a reader sees whose record is meant.
 *
 * 🔴 WHICH `sources[].updatedAt` MAY BE READ IS DECIDED BY THE REGISTRY, not by
 * this function: only a source whose `datesAre` is `edited`. The OpenStreetMap
 * entry carries `updatedAt` too — the day OUR importer last looked, this week
 * for nearly every campsite — and reading "any source's updatedAt" would put
 * exactly that under the label. An id the registry does not know is not read
 * either: an unknown source's date has an unknown meaning.
 *
 * `sources` is the API's, unchecked (absent, malformed entries and all); a
 * malformed entry is skipped, never guessed at.
 */
export function recordEdit(
  osmRecordEditedAt: unknown,
  sources: unknown,
  now: Date,
): RecordAgeView {
  const osm = recordAge(osmRecordEditedAt, now);
  if (osm.known) return osm;

  const entries = Array.isArray(sources) ? sources : [];
  // Sorted by id, so two sources with an edit date never depend on array order.
  const dated = entries
    .filter(
      (e): e is { id: string; updatedAt: unknown } =>
        typeof e === 'object' && e !== null && typeof e.id === 'string',
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const entry of dated) {
    const info = SOURCES[entry.id];
    if (!info || info.datesAre !== 'edited') continue;
    const view = recordAge(entry.updatedAt, now, {
      id: info.id,
      name: info.name,
    });
    if (view.known) return view;
  }
  return { known: false };
}
