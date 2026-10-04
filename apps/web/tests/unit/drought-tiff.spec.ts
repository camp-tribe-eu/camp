import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

// CAMP-163 — the GeoTIFF reader, against a file it did not write and
// answers it did not compute.
//
// 🔴 WHY THIS EXISTS BESIDE THE SCRIPT'S OWN `--self-test`.
//
// That rehearsal builds its GeoTIFFs with a writer living in the same
// file as the reader. The two therefore agree BY CONSTRUCTION, and a
// green run proves only that they agree with each other — the exact
// shape of the self-confirming corpus this repository keeps finding.
// Mine had it too: I hand-wrote the fixture bytes from my own reading of
// the TIFF specification, so a misreading would be present on both
// sides and invisible from either.
//
// 🔴 THIS CORPUS SHARES NO FIELD WITH THE CODE UNDER TEST.
//
//   · the bytes are a window of Copernicus' real `cdiad` raster
//     (2026-09-11), cut by `fixtures/make-cdi-crop.py`;
//   · the expected pixels, the expected histogram and the expected value
//     at 144 coordinates are GDAL's, recorded in
//     `fixtures/cdi-crop.oracle.json`;
//   · nothing in it was produced by `parseGeoTiff` or by `sampleAt`.
//
// And the real file carries quirks a hand-written one does not: its
// strips are stored OUT OF BYTE ORDER — the oracle's `stripOffsets`
// begins 66582, 67926, … and then drops to 726 — so a reader that
// concatenated by ascending offset instead of by strip index would
// return a scrambled raster that still parsed, still had the right
// length, and still produced plausible values.
//
// ⚠️ This fixture and its oracle came from an earlier pull request for
// this card (#84) which I had not noticed when I rebuilt the layer. They
// are better than what I wrote, and taking them is the point of saying
// so.

/** The two probes that sit ON the window's outer boundary — see the test that names them. */
const OUTER_EDGE = (p: { why: string }) => /the exact (east|south) edge/.test(p.why);

const FIXTURES = join(__dirname, 'fixtures');
const SCRIPT = join(__dirname, '..', '..', '..', '..', 'scripts', 'edo', 'fetch-drought.mjs');

/** A real dynamic import, written so the transpiler cannot rewrite it. */
const load = new Function('u', 'return import(u)') as (
  u: string,
) => Promise<Record<string, unknown>>;

interface Oracle {
  about: string;
  source: string;
  gdal: string;
  size: [number, number];
  origin: [number, number];
  pixelSize: [number, number];
  stripOffsets: number[];
  byValue: Record<string, number>;
  rows: string[];
  points: { why: string; lon: number; lat: number; value: number }[];
}

const oracle = JSON.parse(
  readFileSync(join(FIXTURES, 'cdi-crop.oracle.json'), 'utf8'),
) as Oracle;
const tif = readFileSync(join(FIXTURES, 'cdi-crop.tif'));

/* eslint-disable @typescript-eslint/no-explicit-any */
let mod: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

test.beforeAll(async () => {
  mod = await load(pathToFileURL(SCRIPT).href);
});

