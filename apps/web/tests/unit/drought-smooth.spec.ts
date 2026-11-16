import { expect, test } from "@playwright/test";
import {
  NONE,
  SMOOTH_FACTOR,
  dropLoneCells,
  loneCount,
  smoothRaster,
} from "@/lib/drought-smooth";

// CAMP-530 — the drought picture smoothed for showing. These work on grids of
// class codes, so a failure names a cell and not a colour.

const grid = (rows: string[]): { cls: Uint8Array; w: number; h: number } => {
  // '.' is NONE, a digit is that class.
  const h = rows.length;
  const w = rows[0].length;
  const cls = new Uint8Array(w * h);
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      cls[r * w + c] = ch === "." ? NONE : Number(ch);
    }),
  );
  return { cls, w, h };
};

/** Output row R's centre in source rows, a straight line (no mercator). */
const straight = (h: number, factor: number) => {
  const rows = new Float64Array(h * factor);
  for (let R = 0; R < rows.length; R++) rows[R] = (R + 0.5) / factor - 0.5;
  return rows;
};

test.describe("dropLoneCells", () => {
  test("🔴 a cell with no neighbour of its class is absorbed by the class around it", () => {
    // Mutation: make `dropLoneCells` return its input — the lone 2 stays and this fails.
    const { cls, w, h } = grid(["11111", "11111", "11211", "11111", "11111"]);
    expect(loneCount(cls, w, h)).toBe(1);
    const out = dropLoneCells(cls, w, h);
    expect(out.cls[2 * w + 2]).toBe(1);
    expect(out.changed).toBe(1);
    expect(loneCount(out.cls, w, h)).toBe(0);
  });

  test("a pair is not lone, and the input is not modified", () => {
    const { cls, w, h } = grid(["11111", "11221", "11111"]);
    const before = cls.slice();
    const out = dropLoneCells(cls, w, h);
    expect(out.changed).toBe(0);
    expect(Array.from(out.cls)).toEqual(Array.from(before));
    expect(Array.from(cls)).toEqual(Array.from(before));
  });

  test("🔴 no class is invented: a tie or thin evidence leaves the cell alone, and what changes becomes a class that was there", () => {
    // Four 1s and four 3s round the 2: a tie. One data neighbour and sea: thin evidence.
    const tie = grid(["131", "323", "131"]);
    expect(dropLoneCells(tie.cls, tie.w, tie.h).changed).toBe(0);
    const thin = grid(["..1", ".2.", "1.."]);
    expect(dropLoneCells(thin.cls, thin.w, thin.h).changed).toBe(0);
    const mixed = grid(["11333", "11333", "11233", "11333"]);
    const out = dropLoneCells(mixed.cls, mixed.w, mixed.h);
    expect(out.changed).toBe(1);
    expect(new Set(out.cls)).toEqual(new Set([1, 3]));
  });

  test("the sea is not a class: it neither votes nor is overwritten", () => {
    // The 1 in the middle has no same-class neighbour and one data neighbour only.
    const { cls, w, h } = grid(["....1", "..1.1", "....1"]);
    const out = dropLoneCells(cls, w, h);
    expect(Array.from(out.cls)).toEqual(Array.from(cls));
    expect(loneCount(cls, w, h)).toBe(1);
  });
});

