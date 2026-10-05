#!/usr/bin/env node
//
// What a slice of a PMTiles archive actually weighs.
//
//   node scripts/tiles/measure-pmtiles.mjs [--self-test]
//   node scripts/tiles/measure-pmtiles.mjs --maxzoom=12 [--bbox=W,S,E,N] [--url=…]
//
// 🔴 CAMP-29 CARRIES A NUMBER NOBODY MEASURED. It says Europe at z15 is
// "≈ 45-55 GB (an estimate, no official figure exists)" and z12 is
// "≈ 5.5-7 GB", and then asks for the size to be MEASURED rather than
// assumed — because the whole $0-or-$0.60 decision hangs on it.
//
// It can be measured without downloading anything but directories. A
// PMTiles archive stores, ahead of the tile data, a tree of directories
// holding every tile's offset and length. Range requests over that tree
// give the exact byte count of any bounding box at any zoom. The planet
// build is 138.6 GB; the directories for the zooms we care about are a
// few tens of megabytes.
//
// MEASURED, 2026-10-05, against build.protomaps.com/20261004.pmtiles
// (138.2 GB, zooms 0..15) — reproduce with the commands above:
//
//   EU-27, maxzoom 12   5.56 GB   485 067 addressed, 288 347 distinct
//   EU-27, maxzoom 6    0.01 GB       157 addressed,     147 distinct
//
// The card estimated "z12 ≈ 5.5-7 GB". The measurement lands at the very
// bottom of that range, which is the answer that matters: 5.56 GB fits
// inside R2's free 10 GB, so the storage bill at maxzoom 12 is nothing.
// Reading the directories to find that out cost 10.5 MB and 68 seconds.
//
// A tile checked end to end, 12/2200/1343 (Berlin): 138 584 bytes over
// the wire, 198 436 after gunzip, first byte 0x1a — a real vector tile,
// not a 206 full of the wrong bytes.
//
// Tile CONTENTS are deduplicated — the planet has 1 431 655 765
// addressed tiles but only 136 218 068 distinct contents — so bytes are
// counted per distinct (offset, length), never per address. Counting
// per address would inflate the answer several times over, which is
// precisely the kind of number this card refuses to accept.

import { gunzipSync } from 'node:zlib';

const PLANET = 'https://build.protomaps.com/20261004.pmtiles';

// The EU-27 bounding box this project works in (CAMP-124), with the
// Canaries and Madeira left out exactly as `CROP.south` does elsewhere.
export const EU = { west: -10.6, south: 34.5, east: 31.6, north: 71.2 };

// ---------------------------------------------------------------- header

export function readHeader(buf) {
  if (buf.subarray(0, 7).toString() !== 'PMTiles') throw new Error('not a PMTiles archive');
  if (buf[7] !== 3) throw new Error(`PMTiles version ${buf[7]}, this reads version 3`);
  const u64 = (o) => Number(buf.readBigUInt64LE(o));
  return {
    rootOffset: u64(8),
    rootLength: u64(16),
    leafOffset: u64(40),
    leafLength: u64(48),
    tileDataOffset: u64(56),
    tileDataLength: u64(64),
    addressedTiles: u64(72),
    tileEntries: u64(80),
    tileContents: u64(88),
    clustered: buf[96] === 1,
    internalCompression: buf[97],
    tileCompression: buf[98],
    tileType: buf[99],
    minZoom: buf[100],
    maxZoom: buf[101],
  };
}

// ---------------------------------------------------------------- varints

/** Reads one LEB128 varint. Returns [value, nextOffset]. */
export function varint(buf, at) {
  let value = 0;
  let shift = 1;
  let p = at;
  for (;;) {
    const b = buf[p++];
    value += (b & 0x7f) * shift;
    if (b < 0x80) return [value, p];
    shift *= 128;
    if (shift > 2 ** 56) throw new Error('varint too long');
  }
}

/**
 * A directory: entries sorted by tile id.
 *
 * An entry with `runLength === 0` points at another directory; anything
 * else points at tile data and covers `runLength` consecutive ids.
 */
export function readDirectory(buf) {
  let p = 0;
  let n;
  [n, p] = varint(buf, 0);
  const ids = new Array(n);
  const runs = new Array(n);
  const lengths = new Array(n);
  const offsets = new Array(n);
  let id = 0;
  for (let i = 0; i < n; i += 1) {
    let d;
    [d, p] = varint(buf, p);
    id += d;
    ids[i] = id;
  }
  for (let i = 0; i < n; i += 1) [runs[i], p] = varint(buf, p);
  for (let i = 0; i < n; i += 1) [lengths[i], p] = varint(buf, p);
  for (let i = 0; i < n; i += 1) {
    let v;
    [v, p] = varint(buf, p);
    // 🔴 Zero does not mean offset zero: it means "immediately after the
    // previous entry". Reading it as a literal zero makes every run of
    // consecutive tiles collapse onto the start of the archive.
    offsets[i] = v === 0 && i > 0 ? offsets[i - 1] + lengths[i - 1] : v - 1;
  }
  return ids.map((tileId, i) => ({
    tileId,
    runLength: runs[i],
    length: lengths[i],
    offset: offsets[i],
  }));
}

