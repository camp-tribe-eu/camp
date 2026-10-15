// CAMP-255: what a reader is told about staying the night — the READ side.
//
// The WRITE side (OSM tags → status, source) is `mapOvernight` in
// osm/tag-mapping.ts, and the invariant that ties them is in the
// migration: a status other than `unknown` has a source and a date, and
// `unknown` has neither.
//
// 🔴 This file is where "no source, no claim" is applied for everyone who
// READS. Four queries ask the question — the page, the map markers, the
// map filter and the region counts — and when each wrote its own `CASE`
// they would have agreed until somebody edited one. So there is ONE
// definition in SQL (`overnightStatusSql`), used by all four, and ONE in
// TypeScript (`toOvernightView`) for the single-row page; and
// overnight.db.spec.ts drives both from the same table of cases, so the
// two cannot drift apart without a test turning red.

import { OVERNIGHT_STATUSES, type OvernightStatus } from '../osm/tag-mapping';

export { OVERNIGHT_STATUSES };
export type { OvernightStatus };

/**
 * The status as a reader may see it, as a SQL expression over a table
 * that has the three columns.
 *
 * 🔴 `unknown` is the ELSE, so anything this does not recognise — a new
 * status word from a half-deployed migration, a status with its source
 * missing — reads as "we do not know", never as an answer. The fail-safe
 * direction is the whole design.
 *
 * `alias` qualifies the columns (`s` in every query here). Left empty it
 * writes them bare, for a caller whose FROM has no alias.
 */
export function overnightStatusSql(alias = ''): string {
  const col = (name: string) => (alias ? `${alias}.${name}` : name);
  return `(CASE
      WHEN ${col('overnight_status')} IN ('allowed', 'forbidden')
       AND ${col('overnight_source')} IS NOT NULL
       AND ${col('overnight_checked_at')} IS NOT NULL
      THEN ${col('overnight_status')}
      ELSE 'unknown'
    END)`;
}

/**
 * What the campsite page carries.
 *
 * `source` and `checkedAt` are non-null exactly when `status` is not
 * `unknown` — the page prints them beside the claim, and a claim with no
 * source is not printed at all.
 */
export interface OvernightView {
  status: OvernightStatus;
  /** `osm:motorhome=yes`. */
  source: string | null;
  /** `YYYY-MM-DD`: the day we last read that source's tag. */
  checkedAt: string | null;
}

export const UNKNOWN_OVERNIGHT: OvernightView = {
  status: 'unknown',
  source: null,
  checkedAt: null,
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One row of `SPOT_DETAIL_SQL` → the page's view.
 *
 * Total: anything it cannot read as a complete, sourced answer is
 * `unknown`. `overnight_checked_at` is expected as a `YYYY-MM-DD` string
 * (the query formats it with `to_char`) — `pg` would otherwise hand back a
 * JS `Date` at local midnight, and a date that shifts by a day with the
 * server's time zone is not a date we can print next to a claim.
 */
export function toOvernightView(row: Record<string, unknown>): OvernightView {
  const status = row.overnight_status;
  const source = row.overnight_source;
  const day = row.overnight_checked_at;
  if (
    (status === 'allowed' || status === 'forbidden') &&
    typeof source === 'string' &&
    source !== '' &&
    typeof day === 'string' &&
    DAY.test(day)
  ) {
    return { status, source, checkedAt: day };
  }
  return UNKNOWN_OVERNIGHT;
}

/**
 * The day, formatted in SQL, for the single-row query. Kept beside the
 * reader of it so a change to one is seen with the other.
 */
export const OVERNIGHT_DAY_SQL = (alias: string): string =>
  `to_char(${alias}.overnight_checked_at, 'YYYY-MM-DD')`;
