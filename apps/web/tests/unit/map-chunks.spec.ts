import { expect, test } from '@playwright/test';
import {
  type Bounds,
  type RegionSummary,
  chunkKey,
  chunkUrl,
  chunksInView,
  countInView,
  dataMessage,
  filterCountLabel,
  overlaps,
} from '../../src/lib/map-chunks';

// CAMP-127. The rules that decide what the map fetches — and, more
// importantly, what it says when it has nothing to draw.

const region = (over: Partial<RegionSummary> = {}): RegionSummary => ({
  country: 'FR',
  region: 'Vendée',
  slug: 'vendee',
  count: 100,
  minLon: -2,
  minLat: 46,
  maxLon: -1,
  maxLat: 47,
  lon: -1.5,
  lat: 46.5,
  ...over,
});

const view = (over: Partial<Bounds> = {}): Bounds => ({
  west: -3,
  south: 45,
  east: 0,
  north: 48,
  ...over,
});

test('a chunk address is built from the country and the slug', () => {
  expect(chunkKey({ country: 'FR', slug: 'vendee' })).toBe('fr/vendee');
  expect(chunkUrl('fr/vendee')).toBe('/data/spots/fr/vendee.geojson');
  // The campsites with no region at all keep their own address.
  expect(chunkKey({ country: 'CY', slug: '_unplaced' })).toBe('cy/_unplaced');
});

test('a region inside the view is in view', () => {
  expect(overlaps(view(), region())).toBe(true);
});

test('a region outside it is not', () => {
  expect(overlaps(view(), region({ minLon: 10, maxLon: 11 }))).toBe(false);
  expect(overlaps(view(), region({ minLat: 60, maxLat: 61 }))).toBe(false);
});

test('a region touching the edge counts as in view', () => {
  // 🔴 A campsite exactly on the boundary must not blink out of
  // existence as the reader pans. That reads as a data bug for weeks.
  expect(overlaps(view(), region({ minLon: 0, maxLon: 5 }))).toBe(true);
  expect(overlaps(view(), region({ minLat: 48, maxLat: 50 }))).toBe(true);
});

test('the middle of the screen is fetched first', () => {
  // 🔴 Fetches finish in the order they are made, so this is the order
  // the reader watches the map fill in.
  const index = [
    region({ slug: 'far', lon: -2.9, lat: 45.1, minLon: -3, maxLon: -2.8, minLat: 45, maxLat: 45.2 }),
    region({ slug: 'middle', lon: -1.5, lat: 46.5 }),
  ];
  expect(chunksInView(index, view()).keys).toEqual(['fr/middle', 'fr/far']);
});

test('a view wider than the limit says so instead of drawing part of it', () => {
  const index = Array.from({ length: 80 }, (_, i) =>
    region({ slug: `r${i}`, count: 10 }),
  );
  const out = chunksInView(index, view(), 60);
  expect(out.keys).toHaveLength(60);
  // 🔴 The caller must not draw 60 of 80 chunks as if that were the map.
  expect(out.tooMany).toBe(true);
});

test('and one within the limit does not', () => {
  const index = [region({ slug: 'a' }), region({ slug: 'b' })];
  expect(chunksInView(index, view(), 60).tooMany).toBe(false);
});

test('an empty index asks for nothing and claims nothing', () => {
  const out = chunksInView([], view());
  expect(out.keys).toEqual([]);
  expect(out.tooMany).toBe(false);
  expect(countInView([], view())).toBe(0);
});

test('the count in view comes from the index, without fetching', () => {
  const index = [
    region({ slug: 'a', count: 40 }),
    region({ slug: 'b', count: 2 }),
    region({ slug: 'far', count: 9999, minLon: 100, maxLon: 101 }),
  ];
  expect(countInView(index, view())).toBe(42);
});

// ── what the reader is told ────────────────────────────────────────────

test('🔴 a failure is never silent, and never reads as "none here"', () => {
  // The defect this card exists for. Seen on screen 24.09.2026: the data
  // request answered 500 and the panel read "0 campsites".
  const msg = dataMessage({ kind: 'failed', what: 'HTTP 500' });
  expect(msg).toContain('could not be loaded');
  expect(msg).toContain('HTTP 500');
  expect(msg).toContain('not because there is nothing here');
});

test('loading says loading, rather than nothing', () => {
  expect(dataMessage({ kind: 'loading' })).toMatch(/Loading/);
});

test('a wide view explains the circles instead of pretending they are campsites', () => {
  const msg = dataMessage({ kind: 'wide', count: 61557 }) ?? '';
  expect(msg).toContain('61,557');
  expect(msg).toContain('zoom in');
  expect(msg).toContain('regions');
});

test('and a map that is simply working says nothing at all', () => {
  expect(dataMessage({ kind: 'ready' })).toBeNull();
});

// ── the count in the filter panel ─────────────────────────────────

test.describe('filterCountLabel', () => {
  const counts = { shown: 12, total: 1079, filtering: false };

  test('\u{1F534} a zoomed-out map never says a number, least of all zero', () => {
    // The whole reason this function exists. The panel printed a bold 0
    // directly above "3,116 campsites in view" — two numbers about the
    // same map, disagreeing, on one screen.
    for (const filtering of [false, true]) {
      const label = filterCountLabel(
        { kind: 'wide', count: 3116 },
        { ...counts, shown: 0, total: 0, filtering },
      );
      expect(label.value, 'a wide view has no campsite count').toBeNull();
      expect(label.text).toMatch(/zoom in/i);
    }
  });

  test('\u{1F534} nor does a map that failed to load', () => {
    const label = filterCountLabel(
      { kind: 'failed', what: 'HTTP 500' },
      { ...counts, shown: 0, total: 0 },
    );
    expect(label.value).toBeNull();
    // And it does not tell the reader to zoom in, which would not help.
    expect(label.text).not.toMatch(/zoom in/i);
    expect(label.text).toMatch(/did not load/i);
  });

  test('nor one that has not finished loading', () => {
    expect(filterCountLabel({ kind: 'loading' }, counts).value).toBeNull();
  });

  test('a ready map gives the number, and says what it is of', () => {
    expect(filterCountLabel({ kind: 'ready' }, counts)).toEqual({
      value: 12,
      text: ' campsites',
    });
    expect(
      filterCountLabel({ kind: 'ready' }, { ...counts, filtering: true }).text,
    ).toBe(' of 1,079 campsites');
  });

  test('a ready map with genuinely nothing shown may say zero', () => {
    // \u{1F534} The one place a zero is honest: the data IS loaded and the
    // filters match none of it. Suppressing it here would be the
    // opposite mistake — hiding a true answer.
    const label = filterCountLabel(
      { kind: 'ready' },
      { shown: 0, total: 1079, filtering: true },
    );
    expect(label.value).toBe(0);
  });

  test('every state answers — none falls through to silence', () => {
    const states = [
      { kind: 'ready' as const },
      { kind: 'loading' as const },
      { kind: 'wide' as const, count: 5 },
      { kind: 'failed' as const, what: 'x' },
    ];
    for (const s of states) {
      const label = filterCountLabel(s, counts);
      expect(label.text.trim(), `${s.kind} says nothing`).not.toBe('');
    }
  });
});
