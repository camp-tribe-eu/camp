import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-501: the words of the «I have a camper / I am renting one» switch live
 * in the CMS, not in JSX. One page (`pages.slug = 'persona-switch'`, type
 * `page`, `noindex`), one section per label, addressed by `slot`. Same
 * precedent as `camp-services`: no new collection (production stands at 25 of
 * 25), rows in `pages`, `page_sections` and their translations.
 *
 * 🔴 NO NUMBERS, NO RENTAL COMPANIES. `route-rental` only says where the
 * reader will find the figures that matter — on the contract.
 * 🔴 IDEMPOTENT: an existing page is left alone (an editor's words are not
 * overwritten). `down` removes only what this seeded.
 */
export const PERSONA_PAGE_SLUG = 'persona-switch';

export const PERSONA_SECTIONS: ReadonlyArray<{
  slot: string;
  heading: string;
  body: string | null;
}> = [
  { slot: 'switch-label', heading: 'Who is looking', body: null },
  { slot: 'owner', heading: 'I have a camper', body: null },
  { slot: 'renter', heading: 'I am renting one', body: null },
  {
    slot: 'route-rental',
    heading: 'Renting a camper for this route',
    body: 'The figures that decide whether a camper suits this trip are on the rental contract, not on this page. These pages say which four to look for and what each one changes in the countries this route crosses.',
  },
];

export class PersonaSwitchText1797100300000 implements MigrationInterface {
  name = 'PersonaSwitchText1797100300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const seen: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM pages WHERE slug = $1 AND type = 'page'`,
      [PERSONA_PAGE_SLUG],
    );
    if (Number(seen[0]?.count ?? 0) > 0) return;

    const page: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
       VALUES ($1, 'page', 'published', now(), 0, true) RETURNING id`,
      [PERSONA_PAGE_SLUG],
    );
    await queryRunner.query(
      `INSERT INTO page_translations (page_id, language_code, title, meta_title, meta_description)
       VALUES ($1, 'en', 'Who is looking', 'Who is looking', NULL)`,
      [page[0].id],
    );
    let sort = 0;
    for (const s of PERSONA_SECTIONS) {
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
      [PERSONA_PAGE_SLUG],
    );
  }
}
