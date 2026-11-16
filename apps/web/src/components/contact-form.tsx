"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/button";
import { Block } from "@/components/layout";
import {
  EMPTY_DRAFT,
  LIMITS,
  messageFor,
  requestBody,
  sendContact,
  validateDraft,
  waitBeforeSending,
  type ContactDraft,
  type ContactOutcome,
  type DraftProblem,
} from "@/lib/contact-form";
import { CONTACT_EMAIL } from "@/lib/legal";

// «Write to us» — the form on /contact.
//
// 🔴 A CLIENT COMPONENT ON A STATIC PAGE, like components/report-problem.tsx:
// the page is built once; this island renders its not-yet-live state into
// that HTML and talks to the API only from the reader's browser, after
// hydration. Nothing here reads a request.
//
// 🔴 WITHOUT JAVASCRIPT THE FORM DOES NOT SUBMIT, AND SAYS SO. A plain POST
// would have to go to the API (another origin) and come back as JSON on a
// blank page, and the anti-spam minimum time cannot be measured without a
// script. So the fields are disabled until the page is live and the HTML
// carries a `<noscript>` line that gives the address: the reader never meets
// a button that does nothing, and never loses the way to write to us.
//
// 🔴 A PERSON IS NEVER «TOO FAST». The API drops a message sent less than
// three seconds after the form appeared (the same «thank you» a person gets).
// So the button waits out the remainder itself, showing «Sending…» — a pasted
// message with autofilled details is not silently lost.
//
// Layout follows the Fuse theme's contact section: a white card, name and
// email side by side from the `sm` breakpoint and one column below, subject
// and message full width, the button and the privacy sentence beneath.

const LABEL = "block text-sm font-medium text-ink-2";
const HINT = "mt-1 text-sm text-ink-2";
const FIELD =
  "mt-1 w-full rounded border border-line-2 bg-surface px-3 py-2 text-ink focus:border-line-blue disabled:opacity-60";

type Phase =
  | { kind: "editing"; problems: DraftProblem[]; outcome: ContactOutcome | null }
  | { kind: "sending" }
  | { kind: "sent" };

