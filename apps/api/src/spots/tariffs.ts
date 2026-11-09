// CAMP-147: which tariffs may leave this API, and in what order.
//
// 🔴 THE RULE, IN ONE PLACE, AND IT IS A REFUSAL.
//
// A price without a validity period must never reach a page. The card is
// explicit about why: a tariff valid 01.04–30.10 shown in November is
// not a price, it is history, and the reader concludes we lie. So the
// filter lives here, in SQL, on the way out of the database — not in the
// web layer, where it would be one component's opinion and the next
// consumer of /spots would not have it.
//
// 🔴 What that costs, measured after the import of 28.09.2026:
//
//     tariff rows stored                 12 402   on 3 212 campsites
//     ├─ carrying a validity period       6 780   on 1 200 campsites
//     └─ carrying none                    5 622
//
// Better than half the price list the feed publishes is undatable and is
// therefore not shown. The rows are kept rather than dropped at import,
// so that number stays re-measurable and the decision stays the owner's;
// `withheldTariffCountSql` below puts it on the page rather than letting
// the page quietly show a shorter list than the source has.

/**
 * A tariff a reader is allowed to see.
 *
 * Either end of the period is enough: "from 1 April, no stated end" and
 * "until 30 October" both date the price. Neither end is not a period.
 */
export const DATED_TARIFF_SQL =
  '(t.valid_from IS NOT NULL OR t.valid_until IS NOT NULL)';

/**
 * 🔴 CAMP-446. A PRICE THE FEED HAS STOPPED PUBLISHING IS NOT A PRICE.
 *
 * The import is `INSERT … ON CONFLICT DO UPDATE`: it refreshes every row
 * the feed names and never touches a row the feed stopped naming. So a
 * tariff survives the campsite removing it, changing its offer URI, or
 * disappearing from DATAtourisme altogether — and the reader sees it
 * beside the live ones, told apart only by a `sourceUpdatedAt` they have
 * no reason to read.
 *
 * Measured on production 09.11.2026, after the weekly timer had run:
 *
 *     fetched_at   rows
 *     2026-11-09   10 499   ← the feed still declares these
 *     2026-09-28    3 045
 *     2026-10-26       16
 *     ────────────────────
 *     total        13 560   of which 3 061 (22.6%) are orphans
 *
 * (The card estimated ~1 934 before a full timer run. `fetched_at` now
 * answers exactly, so the estimate is superseded rather than repeated.)
 *
 * 🔴 WHY THE THRESHOLD IS MEASURED FROM `max(fetched_at)` AND NOT FROM
 * `now()`. The import runs weekly. Between runs every row ages, and a
 * threshold anchored to `now()` would hide the whole table on the eighth
 * day after the last successful run — a missed timer would silently
 * delete every price from every page, which is far worse than showing
 * a stale one. Anchored to the newest row we hold, "stale" means "the
 * feed named other rows and not this one", which is the actual claim.
 *
 * 21 days = three weekly runs. Two missed runs change nothing; the third
 * starts dropping rows the feed has not confirmed in three weeks.
 *
 * 🔴 MEMORY: the subquery is uncorrelated, so PostgreSQL evaluates it
 * once as an InitPlan, not per row. Writing it as a correlated lookup
 * would turn a page render into one scan per tariff.
 */
export const TARIFF_STALE_AFTER_DAYS = 21;

const FRESH_TARIFF_SQL =
  `t.fetched_at >= (SELECT max(fetched_at) FROM spot_tariffs)` +
  ` - interval '${TARIFF_STALE_AFTER_DAYS} days'`;

export const DISPLAYABLE_TARIFF_SQL = `(${DATED_TARIFF_SQL} AND ${FRESH_TARIFF_SQL})`;

/**
 * 🔴 WITHHELD IS **NOT** `NOT DISPLAYABLE`, AND THE DIFFERENCE IS A LIE
 * AVOIDED. The sentence on the page reads: "The source publishes N
 * further prices for this campsite with no validity period." Of a row
 * the feed has stopped publishing, that sentence is false twice over —
 * the source publishes it no longer, and it may well have had a period.
 *
 * So withheld counts the undated rows that are still FRESH. A stale row
 * is not shown and is not counted anywhere on the page: it is gone from
 * the source, and the page says nothing about it rather than something
 * untrue.
 */
