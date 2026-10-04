import { expect, test } from '@playwright/test';
import { RESERVED_WORDS } from '@/lib/cems';
import {
  distance,
  groundClause,
  settingParagraph,
  shopClause,
  stationClause,
  townClause,
  waterClause,
} from '@/lib/setting';
import type { SpotContext } from '@/lib/api';

// CAMP-199 — the paragraph exists to make near-identical pages different.
// So the test that matters is not "does it render" but "are two
// neighbours still alike afterwards", measured the way the guard
// measures.

/** The guard's own method: 5-word shingles, Jaccard. */
function similarity(a: string, b: string): number {
  const sh = (t: string) => {
    const w = t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    const s = new Set<string>();
    for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(' '));
    return s;
  };
  const x = sh(a);
  const y = sh(b);
  if (x.size === 0 && y.size === 0) return 1;
  const inter = [...x].filter((v) => y.has(v)).length;
  return inter / new Set([...x, ...y]).size;
}

/**
 * Real Zadarska campsites — the region whose pages were failing the
 * duplicate guard at up to 83.9%. Values taken from the database on
 * 04.10.2026, not invented, because a fixture made up to look varied
 * would prove nothing about the place that actually has the problem.
 */
const ZADAR: SpotContext[] = [
  { water: { m: 55, kind: 'sea' }, town: { m: 2137, name: 'Biograd na Moru' }, supermarket: { m: 1601, name: 'Plodine' }, station: { m: 50281, name: 'Lovinac' } },
  { water: { m: 30, kind: 'sea' }, town: { m: 11003, name: 'Obrovac' }, supermarket: { m: 3908 }, station: { m: 41200 } },
  { water: { m: 20, kind: 'sea' }, town: { m: 15780, name: 'Nin' }, supermarket: { m: 1120 }, station: { m: 38900 } },
  { water: { m: 40, kind: 'sea' }, town: { m: 5520, name: 'Biograd na Moru' }, supermarket: { m: 2210 }, station: { m: 49000 } },
  { water: { m: 300, kind: 'sea' }, town: { m: 700, name: 'Biograd na Moru' }, supermarket: { m: 850 }, station: { m: 47000 } },
  { water: { m: 150, kind: 'sea' }, town: { m: 12000, name: 'Biograd na Moru' }, supermarket: { m: 2000 }, station: { m: 44000 } },
  { water: { m: 80, kind: 'sea' }, town: { m: 3000, name: 'Biograd na Moru' }, supermarket: { m: 700 }, station: { m: 46000 } },
  { water: { m: 60, kind: 'sea' }, town: { m: 4000, name: 'Nin' }, supermarket: { m: 400 }, station: { m: 39000 } },
];

test.describe('the paragraph does the job it exists for', () => {
  // 🔴 THE HEADLINE TEST. Everything else here is detail.
  test('neighbouring coastal campsites do not read alike', () => {
    const texts = ZADAR.map((c) => settingParagraph(c));
    const sims: number[] = [];
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) sims.push(similarity(texts[i], texts[j]));
    }
    const worst = Math.max(...sims);
    expect(worst, `worst pair: ${(worst * 100).toFixed(1)}%`).toBeLessThan(0.5);
    const median = sims.sort((a, b) => a - b)[Math.floor(sims.length / 2)];
    expect(median).toBeLessThan(0.25);
  });

  // 🔴 The failure this file was written after: one band for everything
  // under 150 m made nine of twelve neighbours open with the same
  // sentence and a different number. These are all "on the sea" and
  // must still open differently.
  test('four campsites all within 100 m of the sea open differently', () => {
    const openers = ZADAR.filter((c) => (c.water?.m ?? 1e9) < 100).map((c) =>
      settingParagraph(c).split(/\s+/).slice(0, 5).join(' '),
    );
    expect(openers.length).toBeGreaterThanOrEqual(4);
    expect(new Set(openers).size, `openers: ${JSON.stringify(openers)}`).toBeGreaterThan(1);
  });

  test('every fact we hold is used, not a chosen two', () => {
    // Three facts in, three clauses out — the first draft kept two and
    // threw away a third of what distinguishes the page.
    const text = settingParagraph(ZADAR[0]);
    expect(text).toMatch(/Biograd na Moru/);
    expect(text).toMatch(/shore|sea/);
    expect(text).toMatch(/food shop/);
  });
});

