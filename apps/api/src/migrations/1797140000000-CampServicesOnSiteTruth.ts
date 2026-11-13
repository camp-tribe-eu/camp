import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  CAMP_SERVICES_SECTIONS,
  CAMP_SERVICES_SLUG,
} from './1796900000000-CampServicesText';
import { CAMP_SERVICES_ADDED_SECTIONS } from './1797000100000-CampServicesGroups';

/**
 * Review of CAMP-503/506: the words of the services block said two things the
 * data does not hold.
 *
 * 1. "On site … or within {{onsite}} of its marked point where no outline is
 *    mapped." Measured on production (camp-services.ts, top): 1% of the fuel
 *    stations that close are inside the campsite, 59% of the taps. The API now
 *    says "on site" only inside an outline, and gives water and dump a third
 *    answer, by distance. This seeds its label — slot `within` — and rewrites
 *    the intro's sentence. `{{onsite}}` in both is the radius the API used.
 *
 * 2. "Supermarket or shop" beside the page's own "Supermarket" row read as the
 *    same fact with two distances. The heading now says what the line is —
 *    the nearest food shop of either size — and the note says how it differs
 *    from the supermarket figure.
 *
 * 3. 🔴 THE BLOCK WAS NOT DRAWN AT ALL since 1797000100000. That migration
 *    put `{{date}}` into the HEADING of slot `source`. The web's CMS loader
 *    (page-content.ts `applyValues`) expands every heading against a fixed
 *    whitelist and THROWS on a key it does not know; the campsite page
 *    catches that and draws no block. Bodies are not expanded there — which
 *    is why the intro's `{{nearby}}` always worked. So a template that the
 *    page fills itself lives in a BODY: `source` moves its template there,
 *    and the new `within` label is born there.
 *
 * 🔴 AN EDITOR'S WORDS ARE LEFT ALONE: a text is replaced only while it still
 * holds exactly what the earlier migrations seeded; a slot is added only if
 * the page lacks it. No page (the seed has not run) — nothing to do.
 * 🔴 NO NEW COLLECTION: rows in the tables `pages` already has.
 */
const seeded = (slot: string) => {
  const s = [...CAMP_SERVICES_SECTIONS, ...CAMP_SERVICES_ADDED_SECTIONS].find(
    (x) => x.slot === slot,
  );
  if (!s) throw new Error(`no seeded section ${slot}`);
  return s;
};

/** The line's label is the BODY (a template); the heading is its plain name. */
export const WITHIN_SECTION = {
  slot: 'within',
  heading: 'By distance',
  body: 'Within {{onsite}}, by distance',
} as const;

export const OLD_SOURCE_HEADING = seeded('source').heading;
export const NEW_SOURCE_HEADING = 'Source';
/** The same words 1797000100000 seeded, now where the loader leaves them be. */
export const NEW_SOURCE_BODY = OLD_SOURCE_HEADING;

export const OLD_INTRO_BODY = seeded('intro').body as string;
export const NEW_INTRO_BODY =
  "Straight-line distances from OpenStreetMap, measured from the campsite's marked point; they are not driving routes. On site: inside the campsite's outline, and said only where OpenStreetMap maps one. Within {{onsite}}, by distance: where no outline is mapped, drinking water or a dump station that close to the campsite's marked point — the distance alone does not tell whether it belongs to the campsite. Nearby: the closest one beyond that, up to {{nearby}}.";

export const OLD_GROCERIES_HEADING = seeded('kind-groceries').heading;
export const NEW_GROCERIES_HEADING = 'Nearest food shop';
export const NEW_GROCERIES_BODY =
  'A supermarket or a convenience shop, whichever is closer. The supermarket distance elsewhere on this page counts supermarkets only, so it can be farther.';

const SECTION_OF = `section_id IN (SELECT id FROM page_sections WHERE page_id = $1 AND slot = $2)`;

