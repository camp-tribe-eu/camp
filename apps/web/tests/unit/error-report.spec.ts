import { expect, test } from '@playwright/test';
import {
  fingerprint,
  MAX_MESSAGE,
  MAX_PER_PAGE,
  newState,
  normalise,
  record,
  redactUrl,
  scrub,
  shouldSend,
} from '../../src/lib/error-report';

// CAMP-92 — the part that decides what leaves the reader's browser.
//
// 🔴 The card promises "нульові питання з GDPR". That promise is only
// worth what these assertions are worth, because the risk is not
// hypothetical: our own /search page puts the reader's own words into
// the URL, and any message built with a template literal can put them
// into the text. Both are asserted below with the real shapes.

const base = {
  href: 'https://camptribe.eu/camping/hr/istria/kamp-kovac',
  userAgent: 'Mozilla/5.0 (iPhone)',
  sinceLoadMs: 1234,
};

test.describe('🔴 nothing a person typed may leave the page', () => {
  test('the search query never travels', () => {
    // The exact page the risk lives on.
    expect(redactUrl('https://camptribe.eu/search?q=jane+doe+camping')).toBe(
      '/search',
    );
    expect(redactUrl('/search?q=bled#results')).toBe('/search');
  });

  test('an email in the message is removed', () => {
    const e = normalise({
      kind: 'error',
      message: "Cannot read 'x' of undefined at parse(jane@example.com)",
      ...base,
    })!;
    expect(e.message).not.toContain('jane@example.com');
    expect(e.message).toContain('[email]');
  });

  test('an email is removed before it can pass as a long token', () => {
    // Order-of-rules check: the generic token rule would otherwise eat
    // half of it and leave the domain behind.
    expect(scrub('a.very.long.name@somewhere-else.example.com')).toBe(
      '[email]',
    );
  });

  test('anything key-shaped is removed', () => {
    expect(scrub('token=ghp_AbCdEfGhIjKlMnOpQrStUvWxYz012345')).toContain(
      '[redacted]',
    );
    // But ordinary words and paths survive, or the reports say nothing.
    expect(scrub('Cannot read properties of undefined')).toBe(
      'Cannot read properties of undefined',
    );
    expect(scrub('at /_next/static/chunks/main.js:1:2')).toBe(
      'at /_next/static/chunks/main.js:1:2',
    );
  });

  test('a query string inside a stack frame is removed too', () => {
    const err = new Error('boom');
    err.stack =
      'Error: boom\n    at f (https://camptribe.eu/search?q=private+words:1:2)';
    const e = normalise({ kind: 'error', error: err, ...base })!;
    expect(e.stack).not.toContain('private');
  });

  test('a script URL with a query string is scrubbed, not passed through', () => {
    const e = normalise({
      kind: 'error',
      message: 'boom',
      source: 'https://camptribe.eu/x.js?token=abcdefghijklmnopqrstuvwx',
      ...base,
    })!;
    expect(e.source).not.toContain('token=');
  });

  test('the payload has no field we did not decide to send', () => {
    const e = normalise({
      kind: 'error',
      error: new Error('boom'),
      source: 'https://camptribe.eu/_next/static/chunks/main.js',
      line: 42,
      ...base,
    })!;
    expect(Object.keys(e).sort()).toEqual(
      [
        'kind',
        'line',
        'message',
        'path',
        'sinceLoadMs',
        'source',
        'stack',
        'userAgent',
      ].sort(),
    );
  });
});

test.describe('what is worth sending at all', () => {
  test('an error with no message is not a report', () => {
    expect(normalise({ kind: 'error', message: '', ...base })).toBeNull();
    expect(normalise({ kind: 'promise', ...base })).toBeNull();
    // Whitespace is not a message either.
    expect(normalise({ kind: 'error', message: '   ', ...base })).toBeNull();
  });

  test('a rejection with a plain string reason is kept', () => {
    const e = normalise({ kind: 'promise', error: 'network gone', ...base })!;
    expect(e.message).toBe('network gone');
    expect(e.kind).toBe('promise');
  });

  test('a very long message is cut, not sent whole', () => {
    const e = normalise({ kind: 'error', message: 'x'.repeat(5000), ...base })!;
    expect(e.message.length).toBeLessThanOrEqual(MAX_MESSAGE + 1);
  });

  // 🔴 This test failed first, and it was the test that was wrong — in a
  // way worth keeping. `new URL('not a url', base)` does NOT throw, it
  // resolves, so the catch this file was relying on never ran and the
  // pathname went out untouched. Which means a crafted 404 path is a
  // route out of the page, and the scrub has to cover it.
  test('a href that is not a URL resolves rather than throwing', () => {
    const e = normalise({
      kind: 'error',
      message: 'boom',
      ...base,
      href: 'not a url at all',
    })!;
    expect(e.path).toBe('/not a url at all');
  });

  test('a person typed into the PATH is scrubbed like anywhere else', () => {
    expect(redactUrl('https://camptribe.eu/x/jane@example.com')).toBe(
      '/x/[email]',
    );
    // And percent-encoded, which is how a browser would actually send it.
    expect(redactUrl('https://camptribe.eu/x/jane%40example.com')).toBe(
      '/x/[email]',
    );
  });

  test('a href that cannot be parsed at all carries nothing', () => {
    // A protocol-relative URL with an invalid host: URL() throws here.
    expect(redactUrl('http://[')).toBe('/');
  });

  test('time is measured from page load, never as a clock', () => {
    const e = normalise({ kind: 'error', message: 'boom', ...base })!;
    expect(e.sinceLoadMs).toBe(1234);
    // A negative reading is a browser oddity, not a timestamp.
    const odd = normalise({
      kind: 'error',
      message: 'boom',
      ...base,
      sinceLoadMs: -5,
    })!;
    expect(odd.sinceLoadMs).toBe(0);
  });
});

test.describe('🔴 a render loop must not become a load generator', () => {
  const err = (message: string, frame = 'at f (main.js:1:1)') => {
    const e = new Error(message);
    e.stack = `Error: ${message}\n    ${frame}`;
    return normalise({ kind: 'error', error: e, ...base })!;
  };

  test('the same fault is sent once, however often it fires', () => {
    const state = newState();
    const e = err('boom');
    expect(shouldSend(e, state)).toBe(true);
    record(e, state);
    for (let i = 0; i < 500; i++) expect(shouldSend(err('boom'), state)).toBe(false);
    expect(state.sent).toBe(1);
  });

  test('the same message from a different frame is a different problem', () => {
    const state = newState();
    record(err('boom', 'at f (main.js:1:1)'), state);
    expect(shouldSend(err('boom', 'at g (map.js:9:9)'), state)).toBe(true);
  });

  test('a page load sends at most the cap, even with distinct faults', () => {
    const state = newState();
    let sent = 0;
    for (let i = 0; i < 100; i++) {
      const e = err(`boom ${i}`);
      if (shouldSend(e, state)) {
        record(e, state);
        sent++;
      }
    }
    expect(sent).toBe(MAX_PER_PAGE);
  });

  test('the fingerprint survives a stack the browser did not give us', () => {
    const e = normalise({ kind: 'error', message: 'boom', ...base })!;
    expect(fingerprint(e)).toBe('error|boom|');
  });
});
