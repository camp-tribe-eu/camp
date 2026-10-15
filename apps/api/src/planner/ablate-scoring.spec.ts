import { ablate, compareRankings } from './ablate-scoring';
import { Candidate, rank } from './scoring';

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

  // 🔴 THE WINDOW IS THE TEN SHOWN, pinned by POSITION in plain indices.
  // The pull request rests its case for keeping `stars` on the `top10`
  // column, so that column must mean ten. Until 15.10.2026 `topN = 10` could
  // be changed to 5 in either signature and the whole suite stayed green:
  // every fixture here swapped positions 0-1 or 10-11, which read the same
  // through a window of 5 and a window of 10. A swap across the edge — the
  // tenth shown against the eleventh — reads differently through each, and
  // that is the fixture below. It names no constant.
  const swap = (i: number, j: number) => {
    const out = [...full];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  };

  it('the tenth shown against the eleventh: one campsite leaves the ten and one enters', () => {
    // c9 is shown, c10 is not; after the swap c10 is shown and c9 is not.
    expect(compareRankings(full, swap(9, 10))).toEqual({
      pool: 12,
      moved: 2,
      topReplaced: 1,
      headMoved: 1,
      top1Changed: false,
    });
  });

  it('the fifth against the sixth: both are inside the ten, so two positions differ and nobody leaves', () => {
    expect(compareRankings(full, swap(4, 5))).toEqual({
      pool: 12,
      moved: 2,
      topReplaced: 0,
      headMoved: 2,
      top1Changed: false,
    });
  });

  it('the eleventh against the twelfth is below the window and does not count', () => {
    expect(compareRankings(full, swap(10, 11))).toMatchObject({
      moved: 2,
      topReplaced: 0,
      headMoved: 0,
    });
  });

  it('a window given by the caller is the window used', () => {
    // Through a window of 5 the same two swaps read the other way round.
    expect(compareRankings(full, swap(9, 10), 5)).toMatchObject({
      topReplaced: 0,
      headMoved: 0,
    });
    expect(compareRankings(full, swap(4, 5), 5)).toMatchObject({
      topReplaced: 1, // c4 is the fifth shown and c5 replaces it
      headMoved: 1,
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

  describe('the ten shown, through ablate', () => {
    // Nine campsites in a row a kilometre apart, then a pair at the SAME
    // distance — a 1-star and a 5-star, slugs ordered so the tie-break would
    // put the 1-star first — then one more far out. Only the rating orders
    // the pair, and the pair sits across the edge of the ten: the 5-star is
    // the tenth shown with the rating on, the 1-star the tenth without it.
    const pool = [
      ...Array.from({ length: 9 }, (_, i) => c(`s${i}`, i * 1_000, null)),
      c('a-one', 9_000, 1),
      c('b-five', 9_000, 5),
      c('far', 9_900, null),
    ];
    const slugs = (without: Parameters<typeof rank>[2] = []) =>
      rank(pool, R, without).map((x) => x.slug);

    it('anchor: the rating, and only the rating, decides who is tenth', () => {
      expect(slugs()[9]).toBe('b-five');
      expect(slugs()[10]).toBe('a-one');
      expect(slugs(['stars'])[9]).toBe('a-one');
      expect(slugs(['stars'])[10]).toBe('b-five');
      // And nobody else moved.
      expect(slugs().slice(0, 9)).toEqual(slugs(['stars']).slice(0, 9));
      expect(slugs()[11]).toBe('far');
    });

    it('counts the campsite that left the ten shown, by default', () => {
      expect(ablate(pool, R).stars).toEqual({
        pool: 12,
        moved: 2,
        topReplaced: 1,
        headMoved: 1,
        top1Changed: false,
      });
    });

    it('hands the caller’s window to the comparison instead of its own', () => {
      // Through five shown, the pair is out of sight in both orders.
      expect(ablate(pool, R, 5).stars).toMatchObject({
        moved: 2,
        topReplaced: 0,
        headMoved: 0,
      });
    });
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
