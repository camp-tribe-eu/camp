import { BadRequestException } from '@nestjs/common';
import {
  gridFor,
  parseBbox,
  parseLimit,
  POINT_LIMIT,
  MAX_POINT_LIMIT,
} from './viewport';

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

// CAMP-101: the limit a caller may ask for.
describe('parseLimit', () => {
  it('falls back to the viewport default when nothing is asked for', () => {
    expect(parseLimit(undefined)).toBe(POINT_LIMIT);
    expect(parseLimit('')).toBe(POINT_LIMIT);
  });

  it('honours a reasonable request', () => {
    expect(parseLimit('500')).toBe(500);
    expect(parseLimit('5000')).toBe(5000);
  });

  // 🔴 The reason this function exists rather than `Number(query.limit)`:
  // the route is public, and "give me every campsite in Europe" is a
  // different request from "draw this viewport".
  it('clamps an outsized request instead of serving it', () => {
    expect(parseLimit('100000')).toBe(MAX_POINT_LIMIT);
    expect(parseLimit('999999999')).toBe(MAX_POINT_LIMIT);
  });

  it('refuses nonsense rather than silently using the default', () => {
    // Silently defaulting would hide a bug in whatever built the URL.
    expect(() => parseLimit('nope')).toThrow();
    expect(() => parseLimit('0')).toThrow();
    expect(() => parseLimit('-5')).toThrow();
  });

  it('truncates a fractional limit rather than passing it to SQL', () => {
    expect(parseLimit('10.9')).toBe(10);
  });
});
