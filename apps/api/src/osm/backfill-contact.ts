// CAMP-141: fill `contact` for campsites we already hold, from the OSM
// staging table, without running a full import.
//
// Usage:
//   npx ts-node src/osm/backfill-contact.ts [--dry-run]
//
// 🔴 Why this exists rather than "just run the import".
//
// `import-spots.ts` does the right thing and does more than we want
// here: it marks every campsite of a country that the current extract
// does NOT contain as missing, which is correct for a weekly run over a
// complete extract and destructive for a partial staging table. Running
// it to pick up one new column would tell the site that thousands of
// real campsites had disappeared.
//
// So this touches exactly one column, on rows matched by osm_ref, and
// nothing else — no name, no location, no missing_since, no sources.
// The weekly import fills `contact` for everyone in the ordinary way;
// this is only so the column is not empty until then.
// 🔴 Loaded the way `import-spots.ts` in this directory loads it. The
// header documents `npx ts-node src/osm/backfill-contact.ts`, and
// without this that command connected to a database named after the OS
// user — loudly here, silently on a host where such a database exists.
import 'dotenv/config';
import { Client } from 'pg';
import { mapContact, OsmTags } from './tag-mapping';

const DRY = process.argv.includes('--dry-run');

/**
 * The write, as a named constant so a test can assert what it does.
 *
 * 🔴 This file had no tests at all, and it is the file that caused the
 * worst defect of this card: the first version wrote `contact` alone,
 * so 10 637 pages gained a contact block and kept the old
 * `content_changed_at`, telling crawlers nothing had changed. Review
 * then showed three separate mutations here — dropping the timestamp,
 * dropping the IS DISTINCT guard, skipping empty mappings again — each
 * re-creating a blocker and surviving all 336 tests.
 *
 * The upsert next door is guarded exactly this way, for exactly this
 * reason. "A rule nobody enforces quietly stops applying" has to apply
 * to the file that broke it, not only to the one that did not.
 */
export const BACKFILL_SQL = `UPDATE camping_spots
              SET contact = $2::jsonb,
                  -- 🔴 A contact block appearing on a page is a change a
                  -- reader notices, so <lastmod> must say so (CAMP-39).
                  content_changed_at = now()
            WHERE osm_ref = $1
              -- Idempotent: a rerun that computes the same contact must
              -- not restamp the page.
              AND contact IS DISTINCT FROM $2::jsonb`;

/**
 * The tags `mapContact` reads, and only those.
 *
 * Exported for the same reason as BACKFILL_SQL: it is a contract with
 * the staging table, and a measurement that rebuilds it by hand measures
 * its own typing. One did — a probe that dropped `operator`,
 * `opening_hours` and `capacity` reported 5 937 rows differing where the
 * real list reports what it reports.
 */
export const TAG_COLUMNS = [
  'website',
  'contact:website',
  'url',
  'contact:url',
  'phone',
  'contact:phone',
  'contact:mobile',
  'email',
  'contact:email',
  'operator',
  'opening_hours',
  'capacity',
  'addr:street',
  'addr:housenumber',
  'addr:city',
  'addr:postcode',
];

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const cols = TAG_COLUMNS.map((c) => `st."${c}"`).join(', ');
  const { rows } = await db.query<{ osm_ref: string } & OsmTags>(
    `SELECT cs.osm_ref, ${cols}
       FROM camping_spots cs
       JOIN osm_camping_staging st ON st.id = cs.osm_ref
      WHERE cs.missing_since IS NULL`,
  );

  let changed = 0;
  let empty = 0;
  await db.query('BEGIN');
  try {
    for (const row of rows) {
      const tags: OsmTags = {};
      for (const c of TAG_COLUMNS) tags[c] = row[c] ?? undefined;
      const contact = mapContact(tags);
      // 🔴 An empty mapping CLEARS the column; it does not skip the row.
      //
      // The first version did `continue` here, and review named the
      // consequence before it bit: a campsite whose only contact was a
      // Facebook page, or whose only address was a bare house number,
      // keeps the old value forever once the mapping learns to reject
      // it. Measured after tightening the rules — 3 Facebook URLs and
      // 50 numeric "streets" survived a rerun that was supposed to
      // remove them, because the rows they lived on now map to {} and
      // were skipped. The import upsert writes {} in that case; so does
      // this.
      if (Object.keys(contact).length === 0) empty++;
      else changed++;
      if (!DRY) {
        // 🔴 Two columns, and the second one is the point.
        //
        // The first version wrote `contact` alone, and review measured
        // the consequence: 10 637 pages gained a contact block and kept
        // the previous import's `content_changed_at`, so <lastmod> told
        // crawlers nothing had changed on exactly the pages this work
        // exists to improve. Worse, it was permanent — the next import
        // computes the same contact, the upsert's CASE sees no
        // difference, and the date never moves.
        //
        // `import-spots.ts` puts `contact` in that CASE precisely
        // because a contact block is something a reader notices
        // (CAMP-39). A backfill that delivers the same change must say
        // so the same way.
        await db.query(BACKFILL_SQL, [row.osm_ref, JSON.stringify(contact)]);
      }
    }
    await db.query(DRY ? 'ROLLBACK' : 'COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }

  const after = await db.query<{ n: string; total: string }>(
    `SELECT count(*) FILTER (WHERE contact <> '{}'::jsonb) AS n, count(*) AS total
       FROM camping_spots WHERE missing_since IS NULL`,
  );
  const { n, total } = after.rows[0];
  // eslint-disable-next-line no-console
  console.log(
    `${DRY ? '[dry run] ' : ''}matched ${rows.length} staging rows, ` +
      `${changed} carried a contact, ${empty} carried none.\n` +
      `campsites with a contact: ${n} of ${total} ` +
      `(${((Number(n) / Number(total)) * 100).toFixed(1)}%)`,
  );
  await db.end();
}

// 🔴 Guarded, because a spec that imports anything from this file would
// otherwise RUN it. `backfill-contact.spec.ts` imports BACKFILL_SQL, and
// that single import opened a Postgres client, ran 14 954 UPDATEs and
// COMMITted them — against whatever DATABASE_URL happened to point at.
// It changed nothing only because the backfill is idempotent.
//
// The connection also outlived Jest: the server answered the SASL
// handshake after the module registry was gone, `pg` could no longer
// `require('pgpass')`, and the process exited non-zero with 1007 tests
// green. A red job that means nothing teaches us to stop reading CI.
if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
