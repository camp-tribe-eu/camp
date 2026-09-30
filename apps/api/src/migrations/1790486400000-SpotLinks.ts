import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-144: one campsite, two rows, two pages — joined by a link that
 * lives where no importer can reach it.
 *
 * 🔴 WHY A TABLE AND NOT A COLUMN.
 *
 * The obvious shape is `camping_spots.merged_into`. It is also the shape
 * that loses the work. This repository has already been bitten twice by
 * a column appearing in the weekly upsert's DO UPDATE list that should
 * not have been there (slug, owner_overrides — see UPSERT_SPOT_SQL's
 * header). A link column would be one careless line away from being
 * rewritten every Monday, and it would fail silently: the pages would
 * quietly split again and nothing would report it.
 *
 * A separate table cannot be reached by `INSERT INTO camping_spots …
 * ON CONFLICT (osm_ref) DO UPDATE` at all, whatever anyone adds to that
 * statement. The failure mode is designed out rather than guarded.
 *
 * 🔴 WHAT MAKES THE ROW IDENTITY SURVIVE.
 *
 * The link references `camping_spots.id`. The weekly OSM import upserts
 * `ON CONFLICT (osm_ref)`, so a spot that is still in OSM keeps its uuid
 * for ever; it is updated, never re-inserted. Nothing in the pipeline
 * deletes a spot that is still present — a disappearance is recorded in
 * `missing_since` (CAMP-87) and the row stays. The two places that do
 * delete rows (`drop-non-eu.mjs`, and a manual purge) are covered by
 * ON DELETE CASCADE, so a link can never outlive the rows it joins.
 *
 * 🔴 NOTHING IS DELETED BY THIS, AND NOTHING NEEDS TO BE.
 *
 * Measured 28.09.2026 against the 2 986 links this actually wrote — not
 * against the card's 1 358, which counted a narrower rule:
 *
 *     one side holds a fact the other lacks        2 774
 *     together give BOTH contact AND stars         2 121
 *     star rating present on BOTH sides                0
 *     star rating present on the OSM side              0
 *
 * The last two lines are the argument. OpenStreetMap does not carry the
 * French classification at all, so for every one of the 2 134 links
 * where a star rating exists, it exists on exactly one row — and that
 * row is never the one with the phone number. Deleting either side
 * destroys a fact nothing else holds; joining them is the only
 * operation that loses nothing.
 *
 * 🔴 DIRECTION IS FIXED: primary = the OSM row, secondary = the other.
 *
 * Not a coin toss. The OSM row is the one the weekly import re-verifies
 * and whose uuid is pinned by a unique key; the DATAtourisme row has no
 * such key. Because an OSM row is never a secondary, a chain
 * (a → b → c) cannot be built by the reconciler, and the read side
 * therefore never has to walk more than one hop. `verify-links.ts`
 * asserts that property against the live table rather than trusting it.
 *
 * 🔴 REVERSIBLE WITHOUT A RE-IMPORT.
 *
 * A wrong link is undone by setting `unlinked_at` — one UPDATE. Both
 * rows are still there, untouched, and the next reconciler run will not
 * re-create the link because it skips pairs that already have a row
 * here, live or not. That is what makes the undo stick.
 */
export class SpotLinks1790486400000 implements MigrationInterface {
  name = 'SpotLinks1790486400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS spot_links (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        primary_id uuid NOT NULL
          REFERENCES camping_spots(id) ON DELETE CASCADE,
        secondary_id uuid NOT NULL
          REFERENCES camping_spots(id) ON DELETE CASCADE,
        metres integer NOT NULL,
        name_similarity real NOT NULL,
        rule text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        unlinked_at timestamptz,
        unlinked_reason text,
        CONSTRAINT spot_links_two_rows CHECK (primary_id <> secondary_id),
        -- An undo must say why. A link that came back with no reason
        -- attached is indistinguishable from one undone by accident.
        CONSTRAINT spot_links_undo_has_reason
          CHECK (unlinked_at IS NULL OR unlinked_reason IS NOT NULL)
      )
    `);

    // 🔴 The constraint that makes "the reader sees one campsite" true.
    //
    // A secondary belongs to exactly one primary while the link is live.
    // Without this, two links could hide one row behind two different
    // pages and the merged page would depend on query order.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_spot_links_secondary_live
        ON spot_links (secondary_id) WHERE unlinked_at IS NULL
    `);

    // The read side's hot question: "what else belongs to this spot?"
    //
    // 🔴 This wants to be UNIQUE, and is made so by the NEXT migration
    // rather than here — `SpotLinkOnePerPrimary1790490000000`.
    //
    // It was changed here first, which does not work: a database that
    // has already run this migration never runs it again, and
    // `CREATE UNIQUE INDEX IF NOT EXISTS` on an existing non-unique
    // index of the same name silently does nothing. The constraint would
    // have existed only on databases built after the edit. Left as it
    // was written so that the two migrations describe one honest
    // sequence, which is what a migration history is for.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_spot_links_primary_live
        ON spot_links (primary_id) WHERE unlinked_at IS NULL
    `);

    // 🔴 Not partial. The reconciler asks "have I judged this pair
    // before?" and must get "yes" for a pair a human has since undone,
    // or the next run would re-create the link the human removed.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_spot_links_pair
        ON spot_links (primary_id, secondary_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS spot_links`);
  }
}
