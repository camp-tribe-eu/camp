import { expect, test } from '@playwright/test';
import {
  chunkUrl,
  fetchOrder,
  loadProgress,
  partialNotice,
  type SearchChunk,
  type SearchIndex,
} from '../../src/lib/search-chunks';

// CAMP-129. The rules that decide what arrives first, and — the part
// that matters more — what the reader is told while it has not all
// arrived. A partial index that says nothing is a search that answers
// "no results" for a campsite we hold.

const chunk = (over: Partial<SearchChunk> & { id: string }): SearchChunk => ({
  country: over.id.slice(0, 2),
  count: 100,
  bytes: 40_000,
  ...over,
});

const index = (...chunks: SearchChunk[]): SearchIndex => ({ v: 1, chunks });

test('a chunk id becomes its file', () => {
  expect(chunkUrl('si')).toBe('/data/search/si.json');
  expect(chunkUrl('fr-2')).toBe('/data/search/fr-2.json');
});

test('the smallest chunk is fetched first', () => {
  // 🔴 Measured: the median country is 38 KB and France is 2 309 KB.
  // Fetching France first leaves twenty-six countries waiting behind the
  // one that takes longest.
  const i = index(
    chunk({ id: 'fr', bytes: 2_309_000 }),
    chunk({ id: 'si', bytes: 38_000 }),
    chunk({ id: 'de', bytes: 510_000 }),
  );
  expect(fetchOrder(i).map((c) => c.id)).toEqual(['si', 'de', 'fr']);
});

test('equal sizes keep a stable order, so arrival is not a coin toss', () => {
  const i = index(chunk({ id: 'pl' }), chunk({ id: 'at' }), chunk({ id: 'be' }));
  expect(fetchOrder(i).map((c) => c.id)).toEqual(['at', 'be', 'pl']);
  expect(fetchOrder(i)).toEqual(fetchOrder(i));
});

test('fetchOrder does not disturb the index it was given', () => {
  const i = index(chunk({ id: 'fr', bytes: 999 }), chunk({ id: 'si', bytes: 1 }));
  fetchOrder(i);
  expect(i.chunks.map((c) => c.id)).toEqual(['fr', 'si']);
});

// ── progress, in campsites rather than files ──────────────────────────

test('progress is counted in campsites, not in files', () => {
  // "22 of 27 files" means nothing to somebody looking for a campsite.
  const i = index(
    chunk({ id: 'si', count: 284 }),
    chunk({ id: 'fr', count: 23_645 }),
  );
  expect(loadProgress(i, new Set(['si']))).toEqual({
    searchable: 284,
    total: 23_929,
    done: false,
  });
});

test('everything loaded is done', () => {
  const i = index(chunk({ id: 'si', count: 1 }), chunk({ id: 'fr', count: 2 }));
  expect(loadProgress(i, new Set(['si', 'fr'])).done).toBe(true);
});

test('an empty index is never "done"', () => {
  // 🔴 0 === 0 would read as complete. An index with no chunks is a
  // broken build, and reporting it as a finished load is the silent
  // failure this project treats as worse than a crash.
  expect(loadProgress(index(), new Set()).done).toBe(false);
});

// ── what the reader is told ───────────────────────────────────────────

test('a working, complete search says nothing', () => {
  expect(partialNotice({ searchable: 10, total: 10, done: true }, 0)).toBeNull();
});

test('a partial index says so, with the number that matters', () => {
  const msg = partialNotice({ searchable: 37_777, total: 61_422, done: false }, 0) ?? '';
  expect(msg).toContain('37,777');
  expect(msg).toContain('61,422');
  expect(msg).toContain('still loading');
});

test('🔴 a reader typing before France lands is not told "no results"', () => {
  // The whole point. Silence here means a campsite we hold looks like a
  // campsite we do not have.
  expect(partialNotice({ searchable: 1, total: 61_422, done: false }, 0)).not.toBeNull();
});

test('a failed part is named, and points somewhere that works', () => {
  const msg = partialNotice({ searchable: 100, total: 200, done: false }, 2) ?? '';
  expect(msg).toContain('2 parts');
  expect(msg).toContain('could not be loaded');
  expect(msg).toContain('country list');
});

test('one failed part is singular', () => {
  expect(partialNotice({ searchable: 1, total: 2, done: false }, 1)).toContain('1 part of');
});

test('a failure outranks progress, because it does not fix itself', () => {
  // Still loading AND something failed: the failure is what the reader
  // needs, since waiting will not bring the missing part.
  const msg = partialNotice({ searchable: 5, total: 10, done: false }, 1) ?? '';
  expect(msg).toContain('could not be loaded');
  expect(msg).not.toContain('still loading');
});

test('nothing at all yet says loading, not zero of zero', () => {
  expect(partialNotice({ searchable: 0, total: 0, done: false }, 0)).toMatch(/Loading/);
});
