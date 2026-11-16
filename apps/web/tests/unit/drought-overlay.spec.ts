import { readFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { visibleText } from "./rendered-text";
import {
  DROUGHT_COLOURS,
  DROUGHT_RASTER_OPACITY,
  droughtLegend,
  droughtState,
  effectiveOpacity,
  inflateBase64,
  maskFileOf,
  paintOverlay,
  paintSmoothOverlay,
  readDroughtPayload,
  readingAt,
  type DroughtState,
} from "@/lib/drought";
import { SMOOTH_FACTOR } from "@/lib/drought-smooth";
import { DroughtLayerPanel } from "@/components/drought-layer-panel";
import { GET } from "@/app/data/drought.json/route";
import { renderComponent } from "./render-component";

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

const DATA = join(__dirname, "..", "..", "src", "data");
const FILE = JSON.parse(readFileSync(join(DATA, "drought.json"), "utf8"));
const DOMAIN = JSON.parse(
  readFileSync(join(DATA, "drought-domain.json"), "utf8"),
);
const nodeDecode = (s: string): Uint8Array =>
  new Uint8Array(gunzipSync(Buffer.from(s, "base64")));
const pack = (bytes: Uint8Array): string =>
  gzipSync(Buffer.from(bytes)).toString("base64");

const DAY = 86_400_000;
const after = (days: number) =>
  new Date(Date.parse(`${FILE.meta.dekad}T00:00:00Z`) + days * DAY);

/** What the route serves, built the way the route builds it. */
const SERVED = { ...FILE, domain: DOMAIN.domain, domainGrid: DOMAIN.meta.grid };

// ── the route ────────────────────────────────────────────────────────────

test.describe("the route serves the grid and its mask as one payload", () => {
  test("🔴 one body carries the committed grid, the mask AND the mask’s grid, and nothing else of the mask file", async () => {
    // Mutation: serve `DROUGHT` alone (drop `domain`) — fails. Mutation:
    // drop `domainGrid` — fails: the browser could no longer check that the
    // mask was cut from the grid it is laid over. Mutation: `domainGrid:
    // DOMAIN.meta` (all of it, the dekads and the growth curve with it) —
    // fails on the grid's own five keys.
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    const body = JSON.parse(await res.text());
    expect(Object.keys(body).sort()).toEqual([
      "cdi",
      "domain",
      "domainGrid",
      "meta",
    ]);
    expect(body.cdi).toBe(FILE.cdi);
    expect(body.domain).toBe(DOMAIN.domain);
    expect(body.meta).toEqual(FILE.meta);
    expect(Object.keys(body.domainGrid).sort()).toEqual([
      "height",
      "lat0",
      "lon0",
      "pixel",
      "width",
    ]);
    expect(body.domainGrid).toEqual(DOMAIN.meta.grid);
  });

  test("the payload is under the build budget, with room to spare", async () => {
    // 250 000 is the ceiling the route enforces, written out here as a
    // literal. Measured 102 212 bytes at the time of writing; the point of
    // a ceiling about 2.4 times that is that an ordinary dekad never meets
    // it. Mutation: add 150 KB to the payload — fails here before it fails
    // the build.
    const bytes = new TextEncoder().encode(await (await GET()).text()).length;
    expect(bytes).toBeLessThan(250_000);
    expect(bytes).toBeGreaterThan(50_000);
  });

  test("🔴 the browser reads the payload the route serves into a current state", async () => {
    // The route and the reader are written in different files and agree on a
    // shape by convention. This is the one place that convention is run.
    // Mutation: serve the mask under another key — the state is `missing`.
    const body = JSON.parse(await (await GET()).text());
    const s = await readDroughtPayload(body, after(12));
    expect(s.kind).toBe("current");
  });
});

// ── the browser's reader ─────────────────────────────────────────────────

test.describe("readDroughtPayload", () => {
  test("inflates what node gzips", async () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 250, 251, 252, 0, 0, 0, 7]);
    expect(Array.from(await inflateBase64(pack(bytes)))).toEqual(
      Array.from(bytes),
    );
  });

  test("🔴 reads exactly what the build reads: same buffers, same answers", async () => {
    // The page reads the two files with node's gunzip; the map reads the
    // payload with the browser's. They must agree, or a campsite page and a
    // map would say different things about the same place on the same day.
    // Mutation: swap `cdi` and `domain` in the lookup — fails.
    const web = await readDroughtPayload(SERVED, after(12));
    const build = droughtState(FILE, DOMAIN, after(12), nodeDecode);
    if (web.kind !== "current" || build.kind !== "current")
      throw new Error("expected current");
    expect(Buffer.compare(Buffer.from(web.cdi), Buffer.from(build.cdi))).toBe(
      0,
    );
    expect(
      Buffer.compare(Buffer.from(web.domain), Buffer.from(build.domain)),
    ).toBe(0);
    for (const [lat, lon] of [
      [50.85, 4.35], // Brussels
      [35.9, 14.4], // Malta
      [45, -15], // the Atlantic
      [41.9, 12.5], // Rome
    ]) {
      expect(readingAt(web, lat, lon), `${lat},${lon}`).toEqual(
        readingAt(build, lat, lon),
      );
    }
  });

  test("a skipped publication is `behind`, with nothing inflated for it to use", async () => {
    expect((await readDroughtPayload(SERVED, after(41))).kind).toBe("behind");
    expect((await readDroughtPayload(SERVED, after(-5))).kind).toBe("behind");
  });

  // 🔴 Every one of these must LAND on `missing` — a state the panel says out
  // loud — and none may throw into React. Mutation: delete the try/catch
  // around the inflate loop — the corrupt cases throw instead.
  for (const [name, body] of [
    ["null", null],
    ["not an object", "a string"],
    ["no mask", { meta: FILE.meta, cdi: FILE.cdi }],
    ["a mask that is not a string", { ...SERVED, domain: DOMAIN }],
    ["a grid that is not base64", { ...SERVED, cdi: "%%%not-base64%%%" }],
    [
      "a grid that is base64 but not gzip",
      { ...SERVED, cdi: Buffer.from("plain bytes").toString("base64") },
    ],
    ["a grid of the wrong size", { ...SERVED, cdi: pack(new Uint8Array(10)) }],
    // 🔴 THE BROWSER'S OWN COPY of the mask-size case. `drought.spec.ts` pins
    // the check through the build's reader; this goes through the path the
    // map takes, where a payload's mask is what the route assembled. The
    // mask's grid is the right one, so only the length check refuses it.
    // Mutation: delete `domain.length !== Math.ceil(cells / 8)` from
    // `droughtState` — fails here and in drought.spec.ts.
    [
      "a mask of the wrong size",
      { ...SERVED, domain: pack(new Uint8Array(10)) },
    ],
    [
      "a mask one byte short",
      {
        ...SERVED,
        domain: pack(new Uint8Array(Math.ceil((1280 * 889) / 8) - 1)),
      },
    ],
    // 🔴 And the geometry, which the payload could not carry before it sent
    // `domainGrid`. Rows and columns swapped is the same byte count: the
    // length check passes it and only the comparison of the two grids refuses.
    // Mutation: serve `domainGrid` as the pixel grid's own `meta.grid` (the
    // check then compares a grid with itself) — the swapped case is accepted.
    [
      "a mask with no grid beside it",
      (({ domainGrid: _d, ...rest }) => rest)(SERVED),
    ],
    [
      "a mask cut from a grid with rows and columns swapped",
      {
        ...SERVED,
        domainGrid: { ...DOMAIN.meta.grid, width: 889, height: 1280 },
      },
    ],
    [
      "a mask cut from a grid one cell to the east",
      {
        ...SERVED,
        domainGrid: {
          ...DOMAIN.meta.grid,
          lon0: DOMAIN.meta.grid.lon0 + DOMAIN.meta.grid.pixel,
        },
      },
    ],
    [
      "the credit removed",
      { ...SERVED, meta: { ...FILE.meta, attribution: "Copernicus" } },
    ],
  ] as [string, unknown][]) {
    test(`${name} is \`missing\`, not an exception`, async () => {
      expect((await readDroughtPayload(body, after(12))).kind).toBe("missing");
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
}): Extract<DroughtState, { kind: "current" }> {
  const n = opts.width * opts.height;
  expect(opts.cells.length).toBe(n);
  expect(opts.mask.length).toBe(n);
  const domain = new Uint8Array(Math.ceil(n / 8));
  opts.mask.forEach((bit, i) => {
    if (bit) domain[i >> 3] |= 1 << (i & 7);
  });
  const grid = {
    width: opts.width,
    height: opts.height,
    lon0: opts.lon0,
    lat0: opts.lat0,
    pixel: opts.pixel,
  };
  const payload = {
    meta: { ...FILE.meta, grid },
    cdi: pack(Uint8Array.from(opts.cells)),
    domain: pack(domain),
    domainGrid: grid,
  };
  const s = droughtState(payload, maskFileOf(payload), after(12), nodeDecode);
  if (s.kind !== "current")
    throw new Error(`the tiny state came out ${s.kind}`);
  return s;
}

/**
 * The colours the picture must use, written out here and not read from the table.
 * since CAMP-529 (16.11.2026) all seven are ours: 1, 2, 3, 5 and 6 are EDO's CDI v4.1.1 hues
 * deepened to hold the palette guard at raster-opacity 0.5, 0 and 4 were ours before
 * (`lib/drought-colours.ts` says why) — and 4, 5, 6 are three colours, as EDO draws them.
 */
const WANT: Record<number, [number, number, number, number]> = {
  0: [0x2c, 0xb8, 0x2a, 255],
  1: [0xe3, 0xcf, 0x00, 255],
  2: [0xe2, 0x78, 0x02, 255],
  3: [0x9e, 0x0f, 0x14, 255],
  4: [0x30, 0x39, 0xa5, 255],
  5: [0xcb, 0x23, 0x92, 255],
  6: [0x00, 0x86, 0x63, 255],
};
const BARE: [number, number, number, number] = [0, 0, 0, 0];

const mercY = (lat: number) =>
  Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

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

test.describe("paintOverlay", () => {
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

  test("🔴 every pixel is the colour of the cell it falls in, and bare where the indicator does not look", () => {
    // Mutation: remove the mask line from `readingAt` — the (row 2, col 2)
    // pixels turn brown and this fails. Mutation: space the rows evenly in
    // latitude instead of in mercator — every row from the second on is the
    // wrong cell for some pixels and this fails.
    const overlay = paintOverlay(tinyState(T));
    expect(overlay.width).toBe(12);
    const wrong: string[] = [];
    for (let r = 0; r < overlay.height; r++) {
      for (let c = 0; c < overlay.width; c++) {
        const got = Array.from(
          overlay.data.slice(
            (r * overlay.width + c) * 4,
            (r * overlay.width + c) * 4 + 4,
          ),
        );
        const want = expectedPixel(T, overlay.height, r, c);
        if (got.some((v, k) => v !== want[k]))
          wrong.push(`(${r},${c}) got ${got} want ${want}`);
      }
    }
    expect(
      wrong.slice(0, 5),
      `${wrong.length} of ${overlay.width * overlay.height} pixels differ`,
    ).toEqual([]);
  });

  test("🔴 the three kinds of 0-or-loud are three different pixels", () => {
    // The same fact as above, said as the three cases a reader meets, so a
    // failure names the case. Measured on cells (2,0) (2,2) (2,3).
    const overlay = paintOverlay(tinyState(T));
    // Middle of source row 2 in latitude is 50.5N; find the output row whose
    // centre is nearest it, forwards: no inverse projection.
    const yTop = mercY(T.lat0);
    const yBottom = mercY(T.lat0 - T.height * T.pixel);
    const rowAt = (lat: number) =>
      Math.round(
        ((yTop - mercY(lat)) / (yTop - yBottom)) * overlay.height - 0.5,
      );
    const px = (col: number) => {
      const at = (rowAt(50.5) * overlay.width + col) * 4;
      return Array.from(overlay.data.slice(at, at + 4));
    };
    expect(
      px(0),
      "covered by neither: the raster says 0, the mask says no",
    ).toEqual(BARE);
    expect(px(2), "a loud value under a mask that says no").toEqual(BARE);
    expect(
      px(3),
      "covered, and the indicator measured normal conditions",
    ).toEqual([0x2c, 0xb8, 0x2a, 255]);
  });

  test("no source row is skipped: every row of the grid is the answer for at least one output row", () => {
    // Mutation: halve the output height — rows vanish and this fails.
    const overlay = paintOverlay(tinyState(T));
    const yTop = mercY(T.lat0);
    const yBottom = mercY(T.lat0 - T.height * T.pixel);
    const seen = new Set<number>();
    for (let r = 0; r < overlay.height; r++) {
      const y = yTop - ((r + 0.5) * (yTop - yBottom)) / overlay.height;
      for (let i = 0; i < T.height; i++) {
        if (
          y <= mercY(T.lat0 - i * T.pixel) &&
          y > mercY(T.lat0 - (i + 1) * T.pixel)
        )
          seen.add(i);
      }
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  test("the corners are the grid’s own edges, north-west first and clockwise", () => {
    // Mutation: swap the two southern corners — the picture is upside down.
    const overlay = paintOverlay(tinyState(T));
    expect(overlay.coordinates).toEqual([
      [10, 53],
      [22, 53],
      [22, 44],
      [10, 44],
    ]);
  });

  test("the shipped grid paints, in its own corners, with the shipped mask applied", () => {
    // 🔴 The real thing, once. Malta (35.9N, 14.4E) is inside the mask and
    // carries a class; the open Atlantic is not in the grid at all. The
    // oracle here is the file itself read by node.
    const s = droughtState(FILE, DOMAIN, after(12), nodeDecode);
    if (s.kind !== "current") throw new Error("expected current");
    const overlay = paintOverlay(s);
    expect(overlay.width).toBe(1280);
    expect(overlay.height).toBeGreaterThanOrEqual(889);
    expect(overlay.coordinates[0]).toEqual([-18.5, 71.5]);
    // Count what is tinted and what is not, against the mask itself.
    let drawn = 0;
    for (let i = 3; i < overlay.data.length; i += 4)
      if (overlay.data[i] > 0) drawn++;
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
    expect(
      shareGrid,
      "the mask is not empty and not everything",
    ).toBeGreaterThan(0.2);
    expect(shareGrid).toBeLessThan(0.9);
  });
});

// ── the picture, smoothed for showing (CAMP-530) ─────────────────────────

test.describe("paintSmoothOverlay", () => {
  // 20 × 13 cells of 1°: class 3 on the west half, class 1 on the east, ONE lone
  // class-5 cell inside the west half, and a masked-out patch in the east.
  const W = 20;
  const H = 13;
  const cells: number[] = [];
  const mask: number[] = [];
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      cells.push(c < 10 ? 3 : 1);
      mask.push(1);
    }
  cells[6 * W + 3] = 5;
  for (const [r, c] of [[3, 15], [3, 16], [4, 15], [4, 16]]) mask[r * W + c] = 0;
  const T2 = { width: W, height: H, lon0: 10, lat0: 53, pixel: 1, cells, mask };
  const px = (o: { data: Uint8ClampedArray; width: number }, r: number, c: number) =>
    Array.from(o.data.slice((r * o.width + c) * 4, (r * o.width + c) * 4 + 4));
  const F = SMOOTH_FACTOR;

  test("🔴 every pixel is a palette colour or bare: nothing between two classes, and the lone cell is gone", () => {
    // Mutation: in `paintSmoothOverlay` call `dropLoneCells` on nothing (use
    // `cls` for `tidy`) — the lone 5 is painted and this fails.
    const o = paintSmoothOverlay(tinyState(T2));
    const seen = new Set<string>();
    for (let r = 0; r < o.height; r++)
      for (let c = 0; c < o.width; c++) seen.add(px(o, r, c).join(","));
    expect([...seen].sort()).toEqual(
      [WANT[1], WANT[3], BARE].map((v) => v.join(",")).sort(),
    );
    expect(o.width).toBe(W * F);
  });

  test("away from any change the picture is the colour of the cell under it, as the plain oracle says", () => {
    // `expectedPixel` walks the SOURCE cells and the mercator rows forward.
    // Pixels two cells or more from a class change, from the lone cell, from
    // the masked patch and from the grid's edge are ONE cell's colour and the
    // oracle must agree. Mutation: shift the rows by half a cell — they
    // disagree and this fails.
    const o = paintSmoothOverlay(tinyState(T2));
    const yTop = mercY(T2.lat0);
    const yBottom = mercY(T2.lat0 - T2.height * T2.pixel);
    const wrong: string[] = [];
    let checked = 0;
    for (let r = 0; r < o.height; r++) {
      const y = yTop - ((r + 0.5) * (yTop - yBottom)) / o.height;
      let row = -1;
      for (let i = 0; i < H; i++)
        if (y <= mercY(T2.lat0 - i * T2.pixel) && y > mercY(T2.lat0 - (i + 1) * T2.pixel)) row = i;
      for (let c = 0; c < o.width; c++) {
        const col = Math.floor(c / F);
        const near = (a: number, b: number) =>
          Math.abs(row - a) <= 2 && Math.abs(col - b) <= 2;
        const calm =
          row >= 2 && row <= H - 3 && col >= 2 && col <= W - 3 &&
          Math.abs(col - 9.5) >= 2.5 && !near(6, 3) && !near(3, 15) && !near(3, 16) && !near(4, 15) && !near(4, 16);
        if (!calm) continue;
        checked++;
        const want = expectedPixel(T2, o.height, r, col);
        if (px(o, r, c).some((v, k) => v !== want[k]))
          wrong.push(`(${r},${c}) got ${px(o, r, c)} want ${want}`);
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(wrong.slice(0, 5), `${wrong.length} of ${checked} differ`).toEqual([]);
  });

  test("🔴 a lone cell the smoothing alone would keep is absorbed first", () => {
    // The vote at a cell's own centre gives the cell a quarter of the weight.
    // Ring it with four different classes round the sides and three equal
    // ones in the corners and no class tops a quarter, so the smoothing alone
    // KEEPS it — while three of its eight neighbours are one class, which is
    // what `dropLoneCells` goes by. Mutation: skip `dropLoneCells` in the
    // painter (use `cls` for `tidy`) — a class-5 pixel is drawn and this fails.
    //   1 2 1
    //   0 5 3     the 5 is alone; 1 holds three of the eight round it
    //   1 4 6
    const ring = [1, 2, 1, 0, 5, 3, 1, 4, 6];
    const n = 7;
    const cs: number[] = new Array(n * n).fill(2);
    for (let i = 0; i < 9; i++) cs[(2 + Math.floor(i / 3)) * n + 2 + (i % 3)] = ring[i];
    const o = paintSmoothOverlay(
      tinyState({ width: n, height: n, lon0: 10, lat0: 50, pixel: 1, cells: cs, mask: cs.map(() => 1) }),
    );
    let fives = 0;
    for (let r = 0; r < o.height; r++)
      for (let c = 0; c < o.width; c++)
        if (px(o, r, c).join(",") === WANT[5].join(",")) fives++;
    expect(fives).toBe(0);
  });

  test("🔴 the edge between two classes is where the source puts it, to the pixel, in both directions", () => {
    // A horizontal edge (rows 0-5 class 3, rows 6-12 class 1) and a vertical
    // one (columns 0-9 class 3, 10-19 class 1). The oracle projects the edge's
    // latitude FORWARD into mercator and asks which output row centre is the
    // first below it. Mutation: drop the half-cell from the rows' source
    // position in the painter — the edge moves one output row and this fails.
    const bands = (horizontal: boolean) => {
      const cs: number[] = [];
      for (let r = 0; r < H; r++)
        for (let c = 0; c < W; c++) cs.push((horizontal ? r < 6 : c < 10) ? 3 : 1);
      return paintSmoothOverlay(
        tinyState({ ...T2, cells: cs, mask: cs.map(() => 1) }),
      );
    };
    const horizontal = bands(true);
    const yTop = mercY(T2.lat0);
    const yBottom = mercY(T2.lat0 - T2.height * T2.pixel);
    const edge =
      ((yTop - mercY(T2.lat0 - 6)) / (yTop - yBottom)) * horizontal.height;
    const firstRow = Math.ceil(edge - 0.5);
    const col = 4 * F;
    expect(px(horizontal, firstRow - 1, col)).toEqual(WANT[3]);
    expect(px(horizontal, firstRow, col)).toEqual(WANT[1]);
    const vertical = bands(false);
    expect(px(vertical, 5 * F, 10 * F - 1)).toEqual(WANT[3]);
    expect(px(vertical, 5 * F, 10 * F)).toEqual(WANT[1]);
  });

  test("the masked patch is bare at its middle, and the lone cell's class is still what the data says", () => {
    const state = tinyState(T2);
    const before = Array.from(state.cdi);
    const o = paintSmoothOverlay(state);
    // 🔴 The picture is for the eye. The reading a campsite is given comes
    // from the arrays, and those are not touched.
    expect(Array.from(state.cdi)).toEqual(before);
    const lat = T2.lat0 - 6.5;
    const lone = readingAt(state, lat, T2.lon0 + 3.5);
    expect(lone.known && lone.value).toBe(5);
    const patch = readingAt(state, T2.lat0 - 3.9, T2.lon0 + 15.9);
    expect(patch.known).toBe(false);
    // Middle of the 2 × 2 masked patch (rows 3-4, cols 15-16) in output pixels:
    const yTop = mercY(T2.lat0);
    const yBottom = mercY(T2.lat0 - T2.height * T2.pixel);
    const r = Math.round(((yTop - mercY(T2.lat0 - 4)) / (yTop - yBottom)) * o.height);
    expect(px(o, r, 16 * F)).toEqual(BARE);
  });

  test("🔴 the colours come from the table it is given, with the factor it is given", () => {
    // Mutation: hard-code a colour in the painter — the swapped table does not show and this fails.
    const swapped = {
      ...DROUGHT_COLOURS,
      3: { hex: "#112233", alpha: 200 },
      1: { hex: "#445566", alpha: 255 },
    };
    const o = paintSmoothOverlay(tinyState(T2), swapped, 3);
    expect(o.width).toBe(W * 3);
    const seen = new Set<string>();
    for (let r = 0; r < o.height; r++)
      for (let c = 0; c < o.width; c++) seen.add(px(o, r, c).join(","));
    expect([...seen].sort()).toEqual(
      ["17,34,51,200", "68,85,102,255", "0,0,0,0"].sort(),
    );
  });

  test("the shipped grid: the picture holds the seven classes' colours and bare, and nothing else", () => {
    // Read from the raw arrays, not from `readingAt`: which classes the grid
    // has, and so how many colours the picture may use.
    const s = droughtState(FILE, DOMAIN, after(12), nodeDecode);
    if (s.kind !== "current") throw new Error("expected current");
    const present = new Set<number>();
    for (let i = 0; i < s.cdi.length; i++)
      if ((s.domain[i >> 3] >> (i & 7)) & 1) present.add(s.cdi[i]);
    expect(present.size, "every class the file describes is in the grid").toBe(7);
    const o = paintSmoothOverlay(s);
    expect(o.width).toBe(1280 * F);
    expect(o.coordinates[0]).toEqual([-18.5, 71.5]);
    const seen = new Set<number>();
    const u = new Uint32Array(o.data.buffer, o.data.byteOffset, o.data.length / 4);
    for (const v of u) seen.add(v);
    const want = new Set<number>([0]);
    for (const k of present) {
      const [r, g, b, a] = WANT[k];
      want.add(new Uint32Array(Uint8Array.of(r, g, b, a).buffer)[0]);
    }
    expect([...seen].sort()).toEqual([...want].sort());
  });

  test("the panel says the picture is smoothed and that a campsite's class is read from the data", () => {
    const html = renderComponent(DroughtLayerPanel, { state: tinyState(T2) });
    const text = visibleText(html);
    expect(text).toContain("smoothed for display");
    expect(text).toContain("read from the Copernicus data at its own location");
  });
});

// ── the key to the colours ───────────────────────────────────────────────

test.describe("the legend", () => {
  const meta = FILE.meta;

  test("🔴 every class the shipped file describes has a colour, or it would not be drawn", () => {
    // Mutation: delete `2:` from DROUGHT_COLOURS — fails. Without it every
    // class-2 cell was bare, which is "dry ground" drawn as "outside".
    for (const c of meta.classes as { value: number }[]) {
      expect(
        DROUGHT_COLOURS[c.value],
        `class ${c.value} has no colour`,
      ).toBeTruthy();
    }
  });

  test("the layer opacity and the colours are what the map is measured against, once", () => {
    // 🔴 Written out as literals, the only place they are. `check-map-palette.mjs`
    // measures every drought class at alpha × this opacity against the
    // basemaps, so changing either number is a decision that changes what a
    // reader can tell apart — it should cost an edit here, and a re-run of
    // that check, not nothing.
    expect(DROUGHT_RASTER_OPACITY).toBe(0.5);
    expect(effectiveOpacity(255)).toBeCloseTo(0.5, 10);
    expect(effectiveOpacity(90)).toBeCloseTo((90 / 255) * 0.5, 10);
    expect(effectiveOpacity(0)).toBe(0);
  });

  /**
   * What the legend PRINTS, read off the HTML a reader is served: for each
   * row, the red, green, blue and alpha of the swatch's CSS colour, and the
   * words beside it. A row with no `data-swatch` is the dashed "not coloured"
   * one and has no colour to read.
   */
  function legendOf(
    html: string,
  ): { rgba: [number, number, number, number] | null; label: string }[] {
    const ul = html.match(
      /<ul[^>]*data-testid="drought-legend"[^>]*>([\s\S]*?)<\/ul>/,
    );
    if (!ul) throw new Error("the legend is not in the panel");
    return [...ul[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(([, li]) => {
      const m = li.match(
        /data-swatch=""[^>]*style="[^"]*background-color:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/,
      );
      // 🔴 Було `li.replace(/<[^>]*>/g, '')` — зрізання тегів регуляркою,
      // яке CodeQL назвав `js/incomplete-multi-character-sanitization`
      // (high). Регулярка не знає, де елемент ЗАКІНЧУЄТЬСЯ, і не бачить
      // різниці між прихованим і видимим: підпис легенди, схований під
      // `hidden` чи `sr-only`, вона прочитала б як написаний на екрані.
      // Для перевірки «що легенда ПРИНТУЄ читачеві» це хибність саме того
      // ґатунку, якого перевірка існує, щоб не було. `visibleText` обходить
      // теги стеком — той самий модуль, який уже читають правові сторінки.
      const label = visibleText(li).replace(/\s+/g, " ").trim();
      return {
        rgba: m
          ? ([Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as [
              number,
              number,
              number,
              number,
            ])
          : null,
        label,
      };
    });
  }

  /** The panel the map shows under the layer, as the HTML a reader is served. */
  function panelHtml(): string {
    const state = tinyState({
      width: 7,
      height: 1,
      lon0: 10,
      lat0: 50,
      pixel: 1,
      cells: [0, 1, 2, 3, 4, 5, 6],
      mask: [1, 1, 1, 1, 1, 1, 1],
    });
    return renderComponent(DroughtLayerPanel, { state });
  }

  /** The pixel `paintOverlay` writes for each class, as the strength a reader sees: [r, g, b, alpha × raster-opacity]. */
  function pixelsPerClass(
    colours?: Readonly<Record<number, { hex: string; alpha: number }>>,
  ): Record<number, [number, number, number, number]> {
    const state = tinyState({
      width: 7,
      height: 1,
      lon0: 10,
      lat0: 50,
      pixel: 1,
      cells: [0, 1, 2, 3, 4, 5, 6],
      mask: [1, 1, 1, 1, 1, 1, 1],
    });
    const overlay = paintOverlay(state, colours);
    const r = Math.floor(overlay.height / 2);
    const out: Record<number, [number, number, number, number]> = {};
    for (let c = 0; c < 7; c++) {
      const at = (r * overlay.width + c) * 4;
      const d = overlay.data;
      out[c] = [
        d[at],
        d[at + 1],
        d[at + 2],
        (d[at + 3] / 255) * DROUGHT_RASTER_OPACITY,
      ];
    }
    return out;
  }

  test("🔴 the legend and the pixels read one table: the same colour AND the same strength", () => {
    // The swatch is read off the rendered panel; the pixel is what
    // `paintOverlay` writes into the canvas. For every class the swatch's
    // colour must be the pixel's, and its alpha must be the pixel's alpha at
    // the layer's `raster-opacity` — what reaches the screen, not what the
    // table says.
    //
    // 🔴 THE FIRST VERSION OF THIS TEST COMPARED HEX AND NOTHING ELSE, and
    // that is why it stayed green over a swatch painted at full strength
    // for a class drawn at 22.9%: it never read the alpha, so it could not
    // see that the key and the picture had come apart.
    //
    // Mutation: paint the swatch with `row.hex` — fails on the alpha.
    // Mutation: `opacity = style.alpha / 255` in `droughtLegend` (the
    // raster-opacity left out) — fails on every class.
    // Mutation: give the legend its own hex for one class — fails on the colour.
    const rows = legendOf(panelHtml());
    const pixel = pixelsPerClass();
    const want = FILE.meta.classes as { value: number; label: string }[];
    for (const c of want) {
      const row = rows.find((r) => r.rgba && r.label.includes(c.label));
      expect(
        row,
        `no legend row for class ${c.value} (${c.label})`,
      ).toBeTruthy();
      const [r, g, b, a] = row!.rgba!;
      const [pr, pg, pb, pa] = pixel[c.value];
      expect(
        [r, g, b],
        `class ${c.value}: the swatch colour is not the pixel colour`,
      ).toEqual([pr, pg, pb]);
      expect(
        a,
        `class ${c.value}: the swatch is drawn at ${a}, the map draws it at ${pa}`,
      ).toBeCloseTo(pa, 3);
    }
  });

  test("🔴 …and with a class whose own alpha is not 255, which no shipped class has today", () => {
    // Today every class is drawn at alpha 255, so the test above cannot tell
    // "uses the table's alpha" from "ignores it". A synthetic table can:
    // class 0 at 90, class 1 at 128, the rest at 255. The expected strengths
    // are written out here, not worked out by the code under test.
    const table = {
      ...DROUGHT_COLOURS,
      0: { hex: "#336699", alpha: 90 },
      1: { hex: "#CC9933", alpha: 128 },
    };
    // Mutation: ignore the alpha in `droughtLegend` — class 0 reads 0.5
    // where the pixel is 0.1765, and this fails.
    const rows = droughtLegend(FILE.meta, table);
    const pixel = pixelsPerClass(table);
    const byLabel = (label: string) =>
      rows.find((r) => r.label.includes(label))!;
    expect(byLabel("no drought").opacity).toBeCloseTo(0.1765, 3);
    expect(byLabel("less rain than normal").opacity).toBeCloseTo(0.251, 3);
    expect(byLabel("dry ground").opacity).toBeCloseTo(0.5, 10);
    expect(byLabel("no drought").swatch).toBe("rgba(51, 102, 153, 0.1765)");
    expect(pixel[0][3]).toBeCloseTo(0.1765, 3);
    expect(pixel[1][3]).toBeCloseTo(0.251, 3);
    expect(pixel[2][3]).toBeCloseTo(0.5, 10);
  });

  test("the dashed row says what bare means, and carries no colour", () => {
    // "Not coloured" has no swatch to be wrong about. What it must not be is
    // a coloured row: bare and "no drought" are different things.
    const rows = legendOf(panelHtml());
    const bare = rows.filter((r) => r.rgba === null);
    expect(bare.map((r) => r.label)).toEqual([
      "not coloured: outside the area the indicator covers",
    ]);
  });

  test("🔴 the key a reader is served has seven coloured rows, one per class, in the colours of the source", () => {
    // CAMP-315: EDO draws the three recovery classes in three colours, so the key
    // prints three rows where it used to print one. Read off the HTML the page
    // serves, against the literal table above — not off `droughtLegend`, whose
    // merging is the thing under test.
    //
    // Mutation: give two recovery classes one colour in `DROUGHT_COLOURS` — the
    // key merges them into one row and this fails on the count. Mutation: change
    // any class's hex — fails on that row's colour.
    const rows = legendOf(panelHtml()).filter((r) => r.rgba !== null);
    const want = (meta.classes as { value: number; label: string }[])
      .slice()
      .sort((a, b) => a.value - b.value);
    expect(
      rows.map((r) => r.label),
      "one row per class, in class order, each with its own words",
    ).toEqual(want.map((c) => c.label));
    want.forEach((c, i) => {
      const [r, g, b, a] = rows[i].rgba!;
      expect([r, g, b], `class ${c.value} (${c.label})`).toEqual(
        WANT[c.value].slice(0, 3),
      );
      expect(a, `class ${c.value} is drawn at the layer's opacity`).toBeCloseTo(
        0.5,
        3,
      );
    });
  });

  test("classes drawn in one colour are still one row, not identical swatches (the merging, with a table that has it)", () => {
    // The key MERGES classes drawn in the same hex at the same alpha. The shipped
    // table has none now (above), so the mechanism is tested with one that does.
    const merged = {
      ...DROUGHT_COLOURS,
      5: DROUGHT_COLOURS[4],
      6: DROUGHT_COLOURS[4],
    };
    const rows = droughtLegend(meta, merged);
    expect(rows.length).toBe(5);
    expect(rows[rows.length - 1].label).toBe(
      "recovered, soil recovering, vegetation recovering",
    );
  });

  test("a class with no colour is left out, not drawn as a guess", () => {
    const rows = droughtLegend({
      ...meta,
      classes: [
        ...meta.classes,
        { value: 42, label: "unheard of", detail: "x" },
      ],
    });
    expect(rows.some((r) => r.label.includes("unheard of"))).toBe(false);
  });
});
