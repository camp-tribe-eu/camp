import { readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  DROUGHT_COLOURS,
  droughtLegend,
  droughtState,
  inflateBase64,
  paintOverlay,
  readDroughtPayload,
  readingAt,
  type DroughtState,
} from '@/lib/drought';
import { GET } from '@/app/data/drought.json/route';

// CAMP-200 — the drought grid on the map: the payload the route serves, how
// the browser turns it into a state, and the picture painted from that state.
//
// 🔴 THE PICTURE IS CHECKED AGAINST A SECOND, PLAIN DEFINITION, not against
// `readingAt` — which is what `paintOverlay` calls, so asserting on it would
// be asking a function whether it agrees with itself. The oracle below walks
// the SOURCE cells instead: it projects each cell's northern and southern
// edge forward into mercator and says which output rows fall inside, and it
// reads the cell value and the mask bit straight out of the arrays it wrote.
// A wrong inverse projection, a skipped row or a mask that stopped applying
// is a disagreement and not two copies of one mistake.
//
// 🔴 EVERY COLOUR IS A LITERAL, never imported from `DROUGHT_COLOURS`. The
// table is imported only to assert it covers every class the shipped file
// describes, once, below.

const DATA = join(__dirname, '..', '..', 'src', 'data');
const FILE = JSON.parse(readFileSync(join(DATA, 'drought.json'), 'utf8'));
const DOMAIN = JSON.parse(readFileSync(join(DATA, 'drought-domain.json'), 'utf8'));
const nodeDecode = (s: string): Uint8Array => new Uint8Array(gunzipSync(Buffer.from(s, 'base64')));
const pack = (bytes: Uint8Array): string => gzipSync(Buffer.from(bytes)).toString('base64');

const DAY = 86_400_000;
const after = (days: number) => new Date(Date.parse(`${FILE.meta.dekad}T00:00:00Z`) + days * DAY);

/** What the route serves, built the way the route builds it. */
const SERVED = { ...FILE, domain: DOMAIN.domain };

// ── the route ────────────────────────────────────────────────────────────

test.describe('the route serves the grid and its mask as one payload', () => {
  test('🔴 one body carries the committed grid AND the mask, and nothing else of the mask file', async () => {
    // Mutation: serve `DROUGHT` alone (drop `domain`) — fails. Mutation:
    // `domain: DOMAIN` (the whole file, not its string) — fails on the type.
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = JSON.parse(await res.text());
    expect(Object.keys(body).sort()).toEqual(['cdi', 'domain', 'meta']);
    expect(body.cdi).toBe(FILE.cdi);
    expect(body.domain).toBe(DOMAIN.domain);
    expect(body.meta).toEqual(FILE.meta);
  });

  test('the payload is under the build budget, with room to spare', async () => {
    // 250 000 is the ceiling the route enforces, written out here as a
    // literal. Measured 102 117 bytes at the time of writing; the point of
    // a ceiling about 2.4 times that is that an ordinary dekad never meets
    // it. Mutation: add 150 KB to the payload — fails here before it fails
    // the build.
    const bytes = new TextEncoder().encode(await (await GET()).text()).length;
    expect(bytes).toBeLessThan(250_000);
    expect(bytes).toBeGreaterThan(50_000);
  });

  test('🔴 the browser reads the payload the route serves into a current state', async () => {
    // The route and the reader are written in different files and agree on a
    // shape by convention. This is the one place that convention is run.
    // Mutation: serve the mask under another key — the state is `missing`.
    const body = JSON.parse(await (await GET()).text());
    const s = await readDroughtPayload(body, after(12));
    expect(s.kind).toBe('current');
  });
});

// ── the browser's reader ─────────────────────────────────────────────────

