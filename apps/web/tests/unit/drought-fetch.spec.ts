import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { RESERVED_WORDS } from '@/lib/cems';
import { readGrid, sampleAt, type CdiGrid } from '@/lib/drought';

// CAMP-163 — the fetch script's guards, and the reader and the sampler
// against a file and answers that neither of them wrote.
//
// 🔴 WHAT MAKES THIS MORE THAN THE SCRIPT'S OWN SELF-TEST.
//
// `scripts/edo/fetch-drought.mjs --self-test` builds its GeoTIFFs with a
// writer that lives in the same file as the reader, so the two agree by
// construction. The three defects that matter about this service — strips
// stored out of row order, no GeoKeyDirectory, a grid that has to be
// checked rather than trusted — were found by reading the REAL file, and a
// fixture written by the reader's author carries none of them.
//
// So the block below the guards reads `fixtures/cdi-crop.tif`, whose values
// are Copernicus's, whose bytes were laid out by a different program
// (`fixtures/make-cdi-crop.py`), and whose expected pixels and expected
// sampled values are GDAL's — `cdi-crop.oracle.json`. Nothing in that
// corpus was computed by the code under test, and nothing in it is the
// shipped `drought.json`, which a refresh would change under the tests.

const SCRIPT = join(__dirname, '..', '..', '..', '..', 'scripts', 'edo', 'fetch-drought.mjs');
const EFFIS = join(__dirname, '..', '..', '..', '..', 'scripts', 'effis', 'fetch-wildfires.mjs');
const FIXTURES = join(__dirname, 'fixtures');

/** A real dynamic import, written so the transpiler cannot rewrite it — see wildfire-fetch.spec.ts. */
const load = new Function('u', 'return import(u)') as (u: string) => Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

/* eslint-disable @typescript-eslint/no-explicit-any */
let mod: any;
let effis: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

test.beforeAll(async () => {
  mod = await load(pathToFileURL(SCRIPT).href);
  effis = await load(pathToFileURL(EFFIS).href);
});

const text = (s: string) => new TextEncoder().encode(s);
const outOfRange = (range: string) =>
  JSON.stringify({ message: 'x', code: 'DATE_OUT_OF_RANGE', details: { available_range: range } });

test('🔴 the script’s own self-test runs here, not only when somebody types the command', () => {
  // 🔴 Mutation: delete any guard the self-test covers (say the `EXCLUDED_LAYERS`
  // throw in `wcsUrl`) — this fails and the output names the check.
  const out = execFileSync(process.execPath, [SCRIPT, '--self-test'], { encoding: 'utf8', timeout: 60_000 });
  expect(out).not.toContain('FAIL');
  expect(out).toMatch(/(\d+)\/\1 passed/);
});

// ── the layers this service advertises falsely ───────────────────────────

