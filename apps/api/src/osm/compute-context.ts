// CAMP-33: compute what is around each campsite, and store it.
//
//   cd apps/api
//   npx ts-node src/osm/compute-context.ts [--all] [--country SI]
//
// Default is incremental: a spot is recomputed only if it has no context
// yet or if it has moved since the last run. `--all` forces everything.
//
// 🔴 What this buys us. We have no photographs and, for most sites, no
// amenity tags. What we can have that nobody else publishes is the
// surroundings: a lake 98 m away, the town 2.6 km off, a railway station
// you could actually arrive at. Park4Night, Campercontact and ACSI give
// none of it. It is also the kind of specific, checkable fact an
// assistant repeats when someone asks for "a campsite by a lake near
// Bled" — which is the whole AEO argument for the project.
//
// Two sources, and the card was wrong about one of them. Distances come
// from OSM through PostGIS exactly as the card says. Elevation does not:
// OSM has no systematic heights — `ele` sits on summits, not on fields —
// so height and relief come from a DEM, via Open-Meteo's elevation
// endpoint (Copernicus, 90 m). See the note by ELEVATION_URL.

import 'dotenv/config';
import { Client } from 'pg';
import {
  classifyTerrain,
  NearestFeature,
  NearestWater,
  SpotContext,
  WaterKind,
} from './spot-context';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/**
 * Open-Meteo's elevation endpoint, the same provider chosen in CAMP-91.
 *
 * Copernicus DEM at 90 m, up to 100 coordinates per request (measured —
 * 400 returns HTTP 400 with an explicit message). Elevation never
 * changes, so this runs once per campsite and the answer is stored; it is
 * not a runtime dependency and nothing on the site calls it.
 *
 * 🔴 The free tier is non-commercial (debt #14). Batch computation during
 * development is prototyping, which their terms permit in as many words;
 * the day affiliate links go live this must already be running against
 * customer-api with a key, like every other Open-Meteo call.
 */
const ELEVATION_URL =
  process.env.OPEN_METEO_BASE_URL ?? 'https://api.open-meteo.com';
const ELEVATION_BATCH = 100;

/** Points sampled around a site to describe the ground it sits in. */
const RELIEF_RADIUS_M = 1000;
const RELIEF_SAMPLES = 8;

/**
 * Pause between elevation batches. With 8 relief samples per campsite,
 * a thousand sites is ~100 requests; at this pace the run stays inside
 * Open-Meteo's per-minute allowance instead of provoking the 20-second
 * penalty that a 429 costs.
 */
const BATCH_PAUSE_MS = 700;

const argv = process.argv.slice(2);
const FORCE_ALL = argv.includes('--all');
const COUNTRY = (() => {
  const i = argv.indexOf('--country');
  return i >= 0 && argv[i + 1] ? argv[i + 1].toUpperCase() : null;
})();

interface SpotRow {
  id: string;
  slug: string;
  lat: number;
  lon: number;
  context: SpotContext;
  water_m: number | null;
  water_kind: string | null;
  water_name: string | null;
  town_m: number | null;
  town_name: string | null;
  shop_m: number | null;
  shop_name: string | null;
  rail_m: number | null;
  rail_name: string | null;
}

/**
 * Every distance in one statement.
 *
 * LATERAL plus `<->` per feature class: the KNN operator walks the GiST
 * index instead of measuring every row, so this stays the same shape
 * whether the table holds 300 campsites or 50,000. Ordering is by planar
 * `<->` and the reported number is `ST_Distance` on geography — ordering
 * by geography distance directly would not use the index, and at these
 * ranges the two orderings do not disagree.
 *
 * 🔴 Water is filtered to lakes, reservoirs, rivers and the coastline.
 * Slovenia's extract holds 26,654 streams against 338 lakes, so "nearest
 * water" without a filter would nearly always be a drainage ditch a few
 * metres away — technically true, useless to a camper, and it would make
 * every campsite in the country look waterfront.
 */
