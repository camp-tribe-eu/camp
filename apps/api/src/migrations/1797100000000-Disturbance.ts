import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-502: the «Possible disturbance» block — distance to the nearest
 * motorway, railway line and airport.
 *
 * 1. `osm_ctx_hazard` — the geometry those distances are measured to. 🔴 IT IS
 *    CREATED EMPTY HERE, and that is the point: the campsite detail query reads
 *    this table on every page. Without it a deploy would turn every campsite
 *    page into an error until someone ran the import. Empty means "no computed
 *    distance", and the page then draws no block. The table is FILLED by
 *    `scripts/osm-pipeline/load-hazard.mjs` (called by load-context.sh), which
 *    never creates, drops or truncates it: the columns below are the ones the
 *    query reads AND the ones the loader writes, whatever tags an export holds
 *    (the loader's self-test compares the two lists). An empty table is not
 *    silent: `camptribe-disturbance-check` turns red on it every day.
 *
 * 2. The words of the block, in the CMS (page `camp-disturbance`, type `page`,
 *    `noindex`; no new collection — production stands at 25 of 25). 🔴 `caveat`
 *    is the sentence that says we did not measure noise or air; the page draws
 *    nothing without it.
 *
 * IDEMPOTENT: an existing table or page is left alone. `down` removes the page
 * and the table only if the table is still empty.
 */
/** Exported so the spec builds the table the migration builds. */
export const HAZARD_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS osm_ctx_hazard (
    ogc_fid serial PRIMARY KEY,
    geom geometry(Geometry, 4326),
    name text, highway text, railway text, aeroway text,
    iata text, service text, tunnel text
  )`;

export const DISTURBANCE_SLUG = 'camp-disturbance';

export const DISTURBANCE_SECTIONS: ReadonlyArray<{
  slot: string;
  heading: string;
  body: string | null;
}> = [
  {
    slot: 'intro',
    heading: 'Possible disturbance',
    body: 'Straight-line distance to the nearest object of each kind, shown only when it is closer than: {{road}} for a motorway or trunk road, {{rail}} for a railway line, {{airport}} for an airport.',
  },
  {
    slot: 'caveat',
    heading: 'We did not measure noise or air quality',
    body: 'We have not measured noise or air on the spot. These are distances we calculated from OpenStreetMap. Being close to such objects often means noise — decide for yourself.',
  },
  { slot: 'kind-road', heading: 'Motorway or trunk road', body: null },
  { slot: 'kind-rail', heading: 'Railway line', body: null },
  { slot: 'kind-airport', heading: 'Airport', body: null },
  {
    slot: 'map-label',
    heading: 'Possible disturbance: {{kind}}, {{distance}}',
    body: null,
  },
];

export class Disturbance1797100000000 implements MigrationInterface {
  name = 'Disturbance1797100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(HAZARD_TABLE_DDL);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS osm_ctx_hazard_geom_idx ON osm_ctx_hazard USING gist (geom)`,
    );

    const seen: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM pages WHERE slug = $1 AND type = 'page'`,
      [DISTURBANCE_SLUG],
    );
    if (Number(seen[0]?.count ?? 0) > 0) return;

    const page: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
       VALUES ($1, 'page', 'published', now(), 0, true) RETURNING id`,
      [DISTURBANCE_SLUG],
    );
    await queryRunner.query(
      `INSERT INTO page_translations (page_id, language_code, title, meta_title, meta_description)
       VALUES ($1, 'en', 'Possible disturbance', 'Possible disturbance', NULL)`,
      [page[0].id],
    );
    let sort = 0;
    for (const s of DISTURBANCE_SECTIONS) {
      const row: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO page_sections (page_id, sort, type, slot, visible)
         VALUES ($1, $2, 'prose', $3, true) RETURNING id`,
        [page[0].id, sort++, s.slot],
      );
      await queryRunner.query(
        `INSERT INTO page_section_translations (section_id, language_code, heading, body, items)
         VALUES ($1, 'en', $2, $3, '[]'::jsonb)`,
        [row[0].id, s.heading, s.body],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM pages WHERE slug = $1 AND type = 'page'`,
      [DISTURBANCE_SLUG],
    );
    // 🔴 Only while empty: once the import has filled it, a rollback of the
    // WORDS must not throw away the hours of loading.
    const rows: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM osm_ctx_hazard`,
    );
    if (Number(rows[0]?.count ?? 0) === 0)
      await queryRunner.query(`DROP TABLE IF EXISTS osm_ctx_hazard`);
  }
}
