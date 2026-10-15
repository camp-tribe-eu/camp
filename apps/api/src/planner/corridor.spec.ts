import { buildCorridor } from './corridor-source';
import { Corridor, EARTH_RADIUS_M, straightCorridor } from './corridor';

// CAMP-46 — where a point lies on the straight corridor from A to B.
//
// 🔴 EVERY EXPECTED NUMBER BELOW IS WRITTEN OUT, and was computed OUTSIDE this
// code — haversine and the cross-track formula in a throwaway script, not by
// calling `locate`. An expectation derived from the function it checks would
// move with a mutation of it. The meridian and equator cases are chosen so a
// reader can check them with a pencil: a degree of arc is 111 195.08 m on a
// sphere of 6 371 008.8 m.

const close = (got: number, want: number, within: number) =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(within);

let meridian: Corridor;
let lyonBarcelona: Corridor;

beforeAll(async () => {
  // Six degrees due north: along is latitude, and nothing else.
  meridian = await straightCorridor({ from: [10, 40], to: [10, 46] });
  lyonBarcelona = await straightCorridor({
    from: [4.83, 45.76],
    to: [2.17, 41.39],
  });
});

describe('the length of the corridor', () => {
  it('six degrees of meridian are 667 170.48 m', () => {
    close(meridian.metres, 667_170.48, 0.5);
  });

  it('Lyon to Barcelona by haversine is 530 991.09 m', () => {
    close(lyonBarcelona.metres, 530_991.09, 0.5);
  });

  it('is on the sphere the radius names', () => {
    // One degree of arc, from the radius alone.
    expect((EARTH_RADIUS_M * Math.PI) / 180).toBeCloseTo(111_195.08, 2);
  });

  it('says it is a straight line, and hands the corridor rule the line it measures', () => {
    expect(meridian.measure).toBe('straight');
    expect(meridian.line).toEqual([
      [10, 40],
      [10, 46],
    ]);
  });
});

describe('locate, along a meridian', () => {
  it('the start is at 0 and the end at the length', () => {
    close(meridian.locate([10, 40]).along, 0, 1e-6);
    close(meridian.locate([10, 46]).along, meridian.metres, 1e-6);
  });

  it('the middle (43°N) is 333 585.24 m along and on the line', () => {
    const at = meridian.locate([10, 43]);
    close(at.along, 333_585.24, 0.5);
    close(at.offset, 0, 1e-6);
  });

  it('a point 0.1° of longitude east at 43°N is 8 132.29 m to the side, 333 590.08 m along', () => {
    // Not 0.1° × 111 195 m: a degree of longitude is shorter at 43°N, and the
    // foot of the perpendicular is a little further north than the point.
    const at = meridian.locate([10.1, 43]);
    close(at.offset, 8_132.29, 0.5);
    close(at.along, 333_590.08, 0.5);
  });

  it('the side does not matter: offset is a distance, never negative', () => {
    const west = meridian.locate([9.9, 43]);
    const east = meridian.locate([10.1, 43]);
    close(west.offset, east.offset, 1e-6);
    expect(west.offset).toBeGreaterThan(0);
  });

  it('behind the start is negative and beyond the end is more than the length', () => {
    close(meridian.locate([10, 39]).along, -111_195.08, 0.5);
    close(meridian.locate([10, 47]).along, 778_365.56, 0.5);
  });
});

describe('locate, along the equator', () => {
  it('half a degree east of the start, 0.1° north of it', async () => {
    const eq = await straightCorridor({ from: [0, 0], to: [1, 0] });
    close(eq.metres, 111_195.08, 0.5);
    const at = eq.locate([0.5, 0.1]);
    close(at.along, 55_597.54, 0.5);
    close(at.offset, 11_119.51, 0.5);
  });
});

describe('a line that is not a line', () => {
  it('the same place twice has no arc, and says so', async () => {
    await expect(
      straightCorridor({ from: [4.83, 45.76], to: [4.83, 45.76] }),
    ).rejects.toThrow(/no arc/);
  });

  it('opposite places have none either', async () => {
    await expect(
      straightCorridor({ from: [0, 0], to: [180, 0] }),
    ).rejects.toThrow(/no arc/);
  });
});

describe('the seam', () => {
  it('the source the planner uses today is the straight corridor', async () => {
    const via = await buildCorridor({ from: [10, 40], to: [10, 46] });
    expect(via.measure).toBe('straight');
    close(via.metres, 667_170.48, 0.5);
  });
});
