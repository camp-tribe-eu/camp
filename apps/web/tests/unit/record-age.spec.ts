import { expect, test } from '@playwright/test';
import { bandFor, BAND_CAPTION, recordAge, recordEdit, YEAR_DAYS } from '@/lib/record-age';
import { SOURCES } from '@/lib/sources';

// CAMP-256 — the grade and the wording of an OSM edit date, as pure logic.
//
// 🔴 EVERY DATE AND EVERY EXPECTED STRING IS TYPED, and `now` is typed too.
// A test that took its dates from the wall clock would change its answer
// the day a boundary passed, and one that built its expected "June 2023"
// from the same `toLocaleDateString` the code uses would agree with a
// mutation of it. The month names below are written out.

const NOW = new Date('2026-10-15T20:00:00.000Z');

test.describe('the grade: within a year / one to three years / more than three', () => {
  test('the three edges are whole days, and each is pinned', () => {
    expect(YEAR_DAYS).toBe(365);
    expect(bandFor(0)).toBe('fresh');
    expect(bandFor(364)).toBe('fresh');
    expect(bandFor(365)).toBe('one-to-three');
    expect(bandFor(1094)).toBe('one-to-three');
    expect(bandFor(1095)).toBe('over-three');
    expect(bandFor(9999)).toBe('over-three');
  });

  test('read through recordAge, from a real instant', () => {
    // 2025-10-16T20:00Z is 364 days and 0 h before NOW: still within a year.
    const v = recordAge('2025-10-16T20:00:00.000Z', NOW);
    expect(v).toMatchObject({ known: true, band: 'fresh', month: 'October 2025' });
    // One day earlier is day 365.
    const w = recordAge('2025-10-15T20:00:00.000Z', NOW);
    expect(w).toMatchObject({ known: true, band: 'one-to-three', month: 'October 2025' });
    // Three years to the day: 2023-10-16 is day 1095 (2024 is a leap year).
    expect(recordAge('2023-10-17T20:00:00.000Z', NOW)).toMatchObject({
      band: 'one-to-three',
    });
    expect(recordAge('2023-10-16T20:00:00.000Z', NOW)).toMatchObject({
      band: 'over-three',
    });
  });
});

test.describe('what it says', () => {
  test('June 2023, as a month and a year, in English, with the day for <time>', () => {
    const v = recordAge('2023-06-14T10:11:12.000Z', NOW);
    // 3 years 4 months before NOW, so the third grade.
    expect(v).toEqual({
      known: true,
      band: 'over-three',
      day: '2023-06-14',
      month: 'June 2023',
      caption: 'more than three years ago',
      source: { id: 'osm', name: 'OpenStreetMap' },
    });
    // The middle grade, with a month a typed distance from NOW: 15 months.
    expect(recordAge('2025-07-14T10:11:12.000Z', NOW)).toEqual({
      known: true,
      band: 'one-to-three',
      day: '2025-07-14',
      month: 'July 2025',
      caption: 'between one and three years ago',
      source: { id: 'osm', name: 'OpenStreetMap' },
    });
    // …and the first: 4 months.
    expect(recordAge('2026-06-14T10:11:12.000Z', NOW)).toEqual({
      known: true,
      band: 'fresh',
      day: '2026-06-14',
      month: 'June 2026',
      caption: 'within the last year',
      source: { id: 'osm', name: 'OpenStreetMap' },
    });
  });

  test('the three captions are plain spans of time, written out', () => {
    expect(BAND_CAPTION).toEqual({
      fresh: 'within the last year',
      'one-to-three': 'between one and three years ago',
      'over-three': 'more than three years ago',
    });
  });

  test('an old record is shown with its month and a caption, not left out', () => {
    expect(recordAge('2011-02-03T04:05:06.000Z', NOW)).toEqual({
      known: true,
      band: 'over-three',
      day: '2011-02-03',
      month: 'February 2011',
      caption: 'more than three years ago',
      source: { id: 'osm', name: 'OpenStreetMap' },
    });
  });

  test('🔴 UTC decides the month: 23:30 on 31 May is May, wherever the build runs', () => {
    expect(recordAge('2023-05-31T23:30:00.000Z', NOW)).toMatchObject({
      month: 'May 2023',
      day: '2023-05-31',
    });
    expect(recordAge('2023-06-01T00:30:00.000Z', NOW)).toMatchObject({
      month: 'June 2023',
    });
  });

  test('a date a little ahead of the clock is "today", not an error', () => {
    const v = recordAge('2026-10-16T08:00:00.000Z', NOW); // 12 h ahead
    expect(v).toMatchObject({ known: true, band: 'fresh', month: 'October 2026' });
  });
});