test.describe('the documentation is wrong in four places, and the script is written as if it were', () => {
  test('🔴 no request can be built for a layer measured to be stale or empty', () => {
    // 🔴 Mutation: delete the `Object.hasOwn(EXCLUDED_LAYERS …)` throw — every
    // row fails, and they fail with the reason in the message.
    expect(Object.keys(mod.EXCLUDED_LAYERS).sort()).toEqual(
      ['cdinx', 'lfinx_300_lgs', 'lfinx_300_mds', 'lfinx_300_sms', 'smand'],
    );
    for (const layer of Object.keys(mod.EXCLUDED_LAYERS)) {
      expect(() => mod.wcsUrl({ coverage: layer, time: '2026-09-11' }), layer).toThrow(/REFUSING TO BUILD A REQUEST/);
    }
    expect(() => mod.wcsUrl({ coverage: 'smand', time: '2026-09-11' })).toThrow(/2024-07-01/);
    expect(() => mod.wcsUrl({ coverage: 'cdinx', time: '2026-09-11' })).toThrow(/2024-01-01/);
  });

  test('and none for a coverage nobody measured, including names that live on every object', () => {
    // 🔴 Mutation: delete the `coverage !== COVERAGE` throw — every row fails.
    // `constructor` and `toString` are on the prototype of any object, so an
    // `in` test against the table would have waved them through as "excluded"
    // — and a plain lookup would have found a function.
    for (const coverage of ['spaST', 'rdria', 'smian', 'cdirc', 'constructor', 'toString', '__proto__', '', null, 'CDIAD']) {
      expect(() => mod.wcsUrl({ coverage, time: '2026-09-11' }), String(coverage)).toThrow(/REFUSING TO BUILD A REQUEST/);
    }
    // Leaving the coverage out means the one we read; that is a default and not a hole.
    expect(new URL(mod.wcsUrl({ time: '2026-09-11' })).searchParams.get('coverageID')).toBe('cdiad');
  });

  test('the parameters are the documented incantation and only it', () => {
    // Measured 28.09.2026: `VERSION=2.0.1` errors and `VERSION=2.0.0` without
    // `map=DO_WCS` answers HTTP 502. 🔴 Mutation: change any value — fails.
    const u = new URL(mod.wcsUrl({ time: '2026-09-11' }));
    expect(`${u.origin}${u.pathname}`).toBe('https://drought.emergency.copernicus.eu/api/wcs');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      map: 'DO_WCS',
      SERVICE: 'WCS',
      VERSION: '2.0.0',
      REQUEST: 'GetCoverage',
      coverageID: 'cdiad',
      CRS: 'EPSG:4326',
      format: 'GEOTIFF',
      TIME: '2026-09-11',
    });
  });

  test('TIME must be a bare date', () => {
    for (const bad of ['2026-09-11T00:00:00Z', '11/09/2026', '2026-9-1', '', undefined, 20260911]) {
      expect(() => mod.wcsUrl({ time: bad }), String(bad)).toThrow(/TIME must be a bare/);
    }
  });
});

// ── the range: asked for, never read from the documentation ──────────────

test.describe('the available range comes from a deliberate out-of-range request', () => {
  test('the answer is read out of the service’s error', () => {
    // 🔴 Mutation: return `first` for `newest` — fails.
    expect(mod.parseAvailableRange(outOfRange('2012-01-01 - 2026-09-11'))).toEqual({
      first: '2012-01-01',
      newest: '2026-09-11',
    });
  });

  test('anything else is an error and never a guess', () => {
    // 🔴 Mutation: drop the `code` check, the shape check or the ordering
    // check — the matching rows fail.
    const rows: unknown[] = [
      '<html>502 Bad Gateway</html>',
      '',
      JSON.stringify({ code: 'PRODUCT_NOT_FOUND' }),
      JSON.stringify({ code: 'DATE_OUT_OF_RANGE' }),
      JSON.stringify({ code: 'DATE_OUT_OF_RANGE', details: {} }),
      // A different error that HAPPENS to carry a range. Without this row the
      // `code` check is a line that cannot fail: the shape check behind it
      // rejects every other body in this list anyway.
      JSON.stringify({ code: 'PRODUCT_NOT_FOUND', details: { available_range: '2012-01-01 - 2026-09-11' } }),
      JSON.stringify({ details: { available_range: '2012-01-01 - 2026-09-11' } }),
      outOfRange('2012-01-01'),
      outOfRange('2012-01-01 – 2026-09-11'),
      outOfRange('2026-09-11 - 2012-01-01'),
      outOfRange('2012-01-01 - 2026-13-45'),
      outOfRange('2012-01-01 - 2026-02-31'),
    ];
    for (const body of rows) expect(() => mod.parseAvailableRange(body), String(body)).toThrow();
  });

  test('🔴 the probe asks for 2099, and never for GetCapabilities', async () => {
    // 🔴 Mutation: have `probeRange` fetch GetCapabilities instead — the URL
    // assertion fails; have `collect` fetch it as well — the `asked` list
    // assertion below fails.
    const asked: string[] = [];
    const io = {
      async get(url: string) {
        asked.push(url);
        return { status: 422, bytes: text(outOfRange('2012-01-01 - 2026-09-11')) };
      },
    };
    const range = await mod.probeRange(io);
    expect(range).toEqual({ requested: '2099-01-01', first: '2012-01-01', newest: '2026-09-11' });
    expect(asked).toEqual([mod.wcsUrl({ time: '2099-01-01' })]);
    expect(asked[0]).toContain('TIME=2099-01-01');
  });

  test('a probe that comes back with DATA has not measured a range', async () => {
    // A service that answers a date in 2099 has broken the assumption the
    // probe stands on. 🔴 Mutation: delete the `status === 200` throw — fails.
    const io = { async get() { return { status: 200, bytes: new Uint8Array(2_190_894) }; } };
    await expect(mod.probeRange(io)).rejects.toThrow(/HTTP 200/);
  });
});

