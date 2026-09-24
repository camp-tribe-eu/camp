import { expect, test } from '@playwright/test';
import {
  daysOld,
  describeSources,
  formatUpdated,
  isStale,
  SOURCES,
  STALE_AFTER_DAYS,
  type SpotSource,
} from '../../src/lib/sources';

// CAMP-101 — the attribution rules, which are a licence condition rather
// than a style choice.
//
// 🔴 Licence Ouverte 2.0 requires the attribution to name the source AND
// the date the reused information was last updated, and forbids
// misleading anyone about either. Our records carry dates from
// 2022-01-04 to today, so a single undated line would breach it. These
// tests assert the parts that can quietly stop being true.

const entry = (over: Partial<SpotSource> = {}): SpotSource => ({
  id: 'datatourisme',
  ref: 'https://data.datatourisme.fr/13/abc',
  updatedAt: '2026-08-28',
  fields: ['stars', 'description'],
  ...over,
});

test.describe('every source we name carries its licence', () => {
  test('nothing is listed without a licence and a link to it', () => {
    for (const [id, s] of Object.entries(SOURCES)) {
      expect(s.id, `${id} disagrees with its key`).toBe(id);
      expect(s.name.length, `${id} has no readable name`).toBeGreaterThan(2);
      expect(s.licence.length, `${id} has no licence`).toBeGreaterThan(3);
      expect(s.licenceUrl, `${id} has no licence URL`).toMatch(/^https:\/\//);
      expect(s.url, `${id} has no source URL`).toMatch(/^https:\/\//);
    }
  });

  test('the two we actually use are both present', () => {
    expect(SOURCES.osm.licence).toContain('ODbL');
    expect(SOURCES.datatourisme.licence).toContain('Licence Ouverte');
  });
});

test.describe('🔴 an unknown source is shown, never dropped', () => {
  // Dropping it would silently remove an attribution, which is the one
  // failure this file exists to prevent. Showing it wrong is visible and
  // therefore gets fixed.
  test('an id we do not recognise still appears', () => {
    const described = describeSources([entry({ id: 'somewhere-new' })]);
    expect(described).toHaveLength(1);
    expect(described[0].id).toBe('somewhere-new');
    expect(described[0].source).toBeNull();
  });

  test('a known id carries its licence through', () => {
    const described = describeSources([entry()]);
    expect(described[0].source?.licence).toContain('Licence Ouverte');
  });

  test('the order does not depend on the order they were stored', () => {
    const a = describeSources([entry({ id: 'osm' }), entry({ id: 'datatourisme' })]);
    const b = describeSources([entry({ id: 'datatourisme' }), entry({ id: 'osm' })]);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
  });

  test('no sources is no attribution block, not an empty one', () => {
    expect(describeSources([])).toEqual([]);
  });
});

test.describe('the date, which the licence is specific about', () => {
  const today = new Date('2026-09-23');

  test('is rendered as a person reads it', () => {
    expect(formatUpdated('2026-08-28')).toBe('28 August 2026');
  });

  // 🔴 Never invented. A source that gave us no date gets no date on the
  // page — the parser already refuses such rows, and this is the second
  // line of that defence.
  test('an unusable date renders as nothing rather than as today', () => {
    expect(formatUpdated('')).toBeNull();
    expect(formatUpdated('not a date')).toBeNull();
    expect(daysOld('nonsense', today)).toBeNull();
  });

  test('age is counted in days from the source date', () => {
    expect(daysOld('2026-09-23', today)).toBe(0);
    expect(daysOld('2026-09-13', today)).toBe(10);
  });

  // The real spread in our data: 2022-01-04 to the same morning.
  test('a four-year-old record is marked stale', () => {
    expect(isStale('2022-01-04', today)).toBe(true);
  });

  test('a fresh record is not', () => {
    expect(isStale('2026-09-21', today)).toBe(false);
  });

  test('the boundary is the boundary', () => {
    const exactly = new Date(today.getTime() - STALE_AFTER_DAYS * 86_400_000);
    expect(isStale(exactly.toISOString().slice(0, 10), today)).toBe(false);
    const oneMore = new Date(today.getTime() - (STALE_AFTER_DAYS + 1) * 86_400_000);
    expect(isStale(oneMore.toISOString().slice(0, 10), today)).toBe(true);
  });

  test('a date in the future is not stale and does not crash', () => {
    expect(isStale('2027-01-01', today)).toBe(false);
  });
});
