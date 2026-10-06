import {
  needsAiDisclosure,
  PROVENANCE_LABEL,
  type Guide,
  type GuideProvenance,
} from '@/lib/guides';

// CAMP-210 — a catalogue of machine-written pages is machine-written.
//
// 🔴 CI CAUGHT THIS, NOT ME. `check-guide-disclosure.mjs` reads every
// built page under `/guides` and refuses one that does not say how it
// was made. The new facet pages failed it on the first run:
//
//   ✗ hr: the page does not say how it was made
//   ✗ si: … ✗ accessible: … ✗ motorhome: … ✗ water: …
//
// My first instinct was that the guard's scope is articles and these are
// indexes — the hub at `/guides` is skipped for exactly that reason, and
// skipping these too would have been one line. That instinct was wrong.
// The hub lists titles; a facet page lists titles AND the summary under
// each one, and those summaries are sentences a program wrote about
// campsites. A page made of machine-written prose is machine-written
// however it was assembled.
//
// So the disclosure is real rather than a marker added to pass a check:
// it names the programs that produced what is on THIS page, read from
// the guides listed on it, not a constant typed here.

/** The strongest disclosure among what this page actually lists. */
function strongest(guides: readonly Guide[]): GuideProvenance | null {
  // Order matters: a page carrying one machine-written summary discloses
  // as machine-written, even if everything else on it was written by a
  // person. The weaker claim would be true of most of the page and false
  // of the part that needs saying.
  const order: GuideProvenance[] = [
    'ai-generated',
    'ai-assisted',
    'data-generated',
    'human',
  ];
  const present = new Set(guides.map((g) => g.provenance));
  return order.find((p) => present.has(p)) ?? null;
}

export function CatalogueProvenance({ guides }: { guides: readonly Guide[] }) {
  const provenance = strongest(guides);
  if (!provenance) return null;

  const label = PROVENANCE_LABEL[provenance];
  const programs = [
    ...new Set(guides.map((g) => g.generator).filter((g): g is string => !!g)),
  ].sort();

  return (
    // 🔴 Before the listing, like the one on an article is before its
    // text. A mark a reader meets after reading is a mark in form only.
    <aside
      data-testid="provenance"
      data-provenance={provenance}
      className="mt-5 rounded-card border border-line-2 bg-surface-2 p-4 text-sm leading-6 text-ink-2"
    >
      <strong className="font-semibold text-heading">
        {label?.short ?? provenance}
      </strong>{' '}
      Every title and summary on this page was produced the same way as the
      page it links to: a program counted what our records hold and wrote the
      sentence.{' '}
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
      Nothing here is an opinion, an estimate or a sentence a model invented.
    </aside>
  );
}
