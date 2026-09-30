// CAMP-164: what the import yields, and the measurement behind
// AIR_RADIUS_M — rerunnable.
//
//   DATABASE_URL=postgres://… npx ts-node src/air/report-coverage.ts
//   DATABASE_URL=postgres://… npx ts-node src/air/report-coverage.ts --proxy
//
// Read-only. Run it against a database the importer has been applied to.
//
// Without `--proxy` it prints, over ALL live campsites (no sampling):
//   1. how many have a station within each radius — the curve that
//      cannot choose the radius, because it has no knee;
//   2. what the page will say for each of them at AIR_RADIUS_M: a
//      station, the model, or none — by country, because a country
//      sitting at zero in that table is the shape a dropped country
//      code (or a swapped latitude and longitude) makes;
//   3. how many stations hold a reading, and how many of those are
//      still inside the freshness budget.
//
// With `--proxy` it also runs the examination that DOES choose the
// radius, on a different field from the one it judges: how often the
// 1 km modelled index at a campsite is the same level as the modelled
// index at its nearest station. The model is downscaled CAMS and does
// not assimilate the stations, so it shares no field with a station
// reading. Sampled — --per-band campsites in each 5 km band out to
// 50 km, six hours across the raster's past window — because the raster
// is asked one point at a time per hour.

import 'dotenv/config';
import { Client } from 'pg';
import { fetchModelledBands, rasterWindow } from './fetch';
import { hourStart } from './parse';
import { AIR_FRESH_FOR_HOURS, AIR_RADIUS_M } from './source';

const RADII_M = [
  1000, 2000, 3000, 5000, 10000, 15000, 20000, 25000, 30000, 50000, 100000,
];
const BAND_M = 5000;
const MAX_BAND_M = 50000;

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pct = (n: number, of: number) =>
  of ? ((100 * n) / of).toFixed(1) : '  n/a';

