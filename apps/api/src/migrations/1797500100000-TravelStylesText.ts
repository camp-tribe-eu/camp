import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-520: the words of the «Travel style» filter live in the CMS, not in
 * JSX. One page (`pages.slug = 'travel-styles'`, type `page`, `noindex`),
 * one section per label, addressed by `slot`. Same precedent as
 * `persona-switch` and `camp-services`: no new collection (production
 * stands at 25 of 25).
 *
 * 🔴 THE LABEL SAYS WHAT THE SOURCE SAID. «Open in winter» is what
 * `seasonal=no` and `opening_hours=24/7` state; it is not «winter-ready»,
 * which would promise heated sanitary blocks nobody recorded.
 *
 * 🔴 THE TEMPLATE IS A BODY, NOT A HEADING: the page loader substitutes
 * every heading from its own fixed list and throws on a key it does not
 * know (apps/web/src/lib/page-content.ts) — the lesson of CAMP-502.
 *
 * 🔴 IDEMPOTENT: an existing page is left alone (an editor's words are not
 * overwritten). `down` removes only what this seeded.
 */
export const TRAVEL_STYLES_SLUG = 'travel-styles';

export const TRAVEL_STYLES_SECTIONS: ReadonlyArray<{
  slot: string;
  heading: string;
  body: string | null;
}> = [
  { slot: 'group', heading: 'Travel style', body: null },
  { slot: 'style-winter', heading: 'Open in winter', body: null },
  { slot: 'style-adults-only', heading: 'Adults only', body: null },
  {
    slot: 'coverage',
    heading: 'What this filter knows',
    body: '{{label}}: recorded for {{known}} of {{total}} sites in this region. A site with no record is left out of this filter, not guessed.',
  },
  {
    slot: 'map-note',
    heading: 'Travel style and the map',
    body: 'The map on this page does not apply travel styles: it highlights by type and facilities only. The list below applies them.',
  },
];

export class TravelStylesText1797500100000 implements MigrationInterface {
  name = 'TravelStylesText1797500100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const seen: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM pages WHERE slug = $1 AND type = 'page'`,
      [TRAVEL_STYLES_SLUG],
    );
    if (Number(seen[0]?.count ?? 0) > 0) return;

    const page: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
       VALUES ($1, 'page', 'published', now(), 0, true) RETURNING id`,
      [TRAVEL_STYLES_SLUG],
    );
    await queryRunner.query(
      `INSERT INTO page_translations (page_id, language_code, title, meta_title, meta_description)
       VALUES ($1, 'en', 'Travel style', 'Travel style', NULL)`,
      [page[0].id],
    );
    let sort = 0;
    for (const s of TRAVEL_STYLES_SECTIONS) {
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
      [TRAVEL_STYLES_SLUG],
    );
  }
}
