import {
  compose,
  DISCLAIMERS,
  dist,
  MIN_NAMED_FACTS,
  MIN_SUBJECTS,
  namedFactCount,
  slugFor,
  THEMES,
  worthPublishing,
} from './region-facts';
import type { RegionFacts, Surroundings } from './region-facts';

// CAMP-66 / CAMP-130 — the guides that are assembled rather than written.
//
// 🔴 What these tests are actually protecting is a claim we make about
// ourselves: that we show gaps as gaps and never state what we do not
// know. A generated page is where that promise is easiest to break,
// because nobody reads 1256 of them.
//
// 🔴 CAMP-130 added a second thing to protect, and it is the one that
// decides whether these pages may be published at all: that two pages of
// the same theme are not each other. The bar is stated in `similarity`
// below and it is enforced here, in CI, rather than asserted once in a
// pull request and left to rot.

const surroundings = (over: Partial<Surroundings> = {}): Surroundings => ({
  towns: [
    { name: 'Gmunden', n: 6, nearest: 900 },
    { name: 'Bad Ischl', n: 3, nearest: 1400 },
  ],
  townsNamed: 7,
  townDist: { known: 12, within: 8, median: 2100, beyond: 0 },

  waters: [{ name: 'Traunsee', n: 5, nearest: 69, kind: 'lake', walk: 4 }],
  waterNamed: 9,
  waterKinds: [
    { kind: 'lake', n: 7 },
    { kind: 'river', n: 5 },
  ],
  waterDist: { known: 12, within: 6, median: 480, beyond: 1 },

  stations: [{ name: 'Traunkirchen', n: 2, nearest: 1311 }],
  stationsNamed: 2,
  stationDist: { known: 12, within: 3, median: 4200, beyond: 2 },

  shopDist: { known: 12, within: 5, median: 1500, beyond: 0 },

  terrain: [{ type: 'mountainous', n: 3 }],
  terrainKnown: 3,

  elevation: { low: 210, median: 640, high: 1340 },
  elevationKnown: 4,

  facets: [{ label: 'record showers', n: 5 }],

  gapTowns: [{ name: 'Ebensee', n: 41, nearest: 700 }],
  otherTowns: [{ name: 'Altmünster', n: 22, nearest: 500 }],
  ...over,
});

const facts = (over: Partial<RegionFacts> = {}): RegionFacts => ({
  country: 'AT',
  region: 'Var',
  theme: THEMES.find((t) => t.id === 'dogs')!,
  subjects: 12,
  total: 160,
  unknown: 140,
  examples: [
    { name: 'Camping Les Pins', slug: 'camping-les-pins', detail: '4 stars' },
  ],
  surroundings: surroundings(),
  ...over,
});

describe('🔴 the page states the gap, not only the count', () => {
  it('says how many campsites have nothing recorded', () => {
    const { summary, body } = compose(facts());
    expect(summary).toContain('140');
    expect(body).toContain('140 of the 160 campsites we hold in Var carry no');
  });

  it('says plainly that an absence is not a "no"', () => {
    const { body } = compose(facts());
    expect(body).toContain('never that the answer is no');
  });

  it('keeps that promise on a page with no gap at all', () => {
    const { body } = compose(facts({ unknown: 0 }));
    expect(body).toContain('never because the answer is no');
  });

  it('does not claim a gap when there is none', () => {
    const { summary, body } = compose(facts({ unknown: 0 }));
    expect(summary).toContain('Every campsite in Var has this recorded');
    expect(body).not.toContain('carry no answer');
    expect(body).toContain('Nothing is missing here');
  });

  // 🔴 The distinction CAMP-130 had to fix. A campsite rated three stars
  // has an answer and the answer is no; a campsite with no rating has no
  // answer. Printing the first as the second invents a gap, which is the
  // same dishonesty as hiding one.
  it('separates a recorded "no" from a missing answer', () => {
    const { body } = compose(facts({ subjects: 12, total: 160, unknown: 40 }));
    expect(body).toContain('40 of the 160 campsites we hold in Var carry no');
    expect(body).toContain('A further 108 are recorded as not taking dogs');
  });

  it('locates the gap rather than only counting it', () => {
    const { body } = compose(facts());
    expect(body).toContain('41 around Ebensee');
  });

  // The disclaimer that every campsite page carries, on these too.
  it('repeats that nobody has visited, word for word', () => {
    expect(compose(facts()).body).toContain(DISCLAIMERS[0]);
  });
});

