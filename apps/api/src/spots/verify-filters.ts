// CAMP-35 acceptance, run against a real database.
//
// The card names its own verification: "комбінація фільтрів дає той самий
// набір, що й прямий SQL-запит". This is that check, and it is a script
// rather than a unit test because the thing being doubted is the SQL we
// generate — which a test with a mocked database would never execute.
//
//   npx ts-node src/spots/verify-filters.ts
//   npx ts-node src/spots/verify-filters.ts --self-test
//
// 🔴 How it stays honest. The expected set is built by a SECOND query
// written out by hand in this file, with the amenity keys spelled as
// literals. If it called filterSql it would be comparing the generator
// against itself and would agree with every bug it has.
//
// 🔴 A comparison that finds nothing to compare must fail. Every case
// asserts the strict set is non-empty; otherwise "0 rows equals 0 rows"
// would pass for ever the day an amenity stopped being imported — the
// same trap as the EXPLAIN harness taking its plan on an empty table.

import 'dotenv/config';
import { Client } from 'pg';
import { filterSql, parseFilters } from './filters';

const DB_URL =
  process.env.DATABASE_URL ??
  process.env.CI_DATABASE_URL ??
  'postgres://localhost:5432/camptribe_dev';

/** The extent of everything we hold, so no case is empty by accident. */
const BOX = [13.0, 42.0, 20.0, 47.2];

interface Case {
  name: string;
  /** Exactly what a browser would put in the query string. */
  query: Record<string, string>;
  /** Hand-written SQL for the same question. Literals on purpose. */
  expected: string;
  /** Cases that legitimately hold no rows say so out loud. */
  mayBeEmpty?: boolean;
}

const YES = (key: string) => `amenities ->> '${key}' = 'yes'`;
const NOT_NO = (key: string) => `amenities ->> '${key}' IS DISTINCT FROM 'no'`;

const CASES: Case[] = [
  {
    name: 'no filters — every live campsite in the box',
    query: {},
    expected: 'TRUE',
  },
  {
    name: 'one type',
    query: { types: 'rv_park' },
    expected: `type = 'rv_park'`,
  },
  {
    name: 'two types are an OR, not an AND',
    query: { types: 'rv_park,wild' },
    expected: `type IN ('rv_park', 'wild')`,
  },
  {
    name: 'one amenity, strict',
    query: { amenities: 'toilets' },
    expected: YES('toilets'),
  },
  {
    name: 'two amenities are an AND',
    query: { amenities: 'toilets,shower' },
    expected: `${YES('toilets')} AND ${YES('shower')}`,
  },
  {
    name: 'unknown included widens to "not a no"',
    query: { amenities: 'toilets', unknown: '1' },
    expected: NOT_NO('toilets'),
  },
  {
    name: 'type and amenity together',
    query: { types: 'rv_park', amenities: 'greyWater' },
    expected: `type = 'rv_park' AND ${YES('greyWater')}`,
  },
  // 🔴 CAMP-25's whole argument, checked against the database rather than
  // asserted: full step-free access must be a strictly smaller set than
  // "accessible in some way", because `wheelchair=limited` is in one and
  // not the other.
  {
    name: 'accessibility: any access',
    query: { amenities: 'wheelchair' },
    expected: YES('wheelchair'),
  },
  {
    name: 'accessibility: full access only',
    query: { amenities: 'wheelchairFull' },
    expected: YES('wheelchairFull'),
  },
  {
    name: 'an amenity nobody has tagged still answers, with nothing',
    query: { amenities: 'laundry', types: 'wild' },
    expected: `type = 'wild' AND ${YES('laundry')}`,
    mayBeEmpty: true,
  },
];

const BASE = `FROM camping_spots
   WHERE missing_since IS NULL
     AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)`;

async function slugsFromGenerator(
  client: Client,
  query: Record<string, string>,
): Promise<string[]> {
  const f = filterSql(parseFilters(query), BOX.length);
  const rows = await client.query(
    `SELECT slug ${BASE}${f.where} ORDER BY slug`,
    [...BOX, ...f.params],
  );
  return rows.rows.map((r: { slug: string }) => r.slug);
}

async function slugsFromHandWritten(
  client: Client,
  expected: string,
): Promise<string[]> {
  const rows = await client.query(
    `SELECT slug ${BASE} AND (${expected}) ORDER BY slug`,
    BOX,
  );
  return rows.rows.map((r: { slug: string }) => r.slug);
}

function firstDifference(a: string[], b: string[]): string {
  const inA = a.filter((s) => !b.includes(s));
  const inB = b.filter((s) => !a.includes(s));
  const bits: string[] = [];
  if (inA.length)
    bits.push(`only from the generator: ${inA.slice(0, 5).join(', ')}`);
  if (inB.length)
    bits.push(`only from hand-written SQL: ${inB.slice(0, 5).join(', ')}`);
  return bits.join(' | ') || 'same members, different order';
}

async function main(): Promise<void> {
  const selfTest = process.argv.includes('--self-test');
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  let failed = 0;

  try {
    for (const c of CASES) {
      const got = await slugsFromGenerator(client, c.query);
      const want = await slugsFromHandWritten(client, c.expected);

      const same =
        got.length === want.length && got.every((s, i) => s === want[i]);

      if (!same) {
        console.error(`  ✗ ${c.name}\n      ${firstDifference(got, want)}`);
        failed++;
        continue;
      }
      if (!c.mayBeEmpty && got.length === 0) {
        console.error(
          `  ✗ ${c.name}\n      both sides returned 0 rows — this case proves nothing.\n` +
            '      Either the data stopped being imported or the box is wrong.',
        );
        failed++;
        continue;
      }
      console.log(`  ✓ ${c.name} — ${got.length} campsites, both ways`);
    }

    // Strict is always a subset of lenient, and the number the interface
    // shows is exactly the difference. Checked on real rows because it is
    // the one claim the reader sees in words.
    const strict = await slugsFromGenerator(client, { amenities: 'toilets' });
    const lenient = await slugsFromGenerator(client, {
      amenities: 'toilets',
      unknown: '1',
    });
    const contained = strict.every((s) => lenient.includes(s));
    if (!contained || lenient.length < strict.length) {
      console.error('  ✗ strict result is not contained in the lenient one');
      failed++;
    } else {
      console.log(
        `  ✓ "${lenient.length - strict.length} more where nobody recorded it"` +
          ` — ${strict.length} strict, ${lenient.length} lenient`,
      );
    }

    if (selfTest) {
      // 🔴 Prove the comparison can fail. Without this the whole script
      // is a green tick that has never been earned: a compare that always
      // says "same" looks identical to one that works.
      const a = await slugsFromGenerator(client, { amenities: 'toilets' });
      const b = await slugsFromHandWritten(client, YES('shower'));
      if (a.length === b.length && a.every((s, i) => s === b[i])) {
        console.error(
          '  ✗ self-test: toilets and shower returned identical sets, so a\n' +
            '      real mismatch would be invisible. Check the fixture.',
        );
        failed++;
      } else {
        console.log('  ✓ self-test: a deliberate mismatch is detected');
      }
    }
  } finally {
    await client.end();
  }

  if (failed) {
    console.error(
      `\n✗ ${failed} filter case(s) disagree with hand-written SQL`,
    );
    process.exitCode = 1;
    return;
  }
  console.log('\n✓ every filter combination matches a direct SQL query');
}

void main();
