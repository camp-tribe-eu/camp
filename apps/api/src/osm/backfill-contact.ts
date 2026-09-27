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
import { Client } from 'pg';
import { mapContact, OsmTags } from './tag-mapping';

const DRY = process.argv.includes('--dry-run');

/** The tags `mapContact` reads, and only those. */
const TAG_COLUMNS = [
  'website', 'contact:website', 'url', 'contact:url',
  'phone', 'contact:phone', 'contact:mobile',
  'email', 'contact:email',
  'operator', 'opening_hours', 'capacity',
  'addr:street', 'addr:housenumber', 'addr:city', 'addr:postcode',
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
      if (Object.keys(contact).length === 0) {
        empty++;
        continue;
      }
      changed++;
      if (!DRY) {
        // 🔴 One column. See the header.
        await db.query(
          `UPDATE camping_spots SET contact = $2::jsonb WHERE osm_ref = $1`,
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
