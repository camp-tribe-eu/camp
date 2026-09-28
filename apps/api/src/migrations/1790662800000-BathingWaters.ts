import { MigrationInterface, QueryRunner } from 'typeorm';
import { BATHING_STATUSES } from '../bathing/source';

/**
 * CAMP-168: the EU's officially designated bathing waters, by season.
 *
 * 🔴 Measured over the whole layer on 28.09.2026 — 22 289 features, no
 * sampling — via
 * `.../BathingWater/BathingWater_Dyna_WM_2025/MapServer/3/query`:
 *
 *     bathing waters, 2025 season, all countries   22 289  (29 countries)
 *     ├─ flagged EU-27 by the source               22 010  (27 of 27)
 *     └─ with usable coordinates                   22 010  (100%)
 *
 *     classification, EU-27, 2025 season
 *       Excellent       18 655
 *       Good             1 931
 *       Sufficient         489
 *       Poor               324
 *       Not classified     611
 *
 * That is the rarest shape in docs/emergency-sources.md: a source that
 * genuinely covers all 27 member states with a coordinate on every row.
 *
 * 🔴 UNIQUE ON (source_id, ref, season), and the season is not padding.
 *
 * The dataset is annual. Next June's publication is a NEW season for the
 * same bathing waters, and it must land beside these rows rather than
 * overwrite them — otherwise the day the 2026 import runs, every page
 * silently restates a different year under the same sentence, and
 * nothing in the database remembers what it said yesterday.
 *
 * 🔴 `status` NOT NULL with a CHECK, `not_classified` included.
 *
 * 611 sites carry "Not classified" for 2025. As NULL they would be
 * indistinguishable from an import that dropped them, and CAMP-168's
 * "never render empty" rule needs the page to tell those two apart.
 * The CHECK is generated from BATHING_STATUSES so the column and the
 * TypeScript union cannot drift — a sixth value has to be added in one
 * place and both follow.
 *
 * 🔴 No foreign key to `camping_spots`, deliberately. A bathing water is
 * a real place whether or not anything of ours is near it, and 27 member
 * states designate them for their own reasons. Attaching them to
 * campsites at import time would bake today's radius into the database,
 * where changing it later means a re-import instead of an edit.
 */
export class BathingWaters1790662800000 implements MigrationInterface {
  name = 'BathingWaters1790662800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const statuses = BATHING_STATUSES.map((s) => `'${s}'`).join(', ');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bathing_waters (
        id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        source_id   text NOT NULL,
        ref         text NOT NULL,
        name        text NOT NULL,
        country     text NOT NULL,
        category    text NOT NULL,
        season      int  NOT NULL,
        status      text NOT NULL,
        profile_url text,
        location    geography(Point, 4326) NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),

        -- 🔴 The five values the source publishes, and nothing else. An
        -- unrecognised class must stop an import, not arrive on a page
        -- as a word nobody chose.
        CONSTRAINT bathing_waters_status_known
          CHECK (status IN (${statuses})),

        -- A season we could not possibly hold. The first Bathing Water
        -- Directive reporting year in this layer is 1990.
        CONSTRAINT bathing_waters_season_plausible
          CHECK (season BETWEEN 1990 AND 2100)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bathing_waters_identity
        ON bathing_waters (source_id, ref, season)
    `);

    // 🔴 The index the campsite page actually uses: a KNN walk from a
    // campsite's point to the nearest bathing water. Without it the
    // query measures all 22 010 rows per page, 65 435 times per build.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_bathing_waters_location
        ON bathing_waters USING GIST (location)
    `);

    // The read path always asks for one season, so the season leads.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_bathing_waters_season
        ON bathing_waters (season)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS bathing_waters`);
  }
}