interface Near {
  id: string;
  country: string;
  lon: number;
  lat: number;
  d: number;
  slon: number;
  slat: number;
  stationType: string;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'DATABASE_URL is not set. This report has no default database.',
    );
    process.exit(2);
  }
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const stations = Number(
      (await db.query('SELECT count(*) AS n FROM air_quality_stations')).rows[0]
        .n,
    );
    if (stations === 0)
      throw new Error(
        'air_quality_stations is empty — run the import with --apply first',
      );

    const near: Near[] = (
      await db.query(`
        SELECT s.id, s.country,
               ST_X(s.location::geometry) AS lon, ST_Y(s.location::geometry) AS lat,
               n.d, n.slon, n.slat, n.station_type
          FROM camping_spots s
          CROSS JOIN LATERAL (
            SELECT ST_Distance(s.location::geography, st.location) AS d,
                   ST_X(st.location::geometry) AS slon, ST_Y(st.location::geometry) AS slat,
                   st.station_type
              FROM air_quality_stations st
             ORDER BY s.location::geography <-> st.location, st.code
             LIMIT 1) n
         WHERE s.missing_since IS NULL`)
    ).rows.map((r) => ({
      id: r.id as string,
      // 🔴 Lower case, like the stations' column. camping_spots spells a
      // country `HR` and air_quality_stations `hr`; compared as they were
      // stored, every country read "0 stations" — the very shape this
      // table exists to expose, produced by the table itself.
      country: (r.country as string).toLowerCase(),
      lon: Number(r.lon),
      lat: Number(r.lat),
      d: Number(r.d),
      slon: Number(r.slon),
      slat: Number(r.slat),
      stationType: r.station_type as string,
    }));

    console.log(`stations stored                       ${stations}`);
    console.log(`live campsites                        ${near.length}\n`);

    console.log('1. campsites with a station within the radius (no sampling)');
    for (const r of RADII_M) {
      const n = near.filter((x) => x.d <= r).length;
      console.log(
        `  ${String(r / 1000).padStart(4)} km  ${String(n).padStart(6)}  ${pct(n, near.length).padStart(5)}%${r === AIR_RADIUS_M ? '   <- AIR_RADIUS_M' : ''}`,
      );
    }

    console.log(
      `\n2. what a campsite page says at ${AIR_RADIUS_M / 1000} km, by country`,
    );
    const modelled = new Set<string>(
      (await db.query('SELECT spot_id FROM air_quality_modelled')).rows.map(
        (r) => r.spot_id as string,
      ),
    );
    const byCountry = new Map<
      string,
      { n: number; station: number; model: number; none: number }
    >();
    for (const x of near) {
      const c = byCountry.get(x.country) ?? {
        n: 0,
        station: 0,
        model: 0,
        none: 0,
      };
      c.n += 1;
      if (x.d <= AIR_RADIUS_M) c.station += 1;
      else if (modelled.has(x.id)) c.model += 1;
      else c.none += 1;
      byCountry.set(x.country, c);
    }
    const stationsBy = new Map<string, number>(
      (
        await db.query(
          'SELECT country, count(*) AS n FROM air_quality_stations GROUP BY 1',
        )
      ).rows.map((r) => [r.country as string, Number(r.n)]),
    );
    console.log('  country  campsites  stations  station   model    none');
    let tot = { n: 0, station: 0, model: 0, none: 0 };
    for (const [c, v] of [...byCountry].sort()) {
      console.log(
        `  ${c.toUpperCase().padEnd(7)}  ${String(v.n).padStart(9)}  ${String(stationsBy.get(c) ?? 0).padStart(8)}  ${pct(v.station, v.n).padStart(6)}%  ${pct(v.model, v.n).padStart(5)}%  ${pct(v.none, v.n).padStart(5)}%`,
      );
      tot = {
        n: tot.n + v.n,
        station: tot.station + v.station,
        model: tot.model + v.model,
        none: tot.none + v.none,
      };
    }
    console.log(
      `  ALL      ${String(tot.n).padStart(9)}  ${String(stations).padStart(8)}  ${pct(tot.station, tot.n).padStart(6)}%  ${pct(tot.model, tot.n).padStart(5)}%  ${pct(tot.none, tot.n).padStart(5)}%`,
    );
    console.log(
      `  campsites: station ${tot.station} · model ${tot.model} · none ${tot.none}  (sum ${tot.station + tot.model + tot.none} of ${tot.n})`,
    );
    const stationCountries = new Set(stationsBy.keys());
    const campCountries = new Set(byCountry.keys());
    const noStations = [...campCountries].filter(
      (c) => !stationCountries.has(c),
    );
    console.log(
      `  campsite countries with no station at all: ${noStations.length ? noStations.join(', ') : 'none'}  ` +
        `(countries with stations: ${stationCountries.size}, with campsites: ${campCountries.size})`,
    );

    console.log('\n3. stations and their readings');
    const now = new Date();
    const r3 = (
      await db.query(
        `SELECT count(*) AS n,
                count(*) FILTER (WHERE reading_hour IS NOT NULL) AS with_reading,
                count(*) FILTER (WHERE reading_basis = 'reported') AS reported,
                count(*) FILTER (WHERE reading_basis = 'mixed') AS mixed,
                count(*) FILTER (WHERE reading_hour IS NOT NULL
                   AND $1::timestamptz - reading_hour <= $2 * interval '1 hour') AS fresh
           FROM air_quality_stations`,
        [new Date(hourStart(now)).toISOString(), AIR_FRESH_FOR_HOURS],
      )
    ).rows[0];
    const n = Number(r3.n);
    console.log(`  stations                            ${n}`);
    console.log(
      `  hold a reading                      ${r3.with_reading}  (reported ${r3.reported}, mixed ${r3.mixed})`,
    );
    console.log(
      `  within ${AIR_FRESH_FOR_HOURS} h of the current hour        ${r3.fresh}  ${pct(Number(r3.fresh), n)}%`,
    );
    console.log(
      `  NOT fresh — silent, old or no file  ${n - Number(r3.fresh)}  ${pct(n - Number(r3.fresh), n)}%`,
    );

    if (process.argv.includes('--proxy')) await proxy(near, now);
  } finally {
    await db.end();
  }
}

