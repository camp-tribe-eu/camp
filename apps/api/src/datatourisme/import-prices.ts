// CAMP-147: put the feed's price list into the database.
//
//   npx ts-node src/datatourisme/import-prices.ts <feed.zip>           # dry run
//   npx ts-node src/datatourisme/import-prices.ts <feed.zip> --apply
//   npx ts-node src/datatourisme/import-prices.ts <feed.zip> --report  # no DB
//
// 🔴 A dry run by default, like the campsite importer next to it, and
// for a sharper reason. This writes PRICES onto pages that already rank.
// A wrong join publishes one business's tariffs on another's page, and
// the reader who books on that number finds out at the barrier.
//
// 🔴 It NEVER creates a campsite. The feed's campsites were already
// imported and matched against OpenStreetMap (CAMP-101, CAMP-144, 2 986
// live links); a price whose POI has no row here is counted in the
// report and dropped. Inventing a campsite to hang a price on would
// spawn the third copy CAMP-144 exists to prevent.
//
// 🔴 What a full pass of the real archive measured, 28.09.2026:
//
//     objects                                       129 594
//     campsites                                       9 590
//     ├─ with an offers block                         6 962
//     ├─ with schema:priceSpecification               4 360
//     ├─ with textPriceSpecification (prose)            407
//     └─ with a NUMBER                                3 689   (38.5%)
//     numeric price specifications                   14 265
//     └─ of those, carrying a validity period         6 913
//
// The card said 4 459 campsites "have a REAL price". That number is the
// union of the two price blocks, and 671 of the campsites inside it
// carry specifications with a currency and no amount. The measured count
// of campsites the feed states a number for is 3 689.

import 'dotenv/config';
import { Client } from 'pg';
import { readArchive } from './feed-archive';
import { parsePrices } from './prices';
import type { ParsedPrices, ParsedTariff, RejectReason } from './prices';

const SOURCE_ID = 'datatourisme';
const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/** Rows per INSERT. 500 × 15 columns is well inside Postgres' limits. */
const BATCH = 500;

export type FeedTally = {
  objects: number;
  campsites: number;
  withOffers: number;
  withSpecBlock: number;
  withTextPrice: number;
  withNumber: number;
  tariffs: number;
  tariffsWithPeriod: number;
  textNotes: number;
  /** Specifications the parser refused, by reason. */
  refused: Record<RejectReason, number>;
};

export function emptyTally(): FeedTally {
  return {
    objects: 0,
    campsites: 0,
    withOffers: 0,
    withSpecBlock: 0,
    withTextPrice: 0,
    withNumber: 0,
    tariffs: 0,
    tariffsWithPeriod: 0,
    textNotes: 0,
    refused: {
      'no-ref': 0,
      'no-amount': 0,
      'no-currency': 0,
      'range-backwards': 0,
    },
  };
}

/** Does this parsed record carry a validity period on at least one line? */
export function hasPeriod(t: ParsedTariff): boolean {
  return t.validFrom !== null || t.validUntil !== null;
}

export function tally(
  tallied: FeedTally,
  node: Record<string, unknown>,
): ParsedPrices | null {
  tallied.objects++;
  const parsed = parsePrices(node, (reason) => {
    tallied.refused[reason]++;
  });
  if (!parsed) return null;
  tallied.campsites++;

  const offers = Array.isArray(node.offers)
    ? node.offers
    : node.offers
      ? [node.offers]
      : [];
  if (offers.length) tallied.withOffers++;
  if (
    offers.some(
      (o) =>
        o &&
        typeof o === 'object' &&
        (o as Record<string, unknown>)['schema:priceSpecification'] !==
          undefined,
    )
  ) {
    tallied.withSpecBlock++;
  }
  if (parsed.textNotes.length) {
    tallied.withTextPrice++;
    tallied.textNotes += parsed.textNotes.length;
  }
  if (parsed.tariffs.length) {
    tallied.withNumber++;
    tallied.tariffs += parsed.tariffs.length;
    tallied.tariffsWithPeriod += parsed.tariffs.filter(hasPeriod).length;
  }
  return parsed;
}

function pct(n: number, of: number): string {
  return of === 0 ? '—' : `${((100 * n) / of).toFixed(1)}%`;
}

export function printTally(t: FeedTally): void {
  console.log('');
  console.log(`  objects read                    ${t.objects}`);
  console.log(`  campsites (CampingAndCaravanning) ${t.campsites}`);
  console.log(
    `    with an offers block          ${t.withOffers}  ${pct(t.withOffers, t.campsites)}`,
  );
  console.log(
    `    with schema:priceSpecification ${t.withSpecBlock}  ${pct(t.withSpecBlock, t.campsites)}`,
  );
  console.log(
    `    with a NUMBER                 ${t.withNumber}  ${pct(t.withNumber, t.campsites)}`,
  );
  console.log(
    `    with prose only               ${t.withTextPrice}  (${t.textNotes} notes, never parsed)`,
  );
  console.log(`  tariff lines                    ${t.tariffs}`);
  console.log(
    `    carrying a validity period    ${t.tariffsWithPeriod}  ${pct(t.tariffsWithPeriod, t.tariffs)}  <- the only ones a page may show`,
  );
  // 🔴 Itemised, always, even when every count is zero. A parser that
  // drops input silently is indistinguishable from one that reads all of
  // it, and the difference only shows up as a coverage number nobody can
  // account for later.
  const refusedTotal = Object.values(t.refused).reduce((a, b) => a + b, 0);
  console.log(`  specifications refused          ${refusedTotal}`);
  for (const [reason, n] of Object.entries(t.refused)) {
    console.log(`    ${reason.padEnd(28)}${n}`);
  }
  console.log('');
}