test.describe('readDroughtPayload', () => {
  test('inflates what node gzips', async () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 250, 251, 252, 0, 0, 0, 7]);
    expect(Array.from(await inflateBase64(pack(bytes)))).toEqual(Array.from(bytes));
  });

  test('🔴 reads exactly what the build reads: same buffers, same answers', async () => {
    // The page reads the two files with node's gunzip; the map reads the
    // payload with the browser's. They must agree, or a campsite page and a
    // map would say different things about the same place on the same day.
    // Mutation: swap `cdi` and `domain` in the lookup — fails.
    const web = await readDroughtPayload(SERVED, after(12));
    const build = droughtState(FILE, DOMAIN, after(12), nodeDecode);
    if (web.kind !== 'current' || build.kind !== 'current') throw new Error('expected current');
    expect(Buffer.compare(Buffer.from(web.cdi), Buffer.from(build.cdi))).toBe(0);
    expect(Buffer.compare(Buffer.from(web.domain), Buffer.from(build.domain))).toBe(0);
    for (const [lat, lon] of [
      [50.85, 4.35], // Brussels
      [35.9, 14.4], // Malta
      [45, -15], // the Atlantic
      [41.9, 12.5], // Rome
    ]) {
      expect(readingAt(web, lat, lon), `${lat},${lon}`).toEqual(readingAt(build, lat, lon));
    }
  });

  test('a skipped publication is `behind`, with nothing inflated for it to use', async () => {
    expect((await readDroughtPayload(SERVED, after(41))).kind).toBe('behind');
    expect((await readDroughtPayload(SERVED, after(-5))).kind).toBe('behind');
  });

  // 🔴 Every one of these must LAND on `missing` — a state the panel says out
  // loud — and none may throw into React. Mutation: delete the try/catch
  // around the inflate loop — the corrupt cases throw instead.
  for (const [name, body] of [
    ['null', null],
    ['not an object', 'a string'],
    ['no mask', { meta: FILE.meta, cdi: FILE.cdi }],
    ['a mask that is not a string', { ...SERVED, domain: DOMAIN }],
    ['a grid that is not base64', { ...SERVED, cdi: '%%%not-base64%%%' }],
    ['a grid that is base64 but not gzip', { ...SERVED, cdi: Buffer.from('plain bytes').toString('base64') }],
    ['a grid of the wrong size', { ...SERVED, cdi: pack(new Uint8Array(10)) }],
    ['the credit removed', { ...SERVED, meta: { ...FILE.meta, attribution: 'Copernicus' } }],
  ] as [string, unknown][]) {
    test(`${name} is \`missing\`, not an exception`, async () => {
      expect((await readDroughtPayload(body, after(12))).kind).toBe('missing');
    });
  }
});

// ── the picture ──────────────────────────────────────────────────────────

/** A small current state we wrote ourselves, so the answer to every cell is known. */
function tinyState(opts: {
  width: number;
  height: number;
  lon0: number;
  lat0: number;
  pixel: number;
  cells: number[];
  /** 1 = the indicator answers here, 0 = it does not. Same order as `cells`. */
  mask: number[];
}): Extract<DroughtState, { kind: 'current' }> {
  const n = opts.width * opts.height;
  expect(opts.cells.length).toBe(n);
  expect(opts.mask.length).toBe(n);
  const domain = new Uint8Array(Math.ceil(n / 8));
  opts.mask.forEach((bit, i) => {
    if (bit) domain[i >> 3] |= 1 << (i & 7);
  });
  const payload = {
    meta: {
      ...FILE.meta,
      grid: { width: opts.width, height: opts.height, lon0: opts.lon0, lat0: opts.lat0, pixel: opts.pixel },
    },
    cdi: pack(Uint8Array.from(opts.cells)),
    domain: pack(domain),
  };
  const s = droughtState(payload, payload, after(12), nodeDecode);
  if (s.kind !== 'current') throw new Error(`the tiny state came out ${s.kind}`);
  return s;
}

/** The colours the picture must use, written out here and not read from the table. */
const WANT: Record<number, [number, number, number, number]> = {
  0: [0x9c, 0xc5, 0xa1, 90],
  1: [0xf2, 0xd9, 0x8a, 255],
  2: [0xd9, 0xa4, 0x41, 255],
  3: [0xa5, 0x54, 0x1b, 255],
  4: [0x8f, 0xb8, 0xcc, 255],
  5: [0x8f, 0xb8, 0xcc, 255],
  6: [0x8f, 0xb8, 0xcc, 255],
};
const BARE: [number, number, number, number] = [0, 0, 0, 0];

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/**
 * What every output pixel must be, worked out from the SOURCE cells.
 *
 * For each output row, the row's centre is a height in mercator space; the
 * source cell it falls in is found by projecting every cell's top and bottom
 * FORWARD and asking which interval contains it. Nothing here inverts the
 * projection, which is what `paintOverlay` does.
 */
