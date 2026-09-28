import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-147: the campsite price list, as a table.
 *
 * 🔴 Measured over the whole 810 MB archive on 28.09.2026 — 129 594
 * objects, no sampling — because a sample of 14 had already overstated
 * price coverage by half once:
 *
 *     campsites (@type CampingAndCaravanning)     9 590
 *     ├─ carrying an offers block                 6 962
 *     ├─ carrying schema:priceSpecification       4 360
 *     └─ carrying a price we can store            3 433
 *     tariff lines stored                        13 122   (median 2, max 80)
 *
 * The 80 is why this is a table. One campsite prices a bare pitch, a
 * motorhome pitch, a mobile home by the week, the tourist tax and the
 * dog, each of them in its own season, and a `price_from` column on
 * `camping_spots` could hold exactly one of those.
 *
 * 🔴 `numeric(10,2)`, not `real`. These are money — and this is not a
 * theoretical objection. The feed itself contains
 *
 *     "schema:minPrice": ["2.7999999523162841796875"]
 *
 * four times: somebody upstream put 2.80 through a 32-bit float and
 * printed it back at full precision. Stored in a `real` column ours
 * would do the same thing to every other price in the table, and the
 * page would print it. The parser refuses that string outright — it is
 * not what the two-decimal rule accepts — and the column type means the
 * 13 122 that do parse cannot acquire the defect later.
 *
 * 🔴 ON DELETE CASCADE. A tariff has no meaning without the campsite it
 * prices; an orphan row would be a price attached to nothing, which is
 * the one shape of this data that could later be joined onto the wrong
 * page.
 *
 * 🔴 The unique index is (spot_id, source_id, source_ref) and the middle
 * column is not decoration. `source_ref` is unique per campsite — a URI
 * repeats within one campsite 0 times in the whole feed — but 1 130 URIs
 * are shared BETWEEN campsites, one of them by 247 of them, because
 * DATAtourisme folds a chain's identical tariff into one node. Unique on
 * `source_ref` alone would have silently refused 1 130 rows.
 */
export class SpotTariffs1790576400000 implements MigrationInterface {
  name = 'SpotTariffs1790576400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS spot_tariffs (
        id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        spot_id           uuid NOT NULL
                            REFERENCES camping_spots(id) ON DELETE CASCADE,
        source_id         text NOT NULL,
        source_ref        text NOT NULL,
        offer             text,
        mode              text,
        policy            text,
        min_price         numeric(10,2),
        max_price         numeric(10,2),
        currency          text NOT NULL,
        valid_from        date,
        valid_until       date,
        label             text,
        label_lang        varchar(8),
        source_updated_at date NOT NULL,
        created_at        timestamptz NOT NULL DEFAULT now(),

        -- 🔴 A row with no number is not a tariff, it is a currency.
        -- 1 264 of the feed's 15 526 specifications are exactly that:
        -- "EUR", a name, sometimes a pricing policy, and no amount
        -- anywhere. Without this constraint they would land as rows
        -- rendering "€ –" on a page. The importer already drops them;
        -- the constraint is what makes that permanent rather than a
        -- property of the importer that ran last.
        CONSTRAINT spot_tariffs_has_a_number
          CHECK (min_price IS NOT NULL OR max_price IS NOT NULL),

        -- 🔴 A range that runs backwards is a typo at the source, and it
        -- would print as "from €90 to €19".
        CONSTRAINT spot_tariffs_range_ordered
          CHECK (min_price IS NULL OR max_price IS NULL
                 OR min_price <= max_price),

        -- Same for the season.
        CONSTRAINT spot_tariffs_period_ordered
          CHECK (valid_from IS NULL OR valid_until IS NULL
                 OR valid_from <= valid_until),

        -- 🔴 The language travels with the text or the text does not
        -- travel. The page renders the label into a lang attribute; a
        -- label with no language is French prose that a screen reader
        -- would read aloud in English.
        CONSTRAINT spot_tariffs_label_has_a_language
          CHECK (label IS NULL OR label_lang IS NOT NULL)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_spot_tariffs_source
        ON spot_tariffs (spot_id, source_id, source_ref)
    `);

    // 🔴 Partial, on the rows the page is allowed to show.
    //
    // The read path never asks for a tariff without a validity period —
    // CAMP-147 forbids displaying one — so the index that serves the
    // campsite page covers only those.
    //
    // 🔴 Measured on the TABLE, which is not the same population as the
    // feed: 6 780 of the 12 402 rows imported are covered and the other
    // 5 622 stay out of it entirely. (The feed holds 13 122 parseable
    // lines; 720 of them belong to POIs that have no row here, and a
    // partial index describes what was stored, not what was read.)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_spot_tariffs_displayable
        ON spot_tariffs (spot_id)
        WHERE valid_from IS NOT NULL OR valid_until IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS spot_tariffs`);
  }
}
