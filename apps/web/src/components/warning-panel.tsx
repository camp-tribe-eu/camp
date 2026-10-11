import {
  areaNames,
  creditLine,
  levelWord,
  DISCLAIMER,
  FRESH_FOR_MINUTES,
  issuedAt,
  METEOALARM_URL,
  NO_FRESH_DATA,
  noFreshDataSentence,
  OURS,
  timeLabel,
  type WarningState,
} from '@/lib/warnings';

// CAMP-150 — the official weather warning beside a campsite.
//
// 🔴 A COMPONENT WITH PROPS AND NO HOOKS, like `DroughtPanel` and for the
// same reason: everything a reader is told here is a licence matter, so a
// check has to be able to read exactly the HTML a reader gets, by calling
// this once per state. Thirty lines of JSX inside a page could not be
// read that way, and `tests/unit/warning-panel.spec.ts` renders every
// state this can be in.
//
// 🔴 AND IT IS NEVER EMPTY. `warningState` has three answers and this
// draws all three. There is no branch that returns `null`, deliberately:
// a blank space where a warning panel belongs reads as "all clear", and
// that is the state somebody takes a high-sided van onto a pass in. The
// two public MeteoAlarm endpoints serve expired records as current by
// default, up to 5.5 days old (docs/road-hazard-sources.md §1), so
// "nothing shown" is a likely outcome rather than a hypothetical one.
//
// 🔴 EVERY WORD ABOUT THE WEATHER COMES FROM THE SERVICE. The hazard,
// its name, the area and the time are printed as the source wrote them.
// The one sentence that is ours says so and makes no claim about
// conditions — see `OURS`. We mirror a warning; we never issue one.

export function WarningPanel({
  state,
  className = '',
}: {
  state: WarningState;
  className?: string;
}) {
  return (
    <section
      data-testid="warnings"
      data-state={state.kind}
      aria-labelledby="warnings-heading"
      className={`mt-8 ${className}`.trim()}
    >
      <h2 id="warnings-heading" className="text-lg font-semibold text-heading">
        Official weather warnings
      </h2>

      {state.kind === 'warnings' ? (
        <ul className="mt-3 space-y-3">
          {state.warnings.map((w) => {
            const areas = areaNames(w);
            const issued = timeLabel(issuedAt(w));
            return (
              <li
                key={w.id}
                data-testid="warning"
                data-level={w.level ?? ''}
                className="rounded-card border border-line-2 bg-surface-2 p-4"
              >
                <p className="font-semibold text-heading">
                  {/* The source's own words for the hazard, untranslated. */}
                  {w.event ?? w.headline ?? w.type}
                </p>
                {/* 🔴 The severity, as a WORD. Only 32.6% of published
                    warnings name their level in the text above, so without
                    this a red warning and a yellow one read identically —
                    and a colour alone would fail WCAG 1.4.1 for the readers
                    who cannot use it. The word is the service's own. */}
                {levelWord(w) && (
                  <p data-testid="warning-level" className="mt-1 text-sm text-ink-2">
                    Level {w.level} of 4, which {w.sender ?? 'the issuing service'}{' '}
                    calls <span className="font-medium">{levelWord(w)}</span>.
                  </p>
                )}
                {areas.length > 0 && (
                  <p className="mt-1 text-sm text-ink-2">{areas.join(', ')}</p>
                )}
                {/* 🔴 Clause 5.4 — the time of ISSUE. `sent`, not `onset`:
                    the two differ by a median of 16.7 hours on the live
                    feeds, so the wrong one is wrong by most of a day. */}
                {issued && (
                  <p className="mt-2 text-sm text-ink-2">
                    Issued <time dateTime={issuedAt(w) ?? undefined}>{issued}</time>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      ) : state.kind === 'clear' ? (
        // 🔴 A measurement, not a reassurance, and worded as one: it says
        // what was read and when, and claims nothing beyond that moment.
        <p className="mt-3 text-sm leading-6 text-ink-2">
          No official warning was in force for this area when we last read the
          feed, {timeLabel(state.fetchedAt)}.
        </p>
      ) : (
        // 🔴 The sixth element. Never a blank space.
        <p
          data-testid="warnings-no-fresh-data"
          className="mt-3 text-sm leading-6 text-ink-2"
        >
          <strong className="font-semibold text-heading">{NO_FRESH_DATA}</strong>{' '}
          {noFreshDataSentence(state)}
        </p>
      )}

      {/* ---- the four things the licence requires, on every state ---- */}
      <p className="mt-3 text-sm leading-6 text-ink-2">
        {/* Clauses 5.2 and 5.3: who issued what is above. */}
        {/* 🔴 The NAME is the element, not "Source: " plus the name, and
            review is why. The credit test read the whole panel's text, and
            the severity line below each warning prints the service's name
            too ("Level 2 of 4, which DHMZ … calls yellow"). So deleting
            the credit entirely left all twenty tests green: a line added
            later, for a different reason, had quietly satisfied a guard
            that mutation had proved three commits earlier. A guard stays
            proved only until something else prints the same string. */}
        Source:{' '}
        <span data-testid="warnings-credit">{creditLine(state)}</span>
        {', via '}
        {/* Clause 5.5: the link itself, not a brand name that happens to
            be a link — the clause names the URL. */}
        <a
          href={METEOALARM_URL}
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          www.meteoalarm.org
        </a>
        .
      </p>

      {/* Clause 5.7, word for word. Shortening it is a breach, not an edit. */}
      <p data-testid="warnings-disclaimer" className="mt-2 text-sm leading-6 text-ink-2">
        {DISCLAIMER}
      </p>

      {/* 🔴 The only sentence on this panel that is ours, and it is about
          us rather than about the weather. */}
      <p data-testid="warnings-ours" className="mt-2 text-sm leading-6 text-ink-2">
        {OURS}
      </p>

      <p className="mt-2 text-xs text-ink-3">
        Warnings are redistributed within {FRESH_FOR_MINUTES} minutes of
        publication or not at all.
      </p>
    </section>
  );
}