describe('the numbers and names are the ones it was given', () => {
  it('never invents a total', () => {
    const { summary } = compose(facts({ subjects: 7, total: 90 }));
    expect(summary).toContain('7 of 90');
  });

  it('names the towns, waters and stations it was handed', () => {
    const { body } = compose(facts());
    expect(body).toContain('- Gmunden — 6 campsites, the closest 900 m out');
    expect(body).toContain('- Traunsee (lake) — 5 campsites, 4 of them within');
    expect(body).toContain('- Traunkirchen — 2 campsites');
  });

  it('names the examples it was handed, and no others', () => {
    const { body } = compose(
      facts({
        examples: [
          { name: 'A', slug: 'a', detail: null },
          { name: 'B', slug: 'b', detail: '5 official stars' },
        ],
      }),
    );
    expect(body).toContain('- A');
    expect(body).toContain('- B — 5 official stars');
    expect(body).not.toContain('- C');
  });

  it('survives having no examples at all', () => {
    const { body } = compose(facts({ examples: [] }));
    expect(body).not.toContain('Some of them:');
    expect(body.length).toBeGreaterThan(50);
  });

  // 🔴 An unrecorded fact is SAID to be unrecorded. It is never simply
  // left out, because a reader cannot tell a missing sentence from a
  // fact that does not exist.
  it('says so when nobody has recorded the terrain', () => {
    const { body } = compose(
      facts({ surroundings: surroundings({ terrain: [], terrainKnown: 0 }) }),
    );
    expect(body).toContain('Nobody has recorded the terrain at any of the 12');
  });

  it('says nothing about height when nothing was measured', () => {
    const { body } = compose(
      facts({
        surroundings: surroundings({ elevation: null, elevationKnown: 0 }),
      }),
    );
    expect(body).not.toContain('Height above sea level');
  });

  // 🔴 Kinds are counted over every subject, names over a subset. In one
  // sentence the two totals looked like a contradiction on the page, and
  // a reader who cannot reconcile two of our numbers has no reason to
  // trust the rest of them.
  it('keeps the kind count and the name count in separate sentences', () => {
    const { body } = compose(facts());
    expect(body).toContain('The nearest water is a lake for 7 and a river');
    expect(body).toContain('9 of the 12 have a name recorded for theirs');
    expect(body).toContain('nobody has named the water beside the other 3');
  });

  it('does not print a range when one measurement made it', () => {
    const { body } = compose(
      facts({
        surroundings: surroundings({
          terrain: [{ type: 'hilly', n: 1 }],
          terrainKnown: 1,
          elevation: { low: 254, median: 254, high: 254 },
          elevationKnown: 1,
        }),
      }),
    );
    expect(body).toContain('recorded for exactly one of the 12, and it is');
    expect(body).not.toContain('254 m to 254 m');
    expect(body).toContain('recorded for exactly one of them, at 254 m');
  });

  it('says plainly when no water here carries a name', () => {
    const { body } = compose(
      facts({ surroundings: surroundings({ waters: [], waterNamed: 0 }) }),
    );
    expect(body).toContain('Not one of the 12 has a named body of water');
  });

  it('says plainly when nothing is within reach of a station', () => {
    const { body } = compose(
      facts({
        surroundings: surroundings({ stations: [], stationsNamed: 0 }),
      }),
    );
    expect(body).toContain('None of the 12 is within 2.0 km of a railway');
  });

  it('a page with no measured surroundings still composes', () => {
    const { body } = compose(facts({ surroundings: null }));
    expect(body).toContain('140 of the 160 campsites');
    expect(body).toContain(DISCLAIMERS[0]);
  });

  it('says metres and kilometres the way a person does', () => {
    expect(dist(69)).toBe('69 m');
    expect(dist(999)).toBe('999 m');
    expect(dist(1311)).toBe('1.3 km');
    expect(dist(31200)).toBe('31 km');
  });
});

