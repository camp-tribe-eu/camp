// CAMP-530 — the drought picture, smoothed FOR SHOWING, and nothing else.
//
// 🔴 A LEAF MODULE ON PURPOSE, like `drought-colours.ts`: it imports nothing and
// knows no colour, no mask and no map. It works on grids of CLASS CODES
// (`NONE` = the indicator does not look here), so a test can feed it five
// cells and read the answer, and so nothing in here can reach the campsite
// page's reading: that comes from `readingAt` on the raw arrays and never
// from a picture.
//
// Two steps, and each one only ever chooses between classes that are
// already there. No class is invented and no colour is mixed.
//
//  1. `dropLoneCells` — a cell with no neighbour of its own class among the
//     eight around it is salt-and-pepper, not a feature the source's 5 km
//     resolution can show. It joins the class most of its neighbours have.
//  2. `smoothRaster` — every output pixel takes the class that wins a
//     bilinear vote of the four source cells around it (argmax of the
//     bilinearly interpolated class masks). The boundary between two
//     classes becomes a curve and each pixel is still ONE class.

/** "Not covered" (the mask says the indicator does not look here, or no colour for the value). */
export const NONE = 255;

/**
 * How many output pixels per source cell, on each axis.
 *
 * 🔴 TWO, AND NOT THE FOUR THE CARD ASKED FOR. The picture is one canvas
 * over all of Europe: 1280 × 1331 cells (mercator rows, see `paintOverlay`).
 * ×4 is 5120 × 5324 = 27.3 M pixels, 109 MB of RGBA — and 5120 is wider than
 * the 4096 texture a phone's GPU may allow, so MapLibre could not upload it
 * at all. ×2 is 2560 × 2662 = 6.8 M pixels, 27 MB, inside a 4096 texture.
 */
export const SMOOTH_FACTOR = 2;

/** Cells of a data class with no same-class neighbour among the eight around them. */
export function loneCount(cls: Uint8Array, width: number, height: number): number {
  let n = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const k = cls[r * width + c];
      if (k !== NONE && !hasSameNeighbour(cls, width, height, r, c, k)) n++;
    }
  }
  return n;
}

function hasSameNeighbour(
  cls: Uint8Array,
  width: number,
  height: number,
  r: number,
  c: number,
  k: number,
): boolean {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= height || cc >= width) continue;
      if (cls[rr * width + cc] === k) return true;
    }
  }
  return false;
}

/**
 * Lone cells take the class most of their neighbours have.
 *
 * Only DATA neighbours vote (`NONE` is not a class), and a cell is changed
 * only when one class wins strictly and with at least three votes: a cell
 * on a coast with one data neighbour, or a four-four tie, stays as the
 * source has it rather than be decided on thin evidence. The vote is taken on
 * the ORIGINAL grid, so the answer does not depend on the order of the scan.
 */
export function dropLoneCells(
  cls: Uint8Array,
  width: number,
  height: number,
): { cls: Uint8Array; changed: number } {
  const out = cls.slice();
  let changed = 0;
  const votes = new Map<number, number>();
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const k = cls[r * width + c];
      if (k === NONE || hasSameNeighbour(cls, width, height, r, c, k)) continue;
      votes.clear();
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= height || cc >= width) continue;
          const o = cls[rr * width + cc];
          if (o !== NONE) votes.set(o, (votes.get(o) ?? 0) + 1);
        }
      }
      let best = NONE;
      let bestN = 0;
      let tied = false;
      for (const [v, n] of votes) {
        if (n > bestN) {
          best = v;
          bestN = n;
          tied = false;
        } else if (n === bestN) tied = true;
      }
      if (best !== NONE && !tied && bestN >= 3) {
        out[r * width + c] = best;
        changed++;
      }
    }
  }
  return { cls: out, changed };
}

/**
 * The blur that rounds the boundaries BETWEEN CLASSES, as the weights of a
 * cell and its neighbours along one axis (they sum to 1). [1 2 1] / 4 is the
 * narrowest that rounds a corner. Measured on the shipped grid, a five-tap
 * [1 4 6 4 1] / 16 rounds more and also erases real features: a cluster of
 * three classes near Bihać and the strip of Rab, which is why it is not used.
 */
export const SMOOTH_KERNEL: readonly number[] = [0.25, 0.5, 0.25];

