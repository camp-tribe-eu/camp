import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { DroughtPanel } from '@/components/drought-panel';
import {
  CDI_COLOURS,
  CDI_LEGEND,
  COVERAGE,
  FRESH_FOR_DAYS,
  RENDERED_LINKS,
  RENDERED_META,
  UNRECOGNISED,
  classOfValue,
  colourOfValue,
  dekadAgeDays,
  dekadPeriod,
  droughtNote,
  droughtState,
  isDekadStart,
  paintOverlay,
  printableName,
  readFeed,
  readGrid,
  sampleAt,
  type CdiGrid,
  type DroughtPick,
} from '@/lib/drought';
import { LAYERS } from '@/lib/map-layers';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-163 — the drought layer's rules: the period, the budget, the grid,
// the sampler and the sentences.
//
// 🔴 Every test below was mutation-proved, and the mutation that makes it
// fail is written next to it. What a test claims about the PAGE is read off
// the HTML `renderComponent` produced from the real panel — never off a
// constant, a class name or `droughtNote`'s return value alone.

const SHIPPED = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'src', 'data', 'drought.json'), 'utf8'),
) as { meta: Record<string, unknown>; grid: Record<string, unknown> };

const DAY = 86_400_000;
const START = Date.parse(`${SHIPPED.meta.dekad}T00:00:00Z`);
/** The test's clock, `daysOld` whole days after the shipped dekad began, at midday. */
const clock = (daysOld: number) => new Date(START + daysOld * DAY + 12 * 3_600_000);
/** The shipped file, with `fetchedAt` six hours before the clock. */
const feedAt = (daysOld: number, meta: Record<string, unknown> = {}, grid: unknown = SHIPPED.grid) => ({
  meta: {
    ...SHIPPED.meta,
    fetchedAt: new Date(clock(daysOld).getTime() - 6 * 3_600_000).toISOString(),
    ...meta,
  },
  grid,
});

/**
 * A grid written out by hand: `rows` are cell values. 4 wide, 3 tall, its
 * north-west corner at 10°E 50°N, 24 cells to the degree. Written as
 * strings of runs by hand, not by the fetch script's encoder.
 *
 *     col 0 1 2 3
 *  row 0: 0 1 2 3
 *  row 1: 4 5 6 0
 *  row 2: 0 0 0 0      (and row 2 is the one we corrupt in a test)
 */
const TINY = {
  west: 10,
  north: 50,
  cellsPerDegree: 24,
  width: 4,
  height: 3,
  rows: ['0:1,1:1,2:1,3:1', '4:1,5:1,6:1,0:1', '0:4'],
};
const tiny = () => readGrid(TINY) as CdiGrid;
/** The middle of cell (col, row) of TINY. */
const mid = (col: number, row: number) => ({
  lat: TINY.north - (row + 0.5) / 24,
  lon: TINY.west + (col + 0.5) / 24,
});

// ── dekads ───────────────────────────────────────────────────────────────

test.describe('a dekad is a named ten-day period', () => {
  test('the 1st, 11th and 21st start one, and the label says the days and the month', () => {
    // 🔴 Mutation: return `day === 1 ? 10 : 20` for the last dekad — the
    // 21–30/31/28/29 rows fail. Mutation: use `endDay = 30` — October,
    // February and leap February fail.
    const labels: Record<string, string> = {
      '2026-09-01': '1–10 September 2026',
      '2026-09-11': '11–20 September 2026',
      '2026-09-21': '21–30 September 2026',
      '2026-10-21': '21–31 October 2026',
      '2026-02-21': '21–28 February 2026',
      '2028-02-21': '21–29 February 2028',
      '2026-12-21': '21–31 December 2026',
    };
    for (const [start, label] of Object.entries(labels)) {
      expect(isDekadStart(start), start).toBe(true);
      expect(dekadPeriod(start)?.label, start).toBe(label);
    }
    expect(dekadPeriod('2026-09-11')).toMatchObject({ start: '2026-09-11', end: '2026-09-20' });
    expect(dekadPeriod('2028-02-21')).toMatchObject({ end: '2028-02-29' });
  });

  test('anything else is not a period, whatever the service says', () => {
    // 🔴 Mutation: accept any real date — the mid-dekad rows fail. The
    // service's own GetCapabilities says "P10D from 2012-01-01", which
    // would drift off these dates within a month.
    for (const bad of ['2026-09-02', '2026-09-10', '2026-09-12', '2026-09-31', '2026-02-30', 'x', '', null, undefined, 20260901]) {
      expect(isDekadStart(bad), String(bad)).toBe(false);
      expect(dekadPeriod(bad), String(bad)).toBeNull();
    }
  });

  test('the age counts whole days from the first day of the period', () => {
    // 🔴 The card's number: on 28.09.2026 the newest period began on the
    // 1st, and that is 27 days.
    expect(dekadAgeDays('2026-09-01', new Date('2026-09-28T12:00:00Z'))).toBe(27);
    expect(dekadAgeDays('2026-09-01', new Date('2026-09-01T00:00:00Z'))).toBe(0);
    expect(dekadAgeDays('2026-09-01', new Date('2026-09-01T23:59:59Z'))).toBe(0);
    expect(dekadAgeDays('2026-09-01', new Date('2026-08-31T23:59:59Z'))).toBe(-1);
    expect(Number.isNaN(dekadAgeDays('nonsense', new Date()))).toBe(true);
  });
});

