// CAMP-262: does each component of the formula change what a reader sees?
//
// The card's own test: take one query, rank its candidates with a component
// on and with it off. If the order did not change, the component weighs
// nothing and has no business in the formula. This runs that test on real
// campsites, for several queries, and says how many positions moved.
//
//   cd apps/api
//   npx ts-node src/planner/ablate-scoring.ts
//
// Exit 1 when a component moved nothing in ANY query (remove it), or a pool
// is too small to say anything. Read-only (read-only.ts); reads DATABASE_URL
// (default: the local camptribe_dev).
//
// A QUERY here is "the campsites within R metres of one target stop", the
// target being where the day's leg wants to sleep. It is not the planner —
// there is no corridor and no day-splitting yet (CAMP-246 and later) — but
// it is the situation the score exists for: many candidates around one
// point, and a choice among them.
//
// 🔴 "MOVED" counts positions, and one campsite jumping five places moves
// the five it passed too, so a large `moved` can be one small change.
// `top10` is the number a reader feels: how many of the ten shown campsites
// are different without the component, and `head` how many of the ten
// positions hold a different campsite (a bonus can reorder the ten without
// replacing any). Print all three; none alone.

import 'dotenv/config';
import { Client } from 'pg';
import { mergedStarsSql } from '../spots/links';
import { plannerPopulationSql } from './population';
import { inReadOnlyTransaction, Queryable } from './read-only';
import { Candidate, ComponentId, rank, SCORING } from './scoring';

export interface Query {
  name: string;
  lon: number;
  lat: number;
  radiusM: number;
}

const R = 30_000;

/**
 * Spread on purpose: one country each, and four border queries where a
 * country-shaped bias would show.
 */
export const QUERIES: readonly Query[] = [
  { name: 'Zeeland NL/BE', lon: 3.9, lat: 51.5, radiusM: R },
  { name: 'Dordogne FR', lon: 1.2, lat: 44.9, radiusM: R },
  { name: 'Perpignan-Figueres FR/ES', lon: 2.95, lat: 42.45, radiusM: R },
  { name: 'Lake Garda IT', lon: 10.7, lat: 45.6, radiusM: R },
  { name: 'Landes FR', lon: -1.2, lat: 44.0, radiusM: R },
  { name: 'Strasbourg-Kehl FR/DE', lon: 7.8, lat: 48.55, radiusM: R },
  { name: 'Jutland DK', lon: 9.5, lat: 56.0, radiusM: R },
  { name: 'Costa Brava ES', lon: 3.1, lat: 41.95, radiusM: R },
  { name: 'Auvergne FR', lon: 3.1, lat: 45.8, radiusM: R },
  { name: 'Provence FR', lon: 5.5, lat: 43.8, radiusM: R },
  { name: 'Istria HR', lon: 13.9, lat: 45.2, radiusM: R },
  { name: 'Lille FR/BE', lon: 3.1, lat: 50.65, radiusM: R },
  { name: 'Menton FR/IT', lon: 7.5, lat: 43.8, radiusM: R },
];

export interface Shift {
  pool: number;
  /** Candidates whose position is different. */
  moved: number;
  /** Members of the first N that are not in the first N without the component. */
  topReplaced: number;
  /** Of the first N positions, how many hold a different campsite. */
  headMoved: number;
  top1Changed: boolean;
}

/**
 * How far two rankings of the SAME candidates are apart.
 * Throws when they are not the same candidates: counting position changes
 * between two different sets would be a number about nothing.
 */
export function compareRankings(
  full: readonly string[],
  ablated: readonly string[],
  topN = 10,
): Shift {
  const a = new Set(full);
  if (
    full.length !== ablated.length ||
    a.size !== full.length ||
    !ablated.every((id) => a.has(id))
  ) {
    throw new Error('the two rankings are not the same set of candidates');
  }
  const head = new Set(ablated.slice(0, topN));
  return {
    pool: full.length,
    moved: full.filter((id, i) => id !== ablated[i]).length,
    topReplaced: full.slice(0, topN).filter((id) => !head.has(id)).length,
    headMoved: full.slice(0, topN).filter((id, i) => id !== ablated[i]).length,
    top1Changed: full.length > 0 && full[0] !== ablated[0],
  };
}

