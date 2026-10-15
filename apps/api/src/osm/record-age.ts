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
  | 'missing'
  | 'not-an-integer'
  | 'before-openstreetmap'
  | 'in-the-future'
  | 'no-object';

/**
 * One edit of one OpenStreetMap object: WHICH object, WHEN a mapper last
 * edited it, and the version that edit made. One value, so the three cannot
 * be separated.
 *
 * 🔴 `ref` IS NOT OPTIONAL, AND THE TYPE IS ONE OBJECT, NOT THREE FIELDS. A
 * merged row takes the NEWEST of its objects' edits (`mergedRecord`) while it
 * stays keyed on the kept object. Review, 16.10.2026: a way `w2` (2012,
 * version 9) and a node `n1` that adds no tag (2026-09-30, version 2) gave
 * `osm_ref = w2`, date 2026-09-30, version 2 — a pair that is in the history
 * of NO object `osm_ref` points at, and nothing on the row said so. A date
 * and a version carried as two optional fields drift away from the object they
 * describe the next time somebody touches one of them; an edit that has no
 * `ref` does not compile, and a function that returns an edit returns it whole.
 *
 * `ref` is an OSM object id in the same spelling as `camping_spots.osm_ref`
 * (`n123`, `w456`, `a789`) — the handle a person looks the pair up by.
 *
 * (Not a union with a "not known" shape, which would be tidier: this
 * workspace compiles with `strictNullChecks: false`, where `null` is a value of
 * every type and such a union cannot tell a date from a missing one — measured
 * 16.10.2026 with `@ts-expect-error` lines that the compiler called unused.
 * "Not known" is therefore the ABSENCE of the whole edit, `edit: null`, which
 * no spelling of a half-edit can imitate.)
 */
export interface RecordEdit {
  /** The object whose edit this is. */
  readonly ref: string;
  /** The day a mapper last edited that object. */
  readonly editedAt: Date;
  /**
   * That object's version at `editedAt`. `null` only when the extract did not
   * carry a usable one; a version with no date has nothing to be the version OF.
   */
  readonly version: number | null;
}

