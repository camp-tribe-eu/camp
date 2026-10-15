import { Cooldown } from './cooldown';

// CAMP-228, decision 4 — "you may ask again in 60 seconds".
//
// Time is passed in, never read, and every expectation is a literal number of
// seconds: 60, 59, 1. A wait computed from the constant under test would
// shift with it.

const T0 = new Date('2026-10-15T12:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('the 60-second wait', () => {
  it('lets the first request through and refuses an immediate second', () => {
    const c = new Cooldown(60_000);
    expect(c.take('a', at(0))).toEqual({ ok: true });
    expect(c.take('a', at(0))).toEqual({ ok: false, retryAfterSec: 60 });
  });

  it('counts the seconds left, rounding UP so it is never "0 seconds"', () => {
    const c = new Cooldown(60_000);
    c.take('a', at(0));
    expect(c.take('a', at(1_000))).toEqual({ ok: false, retryAfterSec: 59 });
    expect(c.take('a', at(30_000))).toEqual({ ok: false, retryAfterSec: 30 });
    expect(c.take('a', at(59_000))).toEqual({ ok: false, retryAfterSec: 1 });
    // 1 ms short of the minute is still one second to wait, not zero.
    expect(c.take('a', at(59_999))).toEqual({ ok: false, retryAfterSec: 1 });
  });

  it('lets the same address through again at exactly 60 seconds', () => {
    const c = new Cooldown(60_000);
    c.take('a', at(0));
    expect(c.take('a', at(60_000))).toEqual({ ok: true });
  });

  it('does not start the clock again for a request it refused', () => {
    const c = new Cooldown(60_000);
    c.take('a', at(0));
    // A person pressing the button: refused at 30 s…
    expect(c.take('a', at(30_000)).ok).toBe(false);
    // …and still allowed at 60 s, not at 90.
    expect(c.take('a', at(60_000))).toEqual({ ok: true });
  });

  it('keeps one clock per key', () => {
    const c = new Cooldown(60_000);
    c.take('anna@example.com', at(0));
    expect(c.take('ben@example.com', at(1_000))).toEqual({ ok: true });
    expect(c.take('anna@example.com', at(1_000)).ok).toBe(false);
  });

  it('uses the key it is given, so callers can keep one clock per kind of letter', () => {
    const c = new Cooldown(60_000);
    c.take('reset_password:anna@example.com', at(0));
    expect(c.take('verify_email:anna@example.com', at(0))).toEqual({
      ok: true,
    });
  });
});

describe('what it remembers', () => {
  it('holds a digest of the key, not the address', () => {
    const c = new Cooldown(60_000);
    c.take('reset_password:anna@example.com', at(0));
    const keys = [
      ...(c as unknown as { last: Map<string, number> }).last.keys(),
    ];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.join('')).not.toContain('anna');
  });

  it('forgets what has expired', () => {
    const c = new Cooldown(60_000);
    c.take('a', at(0));
    c.take('b', at(1_000));
    c.take('c', at(2_000));
    expect(c.size).toBe(3);
    // Past all three windows; the sweep runs on the next call.
    c.take('d', at(62_001));
    expect(c.size).toBe(1);
  });

  it('stays under its ceiling by forgetting the OLDEST key', () => {
    const c = new Cooldown(60_000, 3);
    for (const k of ['k0', 'k1', 'k2', 'k3', 'k4']) c.take(k, at(0));
    expect(c.size).toBe(3);
    // The oldest were dropped: k0 may ask again at once…
    expect(c.take('k0', at(1))).toEqual({ ok: true });
    // …while the newest is still waiting.
    expect(c.take('k4', at(1)).ok).toBe(false);
  });
});
