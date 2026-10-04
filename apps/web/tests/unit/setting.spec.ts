import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSpots } from '../../../../scripts/seed-rows.mjs';
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
 * 🔴 THE SEED'S OWN ZADARSKA ROWS, READ FROM THE FILE — not an array.
 *
 * What stood here claimed "values taken from the database, not
 * invented", and six of its eight rows carried round numbers (300, 700,
 * 2000, 44 000) and no shop name, while every real row has one. It was
 * a corpus shaped by the person it was meant to test, and it agreed
 * with him: review ran the same rule over the real fixture and found 34
 * of 70 rows sharing a paragraph while this file was green.
 *
 * `fixtureRows` below reads `ci-seed.sql` with the guard's own parser,
 * so these tests and CI see the same campsites.
 */
const SEED_SQL = readFileSync(
  join(__dirname, '../../../api/test/fixtures/ci-seed.sql'),
  'utf8',
);

function fixtureRows(region?: string): { slug: string; region: string; ctx: SpotContext }[] {
  const out: { slug: string; region: string; ctx: SpotContext }[] = [];
  for (const row of readSpots(SEED_SQL) as { slug: string; region: string; context?: string }[]) {
    if (!row.context || row.context === '{}') continue;
    if (region && row.region !== region) continue;
    try {
      out.push({ slug: row.slug, region: row.region, ctx: JSON.parse(row.context) as SpotContext });
    } catch {
      /* a row we cannot read is a row this test must not invent */
    }
  }
  return out;
}

const ZADAR: SpotContext[] = fixtureRows('Zadarska').map((r) => r.ctx);


