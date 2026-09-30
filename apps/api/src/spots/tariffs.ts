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
export const DISPLAYABLE_TARIFF_SQL =
  '(t.valid_from IS NOT NULL OR t.valid_until IS NOT NULL)';

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
       AND NOT ${DISPLAYABLE_TARIFF_SQL}
  )`;
}
