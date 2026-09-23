'use client';

import { useEffect } from 'react';
import {
  newState,
  normalise,
  record,
  shouldSend,
  type ClientError,
} from '@/lib/error-report';

// CAMP-92 — the listener, in the root layout, on every page.
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
// 🔴 Off unless an endpoint is configured. NEXT_PUBLIC_ERROR_ENDPOINT is
// inlined at build time, and today there is no server to point it at
// (CAMP-99 is the owner's). Empty means the listeners still attach and
// still deduplicate, but nothing goes over the wire — rather than the
// site firing failed requests at a host that does not exist on every
// error, which is how a reporting tool becomes the outage.

const ENDPOINT = process.env.NEXT_PUBLIC_ERROR_ENDPOINT ?? '';

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
    const started = performance.now();

    const report = (partial: Parameters<typeof normalise>[0]) => {
      const e = normalise(partial);
      if (!e || !shouldSend(e, state)) return;
      record(e, state);
      if (ENDPOINT) void send(ENDPOINT, e);
      // In development the console is the endpoint. This is also what
      // makes the mechanism visible while there is no server to send to.
      else if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[error-reporter] would report:', e);
      }
    };

    const onError = (event: ErrorEvent) => {
      report({
        kind: 'error',
        error: event.error,
        message: event.message,
        source: event.filename,
        line: event.lineno,
        href: window.location.href,
        userAgent: navigator.userAgent,
        sinceLoadMs: performance.now() - started,
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      report({
        kind: 'promise',
        error: event.reason,
        href: window.location.href,
        userAgent: navigator.userAgent,
        sinceLoadMs: performance.now() - started,
      });
    };

    // 🔴 Capture phase. A listener in the bubble phase does not see an
    // error that a handler further down has already stopped, and the
    // whole point is to see the ones nobody handled.
    window.addEventListener('error', onError, true);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError, true);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
