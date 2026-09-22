import { BadRequestException } from '@nestjs/common';
import { gridFor, parseBbox } from './viewport';

// CAMP-32. The viewport arrives as four numbers in a query string, from
// a browser we do not control, and everything downstream trusts it.

describe('parseBbox', () => {
  it('reads a well-formed viewport', () => {
    expect(parseBbox('13.3,45.4,16.6,46.9')).toEqual({
      minLon: 13.3,
      minLat: 45.4,
      maxLon: 16.6,
      maxLat: 46.9,
    });
  });

  it('accepts surrounding whitespace, which URLs pick up', () => {
    expect(parseBbox(' 13.3 , 45.4 ,16.6, 46.9 ').minLon).toBe(13.3);
  });

  // 🔴 The case this function exists for.
  //
  // `Number('abc')` is NaN and `Number('')` is 0. A NaN reaching
  // ST_MakeEnvelope does not raise anything — it produces an empty
  // envelope, so the request succeeds with 200 and an empty list. The
  // map then shows no campsites, and it looks exactly like a region we
  // have no data for rather than a request that was wrong.
  it.each(['abc', '13.3,45.4,16.6,abc', '13.3,,16.6,46.9'])(
    'refuses %p rather than quietly answering nothing',
    (raw) => {
      expect(() => parseBbox(raw)).toThrow(BadRequestException);
    },
  );

  it.each([
    ['', 'empty'],
    ['13.3,45.4,16.6', 'three numbers'],
    ['13.3,45.4,16.6,46.9,1', 'five numbers'],
  ])('refuses %p (%s)', (raw) => {
    expect(() => parseBbox(raw)).toThrow(BadRequestException);
  });

  it('refuses an inverted box, which would silently match nothing', () => {
    expect(() => parseBbox('16.6,45.4,13.3,46.9')).toThrow(BadRequestException);
    expect(() => parseBbox('13.3,46.9,16.6,45.4')).toThrow(BadRequestException);
  });

  it('refuses coordinates off the planet', () => {
    expect(() => parseBbox('13.3,-95,16.6,46.9')).toThrow(BadRequestException);
    expect(() => parseBbox('-181,45.4,16.6,46.9')).toThrow(BadRequestException);
  });

  it('refuses a missing parameter instead of defaulting to the world', () => {
    expect(() => parseBbox(undefined)).toThrow(BadRequestException);
  });

  it('allows the whole world, which is how the static snapshot is built', () => {
    expect(() => parseBbox('-180,-85,180,85')).not.toThrow();
  });
});

describe('gridFor', () => {
  const bbox = (minLon: number, maxLon: number) => ({
    minLon,
    minLat: 45,
    maxLon,
    maxLat: 46,
  });

  it('splits the viewport into a fixed number of cells', () => {
    expect(gridFor(bbox(-10, 30))).toBeCloseTo(5);
    expect(gridFor(bbox(14, 15))).toBeCloseTo(0.125);
  });

  it('never returns a cell smaller than a campsite', () => {
    // Without the floor, a deep zoom produces a grid finer than the
    // points themselves: every campsite becomes its own "cluster" and
    // the aggregate query does the work of the point query, slower.
    expect(gridFor(bbox(14.5, 14.5000001))).toBe(0.0005);
  });

  it('grows with the viewport, so a wider view means fewer bubbles', () => {
    expect(gridFor(bbox(-10, 30))).toBeGreaterThan(gridFor(bbox(13, 17)));
  });
});