// ── the freshness budget ─────────────────────────────────────────────────

test.describe('a dekad is fresh for 40 days and not a day more', () => {
  test('🔴 27 days old is NORMAL — the card\'s own case — and the page says so', () => {
    // 🔴 Mutation: set FRESH_FOR_DAYS to 20 — this fails, and the panel
    // scenario at 27 days does too. It is the failure the card names: a
    // healthy 27-day-old period drawn as broken.
    const state = droughtState(feedAt(27), clock(27));
    expect(state.kind).toBe('fresh');
    const html = renderComponent(DroughtPanel, { state, on: true, picked: null });
    expect(html).toContain('data-state="fresh"');
    expect(html).toContain('data-days-old="27"');
    const said = visibleText(html);
    expect(said).toContain('That period began 27 days ago');
    expect(said).toContain('an age of up to 40 days is normal for it');
    expect(said).not.toMatch(/no fresh/i);
  });

  test('the boundary: 40 days is fresh, 41 is stale', () => {
    // 🔴 Mutation: `> FRESH_FOR_DAYS` → `>= FRESH_FOR_DAYS` fails the first;
    // → `> FRESH_FOR_DAYS + 1` fails the second.
    expect(droughtState(feedAt(FRESH_FOR_DAYS), clock(FRESH_FOR_DAYS)).kind).toBe('fresh');
    expect(droughtState(feedAt(FRESH_FOR_DAYS + 1), clock(FRESH_FOR_DAYS + 1)).kind).toBe('stale');
    // and the whole of day 40 is inside it: 23:59 on the 40th day
    const lastMinute = new Date(START + FRESH_FOR_DAYS * DAY + 23 * 3_600_000 + 59 * 60_000);
    expect(droughtState(feedAt(FRESH_FOR_DAYS), lastMinute).kind).toBe('fresh');
  });

  test('a stale period draws nothing and says why, in the page', () => {
    // 🔴 Mutation: delete the `daysOld > FRESH_FOR_DAYS` arm of
    // `droughtState` — a 41-day-old grid arrives `fresh` and this fails.
    const state = droughtState(feedAt(60), clock(60));
    expect(state.kind).toBe('stale');
    expect(state).not.toHaveProperty('grid');
    const said = visibleText(renderComponent(DroughtPanel, { state, on: true, picked: null }));
    expect(said).toContain('No fresh drought data');
    expect(said).toContain('past our 40-day budget');
    expect(said).toContain('not a statement that no drought has been recorded');
    // …and it does not print the class table or the credit, which belong to data.
    expect(said).not.toContain('Drought class 1 of 3');
  });

  test('🔴 a period from 2024 is stale whatever the file calls it', () => {
    // smand stops 2024-07-01 and cdinx 2024-01-01 while still advertised.
    // The script cannot request either and the page refuses their name (see
    // below), but a stale layer that is NOT on either list — or one that
    // arrives labelled `cdiad` — is stopped by its age alone.
    // 🔴 Mutation: skip the age check when `coverage === 'cdiad'` — fails.
    for (const dekad of ['2024-07-01', '2024-01-01']) {
      // Everything else in the file is consistent with the 2024 period —
      // its credit carries 2024 — so it is the AGE, and nothing else, that
      // has to stop it.
      const attribution = String(SHIPPED.meta.attribution).replace('2026', dekad.slice(0, 4));
      const raw = feedAt(27, { dekad, attribution, fetchedAt: `${dekad}T08:00:00.000Z` });
      expect(readFeed(raw), `${dekad} must be readable, or the test proves nothing`).not.toBeNull();
      expect(droughtState(raw, clock(27)).kind, dekad).toBe('stale');
    }
  });

  test('a period dated in the future is stale, not "−4 days old"', () => {
    // 🔴 Mutation: drop `!(daysOld >= 0)` — a clock that is behind passes
    // every budget for ever, and this fails.
    const raw = feedAt(-3, { fetchedAt: new Date(START + DAY).toISOString() });
    expect(droughtState(raw, clock(-3)).kind).toBe('stale');
    const state = droughtState(raw, clock(-3));
    const said = visibleText(renderComponent(DroughtPanel, { state, on: true, picked: null }));
    expect(said).toContain('which is in the future');
    expect(said).not.toMatch(/-\d+ days|3 days ago/);
  });

  test('the last minute before a period begins is "in the future" too', () => {
    // 🔴 The one case only the negative age can catch. A read may be dated up
    // to a minute ahead of the browser's clock (skew), so `clockBehind` does
    // not fire — and a browser 30 s before the first instant of the period,
    // holding a file read at that instant, would otherwise print "That period
    // began -1 days ago". Every larger gap is also caught by `clockBehind`,
    // which is why the test above cannot tell this arm from it.
    // 🔴 Mutation: delete `!(daysOld >= 0)` — this fails, and nothing else does.
    const raw = feedAt(27, { fetchedAt: new Date(START).toISOString() });
    const state = droughtState(raw, new Date(START - 30_000));
    expect(state.kind).toBe('stale');
    expect(state).toMatchObject({ daysOld: -1 });
    expect(visibleText(renderComponent(DroughtPanel, { state, on: true, picked: null }))).not.toMatch(/-1 days?/);
  });

  test('a read dated ahead of the clock is stale too', () => {
    // Our OWN timestamp in the future is a wrong clock somewhere, and a
    // guard that only looked at the dekad would not see it.
    // 🔴 Mutation: delete `clockBehind` — fails.
    const raw = feedAt(27, { fetchedAt: new Date(clock(27).getTime() + 3 * DAY).toISOString() });
    expect(droughtState(raw, clock(27)).kind).toBe('stale');
  });

  test('the script and the page carry the same budget', async () => {
    // 🔴 Mutation: change either number — fails and names the file.
    const mod = await importScript();
    expect(mod.FRESH_FOR_DAYS, 'scripts/edo/fetch-drought.mjs has drifted from src/lib/drought.ts').toBe(FRESH_FOR_DAYS);
    expect(mod.UNRECOGNISED).toBe(UNRECOGNISED);
    expect(mod.COVERAGE).toBe(COVERAGE);
  });
});