test.describe('the paragraph does the job it exists for', () => {
  // 🔴 THE HEADLINE TEST. Everything else here is detail.
  test('neighbouring coastal campsites do not read alike', () => {
    const texts = ZADAR.map((c) => settingParagraph(c));
    const sims: number[] = [];
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) sims.push(similarity(texts[i], texts[j]));
    }
    sims.sort((a, b) => a - b);
    const at = (q: number) => sims[Math.min(sims.length - 1, Math.floor(sims.length * q))];

    // 🔴 MEASURED ON THE SEED'S OWN 30 ZADARSKA ROWS, 435 pairs, after
    // the shop name, the station at every distance and the relief bands
    // were added: median 4.1%, p90 17.6%.
    //
    // The numbers that used to stand here (4.2% / 23.1%) were taken on
    // an eight-row array typed into this file, six of whose rows carried
    // round invented figures. They were not wrong about that array.
    expect(at(0.5), `median ${(at(0.5) * 100).toFixed(1)}%`).toBeLessThan(0.08);
    expect(at(0.9), `p90 ${(at(0.9) * 100).toFixed(1)}%`).toBeLessThan(0.25);
  });

  // 🔴 The failure this file was written after: one band for everything
  // under 150 m made nine of twelve neighbours open with the same
  // sentence and a different number. These are all "on the sea" and
  // must still open differently.
  // 🔴 The failure this file was written after: one band for everything
  // under 150 m made nine of twelve neighbours open with the same
  // sentence and a different number.
  //
  // 🔴 AND A RATCHET, NOT A PASS MARK. `toBeGreaterThan(1)` stood here
  // and review killed it by deleting the `m < 40` band — the exact
  // regression the paragraph above names — leaving 2 distinct openers
  // out of 6 with every test green. A bar that tolerates five identical
  // openers does not test the thing its own comment describes.
  //
  // Measured on the seed's 30 Zadarska rows: 14 distinct openers. The
  // repeats are campsites on one beach outside Obrovac that share a
  // town, a shop and a station; see the test below for why no honest
  // sentence separates them.
  test('campsites on the sea do not all open with the same sentence', () => {
    const openers = ZADAR.map((c) => settingParagraph(c).split(/\s+/).slice(0, 5).join(' '));
    expect(openers.length, 'the fixture has no Zadarska rows').toBeGreaterThanOrEqual(20);
    expect(
      new Set(openers).size,
      `openers: ${JSON.stringify([...new Set(openers)])}`,
    ).toBeGreaterThanOrEqual(14);
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

  // 🔴 THIS USED TO ASSERT `toBeNull()` AND THE RULE WAS WRONG.
  //
  // "A station 50 km away is true and useless" is right about one page
  // and wrong about the set. On the Croatian coast every station is
  // 18–50 km out, so the silence fell on exactly the campsites that had
  // least else to say — and review measured 34 of 70 fixture rows
  // rendering a paragraph identical to another's once the digits were
  // stripped, each of them with a station the reader was never told
  // about.
  //
  // So it is said, and the sentence changes its subject with the
  // distance: how to arrive, then that the railway does not come close,
  // then that a car is needed.
  test('a station too far to arrive by says so, rather than saying nothing', () => {
    expect(stationClause({ m: 1500, name: 'Nin' })).toContain('Nin');
    expect(stationClause({ m: 1500, name: 'Nin' })).toContain('arrive by train');

    const far = stationClause({ m: 50_281, name: 'Lovinac' });
    expect(far, 'a measured station is a fact, not padding').not.toBeNull();
    expect(far).toContain('Lovinac');
    expect(far).toContain('car');

    // Still nothing invented: no station, no sentence.
    expect(stationClause(undefined)).toBeNull();
    expect(stationClause({ m: Number.NaN } as never)).toBeNull();
    // And no name in, no name out.
    expect(stationClause({ m: 50_281 })).not.toMatch(/Lovinac/);
  });

  test('each station band is a different shape, not a different number', () => {
    const shapes = new Set(
      [900, 1500, 8000, 14_000, 25_000, 48_000].map((m) =>
        (stationClause({ m, name: 'Nin' }) ?? '').replace(/[\d.,]+\s*(m|km)/g, 'N'),
      ),
    );
    expect(shapes.size, [...shapes].join(' | ')).toBe(4);
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
    // 🔴 SEVEN BANDS, SEVEN SHAPES — exactly, not "at least six". The
    // `>= 6` here pre-authorised one band collapsing into its
    // neighbour, which is the only failure this assertion exists to
    // catch.
    expect(s.size, [...s].join(' | ')).toBe(7);
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

// CAMP-199 — THE FILE'S OWN CRITERION, ON THE CORPUS CI ACTUALLY BUILDS.
//
// 🔴 EVERY TEST ABOVE READS `ZADAR`, AN ARRAY I TYPED. Review ran the
// same rule over `apps/api/test/fixtures/ci-seed.sql` and found 34 of
// the 70 context-bearing rows rendering a paragraph byte-identical to
// another's once the digits were stripped — in 15 groups, the largest
// four pages deep. A corpus the author chose agreed with the author.
//
// So the measurement moved here, onto the rows the build uses. It reads
// the seed file directly rather than a trimmed copy, for the same
// reason: a sample of the fixture would be a third corpus.
test.describe('the real fixture, not a corpus I chose', () => {
  const rows = fixtureRows();

  /** The criterion, stated in code: strip the numbers, compare what is left. */
  const shape = (s: string) => s.replace(/\d[\d.,]*\s*(m|km)\b/g, 'N').replace(/\s+/g, ' ').trim();

  test('the fixture is big enough to be a subject', () => {
    // An empty comparison proves nothing. If the seed ever loses its
    // contexts this says so rather than passing over nothing.
    expect(rows.length, 'no fixture row carries a computed context').toBeGreaterThan(50);
  });

  // 🔴 THE CRITERION THIS FILE STATES, AND THE PAGES IT CANNOT MEET.
  //
  // "Strip the numbers and the sentences must still differ" is the right
  // test for a mail-merge, and 16 of 70 fixture rows fail it. Each group
  // below is campsites whose every measured fact falls in the same band
  // as its neighbour's — and for the largest, in the same band for ALL
  // of them: four sites on one beach outside Obrovac, sharing a town
  // (Obrovac), a food shop (Tommy) and a station (Lovinac), differing by
  // metres.
  //
  // 🔴 NO HONEST SENTENCE SEPARATES THEM, and adding bands until they
  // part is fitting the test rather than the place. What we have
  // measured about those four campsites IS the same; the prose is not
  // failing, it is reporting. That is why this is a NAMED LIST and not
  // a threshold: a new group joining it is a regression and goes red,
  // while these stay as the record of a thing prose cannot do.
  //
  // The second half of CAMP-199 — noindex for what still reads as a
  // duplicate — is what covers them, and the owner has the open
  // question on the card.
  const KNOWN_ALIKE = [
    'autocamp-katinka, autocamp-maslenica',
    'autocamp-marko, autocamp-vesna',
    'autocamp-pisak, autocamp-tamaris, autokamp-paron-sime, autokemp-marin',
    'camping-nadiza, kamp-lebanc',
    'glamping-virje, spot-a702234012',
    'kajak-camp-toni, spot-n258331635',
    'kamp-polovnik, spot-n3568224645',
  ];

  const alikeGroups = () => {
    const groups = new Map<string, string[]>();
    for (const r of rows) {
      const p = settingParagraph(r.ctx);
      if (!p) continue;
      const k = shape(p);
      groups.set(k, [...(groups.get(k) ?? []), r.slug]);
    }
    return [...groups.values()]
      .filter((v) => v.length > 1)
      .map((v) => [...v].sort().join(', '))
      .sort();
  };

  test('🔴 only the campsites we cannot tell apart render the same paragraph', () => {
    const found = alikeGroups();
    expect(
      found.filter((g) => !KNOWN_ALIKE.includes(g)),
      'a new group of pages reads as one. Either a fact went unsaid, or ' +
        'these campsites really are alike — read them before adding a band',
    ).toEqual([]);
    // And the other direction: a group that LEAVES the list is progress
    // and must be struck off, so the list cannot rot into a blanket.
    expect(KNOWN_ALIKE.filter((g) => !found.includes(g)), 'groups no longer alike — delete them from KNOWN_ALIKE').toEqual([]);
  });

  test('…and that is a small minority of the fixture, not most of it', () => {
    const shared = alikeGroups().reduce((n, g) => n + g.split(', ').length, 0);
    expect(shared, `${shared} of ${rows.length} rows share a shape`).toBeLessThanOrEqual(
      Math.floor(rows.length * 0.25),
    );
  });
});
