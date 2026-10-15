// CAMP-246: how many campsites does each hard constraint reject, on the real
// table? A filter that rejects nothing and a filter that rejects everything
// look identical from the outside — both "work" — and only a count tells
// them from one that does its job.
//
//   cd apps/api
//   npx ts-node src/planner/measure-constraints.ts
//
// Exit 1 when a source country code is outside the scope (a country is
// being rejected, or a source has started writing codes we do not read),
// or a rule rejects nothing or keeps nothing where it should do neither.
// Read-only (read-only.ts); reads DATABASE_URL (default: the local
// camptribe_dev).
//
// 🔴 THE RULES ARE THE RULES, NOT A RETYPED COPY. Every count here runs the
// SQL that `hardWhere` builds from HARD — the text the planner runs. A
// rehearsal that writes its own SELECT proves its own SELECT.
//
// 🔴 THE COUNTRY CODES ARE ENUMERATED FROM THE SOURCE, not checked against
// the list we remember: `camping_spots.country` carries 28 codes (the 27
// member states and `AX`, Åland = Finland), and a rule built on the 27
// would reject 19 campsites and exit 0. The scope is read from
// osm/eu.ts, the one place that knows the aliases.

import 'dotenv/config';
import { Client } from 'pg';
import {
  EU_MEMBER_STATES,
  EU_MEMBER_STATES_AND_SUBDIVISIONS,
  normaliseCountry,
} from '../osm/eu';
import { AMENITY_KEYS, AmenityKey } from '../osm/tag-mapping';
import {
  effectiveAmenitiesSql,
  HARD,
  HardRequest,
  hardWhere,
  LonLat,
} from './hard-constraints';
import { inReadOnlyTransaction, Queryable } from './read-only';

export interface Journey {
  name: string;
  line: readonly LonLat[];
  bufferM: number;
}

const BUFFER_M = 30_000;

/**
 * Real A → B journeys, straight lines, the corridor the planner would cut.
 * Chosen to cross borders and to run through very different amounts of
 * campsite country: a coast, the Alps, a plain, and the north.
 */
export const JOURNEYS: readonly Journey[] = [
  {
    name: 'Lyon → Barcelona',
    line: [
      [4.83, 45.76],
      [2.17, 41.39],
    ],
    bufferM: BUFFER_M,
  },
  {
    name: 'Munich → Zagreb',
    line: [
      [11.58, 48.14],
      [15.98, 45.81],
    ],
    bufferM: BUFFER_M,
  },
  {
    name: 'Paris → Amsterdam',
    line: [
      [2.35, 48.86],
      [4.9, 52.37],
    ],
    bufferM: BUFFER_M,
  },
  {
    name: 'Warsaw → Prague',
    line: [
      [21.01, 52.23],
      [14.42, 50.08],
    ],
    bufferM: BUFFER_M,
  },
  {
    name: 'Copenhagen → Stockholm',
    line: [
      [12.57, 55.68],
      [18.07, 59.33],
    ],
    bufferM: BUFFER_M,
  },
];

export interface CodeRow {
  code: string;
  n: number;
}

export interface CodeReport {
  rows: CodeRow[];
  /** Codes the source writes that the scope does not read: rejected, silently. */
  outOfScope: CodeRow[];
  /** Member states with no campsite at all under any code the source uses. */
  membersWithNone: string[];
  /** Codes that are not a member state's own: the ones a naive list loses. */
  subdivisions: CodeRow[];
}

/** The country codes the source ACTUALLY holds, against the scope. */
export async function sourceCountryReport(db: Queryable): Promise<CodeReport> {
  const rows = (
    await db.query(
      `SELECT lower(country) AS code, count(*)::int AS n
         FROM camping_spots GROUP BY 1 ORDER BY n DESC, code`,
    )
  ).rows.map((r) => ({ code: String(r.code), n: Number(r.n) }));
  const inScope = new Set(EU_MEMBER_STATES_AND_SUBDIVISIONS);
  const covered = new Set(rows.map((r) => normaliseCountry(r.code)));
  return {
    rows,
    outOfScope: rows.filter((r) => !inScope.has(r.code)),
    membersWithNone: EU_MEMBER_STATES.filter((m) => !covered.has(m)),
    subdivisions: rows.filter(
      (r) => inScope.has(r.code) && !EU_MEMBER_STATES.includes(r.code),
    ),
  };
}