/** The script is ESM and Playwright compiles specs to CJS; see wildfire-fetch.spec.ts. */
const load = new Function('u', 'return import(u)') as (u: string) => Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
const importScript = () =>
  load(pathToFileURL(join(__dirname, '..', '..', '..', '..', 'scripts', 'edo', 'fetch-drought.mjs')).href);

// ── what the file must be to be read at all ──────────────────────────────

test.describe('the file is read strictly, and one bad thing costs one thing', () => {
  test('the shipped file reads', () => {
    // 🔴 Mutation: break any check in `readFeed` that the shipped file
    // should pass — this fails first, so the refusals below are not
    // refusals of a file that was never readable.
    const feed = readFeed(feedAt(27));
    expect(feed).not.toBeNull();
    expect(feed!.grid.width * feed!.grid.height).toBe(feed!.grid.cells.length);
  });

  test('🔴 a file from another coverage is refused, by name', () => {
    // 🔴 Mutation: delete the `coverage !== COVERAGE` line — every row fails.
    for (const coverage of ['smand', 'cdinx', 'cdirc', 'spaST', 'lfinx_300_sms', '', undefined, 7]) {
      expect(readFeed(feedAt(27, { coverage })), String(coverage)).toBeNull();
    }
  });

  test('a dekad that is not a period, or that follows its own read, is refused', () => {
    // 🔴 Mutation: delete the `isDekadStart` line, or the `fetchedAt <
    // dekadStart` line — the matching rows fail.
    for (const dekad of ['2026-09-12', 'x', undefined, 20260911]) {
      expect(readFeed(feedAt(27, { dekad })), String(dekad)).toBeNull();
    }
    // read on the 10th, about a period that begins on the 11th
    expect(readFeed(feedAt(27, { fetchedAt: '2026-09-10T12:00:00.000Z' }))).toBeNull();
    for (const fetchedAt of ['not a date', undefined, 5]) {
      expect(readFeed(feedAt(27, { fetchedAt })), String(fetchedAt)).toBeNull();
    }
  });

  test('🔴 the credit must be the modified-data notice, with the year of the DATA', () => {
    // 🔴 Mutation: delete the year test — the 2025 row fails. Delete the
    // CEMS_NOTICE test — the "Generated using" and CC-BY rows fail.
    const ok = String(SHIPPED.meta.attribution);
    expect(readFeed(feedAt(27, { attribution: ok }))).not.toBeNull();
    const bad = [
      ok.replace('information 2026', 'information 2025'),
      ok.replace('Contains modified', 'Generated using'),
      'Copernicus EDO — © European Union, licensed CC BY 4.0',
      ok.replace('2026', '[Year]'),
      '',
      undefined,
    ];
    for (const attribution of bad) {
      expect(readFeed(feedAt(27, { attribution })), String(attribution)).toBeNull();
    }
    // The year is the DATA's: a December period read in January still says December's year.
    const december = feedAt(27, {
      dekad: '2026-12-21',
      fetchedAt: '2027-01-02T08:00:00.000Z',
      attribution: ok,
    });
    expect(readFeed(december)).not.toBeNull();
    expect(readFeed({ ...december, meta: { ...december.meta, attribution: ok.replace('2026', '2027') } })).toBeNull();
  });

  test('🔴 every string the panel prints is gated, each with each word', () => {
    // The list is `RENDERED_META`, and it must be the panel's own.
    // 🔴 Mutation: delete the `RENDERED_META` loop in `readFeed` — every row
    // fails. Remove one key from the array — that key's rows fail.
    expect([...RENDERED_META].sort()).toEqual(['attribution', 'authorityNote', 'product', 'source']);
    const words = ['warning', 'Danger', 'RISK', 'alerts', 'evacuate', 'dangerous'];
    for (const key of RENDERED_META) {
      for (const word of words) {
        const value = key === 'attribution' ? `${SHIPPED.meta.attribution} ${word}` : `The ${word} service`;
        expect(readFeed(feedAt(27, { [key]: value })), `${key} + ${word}`).toBeNull();
      }
      expect(readFeed(feedAt(27, { [key]: '   ' })), `${key} blank`).toBeNull();
    }
    // and a lookalike is not refused
    expect(readFeed(feedAt(27, { product: 'Brisk Warwickshire indicator' }))).not.toBeNull();
  });

  test('a link must be https, and there are exactly the two the panel makes', () => {
    // 🔴 Mutation: delete the RENDERED_LINKS loop — the rows fail.
    expect([...RENDERED_LINKS].sort()).toEqual(['sourceUrl', 'termsUrl']);
    for (const key of RENDERED_LINKS) {
      for (const value of ['http://example.org/', 'javascript:alert(1)', '', 'ftp://x', undefined]) {
        expect(readFeed(feedAt(27, { [key]: value })), `${key}=${String(value)}`).toBeNull();
      }
    }
  });

  test('nothing that is not our file gets in', () => {
    for (const junk of [null, undefined, 'x', 5, [], {}, { meta: {} }, { grid: {} }, { meta: null, grid: null }]) {
      expect(readFeed(junk), JSON.stringify(junk)).toBeNull();
      expect(droughtState(junk, clock(27)).kind).toBe('missing');
    }
  });
});