export default function ContactForm() {
  const id = useId();
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_DRAFT);
  const [phase, setPhase] = useState<Phase>({ kind: "editing", problems: [], outcome: null });
  // When the form became usable, on the browser's own clock.
  const openedAt = useRef(0);

  useEffect(() => {
    openedAt.current = performance.now();
    setReady(true);
  }, []);

  const problems = phase.kind === "editing" ? phase.problems : [];
  const problemFor = (field: DraftProblem["field"]) =>
    problems.find((p) => p.field === field)?.message ?? null;

  const submit = async () => {
    const found = validateDraft(draft);
    if (found.length > 0) {
      setPhase({ kind: "editing", problems: found, outcome: null });
      return;
    }
    setPhase({ kind: "sending" });
    const wait = waitBeforeSending(performance.now() - openedAt.current);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const outcome = await sendContact(requestBody(draft, performance.now() - openedAt.current));
    if (outcome === "sent") setPhase({ kind: "sent" });
    else setPhase({ kind: "editing", problems: [], outcome });
  };

  const busy = phase.kind === "sending";
  const disabled = !ready || busy;

  return (
    <section
      data-testid="contact-form"
      aria-labelledby={`${id}-title`}
      className="relative rounded-card border border-line-2 bg-white p-5 text-ink shadow-card sm:p-8 dark:bg-surface"
    >
      <h2 id={`${id}-title`} className="text-xl text-heading">
        Write to us
      </h2>

      {phase.kind === "sent" ? (
        <Block as="p" measure="read" role="status" className="mt-4">
          {messageFor("sent")}
        </Block>
      ) : (
        <form
          noValidate
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {!ready && (
            <p className={HINT}>The form comes alive when the page finishes loading.</p>
          )}
          <noscript>
            <p className={HINT}>
              This form needs JavaScript. Without it, write to us at{" "}
              <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </noscript>

          {phase.kind === "editing" && phase.outcome && (
            <p role="alert" className="mt-3 rounded border border-warn/40 bg-warn/5 p-3 text-sm">
              <span className="font-semibold">Error:</span> {messageFor(phase.outcome)}{" "}
              {phase.outcome !== "invalid" && (
                <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
                  Email us
                </a>
              )}
            </p>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor={`${id}-name`}>
                Name
              </label>
              <input
                id={`${id}-name`}
                className={FIELD}
                type="text"
                autoComplete="name"
                value={draft.name}
                disabled={disabled}
                required
                maxLength={LIMITS.name}
                aria-invalid={problemFor("name") ? true : undefined}
                aria-describedby={problemFor("name") ? `${id}-name-err` : undefined}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              {problemFor("name") && (
                <p id={`${id}-name-err`} className="mt-1 text-sm text-warn">
                  {problemFor("name")}
                </p>
              )}
            </div>
            <div>
              <label className={LABEL} htmlFor={`${id}-email`}>
                Email
              </label>
              <input
                id={`${id}-email`}
                className={FIELD}
                type="email"
                autoComplete="email"
                value={draft.email}
                disabled={disabled}
                required
                maxLength={LIMITS.email}
                aria-invalid={problemFor("email") ? true : undefined}
                aria-describedby={problemFor("email") ? `${id}-email-err` : undefined}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
              {problemFor("email") && (
                <p id={`${id}-email-err`} className="mt-1 text-sm text-warn">
                  {problemFor("email")}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4">
            <label className={LABEL} htmlFor={`${id}-subject`}>
              Subject <span className="font-normal">(optional)</span>
            </label>
            <input
              id={`${id}-subject`}
              className={FIELD}
              type="text"
              autoComplete="off"
              value={draft.subject}
              disabled={disabled}
              maxLength={LIMITS.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
          </div>

          <div className="mt-4">
            <label className={LABEL} htmlFor={`${id}-message`}>
              Message
            </label>
            <textarea
              id={`${id}-message`}
              className={FIELD}
              rows={6}
              value={draft.message}
              disabled={disabled}
              required
              maxLength={LIMITS.message}
              aria-invalid={problemFor("message") ? true : undefined}
              aria-describedby={problemFor("message") ? `${id}-message-err` : undefined}
              onChange={(e) => setDraft({ ...draft, message: e.target.value })}
            />
            {problemFor("message") && (
              <p id={`${id}-message-err`} className="mt-1 text-sm text-warn">
                {problemFor("message")}
              </p>
            )}
          </div>

          {/* 🔴 THE TRAP. A field a person cannot see or reach: off-screen,
              out of the tab order, hidden from assistive technology. It
              takes no part in the draft and is sent empty — so a real
              browser always sends "" and a script that fills every input
              does not. Its name is not one a password manager or the
              browser's autofill recognises, or a person's own autofill
              would trip it and their message would be dropped. */}
          <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
            <label htmlFor={`${id}-trap`}>Leave this field empty</label>
            <input id={`${id}-trap`} name="leaveBlank" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
          </div>

          <p className="mt-5">
            <Button type="submit" variant="primary" size="md" disabled={disabled}>
              {busy ? "Sending…" : "Send message"}
            </Button>
          </p>

          {/* 🔴 THE PRIVACY SENTENCE, BENEATH THE BUTTON. Says what is sent,
              to whom, and for how long — and nothing the code does not do:
              the message becomes one email to our mailbox and is stored on
              no database of ours. The basis is answering a request (GDPR
              Art. 6(1)(b)/(f)), so there is no tick-box. The policy section
              it links to is the same text. */}
          <Block as="p" measure="read" className="mt-4 text-sm text-ink-2" data-testid="contact-privacy">
            We send what you write here as one email to {CONTACT_EMAIL}, a mailbox on our server at
            Hetzner in Germany, so that we can answer you. It is not stored on this website’s database
            and goes nowhere else; in the mailbox it stays for as long as it takes to deal with it and a
            reasonable period afterwards. Details and your rights are in the{" "}
            <Link href="/legal/privacy#writing" className="underline">
              privacy policy
            </Link>
            .
          </Block>
        </form>
      )}
    </section>
  );
}