/**
 * The class of every output pixel: the winner of a smoothed vote.
 *
 * `srcRow[R]` is where output row R's centre falls in source-row units, with
 * a cell's centre at its integer (so the caller owns the projection: mercator
 * in the page, a straight line in a test). Columns are linear: output column
 * X's centre is `(X + 0.5) / factor - 0.5` source columns.
 *
 * Two questions, answered apart on purpose.
 *
 *  · COVERED OR NOT: the plain bilinear vote of the four cells around the
 *    point, `NONE` against the rest. 🔴 Not blurred further: a blur wide
 *    enough to round a coastline would also wipe out a strip of land one cell
 *    wide (Rab, Lošinj), and a picture that says "the indicator does not look
 *    here" where it does is the Malta mistake the mask exists to prevent.
 *  · WHICH CLASS, where covered: each class is a 0/1 mask over the source
 *    cells, blurred with `kernel` and read by bilinear interpolation — one
 *    separable weighting of the cells around the point (the bilinear pair
 *    convolved with the kernel), so no blurred grid is ever built. Only data
 *    cells vote. The class with the largest summed weight wins.
 *
 * One class per pixel, never a mix; the boundary between two classes runs
 * where their weights are equal: a curve, not the edge of a block.
 */
export function smoothRaster(
  cls: Uint8Array,
  width: number,
  height: number,
  factor: number,
  srcRow: Float64Array,
  kernel: readonly number[] = SMOOTH_KERNEL,
): Uint8Array {
  const outW = width * factor;
  const outH = srcRow.length;
  const out = new Uint8Array(outW * outH);
  const reach = (kernel.length - 1) / 2;
  const taps = kernel.length + 1;
  const first = -reach; // offset of the first tap from floor(position)

  /** The `taps` weights along one axis for a fractional position `t` in [0, 1). */
  const axis = (t: number, into: Float64Array, at: number) => {
    for (let i = 0; i < taps; i++) {
      const a = i < kernel.length ? kernel[i] * (1 - t) : 0;
      const b = i > 0 ? kernel[i - 1] * t : 0;
      into[at + i] = a + b;
    }
  };

  // The grid padded with NONE on every side by the footprint, so the loops
  // below never test a bound; and, for every cell, how many equal cells
  // follow it to the right (a run), so that "this whole footprint is one
  // class" — the answer for most of the picture — costs `taps` reads.
  const pad = taps;
  const pw = width + 2 * pad;
  const ph = height + 2 * pad;
  const grid = new Uint8Array(pw * ph).fill(NONE);
  for (let r = 0; r < height; r++) grid.set(cls.subarray(r * width, (r + 1) * width), (r + pad) * pw + pad);
  const run = new Uint16Array(pw * ph);
  for (let r = 0; r < ph; r++) {
    run[r * pw + pw - 1] = 1;
    for (let c = pw - 2; c >= 0; c--) {
      run[r * pw + c] = grid[r * pw + c] === grid[r * pw + c + 1] ? run[r * pw + c + 1] + 1 : 1;
    }
  }

  const c0 = new Int32Array(outW);
  const uCol = new Float64Array(outW);
  const wx = new Float64Array(outW * taps);
  for (let X = 0; X < outW; X++) {
    const fc = (X + 0.5) / factor - 0.5;
    const f = Math.floor(fc);
    c0[X] = f + first + pad;
    uCol[X] = fc - f;
    axis(fc - f, wx, X * taps);
  }
  const wy = new Float64Array(taps);
  const cand = new Uint8Array(taps * taps);
  const score = new Float64Array(taps * taps);

  for (let R = 0; R < outH; R++) {
    const fr = srcRow[R];
    const rf = Math.floor(fr);
    const r0 = rf + first + pad;
    const tRow = fr - rf;
    axis(tRow, wy, 0);
    for (let X = 0; X < outW; X++) {
      const c = c0[X];
      const k = grid[r0 * pw + c];
      let uniform = true;
      for (let i = 0; i < taps; i++) {
        const at = (r0 + i) * pw + c;
        if (run[at] < taps || grid[at] !== k) {
          uniform = false;
          break;
        }
      }
      if (uniform) {
        out[R * outW + X] = k;
        continue;
      }
      // Covered? The four cells around the point, bilinear, NONE against the rest.
      const u = uCol[X];
      const o = reach * pw + reach;
      const g = r0 * pw + c + o;
      let noneW = 0;
      if (grid[g] === NONE) noneW += (1 - tRow) * (1 - u);
      if (grid[g + 1] === NONE) noneW += (1 - tRow) * u;
      if (grid[g + pw] === NONE) noneW += tRow * (1 - u);
      if (grid[g + pw + 1] === NONE) noneW += tRow * u;
      if (noneW > 0.5 + 1e-12) {
        out[R * outW + X] = NONE;
        continue;
      }
      // Which class? The few data classes in the footprint and the weight each holds.
      let n = 0;
      for (let i = 0; i < taps; i++) {
        const at = (r0 + i) * pw + c;
        const wi = wy[i];
        for (let j = 0; j < taps; j++) {
          const v = grid[at + j];
          if (v === NONE) continue;
          const w = wi * wx[X * taps + j];
          let m = 0;
          while (m < n && cand[m] !== v) m++;
          if (m === n) {
            cand[n] = v;
            score[n] = 0;
            n++;
          }
          score[m] += w;
        }
      }
      let best = NONE;
      let bestW = -1;
      for (let m = 0; m < n; m++) {
        // A tie goes to the earlier cell: the same pixel every run.
        if (score[m] > bestW + 1e-12) {
          bestW = score[m];
          best = cand[m];
        }
      }
      out[R * outW + X] = best;
    }
  }
  return out;
}

