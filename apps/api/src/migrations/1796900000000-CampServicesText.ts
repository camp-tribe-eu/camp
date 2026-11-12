import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-503: the words of the «services at and near this campsite» block live
 * in the CMS, not in JSX. One page (`pages.slug = 'camp-services'`, type
 * `page`, `noindex` — it has no URL of its own: `GET /pages/:slug` serves only
 * type `page`), one section per label, addressed by `slot`.
 *
 * 🔴 NO NEW COLLECTION. Production stands at 25 registered of 25; a collection
 * costs a slot even when hidden. This is rows in `pages`, `page_sections` and
 * their translations — the precedent of `camping-country` and `rental-country`.
 *
 * 🔴 `{{nearby}}` AND `{{onsite}}` in the intro are NOT typed numbers: the page
 * fills them from the radii the API used for the query (camp-services.ts), so
 * an editor cannot make the text say 5 km while the data says 10.
 *
 * 🔴 THE EV CHARGING LABEL SAYS WHAT IT IS NOT. Public charging for electric
 * cars is a different need from the camper's mains hookup on the pitch.
 *
 * 🔴 IDEMPOTENT: a page that already exists is left alone (an editor's words
 * are not overwritten). `down` removes only what this seeded.
 */
export const CAMP_SERVICES_SLUG = 'camp-services';

export const CAMP_SERVICES_SECTIONS: ReadonlyArray<{
  slot: string;
  heading: string;
  body: string | null;
}> = [
  {
    slot: 'intro',
    heading: 'Fuel, charging, water, waste and gas — on site and nearby',
    body: "Straight-line distances from OpenStreetMap, measured from the campsite's marked point; they are not driving routes. On site: inside the campsite's outline, or within {{onsite}} of its marked point where no outline is mapped. Nearby: the closest one outside the campsite, up to {{nearby}}.",
  },
  { slot: 'kind-fuel', heading: 'Fuel station', body: null },
  {
    slot: 'kind-ev_charging',
    heading: 'Electric-car charging',
    body: "A public charger for electric cars. It is not a mains hookup for a camper: electricity on the pitch is listed under the campsite's facilities.",
  },
  { slot: 'kind-water', heading: 'Drinking water', body: null },
  { slot: 'kind-dump', heading: 'Waste-water dump station', body: null },
  { slot: 'kind-gas', heading: 'Gas bottle exchange', body: null },
  { slot: 'onsite', heading: 'On site', body: null },
  { slot: 'nearby', heading: 'Nearby', body: null },
  { slot: 'unnamed', heading: 'Not named in OpenStreetMap', body: null },
  {
    slot: 'hookup',
    heading: 'Pitch hookup, as given by the campsite',
    body: 'Entered by the campsite owner.',
  },
  { slot: 'hookup-voltage', heading: 'Voltage', body: null },
  { slot: 'hookup-power', heading: 'Power', body: null },
  { slot: 'hookup-price', heading: 'Price per night', body: null },
];

export class CampServicesText1796900000000 implements MigrationInterface {
  name = 'CampServicesText1796900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const seen: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM pages WHERE slug = $1 AND type = 'page'`,
      [CAMP_SERVICES_SLUG],
    );
    if (Number(seen[0]?.count ?? 0) > 0) return;

    const page: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
       VALUES ($1, 'page', 'published', now(), 0, true) RETURNING id`,
      [CAMP_SERVICES_SLUG],
    );
    await queryRunner.query(
      `INSERT INTO page_translations (page_id, language_code, title, meta_title, meta_description)
       VALUES ($1, 'en', 'Campsite services', 'Campsite services', NULL)`,
      [page[0].id],
    );
    let sort = 0;
    for (const s of CAMP_SERVICES_SECTIONS) {
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
      [CAMP_SERVICES_SLUG],
    );
  }
}