test.describe('the grid: one bad row costs one row, and none costs the layer', () => {
  test('a hand-written grid decodes cell for cell', () => {
    // 🔴 Mutation: read the count as the value in `decodeRow` — fails.
    const g = tiny();
    expect(Array.from(g.cells)).toEqual([0, 1, 2, 3, 4, 5, 6, 0, 0, 0, 0, 0]);
    expect(g.unreadable).toBe(0);
  });

  test('🔴 a row that will not decode costs that row, and the rest is read', () => {
    // 🔴 Mutation: return null from `readGrid` on the first bad row — the
    // "rest is read" half fails. Delete the `fill(UNRECOGNISED …)` — the
    // bad row reads as zeros, i.e. as "no class", and the sample test fails.
    for (const bad of ['garbage', '', '0:3', '0:5', '9', '0:2,,1:2', '0:-1,1:5', '01:4', null, 7, ['0:4']]) {
      const g = readGrid({ ...TINY, rows: [TINY.rows[0], bad, TINY.rows[2]] });
      expect(g, JSON.stringify(bad)).not.toBeNull();
      expect(g!.unreadable, JSON.stringify(bad)).toBe(4);
      expect(Array.from(g!.cells.slice(0, 4)), 'the row before').toEqual([0, 1, 2, 3]);
      expect(Array.from(g!.cells.slice(4, 8)), 'the bad row').toEqual([9, 9, 9, 9]);
      expect(Array.from(g!.cells.slice(8, 12)), 'the row after').toEqual([0, 0, 0, 0]);
      expect(sampleAt(g!, mid(1, 1).lat, mid(1, 1).lon).kind, JSON.stringify(bad)).toBe('unreadable');
      expect(sampleAt(g!, mid(1, 0).lat, mid(1, 0).lon)).toEqual({ kind: 'drought', level: 1 });
    }
  });

  test('🔴 a row that overruns its width cannot leak into a neighbour, wherever it sits', () => {
    // `decodeRow` no longer bounds a run by the row's width (measured: the
    // bound changed nothing — see the comment there). What keeps an overrun
    // inside its own row is that every later row rewrites its own slice, and
    // the neighbours here are NOT zeros, so a leaked value would show: the
    // earlier test's neighbour was all 0, exactly what an overrun of 0s
    // writes, and could not have told.
    // 🔴 Mutation: decode the rows from the last to the first (`for (let r =
    // height - 1; r >= 0; r--)` in `readGrid`) — a row's overrun then lands on
    // a row that has already been read, and this fails.
    for (const run of ['3:5', '3:8', '3:1000000000', '1:2,3:40', '3:4,3:1']) {
      const g = readGrid({ ...TINY, rows: ['1:4', run, '2:4'] })!;
      expect(g, run).not.toBeNull();
      expect(Array.from(g.cells.slice(0, 4)), `${run}: the row before`).toEqual([1, 1, 1, 1]);
      expect(Array.from(g.cells.slice(4, 8)), `${run}: the row itself`).toEqual([9, 9, 9, 9]);
      expect(Array.from(g.cells.slice(8, 12)), `${run}: the row after`).toEqual([2, 2, 2, 2]);
      expect(g.unreadable, run).toBe(4);
    }
    // and on the LAST row, where there is nothing after it to absorb the write
    const last = readGrid({ ...TINY, rows: ['1:4', '2:4', '3:1000000000'] })!;
    expect(last.cells.length).toBe(12);
    expect(Array.from(last.cells.slice(0, 8))).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
    expect(Array.from(last.cells.slice(8, 12))).toEqual([9, 9, 9, 9]);
  });

  test('🔴 a value nobody has explained costs that cell, not the row', () => {
    // A value of 7, 8 or 9 in a run is read, marked, and counted.
    // 🔴 Mutation: drop the `> MAX_KNOWN_VALUE` mapping — 7 reads as a class.
    const g = readGrid({ ...TINY, rows: ['0:1,7:1,2:1,8:1', TINY.rows[1], TINY.rows[2]] })!;
    expect(Array.from(g.cells.slice(0, 4))).toEqual([0, 9, 2, 9]);
    expect(g.unreadable).toBe(2);
    expect(sampleAt(g, mid(2, 0).lat, mid(2, 0).lon)).toEqual({ kind: 'drought', level: 2 });
  });

  test('a grid with nothing readable, or the wrong shape, is no grid', () => {
    // 🔴 Mutation: delete the `unreadable === cells.length` line — the
    // first row fails: an all-unreadable grid would draw a blank that says
    // nothing.
    expect(readGrid({ ...TINY, rows: ['x', 'y', 'z'] })).toBeNull();
    expect(readGrid({ ...TINY, rows: TINY.rows.slice(0, 2) })).toBeNull();
    expect(readGrid({ ...TINY, rows: [...TINY.rows, '0:4'] })).toBeNull();
    for (const over of [
      { width: 0 },
      { height: 2.5 },
      // 16 million cells, every row well-formed: only the size cap refuses it.
      { width: 4_000, height: 4_000, rows: Array.from({ length: 4_000 }, () => '0:4000') },
      { cellsPerDegree: 0 },
      { cellsPerDegree: 24.5 },
      { west: 200 },
      { west: '10' },
      { north: Number.NaN },
      { north: 91 },
    ]) {
      expect(readGrid({ ...TINY, ...over }), JSON.stringify(over)).toBeNull();
    }
  });

  test('the shipped grid is the size the service serves and holds every value', () => {
    const g = readGrid(SHIPPED.grid)!;
    expect([g.width, g.height, g.cellsPerDegree, g.west, g.north]).toEqual([1824, 1200, 24, -25, 72]);
    expect(g.unreadable).toBe(0);
    const seen = new Set(g.cells);
    for (const v of [0, 1, 2, 3, 4, 5, 6]) expect(seen.has(v), `value ${v}`).toBe(true);
    // and the counts the script recorded are the counts of what we decode
    const counted: Record<string, number> = {};
    for (const c of g.cells) counted[c] = (counted[c] ?? 0) + 1;
    expect(counted).toEqual((SHIPPED.meta as { byValue: Record<string, number> }).byValue);
  });
});