export const WITHHELD_TARIFF_SQL = `(NOT ${DATED_TARIFF_SQL} AND ${FRESH_TARIFF_SQL})`;

/** One line of a price list, as the API sends it. */
export interface TariffView {
  /** WHAT is priced — `BarePitch`, `CamperPitch`, `TouristTax`… */
  offer: string | null;
  /** HOW it is charged — `Overnight`, `PerWeek`, `PerPerson`… */
  mode: string | null;
  /** WHO it applies to — `BaseRateFullRate`, `ChildRate`, `Free`… */
  policy: string | null;
  /**
   * 🔴 Strings, not numbers, all the way to the page.
   *
   * The column is `numeric` because these are money. Turning it into a
   * JavaScript number here to turn it back into text there is two
   * conversions whose only possible contribution is 13.50 arriving as
   * 13.499999999999998.
   */
  minPrice: string | null;
  maxPrice: string | null;
  currency: string;
  /** At least one of these is set, or the row does not appear at all. */
  validFrom: string | null;
  validUntil: string | null;
  /** The operator's own words. Rendered verbatim with `lang`. */
  label: string | null;
  labelLang: string | null;
  /** Licence Ouverte: the day the source last changed this record. */
  sourceUpdatedAt: string;
  /** Which source published it, for the attribution the licence requires. */
  sourceId: string;
}

/**
 * The displayable tariffs of one campsite, as a JSON array.
 *
 * 🔴 The ORDER BY ends in `source_ref`, and that is not padding. Without
 * a total order two tariffs with the same season and the same floor
 * price swap places between builds, and a static site then rebuilds
 * thousands of pages whose only change is the order of two rows —
 * churning the sitemap's lastmod and telling crawlers the content moved
 * when it did not. The same lesson as `LINKED_SECONDARY_JOIN`.
 *
 * Cheapest first within a season, because "what does a night cost here"
 * is the question the table is being read to answer.
 */
export function tariffsSql(spotIdExpr: string): string {
  // 🔴 `json_build_object`, not `row_to_json` over a subquery. The first
  // version needed a `row_number()` column to order by and shipped it to
  // the browser inside every tariff — an internal sort key published as
  // though it were a fact about the campsite. Naming the keys here means
  // the payload contains exactly the fields `TariffView` declares.
  //
  // 🔴 And the order is DETERMINISTIC, with no CURRENT_DATE in it.
  // Sorting expired tariffs to the bottom in SQL would make this query's
  // output change every midnight, which on a statically built site
  // rewrites pages whose content did not change and tells crawlers so.
  // Which tariffs are expired is a question about the day the page is
  // rendered, and it is answered once, in web/src/lib/tariffs.ts.
  return `(
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'offer', t.offer,
          'mode', t.mode,
          'policy', t.policy,
          'minPrice', t.min_price::text,
          'maxPrice', t.max_price::text,
          'currency', t.currency,
          'validFrom', to_char(t.valid_from, 'YYYY-MM-DD'),
          'validUntil', to_char(t.valid_until, 'YYYY-MM-DD'),
          'label', t.label,
          'labelLang', t.label_lang,
          'sourceUpdatedAt', to_char(t.source_updated_at, 'YYYY-MM-DD'),
          'sourceId', t.source_id
        )
        ORDER BY t.valid_from NULLS LAST,
                 t.min_price  NULLS LAST,
                 t.source_ref
      ), '[]'::json)
      FROM spot_tariffs t
     WHERE t.spot_id = ${spotIdExpr}
       AND ${DISPLAYABLE_TARIFF_SQL}
  )`;
}

/**
 * How many of this campsite's tariffs were withheld for having no season.
 *
 * 🔴 Shown to the reader, not swallowed. A page that prints 3 of a
 * campsite's 11 tariffs and says nothing has quietly misrepresented the
 * price list; one that says "8 further tariffs are published without a
 * validity period" has told the truth about its own limits, and the
 * reader can go to the operator for the rest.
 */
export function withheldTariffCountSql(spotIdExpr: string): string {
  return `(
    SELECT count(*)::int FROM spot_tariffs t
     WHERE t.spot_id = ${spotIdExpr}
       AND ${WITHHELD_TARIFF_SQL}
  )`;
}
