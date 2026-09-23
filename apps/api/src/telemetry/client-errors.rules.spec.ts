import { allow, LIMITS, prune, RATE, validate } from './client-errors.rules';
import type { Bucket } from './client-errors.rules';

// CAMP-92 — the guards on an endpoint anybody on the internet can POST to.
//
// 🔴 A well-behaved browser sends the shape the web app built. Every case
// below is the other kind: the bodies somebody writes by hand once they
// find the URL in a public repository. That is the only traffic worth
// testing here, because the honest traffic is tested end to end.

const ok = {
  kind: 'error',
  message: 'Cannot read properties of undefined',
  stack: 'Error: x\n    at f (main.js:1:1)',
  path: '/camping/hr/istria/kamp',
  userAgent: 'Mozilla/5.0',
  sinceLoadMs: 1200,
};

describe('validate', () => {
  it('accepts what the web app actually sends', () => {
    const row = validate(ok)!;
    expect(row).not.toBeNull();
    expect(row.message).toBe(ok.message);
    expect(row.fingerprint).toContain('at f (main.js:1:1)');
  });

  it('refuses a body with no message', () => {
    expect(validate({ ...ok, message: '' })).toBeNull();
    expect(validate({ ...ok, message: '   ' })).toBeNull();
    expect(validate({ ...ok, message: undefined })).toBeNull();
  });

  it('refuses a kind it does not know', () => {
    expect(validate({ ...ok, kind: 'drop table' })).toBeNull();
    expect(validate({ ...ok, kind: 42 })).toBeNull();
  });

  it('refuses types that are not what they claim to be', () => {
    expect(validate({ ...ok, message: { toString: () => 'x' } })).toBeNull();
    expect(validate({ ...ok, message: ['x'] })).toBeNull();
  });

  // 🔴 The disk-filling case. Nothing rejects a long field — it is
  // truncated — because a slightly-too-long report is still a report,
  // but an unbounded one is a free write of any size.
  it('truncates rather than trusting the length', () => {
    const row = validate({
      ...ok,
      message: 'x'.repeat(100_000),
      stack: 'y'.repeat(100_000),
      path: '/'.repeat(100_000),
      source: 'z'.repeat(100_000),
      userAgent: 'u'.repeat(100_000),
    })!;
    expect(row.message).toHaveLength(LIMITS.message);
    expect(row.stack).toHaveLength(LIMITS.stack);
    expect(row.path).toHaveLength(LIMITS.path);
    expect(row.source).toHaveLength(LIMITS.source);
    expect(row.userAgent).toHaveLength(LIMITS.userAgent);
    // And the fingerprint cannot exceed its own column either.
    expect(row.fingerprint.length).toBeLessThanOrEqual(LIMITS.path);
  });

  it('refuses a number where a number is meaningless', () => {
    expect(validate({ ...ok, line: 'nine' })!.line).toBeNull();
    expect(validate({ ...ok, line: Infinity })!.line).toBeNull();
    expect(validate({ ...ok, line: -3 })!.line).toBeNull();
    expect(validate({ ...ok, sinceLoadMs: 9e18 })!.sinceLoadMs).toBe(
      86_400_000,
    );
  });

  it('fills in a path when there is none rather than failing', () => {
    expect(validate({ ...ok, path: undefined })!.path).toBe('/');
  });

  it('gives a report with no stack a fingerprint anyway', () => {
    const row = validate({ ...ok, stack: undefined })!;
    expect(row.stack).toBeNull();
    expect(row.fingerprint).toBe(`error|${ok.message}|`);
  });
});

describe('the rate limit', () => {
  const key = 'error|boom|at f';

  it('lets the first reports through and stops the flood', () => {
    const bucket: Bucket = new Map();
    let accepted = 0;
    for (let i = 0; i < 500; i++) {
      if (allow(bucket, key, 1_000_000 + i)) accepted++;
    }
    expect(accepted).toBe(RATE.perWindow);
  });

  it('opens again once the window has passed', () => {
    const bucket: Bucket = new Map();
    const t = 1_000_000;
    for (let i = 0; i < RATE.perWindow; i++) allow(bucket, key, t);
    expect(allow(bucket, key, t)).toBe(false);
    expect(allow(bucket, key, t + RATE.windowMs + 1)).toBe(true);
  });

  it('a different problem is not blocked by a noisy one', () => {
    const bucket: Bucket = new Map();
    const t = 1_000_000;
    for (let i = 0; i < 500; i++) allow(bucket, key, t);
    expect(allow(bucket, 'error|other|at g', t)).toBe(true);
  });

  // 🔴 The bucket is itself attacker-controlled: the key contains the
  // message. Without pruning, the rate limiter IS the memory leak it was
  // added to prevent.
  it('forgets keys nobody has used, so the limiter is not the leak', () => {
    const bucket: Bucket = new Map();
    for (let i = 0; i < 1000; i++) allow(bucket, `key-${i}`, 1_000_000);
    expect(bucket.size).toBe(1000);
    prune(bucket, 1_000_000 + RATE.windowMs + 1);
    expect(bucket.size).toBe(0);
  });

  it('pruning keeps the hits that are still inside the window', () => {
    const bucket: Bucket = new Map();
    allow(bucket, key, 1_000_000);
    allow(bucket, key, 1_000_000 + RATE.windowMs - 1);
    prune(bucket, 1_000_000 + RATE.windowMs);
    expect(bucket.get(key)).toHaveLength(1);
  });

  // A blocked caller that keeps pushing must not grow the array it is
  // being blocked by — otherwise refusing the flood still costs memory
  // proportional to the flood.
  it('a blocked caller does not keep growing its own bucket', () => {
    const bucket: Bucket = new Map();
    const t = 1_000_000;
    for (let i = 0; i < 5000; i++) allow(bucket, key, t);
    expect(bucket.get(key)!.length).toBe(RATE.perWindow);
  });
});
