// CAMP-46: what the itinerary does on the real table — how long it takes, and
// how far apart the nights it picks are.
//
//   cd apps/api
//   npx ts-node src/planner/measure-itinerary.ts
//
// Exit 1 when no journey produced an itinerary (nothing was measured), when
// any itinerary has two nights closer than its band allows, or when a request
// threw. Read-only (read-only.ts); reads DATABASE_URL (default: the local
// camptribe_dev) and never prints it.
//
// 🔴 EVERY DISTANCE HERE IS A STRAIGHT LINE. There is no router. The corridor
// is the great-circle arc from A to B, the band is metres along it, and the
// header of the report says so. There is no time in this output because there
// is nothing to compute it from.
//
// 🔴 THE GAP BETWEEN NIGHTS IS NOT THIS CODE'S OWN ARITHMETIC. It is read back
// from PostGIS — `ST_Distance` on a geography, the spheroid — for every pair
// of nights of every itinerary, and compared with the lower bound of the band
// the request asked for. The planner works on a sphere and PostGIS on the
// spheroid, which differ by -0.09% to +0.28% on the three lines measured
// (corridor.ts), so the check allows 1% (`SPHEROID_SLACK`); a gap below that
// is a bug, not rounding.
//
// 🔴 THE TIME IS THE FUNCTION'S, END TO END: `planItinerary` — the corridor
// rule in SQL, the position of each campsite, the programme — on a database
// client in this process. It is not an HTTP request: there is no endpoint yet
// (CAMP-245 / the planner's POST), and a network hop is not this card's.
// Every call counts, the first included: a cold plan is a plan a reader may
// get. The programme alone is timed on synthetic corridors as well, because
// the real ones are only as large as the road happens to be dense.

import 'dotenv/config';
import { performance } from 'node:perf_hooks';
import { Client } from 'pg';
import { buildCorridor } from './corridor-source';
import { LonLat } from './hard-constraints';
import { ItineraryOutcome, planItinerary } from './itinerary';
import { JOURNEYS } from './measure-constraints';
import { inReadOnlyTransaction, Queryable } from './read-only';
import { splitIntoDays } from './split-days';

/** PostGIS measures on the spheroid, the planner on a sphere: tenths of a per cent. */
export const SPHEROID_SLACK = 0.99;

export const DAYS = 7;
/** Runs of 0.5 to 1.5 of an even day: a calm and a hurried day around the mean. */
export const BAND_SHARE = { min: 0.5, max: 1.5 } as const;
export const BUFFER_M = 30_000;
/** Every journey is planned this many times: the first is cold, the rest are not. */
export const REPEATS = 5;

export interface Trip {
  name: string;
  from: LonLat;
  to: LonLat;
}

/**
 * Real A → B trips, straight lines, a week each. The five of
 * measure-constraints.ts and nine more, across the Union: plains, coasts, the
 * Alps, the Balkans — and two that cross open water, where a chain of nights
 * has nothing to stand on and the honest answer may be a refusal.
 */
export const TRIPS: readonly Trip[] = [
  ...JOURNEYS.map((j) => ({
    name: j.name,
    from: j.line[0],
    to: j.line[j.line.length - 1],
  })),
  { name: 'Berlin → Vienna', from: [13.4, 52.52], to: [16.37, 48.21] },
  { name: 'Madrid → Lisbon', from: [-3.7, 40.42], to: [-9.14, 38.72] },
  { name: 'Rome → Milan', from: [12.5, 41.9], to: [9.19, 45.46] },
  { name: 'Paris → Bordeaux', from: [2.35, 48.86], to: [-0.58, 44.84] },
  { name: 'Budapest → Bucharest', from: [19.04, 47.5], to: [26.1, 44.43] },
  { name: 'Athens → Thessaloniki', from: [23.73, 37.98], to: [22.94, 40.64] },
  { name: 'Brussels → Munich', from: [4.35, 50.85], to: [11.58, 48.14] },
  { name: 'Amsterdam → Hamburg', from: [4.9, 52.37], to: [9.99, 53.55] },
  { name: 'Vienna → Ljubljana', from: [16.37, 48.21], to: [14.51, 46.06] },
  // Across open water: the line has no land under it for most of its length.
  { name: 'Marseille → Ajaccio', from: [5.37, 43.3], to: [8.74, 41.92] },
  { name: 'Stockholm → Helsinki', from: [18.07, 59.33], to: [24.94, 60.17] },
];

