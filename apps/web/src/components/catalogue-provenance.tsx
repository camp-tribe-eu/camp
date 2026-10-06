import {
  needsAiDisclosure,
  PROVENANCE_LABEL,
  type Guide,
  type GuideProvenance,
} from '@/lib/guides';

// CAMP-210 — a catalogue of machine-written pages is machine-written.
//
// 🔴 CI CAUGHT THE FIRST HALF, NOT ME. `check-guide-disclosure.mjs` reads
// every built page under `/guides` and refuses one that does not say how
// it was made. The new facet pages failed it on the first run.
//
// My instinct was that the guard's scope is articles and these are
// indexes — the hub at `/guides` is skipped for exactly that reason, and
// skipping these too would have been one line. That instinct was wrong.
// The hub lists titles; a facet page lists titles AND the summary under
// each one, and those summaries are sentences a program wrote about
// campsites. A page made of machine-written prose is machine-written
// however it was assembled.
//
// 🔴 AND REVIEW CAUGHT THE SECOND HALF: the first version of this
// component printed a FALSE statement. The label was derived from the
// data and the prose was not — it was the `data-generated` sentence,
// hard-coded, ending "nothing here is … a sentence a model invented".
// Rendered on a page holding one `ai-generated` guide it read:
//
//   Written by a machine … Nothing here is … a sentence a model invented.
//
// Both halves on one line, the second one false. The mirror case was as
// bad: one human-written guide among machine ones and the block claimed
// "every title and summary … a program wrote the sentence" directly
// above a card labelled "Written by a person".
//
// So the prose is now counted, not asserted. It says what is on the page
// because it is built from what is on the page.

/** The strongest disclosure among what this page actually lists. */
function strongest(kinds: Set<GuideProvenance>): GuideProvenance | null {
  // 🔴 Order matters: a page carrying one machine-written summary
  // discloses as machine-written, even if everything else on it was
  // written by a person. The weaker claim would be true of most of the
  // page and false of the part that needs saying.
  const order: GuideProvenance[] = [
    'ai-generated',
    'ai-assisted',
    'data-generated',
    'human',
  ];
  return order.find((p) => kinds.has(p)) ?? null;
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

export function CatalogueProvenance({ guides }: { guides: readonly Guide[] }) {
  if (guides.length === 0) return null;

  const counts = new Map<GuideProvenance, number>();
  for (const g of guides) counts.set(g.provenance, (counts.get(g.provenance) ?? 0) + 1);
  const provenance = strongest(new Set(counts.keys()));
  if (!provenance) return null;

  const programs = [
    ...new Set(guides.map((g) => g.generator).filter((g): g is string => !!g)),
  ].sort();

  // One clause per kind actually present, in the order the labels declare
  // their seriousness. A kind with no guides contributes no sentence.
  const SENTENCE: Record<GuideProvenance, (n: number) => string> = {
    'ai-generated': (n) =>
      `${plural(n, 'was', 'were')} written by a language model and checked by a person`,
    'ai-assisted': (n) =>
      `${plural(n, 'was', 'were')} written by a person with help from a language model`,
    'data-generated': (n) =>
      `${plural(n, 'was', 'were')} written by a program that counted what our records hold`,
    human: (n) => `${plural(n, 'was', 'were')} written by a person`,
  };
  const order: GuideProvenance[] = [
    'ai-generated',
    'ai-assisted',
    'data-generated',
    'human',
  ];
  const clauses = order
    .filter((p) => (counts.get(p) ?? 0) > 0)
    .map((p) => SENTENCE[p](counts.get(p) as number));

  return (
    // 🔴 Before the listing, like the one on an article is before its
    // text. A mark a reader meets after reading is a mark in form only.
    <aside
      data-testid="provenance"
      data-provenance={provenance}
      className="mt-5 rounded-card border border-line-2 bg-surface-2 p-4 text-sm leading-6 text-ink-2"
    >
      <strong className="font-semibold text-heading">
        {PROVENANCE_LABEL[provenance]?.short ?? provenance}
      </strong>{' '}
      Of the titles and summaries on this page,{' '}
      {clauses.length === 1
        ? clauses[0]
        : `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}`}
      .{' '}
      {needsAiDisclosure(provenance) && programs.length > 0 && (
        <>
          {programs.length === 1 ? 'The program is ' : 'The programs are '}
          {programs.map((p, i) => (
            <span key={p}>
              {i > 0 && (i === programs.length - 1 ? ' and ' : ', ')}
              <code>{p}</code>
            </span>
          ))}
          .{' '}
        </>
      )}
      {/* 🔴 Only when it is true of everything here. This sentence was
          printed unconditionally and is false the moment one guide on the
          page came from a model. */}
      {counts.size === 1 && counts.has('data-generated') && (
        <>Nothing here is an opinion, an estimate or a sentence a model invented.</>
      )}
    </aside>
  );
}