// ── collect(), against a world we control ────────────────────────────────

const GRID = { west: -25, north: 72, cellsPerDegree: 24, width: 1824, height: 1200 };
const FULL = new Uint8Array(GRID.width * GRID.height);
FULL[5 * GRID.width + 7] = 2;

/** A fake service. Every URL asked is recorded, and GetCapabilities is a trap. */
function world({
  range = '2012-01-01 - 2026-09-11',
  terms,
  tiff,
  status = 200,
}: { range?: string; terms?: string; tiff?: Uint8Array; status?: number } = {}) {
  const asked: string[] = [];
  return {
    asked,
    io: {
      async get(url: string) {
        asked.push(url);
        if (/GetCapabilities/i.test(url)) throw new Error('GetCapabilities was requested');
        if (url === mod.CEMS_TERMS) return { status: 200, bytes: text(terms ?? mod.CEMS_MARKERS.join(' | ')) };
        if (url.includes('TIME=2099-01-01')) return { status: 422, bytes: text(outOfRange(range)) };
        return status === 200
          ? { status: 200, bytes: tiff ?? mod.buildTiff({ width: GRID.width, height: GRID.height, pixels: FULL }) }
          : { status, bytes: text('{"code":"PRODUCT_NOT_FOUND"}') };
      },
    },
  };
}