/** One query's pool, ranked with every component and without each in turn. */
export function ablate(
  pool: readonly Candidate[],
  radiusM: number,
  topN = 10,
): Record<ComponentId, Shift> {
  const slugs = (without: ComponentId[]) =>
    rank(pool, radiusM, without).map((c) => c.slug);
  const full = slugs([]);
  const out = {} as Record<ComponentId, Shift>;
  for (const c of SCORING.components) {
    out[c.id] = compareRankings(full, slugs([c.id]), topN);
  }
  return out;
}

type Row = {
  slug: string;
  country: string;
  amenities: Record<string, string>;
  stars: number | null;
  metres: number;
};

export async function loadPool(
  db: Queryable,
  q: Query,
): Promise<Array<Candidate & { country: string }>> {
  const rows = (
    await db.query(
      `WITH here AS (
       SELECT ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography AS g
     )
     SELECT s.slug, s.country, s.amenities,
            ${mergedStarsSql('s')} AS stars,
            ST_Distance(s.location::geography, here.g) AS metres
       FROM camping_spots s, here
      WHERE ${plannerPopulationSql('s')}
        AND ST_DWithin(s.location::geography, here.g, $3)`,
      [q.lon, q.lat, q.radiusM],
    )
  ).rows as unknown as Row[];
  // 🔴 The unit, checked at BOTH ends. ST_Distance on geometry would return
  // degrees: every value under one, and no candidate would be 20 km away.
  // A pool that reaches most of the radius and no further is in metres.
  if (rows.length >= 20) {
    const far = Math.max(...rows.map((r) => r.metres));
    const near = Math.min(...rows.map((r) => r.metres));
    if (!(far > q.radiusM * 0.5 && far <= q.radiusM && near < far)) {
      throw new Error(
        `${q.name}: distances span ${near}..${far} for a radius of ${q.radiusM}m - not metres?`,
      );
    }
  }
  return rows.map((r) => ({
    slug: r.slug,
    country: r.country,
    amenities: r.amenities,
    stars: r.stars,
    distanceM: Number(r.metres),
  }));
}

const mix = (cs: readonly { country: string }[], n: number): string => {
  const counts = new Map<string, number>();
  for (const c of cs.slice(0, n)) {
    counts.set(c.country, (counts.get(c.country) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    .map(([k, v]) => `${k}${v}`)
    .join(' ');
};

async function main(): Promise<number> {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev',
  });
  await client.connect();
  const ids = SCORING.components.map((c) => c.id);
  const moved = Object.fromEntries(ids.map((id) => [id, 0])) as Record<
    ComponentId,
    number
  >;
  let tooSmall = 0;

  try {
    await inReadOnlyTransaction(client, async () => {
      console.log(
        'Rank with every component, then with one switched off.\n' +
          'moved = positions that differ; top10 = of the ten shown, how many are different;\n' +
          'head = of the ten positions, how many hold a different campsite.\n',
      );
      for (const q of QUERIES) {
        const pool = await loadPool(client, q);
        if (pool.length < 20) tooSmall++;
        const shifts = ablate(pool, q.radiusM);
        const full = rank(pool, q.radiusM) as Array<
          Candidate & { country: string }
        >;
        console.log(
          `${q.name}  (pool ${pool.length}, top-20: ${mix(full, 20)})`,
        );
        for (const id of ids) {
          const s = shifts[id];
          moved[id] += s.moved;
          const without = rank(pool, q.radiusM, [id]) as Array<
            Candidate & { country: string }
          >;
          console.log(
            `  without ${id.padEnd(13)} moved ${String(s.moved).padStart(3)}` +
              `   top10 ${String(s.topReplaced).padStart(2)}` +
              `   head ${String(s.headMoved).padStart(2)}` +
              `   top1 ${s.top1Changed ? 'changed' : 'same   '}` +
              `   top-20: ${mix(without, 20)}`,
          );
        }
      }
    });
  } finally {
    await client.end();
  }

  console.log('\nTotal positions moved over all queries:');
  let dead = 0;
  for (const id of ids) {
    const note = moved[id] === 0 ? '   <- changes nothing: remove it' : '';
    if (moved[id] === 0) dead++;
    console.log(`  ${id.padEnd(13)} ${moved[id]}${note}`);
  }
  if (tooSmall) console.log(`\n${tooSmall} query pool(s) under 20: too small.`);
  return dead || tooSmall ? 1 : 0;
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