// ── sampling ─────────────────────────────────────────────────────────────

test.describe('a campsite is given the cell it stands in', () => {
  test('each cell of the hand-written grid, sampled at its middle', () => {
    // 🔴 Mutation: swap the row formula for `(lat - south)`, or use
    // Math.round for floor — most rows fail. (The independent check, against
    // GDAL on a real crop, is in drought-fetch.spec.ts.)
    const g = tiny();
    const expected = [
      [{ kind: 'none' }, { kind: 'drought', level: 1 }, { kind: 'drought', level: 2 }, { kind: 'drought', level: 3 }],
      [{ kind: 'recovery' }, { kind: 'recovery' }, { kind: 'recovery' }, { kind: 'none' }],
      [{ kind: 'none' }, { kind: 'none' }, { kind: 'none' }, { kind: 'none' }],
    ];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        const { lat, lon } = mid(col, row);
        expect(sampleAt(g, lat, lon), `cell ${col},${row}`).toEqual(expected[row][col]);
      }
    }
  });

  test('the corner is the corner of cell (0, 0), and the far edges belong to no cell', () => {
    // 🔴 Mutation: use `<=` in the bounds test — the exact-edge rows fail.
    //
    // The exact edges are asserted on the SHIPPED grid, whose far corner
    // (51°E, 22°N) is exactly representable in floating point. On a grid
    // whose edge is not — TINY's east edge is 10 + 4/24 — `(lon − west) · 24`
    // can round to either side of 4, and a test that demanded "outside" at
    // that exact number would be asserting an accident of the arithmetic.
    // There the test steps a nanodegree either side instead.
    const g = tiny();
    const east = TINY.west + 4 / 24;
    const south = TINY.north - 3 / 24;
    expect(sampleAt(g, TINY.north, TINY.west)).toEqual({ kind: 'none' }); // cell (0,0)
    expect(sampleAt(g, TINY.north - 1e-9, TINY.west + 1 / 24 + 1e-9)).toEqual({ kind: 'drought', level: 1 });
    expect(sampleAt(g, TINY.north - 1e-9, east - 1e-9)).toEqual({ kind: 'drought', level: 3 });
    expect(sampleAt(g, south + 1e-9, east - 1e-9)).toEqual({ kind: 'none' });
    expect(sampleAt(g, 49.99, east + 1e-9).kind).toBe('outside');
    expect(sampleAt(g, south - 1e-9, 10.05).kind).toBe('outside');
    expect(sampleAt(g, TINY.north + 1e-9, 10.05).kind).toBe('outside');
    expect(sampleAt(g, 49.95, TINY.west - 1e-9).kind).toBe('outside');

    const real = readGrid(SHIPPED.grid)!;
    expect(sampleAt(real, 72, -25).kind).not.toBe('outside'); // the north-west corner is cell (0, 0)
    expect(sampleAt(real, 50, 51).kind, 'the exact east edge').toBe('outside');
    expect(sampleAt(real, 22, 10).kind, 'the exact south edge').toBe('outside');
    expect(sampleAt(real, 22 + 1e-9, 51 - 1e-9).kind).not.toBe('outside');
  });

  test('a point that cannot be placed says so instead of landing in a cell', () => {
    // 🔴 Mutation: delete the `isFinite` line — NaN falls through
    // `Math.floor(NaN)` to `outside`, which is a different sentence, so the
    // kind assertion fails.
    const g = tiny();
    for (const [lat, lon] of [[Number.NaN, 10], [50, Number.NaN], [Infinity, 10], [50, -Infinity]]) {
      expect(sampleAt(g, lat, lon).kind, `${lat},${lon}`).toBe('unplaced');
    }
  });

  test('negative longitudes and the real origin', () => {
    // The shipped grid starts at 25°W. A point at 24.99°W is in column 0;
    // 25.01°W is outside.
    const g = readGrid(SHIPPED.grid)!;
    expect(sampleAt(g, 50, -24.99).kind).not.toBe('outside');
    expect(sampleAt(g, 50, -25.01).kind).toBe('outside');
    expect(sampleAt(g, 72.001, 10).kind).toBe('outside');
    expect(sampleAt(g, 21.99, 10).kind).toBe('outside');
    expect(sampleAt(g, 50, 51.01).kind).toBe('outside');
  });

  test('what each value means', () => {
    // 🔴 Mutation: move a boundary (`<= 3` → `<= 4`, `>= 4` → `>= 5`) — fails.
    expect(classOfValue(0)).toEqual({ kind: 'none' });
    expect([1, 2, 3].map(classOfValue)).toEqual([
      { kind: 'drought', level: 1 },
      { kind: 'drought', level: 2 },
      { kind: 'drought', level: 3 },
    ]);
    expect([4, 5, 6].map(classOfValue)).toEqual([{ kind: 'recovery' }, { kind: 'recovery' }, { kind: 'recovery' }]);
    for (const v of [7, 8, 9, 255, -1, 2.5]) expect(classOfValue(v).kind, String(v)).toBe('unreadable');
  });
});