function expectedPixel(
  t: Parameters<typeof tinyState>[0],
  overlayHeight: number,
  r: number,
  c: number,
): [number, number, number, number] {
  const yTop = mercY(t.lat0);
  const yBottom = mercY(t.lat0 - t.height * t.pixel);
  const y = yTop - ((r + 0.5) * (yTop - yBottom)) / overlayHeight;
  let row = -1;
  for (let i = 0; i < t.height; i++) {
    const top = mercY(t.lat0 - i * t.pixel);
    const bottom = mercY(t.lat0 - (i + 1) * t.pixel);
    if (y <= top && y > bottom) {
      row = i;
      break;
    }
  }
  if (row < 0) throw new Error(`output row ${r} fell outside the grid`);
  const i = row * t.width + c;
  if (!t.mask[i]) return BARE;
  return WANT[t.cells[i]] ?? BARE;
}

test.describe('paintOverlay', () => {
  // 12 columns × 9 rows of 1° cells over Europe's southern rim, 53°N to 44°N
  // — wide enough that mercator's stretch is visible between the top row and
  // the bottom one. Every class is present, and so is each way of being bare.
  const T = (() => {
    const width = 12;
    const height = 9;
    const cells: number[] = [];
    const mask: number[] = [];
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        cells.push((r * width + c) % 7);
        mask.push(1);
      }
    }
    // 🔴 THE MALTA PAIR. Row 2, columns 0–1: the indicator measured nothing
    // here and the raster holds 0 (a "normal conditions" look-alike), and
    // row 2, column 2: it holds a LOUD value (3) but the mask says the
    // indicator does not look here at all. Both must be bare; a covered 0
    // next to them must be tinted.
    cells[2 * width + 0] = 0;
    mask[2 * width + 0] = 0;
    cells[2 * width + 1] = 0;
    mask[2 * width + 1] = 0;
    cells[2 * width + 2] = 3;
    mask[2 * width + 2] = 0;
    cells[2 * width + 3] = 0;
    mask[2 * width + 3] = 1;
    // A value the file describes no class for: bare, not guessed at.
    cells[5 * width + 5] = 9;
    return { width, height, lon0: 10, lat0: 53, pixel: 1, cells, mask };
  })();

  test('🔴 every pixel is the colour of the cell it falls in, and bare where the indicator does not look', () => {
    // Mutation: remove the mask line from `readingAt` — the (row 2, col 2)
    // pixels turn brown and this fails. Mutation: space the rows evenly in
    // latitude instead of in mercator — every row from the second on is the
    // wrong cell for some pixels and this fails.
    const overlay = paintOverlay(tinyState(T));
    expect(overlay.width).toBe(12);
    const wrong: string[] = [];
    for (let r = 0; r < overlay.height; r++) {
      for (let c = 0; c < overlay.width; c++) {
        const got = Array.from(overlay.data.slice((r * overlay.width + c) * 4, (r * overlay.width + c) * 4 + 4));
        const want = expectedPixel(T, overlay.height, r, c);
        if (got.some((v, k) => v !== want[k])) wrong.push(`(${r},${c}) got ${got} want ${want}`);
      }
    }
    expect(wrong.slice(0, 5), `${wrong.length} of ${overlay.width * overlay.height} pixels differ`).toEqual([]);
  });

  test('🔴 the three kinds of 0-or-loud are three different pixels', () => {
    // The same fact as above, said as the three cases a reader meets, so a
    // failure names the case. Measured on cells (2,0) (2,2) (2,3).
    const overlay = paintOverlay(tinyState(T));
    // Middle of source row 2 in latitude is 50.5N; find the output row whose
    // centre is nearest it, forwards: no inverse projection.
    const yTop = mercY(T.lat0);
    const yBottom = mercY(T.lat0 - T.height * T.pixel);
    const rowAt = (lat: number) =>
      Math.round(((yTop - mercY(lat)) / (yTop - yBottom)) * overlay.height - 0.5);
    const px = (col: number) => {
      const at = (rowAt(50.5) * overlay.width + col) * 4;
      return Array.from(overlay.data.slice(at, at + 4));
    };
    expect(px(0), 'covered by neither: the raster says 0, the mask says no').toEqual(BARE);
    expect(px(2), 'a loud value under a mask that says no').toEqual(BARE);
    expect(px(3), 'covered, and the indicator measured normal conditions').toEqual([0x9c, 0xc5, 0xa1, 90]);
  });

  test('no source row is skipped: every row of the grid is the answer for at least one output row', () => {
    // Mutation: halve the output height — rows vanish and this fails.
    const overlay = paintOverlay(tinyState(T));
    const yTop = mercY(T.lat0);
    const yBottom = mercY(T.lat0 - T.height * T.pixel);
    const seen = new Set<number>();
    for (let r = 0; r < overlay.height; r++) {
      const y = yTop - ((r + 0.5) * (yTop - yBottom)) / overlay.height;
      for (let i = 0; i < T.height; i++) {
        if (y <= mercY(T.lat0 - i * T.pixel) && y > mercY(T.lat0 - (i + 1) * T.pixel)) seen.add(i);
      }
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('the corners are the grid’s own edges, north-west first and clockwise', () => {
    // Mutation: swap the two southern corners — the picture is upside down.
    const overlay = paintOverlay(tinyState(T));
    expect(overlay.coordinates).toEqual([
      [10, 53],
      [22, 53],
      [22, 44],
      [10, 44],
    ]);
  });

  test('the shipped grid paints, in its own corners, with the shipped mask applied', () => {
    // 🔴 The real thing, once. Malta (35.9N, 14.4E) is inside the mask and
    // carries a class; the open Atlantic is not in the grid at all. The
    // oracle here is the file itself read by node.
    const s = droughtState(FILE, DOMAIN, after(12), nodeDecode);
    if (s.kind !== 'current') throw new Error('expected current');
    const overlay = paintOverlay(s);
    expect(overlay.width).toBe(1280);
    expect(overlay.height).toBeGreaterThanOrEqual(889);
    expect(overlay.coordinates[0]).toEqual([-18.5, 71.5]);
    // Count what is tinted and what is not, against the mask itself.
    let drawn = 0;
    for (let i = 3; i < overlay.data.length; i += 4) if (overlay.data[i] > 0) drawn++;
    let covered = 0;
    for (let i = 0; i < s.domain.length; i++) {
      for (let b = 0; b < 8; b++) if ((s.domain[i] >> b) & 1) covered++;
    }
    // Every covered cell is drawn at least once, and the sea is not: the
    // drawn share of the picture tracks the covered share of the grid within
    // the mercator stretch (output rows are not equal in latitude).
    const sharePicture = drawn / (overlay.width * overlay.height);
    const shareGrid = covered / (1280 * 889);
    expect(sharePicture).toBeGreaterThan(shareGrid * 0.6);
    expect(sharePicture).toBeLessThan(shareGrid * 1.6);
    expect(shareGrid, 'the mask is not empty and not everything').toBeGreaterThan(0.2);
    expect(shareGrid).toBeLessThan(0.9);
  });
});

// ── the key to the colours ───────────────────────────────────────────────

test.describe('the legend', () => {
  const meta = FILE.meta;

  test('🔴 every class the shipped file describes has a colour, or it would not be drawn', () => {
    // Mutation: delete `2:` from DROUGHT_COLOURS — fails. Without it every
    // class-2 cell was bare, which is "dry ground" drawn as "outside".
    for (const c of meta.classes as { value: number }[]) {
      expect(DROUGHT_COLOURS[c.value], `class ${c.value} has no colour`).toBeTruthy();
    }
  });

  test('🔴 the legend and the pixels read one table', () => {
    // Each legend swatch is the colour a pixel of that class gets, and its
    // label is the file’s own name for the class. Mutation: give the legend
    // its own hex for one row — fails.
    const rows = droughtLegend(meta);
    for (const c of meta.classes as { value: number; label: string }[]) {
      const hex = '#' + WANT[c.value].slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
      const row = rows.find((r) => r.hex.toUpperCase() === hex);
      expect(row, `no legend row for class ${c.value} (${hex})`).toBeTruthy();
      expect(row!.label, `class ${c.value}`).toContain(c.label);
    }
  });

  test('classes drawn in one colour are one row, not three identical swatches', () => {
    const rows = droughtLegend(meta);
    // 0, 1, 2, 3 and the three recovery classes sharing a colour.
    expect(rows.length).toBe(5);
    expect(rows[rows.length - 1].label).toBe('recovered, soil recovering, vegetation recovering');
  });

  test('a class with no colour is left out, not drawn as a guess', () => {
    const rows = droughtLegend({ ...meta, classes: [...meta.classes, { value: 42, label: 'unheard of', detail: 'x' }] });
    expect(rows.some((r) => r.label.includes('unheard of'))).toBe(false);
  });
});
