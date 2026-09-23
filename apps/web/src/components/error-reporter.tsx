'use client';

import { useEffect } from 'react';
import {
  newState,
  normalise,
  record,
  shouldSend,
  type ClientError,
} from '@/lib/error-report';

// CAMP-92 — the listener, on every page, from the first byte.
//
// 🔴 Why this exists at all. CAMP-59 answers "is the site up" and
// global-error.tsx catches what React can catch. Neither sees the
// interesting failures: the map is maplibre plus clustering plus a
// filter layer, and a browser we did not test on throws inside it
// silently. The reader sees an empty rectangle, closes the tab, and we
// learn nothing. That is the gap.
//
// 🔴 Why no service. The card's reasoning, which holds: any error
// service is a processor under GDPR, needs its terms and its DPA read
// before a single request reaches it, and the same objection that ruled
// out Microsoft Clarity applies. `window.onerror` into our own endpoint
// has no third party in it, so there is nothing to sign and nothing to
// disclose. What it costs instead is that WE have to be careful about
// the payload — which is what lib/error-report.ts is.
//
// 🔴 Why the listeners are installed by an inline script and not here.
//
// They used to be attached in this component's effect, which runs after
// hydration. CI found it: the very first test failed with "the broken
// page produced no record" and passed on retry, because on a cold run
// the page was ready before React was. The flake was telling the truth
// about the design — anything thrown BEFORE hydration was invisible,
// and that is not a rare corner. A hydration mismatch, a chunk that
// 404s, a polyfill that throws on an old browser: those all happen
// before any effect runs, and they are the failures most likely to
// leave a reader looking at a blank page.
//
// So a few hundred bytes of inline script install the listeners in
// <head> and push what they catch into a queue. This component drains
// it. There is exactly one pair of listeners, so nothing is reported
// twice, and the window between the first byte and hydration — the
// dangerous one — is covered.
//
// 🔴 What remains uncovered, said plainly: if the application bundle
// never loads at all, nothing drains the queue and nothing is sent. No
// in-page reporter can do better, because the code that would send is
// the code that did not load. That failure is CAMP-59's to see, not
// this one's.
//
// 🔴 Off unless an endpoint is configured. NEXT_PUBLIC_ERROR_ENDPOINT is
// inlined at build time, and today there is no server to point it at
// (CAMP-99 is the owner's). Empty means the queue still fills and still
// deduplicates, but nothing goes over the wire — rather than the site
// firing failed requests at a host that does not exist on every error,
// which is how a reporting tool becomes the outage.

const ENDPOINT = process.env.NEXT_PUBLIC_ERROR_ENDPOINT ?? '';

/** What the inline script (lib/error-bootstrap.ts) puts in the queue.
 *  Plain data: an Error object cannot survive being held by a script
 *  that does not import anything. */
type Queued = {
  kind: 'error' | 'promise';
  message?: string;
  stack?: string;
  source?: string;
  line?: number;
  href: string;
  sinceLoadMs: number;
};

declare global {
  interface Window {
    __campErrors?: Queued[];
    __campDrain?: () => void;
  }
}


async function send(endpoint: string, report: ClientError): Promise<void> {
  try {
    await fetch(endpoint, {
      method: 'POST',
      // 🔴 keepalive, so a report survives the navigation that a broken
      // page usually causes — the reader's reflex is to leave, and an
      // ordinary fetch is cancelled when they do.
      keepalive: true,
      // No cookies and no credentials. There is nothing to authenticate
      // and sending them would make this an identifier.
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
  } catch {
    // 🔴 Deliberately silent. Throwing inside an error handler is how a
    // reporter turns one broken page into an infinite loop.
  }
}

export default function ErrorReporter() {
  useEffect(() => {
    const state = newState();

    const drain = () => {
      const queue = window.__campErrors;
      if (!queue) return;
      // Splice rather than read: an entry taken out cannot be taken
      // twice, which is what makes the drain safe to call on every push.
      const batch = queue.splice(0, queue.length);
      for (const item of batch) {
        const e = normalise({
          kind: item.kind,
          message: item.message,
          stack: item.stack,
          source: item.source,
          line: item.line,
          href: item.href,
          userAgent: navigator.userAgent,
          sinceLoadMs: item.sinceLoadMs,
        });
        if (!e || !shouldSend(e, state)) continue;
        record(e, state);
        if (ENDPOINT) void send(ENDPOINT, e);
        else if (process.env.NODE_ENV !== 'production') {
          // The console is the endpoint while there is no server.
          // eslint-disable-next-line no-console
          console.warn('[error-reporter] would report:', e);
        }
      }
    };

    window.__campDrain = drain;
    // Anything that broke before this component mounted is already in
    // the queue — which is the whole reason the queue exists.
    drain();

    return () => {
      if (window.__campDrain === drain) delete window.__campDrain;
    };
  }, []);

  return null;
}
