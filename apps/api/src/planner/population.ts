import { notSecondarySql } from '../spots/links';

// CAMP-262: which campsites the planner may ever suggest.
//
// A stop has to lead to a page, so a row qualifies when it is not
// missing, has a region (without one `canonicalPath` returns null and
// there is no URL) and is not a secondary hidden behind a primary.
//
// 🔴 ONE DEFINITION, because two numbers have to agree: the coverage the
// weights are checked against (measure-coverage.ts) and the pool the
// ablation ranks (ablate-scoring.ts). A coverage measured on one set and a
// formula applied to another is how "every field is well covered" stays
// true on paper. `RoutesService.near` spells the same three conditions out
// inline, in its own statement; this is the shared form for the planner's
// code, and measure-coverage.db.spec.ts runs it against rows that break
// each condition in turn.
export const plannerPopulationSql = (alias: string): string =>
  `${alias}.missing_since IS NULL AND ${alias}.region IS NOT NULL AND ${notSecondarySql(alias)}`;
