import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-521 — what each data status MEANS, as text the owner can edit.
 *
 * The eight status words themselves are a fixed vocabulary in
 * `apps/web/src/lib/trust.ts` (a guard compares them with the origin of
 * every value, so they must not be retypable). The sentence explaining a
 * word is prose, and prose lives here: page `trust-status`, one section
 * per status, slot `status-<id>`. The campsite page prints the sentences
 * of the statuses it actually uses, and none when this page is absent.
 *
 * 🔴 All eight are seeded although four cannot be printed yet (no process
 * produces them — see `lib/trust.ts`). A status that appears later must
 * not appear without its sentence.
 *
 * Only INSERTs, guarded by the slug: a second run changes nothing, and an
 * edit made in the CMS is never overwritten.
 */
export const TRUST_SLUG = 'trust-status';

export const TRUST_SECTIONS: ReadonlyArray<{
  slot: string;
  heading: string;
  body: string | null;
}> = [
  { slot: 'intro', heading: 'What the status words mean', body: null },
  {
    slot: 'status-verified',
    heading: 'Verified',
    body: 'Checked by CampTribe using a stated method, on the date shown.',
  },
  {
    slot: 'status-owner-confirmed',
    heading: 'Owner confirmed',
    body: 'Stated by the person who claimed this place as its owner. We have not checked it ourselves.',
  },
  {
    slot: 'status-recently-updated',
    heading: 'Recently updated',
    body: 'Changed recently, and not yet checked independently.',
  },
  {
    slot: 'status-community-reported',
    heading: 'Community reported',
    body: 'Reported by a visitor. We have not checked it ourselves.',
  },
  {
    slot: 'status-imported',
    heading: 'Imported',
    body: 'Taken from an outside source, or calculated by us from one. We have not checked it on the spot. The sources are listed below.',
  },
  {
    slot: 'status-conflicting',
    heading: 'Conflicting',
    body: 'Our sources disagree about this.',
  },
  {
    slot: 'status-unknown',
    heading: 'Not recorded',
    body: 'Our sources say nothing about this. That is a gap in the data, not a statement that the place lacks it.',
  },
  {
    slot: 'status-outdated',
    heading: 'Outdated',
    body: 'Imported, and the source record has not been edited for more than two years. Check before you rely on it.',
  },
];

export class TrustStatusText1797300000000 implements MigrationInterface {
  name = 'TrustStatusText1797300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const seen: Array<{ count: string }> = await queryRunner.query(
      `SELECT count(*)::text AS count FROM pages WHERE slug = $1 AND type = 'page'`,
      [TRUST_SLUG],
    );
    if (Number(seen[0]?.count ?? 0) > 0) return;

    const page: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
       VALUES ($1, 'page', 'published', now(), 0, true) RETURNING id`,
      [TRUST_SLUG],
    );
    await queryRunner.query(
      `INSERT INTO page_translations (page_id, language_code, title, meta_title, meta_description)
       VALUES ($1, 'en', 'Data status', 'Data status', NULL)`,
      [page[0].id],
    );
    let sort = 0;
    for (const s of TRUST_SECTIONS) {
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

  /**
   * 🔴 Does nothing, on purpose. The rows are text the owner may have
   * edited since; a rollback that deleted them would delete his work.
   */
  public async down(): Promise<void> {}
}