// ── the picture ──────────────────────────────────────────────────────────

test.describe('the picture is the grid, in mercator', () => {
  const grid = readGrid(SHIPPED.grid)!;
  const overlay = paintOverlay(grid);

  // The inverse of the spherical mercator projection, written a different
  // way from the one under test: atan(sinh(y)), against 2·atan(exp(y)) − π/2.
  const latOfY = (y: number) => (Math.atan(Math.sinh(y)) * 180) / Math.PI;
  const yOfLat = (lat: number) => Math.asinh(Math.tan((lat * Math.PI) / 180));

  test('🔴 every output row copies the source row its own latitude falls in', () => {
    // The check that says the picture is in the right PLACE. Equirectangular
    // laid onto a mercator quad puts 47°N at about 53.5°N — 700 km off —
    // and no assertion about text would notice.
    // 🔴 Mutation: space the rows evenly in latitude instead of in mercator
    // (`lat = north − (r + .5) · span / outHeight`) — most rows fail.
    const yTop = yOfLat(grid.north);
    const yBottom = yOfLat(grid.north - grid.height / grid.cellsPerDegree);
    let checked = 0;
    const wrong: string[] = [];
    for (let r = 0; r < overlay.height; r += 7) {
      const y = yTop - ((r + 0.5) * (yTop - yBottom)) / overlay.height;
      const srcRow = Math.floor((grid.north - latOfY(y)) * grid.cellsPerDegree);
      for (let c = 0; c < grid.width; c += 3) {
        const colour = colourOfValue(grid.cells[srcRow * grid.width + c]);
        const at = (r * grid.width + c) * 4;
        const want = colour ? [...colour, 255] : [0, 0, 0, 0];
        checked++;
        if (
          overlay.data[at] !== want[0] ||
          overlay.data[at + 1] !== want[1] ||
          overlay.data[at + 2] !== want[2] ||
          overlay.data[at + 3] !== want[3]
        ) {
          if (wrong.length < 5) wrong.push(`output row ${r}, column ${c}: source row ${srcRow}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(100_000);
    expect(wrong).toEqual([]);
  });

  test('no source row is skipped, so a thin class band cannot vanish from the picture', () => {
    // 🔴 Mutation: OVERLAY_ROWS_PER_CELL = 0.9 — 1 663 output rows, 15 source
    // rows skipped, this fails (0.98 skips 1). Measured on this grid; the
    // cliff is at 1 816 rows and the shipped 1 848 clears it by 32.
    // Raising the constant never fails this test — more rows keep every row
    // — which is why the sibling below holds it from the other side.
    const yTop = yOfLat(grid.north);
    const yBottom = yOfLat(grid.north - grid.height / grid.cellsPerDegree);
    const used = new Set<number>();
    for (let r = 0; r < overlay.height; r++) {
      const y = yTop - ((r + 0.5) * (yTop - yBottom)) / overlay.height;
      used.add(Math.floor((grid.north - latOfY(y)) * grid.cellsPerDegree));
    }
    expect(used.size).toBe(grid.height);
  });

  test('🔴 the picture fits its memory budget: the constant is held from ABOVE as well', () => {
    // The buffer is width × output rows × 4 bytes, and the same factor again
    // as a GPU texture on a phone. At 2 rows per cell it was 25.7 MiB for a
    // picture with 0 rows more to show than the 12.9 MiB one, and nothing
    // failed. 14 MiB clears today's 12.9 and 13.5 (1.05 rows per cell) and
    // refuses 15.4 (1.2), 19.3 (1.5) and 25.7 (2).
    // 🔴 Mutation: OVERLAY_ROWS_PER_CELL = 2 — 25.7 MiB, this fails; = 1.2
    // fails too. With the sibling above, the constant is pinned between
    // about 0.98 and 1.1, and anything outside that is a red test.
    expect(overlay.data.byteLength).toBeLessThan(14 * 1048576);
    expect(overlay.height).toBeGreaterThanOrEqual(1816); // the cliff, measured
    expect(overlay.data.length).toBe(grid.width * overlay.height * 4);
  });

  test('the corners are the grid\'s corners, north first', () => {
    // 🔴 Mutation: swap two corners — fails. MapLibre wants
    // upper-left, upper-right, lower-right, lower-left.
    expect(overlay.coordinates).toEqual([
      [-25, 72],
      [51, 72],
      [51, 22],
      [-25, 22],
    ]);
    expect(overlay.width).toBe(grid.width);
    expect(overlay.data.length).toBe(overlay.width * overlay.height * 4);
  });

  test('a cell with no class, and one we could not read, is transparent', () => {
    // 🔴 Mutation: paint value 0 — the picture is a solid wash and the
    // "blank is not an all-clear" sentence is a lie the other way.
    const g = tiny();
    const o = paintOverlay(g);
    let opaque = 0;
    for (let i = 3; i < o.data.length; i += 4) if (o.data[i] !== 0) opaque++;
    // 4 classified cells of 12: values 1,2,3 and 4,5,6 = six cells, in two rows
    expect(opaque).toBeGreaterThan(0);
    const firstRowFirstCell = o.data.slice(0, 4);
    expect(Array.from(firstRowFirstCell)).toEqual([0, 0, 0, 0]); // cell (0,0) holds 0
    expect(colourOfValue(0)).toBeNull();
    expect(colourOfValue(UNRECOGNISED)).toBeNull();
  });

  test('the legend and the pixels read from one table', () => {
    // 🔴 Mutation: change one colour in CDI_LEGEND only — fails.
    expect(CDI_LEGEND.map((e) => e.colour)).toEqual([CDI_COLOURS[1], CDI_COLOURS[2], CDI_COLOURS[3], CDI_COLOURS.recovery]);
    const hex = (v: number) => `#${(colourOfValue(v) ?? []).map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    expect([1, 2, 3, 4, 5, 6].map(hex)).toEqual([
      CDI_COLOURS[1], CDI_COLOURS[2], CDI_COLOURS[3], CDI_COLOURS.recovery, CDI_COLOURS.recovery, CDI_COLOURS.recovery,
    ]);
  });
});

// ── the sentences, as the page prints them ───────────────────────────────

test.describe('what the panel says about a campsite, read off the page', () => {
  const said = (pick: DroughtPick | null, grid: unknown = SHIPPED.grid, daysOld = 27) =>
    visibleText(renderComponent(DroughtPanel, { state: droughtState(feedAt(daysOld, {}, grid), clock(daysOld)), on: true, picked: pick }));

  test('🔴 Malta: a cell with no class says so, and says it is not an all-clear — it does not render blank', () => {
    // The card's own case. 0 of the 14 campsites in Malta stand on a
    // classified cell (measured 29.09.2026), and a panel that said nothing
    // for them would read as a clean bill of health.
    // 🔴 Mutation: make the `none` branch return an empty headline or drop
    // the second sentence — fails.
    const text = said({ name: 'Camping Valletta', ...mid(3, 1) }, TINY);
    expect(text).toContain('At Camping Valletta');
    expect(text).toContain('records no drought class');
    expect(text).toContain('not the same as being told the area is free of drought');
    expect(text.length).toBeGreaterThan(200);
  });

  test('each class is reported by rank, in words, with the period', () => {
    // 🔴 Mutation: report `level + 1`, or the raw value — fails.
    for (const [col, level] of [[1, 1], [2, 2], [3, 3]] as const) {
      const text = said({ name: 'Camping A', ...mid(col, 0) }, TINY);
      expect(text, `class ${level}`).toContain(`records drought class ${level} of 3`);
      expect(text).toContain('Combined Drought Indicator for 11–20 September 2026');
    }
    expect(said({ name: 'Camping A', ...mid(0, 1) }, TINY)).toContain('records a recovery class');
  });

  test('a point outside the grid says so, with the extent, and does not pretend to know', () => {
    // 🔴 Mutation: fold `outside` into `none` — fails on the extent text.
    const text = said({ name: null, lat: 38.7, lon: -27.2 }, SHIPPED.grid);
    expect(text).toContain('This campsite lies outside the area Copernicus\'s grid covers');
    expect(text).toContain('from 25°W to 51°E and from 22°N to 72°N');
    expect(text).toContain('not a statement that no drought has been recorded');
  });

  test('a row we could not read says so at that campsite', () => {
    // 🔴 Mutation: map `unreadable` to the `none` sentence — fails.
    const broken = { ...TINY, rows: [TINY.rows[0], 'garbage', TINY.rows[2]] };
    const text = said({ name: 'Camping B', ...mid(1, 1) }, broken);
    expect(text).toContain('We could not read');
    expect(text).toContain('at Camping B');
    // and the panel says elsewhere that part of the file was unreadable
    expect(said(null, broken)).toContain('Part of the file could not be read');
  });

  test('a name we may not print costs the name, not the sentence', () => {
    // 🔴 Mutation: return `name` unchecked from `printableName` — fails.
    for (const name of ['Camping Danger Bay', 'Alert Camping', 'The Risk', 'Warning Point', 'evacuation route']) {
      expect(printableName(name), name).toBeNull();
      expect(said({ name, ...mid(1, 0) }, TINY), name).toContain('At this campsite,');
    }
    expect(printableName('  Camping Sole ')).toBe('Camping Sole');
    expect(printableName('Brisk Warwick')).toBe('Brisk Warwick');
    expect(printableName(null)).toBeNull();
    expect(printableName(undefined)).toBeNull();
    expect(printableName('   ')).toBeNull();
  });

  test('every note has a headline and a detail, in every state', () => {
    // 🔴 The rule of the whole layer: never render nothing.
    // Mutation: return '' from any branch — that row fails.
    const states = [
      { kind: 'loading' as const },
      { kind: 'missing' as const },
      droughtState(feedAt(60), clock(60)),
      droughtState(feedAt(27), clock(27)),
    ];
    const picks: (DroughtPick | null)[] = [null, { name: 'X', ...mid(0, 0) }, { name: 'X', lat: 0, lon: 0 }, { name: null, lat: NaN, lon: NaN }];
    for (const state of states) {
      for (const pick of picks) {
        const note = droughtNote(state, pick);
        expect(note.headline.trim().length, `${state.kind}`).toBeGreaterThan(10);
        expect(note.detail.trim().length, `${state.kind}`).toBeGreaterThan(10);
      }
    }
  });

  test('switched off says it is the control, not an all-clear', () => {
    // 🔴 Mutation: render nothing when `on` is false — fails.
    const html = renderComponent(DroughtPanel, { state: droughtState(feedAt(27), clock(27)), on: false, picked: null });
    expect(html).toContain('data-state="off"');
    expect(visibleText(html)).toContain('that is this control, not an all-clear');
  });
});

// ── the tint: the one mark that says "a gap, not an answer" ──────────────

test.describe('the amber tint is on exactly the states that are gaps, read off the page', () => {
  /** The panel's own opening tag — its attributes and its classes — and nothing inside it. */
  const rootTag = (html: string) => /^<div[^>]*>/.exec(html)![0];
  const gapTint = /border-warn\/40/;
  const at = (col: number, row: number, name: string | null = 'Camping A'): DroughtPick => ({ name, ...mid(col, row) });
  const render = (state: ReturnType<typeof droughtState>, picked: DroughtPick | null, on = true) =>
    renderComponent(DroughtPanel, { state, on, picked });
  const fresh = (grid: unknown = TINY) => droughtState(feedAt(27, {}, grid), clock(27));
  const broken = { ...TINY, rows: [TINY.rows[0], 'garbage', TINY.rows[2]] };

  // Every state and every kind of pick the panel can be in, with the tone it
  // must carry. Written out here by hand and not derived from `droughtNote`.
  const cases: [string, string, () => string][] = [
    ['loading', 'gap', () => render({ kind: 'loading' }, null)],
    ['missing', 'gap', () => render({ kind: 'missing' }, null)],
    ['stale, past the budget', 'gap', () => render(droughtState(feedAt(60), clock(60)), null)],
    ['dated in the future', 'gap', () => render(droughtState(feedAt(-3, { fetchedAt: new Date(START + DAY).toISOString() }), clock(-3)), null)],
    ['fresh, nothing picked', 'quiet', () => render(fresh(), null)],
    ['a campsite in drought class 1', 'quiet', () => render(fresh(), at(1, 0))],
    ['a campsite in drought class 3', 'quiet', () => render(fresh(), at(3, 0))],
    ['a campsite in a recovery class', 'quiet', () => render(fresh(), at(0, 1))],
    ['a campsite where the raster holds no class', 'gap', () => render(fresh(), at(0, 0))],
    ['a campsite outside the grid', 'gap', () => render(fresh(), { name: 'Camping A', lat: 0, lon: 0 })],
    ['a campsite in a row we could not read', 'gap', () => render(fresh(broken), at(1, 1))],
    ['a campsite with no usable coordinates', 'gap', () => render(fresh(), { name: 'Camping A', lat: Number.NaN, lon: 10 })],
    ['switched off by the reader', 'off', () => render(fresh(), null, false)],
  ];

  for (const [name, tone, html] of cases) {
    test(`🔴 ${name} carries tone "${tone}", and the amber border iff it is a gap`, () => {
      // 🔴 Mutation: replace every `tone: 'gap'` in lib/drought.ts with
      // `'quiet'` — every "gap" row fails, and it is the ONLY thing that does
      // (measured: the whole suite was green before this test existed).
      // Mutation: `note.tone === 'gap'` → `=== 'quiet'` in drought-panel.tsx —
      // every row fails on the border, not the attribute. Mutation: emit a
      // constant for `data-tone` — the rows of the other tone fail.
      const tag = rootTag(html());
      expect(tag, name).toContain(`data-tone="${tone}"`);
      expect(gapTint.test(tag), `${name}: the amber border must be there iff the tone is gap`).toBe(tone === 'gap');
    });
  }

  test('the attribute and the sentence agree: a gap says it is not an answer, a quiet one gives one', () => {
    // Read off the same HTML, so a tone and a sentence cannot drift apart
    // unseen — "records no drought class" being tinted as a quiet answer is
    // the case that matters.
    const none = render(fresh(), at(0, 0));
    expect(rootTag(none)).toContain('data-tone="gap"');
    expect(visibleText(none)).toContain('not the same as being told the area is free of drought');
    const answer = render(fresh(), at(2, 0));
    expect(rootTag(answer)).toContain('data-tone="quiet"');
    expect(visibleText(answer)).toContain('records drought class 2 of 3');
  });
});

// ── registration: the card's main trap ───────────────────────────────────

test.describe('the layer is registered, because the registry is what stands between EDO and an ungated page', () => {
  test('🔴 it is live, CEMS-tagged, and its switch names none of the four words', () => {
    // 🔴 Mutation: delete `terms: 'cems'` from the drought entry — this
    // fails, and so do two tests in cems-panels.spec.ts.
    const layer = LAYERS.find((l) => l.id === 'drought');
    expect(layer, 'no drought entry in LAYERS').toBeTruthy();
    expect(layer!.status).toBe('live');
    expect('terms' in layer! && layer.terms).toBe('cems');
    expect(layer!.card).toBe('CAMP-163');
  });
});