const CONTEXT_SQL = `
  SELECT s.id, s.slug,
         ST_Y(s.location::geometry) AS lat,
         ST_X(s.location::geometry) AS lon,
         s.context,
         w.m AS water_m, w.kind AS water_kind, w.name AS water_name,
         t.m AS town_m,  t.name AS town_name,
         p.m AS shop_m,  p.name AS shop_name,
         r.m AS rail_m,  r.name AS rail_name
    FROM camping_spots s
    LEFT JOIN LATERAL (
      SELECT round(ST_Distance(s.location::geography, x.geom::geography)) AS m,
             CASE
               WHEN x."natural" = 'coastline' THEN 'sea'
               WHEN x.water IN ('lake','reservoir') THEN x.water
               ELSE 'river'
             END AS kind,
             x.name
        FROM osm_ctx_water x
       WHERE x.water IN ('lake','reservoir','river')
          OR x.waterway = 'river'
          OR x."natural" = 'coastline'
       ORDER BY s.location <-> x.geom LIMIT 1
    ) w ON true
    LEFT JOIN LATERAL (
      SELECT round(ST_Distance(s.location::geography, x.geom::geography)) AS m, x.name
        FROM osm_ctx_place x
       WHERE x.place IN ('city','town')
       ORDER BY s.location <-> x.geom LIMIT 1
    ) t ON true
    LEFT JOIN LATERAL (
      SELECT round(ST_Distance(s.location::geography, x.geom::geography)) AS m, x.name
        FROM osm_ctx_poi x
       WHERE x.shop = 'supermarket'
       ORDER BY s.location <-> x.geom LIMIT 1
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT round(ST_Distance(s.location::geography, x.geom::geography)) AS m, x.name
        FROM osm_ctx_poi x
       WHERE x.railway IN ('station','halt')
       ORDER BY s.location <-> x.geom LIMIT 1
    ) r ON true
   WHERE s.missing_since IS NULL
     AND ($1::text IS NULL OR upper(s.country) = $1)`;

/** Eight points on a circle, for the relief of the bowl around a site. */
function ring(lat: number, lon: number): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  for (let i = 0; i < RELIEF_SAMPLES; i++) {
    const a = (2 * Math.PI * i) / RELIEF_SAMPLES;
    const dLat = (RELIEF_RADIUS_M * Math.cos(a)) / 111_320;
    const dLon =
      (RELIEF_RADIUS_M * Math.sin(a)) /
      (111_320 * Math.cos(lat * (Math.PI / 180)));
    out.push({ lat: +(lat + dLat).toFixed(5), lon: +(lon + dLon).toFixed(5) });
  }
  return out;
}

/**
 * Elevations for a list of points, in request order.
 *
 * 🔴 Two things here are load-bearing, and the first version got both
 * wrong in a way that produced plausible-looking output:
 *
 *   • The returned array MUST be the same length as the request. If a
 *     short answer were appended as-is, every later point would shift by
 *     the difference and campsites would silently inherit each other's
 *     altitude. Nothing downstream could detect that, so it is checked
 *     here and treated as a failed batch.
 *   • A failure must be visible. The progress counter used to be written
 *     with `\r` on the same line, so a warning printed between two
 *     updates was immediately overwritten — three batches failed on the
 *     first real run and the only trace was a coverage number that came
 *     out at 87.7% instead of 100%.
 */
/** Not a failure to retry: the budget is gone until tomorrow. */
class DailyLimitReached extends Error {}

