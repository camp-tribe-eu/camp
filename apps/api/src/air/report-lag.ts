// CAMP-164: how late do stations report? The measurement behind
// AIR_FRESH_FOR_HOURS, rerunnable.
//
//   npx ts-node src/air/report-lag.ts [--n 240] [--seed 11]
//
// No database and no key: it reads the roster, the current hour's map
// file and N station files from the EEA's blob store, and prints the
// distribution the constant in source.ts quotes.
//
// 🔴 The sample is of the stations that HAVE an index value in the
// current hour's map file — the population the page is about. It is
// random with a seed, but the population changes every hour, so a rerun
// is a re-measurement and not a replay. That is the point: run it at
// different hours and compare with the table in source.ts.

import { airMapUrl, fetchRoster, fetchStationFile, mapPool } from './fetch';
import { hourStart, newestSlotBasis, pickStationReading } from './parse';
import { selectStations } from './import';
import { AIR_FRESH_FOR_HOURS } from './source';

/** mulberry32 — a small seeded generator, so `--seed` means something. */
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

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

async function main() {
  const n = arg('n', 240);
  const seed = arg('seed', 11);
  const now = new Date();
  const hour = new Date(hourStart(now));

  const roster = await fetchRoster();
  const { stations } = selectStations(roster.rows);

  const mapRes = await fetch(airMapUrl(hour));
  if (!mapRes.ok)
    throw new Error(`${airMapUrl(hour)} answered HTTP ${mapRes.status}`);
  const map = JSON.parse(await mapRes.text()) as Record<string, number>;
  const population = stations.filter((s) => (map[s.code] ?? 0) > 0);

  console.log(`now                                   ${now.toISOString()}`);
  console.log(`current hour                          ${hour.toISOString()}`);
  console.log(`EU-27 stations on the roster          ${stations.length}`);
  console.log(`  with an index value in its map file ${population.length}`);

  const rand = rng(seed);
  const sample = [...population]
    .map((s) => ({ s, k: rand() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, n)
    .map((x) => x.s);

  const modelledNow: Record<string, number> = {};
  const ages: Record<string, number> = {};
  let noFile = 0;
  let noReading = 0;
  await mapPool(sample, 6, async (s) => {
    const f = await fetchStationFile(s.code);
    if (f.outcome !== 'ok') {
      noFile += 1;
      return;
    }
    const b = newestSlotBasis(f.body, hourStart(now) + 3_600_000);
    modelledNow[String(b)] = (modelledNow[String(b)] ?? 0) + 1;
    const { reading } = pickStationReading(f.body, now);
    if (!reading) {
      noReading += 1;
      return;
    }
    const age = (hourStart(now) - Date.parse(reading.hour)) / 3_600_000;
    ages[String(age)] = (ages[String(age)] ?? 0) + 1;
  });

  const read = sample.length - noFile;
  console.log(
    `\nsample                                ${sample.length} (seed ${seed}); ${noFile} had no file, ${read} read`,
  );
  console.log(
    `newest slot, current hour included    ${JSON.stringify(modelledNow)}`,
  );
  console.log(`no hour in which anything was reported ${noReading}`);
  console.log(
    '\nage of the newest hour in which something was REPORTED (whole hours before the current one)',
  );
  const keys = Object.keys(ages)
    .map(Number)
    .sort((a, b) => a - b);
  let cum = 0;
  for (const k of keys) {
    cum += ages[String(k)];
    const budget = k === AIR_FRESH_FOR_HOURS ? '   <- AIR_FRESH_FOR_HOURS' : '';
    console.log(
      `  ${String(k).padStart(4)} h  ${String(ages[String(k)]).padStart(5)}   cumulative ${String(cum).padStart(5)}  ${((100 * cum) / read).toFixed(1)}%${budget}`,
    );
  }
  const within = keys
    .filter((k) => k <= AIR_FRESH_FOR_HOURS)
    .reduce((t, k) => t + ages[String(k)], 0);
  console.log(
    `\nwithin ${AIR_FRESH_FOR_HOURS} h: ${within} of ${read} (${((100 * within) / read).toFixed(1)}%)`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
