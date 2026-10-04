#!/usr/bin/env python3
"""
CAMP-163 — make the fixtures `tests/unit/drought-fetch.spec.ts` reads.

    python3 make-cdi-crop.py <cdi.tif from the WCS> [--out DIR]

Needs: numpy, tifffile (to read the source), and GDAL's command-line tools
(`gdalinfo`, `gdal_translate`, `gdallocationinfo`) on PATH.

WHY IT IS A SCRIPT AND NOT A FILE SOMEBODY MADE ONCE. The reader in
scripts/edo/fetch-drought.mjs and the sampler in src/lib/drought.ts are
both ours. A test that builds a GeoTIFF with the same code, or from the
same understanding of the format, agrees with itself: the strips-out-of-
order defect and the no-GeoKeys defect were both found by looking at the
real file, and a fixture written by the reader's author would have carried
neither. So the three pieces are made by three different programs:

  1. the VALUES are Copernicus's own — a 336 x 216 window of the real
     2026-09-11 Combined Drought Indicator, holding every value 0-6 and
     Malta;
  2. the FILE is written here, by a small independent TIFF writer, laid out
     the way the service lays its files out: uncompressed, 4 rows per
     strip, and — the finding — the strips NOT in row order (the first five
     sit at the end), with no GeoKeyDirectory;
  3. the ANSWERS are GDAL's: it reads the file this script wrote, and every
     pixel and every sampled point in the oracle is what GDAL says, not what
     this script or ours computed.

The oracle is written next to the crop as `cdi-crop.oracle.json`. Point
values come from `gdallocationinfo -valonly -geoloc`; a point off the file
is `null`.
"""
import json
import os
import random
import struct
import subprocess
import sys
import tempfile

import numpy as np
import tifffile

SRC = sys.argv[1]
OUT = os.path.dirname(os.path.abspath(__file__))
if '--out' in sys.argv:
    OUT = sys.argv[sys.argv.index('--out') + 1]

# The window: columns 744-1079, rows 720-935 of the 1824 x 1200 grid, that is
# 6E-20E, 33N-42N. Malta is in it (col 948, row 866).
XOFF, YOFF, W, H = 744, 720, 336, 216
CELL = 1 / 24
WEST = -25 + XOFF / 24
NORTH = 72 - YOFF / 24
ROWS_PER_STRIP = 4

full = tifffile.imread(SRC)
assert full.shape == (1200, 1824), full.shape
crop = np.ascontiguousarray(full[YOFF:YOFF + H, XOFF:XOFF + W]).astype(np.uint8)
counts = np.bincount(crop.ravel(), minlength=8).tolist()
assert all(counts[v] > 0 for v in range(7)), f'the window lost a class: {counts}'