async function elevations(
  points: { lat: number; lon: number }[],
  label: string,
): Promise<{ values: (number | null)[]; failedBatches: number }> {
  const out: (number | null)[] = [];
  let failedBatches = 0;

  for (let i = 0; i < points.length; i += ELEVATION_BATCH) {
    const chunk = points.slice(i, i + ELEVATION_BATCH);
    const url =
      `${ELEVATION_URL}/v1/elevation` +
      `?latitude=${chunk.map((p) => p.lat).join(',')}` +
      `&longitude=${chunk.map((p) => p.lon).join(',')}`;

    let got: (number | null)[] | null = null;
    let lastError = '';

    // 🔴 Node's fetch has no default timeout: a connection that is
    // accepted and then goes quiet hangs for ever. This runs unattended
    // every week (CAMP-28), so "for ever" means a job that never
    // finishes and never fails — the one outcome nobody gets alerted
    // about. Observed here as a 9-minute silence with the process at 0%
    // CPU while I worked out whether it was stuck or merely slow.
    const TIMEOUT_MS = 30_000;

    // 🔴 Patience is measured in attempts, and four was not enough.
    //
    // Observed on the Croatian import: the run sails through the first
    // couple of thousand sample points and then starts collecting 429s,
    // which is consistent with the free tier's 5,000 calls/hour counting
    // each LOCATION rather than each HTTP request — 6,320 relief samples
    // in one run crosses that, while 64 requests comes nowhere near the
    // 600/minute limit. Their documentation describes weighting by
    // variables and time span, not by location, so this is what the
    // behaviour says rather than what the docs promise.
    //
    // Either way the right response is to wait longer, not to give up:
    // a lost batch is a hundred sample points, about eleven campsites
    // with no terrain. Twelve attempts at twenty seconds rides out a
    // limit boundary; a genuine outage still ends after four minutes.
    const MAX_ATTEMPTS = 12;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !got; attempt++) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        // 🔴 429 and 5xx both mean "come back later", and both deserve
        // the same patience.
        //
        // 429 is their per-minute limit; waiting is the correct response,
        // because hammering gets the whole project blocked and their
        // terms say so in as many words. A 503 is their server under
        // load — and it was being treated as an ordinary error, given
        // three retries two seconds apart, and then given up on. Observed
        // live: one relief batch lost that way writes nulls for a hundred
        // sample points, which is about eleven campsites with no terrain.
        // They are picked up again on the next run, but only because the
        // selection above looks for the gap; there is no reason to create
        // it in the first place.
        if (res.status === 429 || res.status >= 500) {
          lastError = `HTTP ${res.status}`;

          // 🔴 The daily limit is not something to wait out.
          //
          // Open-Meteo says it in as many words — "Daily API request
          // limit exceeded. Please try again tomorrow." — and the free
          // tier allows 10,000 calls a day. We made 74 HTTP requests
          // before hitting it, which is only possible if each LOCATION
          // in a multi-point request counts as a call: 1,079 elevations
          // plus 8 relief samples each is about 9,700.
          //
          // Retrying that is pointless and impolite: twelve attempts
          // twenty seconds apart, across seventy batches, is four hours
          // of hammering a limit that resets tomorrow. Stop, say why,
          // and let the next run pick up the gap — the selection above
          // already looks for spots whose terrain is missing.
          const body = await res.text().catch(() => '');
          if (/daily .*limit/i.test(body)) {
            throw new DailyLimitReached(
              'Open-Meteo daily limit reached: ' +
                'the free tier counts each coordinate, not each request, ' +
                'so a bulk import of a country spends it in one go. ' +
                'The campsites without surroundings are picked up by the ' +
                'next run; nothing else needs doing.',
            );
          }

          await new Promise((r) => setTimeout(r, 20_000));
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { elevation?: unknown };
        if (!Array.isArray(body.elevation)) throw new Error('no elevation[]');
        if (body.elevation.length !== chunk.length) {
          throw new Error(
            `got ${body.elevation.length} values for ${chunk.length} points`,
          );
        }
        got = body.elevation.map((v) =>
          typeof v === 'number' && Number.isFinite(v) ? v : null,
        );
      } catch (err) {
        if (err instanceof DailyLimitReached) throw err;
        lastError = String(err);
        if (attempt < MAX_ATTEMPTS - 1) {
          // Capped, so a long tail of retries cannot become an hour.
          await new Promise((r) =>
            setTimeout(r, Math.min(20_000, 2000 * (attempt + 1))),
          );
        }
      }
    }

    if (!got) {
      failedBatches++;
      // Own line, before the progress counter is redrawn.
      console.warn(`\n  ⚠ ${label} batch at ${i} gave up: ${lastError}`);
      got = chunk.map(() => null);
    }

    out.push(...got);

    // 🔴 `\r` only works on a terminal. Redirected to a file or a CI log
    // it writes a line that never ends, so a run that takes twenty
    // minutes looks like a run that produced nothing — which is exactly
    // how three failed batches went unnoticed once before. One line per
    // batch when nobody is watching a terminal.
    const done = Math.min(i + ELEVATION_BATCH, points.length);
    if (process.stdout.isTTY) {
      process.stdout.write(`\r  ${label} ${done}/${points.length}   `);
    } else {
      console.log(`  ${label} ${done}/${points.length}`);
    }

    // 🔴 A deliberate pause between batches.
    //
    // Firing them as fast as the network allows earns a 429, and the
    // handler then waits 20 seconds — so going faster makes the whole
    // run slower, and a batch that exhausts its four attempts is written
    // as nulls, losing the elevation for a hundred campsites silently.
    // Their terms ask for this politeness in as many words.
    if (i + ELEVATION_BATCH < points.length) {
      await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    }
  }

  if (process.stdout.isTTY) process.stdout.write('\n');
  if (out.length !== points.length) {
    // Belt and braces: the invariant the whole alignment rests on.
    throw new Error(
      `elevation alignment broken: ${out.length} values for ${points.length} points`,
    );
  }
  return { values: out, failedBatches };
}

