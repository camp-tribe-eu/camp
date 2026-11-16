import { toListingCard } from './region-listing';

// CAMP-441: the row of the listing query → the card the page gets.
// Pure — the SQL's side is in region-listing.db.spec.ts.

const row = (over: Record<string, unknown> = {}) => ({
  slug: 's',
  name: 'S',
  country: 'FR',
  region: 'Vendée',
  type: 'paid',
  amenities: { shower: 'yes' },
  lat: 46.5,
  lon: -1.5,
  outline: null,
  ...over,
});

const SQUARE = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 1],
    ],
  ],
});

describe('toListingCard', () => {
  it('carries the coordinates as numbers and the outline as parsed GeoJSON', () => {
    const c = toListingCard(row({ lat: '46.5', lon: '-1.5', outline: SQUARE }));
    expect(c.lat).toBe(46.5);
    expect(c.lon).toBe(-1.5);
    expect(c.outline).toEqual(JSON.parse(SQUARE));
  });

  it('an OSM point has no outline: null, not undefined and not the string "null"', () => {
    expect(toListingCard(row({ outline: null })).outline).toBeNull();
  });

  it('🔴 one bad geometry costs one outline: junk, an empty string, a Point and a non-array all read as null', () => {
    for (const bad of [
      'not json',
      '',
      '{"type":"Point","coordinates":[1,2]}',
      '{"type":"Polygon","coordinates":"x"}',
      '{"type":"Polygon"}',
      7,
      {},
    ]) {
      expect(toListingCard(row({ outline: bad })).outline).toBeNull();
    }
  });

  it('coordinates that are not finite numbers are absent, never NaN', () => {
    for (const lat of [null, undefined, 'x', NaN]) {
      const c = toListingCard(row({ lat }));
      expect('lat' in c).toBe(false);
      expect('lon' in c).toBe(false);
    }
  });
});
