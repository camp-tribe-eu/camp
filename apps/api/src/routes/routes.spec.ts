import {
  DEFAULT_PER_POINT,
  MAX_PER_POINT,
  MAX_POINTS,
  MAX_TOTAL,
  parsePoints,
} from './route-points';

// CAMP-3 / CAMP-45 — the rules of the route proximity endpoint, checked
// without a database.
//
// 🔴 The interesting failures here are not "the SQL returns the wrong
// rows" — PostGIS does the distance and is tested by its authors. They
// are ours: a malformed coordinate becoming a real place, a cap that
// quietly stops capping, and a request that could assemble a Substantial
// extract of somebody else's database.

describe('parsing the points a route page asks about', () => {
  it('reads a list of lat,lon pairs in order', () => {
    expect(parsePoints('46.16,-1.15;43.84,10.5')).toEqual([
      { lat: 46.16, lon: -1.15 },
      { lat: 43.84, lon: 10.5 },
    ]);
  });

  // 🔴 The one that matters. (0, 0) is a real place in the Gulf of
  // Guinea and it is what `Number('')` and `Number('abc')` would become
  // if anything defaulted instead of dropping. A route drawn to the
  // Gulf of Guinea is the exact "anchored to the wrong town" failure
  // this section was told to avoid.
  it.each([
    ['46.16,abc', 'a longitude that is not a number'],
    ['abc,-1.15', 'a latitude that is not a number'],
    ['46.16', 'a pair with no comma'],
    ['46.16,-1.15,99', 'a triple'],
    ['', 'nothing at all'],
    ['91,0', 'a latitude off the planet'],
    ['0,181', 'a longitude off the planet'],
    // 🔴 These four are the ones that got through the FIRST version of
    // the parser, which used Number() and a Number.isFinite check.
    // `Number('')` is 0, not NaN — so a truncated query string became a
    // perfectly valid point on the Greenwich meridian.
    ['46.16,', 'an empty longitude, which Number() turns into 0'],
    [',10.5', 'an empty latitude, same'],
    ['46.16, ', 'a whitespace longitude, also 0'],
    ['0x10,10.5', 'a hex literal, which Number() happily reads as 16'],
    ['1e999,10.5', 'a latitude that overflows to Infinity'],
  ])('drops %s (%s) rather than defaulting it', (raw) => {
    expect(parsePoints(raw)).toEqual([]);
  });

  it('drops only the bad pair, keeping the good ones', () => {
    expect(parsePoints('46.16,-1.15;nonsense;43.84,10.5')).toEqual([
      { lat: 46.16, lon: -1.15 },
      { lat: 43.84, lon: 10.5 },
    ]);
  });

  it('accepts a genuine zero coordinate component', () => {
    // 0 is a legal latitude and a legal longitude. The rule is "not
    // parseable", not "falsy" — `!lat` would have thrown this away.
    expect(parsePoints('0,10.5')).toEqual([{ lat: 0, lon: 10.5 }]);
    expect(parsePoints('46.16,0')).toEqual([{ lat: 46.16, lon: 0 }]);
  });

  it('is not a string, is not a crash', () => {
    expect(parsePoints(undefined)).toEqual([]);
    expect(parsePoints(null)).toEqual([]);
    expect(parsePoints(42)).toEqual([]);
    expect(parsePoints(['46,1'])).toEqual([]);
  });

  it('refuses more points than a route could have', () => {
    const many = Array.from({ length: 40 }, (_, i) => `4${i % 9}.5,10.5`).join(
      ';',
    );
    expect(parsePoints(many)).toHaveLength(MAX_POINTS);
  });
});

// 🔴 The ODbL boundary as a test, not only as a comment.
//
// A route page is a Produced Work under §4.5(a) — attribution, no
// share-alike, our text stays ours — and that holds because it shows a
// handful of objects picked by our own criteria rather than a
// systematic extract. Our own legal note draws the line at "fewer than
// 100 objects". If somebody later raises MAX_PER_POINT to 20 "so the
// page has more choice", the ceiling has moved past that line while
// every comment still says it has not.
describe('🔴 the caps that keep a route page a Produced Work', () => {
  it('no single request can assemble 100 campsites', () => {
    expect(MAX_TOTAL).toBeLessThan(100);
  });

  it('the per-stage and per-route caps agree with each other', () => {
    // The total cap must actually bind before the per-point one could
    // multiply past it, or it is decorative.
    expect(MAX_POINTS * MAX_PER_POINT).toBeGreaterThanOrEqual(MAX_TOTAL);
  });

  it('the default is well inside the maximum', () => {
    expect(DEFAULT_PER_POINT).toBeLessThanOrEqual(MAX_PER_POINT);
    expect(DEFAULT_PER_POINT).toBeGreaterThan(0);
  });
});
