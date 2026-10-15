import {
  describeOvernightSource,
  formatOvernightDay,
  OVERNIGHT_CHECKLIST,
  OVERNIGHT_LABEL,
  readOvernight,
} from '@/lib/overnight';

// CAMP-255 — may a motorhome stay the night here. Said outright, in one of
// three ways, and never left out.
//
// 🔴 THE PAGE ALWAYS ANSWERS. A section that renders only when there is
// something to say would make the commonest case — we do not know — look
// exactly like a page that never thought of the question, and a reader
// would fill the silence with the answer they hoped for. So `unknown` is a
// sentence, with a list of what to check, and not an absence.
//
// 🔴 A CLAIM WITHOUT A SOURCE IS NOT PRINTED. `readOvernight` turns an
// answer that has no nameable source or no date into `unknown` before any
// of this runs, so there is no code path here that prints "Allowed"
// without saying who said it and when.
//
// 🔴 NO COLOUR CARRIES THE ANSWER. The word is the answer; a reader who
// cannot tell a green from a red is told the same thing (WCAG 1.4.1). And
// no green tick: the card's own sentence is that a green icon without a
// source is a fine written in our name.
//
// 🔴 `data-boilerplate` marks ONLY text that is word for word the same on
// every page it appears on. The duplicate-page guard looks away from
// marked blocks, and the page-specific part — the answer, the tag, the day
// — is left unmarked on purpose, so marking cannot become the way to make
// a thin page look different.

export default function OvernightStay({ overnight }: { overnight: unknown }) {
  const facts = readOvernight(overnight);
  const source =
    facts.status === 'unknown' || facts.source === null
      ? null
      : describeOvernightSource(facts.source);

  return (
    <section
      data-testid="overnight-stay"
      data-status={facts.status}
      aria-labelledby="overnight-heading"
      className="mt-6 rounded-card border border-line-2 bg-surface p-5 shadow-card"
    >
      <h2 id="overnight-heading" className="text-base font-semibold">
        Staying the night in a motorhome
      </h2>

      {facts.status !== 'unknown' && source && facts.checkedAt ? (
        <>
          <p className="mt-2 max-w-prose text-sm" data-testid="overnight-answer">
            <strong className="font-semibold text-heading">
              {OVERNIGHT_LABEL[facts.status]}
            </strong>
            {' — '}according to{' '}
            <a
              href={source.url}
              className="underline"
              rel="noopener noreferrer"
              target="_blank"
            >
              {source.name}
            </a>{' '}
            (<code>{source.tag}</code>), read on{' '}
            <time dateTime={facts.checkedAt}>
              {formatOvernightDay(facts.checkedAt)}
            </time>
            .
          </p>
          <p
            className="mt-2 max-w-prose text-xs leading-5 text-ink-2"
            data-boilerplate="overnight-sourced-caveat"
          >
            This is what a mapper recorded, not a ruling, and it can be out of
            date. Signs at the place and the local rules still decide.
          </p>
        </>
      ) : (
        <>
          <p
            className="mt-2 max-w-prose text-sm"
            data-testid="overnight-answer"
            data-boilerplate="overnight-unknown"
          >
            <strong className="font-semibold text-heading">
              {OVERNIGHT_LABEL.unknown}.
            </strong>{' '}
            We have no source that says whether a motorhome may stay the night
            here. That is a gap in the data, not a no.
          </p>
          <div data-boilerplate="overnight-checklist">
            <p className="mt-3 text-sm font-medium text-heading">
              Check on the spot or before you go
            </p>
            <ul className="mt-1 max-w-prose list-disc space-y-1 pl-5 text-sm text-ink-2">
              {OVERNIGHT_CHECKLIST.map((item) => (
                <li key={item.what}>
                  <strong className="font-semibold text-heading">
                    {item.what}
                  </strong>
                  {' — '}
                  {item.detail}.
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
