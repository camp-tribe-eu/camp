import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * CAMP-147: one line of a campsite's price list.
 *
 * 🔴 A TABLE, not a column on `camping_spots`, and the feed settles it
 * rather than taste. Measured over all 129 594 objects on 28.09.2026:
 * 13 122 stored tariff lines spread across 3 433 campsites — a median
 * of 2 per campsite and a maximum of 80. One campsite prices a
 * bare pitch, a motorhome pitch, a mobile home by the week, the tourist
 * tax and the dog, each in its own season.
 *
 * A single `price_from` column would have to pick one of those 80 and
 * throw the rest away. "From €13.50" is then true in April and a lie in
 * August, and the reader who arrives in August is the one who paid for
 * the lie. So the row is the tariff, and the page renders the table.
 *
 * 🔴 EVERY ROW CARRIES ITS OWN VALIDITY AND ITS OWN SOURCE DATE.
 *
 * Two different dates, and conflating them would be the usual quiet
 * error. `valid_from`/`valid_until` are the SEASON the operator priced —
 * DATAtourisme's `appliesOnPeriod`. `source_updated_at` is the day the
 * tourist office last touched the record, which Licence Ouverte 2.0
 * obliges us to publish beside anything we reuse. A tariff can be fresh
 * in one sense and expired in the other.
 */
@Entity('spot_tariffs')
@Index(['spotId', 'sourceId', 'sourceRef'], { unique: true })
export class SpotTariff {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'spot_id', type: 'uuid' })
  spotId: string;

  /** Short stable id of the publisher, e.g. "datatourisme". */
  @Column({ name: 'source_id', type: 'text' })
  sourceId: string;

  /**
   * The price specification's own URI in the source.
   *
   * 🔴 The identity an upsert keys on, so re-importing the feed updates
   * a tariff instead of adding a fourth copy of it. DATAtourisme mints
   * one per specification (`https://data.datatourisme.fr/<uuid>`).
   *
   * 🔴 It is unique PER CAMPSITE, not globally, and the index is
   * composite because of it. Measured over the whole feed: a URI repeats
   * within one campsite 0 times, but 1 130 of them are shared BETWEEN
   * campsites — one identical specification is referenced by 247 of
   * them, which is DATAtourisme folding a chain's common tariff into a
   * single node. A unique index on `source_ref` alone would therefore
   * have refused 1 130 perfectly good rows, and the campsites that lost
   * them would have shown a shorter price list with nothing to say why.
   */
  @Column({ name: 'source_ref', type: 'text' })
  sourceRef: string;

  /**
   * WHAT is priced — `BarePitch`, `CamperPitch`, `MobilHomeHire`,
   * `TouristTax`… DATAtourisme's `hasPricingOffer`, with the `kb:`
   * prefix stripped.
   *
   * 🔴 The publisher's controlled vocabulary is kept as the publisher's
   * token, not remapped onto an enum of ours. 26 distinct values appear
   * (measured); a new one next quarter must arrive as an unfamiliar
   * token the page can decline to label, not as a silent mismatch
   * against a CHECK constraint written today. Nullable, and usually
   * null: 9 425 of the 13 122 stored tariff lines name no offer.
   */
  @Column({ type: 'text', nullable: true })
  offer: string | null;

  /** HOW it is charged — `Overnight`, `PerWeek`, `PerPerson`, `PerAnimal`. */
  @Column({ type: 'text', nullable: true })
  mode: string | null;

  /** WHO it applies to — `BaseRateFullRate`, `ChildRate`, `Free`, `Group`. */
  @Column({ type: 'text', nullable: true })
  policy: string | null;

  /**
   * 🔴 `numeric`, never a float. These are money.
   *
   * Both nullable and at least one is required — the importer refuses a
   * specification with neither, which is how the 1 261 currency-only
   * specifications stay out. A spec with min only is "from €18"; with
   * both, a range; with min = max, one price.
   */
  @Column({
    name: 'min_price',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  minPrice: string | null;

  @Column({
    name: 'max_price',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  maxPrice: string | null;

  /** ISO 4217. 14 673 values say `EUR` and 97 say `Eur`; both normalise. */
  @Column({ type: 'text' })
  currency: string;

  /**
   * The season the operator priced, from `appliesOnPeriod`.
   *
   * 🔴 Nullable in the TABLE and required for DISPLAY, and the split is
   * deliberate. 6 232 of the 13 122 stored tariff lines state no
   * period; throwing them away at import would destroy the evidence of
   * how much of the feed is undatable, which is a thing the owner needs
   * to be able to re-measure. So they are stored and the read path
   * refuses them — `tariffsForSpot` in spots.service.ts, one predicate,
   * one place.
   */
  @Column({ name: 'valid_from', type: 'date', nullable: true })
  validFrom: string | null;

  @Column({ name: 'valid_until', type: 'date', nullable: true })
  validUntil: string | null;

  /**
   * The operator's own words for this line, verbatim, in their language.
   *
   * 🔴 Never translated and never parsed. Same rule as `description` on
   * camping_spots (CAMP-101), and here it has a second edge: these
   * strings frequently contain digits — "Tarif Mobilhome à partir de
   * 450 € / semaine". Reading a number out of one and presenting it as
   * our price is the invention CAMP-147 forbids. It is carried, rendered
   * with `lang`, and left alone.
   */
  @Column({ type: 'text', nullable: true })
  label: string | null;

  /** BCP 47. Required whenever `label` is set. */
  @Column({ name: 'label_lang', type: 'varchar', length: 8, nullable: true })
  labelLang: string | null;

  /**
   * The day the source last changed the record this came from.
   *
   * 🔴 NOT NULL. Licence Ouverte 2.0 requires the source AND the date it
   * last updated the information reused; `parse.ts` already refuses a
   * campsite without one for exactly this reason, and a price is the
   * field where a stale date does the most damage.
   */
  @Column({ name: 'source_updated_at', type: 'date' })
  sourceUpdatedAt: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
