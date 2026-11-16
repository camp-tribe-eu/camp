// CAMP-524 — the Plan B ranking, kept apart from `plan-b.ts` with NO
// IMPORTS at all, so the web can test the sentence it prints against the
// exact one the API builds without pulling the API's entities into the web
// build (that broke \`tsc\` in apps/web on PR #595). \`plan-b.ts\` re-exports it.

/** Straight-line radius. 15 km is the card's figure, not a tuned one. */
export const PLAN_B_RADIUS_M = 15_000;
/** At most this many alternatives are shown. */
export const PLAN_B_LIMIT = 3;
/** Types that are a different character from a classic paid campsite. */
export const OTHER_CHARACTER_TYPES = ['camper_stop', 'free', 'wild'] as const;

interface Criterion {
  key: 'character' | 'higher' | 'nearer';
  /** The words the reader gets for this step. */
  words: string;
  /** ORDER BY fragment over the columns of the inner select. */
  order: string;
}

/**
 * First criterion wins; each later one only separates ties. The order of
 * this array IS the order of the sentence.
 */
export const PLAN_B_CRITERIA: readonly Criterion[] = [
  {
    key: 'character',
    words: 'camper stops, free and wild places before paid campsites',
    order: `(CASE WHEN type IN (${OTHER_CHARACTER_TYPES.map((t) => `'${t}'`).join(', ')}) THEN 0 ELSE 1 END)`,
  },
  {
    key: 'higher',
    words:
      'places higher than this campsite (where both heights are known) before the rest',
    order: '(CASE WHEN elevation > here_elevation THEN 0 ELSE 1 END)',
  },
  {
    key: 'nearer',
    words: 'then the nearest first',
    order: 'metres',
  },
];

/** The sentence printed beside the block. */
export const PLAN_B_RANKING = `Ranked by, in this order: ${PLAN_B_CRITERIA.map((c) => c.words).join('; ')}. Nothing else moves a place up.`;
