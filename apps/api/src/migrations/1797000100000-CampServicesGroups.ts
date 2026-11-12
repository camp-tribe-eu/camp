import { MigrationInterface, QueryRunner } from 'typeorm';
import { CAMP_SERVICES_SLUG } from './1796900000000-CampServicesText';

/**
 * CAMP-506: the words of the services block's three groups — before you
 * arrive, at the campsite, when something goes wrong — plus the headings of
 * the three kinds that join (groceries, pharmacy, car repair) and the "where
 * we know it from" line. All in the CMS page `camp-services`, by `slot`.
 *
 * 🔴 NO NEW COLLECTION (25 of 25 on production): rows in `pages`'s existing
 * tables, as 1796900000000 did.
 *
 * 🔴 TOP-UP, NOT REWRITE. 1796900000000 may already be applied and edited by
 * an editor: this adds only the slots the page lacks, and changes the intro
 * heading ONLY while it still holds the words that migration seeded. If the
 * page does not exist (1796900000000 has not run), nothing is done: that
 * migration runs first by timestamp and creates it.
 *
 * `{{date}}` in `source` is filled by the page with the day our import last
 * saw the object (the API's `seen`), not typed.
 */
export const OLD_INTRO_HEADING =
  'Fuel, charging, water, waste and gas — on site and nearby';
export const NEW_INTRO_HEADING =
  'On the way, at the campsite, and when something goes wrong';

export const CAMP_SERVICES_ADDED_SECTIONS: ReadonlyArray<{
  slot: string;
  heading: string;
  body: string | null;
}> = [
  { slot: 'group-before', heading: 'Before you arrive', body: null },
  { slot: 'group-stay', heading: 'At the campsite', body: null },
  { slot: 'group-trouble', heading: 'If something goes wrong', body: null },
  { slot: 'kind-groceries', heading: 'Supermarket or shop', body: null },
  { slot: 'kind-pharmacy', heading: 'Pharmacy', body: null },
  {
    slot: 'kind-car_repair',
    heading: 'Car repair',
    body: 'A car repair shop mapped in OpenStreetMap. The map does not say whether it works on campervans.',
  },
  { slot: 'source', heading: 'OpenStreetMap, imported {{date}}', body: null },
];

export class CampServicesGroups1797000100000 implements MigrationInterface {
  name = 'CampServicesGroups1797000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const page: Array<{ id: string }> = await queryRunner.query(
      `SELECT id FROM pages WHERE slug = $1 AND type = 'page'`,
      [CAMP_SERVICES_SLUG],
    );
    if (page.length === 0) return;
    const pageId = page[0].id;
    const max: Array<{ m: number | null }> = await queryRunner.query(
      `SELECT max(sort) AS m FROM page_sections WHERE page_id = $1`,
      [pageId],
    );
    let sort = Number(max[0]?.m ?? 0) + 1;
    for (const s of CAMP_SERVICES_ADDED_SECTIONS) {
      const have: Array<{ id: string }> = await queryRunner.query(
        `SELECT id FROM page_sections WHERE page_id = $1 AND slot = $2`,
        [pageId, s.slot],
      );
      if (have.length > 0) continue;
      const row: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO page_sections (page_id, sort, type, slot, visible)
         VALUES ($1, $2, 'prose', $3, true) RETURNING id`,
        [pageId, sort++, s.slot],
      );
      await queryRunner.query(
        `INSERT INTO page_section_translations (section_id, language_code, heading, body, items)
         VALUES ($1, 'en', $2, $3, '[]'::jsonb)`,
        [row[0].id, s.heading, s.body],
      );
    }
    await queryRunner.query(
      `UPDATE page_section_translations SET heading = $2
        WHERE heading = $3 AND language_code = 'en'
          AND section_id IN (SELECT id FROM page_sections WHERE page_id = $1 AND slot = 'intro')`,
      [pageId, NEW_INTRO_HEADING, OLD_INTRO_HEADING],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM page_sections
        WHERE slot = ANY($2::text[])
          AND page_id IN (SELECT id FROM pages WHERE slug = $1 AND type = 'page')`,
      [CAMP_SERVICES_SLUG, CAMP_SERVICES_ADDED_SECTIONS.map((s) => s.slot)],
    );
  }
}
