'use client';

import Link from 'next/link';
import { useEffect } from 'react';

// CAMP-73 — what a reader sees when something on our side breaks.
//
// 🔴 An honest note about the status code, because the card asks for one.
// The site is prerendered: by the time a page fails it has already been
// served with a 200, and this boundary replaces what is inside it.
//
// 🔴 This note used to say a real 500 "comes from the host — Cloudflare".
// Both halves were wrong, and CAMP-324 caught the first: Cloudflare is
// the CDN and reverse proxy, not the host. Our own machine serves the
// document, so a real 500 would come from there. And if Cloudflare cannot
// reach that machine at all, the visitor does not get a 500 either — they
// get Cloudflare's own 52x page, which is configured there rather than
// here. Two different failures with two different codes, and neither of
// them is what this file renders.
//
// What this file controls is the far more likely failure: a client
// component throwing after the page has loaded, which without a boundary
// blanks the entire page.
//
// That is not hypothetical. The map did exactly this in a browser with
// no WebGL (CAMP-32): one widget's exception took out the country list
// underneath it, which was the part that did not need the widget at all.

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The console is the only place this goes for now. 🔴 Deliberately
    // not sent anywhere: we have no error reporting yet, and wiring one
    // up quietly would mean shipping a third-party script to every
    // reader without deciding that on purpose.
    console.error('Page error:', error);
  }, [error]);

  return (
    <main className="mx-auto max-w-wrap px-4 py-12 xl:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-2">
        Something went wrong
      </p>
      <h1 className="mt-2 text-3xl font-bold md:text-[42px]">
        This page did not load properly
      </h1>
      <p className="mt-3 max-w-prose text-ink-2">
        The fault is ours, not yours, and nothing you did caused it. Trying
        again often works — the rest of the site is unaffected.
      </p>

      {/* 🔴 No stack trace and no error message. It would tell a reader
          nothing and could name internal paths. The digest is Next's own
          short reference and is safe to show: it is the one thing that
          makes a report actionable. */}
      {error.digest && (
        <p className="mt-2 text-xs text-ink-2">Reference: {error.digest}</p>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-10 items-center rounded-sm border border-line-blue bg-accent-surface px-4 text-sm font-semibold text-heading"
        >
          Try again
        </button>
        <Link
          href="/camping"
          className="inline-flex h-10 items-center rounded-sm border border-line-2 bg-surface px-4 text-sm text-heading hover:border-line-blue"
        >
          All campsites
        </Link>
        <Link
          href="/map"
          className="inline-flex h-10 items-center rounded-sm border border-line-2 bg-surface px-4 text-sm text-heading hover:border-line-blue"
        >
          The map
        </Link>
      </div>
    </main>
  );
}
