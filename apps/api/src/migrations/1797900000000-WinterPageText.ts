import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-525: the words of /camping/winter live in the CMS, not in JSX. One
 * page (`pages.slug = 'winter'`, type `page`, indexable), one section per
 * piece of text, addressed by `slot`. Same precedent as `travel-styles` and
 * `camp-services`: NO new collection (production stands at 25 of 25).
 *
 * 🔴 NUMBERS ARE NOT IN THE TEXT. A body that needs one holds a `{{key}}`
 * and the page fills it from the API at render time: a sentence with a
 * typed «1 550» would go stale the day the next import changes it, and the
 * owner could not tell. The keys each template may use are listed beside it
 * below, and `apps/web/src/lib/winter.ts` throws on a key it does not hand
 * over — a template naming a number the page does not supply is a build
 * error, not a hole in a sentence.
 *
 * 🔴 THE PAGE SAYS WHAT THE SOURCE SAID. «Open in winter» is a campsite
 * whose OpenStreetMap record states an opening season that includes
 * December–February; «has water nearby» is a mapped point within 10 km. Not
 * «heated», not «the tap runs in frost» — nobody recorded that, and the text
 * says so in the water section instead of leaving it for the reader to
 * assume.
 *
 * 🔴 THE TEMPLATES ARE BODIES, NOT HEADINGS: the page loader substitutes
 * every heading from its own fixed list and throws on a key it does not
 * know (apps/web/src/lib/page-content.ts) — the lesson of CAMP-502.
 *
 * 🔴 IDEMPOTENT: an existing page is left alone (an editor's words are not
 * overwritten). `down` removes only what this seeded.
 */
export const WINTER_SLUG = 'winter';

export const WINTER_TITLE = 'Winter camping in Europe';
export const WINTER_META_TITLE =
  'Winter camping in Europe: campsites open from November to March';
export const WINTER_META_DESCRIPTION =
  'Campsites recorded as open in winter, country by country, and where to look for drinking water, a waste-water dump and a gas bottle swap when the season is over.';

export const WINTER_SECTIONS: ReadonlyArray<{
  slot: string;
  heading: string;
  body: string | null;
}> = [
  {
    slot: 'intro',
    heading: 'Open when the season is over',
    body: 'Most campsites close when summer does. Some stay open through the cold months, and a few of those have said so in OpenStreetMap. This page counts them country by country, links to the ones you can browse, and says what to check for the three things winter camping runs short of: drinking water, a place to empty waste water, and gas.',
  },
  {
    // keys: yes, known, total, countries
    slot: 'countries',
    heading: 'Open in winter, by country',
    body: '{{yes}} campsites in {{countries}} countries are recorded as open in winter. Winter opening is recorded for {{known}} of {{total}} campsites; a campsite with no record is left out of these figures, not guessed.',
  },
  {
    // keys: yes, known, total
    slot: 'country-card',
    heading: 'Country figures',
    body: '{{yes}} open in winter, recorded for {{known}} of {{total}} campsites',
  },
  {
    // keys: region, yes, spots
    slot: 'region-link',
    heading: 'Regions to browse',
    body: '{{region}}: {{yes}} of {{spots}}',
  },
  {
    // keys: count, countries, names
    slot: 'none',
    heading: 'Countries with no winter record',
    body: '{{count}} of {{countries}} countries have no campsite recorded as open in winter, so they are not listed above: {{names}}.',
  },
  {
    slot: 'empty',
    heading: 'Nothing recorded yet',
    body: 'No campsite is recorded as open in winter yet. When one is, it appears here with its country.',
  },
  {
    slot: 'pain',
    heading: 'Water, waste water and gas',
    body: 'Winter camping fails on supplies before it fails on weather. Taps are drained, dump points freeze or are locked, and heating empties a gas bottle much faster than cooking does. For each, this is what is mapped around the campsites recorded as open in winter, and what to check yourself.',
  },
  {
    slot: 'water',
    heading: 'Drinking water',
    body: 'Taps are often switched off between the first frost and spring. Fill the tank when you can, ask the campsite whether a tap runs in winter, and keep a second source in mind. OpenStreetMap shows where a tap is; it does not record whether it is switched off for the cold.',
  },
  {
    slot: 'dump',
    heading: 'Waste-water dump',
    body: 'A dump point that is open to campers in winter is rarer than a campsite that is. Ask whether it is locked or frozen before you arrive, and have a fallback in mind, such as a municipal motorhome stop or a motorway service area.',
  },
  {
    slot: 'gas',
    heading: 'Gas bottles',
    body: 'Heating uses far more gas than summer cooking, so a bottle that lasted weeks may not. Swap points are scarce and bottle fittings and deposit schemes differ between countries: check that your bottle or adaptor is accepted before you rely on one.',
  },
  {
    // keys: count, total, km
    slot: 'figure',
    heading: 'Nearby, by country',
    body: '{{count}} of {{total}} winter-open campsites have one within {{km}} km',
  },
  {
    // keys: km
    slot: 'method',
    heading: 'How these figures are counted',
    body: 'A point counts as nearby when it lies within {{km}} km in a straight line of the campsite, which is about twenty minutes in a camper. Nearby does not mean open: it says where something is mapped, not that it works in winter. A campsite is counted as open in winter only when its OpenStreetMap record states an opening season that covers December to February.',
  },
  {
    // keys: readAt
    slot: 'as-of',
    heading: 'Counted as of',
    body: 'Counted from our listings as of {{readAt}}.',
  },
];

export class WinterPageText1797900000000 implements MigrationInterface {
  name = 'WinterPageText1797900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const seen: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM pages WHERE slug = $1 AND type = 'page'`,
      [WINTER_SLUG],
    );
    if (Number(seen[0]?.count ?? 0) > 0) return;

    const page: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
       VALUES ($1, 'page', 'published', now(), 0, false) RETURNING id`,
      [WINTER_SLUG],
    );
    await queryRunner.query(
      `INSERT INTO page_translations (page_id, language_code, title, meta_title, meta_description)
       VALUES ($1, 'en', $2, $3, $4)`,
      [page[0].id, WINTER_TITLE, WINTER_META_TITLE, WINTER_META_DESCRIPTION],
    );
    let sort = 0;
    for (const s of WINTER_SECTIONS) {
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
      [WINTER_SLUG],
    );
  }
}
