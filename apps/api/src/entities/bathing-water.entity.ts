import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { BathingStatus } from '../bathing/source';

/**
 * CAMP-168: one officially designated bathing water, for one season.
 *
 * 🔴 A TABLE OF PLACES, NOT A COLUMN ON `camping_spots`.
 *
 * The temptation is a `bathing_water_status` column on the campsite,
 * computed at import. It would be wrong in a way that only shows up
 * later: the classification belongs to the WATER, not to the campsite,
 * and the same bathing water serves several campsites while many
 * campsites are near none at all. Denormalised onto the campsite, the
 * row loses the one thing that makes it honest — the name of the place
 * that was actually sampled and how far away it is — and it goes stale
 * the moment either table is re-imported alone.
 *
 * 🔴 `season` IS PART OF THE IDENTITY.
 *
 * The data is annual. The 2025 season was published 02.06.2026, the 2024
 * season 19.06.2025; the 2026 season closing now will not be published
 * until roughly June 2027. So a row is "this bathing water, in that
 * season", the unique key carries the year, and next June's import adds
 * rows beside these instead of overwriting them. That also means the
 * year is present on every read path by construction — it cannot be
 * dropped on the way to the page, because there is no row without it.
 *
 * 🔴 `status` is NOT NULL and `not_classified` is one of its values.
 *
 * 611 of the 22 010 EU-27 sites are "Not classified" for 2025 (measured
 * 28.09.2026). Stored as NULL they would be indistinguishable from an
 * import that failed, and the page could not tell a reader which of the
 * two it is looking at — while "never render empty" requires it to.
 */
@Entity('bathing_waters')
@Index(['sourceId', 'ref', 'season'], { unique: true })
export class BathingWater {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Short stable id of the publisher — `eea-bathing-water`. */
  @Column({ name: 'source_id', type: 'text' })
  sourceId: string;

  /**
   * `bathingWaterIdentifier`, the EEA's own id, e.g. `FRP12345678`.
   *
   * Unique within the layer: measured 28.09.2026, 22 010 EU-27 rows and
   * 22 010 distinct identifiers, zero collisions.
   */
  @Column({ type: 'text' })
  ref: string;

  @Column({ type: 'text' })
  name: string;

  /** Lower-case ISO 3166-1 alpha-2 — `gr`, never the source's `EL`. */
  @Column({ type: 'text' })
  country: string;

  /** Coastal | Lake | River | Transitional, verbatim from the source. */
  @Column({ type: 'text' })
  category: string;

  /** The bathing SEASON these four samples describe. A year, never "now". */
  @Column({ type: 'int' })
  season: number;

  @Column({ type: 'text' })
  status: BathingStatus;

  /** The national bathing water profile, where the member state gives one. */
  @Column({ name: 'profile_url', type: 'text', nullable: true })
  profileUrl: string | null;

  /** geography(Point,4326). Present on 100% of the 22 010 rows. */
  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  location: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