describe('🔴 a page is only made when there is something to say', () => {
  it('a region with a handful of recorded campsites qualifies', () => {
    expect(worthPublishing(facts({ subjects: MIN_SUBJECTS }))).toBe(true);
  });

  // This is the rule that keeps the count honest. A page about a region
  // where nothing is recorded is the same admission repeated, which is
  // what thin content is.
  it('a region with almost nothing recorded does not get a page', () => {
    expect(worthPublishing(facts({ subjects: MIN_SUBJECTS - 1 }))).toBe(false);
    expect(worthPublishing(facts({ subjects: 0 }))).toBe(false);
  });

  // 🔴 The gate CAMP-130 added. Campsite count says there is something
  // here; named-fact count says the page is this region's own. A page
  // that passes the first and fails the second is a page carried by its
  // skeleton, and that is the page the similarity measurement caught.
  it('a region we hold no names for does not get a page either', () => {
    const bare = surroundings({
      towns: [],
      waters: [],
      stations: [],
      terrain: [],
      terrainKnown: 0,
      elevation: null,
      elevationKnown: 0,
    });
    expect(namedFactCount(facts({ surroundings: bare }))).toBe(0);
    expect(worthPublishing(facts({ subjects: 400, surroundings: bare }))).toBe(
      false,
    );
  });

  it('counts a name once per named place, and counts nothing else', () => {
    expect(namedFactCount(facts())).toBe(2 + 1 + 1 + 1 + 1);
    expect(namedFactCount(facts({ surroundings: null }))).toBe(0);
  });

  it('the gate is the reason MIN_NAMED_FACTS exists', () => {
    expect(MIN_NAMED_FACTS).toBeGreaterThan(0);
  });
});

describe('every theme is answerable from a column', () => {
  it('each has a question, a predicate and a noun', () => {
    for (const t of THEMES) {
      expect(t.id).toMatch(/^[a-z-]+$/);
      // jest's expect takes no message argument — that is Playwright's.
      expect(`${t.id}: ${t.question}`).toMatch(/\?$/);
      expect(t.predicate.length).toBeGreaterThan(3);
      expect(t.noun.length).toBeGreaterThan(3);
      expect(t.title('Var')).toContain('Var');
    }
  });

  // 🔴 Without this the page cannot tell a gap from a "no", and the
  // honesty paragraph becomes a guess dressed as a count.
  it('each says when its question HAS an answer, and what a "no" is', () => {
    for (const t of THEMES) {
      expect(`${t.id}: ${t.recorded}`.length).toBeGreaterThan(t.id.length + 5);
      expect(t.otherwise.length).toBeGreaterThan(3);
      expect(t.facets.length).toBeGreaterThan(0);
      for (const f of t.facets) {
        expect(f.predicate.length).toBeGreaterThan(3);
        expect(f.label.length).toBeGreaterThan(3);
      }
    }
  });

  it('their ids are unique, so slugs cannot collide', () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the slug carries country, region and theme', () => {
    expect(slugFor(facts(), 'var')).toBe('at-var-dogs');
  });
});

// ---------------------------------------------------------------------
// 🔴 The bar, in CI.
//
// Word 5-gram Jaccard is what near-duplicate detectors use. Measured
// against the live database on 27.09.2026, the OLD composition put the
// median pair of same-theme pages at 0.59–0.61 and three quarters of all
// motorhome and water pairs above 0.60. The bar CAMP-130 set is that
// within a theme the median must be below 0.30 and fewer than 1% of
// pairs may exceed 0.60 — 0.60 being exactly where the old template sat
// at its MEDIAN, so "almost no pair may reach what used to be typical".
//
// Disclaimers are excluded, here and in the live measurement, because a
// safety statement is supposed to be identical everywhere. Nothing else
// is excluded: the honesty paragraph is measured like any other text.
// ---------------------------------------------------------------------