test.describe('it never says more than we measured', () => {
  test('no context, no paragraph — never an empty sentence', () => {
    expect(settingParagraph(null)).toBe('');
    expect(settingParagraph(undefined)).toBe('');
    expect(settingParagraph({})).toBe('');
  });

  test('a field that is not a number is not a fact', () => {
    const bad = { water: { m: NaN, kind: 'sea' }, town: { m: Infinity } } as unknown as SpotContext;
    expect(settingParagraph(bad)).toBe('');
    expect(waterClause({ m: NaN, kind: 'lake' } as never)).toBeNull();
    expect(townClause({ m: Infinity } as never)).toBeNull();
  });

  test('a name is passed through, never invented', () => {
    expect(townClause({ m: 2000, name: 'Nin' })).toContain('Nin');
    // No name in, no name out — and no "a nearby town called …".
    const anon = townClause({ m: 2000 });
    expect(anon).not.toMatch(/\bNin\b/);
    expect(anon).toMatch(/nearest town/);
  });

  // 🔴 A station 50 km away is not a way of arriving, so it is not
  // mentioned. Saying it would be true and useless, and useless true
  // things are what padding is made of.
  test('a station too far to use is left out entirely', () => {
    expect(stationClause({ m: 50_281, name: 'Lovinac' })).toBeNull();
    expect(stationClause({ m: 1500, name: 'Nin' })).toContain('Nin');
  });

  test('distances are said as a reader says them, and never rounded up to a lie', () => {
    expect(distance(55)).toBe('60 m');
    expect(distance(1601)).toBe('1.6 km');
    expect(distance(50_281)).toBe('50 km');
    expect(distance(-1)).toBe('');
    expect(distance(NaN)).toBe('');
  });
});

test.describe('each fact branches on its value, not on a template', () => {
  const shapes = (fn: (m: number) => string | null, metres: number[]) =>
    new Set(metres.map((m) => (fn(m) ?? '').replace(/[\d.,]+\s*(m|km)/g, 'N')));

  // 🔴 Strip the numbers, and the sentences must STILL differ. That is
  // the whole difference between prose and a mail-merge: if removing the
  // digits leaves one string, the pages differ by digits alone.
  test('water reads differently at the shore, a walk away, and inland', () => {
    const s = shapes((m) => waterClause({ m, kind: 'sea' }), [20, 60, 120, 500, 3000, 12_000, 40_000]);
    expect(s.size, [...s].join(' | ')).toBeGreaterThanOrEqual(6);
  });

  test('the town reads differently at the gate and over the horizon', () => {
    const s = shapes((m) => townClause({ m, name: 'Nin' }), [500, 3000, 12_000, 40_000]);
    expect(s.size, [...s].join(' | ')).toBe(4);
  });

  test('the shop reads differently in walking distance and far off', () => {
    const s = shapes((m) => shopClause({ m }), [400, 3000, 20_000]);
    expect(s.size, [...s].join(' | ')).toBe(3);
  });

  test('high ground and sea level are not the same sentence with a different number', () => {
    const high = groundClause({ elevation: 1400, terrain: { relief: 500, type: 'mountainous' } });
    const low = groundClause({ elevation: 8, terrain: { relief: 10, type: 'flat' } });
    expect(high).not.toBeNull();
    expect(low).not.toBeNull();
    expect((high as string).replace(/\d+/g, 'N')).not.toBe((low as string).replace(/\d+/g, 'N'));
  });
});

test.describe('the words are ours to publish', () => {
  // This paragraph sits on the same page as the Copernicus drought
  // panel, and the CEMS terms reserve four words for the authorities.
  // Nothing here may use one, whatever the figures say.
  test('no reserved word appears in any paragraph we can produce', () => {
    const cases: SpotContext[] = [
      ...ZADAR,
      { water: { m: 45_000, kind: 'river' }, town: { m: 60_000 }, supermarket: { m: 30_000 } },
      { elevation: 1800, terrain: { relief: 900, type: 'mountainous' }, water: { m: 200, kind: 'lake' } },
      { elevation: 3, terrain: { relief: 4, type: 'flat' }, supermarket: { m: 300 }, station: { m: 900, name: 'Zadar' } },
    ];
    for (const c of cases) {
      const text = settingParagraph(c);
      expect(RESERVED_WORDS.test(text), `"${text}"`).toBe(false);
    }
  });

  test('every paragraph is a sentence, not a fragment', () => {
    for (const c of ZADAR) {
      const t = settingParagraph(c);
      expect(t).toMatch(/^[A-Z]/);
      expect(t).toMatch(/\.$/);
      expect(t.split(/\s+/).length).toBeGreaterThan(8);
    }
  });
});
