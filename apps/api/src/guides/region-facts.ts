// CAMP-66: guides assembled from what we measured, not from what we think.
//
// 🔴 The card asks for 100–200 guide pages. This file is the honest
// answer to that number, and the number it produces is smaller.
//
// Counted on 23.09.2026 across 3 147 campsites: there are 36 region/theme
// pairs where at least five campsites carry recorded data. Not 200. The
// remaining 164 would have to be written about places where nobody has
// recorded anything, and a page that says "we do not know whether any of
// these campsites take dogs" fifty times over is not content — it is the
// same admission repeated until Google notices.
//
// The number grows on its own as the data does: France is two regions of
// thirteen so far, and the computed surroundings cover 289 campsites of
// 3 147. Nothing here needs rewriting for that to happen.
//
// 🔴 Every sentence a guide contains is a count from the database. There
// is no prose that is not a number, a name we hold, or a plain statement
// of what is missing. That is what makes these publishable under our own
// rules — and what makes `provenance = 'data-generated'` an accurate
// label rather than a disclaimer.

/** Below this a theme has nothing to say about a region. */
export const MIN_SUBJECTS = 5;

export type Theme = {
  id: string;
  /** Appears in the slug: /guides/{country}-{region}-{id}. */
  title: (region: string) => string;
  /** The question a reader came with. */
  question: string;
  /** SQL predicate over `camping_spots` that selects the subjects. */
  predicate: string;
  /** What the count means, for the summary line. */
  noun: string;
};

/**
 * The themes we can support with data we hold.
 *
 * 🔴 Each one is a question somebody actually asks, and each one is
 * answerable from a column. A theme we cannot answer from a column does
 * not belong here however good an article it would make — that is what
 * the human-written guides are for, and they need a human.
 */
export const THEMES: Theme[] = [
  {
    id: 'motorhome',
    title: (r) => `Motorhome stopovers in ${r}`,
    question:
      'Which places here are set up for a motorhome rather than a tent?',
    predicate: `type IN ('rv_park', 'camper_stop')`,
    noun: 'motorhome stopovers and RV parks',
  },
  {
    id: 'dogs',
    title: (r) => `Campsites in ${r} that take dogs`,
    question:
      'Which campsites here have actually recorded that dogs are welcome?',
    predicate: `amenities ->> 'dogFriendly' = 'yes'`,
    noun: 'campsites recorded as dog-friendly',
  },
  {
    id: 'classified',
    title: (r) => `Four- and five-star campsites in ${r}`,
    question: 'Which campsites here carry a high official classification?',
    predicate: `stars >= 4`,
    noun: 'campsites with four or five official stars',
  },
  {
    id: 'accessible',
    title: (r) => `Step-free campsites in ${r}`,
    question: 'Which campsites here have recorded wheelchair access?',
    predicate: `amenities ->> 'wheelchair' = 'yes'`,
    noun: 'campsites with recorded wheelchair access',
  },
  {
    id: 'water',
    title: (r) => `Campsites by the water in ${r}`,
    question: 'Which campsites here are within walking distance of water?',
    predicate: `(context -> 'water' ->> 'm')::int < 500`,
    noun: 'campsites within 500 m of a lake, river or the sea',
  },
];

export type RegionFacts = {
  country: string;
  region: string;
  theme: Theme;
  /** Campsites matching the theme. */
  subjects: number;
  /** Campsites in the region at all. */
  total: number;
  /** Of `total`, how many have nothing recorded for this theme. */
  unknown: number;
  /** A few named examples, longest-recorded first. */
  examples: { name: string; slug: string; detail: string | null }[];
};

export function slugFor(facts: RegionFacts, regionSlug: string): string {
  return `${facts.country.toLowerCase()}-${regionSlug}-${facts.theme.id}`;
}

/**
 * The guide's own words.
 *
 * 🔴 Deliberately plain and deliberately short. It is not trying to read
 * like an article a person wrote, because it is not one — the label says
 * so, and writing it in a chatty voice to disguise that would be the
 * dishonesty the label exists to prevent.
 *
 * The one thing it does that no competitor does is state the gap: how
 * many campsites in this region have NOTHING recorded for this question.
 * That number is usually the largest on the page, and printing it is the
 * whole argument for trusting the rest.
 */
export function compose(facts: RegionFacts): {
  title: string;
  summary: string;
  body: string;
} {
  const { region, theme, subjects, total, unknown, examples } = facts;
  const title = theme.title(region);

  const summary =
    `${subjects} of ${total} campsites in ${region} are ${theme.noun}. ` +
    (unknown > 0
      ? `Nobody has recorded anything about this for ${unknown} of them, so the real number is at least ${subjects}.`
      : `Every campsite in ${region} has this recorded.`);

  const lines: string[] = [];
  lines.push(theme.question);
  lines.push('');
  lines.push(summary);
  lines.push('');

  if (examples.length > 0) {
    lines.push('Some of them:');
    for (const e of examples) {
      lines.push(`- ${e.name}${e.detail ? ` — ${e.detail}` : ''}`);
    }
    lines.push('');
  }

  // 🔴 The paragraph that makes this honest rather than merely accurate.
  lines.push(
    unknown > 0
      ? `This is a count of what has been recorded, not a count of what exists. ` +
          `${unknown} campsites in ${region} carry no answer to this question at all, ` +
          `and any of them may belong on this list. We show gaps as gaps rather than ` +
          `guessing, so an absence here means nobody wrote it down — never that the answer is no.`
      : `This is a count of what has been recorded. Every campsite in ${region} carries ` +
          `an answer to this question, which is unusual and worth saying.`,
  );
  lines.push('');
  lines.push(
    'Nobody from CampTribe has visited these campsites. Check with the ' +
      'campsite before you rely on any of it.',
  );

  return { title, summary, body: lines.join('\n') };
}

/** Is this pair worth a page? */
export function worthPublishing(
  facts: RegionFacts,
  min = MIN_SUBJECTS,
): boolean {
  return facts.subjects >= min;
}