test.describe('collect() reads the range from the service and refuses an old period by its age', () => {
  const NOW = new Date('2026-09-29T20:00:00Z');

  test('🔴 three requests, in order: the terms, the probe, the newest dekad the SERVICE named', async () => {
    // 🔴 Mutation: take the TIME from anywhere but the probe (a constant, the
    // date of `now`, GetCapabilities) — the second world fails.
    for (const [range, newest] of [['2012-01-01 - 2026-09-11', '2026-09-11'], ['2012-01-01 - 2026-08-21', '2026-08-21']]) {
      const w = world({ range });
      const out = await mod.collect({ now: NOW, io: w.io });
      expect(w.asked, range).toEqual([
        mod.CEMS_TERMS,
        mod.wcsUrl({ time: '2099-01-01' }),
        mod.wcsUrl({ time: newest }),
      ]);
      expect(out.meta.dekad).toBe(newest);
      expect(out.meta.range).toEqual({ probedWith: '2099-01-01', first: '2012-01-01', newest });
    }
  });

  test('🔴 the budget: 40 days is written, 41 is refused, and the future is refused', async () => {
    // 🔴 Mutation: `age > FRESH_FOR_DAYS` → `>=` fails the first row;
    // `age < 0` deleted fails the last.
    const dekad = '2026-08-21';
    const start = Date.parse(`${dekad}T00:00:00Z`);
    const at = (days: number) => new Date(start + days * 86_400_000 + 12 * 3_600_000);
    const range = `2012-01-01 - ${dekad}`;
    expect((await mod.collect({ now: at(40), io: world({ range }).io })).meta.dekad).toBe(dekad);
    await expect(mod.collect({ now: at(41), io: world({ range }).io })).rejects.toThrow(/REFUSING TO WRITE: the newest period/);
    await expect(mod.collect({ now: at(-1), io: world({ range }).io })).rejects.toThrow(/REFUSING TO WRITE: the newest period/);
  });

  test('🔴 a layer whose range stops in 2024 is refused by its age, whatever it is called', async () => {
    // What smand and cdinx look like. Even one that is NOT on the exclusion
    // list — a new stale layer, or `cdiad` itself dying — stops here.
    // 🔴 Mutation: delete the age check in `collect` — fails.
    for (const range of ['2012-01-01 - 2024-07-01', '2012-01-01 - 2024-01-01']) {
      await expect(mod.collect({ now: NOW, io: world({ range }).io }), range).rejects.toThrow(/2024-0[17]-01/);
    }
  });

  test('a range that ends mid-dekad is refused, because we could not name the period', async () => {
    // 🔴 Mutation: delete the `isDekadStart` check — fails.
    for (const newest of ['2026-09-12', '2026-09-10', '2026-09-30']) {
      await expect(mod.collect({ now: NOW, io: world({ range: `2012-01-01 - ${newest}` }).io }), newest).rejects.toThrow(
        /not the 1st, 11th or 21st/,
      );
    }
  });

  test('an advertised dekad that is not served is an error, with what the service said', async () => {
    // The Low-Flow Index shape: listed, and not there.
    await expect(mod.collect({ now: NOW, io: world({ status: 404 }).io })).rejects.toThrow(/answered HTTP 404[\s\S]*PRODUCT_NOT_FOUND/);
  });

  test('🔴 a 200 whose body is an error message is not a raster', async () => {
    // Measured 29.09.2026: `VERSION=2.0.1` answers HTTP 200 with the 37 bytes
    // "ERROR: SERVICE VERSION  must be 2.0.0". A check on the status alone
    // would take that for a GeoTIFF; the reader is what refuses it, and says
    // what it got. 🔴 Mutation: skip the TIFF magic check — this fails.
    const tiff = text('ERROR: SERVICE VERSION  must be 2.0.0');
    await expect(mod.collect({ now: NOW, io: world({ tiff }).io })).rejects.toThrow(/not a TIFF: no byte-order mark|not a TIFF: 37 bytes/);
    await expect(mod.collect({ now: NOW, io: world({ tiff: text('<html>Server Error 500</html>'.repeat(3)) }).io })).rejects.toThrow(/not a TIFF/);
  });

  test('🔴 the CEMS terms are re-read, and losing any of the three markers stops the run', async () => {
    // 🔴 Mutation: delete the `requireMarkers` call — every row fails.
    for (const marker of mod.CEMS_MARKERS) {
      const terms = mod.CEMS_MARKERS.filter((m: string) => m !== marker).join(' | ');
      await expect(mod.collect({ now: NOW, io: world({ terms }).io }), marker).rejects.toThrow(/REFUSING TO CONTINUE: the CEMS terms/);
    }
  });

  test('🔴 the credit says "modified", carries the year of the DATA, and no reserved word', async () => {
    // 🔴 Mutation: use `now.getUTCFullYear()` for the year — the December
    // row fails: a December dekad read in January would say the new year.
    const out = await mod.collect({ now: NOW, io: world().io });
    expect(out.meta.attribution).toMatch(/^Contains modified Copernicus Emergency Management Service information 2026 /);
    const dec = await mod.collect({
      now: new Date('2027-01-02T09:00:00Z'),
      io: world({ range: '2012-01-01 - 2026-12-21' }).io,
    });
    expect(dec.meta.attribution).toContain('information 2026 ');
    expect(dec.meta.dekad).toBe('2026-12-21');
    for (const bad of [undefined, null, '2026', 1999, 2101, 2026.5]) {
      expect(() => mod.attributionFor(bad), String(bad)).toThrow(/needs a real year/);
    }
  });

  test('🔴 the run refuses to WRITE a reserved word, at any depth of the meta', async () => {
    // 🔴 Mutation: make `checkMetaWording` skip nested objects — the
    // `range.newest` row fails; delete the call in `collect` — the
    // authorityNote row fails.
    await expect(
      mod.collect({ now: NOW, io: world().io, authorityNote: 'An official drought warning: evacuate.' }),
    ).rejects.toThrow(/REFUSING TO WRITE: meta\.authorityNote/);
    expect(() => mod.checkMetaWording({ a: { b: { c: 'severe drought risk' } } })).toThrow(/meta\.a\.b\.c/);
    expect(() => mod.checkMetaWording({ a: 'a plain sentence', n: 4, z: null })).not.toThrow();
    for (const word of ['warning', 'Danger', 'RISK', 'alert', 'evacuate', 'evacuation']) {
      expect(() => mod.checkMetaWording({ x: `a ${word} here` }), word).toThrow(/REFUSING TO WRITE/);
    }
    expect(mod.AUTHORITY_NOTE).not.toMatch(RESERVED_WORDS);
    expect(mod.attributionFor(2026)).not.toMatch(RESERVED_WORDS);
  });

  test('the script re-uses the ONE script list of reserved words, and it is the canonical one', () => {
    // 🔴 Mutation: give this script a literal of its own with a word missing
    // — identity fails. (cems-panels.spec.ts holds that list equal to the
    // gate's and the check's; this makes it four with no fourth copy.)
    expect(mod.FORBIDDEN_WORDS).toBe(effis.FORBIDDEN_WORDS);
    expect(mod.FORBIDDEN_WORDS.source).toBe(RESERVED_WORDS.source);
    expect(mod.FORBIDDEN_WORDS.flags).toBe(RESERVED_WORDS.flags);
  });
});

