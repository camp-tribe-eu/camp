'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  readConsent,
  writeConsent,
  REOPEN_EVENT,
  type ConsentChoice,
} from '@/lib/consent';

// CAMP-56 — the cookie banner.
//
// 🔴 Accept and Reject are the same element, the same size, side by side.
// This is the single most-fined pattern in Europe: a prominent "Accept"
// beside a grey "Manage preferences" is a design that makes refusal
// expensive, and GDPR Art. 4(11) requires consent to be freely given.
// If anyone ever asks for these two buttons to look different, the answer
// is in this comment.
//
// 🔴 It blocks nothing. There is no overlay, no scroll lock and no cookie
// wall — the reader can ignore it entirely and use the whole site, which
// is exactly what "freely given" means. Ignoring it is not consent; it is
// simply no answer, and nothing optional runs without an answer.
//
// 🔴 It renders nothing until mounted. The page is prerendered, so
// drawing the banner on the server would put it in the HTML for readers
// who already answered, and it would flash on every navigation.

export default function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const decide = () => setShow(readConsent() === null);
    decide();

    // The footer's "Cookie settings" asks for it back.
    const reopen = () => setShow(true);
    window.addEventListener(REOPEN_EVENT, reopen);
    return () => window.removeEventListener(REOPEN_EVENT, reopen);
  }, []);

  if (!show) return null;

  const answer = (choice: ConsentChoice) => {
    writeConsent(choice);
    setShow(false);
  };

  return (
    <div
      // `dialog` without `modal`: it is announced, and it does not trap
      // the reader or block what is behind it.
      role="dialog"
      aria-labelledby="cookie-title"
      data-testid="cookie-banner"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line-2 bg-surface p-3 shadow-lg sm:p-4"
    >
      <div className="mx-auto flex max-w-wrap flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        {/* 🔴 Short on purpose, and the shortness is a compliance
            property rather than a style preference.

            The first draft ran to four sentences. Measured on an iPhone
            viewport it made the banner 205 px of 664 — 31% of the screen
            — and it covered the centre of the map, where the campsite
            markers are. A banner that physically blocks the content until
            it is dismissed is a cookie wall by accident, which is exactly
            what the cookie policy promises this is not. The text below
            says the same thing in half the words, and an e2e test holds
            the banner under a fifth of the viewport. */}
        <div className="max-w-prose">
          <p id="cookie-title" className="text-sm font-semibold text-heading">
            We store nothing until you choose
          </p>
          <p className="mt-1 text-sm leading-6 text-ink-2">
            No analytics or advertising cookies.{' '}
            <Link href="/legal/cookies" className="underline">
              What we would store
            </Link>
          </p>
        </div>

        {/* 🔴 Reject first in the DOM, so it is also first for a keyboard
            and a screen reader. Same classes on both: if one ever gains a
            style the other lacks, that is the banner becoming a nudge. */}
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            data-testid="cookie-reject"
            onClick={() => answer('rejected')}
            className="inline-flex h-10 flex-1 items-center justify-center rounded-sm border border-line-2 bg-surface px-5 text-sm font-semibold text-heading hover:border-line-blue sm:flex-none"
          >
            Reject
          </button>
          <button
            type="button"
            data-testid="cookie-accept"
            onClick={() => answer('accepted')}
            className="inline-flex h-10 flex-1 items-center justify-center rounded-sm border border-line-2 bg-surface px-5 text-sm font-semibold text-heading hover:border-line-blue sm:flex-none"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

/** The footer control that brings the banner back. */
export function CookieSettingsLink() {
  return (
    <button
      type="button"
      data-testid="cookie-settings"
      onClick={() => window.dispatchEvent(new Event(REOPEN_EVENT))}
      className="underline"
    >
      Cookie settings
    </button>
  );
}
