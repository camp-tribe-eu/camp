import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { packIndex } from '@/lib/search';
import {
  MAX_BYTES,
  RAW_MAX_BYTES,
  TOTAL_MAX_BYTES,
  checkedPlan,
  toSearchDocs,
} from '@/lib/search-index';
import { fetchOrder, type SearchIndex } from '@/lib/search-chunks';

// CAMP-134, defect 5 of six: the search index, 6.9 MB against a 1.5 MB
// budget (measured 25.09.2026), and a search page that said "could not
// be loaded" for a month.
//
// 🔴 WHY THIS IS NOT A UNIT TEST, AND WHY THE UNIT TESTS DO NOT COVER IT.
//
// tests/unit/search-budget.spec.ts is a good file. It drives `checkedPlan`
// with generated documents, it asserts the wiring rather than the
// constants, and review broke three mutations against it. What it cannot
// do is tell us whether the index WE ACTUALLY SHIP fits, because it does
// not know how many campsites there are or what their names look like.
// Its fixtures compress at a ratio it chose.
//
// CI's fixture holds 72. The build printed "search index: 72 campsites,
// 14 KB (1% of the limit)" on every run for weeks, which is a true
// sentence about nothing.
//
// So this file runs the SHIPPED guard, at the SHIPPED defaults, over the
// real rows from the real API. No browser. Measured today: under five
// seconds including the download.
//
// It also rehearses: the design that broke is a few lines, and it is run
// here against the same rows so the numbers in the card can be checked
// rather than believed.

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';
const TOKEN = process.env.API_BUILD_TOKEN;

/**
 * The scale below which this file proves nothing.
 *
 * 🔴 An explicit floor, not a comment. Point this at the CI fixture and
 * every assertion below passes on 72 rows — which is exactly the failure
 * the whole card is about, reproduced inside the thing meant to fix it.
 */
const MIN_ROWS = 10_000;

interface Row {
  name: string | null;
  country: string;
  region: string;
  slug: string;
  near: { name: string; m: number }[];
}

let rows: Row[];

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ request }) => {
  const res = await request.get(`${API}/spots/search-index`, {
    headers: TOKEN ? { 'x-build-token': TOKEN } : {},
    timeout: 120_000,
  });
  expect(
    res.status(),
    'the search index route did not answer — 429 means API_BUILD_TOKEN is not set',
  ).toBe(200);
  rows = (await res.json()) as Row[];
  expect(
    rows.length,
    `${rows.length} rows. This file must run against the full database; ` +
      'against a fixture it reports green over nothing.',
  ).toBeGreaterThan(MIN_ROWS);
});

test('the index we would actually ship passes its own ceilings', () => {
  const docs = toSearchDocs(rows);
  const { plan, total, sent } = checkedPlan(docs);

  const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`;
  console.log(
    `search index at full scale: ${docs.length.toLocaleString('en')} campsites, ` +
      `${plan.length} files, ${mb(total)} raw, ${mb(sent)} gzipped, ` +
      `largest file ${(Math.max(...plan.map((c) => c.bytes)) / 1000).toFixed(0)} kB`,
  );

  // 🔴 Reported as headroom, not just as a pass. "It fits" is the least
  // useful true sentence a guard can produce; the number that matters is
  // how much room is left before the conversation CAMP-67 names.
  console.log(
    `  raw ${((100 * total) / RAW_MAX_BYTES).toFixed(0)}% of its ceiling, ` +
      `sent ${((100 * sent) / TOTAL_MAX_BYTES).toFixed(0)}%, ` +
      `largest file ${((100 * Math.max(...plan.map((c) => c.bytes))) / MAX_BYTES).toFixed(0)}%`,
  );

  // Every file must be under the per-file ceiling, which is what the
  // planner promises and what a reader's first fetch pays.
  for (const chunk of plan) {
    expect(chunk.bytes, `chunk ${chunk.id} is over the per-file ceiling`).toBeLessThanOrEqual(
      MAX_BYTES,
    );
  }
  expect(plan.length, 'one file is the design that broke').toBeGreaterThan(1);
  expect(
    plan.reduce((n, c) => n + c.docs.length, 0),
    'the plan lost campsites',
  ).toBe(docs.length);
});

test('🔴 the design that broke, run against the same rows', () => {
  // The deleted route (apps/web/src/app/data/search.json/route.ts) packed
  // every campsite into ONE file and refused past 1.5 MB. That is these
  // three lines. They are here rather than described, so the number in
  // the card is a measurement and not a memory.
  const docs = toSearchDocs(rows);
  const oneFile = Buffer.byteLength(JSON.stringify(packIndex(docs)));
  // 🔴 Today's number, not the card's. CAMP-129 recorded 6.9 MB on
  // 25.09.2026, before the packer learned to derive `text` and the slug;
  // the same one-file design over today's rows measures larger, because
  // there are more of them. Both are true of their own day — which is
  // why this prints what it just measured rather than quoting either.
  console.log(
    `one file, today's packer: ${(oneFile / 1e6).toFixed(2)} MB against a ` +
      `${MAX_BYTES / 1e6} MB ceiling — ${(oneFile / MAX_BYTES).toFixed(1)}x over`,
  );
  expect(
    oneFile,
    'the one-file design would fit, so this rehearsal proves nothing',
  ).toBeGreaterThan(MAX_BYTES);

  // 🔴 And the mirror, which is the whole argument of this card: the same
  // code over a fixture-sized slice of the same rows. It fits with room
  // to spare, so nothing CI ever ran could have spoken.
  const fixtureSized = toSearchDocs(rows.slice(0, 72));
  const small = Buffer.byteLength(JSON.stringify(packIndex(fixtureSized)));
  console.log(
    `the same code over 72 rows, the size of CI's fixture: ` +
      `${(small / 1000).toFixed(0)} kB — ${((100 * small) / MAX_BYTES).toFixed(0)}% of the ceiling`,
  );
  expect(small).toBeLessThan(MAX_BYTES);
});

