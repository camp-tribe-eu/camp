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
// 🔴 The database is changed only inside a transaction that is rolled
// back (CAMP-255, see `plantOvernight`): nothing this script does is
// visible to anyone else, on CI's fixture or on a developer's own copy.
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
// The words are spelled out on purpose, as everywhere in this list: the
// expected side must not call the code it is checking.
const OVERNIGHT_ALLOWED = `overnight_status = 'allowed'
        AND overnight_source IS NOT NULL
        AND overnight_checked_at IS NOT NULL`;

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
  // 🔴 CAMP-255. The one filter that carries a LEGAL claim — "a pin under
  // this is read as allowed to stay the night" — and until now the one
  // the check never ran. It broke here for a reason no unit test could
  // see: the generated condition named its table (`s.overnight_status`)
  // and this query, like every hand-written one beside it, has no alias.
  {
    name: 'overnight allowed — the confirmed ones, never the unknown',
    query: { overnight: 'allowed' },
    expected: OVERNIGHT_ALLOWED,
  },
  // 🔴 …and the rule the filter exists to keep, on real rows: loosening
  // an AMENITY (`unknown=1`) must not let an unknown-overnight place in.
  {
    name: 'overnight allowed stays strict when an amenity is loosened',
    query: { overnight: 'allowed', amenities: 'toilets', unknown: '1' },
    expected: `${OVERNIGHT_ALLOWED} AND ${NOT_NO('toilets')}`,
  },
];

/**
 * 🔴 CAMP-255. The fixture holds NO overnight answer: ci-seed.sql was cut
 * before the column existed, and the migration makes every row `unknown`.
 * A case about "allowed" would compare 0 rows with 0 rows — which is not
 * a pass, it is a comparison that has never been able to fail (and the
 * "proves nothing" check below would refuse it).
 *
 * So the run plants a few answers, INSIDE the transaction `main()` rolls
 * back — the way verify-links.ts plants a link — rather than editing the
 * seed, which a regeneration would silently undo.
 *
 * The rows are picked by SLUG ORDER, a field the filter under test never
 * reads: choosing them by `overnight_status` would hand the corpus to the
 * thing being measured. Both answers are planted, not only the one the
 * filter asks for, so a filter that returned "anything but unknown" would
 * disagree with the hand-written SQL. The rest stay `unknown`, which is
 * the state of every real row until the importer next reads its tags.
 */
const PLANT = { allowed: 6, forbidden: 6 };

async function plantOvernight(client: Client): Promise<void> {
  const plant = (status: string, source: string, skip: number, take: number) =>
    client.query(
      `UPDATE camping_spots
          SET overnight_status = $1,
              overnight_source = $2,
              overnight_checked_at = DATE '2026-10-12'
        WHERE slug IN (SELECT slug FROM camping_spots
                        WHERE missing_since IS NULL
                          AND location && ST_MakeEnvelope($3, $4, $5, $6, 4326)
                        ORDER BY slug OFFSET $7 LIMIT $8)`,
      [status, source, ...BOX, skip, take],
    );
  await plant('allowed', 'osm:motorhome=yes', 0, PLANT.allowed);
  await plant('forbidden', 'osm:motorhome=no', PLANT.allowed, PLANT.forbidden);

  // The planting must have taken, and must have left both kinds of row
  // the filter has to tell apart.
  const seen = (
    await client.query(
      `SELECT overnight_status AS status, count(*)::int AS n
         FROM camping_spots
        WHERE missing_since IS NULL
          AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)
        GROUP BY 1`,
      BOX,
    )
  ).rows as { status: string; n: number }[];
  const n = (status: string) => seen.find((r) => r.status === status)?.n ?? 0;
  if (n('allowed') < 1 || n('forbidden') < 1 || n('unknown') < 1) {
    throw new Error(
      `overnight planting did not leave all three kinds of row: ` +
        JSON.stringify(seen),
    );
  }
}

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
  await client.query('BEGIN');

  let failed = 0;
  let ran = 0;
  let rehearsed = 0;

  try {
    await plantOvernight(client);

    for (const c of CASES) {
      ran++;
      // 🔴 One broken case costs one case. A query that does not even run
      // used to escape as a stack trace and hide every case after it; a
      // savepoint keeps the transaction usable so the rest still report.
      await client.query('SAVEPOINT one_case');
      let got: string[];
      let want: string[];
      try {
        got = await slugsFromGenerator(client, c.query);
        want = await slugsFromHandWritten(client, c.expected);
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT one_case');
        console.error(
          `  ✗ ${c.name}\n      SQL error: ${(err as Error).message}`,
        );
        failed++;
        continue;
      }

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
        rehearsed++;
      }
    }
  } finally {
    // Whatever happened above, nothing planted survives.
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }

  if (failed) {
    console.error(
      `\n✗ ${failed} filter case(s) disagree with hand-written SQL`,
    );
    process.exitCode = 1;
    return;
  }
  // 🔴 CAMP-286. The count is asserted and the line names this file: a
  // case deleted from CASES printed the same sentence over fewer
  // comparisons, and a generic phrase is a lock another key opens.
  // 🔴 A LITERAL, not `CASES.length`. The first version compared the
  // loop's counter to the length of the very list it iterates, so the
  // two moved together and a deleted case was invisible — the same
  // "a printed total is not a check" defect this card keeps finding,
  // one layer in.
  const EXPECTED_CASES = 12;
  if (ran !== EXPECTED_CASES) {
    console.error(`\n✗ ${ran} cases ran, expected ${EXPECTED_CASES}`);
    process.exitCode = 1;
    return;
  }

  // 🔴 THE NAMED LINE BELONGS TO THE SELF-TEST, AND ONLY TO IT.
  //
  // The first version printed it on both paths, so the CI step's lock
  // was satisfied by an ordinary run: review dropped `--self-test` from
  // the step and it still exited 0, while the one rehearsal that proves
  // a mismatch is visible had never run. A lock a plain run can open is
  // not a lock (CAMP-286).
  if (selfTest) {
    const EXPECTED_REHEARSALS = 1;
    if (rehearsed !== EXPECTED_REHEARSALS) {
      console.error(
        `\n✗ ${rehearsed} rehearsals ran, expected ${EXPECTED_REHEARSALS}`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `\n✓ verify-filters self-test: ${ran} filter combinations match a ` +
        `direct SQL query, and ${rehearsed} planted mismatch is still seen`,
    );
    return;
  }

  console.log('\n✓ every filter combination matches a direct SQL query');
}

// Guarded like every other script here: an import must not run it.
//
// 🔴 CAMP-286: and an unknown flag is refused BEFORE `main()` opens a
// connection. `--selftest` used to fall through to the full run.
if (require.main === module) {
  void (async () => {
    const { chooseAction } =
      await import('../../../../scripts/lib/entrypoint.mjs');
    chooseAction(process.argv.slice(2), ['--self-test'], 'verify-filters.ts');
    await main();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
