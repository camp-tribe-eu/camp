import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  DISTURBANCE_SECTIONS,
  DISTURBANCE_SLUG,
} from './1797100000000-Disturbance';

/**
 * CAMP-502: the map pin's words move from the HEADING of their CMS section to
 * its BODY.
 *
 * 🔴 WHY. Migration 1797100000000 seeded the slot `map-label` with the heading
 * `Possible disturbance: {{kind}}, {{distance}}`. Every CMS page reaches the
 * site through `applyValues` (apps/web/src/lib/page-content.ts), which
 * substitutes the HEADING of every section from a fixed list of site values
 * and THROWS on a key it does not know — by design, so a typo never prints as
 * a hole in a sentence. `{{kind}}` is not in that list. So the page
 * `camp-disturbance` could not be loaded at all, the campsite page caught the
 * error as "the CMS did not answer", and the block was drawn on NO campsite
 * page — with a full table and correct distances. Found while opening the
 * page in a browser for the fix of #557; the unit test had built the sections
 * by hand and never went through the loader.
 *
 * A section's BODY is not substituted by the loader (the intro's `{{road}}`
 * has lived there from the start), so that is where a template belongs. The
 * heading becomes a plain name for the editor; the page reads the body
 * (apps/web/src/lib/disturbance.ts).
 *
 * IDEMPOTENT AND POLITE: only a row that still holds the seeded template in
 * its heading is changed; a heading an editor has rewritten is left alone.
 */
export const OLD_MAP_LABEL_HEADING =
  'Possible disturbance: {{kind}}, {{distance}}';
export const MAP_LABEL_HEADING = 'Map pin label';
export const MAP_LABEL_BODY = 'Possible disturbance: {{kind}}, {{distance}}';

/** The sections as they stand after this migration: what the page is served. */
export const DISTURBANCE_SECTIONS_NOW: ReadonlyArray<{
  slot: string;
  heading: string;
  body: string | null;
}> = DISTURBANCE_SECTIONS.map((s) =>
  s.slot === 'map-label'
    ? { ...s, heading: MAP_LABEL_HEADING, body: MAP_LABEL_BODY }
    : s,
);

const TARGET = `
   FROM page_sections ps
   JOIN pages p ON p.id = ps.page_id
  WHERE t.section_id = ps.id
    AND p.slug = $1 AND p.type = 'page'
    AND ps.slot = 'map-label'
    AND t.language_code = 'en'`;

export class DisturbanceMapLabelBody1797100400000 implements MigrationInterface {
  name = 'DisturbanceMapLabelBody1797100400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE page_section_translations t SET heading = $2, body = $3
       ${TARGET} AND t.heading = $4 AND t.body IS NULL`,
      [
        DISTURBANCE_SLUG,
        MAP_LABEL_HEADING,
        MAP_LABEL_BODY,
        OLD_MAP_LABEL_HEADING,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE page_section_translations t SET heading = $4, body = NULL
       ${TARGET} AND t.heading = $2 AND t.body = $3`,
      [
        DISTURBANCE_SLUG,
        MAP_LABEL_HEADING,
        MAP_LABEL_BODY,
        OLD_MAP_LABEL_HEADING,
      ],
    );
  }
}
