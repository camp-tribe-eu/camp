// CAMP-325 — what to CALL `context.station`, in one place.
//
// 🔴 THE FIELD IS NOT ONLY STATIONS. `context.station` is filled from
// `railway=station` AND `railway=halt` (STATION_RAILWAY_VALUES in
// apps/api/src/osm/context-sql.ts), and the stored context does not say
// which: `{ m, name }`. A halt is a platform with no staff, no ticket
// office and usually no shelter. Measured 15.10.2026 on `camptribe_dev`:
// 3 163 of 9 838 entries (32.1%) stand on a halt, so a label that says
// "station" is wrong for one reader in three — and the reader it is
// wrong for is the one planning to arrive by train.
//
// The API already says "Railway stop" (apps/api/src/planner/reasons.ts)
// and the JSON-LD says "railway stop" (lib/jsonld.ts). This is the web
// side's single copy, so the visible row, the markup, the prose paragraph
// and the llms.txt line cannot drift apart again: PR #256 fixed two
// places and left five, which is how the page came to read "Nearest
// station" over markup that said "railway stop".
//
// Not for the other two "station"s on a campsite page, which are TRUE and
// stay as they are: the air-quality monitoring station
// (components/air-quality.tsx, lib/air-quality.ts) and the fuel station
// on a route.

/** Lower case, mid-sentence: "Lesce-Bled railway stop", "a railway stop". */
export const RAILWAY_STOP = 'railway stop';

/** Sentence-initial or a row label: "Railway stop". */
export const RAILWAY_STOP_TITLE = 'Railway stop';

/**
 * The words a searcher types, for a question that is true of both values:
 * "How far is the nearest railway station or stop?". It is a question,
 * not a label for the answer, so it may name both.
 */
export const RAILWAY_STATION_OR_STOP = 'railway station or stop';
