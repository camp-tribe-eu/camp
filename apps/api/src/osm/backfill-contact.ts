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

/** The tags `mapContact` reads, and only those. */
const TAG_COLUMNS = [
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
        await db.query(
          `UPDATE camping_spots
              SET contact = $2::jsonb,
                  content_changed_at = now()
            WHERE osm_ref = $1
              AND contact IS DISTINCT FROM $2::jsonb`,
          [row.osm_ref, JSON.stringify(contact)],
        );
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

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
