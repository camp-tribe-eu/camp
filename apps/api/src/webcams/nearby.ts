// CAMP-190 — the webcams near one campsite, as SQL the spot query embeds.
//
// 🔴 HOW FAR IS "NEAR", AND WHY THIS NUMBER.
//
// Measured on 104 real campsites across all 27 member states
// (CAMP-189, 04.10.2026):
//
//   within  5 km   40% of campsites have one, median 0
//   within 10 km   61%,                      median 1
//   within 25 km   88%,                      median 8
//
// 25 km is where the layer stops being a curiosity for the Alps and
// becomes something nine campsites in ten can show. Past it the number
// keeps climbing, and the picture stops being about anywhere the reader
// is going.
//
// 🔴 AND THE PAGE MUST NEVER SAY THE CAMERA SHOWS THE CAMPSITE.
//
// At 25 km that is the next valley. The same rule as the air quality
// panel, which says "the nearest station is 12 km away" rather than "the
// air here is". So the distance travels with every row and the component
// is not free to drop it.

export const WEBCAM_RADIUS_M = 25_000;

/**
 * How many to offer.
 *
 * 🔴 Three, not all of them. The median campsite inside the radius has
 * eight and the busiest had 140; a page that listed them would be a
 * directory of somebody else's catalogue, which is CAMP-190's own
 * "Рішення 3 — ні". Three is enough to show a choice of directions and
 * still fit beside the rest of the page.
 */
export const WEBCAM_LIMIT = 3;

/**
 * The nearest cameras to a campsite, newest frame first among equals.
 *
 * 🔴 ORDERED BY DISTANCE, with `ref` breaking ties. Two cameras at the
 * same metre are rare and a build must be reproducible: without the
 * second key, PostgreSQL may return them in either order and two runs of
 * the same build produce two different pages, which the duplicate-page
 * and visual guards would both report as a change nobody made.
 *
 * 🔴 `last_frame_at` is passed through as a fact about the CAMERA and is
 * NOT used to hide anything here. Whether a frame is too old to show is
 * a question about the reader's clock, and a statically built page
 * outlives the import that fed it — so the page decides, exactly as it
 * does for air quality.
 */
export function nearbyWebcamsSql(
  spotLocationExpr: string,
  radiusM: number = WEBCAM_RADIUS_M,
  limit: number = WEBCAM_LIMIT,
): string {
  if (!Number.isInteger(radiusM) || radiusM <= 0) {
    throw new Error(`webcam radius must be a positive integer, got ${radiusM}`);
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`webcam limit must be a positive integer, got ${limit}`);
  }
  return `(
    SELECT coalesce(json_agg(w ORDER BY w.metres, w.ref), '[]'::json)
      FROM (
        SELECT c.ref,
               c.title,
               c.categories,
               c.detail_url   AS "detailUrl",
               c.provider_url AS "providerUrl",
               c.last_frame_at AS "lastFrameAt",
               round(ST_Distance(${spotLocationExpr}, c.location))::int AS metres
          FROM webcams c
         WHERE ST_DWithin(${spotLocationExpr}, c.location, ${radiusM})
         ORDER BY ${spotLocationExpr} <-> c.location, c.ref
         LIMIT ${limit}
      ) w
  )`;
}
