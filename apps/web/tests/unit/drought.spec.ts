import { readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  DEKAD_SKIPPED_DAYS,
  dekadAgeDays,
  droughtNote,
  droughtState,
  readMeta,
  readingAt,
} from '@/lib/drought';

// CAMP-163 — the rules this layer stands on, each pinned by itself.
//
// 🔴 EVERY NUMBER HERE IS A LITERAL, never imported from the constant it
// checks. CAMP-166 shipped five rules whose tests took their boundary
// from the value under test: mutate the value and the test moved with
// it, so all five mutations survived and the card read as done. The
// constants are imported only to assert what they are, once, below.

const DATA = join(__dirname, '..', '..', 'src', 'data');
const FILE = JSON.parse(readFileSync(join(DATA, 'drought.json'), 'utf8'));
const DOMAIN = JSON.parse(readFileSync(join(DATA, 'drought-domain.json'), 'utf8'));
const decode = (s: string): Uint8Array => new Uint8Array(gunzipSync(Buffer.from(s, 'base64')));

const DAY = 86_400_000;
const dekadAt = Date.parse(`${FILE.meta.dekad}T00:00:00Z`);
const after = (days: number) => new Date(dekadAt + days * DAY);
const state = (days = 12, file: unknown = FILE, domain: unknown = DOMAIN) =>
  droughtState(file, domain, after(days), decode);

test.describe('the ten-day budget', () => {
  test('the two budgets are the cadence, written out', () => {
    expect(DEKAD_SKIPPED_DAYS).toBe(40);
  });

  // 🔴 Both sides of the boundary, in literal days. Dekads are ten days
  // apart, so 40 is "one publication missed and the next is due" and 41
  // is "two have not appeared".
  test('a reading inside the budget is current', () => {
    expect(state(23).kind).toBe('current');
    expect(state(40).kind).toBe('current');
  });

  test('past it, the layer says a publication has been missed', () => {
    expect(state(41).kind).toBe('behind');
    expect(state(400).kind).toBe('behind');
  });

  // 🔴 A dekad dated in the future is not freshness. A clock that read
  // "-5 days old" would otherwise satisfy every budget for ever, which
  // is the shape of a check that agrees with the bug.
  test('a dekad in the future is behind, not fresh', () => {
    expect(state(-5).kind).toBe('behind');
  });

  test('the age is whole days and does not move with the hour of the run', () => {
    expect(dekadAgeDays('2026-09-11', new Date('2026-10-04T00:30:00Z'))).toBe(23);
    expect(dekadAgeDays('2026-09-11', new Date('2026-10-04T23:30:00Z'))).toBe(23);
  });
});

test.describe('the three answers, which must never collapse into two', () => {
  const current = () => {
    const s = state();
    if (s.kind !== 'current') throw new Error(`expected current, got ${s.kind}`);
    return s;
  };

  // 🔴 THE CARD ASKED FOR THE WRONG ANSWER HERE, and this is the test
  // that would have caught it. CAMP-163 said "Malta shows no data".
  // Malta is inside the study domain — it carried a class in three of
  // the dekads sampled — and the EDO factsheet says value 0 is "Normal
  // conditions (No drought)". Printing "no data" would have been a false
  // statement about a real place.
  test('🔴 a covered place with no drought says so, and does not say "no data"', () => {
    const r = readingAt(current(), 35.9, 14.4);
    expect(r.known).toBe(true);
    if (!r.known) return;
    expect(r.value).toBe(0);
    expect(r.label).toMatch(/no drought/i);
    expect(droughtNote(current(), 35.9, 14.4).tone).toBe('quiet');
  });

  test('a place outside the study domain says we do not know', () => {
    const r = readingAt(current(), 45, -15);
    expect(r.known).toBe(false);
    expect(droughtNote(current(), 45, -15).tone).toBe('gap');
  });

  test('a place off the cropped grid says we do not know', () => {
    expect(readingAt(current(), 40, 60).known).toBe(false);
    expect(readingAt(current(), 10, 10).known).toBe(false);
  });

  test('a place in a dry spell reports the stage in our own words', () => {
    const r = readingAt(current(), 50.85, 4.35);
    expect(r.known).toBe(true);
    if (!r.known) return;
    expect(r.value).toBeGreaterThan(0);
    expect(r.label.length).toBeGreaterThan(0);
  });

  test('a class the file does not describe is not invented', () => {
    const s = state(12, { ...FILE, meta: { ...FILE.meta, classes: [{ value: 99, label: 'x', detail: 'y' }] } });
    if (s.kind !== 'current') throw new Error('expected current');
    expect(readingAt(s, 50.85, 4.35).known).toBe(false);
  });

  // Non-numbers must not index into the grid.
  test('a coordinate that is not a number is not a lookup', () => {
    expect(readingAt(current(), NaN, 4.35).known).toBe(false);
    expect(readingAt(current(), 50.85, Infinity).known).toBe(false);
  });
});

