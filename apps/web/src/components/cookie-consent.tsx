'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  CONSENT_KEY,
  readConsent,
  writeConsent,
  REOPEN_EVENT,
  type ConsentChoice,
} from '@/lib/consent';
import { Button } from '@/components/button';

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
  const bannerRef = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const decide = () => setShow(readConsent() === null);
    decide();

    // The footer's "Cookie settings" asks for it back.
    const reopen = () => setShow(true);
    window.addEventListener(REOPEN_EVENT, reopen);

    // 🔴 Answered in another tab counts as answered here. Without this a
    // reader with two tabs open refuses in one and is still being asked
    // in the other — which reads as the site ignoring them, and is the
    // exact impression a consent banner must not give. The `storage`
    // event fires only in the OTHER tabs, which is precisely the case.
    const elsewhere = (e: StorageEvent) => {
      if (e.key === CONSENT_KEY || e.key === null) decide();
    };
    window.addEventListener('storage', elsewhere);

    return () => {
      window.removeEventListener(REOPEN_EVENT, reopen);
      window.removeEventListener('storage', elsewhere);
    };
  }, []);

  // 🔴 CAMP-264. Банер `fixed bottom-0` накриває низ першого екрана, і
  // компенсації не існувало ніде. Заміряно 12.10.2026 на 390×844:
  // банер 121 px (723–844), а лічильник мапи «898» стояв на 758 —
  // ТОБТО ПОВНІСТЮ ПІД НИМ. Плюс обрізані дві кнопки фільтрів.
  //
  // Висота береться ЗАМІРОМ, не константою: банер переноситься
  // по-різному на різних ширинах і мовах, а текст у ньому колись
  // змінять. Константа тут — це той самий дефект через півроку.
  //
  // Прибирається у cleanup, інакше після відповіді внизу назавжди
  // лишиться порожня смуга заввишки з банер.
  useEffect(() => {
    const el = bannerRef.current;
    if (!el) return;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty('--consent-h', `${el.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--consent-h');
    };
  }, [show]);

  if (!show) return null;

  const answer = (choice: ConsentChoice) => {
    writeConsent(choice);
    setShow(false);
  };

  return (
    <div
      ref={bannerRef}
      // `dialog` without `modal`: it is announced, and it does not trap
      // the reader or block what is behind it.
      role="dialog"
      aria-labelledby="cookie-title"
      data-testid="cookie-banner"
      className="fixed inset-x-0 bottom-0 z-[var(--layer-temporary)] border-t border-line-2 bg-surface p-3 shadow-lg sm:p-4"
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
          <Button
            type="button"
            data-testid="cookie-reject"
            onClick={() => answer('rejected')} className="flex-1 font-semibold sm:flex-none">
            Reject
          </Button>
          <Button
            type="button"
            data-testid="cookie-accept"
            onClick={() => answer('accepted')} className="flex-1 font-semibold sm:flex-none">
            Accept
          </Button>
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