export interface NeedCount {
  key: AmenityKey;
  yes: number;
  no: number;
  unknown: number;
}

export interface JourneyCount {
  journey: string;
  /** After page and country: what the corridor is cut from. */
  pool: number;
  /** After the corridor too. */
  inCorridor: number;
  needs: NeedCount[];
}

export interface Measurement {
  total: number;
  /** Rows each rule rejects ALONE, over every row. `needs` has none: it asks nothing by itself. */
  alone: Record<string, number>;
  afterPage: number;
  afterCountry: number;
  codes: CodeReport;
  /** The three states of every amenity over the whole scope: page and country, no corridor. */
  eu: NeedCount[];
  journeys: JourneyCount[];
}

const count = async (
  db: Queryable,
  req: HardRequest,
  rules: typeof HARD,
): Promise<number> => {
  const { where, params } = hardWhere(req, 's', 0, rules);
  const r = await db.query(
    `SELECT count(*)::int AS n FROM camping_spots s WHERE ${where}`,
    params,
  );
  return Number(r.rows[0].n);
};

const rule = (id: string) => {
  const r = HARD.find((x) => x.id === id);
  if (!r) throw new Error(`no hard rule "${id}"`);
  return r;
};

/**
 * The three states of each amenity over the rows a WHERE selects. The key is
 * a parameter after the selection's own; a key that is not there is
 * `unknown`, the same as the word.
 */
async function needCounts(
  db: Queryable,
  hard: { where: string; params: unknown[] },
): Promise<NeedCount[]> {
  const eff = effectiveAmenitiesSql('s');
  const k = hard.params.length + 1;
  const out: NeedCount[] = [];
  for (const key of AMENITY_KEYS) {
    const s = (
      await db.query(
        `SELECT count(*) FILTER (WHERE ${eff} ->> $${k} = 'yes')::int AS yes,
                count(*) FILTER (WHERE ${eff} ->> $${k} = 'no')::int AS no,
                count(*) FILTER (WHERE ${eff} ->> $${k} IS DISTINCT FROM 'yes'
                                   AND ${eff} ->> $${k} IS DISTINCT FROM 'no')::int AS unknown
           FROM camping_spots s WHERE ${hard.where}`,
        [...hard.params, key],
      )
    ).rows[0];
    out.push({
      key,
      yes: Number(s.yes),
      no: Number(s.no),
      unknown: Number(s.unknown),
    });
  }
  return out;
}

/** Any one-point request will do for rules that ignore the line. */
const ANYWHERE: HardRequest = { line: [[10, 50]], bufferM: 1 };

export async function measureConstraints(
  db: Queryable,
  journeys: readonly Journey[] = JOURNEYS,
): Promise<Measurement> {
  const total = Number(
    (await db.query('SELECT count(*)::int AS n FROM camping_spots')).rows[0].n,
  );
  const afterPage = await count(db, ANYWHERE, [rule('page')]);
  const afterCountry = await count(db, ANYWHERE, [
    rule('page'),
    rule('country'),
  ]);
  const alone: Record<string, number> = {
    page: total - afterPage,
    country: total - (await count(db, ANYWHERE, [rule('country')])),
  };

  const out: JourneyCount[] = [];
  for (const j of journeys) {
    const req: HardRequest = { line: j.line, bufferM: j.bufferM };
    const upTo = [rule('page'), rule('country'), rule('corridor')];
    const hard = hardWhere(req, 's', 0, upTo);
    out.push({
      journey: j.name,
      pool: afterCountry,
      inCorridor: await count(db, req, upTo),
      needs: await needCounts(db, hard),
    });
  }
  const eu = await needCounts(
    db,
    hardWhere(ANYWHERE, 's', 0, [rule('page'), rule('country')]),
  );

  return {
    total,
    alone,
    afterPage,
    afterCountry,
    codes: await sourceCountryReport(db),
    eu,
    journeys: out,
  };
}

const pct = (n: number, of: number) =>
  of === 0 ? 'n/a' : `${((100 * n) / of).toFixed(1)}%`;

