import { ablate, compareRankings } from './ablate-scoring';
import { Candidate } from './scoring';

// CAMP-262 — the comparison the card asks for ("rank with the component on
// and off; if nothing moved, remove it") is only worth running if it can say
// "nothing moved" and can say "this moved". Both are tested.

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

describe('compareRankings', () => {
  const full = ids(12);

  it('reports zero for the same order', () => {
    expect(compareRankings(full, [...full])).toEqual({
      pool: 12,
      moved: 0,
      topReplaced: 0,
      headMoved: 0,
      top1Changed: false,
    });
  });

  it('counts a swap of the first two as two positions and a new winner', () => {
    const swapped = [...full];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(compareRankings(full, swapped)).toEqual({
      pool: 12,
      moved: 2,
      topReplaced: 0, // the same ten are shown
      headMoved: 2, // but two of the ten positions hold someone else
      top1Changed: true,
    });
  });

  it('counts a campsite pushed out of the ten shown', () => {
    // c0 drops to the end; everyone else moves up one.
    const ablated = [...full.slice(1), full[0]];
    const out = compareRankings(full, ablated);
    expect(out.topReplaced).toBe(1); // c0 left the ten (c10 took its place)
    expect(out.moved).toBe(12); // every position now holds someone else
    expect(out.top1Changed).toBe(true);
  });

  it('a change below the ten shown is moved but not seen', () => {
    const ablated = [...full];
    [ablated[10], ablated[11]] = [ablated[11], ablated[10]];
    expect(compareRankings(full, ablated)).toEqual({
      pool: 12,
      moved: 2,
      topReplaced: 0,
      headMoved: 0,
      top1Changed: false,
    });
  });

  it('refuses two rankings of different candidates', () => {
    expect(() => compareRankings(full, [...full.slice(1), 'stranger'])).toThrow(
      /not the same set/,
    );
    expect(() => compareRankings(full, full.slice(1))).toThrow(
      /not the same set/,
    );
    expect(() => compareRankings(['a', 'a'], ['a', 'a'])).toThrow(
      /not the same set/,
    );
  });
});

describe('ablate on a pool', () => {
  const R = 10_000;
  const c = (slug: string, distanceM: number, stars: number | null) =>
    ({ slug, distanceM, stars, amenities: {} }) as Candidate;

  it('a component that is the same for every candidate moves nothing', () => {
    // Nobody here has a rating — the situation of a query in a country that
    // has none. The bonus is a constant, and a constant cannot reorder.
    const pool = Array.from({ length: 30 }, (_, i) =>
      c(`p${i}`, i * 300, null),
    );
    const out = ablate(pool, R);
    expect(out.distance_fit.moved).toBeGreaterThan(0); // anchor: the harness can see movement
    expect(out.stars).toMatchObject({ moved: 0, topReplaced: 0, headMoved: 0 });
    expect(out.stars.top1Changed).toBe(false);
  });

  it('a component that tells two campsites apart moves them', () => {
    // Same distance, one rated 5 and one rated 1: only the rating orders
    // them. The slugs are chosen so the tie-break (alphabetical) would put
    // the 1-star first — the order WITHOUT the rating is therefore the
    // opposite of the order with it, and a harness that ignored the
    // component could not pass by luck.
    const pool = [
      c('a-one', 2_000, 1),
      c('b-five', 2_000, 5),
      c('far', 9_000, null),
    ];
    const out = ablate(pool, R);
    expect(out.stars.moved).toBe(2);
    expect(out.stars.top1Changed).toBe(true);
  });

  it('reports every component of the formula', () => {
    const pool = [c('a', 1, null), c('b', 2, null)];
    expect(Object.keys(ablate(pool, R)).sort()).toEqual([
      'distance_fit',
      'electricity',
      'greyWater',
      'stars',
    ]);
  });
});
