import {
  LIMITS,
  MIN_FILL_MS,
  isTokenShaped,
  parseSubscription,
} from './newsletter.rules';
import { newToken } from '../auth/session';

// Підписка на листи — правила розбору. Без Nest, без бази.

const good = { email: 'Anna@Example.EU', leaveBlank: '', elapsedMs: 9000 };

const spamOf = (r: ReturnType<typeof parseSubscription>) =>
  r.ok === true ? r.subscription.spam : 'refused';

const problemsOf = (body: unknown) => {
  const r = parseSubscription(body);
  if (r.ok === false) return r.problems;
  throw new Error('expected a refusal, got ok');
};

describe('parseSubscription — the address', () => {
  it('a good address is trimmed and lower-cased: that is what reaches the database', () => {
    const r = parseSubscription({ ...good, email: '  Anna@Example.EU ' });
    expect(r).toEqual({
      ok: true,
      subscription: { email: 'anna@example.eu', spam: false },
    });
  });

  it.each([
    ['no @', 'anna.example.eu'],
    ['no dot in the domain', 'anna@localhost'],
    ['two addresses', 'a@example.eu,b@example.eu'],
    ['a display name', 'Anna <anna@example.eu>'],
    ['a space inside', 'an na@example.eu'],
    [
      'a line break (a header-injection attempt)',
      'anna@example.eu\nBcc: x@example.eu',
    ],
    ['a CR', 'anna@example.eu\rBcc: x@example.eu'],
    ['U+2028', 'anna@example.eu x'],
  ])('refuses %s', (_why, email) => {
    expect(problemsOf({ ...good, email })).toEqual([
      expect.objectContaining({ field: 'email', code: 'invalid' }),
    ]);
  });

  it('refuses a missing, empty and blank address as `missing`', () => {
    for (const email of [undefined, null, '', '   ']) {
      expect(problemsOf({ ...good, email })).toEqual([
        expect.objectContaining({ field: 'email', code: 'missing' }),
      ]);
    }
  });

  it('refuses a non-text address', () => {
    for (const email of [42, {}, ['a@example.eu'], true]) {
      expect(problemsOf({ ...good, email })).toEqual([
        expect.objectContaining({ field: 'email', code: 'not_text' }),
      ]);
    }
  });

  it('refuses an address one character over the limit as `too_long`, not as `invalid`', () => {
    const over = `${'a'.repeat(LIMITS.email + 1 - '@example.eu'.length)}@example.eu`;
    expect(over.length).toBe(LIMITS.email + 1);
    expect(problemsOf({ ...good, email: over })).toEqual([
      expect.objectContaining({ field: 'email', code: 'too_long' }),
    ]);
  });
});

describe('parseSubscription — the body', () => {
  it('refuses anything that is not a JSON object', () => {
    for (const body of [null, undefined, 'a@example.eu', 7, [good]]) {
      expect(problemsOf(body)).toEqual([
        expect.objectContaining({ field: 'body', code: 'not_an_object' }),
      ]);
    }
  });

  it('refuses a field we did not ask for — not silently dropped', () => {
    expect(problemsOf({ ...good, name: 'Anna' })).toEqual([
      expect.objectContaining({ field: 'body', code: 'unknown_field' }),
    ]);
  });
});

describe('parseSubscription — a script is told yes, and nothing happens', () => {
  it('a filled trap is spam — whatever it holds, even a space', () => {
    for (const leaveBlank of ['x', ' ', 'http://spam.example', 0, false]) {
      const r = parseSubscription({ ...good, leaveBlank });
      expect(spamOf(r)).toBe(true);
    }
  });

  it('an empty, null or absent trap is not', () => {
    for (const leaveBlank of ['', null, undefined]) {
      const r = parseSubscription({ ...good, leaveBlank });
      expect(spamOf(r)).toBe(false);
    }
  });

  it('too fast is spam: one millisecond under the minimum, but not at it', () => {
    const fast = parseSubscription({ ...good, elapsedMs: MIN_FILL_MS - 1 });
    const ok = parseSubscription({ ...good, elapsedMs: MIN_FILL_MS });
    expect(spamOf(fast)).toBe(true);
    expect(spamOf(ok)).toBe(false);
  });

  it('no timing at all, or a timing that is not a finite number, is spam', () => {
    for (const elapsedMs of [undefined, null, '9000', NaN, Infinity]) {
      const r = parseSubscription({ ...good, elapsedMs });
      expect(spamOf(r)).toBe(true);
    }
  });

  it('a BAD address is still refused when the trap is filled: validation comes first', () => {
    expect(
      problemsOf({ email: 'nope', leaveBlank: 'x', elapsedMs: 1 }),
    ).toHaveLength(1);
  });
});

describe('isTokenShaped — what is allowed to reach the database', () => {
  it('accepts a token as we issue them', () => {
    expect(isTokenShaped(newToken())).toBe(true);
  });
  it('refuses the rest', () => {
    for (const t of [
      undefined,
      '',
      'short',
      'a'.repeat(42),
      `${'a'.repeat(43)}!`,
      ['a'.repeat(43)],
      12,
      'a'.repeat(129),
    ])
      expect(isTokenShaped(t)).toBe(false);
  });
});