const feature = (
  m: number | null,
  name: string | null,
): NearestFeature | undefined =>
  m === null ? undefined : { m: Number(m), ...(name ? { name } : {}) };

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  for (const table of ['osm_ctx_water', 'osm_ctx_place', 'osm_ctx_poi']) {
    const { rows } = await db.query(
      `SELECT to_regclass($1) IS NOT NULL AS ok`,
      [`public.${table}`],
    );
    if (!rows[0]?.ok) {
      throw new Error(
        `Table ${table} is missing.\n` +
          'Run: ./scripts/osm-pipeline/load-context.sh <region>',
      );
    }
  }

  const { rows } = await db.query<SpotRow>(CONTEXT_SQL, [COUNTRY]);

  // A spot is skipped when its stored context was computed at the same
  // coordinates. Recomputing 300 unchanged rows would be free locally and
  // 50,000 API calls across Europe.
  const todo = rows.filter((r) => {
    if (FORCE_ALL) return true;
    const at = r.context?.at;
    if (!at) return true;
    // Anything the DEM owes us and did not deliver is retried next run.
    // Checking only `elevation` was not enough: a failed ring batch left
    // the height in place and quietly dropped the terrain, and the spot
    // then looked complete for ever.
    if (
      r.context?.elevation === undefined ||
      r.context?.terrain === undefined
    ) {
      return true;
    }
    return (
      Math.abs(at.lat - Number(r.lat)) > 1e-5 ||
      Math.abs(at.lon - Number(r.lon)) > 1e-5
    );
  });

  console.log(
    `\nCAMP-33 context — ${rows.length} spots, ${todo.length} to compute\n`,
  );
  if (todo.length === 0) {
    console.log('  nothing moved since the last run\n');
    await db.end();
    return;
  }

  // Centres first, then every ring point, in one flat list so the batching
  // does not care which spot a point belongs to.
  const centres = todo.map((r) => ({ lat: Number(r.lat), lon: Number(r.lon) }));
  const rings = todo.flatMap((r) => ring(Number(r.lat), Number(r.lon)));
  const centre = await elevations(centres, 'elevation');
  const around = await elevations(rings, 'relief   ');
  const centreEle = centre.values;
  const ringEle = around.values;
  const failedBatches = centre.failedBatches + around.failedBatches;

  let written = 0;
  let noWater = 0;
  let noStation = 0;
  const reliefs: number[] = [];

  await db.query('BEGIN');
  try {
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      const elevation = centreEle[i];
      const ringHeights = ringEle
        .slice(i * RELIEF_SAMPLES, (i + 1) * RELIEF_SAMPLES)
        .filter((v): v is number => v !== null);

      const context: SpotContext = {
        at: { lat: Number(r.lat), lon: Number(r.lon) },
      };

      if (r.water_m !== null) {
        context.water = {
          m: Number(r.water_m),
          kind: (r.water_kind ?? 'river') as WaterKind,
          ...(r.water_name ? { name: r.water_name } : {}),
        } as NearestWater;
      } else noWater++;

      const town = feature(r.town_m, r.town_name);
      if (town) context.town = town;
      const shop = feature(r.shop_m, r.shop_name);
      if (shop) context.supermarket = shop;
      const rail = feature(r.rail_m, r.rail_name);
      if (rail) context.station = rail;
      else noStation++;

      if (elevation !== null) context.elevation = Math.round(elevation);
      if (elevation !== null && ringHeights.length >= RELIEF_SAMPLES / 2) {
        const all = [elevation, ...ringHeights];
        const relief = Math.round(Math.max(...all) - Math.min(...all));
        reliefs.push(relief);
        context.terrain = { relief, type: classifyTerrain(relief) };
      }

      await db.query(
        `UPDATE camping_spots
            SET context = $2, context_computed_at = now()
          WHERE id = $1`,
        [r.id, JSON.stringify(context)],
      );
      written++;
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }

  const filled = await db.query<{ field: string; n: string }>(
    `SELECT f.field, count(*) AS n
       FROM camping_spots s,
            LATERAL (VALUES ('water'),('town'),('supermarket'),
                            ('station'),('elevation'),('terrain')) AS f(field)
      WHERE s.missing_since IS NULL
        AND s.context ? f.field
      GROUP BY 1 ORDER BY 1`,
  );
  const total = rows.length;

  console.log(`  written            ${written}`);
  console.log(`  ─────────────────────────`);
  for (const f of filled.rows) {
    const pct = ((Number(f.n) / total) * 100).toFixed(1);
    const flag = Number(pct) >= 90 ? ' ' : '🔴';
    console.log(
      `  ${flag} ${f.field.padEnd(12)} ${String(f.n).padStart(4)} / ${total}  ${pct}%`,
    );
  }
  if (reliefs.length) {
    reliefs.sort((a, b) => a - b);
    const q = (p: number) => reliefs[Math.floor(reliefs.length * p)];
    console.log(
      `\n  relief quartiles   ${q(0.25)} / ${q(0.5)} / ${q(0.75)} m  (min ${reliefs[0]}, max ${reliefs[reliefs.length - 1]})`,
    );
  }
  if (noWater) console.log(`  without water      ${noWater}`);
  if (noStation) console.log(`  without station    ${noStation}`);
  if (failedBatches) {
    console.log(
      `  ⚠ failed batches   ${failedBatches}  (rerun to fill them in)`,
    );
  }

  // The card's own bar: "fields filled for >90% of a country's records".
  // Exiting non-zero makes that a gate rather than a number somebody
  // reads once — a partial DEM run is exactly the failure that otherwise
  // ships looking fine.
  const worst = filled.rows.reduce(
    (min, f) => Math.min(min, Number(f.n) / total),
    1,
  );
  if (worst < 0.9) {
    const weakest = filled.rows.filter((f) => Number(f.n) / total < 0.9);
    console.error(
      `\n✗ below the 90% bar: ` +
        weakest
          .map((f) => `${f.field} ${((Number(f.n) / total) * 100).toFixed(1)}%`)
          .join(', ') +
        '\n',
    );
    await db.end();
    process.exitCode = 1;
    return;
  }

  console.log(
    `\n✓ every field above 90% (worst ${(worst * 100).toFixed(1)}%)\n`,
  );
  await db.end();
}

if (require.main === module) {
  main().catch((err) => {
    // A limit we have been told to wait out is not a crash: say it in one
    // sentence, without a stack trace nobody needs.
    if (err instanceof DailyLimitReached) {
      console.error(`\n⚠ ${err.message}\n`);
    } else {
      console.error(err);
    }
    // 🔴 Exit, rather than only setting exitCode.
    //
    // On this path the Postgres client is still open, its socket keeps
    // the event loop alive, and the process hangs for ever having
    // already printed the failure. For a weekly unattended job that is
    // the worst shape of failure: the reason is reported and the run
    // never ends, so what the workflow eventually shows is a timeout
    // instead. Found by watching a run sit for ten minutes after it had
    // already decided to give up.
    process.exit(1);
  });
}