export interface TripResult {
  name: string;
  status: ItineraryOutcome['status'];
  /** `reason` of a refusal. */
  reason?: string;
  lengthKm?: number;
  /** Lower bound of the band the trip asked for, metres. */
  minM: number;
  candidates?: number;
  nights?: string[];
  /** Smallest distance between any two nights, from PostGIS, metres. */
  minGapM?: number;
  /** Milliseconds of each call, in order. */
  ms: number[];
}

export interface DpTiming {
  candidates: number;
  days: number;
  ms: number[];
}

export interface Measurement {
  trips: TripResult[];
  dp: DpTiming[];
}

export const median = (xs: readonly number[]): number => {
  if (xs.length === 0) throw new Error('median of nothing');
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The smallest distance between any two of these campsites, from PostGIS. */
async function minGapM(db: Queryable, slugs: string[]): Promise<number> {
  const r = await db.query(
    `SELECT min(ST_Distance(a.location::geography, b.location::geography)) AS m
       FROM camping_spots a JOIN camping_spots b ON a.slug < b.slug
      WHERE a.slug = ANY($1) AND b.slug = ANY($1)`,
    [slugs],
  );
  const m = r.rows[0].m;
  if (m === null || m === undefined) {
    throw new Error(`no pair of nights among ${slugs.length} slugs`);
  }
  return Number(m);
}

export async function measureTrips(
  db: Queryable,
  trips: readonly Trip[] = TRIPS,
  repeats = REPEATS,
): Promise<TripResult[]> {
  const out: TripResult[] = [];
  for (const t of trips) {
    const ms: number[] = [];
    let last: ItineraryOutcome | undefined;
    // The band is a share of an even day, so it needs the corridor's length:
    // from the same source the planner takes it from.
    const lengthM = (await buildCorridor({ from: t.from, to: t.to })).metres;
    const even = lengthM / DAYS;
    const band = {
      minM: even * BAND_SHARE.min,
      maxM: even * BAND_SHARE.max,
    };
    for (let i = 0; i < repeats; i++) {
      const t0 = performance.now();
      last = await planItinerary(db, {
        from: t.from,
        to: t.to,
        days: DAYS,
        band,
        bufferM: BUFFER_M,
      });
      ms.push(performance.now() - t0);
    }
    const r: TripResult = {
      name: t.name,
      status: (last as ItineraryOutcome).status,
      lengthKm: lengthM / 1000,
      minM: band.minM,
      ms,
    };
    if (last?.status === 'ok') {
      r.candidates = last.candidates;
      r.nights = last.days.flatMap((d) => (d.night ? [d.night.slug] : []));
      r.minGapM = await minGapM(db, r.nights);
    } else if (last?.status === 'infeasible') {
      r.reason = last.reason;
      if (last.reason === 'no-chain') r.candidates = last.candidates;
    }
    out.push(r);
  }
  return out;
}

/**
 * The programme alone, on a synthetic corridor: `n` campsites spread over
 * 600 km with a jitter from a fixed generator, runs of 0.5 to 1.5 of an even
 * day, and the weight on closeness to the even cut. Deterministic.
 */
export function timeProgramme(
  sizes: readonly { n: number; days: number }[],
  repeats = 9,
): DpTiming[] {
  return sizes.map(({ n, days }) => {
    let seed = 7;
    const next = () =>
      (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
    const metres = 600_000;
    const cands = Array.from({ length: n }, (_, i) => ({
      slug: `c${String(i).padStart(6, '0')}`,
      along: Math.floor(((i + next()) / n) * metres),
    }));
    const even = metres / days;
    const ms: number[] = [];
    for (let r = 0; r < repeats; r++) {
      const t0 = performance.now();
      const res = splitIntoDays(cands, {
        days,
        metres,
        band: { minM: even * BAND_SHARE.min, maxM: even * BAND_SHARE.max },
        value: (c, k) => 1 - Math.abs(c.along - k * even) / even,
      });
      ms.push(performance.now() - t0);
      if (res.status !== 'ok') {
        throw new Error(`synthetic ${n} × ${days}: ${JSON.stringify(res)}`);
      }
    }
    return { candidates: n, days, ms };
  });
}

/** What is wrong with a measurement. Empty means usable. */
export function problemsOf(m: Measurement): string[] {
  const out: string[] = [];
  const ok = m.trips.filter((t) => t.status === 'ok');
  if (ok.length === 0) {
    out.push(
      'no trip produced an itinerary: nothing was measured, which is a failure, not a pass',
    );
  }
  for (const t of ok) {
    if (t.minGapM === undefined) {
      out.push(`${t.name}: an itinerary with no measured gap`);
    } else if (t.minGapM < t.minM * SPHEROID_SLACK) {
      out.push(
        `${t.name}: two nights are ${(t.minGapM / 1000).toFixed(2)} km apart, ` +
          `closer than the band's ${(t.minM / 1000).toFixed(2)} km ` +
          `(allowing ${((1 - SPHEROID_SLACK) * 100).toFixed(0)}% for the spheroid)`,
      );
    }
  }
  return out;
}

const km = (m: number) => (m / 1000).toFixed(1);

export function format(m: Measurement, measuredFrom: string): string {
  const L: string[] = [];
  L.push(`Itinerary, measured ${measuredFrom}`);
  L.push(
    '🔴 every distance is a STRAIGHT LINE (great circle), not a road; no driving time exists here',
  );
  L.push(
    `${DAYS} days, runs of ${BAND_SHARE.min} to ${BAND_SHARE.max} of an even day along the line A→B, ` +
      `corridor ${BUFFER_M / 1000} km to each side, each trip planned ${m.trips[0]?.ms.length ?? 0} times`,
  );
  L.push('');
  L.push(
    'trip                        line km  min run   cands  verdict            smallest gap between nights   median ms',
  );
  for (const t of m.trips) {
    const verdict =
      t.status === 'ok'
        ? `ok, ${t.nights?.length} nights`
        : `${t.status}${t.reason ? ` (${t.reason})` : ''}`;
    L.push(
      `${t.name.padEnd(27)} ${(t.lengthKm ?? 0).toFixed(0).padStart(7)} ${km(t.minM).padStart(8)} ` +
        `${String(t.candidates ?? '-').padStart(7)}  ${verdict.padEnd(18)} ` +
        `${(t.minGapM === undefined ? '-' : km(t.minGapM) + ' km (PostGIS)').padStart(28)}   ` +
        `${median(t.ms).toFixed(0).padStart(9)}`,
    );
  }
  const ok = m.trips.filter((t) => t.status === 'ok');
  const calls = m.trips.flatMap((t) =>
    t.ms.map((ms, i) => ({ ms, label: `${t.name}, call ${i + 1}` })),
  );
  const all = calls.map((c) => c.ms);
  const slowest = calls.reduce((a, b) => (a.ms >= b.ms ? a : b));
  const gaps = ok.map((t) => t.minGapM as number);
  L.push('');
  L.push(
    `itineraries: ${ok.length} of ${m.trips.length} trips; refused: ` +
      m.trips
        .filter((t) => t.status !== 'ok')
        .map((t) => `${t.name} (${t.reason ?? t.status})`)
        .join(', '),
  );
  if (gaps.length) {
    const worst = ok.reduce((a, b) =>
      (a.minGapM as number) / a.minM < (b.minGapM as number) / b.minM ? a : b,
    );
    L.push(
      `smallest gap between any two nights, over every itinerary: ${km(Math.min(...gaps))} km; ` +
        `smallest against its own band: ${km(worst.minGapM as number)} km vs ${km(worst.minM)} km (${worst.name})`,
    );
  }
  L.push(
    `response time over ${all.length} calls: median ${median(all).toFixed(0)} ms, ` +
      `worst ${slowest.ms.toFixed(0)} ms (${slowest.label}); first calls included; function time, not HTTP`,
  );
  L.push('');
  L.push('the programme alone, on a synthetic 600 km corridor:');
  for (const d of m.dp) {
    L.push(
      `  ${String(d.candidates).padStart(6)} candidates × ${String(d.days).padStart(2)} days: ` +
        `median ${median(d.ms).toFixed(1)} ms, worst ${Math.max(...d.ms).toFixed(1)} ms (${d.ms.length} runs)`,
    );
  }
  return L.join('\n');
}

async function main(): Promise<number> {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev',
  });
  await client.connect();
  let trips: TripResult[];
  let when = '';
  try {
    ({ trips, when } = await inReadOnlyTransaction(client, async () => ({
      trips: await measureTrips(client),
      when: String((await client.query('SELECT now()::text AS t')).rows[0].t),
    })));
  } finally {
    await client.end();
  }
  const m: Measurement = {
    trips,
    dp: timeProgramme([
      { n: 600, days: 7 },
      { n: 5_000, days: 7 },
      { n: 20_000, days: 7 },
      { n: 5_000, days: 60 },
    ]),
  };
  console.log(format(m, when));
  const problems = problemsOf(m);
  if (problems.length) {
    console.error('\nproblems:');
    for (const p of problems) console.error(`  ${p}`);
    return 1;
  }
  return 0;
}

// Guarded like every other script here: an import must not run it.
if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err);
      process.exitCode = 1;
    },
  );
}