/**
 * The last blur, on the finished picture: how wide, as weights along one axis.
 * [1 4 6 4 1] / 16 is a radius of about one pixel of the ×2 grid (σ = 1 px).
 */
export const EDGE_BLUR: readonly number[] = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];

/**
 * CAMP-530 — class codes to RGBA, with the edges between classes blurred.
 *
 * 🔴 BLURRED IN PREMULTIPLIED ALPHA, so a class beside bare ground fades to
 * transparent in its OWN colour and not through grey. A pixel whose whole
 * neighbourhood is one class (or all bare) is written as that class's exact
 * colour — mixing happens only in the band at a boundary, `kernel.length`
 * pixels wide. Done here, in plain arrays, rather than with `ctx.filter`:
 * Safari's canvas has no `filter`, and a picture that is smooth in two
 * browsers and blocky in the third is worse than one that is the same in all.
 * Outside the picture counts as the pixel's own edge value.
 */
export function paintBlurred(
  picked: Uint8Array,
  width: number,
  height: number,
  palette: ReadonlyMap<number, readonly [number, number, number, number]>,
  kernel: readonly number[] = EDGE_BLUR,
): Uint8ClampedArray {
  const reach = (kernel.length - 1) / 2;
  const out = new Uint8ClampedArray(width * height * 4);
  // The palette as a flat table by class code: a Map lookup per tap is the
  // slow part of a 6.8-million-pixel picture.
  const table = new Uint8Array(256 * 4);
  const has = new Uint8Array(256);
  for (const [k, v] of palette) {
    if (k < 0 || k > 255) continue;
    has[k] = 1;
    table.set(v as ArrayLike<number>, k * 4);
  }
  // 🔴 NO FULL-SIZE FLAG ARRAYS. "Is there a class change within `reach + 1`
  // pixels of this one?" is answered a row at a time: `hor` holds the answer
  // along x for the 2·win+1 rows around the row being painted (a ring, built
  // as the rows come), and `nearRow` is their OR. A picture this size is
  // 6.8 M pixels, and each full-size byte array is 6.8 MB on a phone that is
  // also holding the 27 MB result.
  const win = reach + 1;
  const ring = 2 * win + 1;
  const hor = Array.from({ length: ring }, () => new Uint8Array(width));
  const horRow = (r: number): Uint8Array => {
    const row = hor[r % ring];
    // bad[x]: the class changes between (x, r) and the pixel to its right or below.
    const base = r * width;
    count[0] = 0;
    for (let x = 0; x < width; x++) {
      const i = base + x;
      const bad = (x + 1 < width && picked[i] !== picked[i + 1]) || (r + 1 < height && picked[i] !== picked[i + width]);
      count[x + 1] = count[x] + (bad ? 1 : 0);
    }
    for (let x = 0; x < width; x++) {
      row[x] = count[Math.min(width, x + win + 1)] - count[Math.max(0, x - win)] > 0 ? 1 : 0;
    }
    return row;
  };
  const count = new Int32Array(width + 1);
  const nearRow = new Uint8Array(width);
  let built = -1; // the last row whose `hor` has been built
  for (let y = 0; y < height; y++) {
    const lastNeeded = Math.min(height - 1, y + win);
    while (built < lastNeeded) horRow(++built);
    nearRow.fill(0);
    for (let r = Math.max(0, y - win); r <= lastNeeded; r++) {
      const row = hor[r % ring];
      for (let x = 0; x < width; x++) nearRow[x] |= row[x];
    }
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!nearRow[x]) {
        const k = picked[i];
        if (has[k]) {
          out[i * 4] = table[k * 4];
          out[i * 4 + 1] = table[k * 4 + 1];
          out[i * 4 + 2] = table[k * 4 + 2];
          out[i * 4 + 3] = table[k * 4 + 3];
        }
        continue;
      }
      let sa = 0;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let j = 0; j < kernel.length; j++) {
        const yy = Math.min(height - 1, Math.max(0, y + j - reach));
        for (let k = 0; k < kernel.length; k++) {
          const xx = Math.min(width - 1, Math.max(0, x + k - reach));
          const q = picked[yy * width + xx];
          if (!has[q]) continue;
          const w = kernel[j] * kernel[k] * table[q * 4 + 3];
          sa += w;
          sr += w * table[q * 4];
          sg += w * table[q * 4 + 1];
          sb += w * table[q * 4 + 2];
        }
      }
      if (sa > 0) {
        out[i * 4] = sr / sa;
        out[i * 4 + 1] = sg / sa;
        out[i * 4 + 2] = sb / sa;
        out[i * 4 + 3] = sa;
      }
    }
  }
  return out;
}