test('the chunk plan is something a reader can use before it finishes', async ({
  request,
}) => {
  // 🔴 The per-file ceiling stopped being able to fail once the planner
  // answered growth by making more files (that is CAMP-135's finding).
  // So the question worth asking at scale is no longer "is any file too
  // big" but "does the first thing a reader gets arrive quickly".
  const index = (await (
    await request.get('/data/search/index.json')
  ).json()) as SearchIndex;

  const order = fetchOrder(index);
  expect(order.length, 'the built index has no chunks').toBeGreaterThan(1);

  const first = order[0];
  const totalBytes = order.reduce((n, c) => n + c.bytes, 0);
  console.log(
    `${order.length} chunks, ${(totalBytes / 1e6).toFixed(2)} MB in all; ` +
      `first is ${first.id} at ${(first.bytes / 1000).toFixed(0)} kB ` +
      `(${first.count} campsites), largest ${(Math.max(...order.map((c) => c.bytes)) / 1000).toFixed(0)} kB`,
  );

  // Half a second on the 1 MB/s a phone on mobile data gets. Past that
  // "it loads progressively" has stopped being an answer for the FIRST
  // piece, which is the only one a reader waits for.
  //
  // 🔴 On its own this is nearly unfailable, and saying so is the point.
  // `fetchOrder` sorts smallest first, so `order[0]` is by construction
  // the smallest of 29 files — it can only fail if EVERY chunk is over
  // half a megabyte. Review caught it asserting the sort order rather
  // than the design.
  expect(
    first.bytes,
    'the first chunk a reader waits for is no longer small',
  ).toBeLessThan(500_000);

  // 🔴 So the assertion that can actually fail is on the LARGEST file —
  // the one near its ceiling. Measured today: 1 393 kB against a
  // per-file ceiling of 1 500 kB, which is 93%. That is the number worth
  // failing on, and the number the first version of this test printed
  // and then looked away from.
  const largest = Math.max(...order.map((c) => c.bytes));
  console.log(
    `  largest built file ${(largest / 1000).toFixed(0)} kB = ` +
      `${((100 * largest) / MAX_BYTES).toFixed(0)}% of the per-file ceiling`,
  );
  expect(
    largest,
    'a built chunk is over the per-file ceiling the planner promises',
  ).toBeLessThanOrEqual(MAX_BYTES);

  // And the gzipped whole against the ceiling that governs it —
  // asserted, not merely printed, which is what it was.
  const gz = gzipSync(
    Buffer.from(JSON.stringify(packIndex(toSearchDocs(rows)))),
    { level: 6 },
  ).length;
  console.log(
    `  whole index, gzip -6: ${(gz / 1e6).toFixed(2)} MB = ` +
      `${((100 * gz) / TOTAL_MAX_BYTES).toFixed(0)}% of the download ceiling`,
  );
  expect(
    gz,
    'the index is past what we are willing to make a reader download',
  ).toBeLessThanOrEqual(TOTAL_MAX_BYTES);
});
