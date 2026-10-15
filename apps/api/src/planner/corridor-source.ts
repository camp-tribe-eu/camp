import { CorridorProvider, straightCorridor } from './corridor';

// CAMP-46 — the ONE place the planner chooses where distances come from.
// The counterpart of apps/web/src/lib/plan-source.ts, which does the same for
// the page.
//
// Today: the great-circle arc between A and B, `measure: 'straight'`.
//
// 🔴 When a router exists, this line is replaced by a provider that asks it
// (and caches by rounded A, B and profile — one corridor serves every
// variation of days), and the type `Measure` in corridor.ts gains 'road'.
// Nothing in split-days.ts, itinerary.ts' selection, scoring.ts or the SQL
// changes, and a spec (itinerary.db.spec.ts) hands the itinerary a different
// provider and shows the nights follow it: the seam is exercised, not
// described.
export const buildCorridor: CorridorProvider = straightCorridor;
