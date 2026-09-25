import { expect, test } from '@playwright/test';
import {
  MAX_BYTES,
  RAW_MAX_BYTES,
  TOTAL_MAX_BYTES,
  checkedPlan,
  toSearchDocs,
} from '@/lib/search-index';

// CAMP-135 — the ceiling on the search index, tested at last.
//
// 🔴 Why this file exists.
//
// `checkedPlan` is the only thing standing between a reader and a
// search index that costs them nine seconds on mobile data, and until
// this file it had NO tests — not one spec referenced it. The reason is
// ordinary: the only way to make it throw was to build an index of
// several real megabytes, so nobody did. An untested guard is the
// defect this repository keeps finding in its own safeguards (a backup
// that never restored, a size check CI cannot fail), and it was not
// going to be left as one more.
//
// The ceilings are therefore arguments with the constants as defaults,
// and the first test below pins the defaults so that injecting a small
// limit cannot quietly become the only thing exercised.

const row = (i: number, near: { name: string; m: number }[] = []) => ({
  name: `Camping Number ${i}`,
  country: 'fr',
  region: 'loire',
  slug: `c${i}`,
  near,
});

/** Documents that compress well — the shape our real data has. */
const repetitive = (n: number) =>
  toSearchDocs(
    Array.from({ length: n }, (_, i) =>
      row(i, [
        { name: 'Saint-Étienne-de-Montluc', m: 300 },
        { name: 'La Loire', m: 1200 },
      ]),
    ),
  );

/** Documents that do not compress — to reach the compressed ceiling. */
const noisy = (n: number, len = 400) => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const word = () =>
    Array.from({ length: 9 }, () =>
      'abcdefghijklmnopqrstuvwxyz'[Math.floor(rnd() * 26)],
    ).join('');
  return toSearchDocs(
    Array.from({ length: n }, (_, i) =>
      row(i, Array.from({ length: len / 20 }, () => ({ name: word(), m: Math.floor(rnd() * 9000) }))),
    ),
  );
};

test.describe('the ceiling on the search index', () => {
  test('🔴 the defaults are the constants, not the test values', () => {
    // Without this, every test below could pass against limits that
    // ship nowhere.
    expect(TOTAL_MAX_BYTES).toBe(5_000_000);
    expect(RAW_MAX_BYTES).toBe(20_000_000);
    expect(MAX_BYTES).toBe(1_500_000);
  });

  test('an ordinary index passes and reports both sizes', () => {
    const { plan, total, sent } = checkedPlan(repetitive(500));
    expect(plan.length).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(0);
    // 🔴 The point of CAMP-135 in one assertion: what a reader downloads
    // is a fraction of the JSON, so the two must not be the same number.
    expect(sent).toBeLessThan(total / 2);
  });

  test('🔴 it refuses an index too big to DOWNLOAD', () => {
    const docs = noisy(400);
    // Passes under the shipped ceiling…
    expect(() => checkedPlan(docs)).not.toThrow();
    // …and is refused once the ceiling is below what it compresses to.
    expect(() => checkedPlan(docs, { sentMax: 1_000 })).toThrow(
      /compressed across .* files/,
    );
  });

  test('🔴 it refuses an index too big to PARSE, which is a different size', () => {
    const docs = repetitive(2_000);
    expect(() => checkedPlan(docs, { rawMax: 1_000 })).toThrow(
      /JSON across .* files/,
    );
    // 🔴 And the two ceilings are genuinely independent: this index is
    // over the raw limit while being far under the compressed one, which
    // is exactly the case that used to fail the build for no reason.
    expect(() => checkedPlan(docs, { rawMax: 1_000, sentMax: 5_000_000 })).toThrow(
      /parse and hold/,
    );
    expect(() => checkedPlan(docs, { rawMax: 20_000_000 })).not.toThrow();
  });

  test('the message says what to do, not just that it failed', () => {
    let message = '';
    try {
      checkedPlan(noisy(400), { sentMax: 1_000 });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('seconds on the 1 MB/s');
    expect(message).toContain('CAMP-67');
  });
});
