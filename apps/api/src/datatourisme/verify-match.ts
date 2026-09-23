// CAMP-101: do the matcher's thresholds survive real data?
//
//   npx ts-node src/datatourisme/verify-match.ts <osm.geojson> <region.csv…>
//   npx ts-node src/datatourisme/verify-match.ts --self-test
//
// 🔴 Why this file exists rather than a sentence saying the thresholds
// look about right.
//
// match.ts carries four numbers — 400 m, 150 m, 0.85, 0.6 — and when it
// was written they came from the only evidence available: CAMP-71's
// measurement that genuine OSM duplicates sit about 37 m apart. That is
// evidence about OSM against itself, in Slovenia. It says nothing about
// a French tourist office's point against an OSM polygon centroid, which
// is the comparison the importer actually makes, and our database held
// exactly 0 French campsites from OSM on the day the rules were written.
//
// So this runs the real comparison — 2 068 DATAtourisme records against
// 25 793 OSM campsites — and prints the distribution the thresholds cut
// through. A threshold nobody has seen the histogram for is a guess with
// a decimal point.
//
// 🔴 It is a MEASUREMENT, not a test with an expected answer. There is no
// ground truth here: nobody has labelled which French pairs are really
// the same campsite. What it can show is whether the rules behave like
// rules — a clear cluster of near-identical names at short range, a long
// tail of obviously different ones, and a review pile small enough for a
// human to actually work through.

import { readFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { coreName, decide, metresApart, similarity, RULES } from './match';
import { isCampsite, parseRow } from './parse';
import type { DatatourismeRow, ParsedSpot } from './parse';
import { splitCsvLine } from './report-coverage';

type OsmSpot = { id: string; name: string | null; lat: number; lon: number };

/** Read the campsite extract the weekly workflow publishes. */
export function readOsm(path: string): OsmSpot[] {
  const geo = JSON.parse(readFileSync(path, 'utf8')) as {
    features: {
      properties: Record<string, string> | null;
      geometry: { type: string; coordinates: unknown };
    }[];
  };
  const out: OsmSpot[] = [];
  for (const f of geo.features) {
    const p = f.properties ?? {};
    const point = centroid(f.geometry);
    if (!point) continue;
    out.push({
      id: p['@id'] ?? p.id ?? `${out.length}`,
      name: p.name ?? null,
      ...point,
    });
  }
  return out;
}

/** A representative point for any geometry the extract contains. */
export function centroid(geometry: {
  type: string;
  coordinates: unknown;
}): { lat: number; lon: number } | null {
  const coords: number[][] = [];
  const walk = (c: unknown) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      coords.push(c as number[]);
      return;
    }
    for (const x of c) walk(x);
  };
  walk(geometry?.coordinates);
  if (coords.length === 0) return null;
  const lon = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  return { lat, lon };
}

/** Index by a coarse grid so 2 000 × 25 000 does not become 50 million. */
export function grid(spots: OsmSpot[], cell = 0.01): Map<string, OsmSpot[]> {
  const m = new Map<string, OsmSpot[]>();
  for (const s of spots) {
    const key = `${Math.round(s.lat / cell)}:${Math.round(s.lon / cell)}`;
    const bucket = m.get(key);
    if (bucket) bucket.push(s);
    else m.set(key, [s]);
  }
  return m;
}

export function near(
  index: Map<string, OsmSpot[]>,
  lat: number,
  lon: number,
  cell = 0.01,
): OsmSpot[] {
  const out: OsmSpot[] = [];
  const y = Math.round(lat / cell);
  const x = Math.round(lon / cell);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = index.get(`${y + dy}:${x + dx}`);
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}

async function readCsvSpots(path: string): Promise<ParsedSpot[]> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let header: string[] | null = null;
  let pending = '';
  const out: ParsedSpot[] = [];
  for await (const line of rl) {
    pending = pending ? `${pending}\n${line}` : line;
    if ((pending.match(/"/g) ?? []).length % 2 !== 0) continue;
    const fields = splitCsvLine(pending);
    pending = '';
    if (!header) {
      header = fields.map((f) => f.trim());
      continue;
    }
    const row: DatatourismeRow = {};
    header.forEach((h, i) => (row[h] = fields[i]));
    if (!isCampsite(row)) continue;
    const spot = parseRow(row);
    if (spot) out.push(spot);
  }
  return out;
}

function selfTest() {
  let failures = 0;
  const check = (name: string, got: unknown, want: unknown) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      console.error(
        `  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`,
      );
      failures++;
    } else console.log(`  ✓ ${name}`);
  };

  check(
    'a point geometry is its own centroid',
    centroid({ type: 'Point', coordinates: [6.18, 43.12] }),
    { lat: 43.12, lon: 6.18 },
  );
  check(
    'a polygon averages its ring',
    centroid({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 2],
          [2, 2],
          [2, 0],
        ],
      ],
    }),
    { lat: 1, lon: 1 },
  );
  check(
    'an empty geometry is null',
    centroid({ type: 'Polygon', coordinates: [] }),
    null,
  );

  // 🔴 The grid must not lose a neighbour that sits just across a cell
  // boundary — that would silently turn real pairs into "new".
  const spots: OsmSpot[] = [
    { id: 'a', name: 'A', lat: 43.1249, lon: 6.18 },
    { id: 'b', name: 'B', lat: 43.1251, lon: 6.18 },
  ];
  const idx = grid(spots);
  check(
    'a neighbour across a cell boundary is still found',
    near(idx, 43.1249, 6.18).length,
    2,
  );

  console.log(
    failures ? `\n✗ ${failures} self-test failure(s)` : '\n✓ self-test passed',
  );
  process.exit(failures ? 1 : 0);
}

