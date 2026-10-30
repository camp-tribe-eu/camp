'use client';

import { useEffect, useId, useState } from 'react';
import { Button, buttonClasses } from '@/components/button';
import {
  CONTACT_HINT,
  EMPTY_DRAFT,
  KIND_LABEL,
  MAX_CONTACT,
  MAX_DESCRIPTION,
  PROBLEM_KINDS,
  messageFor,
  requestBody,
  sendReport,
  validateDraft,
  type DraftProblem,
  type ReportDraft,
  type ReportOutcome,
} from '@/lib/problem-report';

// «Report a problem» — the form on a campsite page.
//
// 🔴 A CLIENT COMPONENT ON A STATIC PAGE, and that is the whole design. The
// campsite pages are built once for all 63 thousand of them; this island
// renders its closed state into that HTML and only talks to the API after
// the page is already on screen, from the reader's browser. Nothing here
// reads a request — not the headers, not the cookies, not the query — and
// `report-problem.spec.tsx` walks the page's import graph to keep it so.
//
// 🔴 `<details>`, NOT A MODAL AND NOT STATE. The button that opens the form
// is a `<summary>`: it works before hydration and without JavaScript at all
// (the fields inside are disabled until the form is live, and say so, as on
// /plan). A reader without scripts can at least read what we would ask.
//
// Copy is English: the first step of the arbitration the owner asked for — a
// person says the data is wrong, we look. Nothing is changed automatically.

const LABEL = 'block text-sm font-medium text-ink-2';
const HINT = 'mt-1 text-sm text-ink-2';
const FIELD =
  'mt-1 w-full rounded border border-line-2 bg-surface px-3 py-2 text-ink focus:border-line-blue disabled:opacity-60';

type Phase =
  | { kind: 'editing'; problems: DraftProblem[]; outcome: ReportOutcome | null }
  | { kind: 'sending' }
  | { kind: 'sent' };

export default function ReportProblem({ slug }: { slug: string }) {
  const id = useId();
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<ReportDraft>(EMPTY_DRAFT);
  const [phase, setPhase] = useState<Phase>({
    kind: 'editing',
    problems: [],
    outcome: null,
  });

  useEffect(() => setReady(true), []);

  const problems = phase.kind === 'editing' ? phase.problems : [];
  const problemFor = (field: DraftProblem['field']) =>
    problems.find((p) => p.field === field)?.message ?? null;

  const submit = async () => {
    const found = validateDraft(draft);
    if (found.length > 0) {
      setPhase({ kind: 'editing', problems: found, outcome: null });
      return;
    }
    setPhase({ kind: 'sending' });
    const outcome = await sendReport(requestBody(slug, draft));
    if (outcome === 'sent') setPhase({ kind: 'sent' });
    else setPhase({ kind: 'editing', problems: [], outcome });
  };

  const busy = phase.kind === 'sending';
  const disabled = !ready || busy;

  return (
    <section className="mt-8" data-testid="report-problem">
      <details className="group rounded-card border border-line-2 bg-surface p-5 shadow-card">
        <summary className={buttonClasses('secondary', 'sm', 'ct-disclosure cursor-pointer')}>
          Report a problem
        </summary>

        {phase.kind === 'sent' ? (
          <p role="status" className="mt-4 max-w-prose text-sm">
            {messageFor('sent')}
          </p>
        ) : (
          <form
            noValidate
            className="mt-4 max-w-md"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <p className="max-w-prose text-sm text-ink-2">
              Spotted something wrong on this page — a campsite that has
              closed, a pin in the wrong place, a price that has changed? Tell
              us and a person will check it. Nothing on the page changes until
              we have.
            </p>
            {!ready && (
              <p className={HINT}>
                The form comes alive when the page finishes loading.
              </p>
            )}

            {phase.kind === 'editing' && phase.outcome && (
              <p role="alert" className="mt-3 rounded border border-warn/40 bg-warn/5 p-3 text-sm">
                <span className="font-semibold">Error:</span>{' '}
                {messageFor(phase.outcome)}
              </p>
            )}

            <div className="mt-4">
              <label className={LABEL} htmlFor={`${id}-kind`}>
                What is wrong?
              </label>
              <select
                id={`${id}-kind`}
                className={FIELD}
                value={draft.kind}
                disabled={disabled}
                required
                aria-invalid={problemFor('kind') ? true : undefined}
                onChange={(e) =>
                  setDraft({ ...draft, kind: e.target.value as ReportDraft['kind'] })
                }
              >
                <option value="">Choose one…</option>
                {PROBLEM_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              {problemFor('kind') && (
                <p className="mt-1 text-sm text-warn">{problemFor('kind')}</p>
              )}
            </div>

            <div className="mt-4">
              <label className={LABEL} htmlFor={`${id}-description`}>
                Tell us more
              </label>
              <textarea
                id={`${id}-description`}
                className={FIELD}
                rows={4}
                value={draft.description}
                disabled={disabled}
                required
                maxLength={MAX_DESCRIPTION}
                aria-invalid={problemFor('description') ? true : undefined}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
              {problemFor('description') && (
                <p className="mt-1 text-sm text-warn">{problemFor('description')}</p>
              )}
            </div>

            <div className="mt-4">
              <label className={LABEL} htmlFor={`${id}-contact`}>
                How can we reach you? <span className="font-normal">(optional)</span>
              </label>
              <input
                id={`${id}-contact`}
                className={FIELD}
                type="text"
                autoComplete="off"
                value={draft.contact}
                disabled={disabled}
                maxLength={MAX_CONTACT}
                aria-describedby={`${id}-contact-hint`}
                aria-invalid={problemFor('contact') ? true : undefined}
                onChange={(e) => setDraft({ ...draft, contact: e.target.value })}
              />
              <p id={`${id}-contact-hint`} className={HINT}>
                {CONTACT_HINT}
              </p>
              {problemFor('contact') && (
                <p className="mt-1 text-sm text-warn">{problemFor('contact')}</p>
              )}
            </div>

            <p className="mt-5">
              <Button type="submit" variant="primary" size="md" disabled={disabled}>
                {busy ? 'Sending…' : 'Send report'}
              </Button>
            </p>
          </form>
        )}
      </details>
    </section>
  );
}
