import { expect, test } from '@playwright/test';
import { ART_H, ART_W, dotMap, outlinePath } from '@/lib/mini-map';

// CAMP-441: the pure half of the listing pictures.
//
// 🔴 Expected values are worked out by hand from the inputs, not by
// calling the function twice. The frame is 160 x 90 with 8 of padding, a
// cell of 4, and a minimum span of 0.2 degrees.

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

test('no points, or none usable: nothing to draw', () => {
  expect(dotMap([])).toBeNull();
  expect(dotMap([{ lat: NaN, lon: 1 }, { lat: 91, lon: 0 }, { lat: 0, lon: 181 }, null, 'x', { lat: '1', lon: 2 }])).toBeNull();
});

test('one point: one dot, in the middle of the tile', () => {
  const m = dotMap([{ lat: 46, lon: 14 }])!;
  expect(m.dots).toBe(1);
  // centre of 160 x 90 is (80, 45); cells of 4 → (80, 44) after rounding 45/4 = 11.25 → 11 → 44
  expect(m.d).toBe('M80 44h0');
  const [x, y] = m.project({ lat: 46, lon: 14 });
  near(x, 80);
  near(y, 45);
});

test('two points on one cell are ONE dot; a thousand identical points likewise', () => {
  expect(dotMap([{ lat: 46, lon: 14 }, { lat: 46, lon: 14 }])!.dots).toBe(1);
  expect(dotMap(Array.from({ length: 1000 }, () => ({ lat: 46, lon: 14 })))!.dots).toBe(1);
});

test('🔴 one bad point costs one point', () => {
  const m = dotMap([{ lat: 46, lon: 14 }, { lat: NaN, lon: 14 }, null, { lat: 46.5, lon: 14.5 }])!;
  expect(m.dots).toBe(2);
});

test('the extent of a region maps to the tile: a wide region spans the width, a tall one the height', () => {
  // 1.0 degree of longitude at 45N is cos(45°) = 0.7071 of latitude: 0.7071 wide, 1.0 tall.
  // Height binds: scale = (90 - 16) / 1.0 = 74 per degree; so the northernmost point is at y = 45 - 0.5 * 74 = 8.
  const m = dotMap([{ lat: 44.5, lon: 10 }, { lat: 45.5, lon: 11 }])!;
  const [, yN] = m.project({ lat: 45.5, lon: 11 });
  const [, yS] = m.project({ lat: 44.5, lon: 10 });
  // `project` rounds to one decimal (≤ 0.05 each), hence the tolerance.
  near(yN, 45 - 37, 0.06);
  near(yS, 45 + 37, 0.06);
  const [xW] = m.project({ lat: 44.5, lon: 10 });
  const [xE] = m.project({ lat: 45.5, lon: 11 });
  // width in tile = 74 * 0.7071 = 52.3, centred on 80
  near(xE - xW, 74 * Math.cos((45 * Math.PI) / 180), 0.11);
  for (const v of [xW, xE, yN, yS]) {
    expect(v).toBeGreaterThanOrEqual(0);
  }
  expect(Math.max(xW, xE)).toBeLessThanOrEqual(ART_W);
  expect(Math.max(yN, yS)).toBeLessThanOrEqual(ART_H);
});

test('🔴 two campsites 100 m apart are not stretched across the tile', () => {
  const m = dotMap([{ lat: 46, lon: 14 }, { lat: 46.0009, lon: 14.0009 }])!;
  const [x1, y1] = m.project({ lat: 46, lon: 14 });
  const [x2, y2] = m.project({ lat: 46.0009, lon: 14.0009 });
  // the minimum span is 0.2 degrees → 74 / 0.2 = 370 units per degree → 0.0009° ≈ 0.33 units
  expect(Math.hypot(x2 - x1, y2 - y1)).toBeLessThan(1);
});

test('the d attribute is one move then relative moves, and each dot is a zero-length segment', () => {
  const m = dotMap([{ lat: 46, lon: 14 }, { lat: 46.3, lon: 14.5 }, { lat: 46.15, lon: 14.25 }])!;
  expect(m.d).toMatch(/^M\d+ \d+h0(m-?\d+ -?\d+h0){2}$/);
  expect(m.dots).toBe(3);
});

const poly = (ring: number[][]) => ({ type: 'Polygon', coordinates: [ring] });
const SQ = [
  [14, 46],
  [14.002, 46],
  [14.002, 46.001],
  [14, 46.001],
  [14, 46],
];

test('outline: Polygon and MultiPolygon give the same drawing; a MultiPolygon with two parts draws both', () => {
  const a = outlinePath(poly(SQ));
  const b = outlinePath({ type: 'MultiPolygon', coordinates: [[SQ]] });
  expect(a).not.toBeNull();
  expect(b).toBe(a);
  const two = outlinePath({
    type: 'MultiPolygon',
    coordinates: [[SQ], [SQ.map(([x, y]) => [x + 0.0003, y])]],
  })!;
  expect(two.match(/Z/g)).toHaveLength(2);
  expect(two.match(/M/g)).toHaveLength(2);
});

test('outline: a hand-checked square — 0.002 x 0.001 degrees at 46N is 0.001389 wide in latitude terms', () => {
  // x extent = 0.002 * cos(46.0005°) = 0.0013894; y extent = 0.001 → width binds? scale = min(144/0.0013894, 74/0.001) = min(103 637, 74 000) = 74 000
  // → width = 102.8, height = 74.0 → x from 80 - 51.4 = 28.6 to 131.4; y from 8 to 82.
  expect(outlinePath(poly(SQ))).toBe('M28.6 82L131.4 82L131.4 8L28.6 8L28.6 82Z');
});

test('🔴 not an outline: null, and a bad ring costs only itself', () => {
  for (const bad of [null, undefined, 'x', 3, {}, { type: 'Point', coordinates: [1, 2] }, { type: 'Polygon' }, { type: 'Polygon', coordinates: 'x' }, poly([[1, 1], [2, 2]]), poly([[NaN, 1], [2, 2], [3, 3]]), poly([[200, 1], [2, 2], [3, 3]])]) {
    expect(outlinePath(bad), JSON.stringify(bad)).toBeNull();
  }
  const mixed = outlinePath({ type: 'MultiPolygon', coordinates: [[[[1, 1]]], [SQ]] })!;
  expect(mixed.match(/Z/g)).toHaveLength(1);
});