async function proxy(near: Near[], now: Date) {
  const perBand = arg('per-band', 1500);
  const seed = arg('seed', 5);
  const rand = rng(seed);

  const bands = new Map<number, Near[]>();
  for (const x of near) {
    if (x.d > MAX_BAND_M) continue;
    const b = Math.floor(x.d / BAND_M);
    bands.set(b, [...(bands.get(b) ?? []), x]);
  }
  const sample: Near[] = [];
  for (const b of [...bands.keys()].sort((a, c) => a - c)) {
    const shuffled = bands
      .get(b)!
      .map((x) => ({ x, k: rand() }))
      .sort((a, c) => a.k - c.k);
    sample.push(...shuffled.slice(0, perBand).map((s) => s.x));
  }

  const win = await rasterWindow();
  const current = hourStart(now);
  // `--hours 2026-09-28T06,2026-09-28T14,…` (UTC) replays the examination
  // on hours of your choosing; the default is six spread over the past
  // window, so a rerun on another day uses other hours by itself.
  const hoursArg = process.argv.indexOf('--hours');
  const hours = (
    hoursArg >= 0
      ? process.argv[hoursArg + 1]
          .split(',')
          .map((h) => Date.parse(`${h}:00:00Z`))
      : [-42, -34, -26, -18, -10, -1].map((h) => current + h * 3_600_000)
  ).filter((t) => Number.isFinite(t) && t >= win.start && t <= win.end);
  if (hoursArg >= 0 && hours.length === 0) {
    throw new Error('none of the --hours is inside the raster window');
  }

  console.log(
    `\n4. does the model at the STATION stand in for the model at the campsite?`,
  );
  console.log(
    `   ${sample.length} campsites (${perBand} per 5 km band), ${hours.length} hours: ${hours.map((h) => new Date(h).toISOString().slice(0, 13)).join(' ')}`,
  );

  interface Cell {
    pairs: number;
    agree: number;
    interesting: number;
    interestingAgree: number;
  }
  const cells = new Map<number, Cell>();
  const byType = new Map<string, { pairs: number; agree: number }>();
  let chanceAgree = 0;
  let chancePairs = 0;

  for (const h of hours) {
    const camp = (await fetchModelledBands(sample, h)).bands;
    const stat = (
      await fetchModelledBands(
        sample.map((s) => ({ lon: s.slon, lat: s.slat })),
        h,
      )
    ).bands;
    const both = sample
      .map((s, i) => ({ s, a: camp[i], b: stat[i] }))
      .filter(
        (p): p is { s: Near; a: number; b: number } =>
          p.a !== null && p.b !== null,
      );

    // Chance: the same station levels dealt to the wrong campsites.
    const dealt = both
      .map((p) => ({ b: p.b, k: rand() }))
      .sort((x, y) => x.k - y.k)
      .map((p) => p.b);
    both.forEach((p, i) => {
      chancePairs += 1;
      if (p.a === dealt[i]) chanceAgree += 1;
    });

    for (const { s, a, b } of both) {
      const band = Math.floor(s.d / BAND_M);
      const c = cells.get(band) ?? {
        pairs: 0,
        agree: 0,
        interesting: 0,
        interestingAgree: 0,
      };
      c.pairs += 1;
      if (a === b) c.agree += 1;
      if (a >= 3 || b >= 3) {
        c.interesting += 1;
        if (a === b) c.interestingAgree += 1;
      }
      cells.set(band, c);
      const t = byType.get(s.stationType) ?? { pairs: 0, agree: 0 };
      t.pairs += 1;
      if (a === b) t.agree += 1;
      byType.set(s.stationType, t);
    }
    console.log(
      `   ${new Date(h).toISOString().slice(0, 13)}  ${both.length} of ${sample.length} campsites have a level at both ends`,
    );
  }

  console.log(
    `\n   agreement by distance to the nearest station (chance, dealt at random: ${pct(chanceAgree, chancePairs)}%)`,
  );
  console.log(
    '   band        pairs   agree    pairs where either end is level 3+   agree there',
  );
  for (const b of [...cells.keys()].sort((a, c) => a - c)) {
    const c = cells.get(b)!;
    console.log(
      `   ${String(b * 5).padStart(2)}–${String(b * 5 + 5).padStart(2)} km  ${String(c.pairs).padStart(6)}  ${pct(c.agree, c.pairs).padStart(5)}%   ${String(c.interesting).padStart(20)}   ${pct(c.interestingAgree, c.interesting).padStart(15)}%`,
    );
  }
  console.log(
    `\n   by station kind (all distances): ${[...byType].map(([k, v]) => `${k} ${v.pairs} pairs ${pct(v.agree, v.pairs)}%`).join(' · ')}`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
