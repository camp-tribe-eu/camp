// CAMP-92 — what we send when the browser throws, and what we refuse to.
//
// 🔴 The card's own words: "власний обробник window.onerror … Нульова
// залежність і нульові питання з GDPR". The second half is not free. An
// error report is personal data the moment it carries something a person
// typed, and our own pages hand it several chances to:
//
//   /search?q=jane+doe            the reader's own words, in the URL
//   "Cannot read x of undefined at parse('jane@example.com')"
//                                  their words, inside the message
//
// So the payload is built by subtraction. The rule is that anything a
// human could have typed is removed before the report leaves the page,
// and the removal is tested rather than intended — see error-report
// .spec.ts, which asserts on the exact strings above.
//
// What we do keep: the path, the browser, the message and the stack.
// That is what answers "the map breaks on some device" and nothing in
// it identifies anybody.

/** What actually goes over the wire. Nothing else is ever added. */
export type ClientError = {
  /** 'error' from window.onerror, 'promise' from unhandledrejection. */
  kind: 'error' | 'promise' | 'boundary';
  message: string;
  stack?: string;
  /** Pathname only — never the query string. */
  path: string;
  /** Where the failing script came from, if the browser told us. */
  source?: string;
  line?: number;
  userAgent: string;
  /** Milliseconds since the page loaded, not a wall clock. */
  sinceLoadMs: number;
};

/** How much of a message or stack we are willing to carry. */
export const MAX_MESSAGE = 300;
export const MAX_STACK = 2000;

/**
 * At most this many reports per page load.
 *
 * 🔴 Not politeness — a correctness requirement. A component that throws
 * inside a render loop throws thousands of times a second, and without a
 * cap the first broken deploy turns every reader's browser into a load
 * generator pointed at our own API. The cap is per page load because a
 * reload is the reader telling us they tried again.
 */
export const MAX_PER_PAGE = 8;

/**
 * Strip anything a person could have typed.
 *
 * 🔴 Order matters. Emails are redacted before the generic token rule,
 * because an address contains no space and would otherwise survive as
 * "a long word". Tested both ways round.
 */
export function scrub(text: string): string {
  return (
    text
      // An email, wherever it appears — in a message, in a stack, in a
      // URL. 🔴 `/` is excluded from both halves, or the match swallows
      // the path in front of it: `/x/jane@example.com` collapsed to
      // `[email]` and took the page identity with it. The address goes,
      // the route it appeared on stays.
      .replace(/[^\s<>()[\]{}'"/]+@[^\s<>()[\]{}'"/]+\.[a-z]{2,}/gi, '[email]')
      // Anything that looks like a key or a session token. 24+ characters
      // of base64-ish text is never a word and never a file path.
      .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[redacted]')
      // A query string anywhere, including inside a stack frame's URL.
      .replace(/\?[^\s)'"]*/g, '')
  );
}

/**
 * A URL reduced to the part that helps us and identifies nobody.
 *
 * 🔴 `/search?q=…` is the reader's own words. `#` fragments are the same
 * risk with a different separator. Both go; the pathname stays, because
 * "which page" is the entire question an error report has to answer.
 */
export function redactUrl(href: string): string {
  let pathname: string;
  try {
    pathname = new URL(href, 'https://camptribe.eu').pathname || '/';
  } catch {
    // Not a URL at all. Keep nothing rather than guess.
    return '/';
  }

  // 🔴 The pathname goes through the same scrub as everything else.
  //
  // The first version of this returned the pathname untouched, on the
  // assumption that a path is only ever our own slugs. A test proved the
  // assumption wrong in the other direction — `new URL('not a url', base)`
  // does not throw, it resolves — and the same mechanism means a 404 for
  // a crafted path arrives here as a pathname. Decoding first matters:
  // an address written as %6A%61%6E%65@… would otherwise sail past the
  // email rule.
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes; the encoded form is what we scrub then.
  }
  return scrub(decoded);
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * Turn whatever the browser handed us into a report, or into nothing.
 *
 * Returns null for the cases where there is no report worth making —
 * a rejection with no reason, an empty message — because an endpoint
 * full of `{}` teaches everyone to ignore it.
 */
export function normalise(input: {
  kind: ClientError['kind'];
  error?: unknown;
  message?: string;
  href: string;
  userAgent: string;
  source?: string;
  line?: number;
  sinceLoadMs: number;
}): ClientError | null {
  const err = input.error;
  const rawMessage =
    (err instanceof Error && err.message) ||
    input.message ||
    (typeof err === 'string' ? err : '') ||
    '';

  const message = clamp(scrub(rawMessage).trim(), MAX_MESSAGE);
  if (message === '') return null;

  const rawStack = err instanceof Error && err.stack ? err.stack : undefined;
  const stack = rawStack ? clamp(scrub(rawStack), MAX_STACK) : undefined;

  const report: ClientError = {
    kind: input.kind,
    message,
    path: redactUrl(input.href),
    userAgent: clamp(input.userAgent, MAX_MESSAGE),
    sinceLoadMs: Math.max(0, Math.round(input.sinceLoadMs)),
  };
  if (stack) report.stack = stack;
  // 🔴 `source` is a script URL, and a script URL can carry a query
  // string — so it goes through the same scrub, not around it.
  if (input.source) report.source = clamp(scrub(input.source), MAX_MESSAGE);
  if (typeof input.line === 'number' && Number.isFinite(input.line)) {
    report.line = input.line;
  }
  return report;
}

/**
 * The identity we deduplicate on.
 *
 * Message plus the first stack frame: the same fault from two different
 * call sites is two problems, and the same fault fired 400 times by a
 * render loop is one.
 */
export function fingerprint(e: ClientError): string {
  const frame = e.stack?.split('\n')[1]?.trim() ?? '';
  return `${e.kind}|${e.message}|${frame}`;
}

export type SendState = { seen: Set<string>; sent: number };

export function newState(): SendState {
  return { seen: new Set(), sent: 0 };
}

/**
 * Whether this report should go, given what has already gone.
 *
 * Pure, and it mutates nothing — the caller records the decision. That
 * is what lets the test drive a hundred errors through it without a
 * browser.
 */
export function shouldSend(e: ClientError, state: SendState): boolean {
  if (state.sent >= MAX_PER_PAGE) return false;
  return !state.seen.has(fingerprint(e));
}

export function record(e: ClientError, state: SendState): void {
  state.seen.add(fingerprint(e));
  state.sent += 1;
}
