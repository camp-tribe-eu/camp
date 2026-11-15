import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-523: the words of the widget a campsite embeds on its own website,
 * and of the page that explains how (`/widget`), live in the CMS. One page
 * (`pages.slug = 'provider-widget'`, type `page`, `noindex`), one section
 * per text, addressed by `slot`. Same precedent as `persona-switch` and
 * `camp-services`: no new collection (production stands at 25 of 25), rows
 * in `pages`, `page_sections` and their translations.
 *
 * 🔴 EVERY SENTENCE BELOW IS A CLAIM A TEST HOLDS. "No scripts", "no
 * cookies", "nothing stored", "one request" are asserted against the
 * served widget in apps/web/tests/e2e/provider-widget.spec.ts; an editor
 * may reword them, the code may not make them false.
 * 🔴 NO NUMBERS. The weight budget is a constant the test enforces, not a
 * figure in prose that would outlive the day it was true.
 * 🔴 `noindex` UNTIL THE OWNER SAYS OTHERWISE: opening a new public page
 * is the owner's call, and the flag is one checkbox in the CMS.
 * 🔴 IDEMPOTENT: an existing page is left alone (an editor's words are not
 * overwritten). `down` removes only what this seeded.
 */
export const WIDGET_PAGE_SLUG = 'provider-widget';

export const WIDGET_SECTIONS: ReadonlyArray<{
  slot: string;
  heading: string;
  body: string | null;
}> = [
  {
    slot: 'intro',
    heading: 'What it is',
    body: 'A small block for your own website that shows what lies around your campsite: the nearest water, town, supermarket and railway stop, with the distance to each, and the elevation and terrain. The figures are the ones on your campsite page here, computed from OpenStreetMap. Where a distance was not computed, that row is left out rather than guessed.',
  },
  {
    slot: 'visitors',
    heading: 'What it does on your website',
    body: 'The block is a single HTML document. It runs no scripts, sets no cookies and stores nothing in the browser of the person reading your page. It loads no images, fonts or other files, so that browser makes one request to us and no request to anybody else. As with any web address, our server receives that request.',
  },
  {
    slot: 'snippet',
    heading: 'How to add it',
    body: 'Copy the code below into the page where the block should appear. Replace COUNTRY, REGION and CAMPSITE, in both places, with the three parts of the address of your campsite page here that follow /camping/. The link under the block is part of it: it is what a visitor sees if their browser does not show frames.',
  },
  { slot: 'snippet-link', heading: 'Our campsite on CampTribe', body: null },
  { slot: 'widget-heading', heading: 'What is around it', body: null },
  { slot: 'widget-link', heading: 'Full page on CampTribe', body: null },
  {
    slot: 'widget-source',
    heading:
      'Distances computed by CampTribe from map data © OpenStreetMap contributors.',
    body: null,
  },
  {
    slot: 'widget-empty',
    heading: 'Nothing around this campsite has been computed yet.',
    body: null,
  },
];

export class ProviderWidgetText1797400000000 implements MigrationInterface {
  name = 'ProviderWidgetText1797400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const seen: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM pages WHERE slug = $1 AND type = 'page'`,
      [WIDGET_PAGE_SLUG],
    );
    if (Number(seen[0]?.count ?? 0) > 0) return;

    const page: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
       VALUES ($1, 'page', 'published', now(), 0, true) RETURNING id`,
      [WIDGET_PAGE_SLUG],
    );
    await queryRunner.query(
      `INSERT INTO page_translations (page_id, language_code, title, meta_title, meta_description)
       VALUES ($1, 'en', 'A widget for your campsite website', 'A widget for your campsite website', NULL)`,
      [page[0].id],
    );
    let sort = 0;
    for (const s of WIDGET_SECTIONS) {
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
      [WIDGET_PAGE_SLUG],
    );
  }
}