// ------------------------------------------------------------ hilbert ids

/** The first tile id of zoom `z` (= how many tiles live below it). */
export const firstIdOfZoom = (z) => ((4 ** z - 1) / 3) | 0;

function rotate(n, x, y, rx, ry) {
  if (ry === 0) {
    if (rx === 1) return [n - 1 - y, n - 1 - x];
    return [y, x];
  }
  return [x, y];
}

/** Tile id → `[z, x, y]`, over the Hilbert curve PMTiles orders by. */
export function tileIdToZxy(id) {
  let acc = 0;
  for (let z = 0; z < 27; z += 1) {
    const n = 2 ** z;
    const count = n * n;
    if (acc + count > id) {
      let t = id - acc;
      let x = 0;
      let y = 0;
      for (let s = 1; s < n; s *= 2) {
        const rx = 1 & Math.floor(t / 2);
        const ry = 1 & (t ^ rx);
        [x, y] = rotate(s, x, y, rx, ry);
        x += s * rx;
        y += s * ry;
        t = Math.floor(t / 4);
      }
      return [z, x, y];
    }
    acc += count;
  }
  throw new Error('tile id beyond zoom 26');
}

// ------------------------------------------------------------------- bbox

const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/** The inclusive tile range a bounding box covers at one zoom. */
export function tileRange(bbox, z) {
  const max = 2 ** z - 1;
  const clamp = (v) => Math.min(max, Math.max(0, v));
  return {
    minX: clamp(lonToX(bbox.west, z)),
    maxX: clamp(lonToX(bbox.east, z)),
    // Latitude runs the other way: north is a smaller y.
    minY: clamp(latToY(bbox.north, z)),
    maxY: clamp(latToY(bbox.south, z)),
  };
}

