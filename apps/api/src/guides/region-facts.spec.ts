import {
  compose,
  MIN_SUBJECTS,
  slugFor,
  THEMES,
  worthPublishing,
} from './region-facts';
import type { RegionFacts } from './region-facts';

// CAMP-66 — the guides that are assembled rather than written.
//
// 🔴 What these tests are actually protecting is a claim we make about
// ourselves: that we show gaps as gaps and never state what we do not
// know. A generated page is where that promise is easiest to break,
// because nobody reads 36 of them.

const facts = (over: Partial<RegionFacts> = {}): RegionFacts => ({
  country: 'FR',
  region: 'Var',
  theme: THEMES.find((t) => t.id === 'dogs')!,
  subjects: 12,
  total: 160,
  unknown: 140,
  examples: [
    { name: 'Camping Les Pins', slug: 'camping-les-pins', detail: '4 stars' },
  ],
  ...over,
});

describe('🔴 the page states the gap, not only the count', () => {
  it('says how many campsites have nothing recorded', () => {
    const { summary, body } = compose(facts());
    expect(summary).toContain('140');
    expect(body).toContain('140 campsites in Var carry no answer');
  });

  it('says plainly that an absence is not a "no"', () => {
    const { body } = compose(facts());
    expect(body).toContain('never that the answer is no');
  });

  it('does not claim a gap when there is none', () => {
    const { summary, body } = compose(facts({ unknown: 0 }));
    expect(summary).toContain('Every campsite in Var has this recorded');
    expect(body).not.toContain('carry no answer');
  });

  // The disclaimer that every campsite page carries, on these too.
  it('repeats that nobody has visited', () => {
    expect(compose(facts()).body).toContain(
      'Nobody from CampTribe has visited',
    );
  });
});

describe('the numbers are the ones it was given', () => {
  it('never invents a total', () => {
    const { summary } = compose(facts({ subjects: 7, total: 90 }));
    expect(summary).toContain('7 of 90');
  });

  it('names the examples it was handed, and no others', () => {
    const { body } = compose(
      facts({
        examples: [
          { name: 'A', slug: 'a', detail: null },
          { name: 'B', slug: 'b', detail: '5 stars' },
        ],
      }),
    );
    expect(body).toContain('- A');
    expect(body).toContain('- B — 5 stars');
    expect(body).not.toContain('- C');
  });

  it('survives having no examples at all', () => {
    const { body } = compose(facts({ examples: [] }));
    expect(body).not.toContain('Some of them:');
    expect(body.length).toBeGreaterThan(50);
  });
});

describe('🔴 a page is only made when there is something to say', () => {
  it('a region with a handful of recorded campsites qualifies', () => {
    expect(worthPublishing(facts({ subjects: MIN_SUBJECTS }))).toBe(true);
  });

  // This is the rule that keeps the count at 36 instead of 200. A page
  // about a region where nothing is recorded is the same admission
  // repeated, which is what thin content is.
  it('a region with almost nothing recorded does not get a page', () => {
    expect(worthPublishing(facts({ subjects: MIN_SUBJECTS - 1 }))).toBe(false);
    expect(worthPublishing(facts({ subjects: 0 }))).toBe(false);
  });
});

describe('every theme is answerable from a column', () => {
  it('each has a question, a predicate and a noun', () => {
    for (const t of THEMES) {
      expect(t.id).toMatch(/^[a-z-]+$/);
      // jest's expect takes no message argument — that is Playwright's.
      expect(`${t.id}: ${t.question}`).toMatch(/\?$/);
      expect(t.predicate.length).toBeGreaterThan(5);
      expect(t.noun.length).toBeGreaterThan(3);
      expect(t.title('Var')).toContain('Var');
    }
  });

  it('their ids are unique, so slugs cannot collide', () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the slug carries country, region and theme', () => {
    expect(slugFor(facts(), 'var')).toBe('fr-var-dogs');
  });
});
