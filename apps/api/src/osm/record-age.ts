// CAMP-256: reading the day a mapper last edited an OpenStreetMap object
// out of a staging row — and refusing a load in which that day is really
// the day of the load.
//
// 🔴 THE FAILURE THIS FILE EXISTS FOR, in the card's own words: "if every
// record is suddenly 2026, the import wrote the load date instead of the
// OSM edit date. It is the most likely mistake here and it looks like
// success." Nothing throws. Every campsite page then says "Record last
// edited: October 2026", which is a confident, current, wrong sentence
// about every OpenStreetMap-sourced place.
//
// Two defences live here, and they ask different questions:
//
//   readRecordAge   is THIS value an OSM edit date? One record at a time,
//                   and a bad one costs that record its date, never the
//                   run.
//   loadDateVerdict do the dates of a whole country look like edit dates?
//                   A substituted date is wrong on every row at once, so
//                   no single row can show it. The importer runs it on
//                   what the TABLE holds, before COMMIT, not on what it
//                   meant to send.
//
// What OSM's `timestamp` is, because the page leans on it: the time the
// object's CURRENT VERSION was saved. It is UTC, in Unix seconds in the
// export (`osmium export -a timestamp`), and it belongs to the object's own
// record — tags and member list — not to the nodes a way is drawn through.

/** OpenStreetMap began in August 2004; no object it holds is older. */
export const OSM_EPOCH_SECONDS = Date.UTC(2004, 7, 1) / 1000;

/**
 * How far past the moment a run started a timestamp may be and still be an
 * edit. OSM stamps with its own server clock, ours may lag; a day is far
 * more than any skew and far less than any unit mistake.
 */
export const FUTURE_SLACK_SECONDS = 24 * 3600;

export type RecordAgeProblem =
  'missing' | 'not-an-integer' | 'before-openstreetmap' | 'in-the-future';

export interface RecordAge {
  /** `null` is "not known" — never a stand-in for another date. */
  editedAt: Date | null;
  /**
   * The object version `editedAt` belongs to. `null` whenever `editedAt`
   * is: a version with no date has nothing to be the version OF.
   */
  version: number | null;
  /** Why `editedAt` is null, when it is. Counted by the run, per kind. */
  problem: RecordAgeProblem | null;
}

/**
 * A whole non-negative number, from a JS number or from the digit string
 * `pg` hands back for an int8 column. Nothing else: not `"2026-08-28"`, not
 * `1.5`, not `"1e9"`.
 *
 * 🔴 No parsing of dates here. A staging column of text holding an ISO date
 * would come from some other producer than the one this was written
 * against, and guessing its format is how one date turns into another
 * without an error. It is refused, named, and counted.
 */
function wholeNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string' && /^[0-9]{1,15}$/.test(value)) {
    return Number(value);
  }
  return null;
}

/**
 * One record's edit date and version, from the two staging columns
 * (`"@timestamp"`, `"@version"`) exactly as `pg` returned them.
 *
 * `runStartedAt` is the importer's own start, and the ONLY use made of it
 * is the upper bound: a timestamp later than the run that read it is not an
 * edit, whatever else it is.
 */
export function readRecordAge(
  rawTimestamp: unknown,
  rawVersion: unknown,
  runStartedAt: Date,
): RecordAge {
  const none = (problem: RecordAgeProblem): RecordAge => ({
    editedAt: null,
    version: null,
    problem,
  });

  if (rawTimestamp === null || rawTimestamp === undefined) {
    return none('missing');
  }
  const seconds = wholeNumber(rawTimestamp);
  if (seconds === null) return none('not-an-integer');
  if (seconds < OSM_EPOCH_SECONDS) return none('before-openstreetmap');
  if (seconds > runStartedAt.getTime() / 1000 + FUTURE_SLACK_SECONDS) {
    return none('in-the-future');
  }

  const version = wholeNumber(rawVersion);
  return {
    editedAt: new Date(seconds * 1000),
    // 1 or more: an object's first version is 1, and 0 is how a missing
    // value looks after a careless cast.
    version: version !== null && version >= 1 ? version : null,
    problem: null,
  };
}

/** Records edited within this long of the run are "recent" for the verdict. */
export const RECENT_WINDOW_HOURS = 48;

/** Fewer dated records than this say nothing about a country. */
export const MIN_RECORDS_TO_JUDGE = 100;

/**
 * The share of recently-edited records at or above which a country's dates
 * are not edit dates.
 *
 * 🔴 WHERE THE NUMBER COMES FROM — the 27 extracts, measured 15.10.2026,
 * and the figures are in the pull request that added this, not here, where
 * they would be a claim nobody re-runs. The rule it has to satisfy is one
 * line: no country's real data may be near it, and a substituted date is
 * 100%. 0.9 sits at the top of that gap, so it trips only when the date is
 * (all but) the same everywhere.
 */
export const MAX_RECENT_SHARE = 0.9;

export interface RecentShare {
  /** Records that carry a date. */
  dated: number;
  /** Of those, how many were edited within RECENT_WINDOW_HOURS of the run. */
  recent: number;
}

export function recentShare(
  editedAts: ReadonlyArray<Date | null>,
  runStartedAt: Date,
): RecentShare {
  const windowMs = RECENT_WINDOW_HOURS * 3_600_000;
  let dated = 0;
  let recent = 0;
  for (const at of editedAts) {
    if (at === null) continue;
    dated++;
    // Not `abs()`: a date AFTER the run is refused upstream, and counting
    // one here as "recent" would be a second opinion about a value that
    // never reaches this function.
    if (runStartedAt.getTime() - at.getTime() <= windowMs) recent++;
  }
  return { dated, recent };
}

/**
 * Do these dates look like edit dates, or like the day somebody loaded
 * them? `null` is "fine"; a string is the reason to refuse the country.
 *
 * Only DATED records are judged, and only when there are enough of them:
 * Malta has 14, and "all fourteen were edited this week" is a Tuesday, not
 * a verdict.
 */
export function loadDateVerdict(
  editedAts: ReadonlyArray<Date | null>,
  runStartedAt: Date,
): string | null {
  const { dated, recent } = recentShare(editedAts, runStartedAt);
  if (dated < MIN_RECORDS_TO_JUDGE) return null;
  if (recent / dated < MAX_RECENT_SHARE) return null;
  return (
    `${recent} of ${dated} dated records claim an edit within ` +
    `${RECENT_WINDOW_HOURS} hours of this import. Real campsites are not ` +
    'edited like that; the date being written is the load date, not the ' +
    'OpenStreetMap edit date. Refusing the country rather than printing ' +
    'a confident, current, wrong date on every page.'
  );
}