export function inBbox(bbox, z, x, y) {
  const r = tileRange(bbox, z);
  return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

// -------------------------------------------------------------- the walk

async function range(url, start, length) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
  if (res.status !== 206) throw new Error(`expected 206 for a range request, got ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const maybeGunzip = (buf, compression) => (compression === 2 ? gunzipSync(buf) : buf);

/**
 * Walks the directory tree and totals the distinct bytes inside `bbox`
 * at zooms up to `maxzoom`.
 */
export async function measure(url, { bbox, maxzoom, onProgress }) {
  const header = readHeader(await range(url, 0, 127));
  const limit = firstIdOfZoom(maxzoom + 1);

  const seen = new Set();
  let bytes = 0;
  let addressed = 0;
  const perZoom = {};
  let leavesRead = 0;
  let directoryBytes = header.rootLength;

  const walk = async (buf) => {
    for (const e of readDirectory(maybeGunzip(buf, header.internalCompression))) {
      // Entries are sorted by id, so the first one past our zoom ends it.
      if (e.tileId >= limit) return 'done';
      if (e.runLength === 0) {
        directoryBytes += e.length;
        leavesRead += 1;
        if (onProgress && leavesRead % 25 === 0) onProgress({ leavesRead, bytes, addressed });
        const child = await range(url, header.leafOffset + e.offset, e.length);
        if ((await walk(child)) === 'done') return 'done';
        continue;
      }
      for (let k = 0; k < e.runLength; k += 1) {
        const id = e.tileId + k;
        if (id >= limit) return 'done';
        const [z, x, y] = tileIdToZxy(id);
        if (!inBbox(bbox, z, x, y)) continue;
        addressed += 1;
        perZoom[z] = (perZoom[z] ?? 0) + 1;
        // 🔴 Per distinct content, not per address: the planet addresses
        // 1.43 billion tiles with 136 million distinct bodies.
        const key = `${e.offset}:${e.length}`;
        if (seen.has(key)) continue;
        seen.add(key);
        bytes += e.length;
      }
    }
    return 'more';
  };

  await walk(await range(url, header.rootOffset, header.rootLength));
  return { header, bytes, addressed, distinct: seen.size, perZoom, directoryBytes, leavesRead };
}

/**
 * Fetches ONE tile by `z/x/y` and says whether it is a usable tile.
 *
 * 🔴 CAMP-29's other acceptance criterion: "a range request to the file
 * returns a VALID tile". Valid is not the same as present — a 206 with
 * the wrong bytes looks identical to a good one until a map tries to
 * draw it. So this follows the directory tree to the tile, reads only
 * its bytes, and checks that what comes back gunzips into something
 * whose first field is a Mapbox Vector Tile layer.
 */
export async function fetchTile(url, z, x, y) {
  const header = readHeader(await range(url, 0, 127));
  const want = zxyToTileId(z, x, y);
  let dir = await range(url, header.rootOffset, header.rootLength);

  for (let depth = 0; depth < 4; depth += 1) {
    const entries = readDirectory(maybeGunzip(dir, header.internalCompression));
    // The entry that covers `want`: the last one starting at or before it.
    let found = null;
    for (const e of entries) {
      if (e.tileId > want) break;
      found = e;
    }
    if (!found) return { found: false, why: 'no entry covers that tile' };
    if (found.runLength === 0) {
      dir = await range(url, header.leafOffset + found.offset, found.length);
      continue;
    }
    if (want >= found.tileId + found.runLength) return { found: false, why: 'tile is a gap in the run' };
    const body = await range(url, header.tileDataOffset + found.offset, found.length);
    const raw = maybeGunzip(body, header.tileCompression);
    // An MVT is a protobuf whose layers are field 3, wire type 2 → 0x1a.
    return {
      found: true,
      compressedBytes: body.length,
      bytes: raw.length,
      looksLikeMvt: raw.length > 0 && raw[0] === 0x1a,
    };
  }
  return { found: false, why: 'directory nesting deeper than four levels' };
}

/** `[z, x, y]` → tile id, the inverse of `tileIdToZxy`. */
export function zxyToTileId(z, x, y) {
  let acc = firstIdOfZoom(z);
  const n = 2 ** z;
  let rx;
  let ry;
  let d = 0;
  let px = x;
  let py = y;
  for (let s = n / 2; s > 0; s = Math.floor(s / 2)) {
    rx = (px & s) > 0 ? 1 : 0;
    ry = (py & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    [px, py] = rotate(n, px, py, rx, ry);
  }
  return acc + d;
}

// --------------------------------------------------------------- self-test

function selfTest() {
  let bad = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) console.log(`ok   ${name}`);
    else {
      bad += 1;
      console.log(`x    ${name}${detail ? `  ${detail}` : ''}`);
    }
  };

  // The two directions of the curve must agree, or a tile fetched by
  // z/x/y lands on a different tile than the measure counted.
  {
    let mismatch = null;
    for (let z = 0; z <= 6 && !mismatch; z += 1) {
      for (let x = 0; x < 2 ** z && !mismatch; x += 1) {
        for (let y = 0; y < 2 ** z && !mismatch; y += 1) {
          const back = tileIdToZxy(zxyToTileId(z, x, y)).join();
          if (back !== `${z},${x},${y}`) mismatch = `${z}/${x}/${y} → ${back}`;
        }
      }
    }
    ok('z/x/y → id → z/x/y is the same tile, every tile to zoom 6', !mismatch, mismatch ?? '');
  }

  ok('a varint under 128 is one byte', varint(Buffer.from([0x7f]), 0)[0] === 127);
  ok('…and 128 takes two', varint(Buffer.from([0x80, 0x01]), 0)[0] === 128);
  ok('…300 decodes to 300', varint(Buffer.from([0xac, 0x02]), 0)[0] === 300);
  ok('…and the offset moves past every byte read', varint(Buffer.from([0xac, 0x02]), 0)[1] === 2);

  ok('zoom 0 starts at id 0', firstIdOfZoom(0) === 0);
  ok('zoom 1 starts at id 1', firstIdOfZoom(1) === 1);
  ok('zoom 2 starts at id 5', firstIdOfZoom(2) === 5);
  ok('zoom 13 starts at 22 369 621', firstIdOfZoom(13) === 22369621);

  ok('id 0 is the whole world', tileIdToZxy(0).join() === '0,0,0');
  ok('id 1 is the first tile of zoom 1', tileIdToZxy(1)[0] === 1);
  ok('id 4 is still zoom 1', tileIdToZxy(4)[0] === 1);
  ok('id 5 is the first of zoom 2', tileIdToZxy(5)[0] === 2);
  // Every id of a zoom must decode to a distinct tile of that zoom.
  {
    const z = 4;
    const ids = new Set();
    for (let i = firstIdOfZoom(z); i < firstIdOfZoom(z + 1); i += 1) {
      const [zz, x, y] = tileIdToZxy(i);
      if (zz !== z || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) break;
      ids.add(`${x},${y}`);
    }
    ok('zoom 4 covers all 256 of its tiles exactly once', ids.size === 256, String(ids.size));
  }

  ok('Greenwich at zoom 1 is the right-hand column', lonToX(0.1, 1) === 1);
  ok('…and the equator is the bottom row', latToY(-0.1, 1) === 1);
  {
    const r = tileRange(EU, 4);
    ok('the EU box at zoom 4 is a handful of tiles',
      r.maxX - r.minX <= 3 && r.maxY - r.minY <= 3, JSON.stringify(r));
    ok('…north is a SMALLER y than south', r.minY < r.maxY, JSON.stringify(r));
    ok('Paris is inside the EU box', inBbox(EU, 8, lonToX(2.35, 8), latToY(48.85, 8)));
    ok('…Reykjavik is not', !inBbox(EU, 8, lonToX(-21.9, 8), latToY(64.1, 8)));
    ok('…and neither is Tenerife, which `CROP.south` already drops',
      !inBbox(EU, 8, lonToX(-16.6, 8), latToY(28.3, 8)));
  }

  // A directory round-trip, including the offset rule that caught me.
  {
    const dir = Buffer.from([
      0x02, // two entries
      0x01, 0x01, // ids 1, 2
      0x01, 0x01, // run lengths 1, 1
      0x0a, 0x14, // lengths 10, 20
      0x65, 0x00, // offsets: 101 on the wire, then "right after the previous one"
    ]);
    const e = readDirectory(dir);
    ok('a directory reads its entries', e.length === 2);
    ok('…ids are cumulative, not absolute', e[0].tileId === 1 && e[1].tileId === 2);
    ok('…lengths survive', e[0].length === 10 && e[1].length === 20);
    ok('…an offset is stored plus one, so 101 on the wire is 100', e[0].offset === 100, String(e[0].offset));
    ok('…and a zero offset means "after the previous entry"', e[1].offset === 110, String(e[1].offset));
  }

  console.log(bad ? `\nx ${bad} self-test failure(s)` : '\nself-test passed');
  return bad > 0;
}

// ------------------------------------------------------------------- entry

const hasFlag = (argv, name) =>
  argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const valueOf = (argv, name) =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
  const url = valueOf(process.argv, 'url') ?? PLANET;

  const one = valueOf(process.argv, 'tile');
  if (one) {
    const [z, x, y] = one.split('/').map(Number);
    const t = await fetchTile(url, z, x, y);
    console.log(`tile ${z}/${x}/${y} of ${url}`);
    if (!t.found) {
      console.log(`  NOT FOUND: ${t.why}`);
      process.exit(1);
    }
    console.log(`  ${t.compressedBytes} bytes on the wire, ${t.bytes} after gunzip`);
    console.log(`  looks like a vector tile: ${t.looksLikeMvt ? 'yes' : 'NO'}`);
    process.exit(t.looksLikeMvt ? 0 : 1);
  }

  const maxzoom = Number(valueOf(process.argv, 'maxzoom') ?? 12);
  const raw = valueOf(process.argv, 'bbox');
  const bbox = raw
    ? (([west, south, east, north]) => ({ west, south, east, north }))(raw.split(',').map(Number))
    : EU;

  console.log(`archive  ${url}`);
  console.log(`bbox     ${bbox.west},${bbox.south},${bbox.east},${bbox.north}`);
  console.log(`maxzoom  ${maxzoom}\n`);

  const started = Date.now();
  const r = await measure(url, {
    bbox,
    maxzoom,
    onProgress: ({ leavesRead, bytes }) =>
      process.stdout.write(`\r  ${leavesRead} leaf dirs, ${(bytes / 1e9).toFixed(2)} GB so far`),
  });
  process.stdout.write('\r'.padEnd(60) + '\r');

  console.log(`planet       ${(r.header.tileDataLength / 1e9).toFixed(1)} GB, zooms ${r.header.minZoom}..${r.header.maxZoom}`);
  console.log(`directories  ${(r.directoryBytes / 1e6).toFixed(1)} MB read across ${r.leavesRead} leaves`);
  console.log(`addressed    ${r.addressed.toLocaleString()} tiles in the box`);
  console.log(`distinct     ${r.distinct.toLocaleString()} bodies`);
  console.log(`\nSIZE         ${(r.bytes / 1e9).toFixed(2)} GB  (${r.bytes.toLocaleString()} bytes)`);
  console.log('per zoom     ' + Object.entries(r.perZoom).map(([z, n]) => `z${z}:${n}`).join(' '));
  console.log(`\nmeasured in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

const RUN_DIRECTLY =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (RUN_DIRECTLY) {
  if (hasFlag(process.argv, 'self-test')) process.exit(selfTest() ? 1 : 0);
  else await main();
}