def write_tiff(path, pixels):
    """A little-endian, uncompressed, single-band 8-bit GeoTIFF, strips out of row order."""
    h, w = pixels.shape
    n = -(-h // ROWS_PER_STRIP)
    # Physical order: the service stores the first five strips LAST.
    order = list(range(5, n)) + list(range(0, 5))
    tags = [  # (tag, type, values)   3=SHORT 4=LONG 5=RATIONAL 12=DOUBLE
        (256, 4, [w]), (257, 4, [h]), (258, 3, [8]), (259, 3, [1]), (262, 3, [1]),
        (273, 4, [0] * n), (277, 3, [1]), (278, 4, [ROWS_PER_STRIP]),
        (279, 4, [min(ROWS_PER_STRIP, h - s * ROWS_PER_STRIP) * w for s in range(n)]),
        (282, 5, [(72, 1)]), (283, 5, [(72, 1)]), (284, 3, [1]), (296, 3, [2]),
        (339, 3, [1]),
        (33550, 12, [CELL, CELL, 0.0]),
        (33922, 12, [0.0, 0.0, 0.0, WEST, NORTH, 0.0]),
    ]
    size = {3: 2, 4: 4, 5: 8, 12: 8}
    ifd_at = 8
    ifd_len = 2 + 12 * len(tags) + 4
    cursor = ifd_at + ifd_len
    extra = {}
    for i, (tag, typ, vals) in enumerate(tags):
        nbytes = size[typ] * len(vals)
        if nbytes > 4:
            extra[i] = cursor
            cursor += nbytes + (nbytes & 1)
    data_start = cursor
    strip_off = {}
    at = data_start
    for s in order:
        strip_off[s] = at
        at += min(ROWS_PER_STRIP, h - s * ROWS_PER_STRIP) * w
    tags[5] = (273, 4, [strip_off[s] for s in range(n)])

    out = bytearray(at)
    out[0:4] = b'II*\x00'
    struct.pack_into('<I', out, 4, ifd_at)
    struct.pack_into('<H', out, ifd_at, len(tags))
    for i, (tag, typ, vals) in enumerate(tags):
        p = ifd_at + 2 + 12 * i
        struct.pack_into('<HHI', out, p, tag, typ, len(vals))
        nbytes = size[typ] * len(vals)
        where = extra.get(i, p + 8)
        if nbytes > 4:
            struct.pack_into('<I', out, p + 8, where)
        for k, v in enumerate(vals):
            q = where + k * size[typ]
            if typ == 3:
                struct.pack_into('<H', out, q, v)
            elif typ == 4:
                struct.pack_into('<I', out, q, v)
            elif typ == 5:
                struct.pack_into('<II', out, q, v[0], v[1])
            else:
                struct.pack_into('<d', out, q, v)
    for s in range(n):
        rows = pixels[s * ROWS_PER_STRIP:(s + 1) * ROWS_PER_STRIP]
        out[strip_off[s]:strip_off[s] + rows.size] = rows.tobytes()
    with open(path, 'wb') as f:
        f.write(out)
    return [strip_off[s] for s in range(n)]


tif = os.path.join(OUT, 'cdi-crop.tif')
strip_offsets = write_tiff(tif, crop)
assert strip_offsets[0] > strip_offsets[5], 'the fixture must store its first strips last'


def sh(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


# ── what GDAL says about the file ─────────────────────────────────────────
info = json.loads(sh('gdalinfo', '-json', tif))
gt = info['geoTransform']
assert info['size'] == [W, H]
assert 'coordinateSystem' not in info or not info['coordinateSystem'].get('wkt'), 'the fixture must carry no CRS'

with tempfile.TemporaryDirectory() as tmp:
    raw = os.path.join(tmp, 'gdal.raw')
    sh('gdal_translate', '-q', '-of', 'ENVI', tif, raw)
    gdal_pixels = np.fromfile(raw, dtype=np.uint8).reshape(H, W)

# GDAL and the source window must agree before either is used as an oracle.
assert np.array_equal(gdal_pixels, crop), 'GDAL reads the fixture differently from how it was written'


def runs(row):
    out, cur, n = [], int(row[0]), 0
    for v in row:
        if int(v) == cur:
            n += 1
        else:
            out.append(f'{cur}:{n}')
            cur, n = int(v), 1
    out.append(f'{cur}:{n}')
    return ','.join(out)


rows = [runs(r) for r in gdal_pixels]


def gdal_value(lon, lat):
    res = subprocess.run(
        ['gdallocationinfo', '-valonly', '-geoloc', tif, repr(lon), repr(lat)],
        capture_output=True, text=True,
    )
    text = res.stdout.strip()
    return int(text) if text else None


# ── the points ────────────────────────────────────────────────────────────
rng = random.Random(163)
east = WEST + W * CELL
south = NORTH - H * CELL
centre = lambda c, r: (WEST + (c + 0.5) * CELL, NORTH - (r + 0.5) * CELL)  # noqa: E731
pts = []  # (why, lon, lat)

for v in range(7):  # five cell centres per value
    ys, xs = np.nonzero(gdal_pixels == v)
    for i in rng.sample(range(len(ys)), min(5, len(ys))):
        lon, lat = centre(int(xs[i]), int(ys[i]))
        pts.append((f'centre of a cell holding {v}', lon, lat))

pts += [
    ('the exact north-west corner of the file', WEST, NORTH),
    ('one cell in from the north-west corner', WEST + CELL, NORTH - CELL),
    ('just inside the south-east corner', east - 1e-9, south + 1e-9),
    ('the exact east edge, which belongs to no cell', east, 37.0),
    ('the exact south edge, which belongs to no cell', 10.0, south),
    ('just west of the file', WEST - 1e-9, 37.0),
    ('just north of the file', 10.0, NORTH + 1e-9),
    ('Valletta', 14.5146, 35.8989),
    ('Gozo', 14.25, 36.05),
    ('Palermo', 13.3614, 38.1157),
    ('Rome', 12.4964, 41.9028),
    ('Cagliari', 9.1108, 39.2238),
    ('Tunis', 10.1815, 36.8065),
    ('Split, north of the file', 16.44, 43.5),
    ('Athens, east of the file', 23.7275, 37.9838),
]
for _ in range(6):  # one micro-step either side of internal cell edges
    c, r = rng.randrange(1, W - 1), rng.randrange(1, H - 1)
    lon_edge, lat_edge = WEST + c * CELL, NORTH - r * CELL
    for dx, dy in ((1e-6, 1e-6), (-1e-6, -1e-6), (1e-6, -1e-6), (-1e-6, 1e-6)):
        pts.append(('a micro-step from a cell edge', lon_edge + dx, lat_edge + dy))
for _ in range(60):
    pts.append(('a random point on the file', rng.uniform(WEST, east - 1e-6), rng.uniform(south + 1e-6, NORTH)))
for _ in range(10):
    pts.append(('a random point off the file', rng.uniform(-30, 55), rng.uniform(20, 75)))

points = []
for why, lon, lat in pts:
    points.append({'why': why, 'lon': lon, 'lat': lat, 'value': gdal_value(lon, lat)})

oracle = {
    'about': 'Made by make-cdi-crop.py. Every value is what GDAL says about cdi-crop.tif, not what our code computes.',
    'source': 'Copernicus EDO cdiad, TIME=2026-09-11, WCS 2.0.0 GeoTIFF; window columns 744-1079, rows 720-935',
    'gdal': subprocess.run(['gdalinfo', '--version'], capture_output=True, text=True).stdout.strip(),
    'size': [W, H],
    'origin': [gt[0], gt[3]],
    'pixelSize': [gt[1], gt[5]],
    'stripOffsets': strip_offsets,
    'byValue': {str(v): counts[v] for v in range(8) if counts[v]},
    'rows': rows,
    'points': points,
}
with open(os.path.join(OUT, 'cdi-crop.oracle.json'), 'w', encoding='utf8') as f:
    json.dump(oracle, f, ensure_ascii=False, separators=(',', ':'))
    f.write('\n')

on = sum(1 for p in points if p['value'] is not None)
print(f'wrote {tif} ({os.path.getsize(tif)} bytes), values {oracle["byValue"]}')
print(f'{len(points)} oracle points, {on} on the file, {len(points) - on} off it')
