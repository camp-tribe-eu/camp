import { expect, test } from '@playwright/test';
import {
  applyFilters,
  EMPTY_FILTERS,
  fromSearchParams,
  isFiltering,
  matchesLenient,
  matchesStrict,
  toggle,
  toSearchParams,
  type MapFilterState,
} from '../../src/lib/map-filter';
import { AMENITY_KEYS, SPOT_TYPES } from '../../src/lib/api';

// CAMP-35 / CAMP-25 — the filtering rule, checked without a browser.
//
// 🔴 This rule exists twice: here in TypeScript and in SQL on the API
// side. That duplication is real, and these cases are written to mirror
// apps/api/src/spots/filters.spec.ts exactly — same questions, same
// expectations — so a change to one that is not made to the other shows
// up as a test that disagrees with its twin rather than as a map quietly
// drawing a different set from the one the API would return.

const feature = (props: Record<string, unknown>) => ({
  properties: { type: 'paid', ...props },
});

const state = (over: Partial<MapFilterState> = {}): MapFilterState => ({
  ...EMPTY_FILTERS,
  ...over,
});

test.describe('matching one campsite', () => {
  test('no filter matches everything', () => {
    expect(matchesStrict(feature({}).properties, state())).toBe(true);
    expect(isFiltering(state())).toBe(false);
  });

  test('strict wants a definite yes', () => {
    const s = state({ amenities: ['shower'] });
    expect(matchesStrict(feature({ shower: 'yes' }).properties, s)).toBe(true);
    expect(matchesStrict(feature({ shower: 'unknown' }).properties, s)).toBe(
      false,
    );
    expect(matchesStrict(feature({ shower: 'no' }).properties, s)).toBe(false);
  });

  test('lenient rejects only a definite no', () => {
    const s = state({ amenities: ['shower'] });
    expect(matchesLenient(feature({ shower: 'unknown' }).properties, s)).toBe(
      true,
    );
    expect(matchesLenient(feature({ shower: 'no' }).properties, s)).toBe(false);
  });

  // Mirrors "rows predating an amenity survive" on the API side: a
  // campsite imported before this amenity existed has no such property at
  // all, and `undefined` is not a no.
  test('a missing property is unknown, never a no', () => {
    const s = state({ amenities: ['greyWater'] });
    expect(matchesLenient(feature({}).properties, s)).toBe(true);
    expect(matchesStrict(feature({}).properties, s)).toBe(false);
  });

  test('several amenities are an AND', () => {
    const s = state({ amenities: ['shower', 'toilets'] });
    expect(
      matchesStrict(feature({ shower: 'yes', toilets: 'yes' }).properties, s),
    ).toBe(true);
    expect(
      matchesStrict(
        feature({ shower: 'yes', toilets: 'unknown' }).properties,
        s,
      ),
    ).toBe(false);
  });

  test('several types are an OR', () => {
    const s = state({ types: ['wild', 'free'] });
    expect(matchesStrict(feature({ type: 'wild' }).properties, s)).toBe(true);
    expect(matchesStrict(feature({ type: 'free' }).properties, s)).toBe(true);
    expect(matchesStrict(feature({ type: 'paid' }).properties, s)).toBe(false);
  });

  // 🔴 CAMP-25's reason for existing, on the client side too.
  test('step-free is a stricter question than wheelchair access', () => {
    const limited = feature({
      wheelchair: 'yes',
      wheelchairFull: 'no',
    }).properties;
    expect(matchesStrict(limited, state({ amenities: ['wheelchair'] }))).toBe(
      true,
    );
    expect(
      matchesStrict(limited, state({ amenities: ['wheelchairFull'] })),
    ).toBe(false);
  });
});

test.describe('counting what is hidden', () => {
  const dataset = [
    feature({ shower: 'yes' }),
    feature({ shower: 'yes' }),
    feature({ shower: 'unknown' }),
    feature({ shower: 'unknown' }),
    feature({ shower: 'unknown' }),
    feature({ shower: 'no' }),
  ];

  test('shows the definite yeses and counts the unrecorded', () => {
    const out = applyFilters(dataset, state({ amenities: ['shower'] }));
    expect(out.shown).toHaveLength(2);
    // Three unknowns — not the campsite that says no, which is not
    // hidden for want of data but because we know the answer.
    expect(out.unknownExcluded).toBe(3);
  });

  test('including unknowns draws them and stops reporting them', () => {
    const out = applyFilters(
      dataset,
      state({ amenities: ['shower'], includeUnknown: true }),
    );
    expect(out.shown).toHaveLength(5);
    // 🔴 Zero, not three. They are on the screen; saying "and 3 more
    // hidden" under a map already showing them is the kind of small lie
    // that makes a reader distrust every other number on the page.
    expect(out.unknownExcluded).toBe(0);
  });

  test('no filter shows everything and hides nothing', () => {
    const out = applyFilters(dataset, state());
    expect(out.shown).toHaveLength(dataset.length);
    expect(out.unknownExcluded).toBe(0);
  });

  test('a type filter alone never reports hidden unknowns', () => {
    // Type is never unknown — the column is NOT NULL — so there is
    // nothing that could be excluded for want of data.
    const out = applyFilters(dataset, state({ types: ['paid'] }));
    expect(out.unknownExcluded).toBe(0);
  });
});

test.describe('the query string is a link somebody can send', () => {
  test('round-trips through the URL', () => {
    const s = state({
      types: ['wild'],
      amenities: ['toilets', 'wheelchairFull'],
      includeUnknown: true,
    });
    const back = fromSearchParams(
      `?${toSearchParams(s)}`,
      SPOT_TYPES,
      AMENITY_KEYS,
    );
    expect(back).toEqual(s);
  });

  test('an empty state produces an empty query string', () => {
    expect(toSearchParams(EMPTY_FILTERS)).toBe('');
  });

  // A link shared before an amenity was renamed must still open the map.
  test('drops values it does not recognise instead of failing', () => {
    const back = fromSearchParams(
      '?types=wild,teleporter&amenities=toilets,jacuzzi',
      SPOT_TYPES,
      AMENITY_KEYS,
    );
    expect(back.types).toEqual(['wild']);
    expect(back.amenities).toEqual(['toilets']);
  });

  test('uses the same parameter names the API takes', () => {
    const qs = toSearchParams(
      state({ types: ['free'], amenities: ['wifi'], includeUnknown: true }),
    );
    expect(qs).toBe('types=free&amenities=wifi&unknown=1');
  });
});

test.describe('toggle keeps the declared order', () => {
  test('adds in list order, not click order', () => {
    let picked: string[] = [];
    picked = toggle(picked, 'wild', SPOT_TYPES);
    picked = toggle(picked, 'free', SPOT_TYPES);
    // `free` is declared before `wild`, so the URL is stable whichever
    // order the reader clicks — two people sharing "the same" filter get
    // the same link.
    expect(picked).toEqual(['free', 'wild']);
  });

  test('removes on a second click', () => {
    expect(toggle(['free', 'wild'], 'free', SPOT_TYPES)).toEqual(['wild']);
  });
});