// ── the reader, against a file the service's own layout made ─────────────

interface Oracle {
  size: [number, number];
  origin: [number, number];
  pixelSize: [number, number];
  stripOffsets: number[];
  byValue: Record<string, number>;
  rows: string[];
  points: { why: string; lon: number; lat: number; value: number | null }[];
}
const CROP = readFileSync(join(FIXTURES, 'cdi-crop.tif'));
const ORACLE = JSON.parse(readFileSync(join(FIXTURES, 'cdi-crop.oracle.json'), 'utf8')) as Oracle;
const [CW, CH] = ORACLE.size;

/** The oracle's rows, decoded by a decoder written here and not by the page's. */
function oraclePixels(): Uint8Array {
  const out = new Uint8Array(CW * CH);
  ORACLE.rows.forEach((row, r) => {
    let at = r * CW;
    for (const run of row.split(',')) {
      const [v, n] = run.split(':').map(Number);
      out.fill(v, at, at + n);
      at += n;
    }
    expect(at, `oracle row ${r}`).toBe((r + 1) * CW);
  });
  return out;
}

const cropGrid = (cells: Uint8Array): CdiGrid => ({
  west: ORACLE.origin[0],
  north: ORACLE.origin[1],
  cellsPerDegree: 24,
  width: CW,
  height: CH,
  cells,
  unreadable: 0,
});

