import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { packIndex, type SearchDoc } from '@/lib/search';
import {
  MAX_BYTES,
  RAW_MAX_BYTES,
  TOTAL_MAX_BYTES,
  checkedPlan,
  toSearchDocs,
} from '@/lib/search-index';

// CAMP-135 — the ceilings on the search index, tested so they can fail.
//
// 🔴 Why this file exists, and why its first version did not do the job.
//
// `checkedPlan` is the only thing between a reader and an index that
// costs their phone a second of parsing, and until CAMP-135 it had NO
// tests: the only way to make it throw was to build several real
// megabytes, so nobody did.
//
// The first version of this file added five tests and review broke it
// in one token. Swapping the two ceilings at the call site —
//
//   { sentMax = RAW_MAX_BYTES, rawMax = TOTAL_MAX_BYTES }
//
// — puts the 5 MB budget back on raw bytes, which is the exact bug this
// card exists to fix, and all five tests stayed green. They pinned the
// VALUES of the constants and never checked that either constant was
// wired to the check it names. Two more mutations survived as well:
// summing one chunk instead of all of them, and gzipping the unpacked
// documents rather than the packed bytes we actually serve.
//
// So these tests assert the WIRING, at the shipped defaults, with no
// injected limits at all. If the ceilings are swapped, the first two
// fail.

/** A deterministic RNG that stays inside 32 bits — see `random()`. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const doc = (
  country: string,
  i: number,
  near: { name: string; m: number }[],
) => ({ name: `Camping Number ${i}`, country, region: `r${i % 40}`, slug: `c${i}`, near });

/**
 * Text-shaped documents, which compress the way our real data does.
 * Measured on the live index: raw / gzip = 4.7.
 */
function compressible(count: number, places: number): SearchDoc[] {
  const names = [
    'Saint-Étienne-de-Montluc', 'La Loire', 'Gare de Nantes', 'Lac de Grand-Lieu',
    'Boulangerie du Port', 'Sainte-Pazanne', 'La Sèvre Nantaise', 'Montaigu-Vendée',
  ];
  return toSearchDocs(
    Array.from({ length: count }, (_, i) =>
      doc(i % 2 ? 'fr' : 'de', i,
        Array.from({ length: places }, (_, k) => ({
          name: names[(i + k) % names.length], m: 100 + ((i * 37 + k) % 9000),
        }))),
    ),
  );
}

/**
 * Documents that genuinely do not compress — the only way the
 * COMPRESSED ceiling can speak before the raw one.
 *
 * 🔴 The first version of this generator did not work. Its LCG was
 * `seed * 1103515245`, which leaves Number.MAX_SAFE_INTEGER after three
 * steps; the state then cycled with a period of about ten thousand,
 * well inside gzip's 32 KB window, and review measured the output
 * compressing 3x — it was decorative. This one stays in 32 bits.
 */
function random(count: number, places: number): SearchDoc[] {
  const rnd = mulberry32(7);
  const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const word = (n: number) =>
    Array.from({ length: n }, () => abc[Math.floor(rnd() * abc.length)]).join('');
  return toSearchDocs(
    Array.from({ length: count }, (_, i) =>
      doc(i % 2 ? 'fr' : 'de', i,
        Array.from({ length: places }, () => ({
          name: word(24), m: Math.floor(rnd() * 9000),
        }))),
    ),
  );
}

test.describe.configure({ timeout: 120_000 });

test.describe('the ceilings on the search index', () => {
  test('the defaults are the constants', () => {
    expect(TOTAL_MAX_BYTES).toBe(5_000_000);
    expect(RAW_MAX_BYTES).toBe(12_000_000);
    expect(MAX_BYTES).toBe(1_500_000);
  });

  test('🔴 the RAW ceiling is the one wired to raw bytes', () => {
    // Measured: 14.5 MB of JSON, 1.4 MB gzipped. Over the 12 MB raw
    // ceiling and comfortably under the 5 MB download one — at the
    // SHIPPED defaults, so swapping the two makes this fail.
    const docs = compressible(55_000, 6);
    let message = '';
    try {
      checkedPlan(docs);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message, 'expected the raw ceiling to refuse this').toContain(
      'a browser should have to parse and hold',
    );
    // And it says the download is fine, which is the point of two numbers.
    expect(message).toMatch(/This is not the download — that is \d+\.\d+ MB compressed, and fine/);
  });

  test('🔴 the COMPRESSED ceiling is the one wired to gzip', () => {
    // Incompressible, so gzip passes 5 MB while raw is still under
    // 12 MB — the only shape that reaches this check, and the reason it
    // is not decoration. The window is narrow on purpose: with ceilings
    // of 12 MB raw and 5 MB gzipped, this check speaks first only below
    // a ratio of 2.4, and random text measures 2.0 where our own data
    // measures 4.7. Measured here: 11.2 MB raw, 5.6 MB gzipped.
    const docs = random(12_000, 20);
    let message = '';
    try {
      checkedPlan(docs);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message, 'expected the compressed ceiling to refuse this').toContain(
      'we are willing to',
    );
    expect(message).toContain('seconds on the 1 MB/s');
  });

  test('🔴 it gzips the bytes it serves, summed over every file', () => {
    // Review broke both halves of this: summing `plan.slice(0, 1)` and
    // gzipping `c.docs` instead of `packIndex(c.docs)` both survived,
    // because every fixture made one chunk of one country.
    const { plan, sent, total } = checkedPlan(compressible(4_000, 4));
    expect(plan.length, 'the fixture must span more than one file').toBeGreaterThan(1);

    // Recomputed here from the packed form the chunk route actually
    // writes, so a change to WHICH bytes are measured fails this.
    const expected = plan.reduce(
      (n, c) =>
        n + gzipSync(Buffer.from(JSON.stringify(packIndex([...c.docs]))), { level: 6 }).length,
      0,
    );
    expect(sent).toBe(expected);
    expect(total).toBe(plan.reduce((n, c) => n + c.bytes, 0));
    expect(sent).toBeLessThan(total);
  });

  test('an ordinary index passes, and the two sizes are different numbers', () => {
    const { plan, total, sent } = checkedPlan(compressible(2_000, 4));
    expect(plan.length).toBeGreaterThan(0);
    expect(sent).toBeLessThan(total / 2);
  });
});
