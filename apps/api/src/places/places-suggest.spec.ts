import {
  foldForSearch,
  MAX_QUERY,
  parseSuggestQuery,
  PlaceIndex,
  rank,
  type Hit,
  type IndexEntry,
} from './places-suggest';

// CAMP-456 — the pure half of the place search: how a name is folded, how a
// query is read, how candidates are ordered. No database here (places.db.spec.ts
// has it); every expected value is written out, not computed by the code under test.

describe('foldForSearch', () => {
  it.each([
    ['Antwerpen', 'antwerpen'],
    ['München', 'munchen'],
    ['Žabljak', 'zabljak'],
    ['Łódź', 'lodz'],
    ['Saint-Étienne', 'saint etienne'],
    ["L'Aquila", 'l aquila'],
    ['Straße', 'strase'],
    ['Århus', 'arhus'],
    ['Αθήνα', 'αθηνα'],
    ['  Many   spaces ', 'many spaces'],
    ['Bled!', 'bled'],
    ['100%_wild', '100wild'],
  ])('%s → %s', (input, folded) => {
    expect(foldForSearch(input)).toBe(folded);
  });

  it('the typed text and the stored name fold to the same string whatever the spelling', () => {
    expect(foldForSearch('MÜNCHEN')).toBe(foldForSearch('munchen'));
    expect(foldForSearch('Saint-Tropez')).toBe(foldForSearch('saint tropez'));
    expect(foldForSearch('Αθήνα')).toBe(foldForSearch('ΑΘΗΝΑ'));
  });

  it('never throws on a lone surrogate, a control character or an empty string', () => {
    expect(() => foldForSearch('\ud800')).not.toThrow();
    expect(foldForSearch('\u0000')).toBe('');
    expect(foldForSearch('')).toBe('');
  });
});

describe('parseSuggestQuery', () => {
  it('three folded letters is the least', () => {
    expect(parseSuggestQuery('ant')).toEqual({ ok: true, q: 'ant', limit: 8 });
    expect(parseSuggestQuery('an')).toEqual({
      ok: false,
      code: 'query_too_short',
    });
    expect(parseSuggestQuery('  a n ')).toEqual({
      ok: false,
      code: 'query_too_short',
    });
    // Three characters that are two letters and a separator are still too short.
    expect(parseSuggestQuery('a-b')).toEqual({
      ok: false,
      code: 'query_too_short',
    });
    expect(parseSuggestQuery('a-bc')).toEqual({
      ok: true,
      q: 'a bc',
      limit: 8,
    });
  });

  it('the length is bounded before folding, so a megabyte is never folded', () => {
    expect(parseSuggestQuery('a'.repeat(MAX_QUERY))).toMatchObject({
      ok: true,
    });
    expect(parseSuggestQuery('a'.repeat(MAX_QUERY + 1))).toEqual({
      ok: false,
      code: 'query_too_long',
    });
  });

  it('anything that is not a string is "missing" — an array from ?q=a&q=b, a number, nothing', () => {
    for (const bad of [undefined, null, 5, ['ant', 'ant'], { q: 'ant' }]) {
      expect(parseSuggestQuery(bad)).toEqual({
        ok: false,
        code: 'query_missing',
      });
    }
  });

  it('limit: a whole number from 1 to 10 in JSON, nothing else — "3" is not a number in a body', () => {
    expect(parseSuggestQuery('ant', 1)).toMatchObject({ ok: true, limit: 1 });
    expect(parseSuggestQuery('ant', 10)).toMatchObject({ ok: true, limit: 10 });
    for (const bad of [
      0,
      11,
      -1,
      1.5,
      NaN,
      Infinity,
      'x',
      '',
      '3',
      ['3'],
      null,
    ]) {
      expect(parseSuggestQuery('ant', bad)).toEqual({
        ok: false,
        code: 'limit_invalid',
      });
    }
  });
});