test.describe('the reader, against a real crop written by another program and read by GDAL', () => {
  test('🔴 the pixels are the ones GDAL reads, though the strips are stored out of row order', () => {
    // 🔴 Mutation: in `readGeoTiff`, read the strips one after another from
    // the lowest offset instead of following `StripOffsets` — this fails, and
    // the rotated image differs from the oracle in thousands of cells.
    const tiff = mod.readGeoTiff(CROP);
    expect([tiff.width, tiff.height]).toEqual([CW, CH]);
    const expected = oraclePixels();
    let wrong = 0;
    for (let i = 0; i < expected.length; i++) if (tiff.pixels[i] !== expected[i]) wrong++;
    expect(wrong, 'cells that differ from GDAL').toBe(0);
  });

  test('the fixture is the shape that broke a naive reader, and that reader would have got it wrong', () => {
    // A fixture whose strips were in order would prove nothing about
    // `StripOffsets`. Measured on the real file: rows 0-19 are stored last.
    expect(ORACLE.stripOffsets[0]).toBeGreaterThan(ORACLE.stripOffsets[5]);
    const lowest = Math.min(...ORACLE.stripOffsets);
    const naive = CROP.subarray(lowest, lowest + CW * CH);
    const expected = oraclePixels();
    let differ = 0;
    for (let i = 0; i < expected.length; i++) if (naive[i] !== expected[i]) differ++;
    expect(differ, 'cells a strips-in-file-order reader would get wrong').toBeGreaterThan(1000);
  });

  test('🔴 the grid is what GDAL says, and the file carries no CRS to say it', () => {
    const tiff = mod.readGeoTiff(CROP);
    expect(tiff.origin.x).toBeCloseTo(ORACLE.origin[0], 12);
    expect(tiff.origin.y).toBeCloseTo(ORACLE.origin[1], 12);
    expect(tiff.pixelSize.x).toBeCloseTo(ORACLE.pixelSize[0], 12);
    // GDAL writes the north-south step negative; the file's ModelPixelScale is positive.
    expect(tiff.pixelSize.y).toBeCloseTo(-ORACLE.pixelSize[1], 12);
    expect(tiff.hasGeoKeys).toBe(false);
    const window = { west: ORACLE.origin[0], north: ORACLE.origin[1], cellsPerDegree: 24, width: CW, height: CH };
    expect(() => mod.assertCdiGrid(tiff, window)).not.toThrow();
    // 🔴 Mutation: delete the origin check in `assertCdiGrid` — the shifted rows fail.
    for (const shift of [{ west: window.west + 1 / 24 }, { north: window.north - 1 / 24 }, { west: window.west - 1e-6 }, { cellsPerDegree: 12 }, { width: CW + 1 }, { height: CH - 1 }]) {
      expect(() => mod.assertCdiGrid(tiff, { ...window, ...shift }), JSON.stringify(shift)).toThrow(/REFUSING TO SAMPLE/);
    }
  });

  test('🔴 every sampled point is the value GDAL reports for it, or "outside" where GDAL says the point is off the file', () => {
    // 144 points: five cell centres for each value 0–6, the exact corners
    // and edges, micro-steps either side of internal cell edges, six towns
    // and 70 random points inside and outside. The expected kind is written
    // out by hand here, from GDAL's number — not from `classOfValue`.
    // 🔴 Mutation: swap the row formula to `(lat − south)`, use Math.round,
    // or move the origin by half a cell — many rows fail. That is the
    // difference between this and a test built from the code it checks.
    const grid = cropGrid(mod.readGeoTiff(CROP).pixels);
    const wrong: string[] = [];
    let onFile = 0;
    // 🔴 The ONE place we knowingly differ from GDAL, measured and named
    // rather than filtered out. `gdallocationinfo` clamps a point lying
    // EXACTLY on the far edge of the file into the last cell (it says 0 for
    // both of these); a raster's cells are half-open, the far edge belongs
    // to none of them, and the page says "outside" instead of guessing which
    // neighbour to borrow. Only two of 144 points sit on it, and this test
    // says so — if GDAL stops clamping, or we start, it goes red.
    const FAR_EDGE = new Set([
      'the exact east edge, which belongs to no cell',
      'the exact south edge, which belongs to no cell',
    ]);
    for (const p of ORACLE.points) {
      if (FAR_EDGE.has(p.why)) {
        expect(p.value, `GDAL on ${p.why}`).not.toBeNull();
        expect(sampleAt(grid, p.lat, p.lon).kind, p.why).toBe('outside');
        continue;
      }
      const got = sampleAt(grid, p.lat, p.lon);
      const want =
        p.value === null ? { kind: 'outside' }
        : p.value === 0 ? { kind: 'none' }
        : p.value <= 3 ? { kind: 'drought', level: p.value }
        : { kind: 'recovery' };
      if (p.value !== null) onFile++;
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        wrong.push(`${p.why} (${p.lat}, ${p.lon}): GDAL ${p.value}, we said ${JSON.stringify(got)}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(ORACLE.points.length).toBeGreaterThanOrEqual(144);
    expect(onFile).toBeGreaterThan(100);
    // and the corpus really holds every kind of answer
    const kinds = new Set(ORACLE.points.map((p) => (p.value === null ? 'off' : `v${p.value}`)));
    for (const k of ['off', 'v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6']) expect(kinds.has(k), k).toBe(true);
  });

  test('Malta stands on a cell with no class, in GDAL’s reading of a real crop', () => {
    // The card's case, on real data: Valletta, GDAL's value and ours.
    const valletta = ORACLE.points.find((p) => p.why === 'Valletta')!;
    expect(valletta.value).not.toBeNull();
    expect(sampleAt(cropGrid(mod.readGeoTiff(CROP).pixels), valletta.lat, valletta.lon).kind).toBe(
      valletta.value === 0 ? 'none' : valletta.value! <= 3 ? 'drought' : 'recovery',
    );
  });
});

// ── the reader refuses what it does not understand ───────────────────────

test.describe('the reader refuses a file it cannot read exactly', () => {
  const w = 8;
  const h = 10;
  const px = Uint8Array.from({ length: w * h }, (_, i) => i % 7);
  const tiff = (over: Record<string, unknown> = {}) => mod.buildTiff({ width: w, height: h, pixels: px, ...over });

  test('the plain cases read back cell for cell, in either byte order and any strip order', () => {
    // 🔴 Mutation: read the byte-order mark as always little-endian — the
    // big-endian row fails.
    for (const over of [{}, { bigEndian: true }, { stripOrder: [2, 0, 1] }, { stripOrder: [1, 2, 0], bigEndian: true }, { rowsPerStrip: 3 }, { rowsPerStrip: 10 }]) {
      expect(Array.from(mod.readGeoTiff(tiff(over)).pixels), JSON.stringify(over)).toEqual(Array.from(px));
    }
  });

  test('compressed, 16-bit, unplaceable, truncated and not-a-TIFF are all errors', () => {
    // 🔴 Mutation: delete the matching check in `readGeoTiff` — that row fails.
    expect(() => mod.readGeoTiff(tiff({ compression: 5 }))).toThrow(/uncompressed/);
    expect(() => mod.readGeoTiff(tiff({ bits: 16 }))).toThrow(/8 bits/);
    expect(() => mod.readGeoTiff(tiff({ drop: [33922] }))).toThrow(/cannot be placed/);
    expect(() => mod.readGeoTiff(tiff({ drop: [33550] }))).toThrow(/cannot be placed/);
    expect(() => mod.readGeoTiff(tiff({ drop: [273] }))).toThrow(/strip tables/);
    expect(() => mod.readGeoTiff(tiff().subarray(0, 150))).toThrow();
    expect(() => mod.readGeoTiff(tiff().subarray(0, tiff().length - 1))).toThrow(/outside the file/);
    expect(() => mod.readGeoTiff(text('<html><body>502 Bad Gateway</body></html>'))).toThrow(/not a TIFF/);
    expect(() => mod.readGeoTiff(new Uint8Array(0))).toThrow(/not a TIFF/);
    const big = Uint8Array.from(tiff());
    big[2] = 43; // BigTIFF's magic
    expect(() => mod.readGeoTiff(big)).toThrow(/BigTIFF/);
  });

  test('a file with a GeoKeyDirectory reads too — the CRS is reported and never relied on', () => {
    expect(mod.readGeoTiff(tiff({ geoKeys: true })).hasGeoKeys).toBe(true);
    expect(mod.readGeoTiff(tiff({ geoKeys: false })).hasGeoKeys).toBe(false);
  });
});

// ── encoding, and the round trip through the page's own reader ───────────

test.describe('one row per string, and one bad cell or row costs one', () => {
  test('🔴 the real crop survives script → file format → page, cell for cell', () => {
    // GDAL's pixels, encoded by the SCRIPT, decoded by the PAGE.
    // 🔴 Mutation: emit `${length}:${value}` in `encodeRows`, or merge runs
    // across a row boundary — fails.
    const cells = oraclePixels();
    const { rows, byValue, unrecognised } = mod.encodeRows(cells, CW, CH);
    expect(rows).toHaveLength(CH);
    expect(unrecognised).toBe(0);
    expect(byValue).toEqual(Object.fromEntries(Object.entries(ORACLE.byValue).filter(([v]) => Number(v) <= 6)));
    const grid = readGrid({ west: ORACLE.origin[0], north: ORACLE.origin[1], cellsPerDegree: 24, width: CW, height: CH, rows })!;
    expect(Array.from(grid.cells)).toEqual(Array.from(cells));
    // and the page reads the oracle's own (Python-written) rows the same way
    const fromPython = readGrid({ west: ORACLE.origin[0], north: ORACLE.origin[1], cellsPerDegree: 24, width: CW, height: CH, rows: ORACLE.rows })!;
    expect(Array.from(fromPython.cells)).toEqual(Array.from(cells));
  });

  test('🔴 a cell holding a value nobody has explained costs that cell, end to end', () => {
    // 🔴 Mutation: delete the `> MAX_KNOWN_VALUE` branch in `encodeRows` — the
    // 200 is written as a value and the page reads it as nothing at all.
    const cells = oraclePixels();
    const at = 10 * CW + 20;
    const odd = Uint8Array.from(cells);
    odd[at] = 200;
    const { rows, unrecognised, byValue } = mod.encodeRows(odd, CW, CH);
    expect(unrecognised).toBe(1);
    expect(Object.values(byValue).reduce((a: number, b: unknown) => a + (b as number), 0)).toBe(CW * CH - 1);
    const grid = readGrid({ west: 0, north: 0, cellsPerDegree: 24, width: CW, height: CH, rows })!;
    expect(grid.unreadable).toBe(1);
    expect(grid.cells[at]).toBe(9);
    expect(sampleAt(grid, -(10 + 0.5) / 24, (20 + 0.5) / 24).kind).toBe('unreadable');
    // its neighbours, in the same row and the rows either side, are untouched
    for (const i of [at - 1, at + 1, at - CW, at + CW]) expect(grid.cells[i], `cell ${i}`).toBe(cells[i]);
  });

  test('a run of unrecognised cells is refused as a changed format, one cell is not', () => {
    // 🔴 Mutation: delete the ceiling — the first row fails.
    expect(() => mod.requireFewUnrecognised(2_189, 2_188_800)).toThrow(/changed format/);
    expect(() => mod.requireFewUnrecognised(2_188, 2_188_800)).not.toThrow();
    expect(() => mod.requireFewUnrecognised(0, 10)).not.toThrow();
  });

  test('🔴 one damaged row in the file costs that row and no other', () => {
    const cells = oraclePixels();
    const { rows } = mod.encodeRows(cells, CW, CH);
    const damaged = rows.map((r: string, i: number) => (i === 100 ? r.replace(':', '') : r));
    const grid = readGrid({ west: 0, north: 0, cellsPerDegree: 24, width: CW, height: CH, rows: damaged })!;
    expect(grid.unreadable).toBe(CW);
    for (let r = 0; r < CH; r++) {
      const slice = Array.from(grid.cells.slice(r * CW, (r + 1) * CW));
      expect(slice, `row ${r}`).toEqual(r === 100 ? new Array(CW).fill(9) : Array.from(cells.slice(r * CW, (r + 1) * CW)));
    }
  });
});

// ── the file we ship ─────────────────────────────────────────────────────

test.describe('the shipped file says where its date came from, and agrees with itself', () => {
  const shipped = JSON.parse(readFileSync(join(__dirname, '..', '..', 'src', 'data', 'drought.json'), 'utf8')) as {
    meta: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    grid: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  test('🔴 the dekad is the newest one the service named to a 2099 probe', () => {
    // The provenance is in the file: which request the date came from, and
    // what it said. 🔴 Mutation: write `dekad` from any other source — fails.
    expect(shipped.meta.range.probedWith).toBe('2099-01-01');
    expect(shipped.meta.range.newest).toBe(shipped.meta.dekad);
    expect(shipped.meta.coverage).toBe('cdiad');
    expect(mod.isDekadStart(shipped.meta.dekad)).toBe(true);
  });

  test('the grid the file carries is the grid the script checks a raster against', () => {
    // 🔴 Mutation: change GRID in the script — fails.
    for (const key of ['west', 'north', 'cellsPerDegree', 'width', 'height']) {
      expect(shipped.grid[key], key).toBe(mod.GRID[key]);
    }
    expect(shipped.grid.rows).toHaveLength(mod.GRID.height);
  });

  test('the counts the file records are the counts of what it holds', () => {
    // Counted here from the rows with the independent decoder above, so the
    // script's own tally is checked against a second reading of its output.
    const counted: Record<string, number> = {};
    for (const row of shipped.grid.rows as string[]) {
      for (const run of row.split(',')) {
        const [v, n] = run.split(':');
        counted[v] = (counted[v] ?? 0) + Number(n);
      }
    }
    expect(counted).toEqual(shipped.meta.byValue);
    expect(shipped.meta.unrecognised).toBe(0);
    expect(Object.values(counted).reduce((a, b) => a + b, 0)).toBe(mod.GRID.width * mod.GRID.height);
  });

  test('the credit in the file is the notice for modified data, with the year of the dekad', () => {
    expect(shipped.meta.attribution).toContain(`information ${shipped.meta.dekad.slice(0, 4)} `);
    expect(shipped.meta.attribution).toMatch(/^Contains modified /);
    expect(shipped.meta.attribution).not.toMatch(RESERVED_WORDS);
  });

  test('it is well under the route’s byte budget', () => {
    // src/app/data/drought.json/route.ts stops a build at 700 000 bytes.
    expect(JSON.stringify(shipped).length).toBeLessThan(700_000);
  });
});