export interface RecordAge {
  /** `null` is "not known" — never a stand-in for another date. */
  readonly edit: RecordEdit | null;
  /** Why `edit` is null, when it is. Counted by the run, per kind. */
  readonly problem: RecordAgeProblem | null;
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
 * (`"@timestamp"`, `"@version"`) exactly as `pg` returned them, and the
 * OBJECT they belong to (`ref`, the staging row's own `osm_ref`).
 *
 * `runStartedAt` is the importer's own start, and the ONLY use made of it
 * is the upper bound: a timestamp later than the run that read it is not an
 * edit, whatever else it is.
 *
 * 🔴 `ref` IS REQUIRED, and a date whose object cannot be named is not a
 * date: a staging row with no id (it cannot be — the importer's own SELECT
 * drops those — but this is where the types end and `pg`'s `any` begins) reads
 * "not known", problem `no-object`, rather than a date nobody can look up.
 */
export function readRecordAge(
  rawTimestamp: unknown,
  rawVersion: unknown,
  runStartedAt: Date,
  ref: string,
): RecordAge {
  const none = (problem: RecordAgeProblem): RecordAge => ({
    edit: null,
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
  if (typeof ref !== 'string' || ref === '') return none('no-object');

  const version = wholeNumber(rawVersion);
  return {
    edit: {
      ref,
      editedAt: new Date(seconds * 1000),
      // 1 or more: an object's first version is 1, and 0 is how a missing
      // value looks after a careless cast.
      version: version !== null && version >= 1 ? version : null,
    },
    problem: null,
  };
}

/**
 * The edit date of ONE row that was built from SEVERAL OpenStreetMap objects:
 * the NEWEST of them — or "not known", if any of them has no date.
 *
 * 🔴 WHY NOT THE KEPT OBJECT'S. The importer merges a campsite mapped twice (a
 * node and the way around it) into one row, keeping the way's id and filling
 * the way's gaps from the node's tags. A row's tags are therefore a UNION, and
 * a date taken from the kept object alone can be OLDER than a tag it displays:
 * measured 15.10.2026 on the 27 extracts, 516 merged clusters, and in 162 of
 * them a merged-away object had been edited after the kept one (123 database
 * rows changed date when the importer was switched to the newest). A caption that says
 * "last edited 2019" over a tag somebody added in 2026 states something about
 * the world that is not true, and reads as a fact. The newest date is never
 * older than anything the row shows.
 *
 * And if ANY contributing object has no usable date, the row has none: a date
 * from the others would say nothing about what the undated one contributed.
 *
 * 🔴 THE RESULT IS ONE OBJECT'S EDIT, WHOLE — date, version AND `ref` — so
 * the pair stays verifiable: `ref` is where to look it up, and it is NOT
 * always the row's `osm_ref`. When the merged-away object is the newer one,
 * the row is still keyed on the kept object but its date, its version and its
 * `ref` are the merged-away object's. (Returning the date and the version of
 * one object and the id of another is the one thing this function must never
 * do; the result is one of the two inputs, never assembled field by field.)
 *
 * A tie keeps the first argument — the kept object, so `ref` stays `osm_ref`
 * unless a merged-away object is STRICTLY newer.
 */
export function mergedRecord(
  kept: RecordAge | undefined,
  other: RecordAge | undefined,
): RecordAge | undefined {
  // Rows built by hand in specs carry no record at all; there is nothing to merge.
  if (kept === undefined && other === undefined) return undefined;
  if (!kept?.edit || !other?.edit) {
    return {
      edit: null,
      problem: kept?.problem ?? other?.problem ?? 'missing',
    };
  }
  return other.edit.editedAt.getTime() > kept.edit.editedAt.getTime()
    ? other
    : kept;
}

/** Records edited within this long of the run are "recent" for the verdict. */
export const RECENT_WINDOW_HOURS = 48;

/**
 * Fewer dated records than this say nothing about a country.
 *
 * 🔴 TEN, and it was a hundred. A hundred left every small country the importer
 * could not judge, and a substituted date loaded there without a word: review
 * watched Malta take the load date while Austria was refused.
 *
 * 🔴 WHAT TEN RESTS ON IS A PROPERTY, NOT A NUMBER: the floor must sit at or
 * below the smallest country we hold, whatever that is today, so that no
 * country goes unjudged. The sizes below are a SNAPSHOT of live data, and they
 * move with every import:
 *
 *   camptribe_dev, 16.10.2026 — dated, live rows per `country` (the grouping
 *   scripts/osm-pipeline/edit-date-distribution.sql §4 uses):
 *
 *     SELECT country, count(*) FROM camping_spots
 *      WHERE osm_ref IS NOT NULL AND missing_since IS NULL
 *        AND osm_record_edited_at IS NOT NULL
 *      GROUP BY country ORDER BY 2, 1 LIMIT 4;
 *     → MT 13, AX 19, CY 55, LU 82
 *
 * (`camptribe_camp256`, a scratch copy of the same data, held LU 83 that day:
 * one row is dated there and not on dev. Earlier comments here said 13, 14 and
 * 83 for the same countries; there is one number per fact now, and it carries
 * its date.) At ten, every code dev holds a date for is judged: 28 of them on
 * 16.10.2026, `AX` — Åland, a code of its own — among them.
 *
 * The tests pin the PROPERTY — every size from the floor up is judged, none
 * below — and not these four numbers (`record-age.spec.ts`,
 * `record-edited.db.spec.ts`).
 *
 * The floor is not zero for one reason: with a handful of records, "nine of
 * ten were edited this week" is one mapper's afternoon, not a verdict. At
 * ten it is still possible and still cheap — a refused country is retried
 * after the 48 hours have passed, and the refusal names what it saw. This is a
 * judgement, not a measurement: the measured part is the other side of the
 * line (no country's real data is anywhere near 90% recent; Finland, with a
 * mass edit, is 13.7%).
 *
 * `scripts/osm-pipeline/edit-date-distribution.sql` carries the same floor, and
 * `record-edited.db.spec.ts` runs that file's statement against this function
 * and fails if the two disagree.
 */
export const MIN_RECORDS_TO_JUDGE = 10;

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
 * Only DATED records are judged, and only when there are enough of them
 * (MIN_RECORDS_TO_JUDGE): "all four were edited this week" is a Tuesday, not a
 * verdict.
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