/**
 * What is wrong with a measurement. Empty means every rule does a job.
 * `country` is allowed to reject nothing — it is a guard on the scope, and
 * a clean source gives it nothing to do — but only while no source code
 * lies outside the scope.
 */
export function problemsOf(m: Measurement): string[] {
  const out: string[] = [];
  for (const c of m.codes.outOfScope) {
    out.push(
      `source country code "${c.code}" (${c.n} campsites) is outside the scope: ` +
        `the country rule rejects them, and a source that has started writing ` +
        `a new spelling is losing a member state`,
    );
  }
  if (m.alone.page === 0) out.push('page: rejects nothing');
  if (m.afterPage === 0) out.push('page: rejects everything');
  if (m.afterCountry === 0) out.push('country: rejects everything');
  for (const j of m.journeys) {
    if (j.inCorridor === 0) out.push(`${j.journey}: the corridor is empty`);
    if (j.inCorridor === j.pool) {
      out.push(`${j.journey}: the corridor rejects nothing`);
    }
  }
  return out;
}

export function format(m: Measurement, measuredFrom: string): string {
  const L: string[] = [];
  const num = (n: number) => String(n).padStart(7);
  L.push(`Hard constraints, measured ${measuredFrom}`);
  L.push(`rows in camping_spots: ${m.total}`);
  L.push('');
  L.push(
    'source country codes (enumerated from the table, not from our list):',
  );
  L.push(
    '  ' +
      m.codes.rows.map((r) => `${r.code.toUpperCase()} ${r.n}`).join(' · '),
  );
  L.push(
    `  ${m.codes.rows.length} codes; outside the scope: ` +
      (m.codes.outOfScope.length
        ? m.codes.outOfScope
            .map((r) => `${r.code.toUpperCase()} ${r.n}`)
            .join(', ')
        : 'none') +
      `; member states with no campsite: ` +
      (m.codes.membersWithNone.length
        ? m.codes.membersWithNone.join(', ').toUpperCase()
        : 'none') +
      `; written other than the member's own code: ` +
      (m.codes.subdivisions.length
        ? m.codes.subdivisions
            .map((r) => `${r.code.toUpperCase()} ${r.n}`)
            .join(', ')
        : 'none'),
  );
  L.push('');
  L.push('rule         rejects alone        of every row');
  L.push(
    `page       ${num(m.alone.page)}   ${pct(m.alone.page, m.total).padStart(6)}   (no page: missing, no region, or a hidden secondary)`,
  );
  L.push(
    `country    ${num(m.alone.country)}   ${pct(m.alone.country, m.total).padStart(6)}   (outside the EU-27 scope)`,
  );
  L.push('');
  L.push(
    `funnel over every row: ${m.total} -> page ${m.afterPage} -> country ${m.afterCountry}`,
  );
  const table = (needs: NeedCount[], of: number) => {
    L.push(
      '  amenity            yes      no  unknown   rejected as `no`  would be rejected as `not yes`',
    );
    for (const n of needs) {
      L.push(
        `  ${n.key.padEnd(15)}${num(n.yes)}${num(n.no)}${num(n.unknown)}` +
          `   ${String(n.no).padStart(8)} ${pct(n.no, of).padStart(6)}` +
          `   ${String(n.no + n.unknown).padStart(10)} ${pct(n.no + n.unknown, of).padStart(6)}`,
      );
    }
  };
  L.push('');
  L.push(`whole scope, ${m.afterCountry} campsites with a page:`);
  table(m.eu, m.afterCountry);
  for (const j of m.journeys) {
    L.push('');
    L.push(
      `${j.journey}  (buffer ${BUFFER_M / 1000} km): ${j.pool} -> corridor ${j.inCorridor}` +
        `   rejects ${j.pool - j.inCorridor} (${pct(j.pool - j.inCorridor, j.pool)})`,
    );
    table(j.needs, j.inCorridor);
  }
  return L.join('\n');
}

async function main(): Promise<number> {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev',
  });
  await client.connect();
  let m: Measurement;
  let when = '';
  try {
    ({ m, when } = await inReadOnlyTransaction(client, async () => ({
      m: await measureConstraints(client),
      when: String((await client.query('SELECT now()::text AS t')).rows[0].t),
    })));
  } finally {
    await client.end();
  }
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