test.describe('the file is not trusted by the reader that renders it', () => {
  // 🔴 The script already refuses these. That is exactly why this exists
  // too: one gate in the writer protects the writer, and a file edited by
  // hand reaches the page through here and nothing else.
  test('a credit that is not the CEMS notice is refused', () => {
    expect(readMeta({ ...FILE, meta: { ...FILE.meta, attribution: 'Copernicus' } })).toBeNull();
    // The year is part of the notice, not decoration.
    expect(
      readMeta({
        ...FILE,
        meta: { ...FILE.meta, attribution: 'Contains modified Copernicus Emergency Management Service information [Year]' },
      }),
    ).toBeNull();
  });

  test('a reserved word anywhere in the meta is refused', () => {
    for (const field of ['source', 'indicator', 'cadenceNote']) {
      expect(readMeta({ ...FILE, meta: { ...FILE.meta, [field]: 'a drought warning' } }), field).toBeNull();
    }
    const classes = FILE.meta.classes.map((c: { value: number }, i: number) =>
      i === 0 ? { ...c, label: 'alert' } : c,
    );
    expect(readMeta({ ...FILE, meta: { ...FILE.meta, classes } })).toBeNull();
  });

  test('a link that is not https is refused, because it is rendered as one', () => {
    for (const bad of ['javascript:alert(1)', 'drought.emergency.copernicus.eu', 'http://x.test/']) {
      expect(readMeta({ ...FILE, meta: { ...FILE.meta, sourceUrl: bad } }), bad).toBeNull();
    }
  });

  test('a date that is not a dekad is refused', () => {
    for (const bad of ['2026-09-05', '2026-09-30', 'soon', '']) {
      expect(readMeta({ ...FILE, meta: { ...FILE.meta, dekad: bad } }), bad).toBeNull();
    }
  });

  // 🔴 A grid that disagrees with its own pixels is not a smaller map, it
  // is every campsite answering about somewhere else. `readingAt` would
  // index into it perfectly happily.
  test('a grid that disagrees with the pixel count is refused', () => {
    const grid = { ...FILE.meta.grid, width: FILE.meta.grid.width + 1 };
    expect(state(12, { ...FILE, meta: { ...FILE.meta, grid } }).kind).toBe('missing');
  });

  // 🔴 ISOLATED FROM THE DOMAIN CHECK, and it has to be said why.
  //
  // The obvious version of this test — widen the grid by one — is caught
  // by the NEXT line of `droughtState`, which compares the domain mask
  // against the same `cells`. So the two guards pin each other and
  // deleting either one leaves every test green. Measured: removing the
  // `cdi.length` check alone survived nine mutations' worth of this
  // file.
  //
  // So this leaves the grid and the mask agreeing and makes only the
  // pixels wrong.
  test('🔴 a pixel grid shorter than its own declared size is refused', () => {
    const cells = FILE.meta.grid.width * FILE.meta.grid.height;
    const short = gzipSync(Buffer.alloc(cells - 1)).toString('base64');
    expect(state(12, { ...FILE, cdi: short }).kind).toBe('missing');
    const long = gzipSync(Buffer.alloc(cells + 1)).toString('base64');
    expect(state(12, { ...FILE, cdi: long }).kind).toBe('missing');
  });

  test('a domain mask of the wrong size is refused', () => {
    expect(state(12, FILE, { domain: FILE.cdi }).kind).toBe('missing');
    expect(state(12, FILE, { not: 'a domain' }).kind).toBe('missing');
  });

  test('a file that is not the shape we write is refused', () => {
    expect(state(12, { not: 'a file' }).kind).toBe('missing');
    expect(state(12, null).kind).toBe('missing');
    expect(state(12, { ...FILE, cdi: 'not base64 gzip' }).kind).toBe('missing');
  });
});

test.describe('what the reader is told', () => {
  test('every state says something, and none of them is empty', () => {
    const places: [number, number][] = [[50.85, 4.35], [35.9, 14.4], [45, -15]];
    const states = [state(12), state(400), state(12, { not: 'a file' })];
    for (const s of states) {
      for (const [lat, lon] of places) {
        const note = droughtNote(s, lat, lon);
        expect(note.headline.length, JSON.stringify(note)).toBeGreaterThan(0);
        expect(note.detail.length, JSON.stringify(note)).toBeGreaterThan(0);
      }
    }
  });

  test('the dekad a reading describes is always named when there is one', () => {
    expect(droughtNote(state(12), 50.85, 4.35).asOf).toMatch(/\d{4}$/);
    expect(droughtNote(state(400), 50.85, 4.35).asOf).toMatch(/\d{4}$/);
    expect(droughtNote(state(12, { not: 'a file' }), 50.85, 4.35).asOf).toBeNull();
  });
});