test.describe('the reader against a file and answers it did not write', () => {
  test('the corpus is what it claims to be', () => {
    // 🔴 An oracle nobody checks is a second copy of our own opinion.
    // These three lines are what make it third-party evidence.
    expect(oracle.gdal).toMatch(/^GDAL \d/);
    expect(oracle.source).toMatch(/cdiad/);
    expect(oracle.points.length).toBeGreaterThanOrEqual(100);
  });

  // 🔴 The quirk that makes this fixture worth committing: the real
  // product stores its strips out of byte order. A hand-written fixture
  // has them ascending, so a reader that sorted by offset would pass
  // every test its author wrote and scramble every real raster.
  test('the real raster really does store its strips out of order', () => {
    const offs = oracle.stripOffsets;
    const ascending = offs.every((v, i) => i === 0 || offs[i - 1] <= v);
    expect(ascending, 'the fixture lost the quirk it was chosen for').toBe(false);
  });

  test('every pixel matches what GDAL read', () => {
    const got = mod.parseGeoTiff(tif);
    expect([got.width, got.height]).toEqual(oracle.size);

    // Expand the oracle's run-length rows and compare the whole raster.
    const expected = Buffer.allocUnsafe(oracle.size[0] * oracle.size[1]);
    let at = 0;
    for (const row of oracle.rows) {
      for (const run of row.split(',')) {
        const [v, n] = run.split(':').map(Number);
        expected.fill(v, at, at + n);
        at += n;
      }
    }
    expect(at, 'the oracle rows do not cover the raster').toBe(expected.length);
    expect(Buffer.compare(got.px, expected), 'pixels differ from GDAL').toBe(0);
  });

  test('the histogram matches too, which a scrambled raster would also pass', () => {
    // Kept as a SECOND check and labelled as the weaker one: order is
    // what the strip quirk breaks, and a histogram is blind to order.
    const got = mod.parseGeoTiff(tif);
    const counts: Record<string, number> = {};
    for (const v of got.px) counts[v] = (counts[v] ?? 0) + 1;
    expect(counts).toEqual(oracle.byValue);
  });

  test('the geometry matches what GDAL reports', () => {
    const got = mod.parseGeoTiff(tif);
    expect(got.lon0).toBeCloseTo(oracle.origin[0], 9);
    expect(got.lat0).toBeCloseTo(oracle.origin[1], 9);
    expect(got.pixel).toBeCloseTo(Math.abs(oracle.pixelSize[0]), 12);
  });

  // 🔴 The sampler, which is what every campsite page actually calls.
  // 144 coordinates, each with the value GDAL reads at that point.
  test('the value at 144 coordinates is the value GDAL reads there', () => {
    const got = mod.parseGeoTiff(tif);
    const win = {
      width: got.width,
      height: got.height,
      lon0: got.lon0,
      lat0: got.lat0,
      pixel: got.pixel,
    };
    const wrong: string[] = [];
    let checked = 0;
    for (const p of oracle.points) {
      if (OUTER_EDGE(p)) continue;
      checked += 1;
      const v = mod.sampleAt(win, got.px, p.lon, p.lat);
      if (v !== p.value) wrong.push(`${p.why} at ${p.lon},${p.lat}: got ${v}, GDAL says ${p.value}`);
    }
    expect(checked, 'the exclusion swallowed the corpus').toBeGreaterThanOrEqual(140);
    expect(wrong, wrong.slice(0, 5).join('\n')).toHaveLength(0);
  });

  // 🔴 TWO POINTS WHERE WE DELIBERATELY DISAGREE WITH GDAL, named rather
  // than quietly excluded.
  //
  // At the window's exact east and south edge GDAL answers 0. The
  // oracle's own label for those two says they belong "to no cell" — it
  // is GDAL clamping a coordinate that is the boundary of the raster,
  // not a point inside it. We answer null there, which is the stricter
  // reading: we do not state a value for a place that is not in a cell.
  //
  // It cannot matter for a campsite — no campsite sits on the crop
  // boundary to twelve decimals — but a test that let the two slide
  // would be hiding a real difference in behaviour behind a tolerance.
  // Every other edge probe in the oracle, including all 24 micro-steps
  // either side of a cell boundary, agrees with GDAL exactly.
  test('🔴 at the outer boundary we answer "not in a cell" where GDAL clamps to 0', () => {
    const got = mod.parseGeoTiff(tif);
    const win = { width: got.width, height: got.height, lon0: got.lon0, lat0: got.lat0, pixel: got.pixel };
    const outer = oracle.points.filter(OUTER_EDGE);
    expect(outer.length, 'the oracle no longer probes the outer boundary').toBe(2);
    for (const p of outer) {
      expect(p.value, 'GDAL changed its answer at the boundary').toBe(0);
      expect(mod.sampleAt(win, got.px, p.lon, p.lat), p.why).toBeNull();
    }
  });

  test('a point outside the window is not a lookup', () => {
    const got = mod.parseGeoTiff(tif);
    const win = { width: got.width, height: got.height, lon0: got.lon0, lat0: got.lat0, pixel: got.pixel };
    expect(mod.sampleAt(win, got.px, oracle.origin[0] - 1, oracle.origin[1])).toBeNull();
    expect(mod.sampleAt(win, got.px, oracle.origin[0], oracle.origin[1] + 1)).toBeNull();
  });

  // The crop is 336×216, not the product's 1824×1200 — so the grid
  // assertion must refuse it, and the parser must not.
  test('the grid check refuses a window that is not the product', () => {
    expect(() => mod.readGeoTiff(tif)).toThrow(/the CDI grid moved/);
    expect(() => mod.parseGeoTiff(tif)).not.toThrow();
  });
});