function shingles(text: string, n = 5): Set<string> {
  const w = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function measurable(f: RegionFacts): string {
  let body = compose(f).body;
  for (const d of DISCLAIMERS) body = body.split(d).join(' ');
  return body;
}

/** Deterministic pseudo-randomness — a failing run must be reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const TOWNS = [
  'Savona',
  'Kötschach',
  'Vouzela',
  'Corte',
  'Gmunden',
  'Bludenz',
  'Rattenberg',
  'Mortágua',
  'Calvi',
  'Ebensee',
  'Régua',
  'Viseu',
];
const WATERS = [
  'Traunsee',
  'Gail',
  'Rio Vouga',
  'Tavignanu',
  'Reintaler See',
  "L'Asco",
  'Albufeira do Carrapatelo',
  'Ill',
];
const KINDS = ['lake', 'river', 'sea', 'reservoir'];

/** A region built from one seed: different names, different numbers. */
function synthetic(i: number, themeId: string): RegionFacts {
  const r = rng(1000 + i * 37);
  const pick = <T>(xs: T[], k: number) => {
    const start = Math.floor(r() * xs.length);
    return Array.from({ length: k }, (_, j) => xs[(start + j) % xs.length]);
  };
  const n = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo));
  const subjects = n(5, 400);
  const theme = THEMES.find((t) => t.id === themeId)!;

  return {
    country: ['AT', 'IT', 'PT', 'FR', 'DE'][i % 5],
    region: TOWNS[(i * 5) % TOWNS.length] + ' Region',
    theme,
    subjects,
    total: subjects + n(10, 900),
    unknown: n(0, 400),
    examples: [],
    surroundings: {
      towns: pick(TOWNS, 5).map((name) => ({
        name,
        n: n(1, 40),
        nearest: n(60, 9000),
      })),
      townsNamed: n(3, 90),
      townDist: {
        known: subjects,
        within: n(0, subjects),
        median: n(200, 9000),
        beyond: n(0, 8),
      },
      waters: pick(WATERS, 4).map((name) => ({
        name,
        n: n(1, 20),
        nearest: n(20, 4000),
        kind: KINDS[n(0, 4)],
        walk: n(0, 9),
      })),
      waterNamed: n(1, subjects),
      waterKinds: pick(KINDS, 3).map((kind) => ({ kind, n: n(1, 90) })),
      waterDist: {
        known: subjects,
        within: n(0, subjects),
        median: n(50, 4000),
        beyond: n(0, 30),
      },
      stations: pick(TOWNS, 3).map((name) => ({
        name,
        n: n(1, 9),
        nearest: n(40, 1900),
      })),
      stationsNamed: n(0, 30),
      stationDist: {
        known: subjects,
        within: n(0, subjects),
        median: n(400, 30000),
        beyond: n(0, 40),
      },
      shopDist: {
        known: subjects,
        within: n(0, subjects),
        median: n(200, 9000),
        beyond: n(0, 9),
      },
      terrain: [{ type: ['flat', 'hilly', 'rolling'][n(0, 3)], n: n(1, 9) }],
      terrainKnown: n(0, 9),
      elevation: { low: n(0, 200), median: n(200, 900), high: n(900, 2000) },
      elevationKnown: n(1, 9),
      facets: theme.facets.map((f) => ({ label: f.label, n: n(0, subjects) })),
      gapTowns: pick(TOWNS, 3).map((name) => ({
        name,
        n: n(1, 90),
        nearest: n(100, 9000),
      })),
      otherTowns: pick(TOWNS, 3).map((name) => ({
        name,
        n: n(1, 90),
        nearest: n(100, 9000),
      })),
    },
  };
}

describe('🔴 two pages of one theme are not each other', () => {
  for (const theme of THEMES) {
    it(`${theme.id}: median under 0.30, no pair over 0.60`, () => {
      const pages = Array.from({ length: 14 }, (_, i) =>
        shingles(measurable(synthetic(i, theme.id))),
      );
      const sims: number[] = [];
      for (let i = 0; i < pages.length; i++) {
        for (let j = i + 1; j < pages.length; j++) {
          sims.push(jaccard(pages[i], pages[j]));
        }
      }
      sims.sort((a, b) => a - b);
      const median = sims[Math.floor(sims.length / 2)];
      const over = sims.filter((s) => s > 0.6).length / sims.length;

      expect(median).toBeLessThan(0.3);
      expect(over).toBeLessThan(0.01);
    });
  }

  // 🔴 The failure mode this guards against: somebody adds a sentence
  // that is the same on every page. One paragraph of fixed prose is
  // enough to put a short page back over the bar, and it will not look
  // like a mistake in review.
  it('a long fixed paragraph would break the bar, and is caught', () => {
    // 400 distinct words, identical on every page — a fixed paragraph,
    // not a repeated phrase, because a repeated phrase shingles to
    // almost nothing and would let the guard pass on a page that is in
    // fact mostly boilerplate.
    const boilerplate =
      ' ' + Array.from({ length: 400 }, (_, k) => `word${k}`).join(' ');
    const pages = Array.from({ length: 8 }, (_, i) =>
      shingles(measurable(synthetic(i, 'dogs')) + boilerplate),
    );
    const sims: number[] = [];
    for (let i = 0; i < pages.length; i++) {
      for (let j = i + 1; j < pages.length; j++) {
        sims.push(jaccard(pages[i], pages[j]));
      }
    }
    const median = sims.sort((a, b) => a - b)[Math.floor(sims.length / 2)];
    expect(median).toBeGreaterThan(0.3);
  });
});
