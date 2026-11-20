"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/button";
import {
  SENT_BODY,
  SENT_TITLE,
  MAX_EMAIL,
  messageFor,
  requestBody,
  sendSubscription,
  validateEmail,
  waitBeforeSending,
  type SubscribeOutcome,
} from "@/lib/newsletter-form";

// Підписка на листи — поле в підвалі.
//
// 🔴 КЛІЄНТСЬКИЙ ОСТРІВ НА СТАТИЧНІЙ СТОРІНЦІ, як components/contact-form.tsx:
// підвал збирається один раз; цей острів малює свій «ще не живий» стан у той
// HTML і говорить з API лише з браузера читача, після гідратації.
//
// 🔴 БЕЗ JAVASCRIPT ПОЛЕ НЕ ВІДПРАВЛЯЄТЬСЯ, І ЦЕ СКАЗАНО: звичайний POST мав би
// піти на інше походження й повернутись JSON-ом на порожню сторінку, а мінімальний
// час для захисту від скриптів без скрипта не виміряти. Тож поле вимкнене, поки
// сторінка не ожила, а `<noscript>` дає шлях, який працює без нього.
//
// 🔴 ЛЮДИНА НІКОЛИ НЕ «НАДТО ШВИДКА»: API відкидає запит раніше за три секунди
// після появи форми (тією самою відповіддю, що й людині), тож кнопка сама
// чекає залишок.

const FIELD =
  "mt-1 w-full rounded border border-line-2 bg-surface px-3 py-2 text-base text-ink focus:border-line-blue disabled:opacity-60";

type Phase =
  | { kind: "editing"; error: string | null }
  | { kind: "sending" }
  | { kind: "sent" };

export default function NewsletterForm() {
  const id = useId();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "editing", error: null });
  const openedAt = useRef(0);

  useEffect(() => {
    openedAt.current = performance.now();
    setReady(true);
  }, []);

  const submit = async () => {
    const problem = validateEmail(email);
    if (problem) {
      setPhase({ kind: "editing", error: problem });
      return;
    }
    setPhase({ kind: "sending" });
    const wait = waitBeforeSending(performance.now() - openedAt.current);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const outcome: SubscribeOutcome = await sendSubscription(
      requestBody(email, performance.now() - openedAt.current),
    );
    if (outcome === "sent") setPhase({ kind: "sent" });
    else setPhase({ kind: "editing", error: messageFor(outcome) });
  };

  const busy = phase.kind === "sending";
  const disabled = !ready || busy;
  const error = phase.kind === "editing" ? phase.error : null;

  return (
    <section
      data-testid="footer-newsletter"
      aria-labelledby={`${id}-title`}
      className="relative"
    >
      <h2 id={`${id}-title`} className="text-xs text-heading">
        Occasional news by email
      </h2>

      {phase.kind === "sent" ? (
        <div role="status" data-testid="newsletter-sent" className="mt-3 max-w-[60ch]">
          <p className="text-sm font-semibold text-heading">{SENT_TITLE}</p>
          <p className="mt-1">{SENT_BODY}</p>
        </div>
      ) : (
        <form
          noValidate
          className="mt-3 max-w-[60ch]"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <noscript>
            <p>This form needs JavaScript. To hear from us, write to hello@camptribe.eu.</p>
          </noscript>

          <label className="block text-sm font-medium text-ink-2" htmlFor={`${id}-email`}>
            Email address
          </label>
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1 basis-56">
              <input
                id={`${id}-email`}
                className={FIELD}
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                disabled={disabled}
                required
                maxLength={MAX_EMAIL}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-err` : `${id}-consent`}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={disabled}
              className="mt-1"
            >
              {busy ? "Subscribing…" : "Subscribe"}
            </Button>
          </div>
          {error && (
            <p id={`${id}-err`} role="alert" className="mt-1 text-sm text-warn">
              <span className="font-semibold">Error:</span> {error}
            </p>
          )}

          {/* 🔴 THE TRAP. A field a person cannot see or reach: off-screen, out
              of the tab order, hidden from assistive technology. It takes no
              part in the draft and is sent empty. Its name is not one a
              password manager or autofill recognises, or a person's own
              autofill would trip it and their request would be dropped. */}
          <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
            <label htmlFor={`${id}-trap`}>Leave this field empty</label>
            <input
              id={`${id}-trap`}
              name="leaveBlank"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              defaultValue=""
            />
          </div>

          {/* 🔴 THE CONSENT SENTENCE, BENEATH THE BUTTON. Says what happens, what
              is stored, and that nothing is sent until the reader confirms —
              and nothing the code does not do. The basis is consent (Art.
              6(1)(a)), and the click on the link in the letter is the consent;
              the policy section it links to is the same text. */}
          <p id={`${id}-consent`} data-testid="newsletter-consent" className="mt-3">
            We will send you one letter to confirm this address. Until you press “Confirm” on the
            page its link opens you are not subscribed and we send you nothing else. After that, occasional news
            about CampTribe. We keep your address and the dates of your request in our own
            database, on our own server, and share it with nobody; you can unsubscribe with one
            click from any letter. Details in the{" "}
            <Link href="/legal/privacy#newsletter" className="underline">
              privacy policy
            </Link>
            .
          </p>
        </form>
      )}
    </section>
  );
}