test.describe('"Not known" is the answer to everything that is not an OSM edit date', () => {
  const NOT_KNOWN = { known: false };

  for (const [what, raw] of [
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['text', 'last Tuesday'],
    ['a number', 1787953167],
    ['an object', {}],
    ['a date before OpenStreetMap existed', '2004-07-31T23:59:59.000Z'],
    ['1970', '1970-01-01T00:00:00.000Z'],
    ['more than a day in the future', '2026-10-16T21:00:01.000Z'],
    ['the year 2099', '2099-01-01T00:00:00.000Z'],
  ] as [string, unknown][]) {
    test(`${what}`, () => {
      expect(recordAge(raw, NOW)).toEqual(NOT_KNOWN);
    });
  }

  test('the first day of OpenStreetMap is a date', () => {
    expect(recordAge('2004-08-01T00:00:00.000Z', NOW)).toMatchObject({
      known: true,
      month: 'August 2004',
      band: 'over-three',
    });
  });
});

// ---------------------------------------------------------------------------
// A record that comes only from DATAtourisme: the SOURCE's own date.
//
// 🔴 `sources[].updatedAt` means three different things in three sources, and
// the registry says which (`SourceInfo.datesAre`). The OpenStreetMap entry's
// is the day OUR importer last looked — this week for almost every campsite.
// Every case below has that entry in `sources`, dated this week, and expects
// it never to be read.

const entry = (id: string, updatedAt: unknown) => ({
  id,
  ref: 'r',
  updatedAt,
  fields: ['name'],
});
const OSM_LOOKED_THIS_WEEK = entry('osm', '2026-10-12');

test.describe('recordEdit: whose date, and which', () => {
  test('the registry marks exactly one source as dating its own records', () => {
    // Written out. A second source acquiring `edited` is a decision with a
    // legal and a wording side, not a side effect of an edit to a table.
    expect(
      Object.values(SOURCES)
        .filter((s) => s.datesAre === 'edited')
        .map((s) => s.id),
    ).toEqual(['datatourisme']);
    expect(SOURCES.osm.datesAre).toBe('checked');
  });

  test('an OpenStreetMap edit date wins, and names OpenStreetMap', () => {
    const v = recordEdit('2023-06-14T10:11:12.000Z', [entry('datatourisme', '2026-08-20')], NOW);
    expect(v).toMatchObject({
      known: true,
      month: 'June 2023',
      source: { id: 'osm', name: 'OpenStreetMap' },
    });
  });

  test('no OSM date: the DATAtourisme date, day precision kept as a day, source named', () => {
    const v = recordEdit(null, [OSM_LOOKED_THIS_WEEK, entry('datatourisme', '2026-08-20')], NOW);
    expect(v).toEqual({
      known: true,
      band: 'fresh',
      day: '2026-08-20',
      month: 'August 2026',
      caption: 'within the last year',
      source: { id: 'datatourisme', name: 'DATAtourisme' },
    });
  });

  test('the oldest record we hold, from 2002, is shown — not read as "before OpenStreetMap"', () => {
    const v = recordEdit(null, [entry('datatourisme', '2002-05-24')], NOW);
    expect(v).toMatchObject({ known: true, month: 'May 2002', band: 'over-three' });
    // The same date as an OSM edit would be impossible, and is refused.
    expect(recordAge('2002-05-24T00:00:00.000Z', NOW)).toEqual({ known: false });
  });

  test('🔴 the OpenStreetMap entry`s updatedAt is NEVER read: it is the day we looked', () => {
    expect(recordEdit(null, [OSM_LOOKED_THIS_WEEK], NOW)).toEqual({ known: false });
  });

  test('🔴 nor is any source the registry does not mark `edited`, nor one it does not know', () => {
    const others = [
      entry('eea-bathing-water', '2026-06-02'),
      entry('eea-air-quality', '2026-10-15'),
      entry('someone-new', '2026-01-01'),
    ];
    expect(recordEdit(null, others, NOW)).toEqual({ known: false });
  });

  test('an unusable DATAtourisme date is "Not known", and does not stop a later valid one', () => {
    for (const bad of [null, undefined, '', 'last Tuesday', '1970-01-01', '2099-01-01', 20260820, {}]) {
      expect([String(bad), recordEdit(null, [entry('datatourisme', bad)], NOW)]).toEqual([
        String(bad),
        { known: false },
      ]);
    }
  });

  test('malformed `sources` are skipped, never guessed at', () => {
    for (const junk of [undefined, null, 'osm', 7, {}, [null, 3, 'x', {}, { id: 4 }]]) {
      expect([JSON.stringify(junk), recordEdit(null, junk, NOW)]).toEqual([
        JSON.stringify(junk),
        { known: false },
      ]);
    }
  });

  test('an unusable OSM date falls through to the source date; a usable one does not', () => {
    expect(recordEdit('garbage', [entry('datatourisme', '2026-08-20')], NOW)).toMatchObject({
      source: { id: 'datatourisme' },
    });
    expect(recordEdit('2026-06-14T10:11:12.000Z', [entry('datatourisme', '2002-05-24')], NOW)).toMatchObject({
      source: { id: 'osm' },
    });
  });
});