const entry = (
  over: Partial<IndexEntry> & Pick<IndexEntry, 'name' | 'kind'>,
): IndexEntry => ({
  f: foldForSearch(over.name),
  lat: 1,
  lon: 2,
  country: 'hr',
  ...over,
});

describe('PlaceIndex.search', () => {
  const index = new PlaceIndex([
    entry({ name: 'Antwerpen', kind: 'city' }),
    entry({ name: 'Ant', kind: 'village' }),
    entry({ name: 'Camping Ant', kind: 'campsite', slug: 'camping-ant' }),
    entry({ name: 'Plain Antelope', kind: 'town' }),
    entry({ name: 'Zantedeschia', kind: 'village' }),
    entry({ name: 'Antibor', kind: 'region' }),
  ]);
  const caps = { place: 10, region: 10, campsite: 10 };

  it('starts-with first, then at a word start; never in the middle of a word', () => {
    const got = index.search('ant', caps).map((h) => h.name);
    expect(got).toEqual([
      'Antwerpen',
      'Antibor',
      'Ant',
      'Plain Antelope',
      'Camping Ant',
    ]);
    expect(got).not.toContain('Zantedeschia');
  });

  it('🔴 the cap applies per group, so many villages cannot push the only campsite out', () => {
    const many = new PlaceIndex([
      ...Array.from({ length: 30 }, (_, i) =>
        entry({ name: `Antville ${i}`, kind: 'village' }),
      ),
      entry({ name: 'Antcamp', kind: 'campsite', slug: 'antcamp' }),
    ]);
    const got = many.search('ant', { place: 5, region: 5, campsite: 2 });
    expect(got.filter((h) => h.kind === 'village')).toHaveLength(5);
    expect(got.filter((h) => h.kind === 'campsite')).toHaveLength(1);
  });

  it('a query that matches nothing returns nothing', () => {
    expect(index.search('qqq', caps)).toEqual([]);
  });
});

describe('rank', () => {
  const hit = (over: Partial<Hit> & Pick<Hit, 'name' | 'kind'>): Hit => ({
    ...entry(over),
    lead: true,
    ...over,
  });

  it('the same place twice is one; two campsites with one name but different slugs are two', () => {
    const out = rank(
      [
        hit({ name: 'Bled', kind: 'town' }),
        hit({ name: 'Bled', kind: 'town' }),
        hit({ name: 'Camp', kind: 'campsite', slug: 'a' }),
        hit({ name: 'Camp', kind: 'campsite', slug: 'b' }),
      ],
      10,
    );
    expect(out.map((o) => `${o.kind}:${o.slug ?? ''}`)).toEqual([
      'town:',
      'campsite:a',
      'campsite:b',
    ]);
  });

  it('a region with two names in one point is one suggestion; two regions in different points are two', () => {
    const out = rank(
      [
        hit({ name: 'Antwerpen', kind: 'region', lat: 51, lon: 4 }),
        hit({ name: 'Antwerp', kind: 'region', lat: 51, lon: 4 }),
        hit({ name: 'Antwerp', kind: 'region', lat: 52, lon: 5 }),
      ],
      10,
    );
    expect(out).toHaveLength(2);
  });

  it('limit cuts the list, and the output carries no search-only fields', () => {
    const out = rank(
      Array.from({ length: 5 }, (_, i) =>
        hit({ name: `Place ${i}`, kind: 'town' }),
      ),
      3,
    );
    expect(out).toHaveLength(3);
    for (const o of out) {
      expect(Object.keys(o).sort()).toEqual([
        'country',
        'kind',
        'lat',
        'lon',
        'name',
      ]);
    }
  });

  it('a city beats a village of the same match, and a name that starts with the text beats one that has it inside', () => {
    const out = rank(
      [
        hit({ name: 'Zeta Ant', kind: 'city', lead: false }),
        hit({ name: 'Ant', kind: 'village' }),
        hit({ name: 'Antwerpen', kind: 'city' }),
      ],
      10,
    );
    expect(out.map((o) => o.name)).toEqual(['Antwerpen', 'Ant', 'Zeta Ant']);
  });
});