/** Every DATAtourisme record we already hold, by its source URI. */
export async function spotIdsByRef(db: Client): Promise<Map<string, string>> {
  const rows = await db.query<{ id: string; ref: string }>(
    `SELECT s.id::text AS id, e->>'ref' AS ref
       FROM camping_spots s, jsonb_array_elements(s.sources) e
      WHERE e->>'id' = $1`,
    [SOURCE_ID],
  );
  const map = new Map<string, string>();
  for (const r of rows.rows) if (r.ref) map.set(r.ref, r.id);
  return map;
}

type Row = [
  string, // spot_id
  string, // source_id
  string, // source_ref
  string | null, // offer
  string | null, // mode
  string | null, // policy
  string | null, // min_price
  string | null, // max_price
  string, // currency
  string | null, // valid_from
  string | null, // valid_until
  string | null, // label
  string | null, // label_lang
  string, // source_updated_at
];

function toRow(spotId: string, t: ParsedTariff, updatedAt: string): Row {
  return [
    spotId,
    SOURCE_ID,
    t.ref,
    t.offer,
    t.mode,
    t.policy,
    t.minPrice === null ? null : t.minPrice.toFixed(2),
    t.maxPrice === null ? null : t.maxPrice.toFixed(2),
    t.currency,
    t.validFrom,
    t.validUntil,
    t.label,
    t.labelLang,
    updatedAt,
  ];
}

/**
 * Write a batch.
 *
 * 🔴 ON CONFLICT DO UPDATE, keyed on (spot, source, ref). A weekly feed
 * re-states the same tariff with the same URI; without this the table
 * would grow a fresh copy of every price every week and the page would
 * print each one four times a month.
 */
async function insertBatch(db: Client, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    const base = i * 14;
    values.push(...r);
    const p = (n: number) => `$${base + n}`;
    return (
      `(${p(1)}::uuid, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ` +
      `${p(7)}::numeric, ${p(8)}::numeric, ${p(9)}, ${p(10)}::date, ` +
      `${p(11)}::date, ${p(12)}, ${p(13)}, ${p(14)}::date)`
    );
  });
  await db.query(
    `INSERT INTO spot_tariffs
       (spot_id, source_id, source_ref, offer, mode, policy,
        min_price, max_price, currency, valid_from, valid_until,
        label, label_lang, source_updated_at)
     VALUES ${tuples.join(', ')}
     ON CONFLICT (spot_id, source_id, source_ref) DO UPDATE SET
       offer = EXCLUDED.offer,
       mode = EXCLUDED.mode,
       policy = EXCLUDED.policy,
       min_price = EXCLUDED.min_price,
       max_price = EXCLUDED.max_price,
       currency = EXCLUDED.currency,
       valid_from = EXCLUDED.valid_from,
       valid_until = EXCLUDED.valid_until,
       label = EXCLUDED.label,
       label_lang = EXCLUDED.label_lang,
       source_updated_at = EXCLUDED.source_updated_at`,
    values,
  );
}

async function main() {
  const path = process.argv[2];
  const apply = process.argv.includes('--apply');
  const reportOnly = process.argv.includes('--report');
  if (!path) {
    console.error('usage: import-prices.ts <feed.zip> [--apply | --report]');
    process.exit(1);
  }

  const counts = emptyTally();

  if (reportOnly) {
    for await (const node of readArchive(path)) tally(counts, node);
    console.log(`read ${path}`);
    printTally(counts);
    return;
  }

  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  try {
    const byRef = await spotIdsByRef(db);
    console.log(
      `${byRef.size} campsites in the database carry a ${SOURCE_ID} ref`,
    );

    if (apply) await db.query('BEGIN');

    let matched = 0;
    let unmatched = 0;
    let queued = 0;
    let pending: Row[] = [];

    for await (const node of readArchive(path)) {
      const parsed = tally(counts, node);
      if (!parsed || parsed.tariffs.length === 0) continue;

      const spotId = byRef.get(parsed.ref);
      if (!spotId) {
        // 🔴 Counted, not created. A POI the campsite import refused —
        // no name, no point, no update date — must not come back through
        // the price door.
        unmatched++;
        continue;
      }
      matched++;

      for (const t of parsed.tariffs) {
        pending.push(toRow(spotId, t, parsed.updatedAt));
        queued++;
        if (apply && pending.length >= BATCH) {
          await insertBatch(db, pending);
          pending = [];
        }
      }
    }
    if (apply && pending.length) await insertBatch(db, pending);

    console.log(`read ${path}`);
    printTally(counts);
    console.log(`  priced campsites matched to a row   ${matched}`);
    console.log(`  priced campsites with no row here   ${unmatched}`);
    console.log(
      `  tariff lines ${apply ? 'written' : 'that would be written'}   ${queued}`,
    );

    if (apply) {
      await db.query('COMMIT');
      console.log('\n✓ committed');
    } else {
      console.log('\n(dry run — nothing written; pass --apply)');
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