async function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const [osmPath, ...csvPaths] = process.argv.slice(2);
  if (!osmPath || csvPaths.length === 0) {
    console.error('usage: verify-match.ts <osm.geojson> <region.csv…>');
    process.exit(1);
  }

  const osm = readOsm(osmPath);
  const index = grid(osm);
  console.log(
    `OSM campsites: ${osm.length}  (${osm.filter((s) => s.name).length} named)`,
  );

  const incoming: ParsedSpot[] = [];
  for (const p of csvPaths) incoming.push(...(await readCsvSpots(p)));
  console.log(`DATAtourisme campsites: ${incoming.length}`);

  const counts = { same: 0, review: 0, new: 0 };
  const whys = new Map<string, number>();
  /** Distance and similarity of the best candidate, whatever the verdict. */
  const bestPairs: { m: number; sim: number }[] = [];

  for (const spot of incoming) {
    const candidates = near(index, spot.lat, spot.lon);
    const d = decide(
      { name: spot.name, lat: spot.lat, lon: spot.lon },
      candidates,
    );
    counts[d.verdict]++;
    if (d.verdict !== 'new') {
      const key = d.why.replace(/\d+/g, 'N');
      whys.set(key, (whys.get(key) ?? 0) + 1);
    }

    // The raw signal, independent of the thresholds, so the histogram
    // shows what the rules are cutting through rather than their output.
    const core = coreName(spot.name);
    let best: { m: number; sim: number } | null = null;
    for (const c of candidates) {
      const m = metresApart(spot, c);
      if (m > 1000) continue;
      const other = coreName(c.name);
      const sim = core && other ? similarity(core, other) : 0;
      if (!best || sim > best.sim || (sim === best.sim && m < best.m))
        best = { m, sim };
    }
    if (best) bestPairs.push(best);
  }

  const pct = (n: number) => `${((100 * n) / incoming.length).toFixed(1)}%`;
  console.log('');
  console.log(
    `  same    ${String(counts.same).padStart(5)}  ${pct(counts.same)}`,
  );
  console.log(
    `  review  ${String(counts.review).padStart(5)}  ${pct(counts.review)}`,
  );
  console.log(
    `  new     ${String(counts.new).padStart(5)}  ${pct(counts.new)}`,
  );

  console.log('\n  why, for everything not simply new:');
  for (const [why, n] of [...whys].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(5)}  ${why}`);
  }

  // 🔴 The histogram the thresholds cut through. If there is no gap
  // between "the same campsite" and "a different one", no threshold can
  // be right and the rules need another signal, not another decimal.
  console.log('\n  best candidate within 1 km, by name similarity:');
  const bands = [
    ['1.00      ', (p: { sim: number }) => p.sim === 1],
    ['0.85–0.99 ', (p: { sim: number }) => p.sim >= 0.85 && p.sim < 1],
    ['0.60–0.84 ', (p: { sim: number }) => p.sim >= 0.6 && p.sim < 0.85],
    ['0.30–0.59 ', (p: { sim: number }) => p.sim >= 0.3 && p.sim < 0.6],
    ['below 0.30', (p: { sim: number }) => p.sim < 0.3],
  ] as const;
  for (const [label, test] of bands) {
    const hits = bestPairs.filter(test);
    const median = hits.length
      ? Math.round(
          [...hits].sort((a, b) => a.m - b.m)[Math.floor(hits.length / 2)].m,
        )
      : 0;
    console.log(
      `    ${label} ${String(hits.length).padStart(5)} pairs   median distance ${median} m`,
    );
  }

  // 🔴 The decision-relevant table: for pairs whose names already agree,
  // how far apart are they? If there were a cliff, the threshold would
  // belong at it. Measured 23.09.2026 there is none — see the note at
  // the foot of this file.
  const agreeing = bestPairs
    .filter((p) => p.sim >= RULES.confidentSimilarity)
    .map((p) => p.m)
    .sort((a, b) => a - b);
  if (agreeing.length > 0) {
    const q = (f: number) =>
      Math.round(agreeing[Math.floor(agreeing.length * f)]);
    console.log(
      `\n  names already agree (${agreeing.length} pairs) — how far apart:`,
    );
    console.log(
      `    p50 ${q(0.5)} m   p75 ${q(0.75)} m   p90 ${q(0.9)} m   p95 ${q(0.95)} m   p99 ${q(0.99)} m`,
    );
    for (const band of [50, 100, 150, 200, 300, 400, 600, 1000]) {
      const n = agreeing.filter((m) => m <= band).length;
      console.log(
        `    <= ${String(band).padStart(4)} m  ${String(n).padStart(4)}  ${((100 * n) / agreeing.length).toFixed(1)}%`,
      );
    }
  }

  console.log(
    `\n  thresholds in force: ${RULES.sameSpotMetres} m / ${RULES.maxMetres} m, ` +
      `similarity ${RULES.confidentSimilarity} / ${RULES.weakSimilarity}`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
