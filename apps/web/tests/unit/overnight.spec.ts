import { expect, test } from '@playwright/test';
import { boilerplateBlocks } from '../../../../scripts/seo/page-text.mjs';
import OvernightStay from '@/components/overnight-stay';
import {
  describeOvernightSource,
  formatOvernightDay,
  overnightCoverage,
  readOvernight,
  UNKNOWN_OVERNIGHT,
} from '@/lib/overnight';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-255 — the web side of the overnight rule.

test.describe('readOvernight: an answer exists only with a source and a day', () => {
  const ok = { status: 'allowed', source: 'osm:motorhome=yes', checkedAt: '2026-10-12' };

  test('anchor: a complete answer is kept, both ways', () => {
    expect(readOvernight(ok)).toEqual(ok);
    expect(readOvernight({ ...ok, status: 'forbidden', source: 'osm:motorhome=no' }).status).toBe('forbidden');
  });

  test('🔴 unknown stays unknown, and carries nothing', () => {
    expect(readOvernight({ status: 'unknown', source: null, checkedAt: null })).toEqual(UNKNOWN_OVERNIGHT);
    // Even a status of unknown that arrives WITH a source is not promoted.
    expect(readOvernight({ status: 'unknown', source: 'osm:motorhome=yes', checkedAt: '2026-10-12' })).toEqual(UNKNOWN_OVERNIGHT);
  });

  test('🔴 each missing or malformed piece turns an answer into unknown, one at a time', () => {
    const broken: Record<string, unknown>[] = [
      { ...ok, source: null },
      { ...ok, source: '' },
      { ...ok, source: 'osm:' },
      { ...ok, source: 'osm' },
      { ...ok, source: 'osm:motorhome=yes now' },
      { ...ok, source: 'nobody:motorhome=yes' },
      { ...ok, checkedAt: null },
      { ...ok, checkedAt: '12/10/2026' },
      { ...ok, checkedAt: '2026-13-45' },
      { ...ok, status: 'maybe' },
      { ...ok, status: 'ALLOWED' },
      { ...ok, status: undefined },
    ];
    for (const b of broken) {
      expect([JSON.stringify(b), readOvernight(b)]).toEqual([JSON.stringify(b), UNKNOWN_OVERNIGHT]);
    }
  });

  test('not an object at all is unknown, never a throw', () => {
    for (const v of [undefined, null, 0, 'allowed', true, [], () => 1]) {
      expect(readOvernight(v)).toEqual(UNKNOWN_OVERNIGHT);
    }
  });
});

test.describe('naming the source', () => {
  test('osm:motorhome=yes → OpenStreetMap, motorhome=yes', () => {
    expect(describeOvernightSource('osm:motorhome=yes')).toEqual({
      name: 'OpenStreetMap',
      url: 'https://www.openstreetmap.org/',
      tag: 'motorhome=yes',
    });
  });
  test('only a source we can name in words', () => {
    for (const s of ['', ':x', 'osm', 'osm:', 'osm: x', 'park4night:yes', 'OSM:motorhome=yes']) {
      expect([s, describeOvernightSource(s)]).toEqual([s, null]);
    }
  });
});

test('the day is printed in UTC, so no time zone moves it', () => {
  expect(formatOvernightDay('2026-10-12')).toBe('12 October 2026');
  expect(formatOvernightDay('2026-01-01')).toBe('1 January 2026');
  expect(formatOvernightDay('2026-12-31')).toBe('31 December 2026');
});

test.describe('country coverage: unknown is what is left', () => {
  test('anchor: adds the regions up', () => {
    expect(
      overnightCoverage([
        { spots: 612, overnightAllowed: 12, overnightForbidden: 3, overnightReadAt: '2026-10-12' },
        { spots: 388, overnightAllowed: 8, overnightForbidden: 0, overnightReadAt: '2026-10-05' },
      ]),
    ).toEqual({ spots: 1000, allowed: 20, forbidden: 3, unknown: 977, readAt: '2026-10-12' });
  });

  test('🔴 no counts at all is everything unknown, never anything else', () => {
    expect(overnightCoverage([{ spots: 13 }])).toEqual({
      spots: 13, allowed: 0, forbidden: 0, unknown: 13, readAt: null,
    });
  });

  test('no regions is zero of everything, not a throw', () => {
    expect(overnightCoverage([])).toEqual({ spots: 0, allowed: 0, forbidden: 0, unknown: 0, readAt: null });
  });

  test('a payload that disagrees with itself is clamped, and the three still add up', () => {
    const c = overnightCoverage([
      { spots: 10, overnightAllowed: 9, overnightForbidden: 9, overnightReadAt: 'garbage' },
    ]);
    expect(c.allowed + c.forbidden + c.unknown).toBe(10);
    expect(c.allowed).toBe(9);
    expect(c.forbidden).toBe(1);
    expect(c.unknown).toBe(0);
    expect(c.readAt).toBeNull();
    const neg = overnightCoverage([{ spots: 5, overnightAllowed: -4, overnightForbidden: -1 }]);
    expect(neg).toMatchObject({ allowed: 0, forbidden: 0, unknown: 5 });
  });
});

// ── the duplicate-page guard ─────────────────────────────────────────────
//
// 🔴 `data-boilerplate` is a CLAIM: "this text is word for word the same on
// every page it appears on". The duplicate-page guard stops reading marked
// blocks, so a mark on text that varies would blind it. Two checks, read by
// THE GUARD'S OWN WALK (the same one boilerplate.spec.ts uses): every marked
// block is identical across different pages, and what is NOT marked is
// different — so "mark everything" cannot be the fix.

const marked = (html: string) =>
  boilerplateBlocks(html).map(
    (b: { name: string; text: string }) =>
      `${b.name}::${b.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`,
  );
const html = (overnight: unknown) => renderComponent(OvernightStay, { overnight });

test.describe('the section and the duplicate-page guard', () => {
  const A = { status: 'allowed', source: 'osm:motorhome=yes', checkedAt: '2026-10-12' };
  const B = { status: 'allowed', source: 'osm:motorhome=designated', checkedAt: '2026-09-28' };
  const U = { status: 'unknown', source: null, checkedAt: null };

  test('anchor: the guard finds marked blocks in both shapes', () => {
    expect(marked(html(A)).length).toBeGreaterThan(0);
    expect(marked(html(U)).length).toBeGreaterThan(0);
  });

  test('🔴 marked blocks are identical on every page of the same kind', () => {
    expect(marked(html(A))).toEqual(marked(html(B)));
    // An API that has never heard of the field renders the same block.
    expect(marked(html(U))).toEqual(marked(html(undefined)));
  });

  test('🔴 and the unmarked text still differs between two sourced pages', () => {
    const strip = (h: string) => {
      let out = visibleText(h);
      for (const m of marked(h)) out = out.replace(m.split('::')[1], '');
      return out.trim();
    };
    expect(strip(html(A))).not.toEqual(strip(html(B)));
    expect(strip(html(A))).toContain('motorhome=yes');
    expect(strip(html(B))).toContain('motorhome=designated');
  });
});
