// CAMP-119: the tags the OSM export carries, read from THE FILE osmium is
// given — scripts/osm-pipeline/export-rpoi.json — and not from a copy of
// its contents.
//
// Its own file because it touches the filesystem, which route-poi-sql.ts
// and route-poi-facilities.ts deliberately do not.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';

export const EXPORT_CONFIG_PATH = join(
  __dirname,
  '../../../../scripts/osm-pipeline/export-rpoi.json',
);

export function exportedTags(path: string = EXPORT_CONFIG_PATH): string[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    include_tags?: unknown;
  };
  const tags = parsed.include_tags;
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) {
    throw new Error(`${path} has no include_tags list`);
  }
  return tags as string[];
}

/**
 * 🔴 Every tag the export was told to write gets a staging column, whether
 * or not any feature carried it.
 *
 * ogr2ogr makes a column only for a tag some feature carried, so a scratch
 * load of one small country has no `maxheight` column at all and the
 * INSERT would die on "column does not exist" — for a perfectly good
 * extract. This adds the missing ones, empty.
 *
 * What it must NOT do is invent a column the export never carried: that
 * would turn "the export dropped `toilets`" into a column of 'unknown'
 * that reads as a finding. A tag the SQL reads and the file does not list
 * is left missing, and the INSERT fails naming it.
 *
 * Returns the tags it had to add, so the caller can SAY so: an empty
 * column is true for a small extract and a reason to look at a full one.
 */
export async function ensureStagingColumns(
  db: Pick<Client, 'query'>,
  tags: string[],
  table = 'osm_route_poi_staging',
): Promise<string[]> {
  if (!/^[a-z_]+$/.test(table)) throw new Error(`unsafe table name ${table}`);
  const have = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = current_schema()`,
    [table],
  );
  const present = new Set(have.rows.map((r) => r.column_name));
  const absent = tags.filter((t) => !present.has(t));
  for (const tag of absent) {
    if (!/^[a-z_:]+$/.test(tag)) throw new Error(`unsafe tag name ${tag}`);
    await db.query(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "${tag}" text`,
    );
  }
  return absent;
}