export class CampServicesOnSiteTruth1797140000000 implements MigrationInterface {
  name = 'CampServicesOnSiteTruth1797140000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const page: Array<{ id: string }> = await queryRunner.query(
      `SELECT id FROM pages WHERE slug = $1 AND type = 'page'`,
      [CAMP_SERVICES_SLUG],
    );
    if (page.length === 0) return;
    const pageId = page[0].id;

    const have: Array<{ id: string }> = await queryRunner.query(
      `SELECT id FROM page_sections WHERE page_id = $1 AND slot = $2`,
      [pageId, WITHIN_SECTION.slot],
    );
    if (have.length === 0) {
      const max: Array<{ m: number | null }> = await queryRunner.query(
        `SELECT max(sort) AS m FROM page_sections WHERE page_id = $1`,
        [pageId],
      );
      const row: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO page_sections (page_id, sort, type, slot, visible)
         VALUES ($1, $2, 'prose', $3, true) RETURNING id`,
        [pageId, Number(max[0]?.m ?? 0) + 1, WITHIN_SECTION.slot],
      );
      await queryRunner.query(
        `INSERT INTO page_section_translations (section_id, language_code, heading, body, items)
         VALUES ($1, 'en', $2, $3, '[]'::jsonb)`,
        [row[0].id, WITHIN_SECTION.heading, WITHIN_SECTION.body],
      );
    }

    await queryRunner.query(
      `UPDATE page_section_translations SET body = $3
        WHERE body = $4 AND language_code = 'en' AND ${SECTION_OF}`,
      [pageId, 'intro', NEW_INTRO_BODY, OLD_INTRO_BODY],
    );
    await queryRunner.query(
      `UPDATE page_section_translations SET heading = $3, body = $4
        WHERE heading = $5 AND body IS NULL AND language_code = 'en' AND ${SECTION_OF}`,
      [
        pageId,
        'source',
        NEW_SOURCE_HEADING,
        NEW_SOURCE_BODY,
        OLD_SOURCE_HEADING,
      ],
    );
    // Heading and note together, and only while BOTH are still the seed's:
    // a new note under an editor's heading would describe somebody else's words.
    await queryRunner.query(
      `UPDATE page_section_translations SET heading = $3, body = $4
        WHERE heading = $5 AND body IS NULL AND language_code = 'en' AND ${SECTION_OF}`,
      [
        pageId,
        'kind-groceries',
        NEW_GROCERIES_HEADING,
        NEW_GROCERIES_BODY,
        OLD_GROCERIES_HEADING,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const page: Array<{ id: string }> = await queryRunner.query(
      `SELECT id FROM pages WHERE slug = $1 AND type = 'page'`,
      [CAMP_SERVICES_SLUG],
    );
    if (page.length === 0) return;
    const pageId = page[0].id;
    await queryRunner.query(
      `DELETE FROM page_sections WHERE page_id = $1 AND slot = $2`,
      [pageId, WITHIN_SECTION.slot],
    );
    await queryRunner.query(
      `UPDATE page_section_translations SET body = $3
        WHERE body = $4 AND language_code = 'en' AND ${SECTION_OF}`,
      [pageId, 'intro', OLD_INTRO_BODY, NEW_INTRO_BODY],
    );
    await queryRunner.query(
      `UPDATE page_section_translations SET heading = $3, body = NULL
        WHERE heading = $4 AND body = $5 AND language_code = 'en' AND ${SECTION_OF}`,
      [
        pageId,
        'source',
        OLD_SOURCE_HEADING,
        NEW_SOURCE_HEADING,
        NEW_SOURCE_BODY,
      ],
    );
    await queryRunner.query(
      `UPDATE page_section_translations SET heading = $3, body = NULL
        WHERE heading = $4 AND body = $5 AND language_code = 'en' AND ${SECTION_OF}`,
      [
        pageId,
        'kind-groceries',
        OLD_GROCERIES_HEADING,
        NEW_GROCERIES_HEADING,
        NEW_GROCERIES_BODY,
      ],
    );
  }
}