test.describe("smoothRaster", () => {
  const F = 4;

  /** For each output row, the first column whose class is `of`. */
  const edgeColumns = (out: Uint8Array, outW: number, rows: number, of: number) => {
    const xs: number[] = [];
    for (let R = 0; R < rows; R++) {
      let x = -1;
      for (let X = 0; X < outW; X++) if (out[R * outW + X] === of) { x = X; break; }
      xs.push(x);
    }
    return xs;
  };

  /** A 45-degree edge: class 1 up-right of the diagonal, class 2 below-left. */
  const diagonal = (n: number) => {
    const rows: string[] = [];
    for (let r = 0; r < n; r++) {
      let line = "";
      for (let c = 0; c < n; c++) line += c >= r ? "1" : "2";
      rows.push(line);
    }
    return grid(rows);
  };

  const maxStep = (xs: number[], from: number, to: number) => {
    let worst = 0;
    for (let i = from + 1; i < to; i++) worst = Math.max(worst, Math.abs(xs[i] - xs[i - 1]));
    return worst;
  };

  test("🔴 the edge between two classes is a line, not a staircase", () => {
    // Nearest-neighbour moves the edge F columns in one row, then holds it for
    // F rows; the vote moves it one or two. Counted over the rows away from the
    // grid's own border.
    // Mutation: replace the vote with `cls[round(row)][round(col)]` — the edge
    // steps by F and this fails.
    const { cls, w, h } = diagonal(16);
    const out = smoothRaster(cls, w, h, F, straight(h, F));
    const xs = edgeColumns(out, w * F, h * F, 1);
    expect(maxStep(xs, 3 * F, 13 * F)).toBeLessThanOrEqual(F / 2);
    // …and the same edge drawn as blocks, for the count the test is measured against.
    const blocks = new Uint8Array(w * F * h * F);
    for (let R = 0; R < h * F; R++)
      for (let X = 0; X < w * F; X++)
        blocks[R * w * F + X] = cls[Math.floor(R / F) * w + Math.floor(X / F)];
    const bx = edgeColumns(blocks, w * F, h * F, 1);
    expect(maxStep(bx, 3 * F, 13 * F)).toBe(F);
  });

  test("🔴 every pixel is a class the input has, or bare, and never anything between", () => {
    const { cls, w, h } = grid([
      "11122..33",
      "11222..33",
      "11122.333",
      "1.122.333",
      "11222.333",
      "11122.333",
    ]);
    const out = smoothRaster(cls, w, h, F, straight(h, F));
    expect(new Set(out)).toEqual(new Set([1, 2, 3, NONE]));
    expect(out.length).toBe(w * F * h * F);
  });

  test("a region three cells wide keeps its class at its middle, and a ring of its own class is all that surrounds it", () => {
    const { cls, w, h } = grid([
      "1111111",
      "1111111",
      "1133311",
      "1133311",
      "1133311",
      "1111111",
      "1111111",
    ]);
    const out = smoothRaster(cls, w, h, F, straight(h, F));
    const at = (r: number, c: number) => out[Math.floor(r * F) * w * F + Math.floor(c * F)];
    expect(at(3.5, 3.5)).toBe(3);
    expect(at(0.5, 0.5)).toBe(1);
    expect(new Set(out)).toEqual(new Set([1, 3, NONE]));
  });

  test("🔴 the sea edge stays where the cells put it: a strip one cell wide is not wiped out", () => {
    // Rab and Lošinj are one cell wide. A blur wide enough to round a coast
    // would turn this strip bare. Mutation: take the covered-or-not vote from
    // the blurred weights instead of the four cells — the strip goes bare and
    // this fails.
    const { cls, w, h } = grid([".....", "..1..", "..1..", "..1..", "....."]);
    const out = smoothRaster(cls, w, h, F, straight(h, F));
    // The middle of the middle cell: output pixel (2 * F + F / 2, 2 * F + F / 2).
    const mid = (2 * F + F / 2) * w * F + (2 * F + F / 2);
    expect(out[mid]).toBe(1);
    // And the strip is drawn along its whole length, not only at its centre.
    let drawn = 0;
    for (let R = 1 * F; R < 4 * F; R++) if (out[R * w * F + 2 * F + F / 2] === 1) drawn++;
    expect(drawn).toBeGreaterThanOrEqual(3 * F - 2);
  });

  test("the factor the page uses fits a phone’s texture: 4096 across the whole of Europe's 1280 × 1331 cells", () => {
    // Not a measurement of a phone: the arithmetic the factor was chosen by.
    expect(1280 * SMOOTH_FACTOR).toBeLessThanOrEqual(4096);
    expect(1331 * SMOOTH_FACTOR).toBeLessThanOrEqual(4096);
  });
});
