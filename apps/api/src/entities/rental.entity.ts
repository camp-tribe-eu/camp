// CAMP-89: the rental section's editorial content (designed in CAMP-83).
//
// No prices and no availability live here on purpose: the architecture chose
// affiliate links over API feeds, so anything resembling a live price would
// be stale within a week and misleading under UCPD art. 6(1). What we store
// is what does not change weekly - dimensions, mass, licence class - which
// is also what the partner sites are bad at presenting.

import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ContentStatus } from './content.entity';

// ---------------------------------------------------------------------------
// Camper types
// ---------------------------------------------------------------------------

/**
 * Driving licence needed. The single most expensive mistake a first-time
 * renter makes, which is why it is a column and not a sentence in prose.
 */
export enum LicenceClass {
  /** Up to 3 500 kg. */
  B = 'B',
  /** Above 3 500 kg - a plain B licence is not enough. */
  C1 = 'C1',
  /** Depends on the exact build; the page must say so rather than guess. */
  B_OR_C1 = 'B_or_C1',
  /** Trailer combinations - B / B96 / BE depending on combined mass. */
  TRAILER = 'trailer',
}

@Entity('camper_types')
export class CamperType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  slug: string;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({
    name: 'length_min_m',
    type: 'numeric',
    precision: 3,
    scale: 1,
    nullable: true,
  })
  lengthMinM?: string;

  @Column({
    name: 'length_max_m',
    type: 'numeric',
    precision: 3,
    scale: 1,
    nullable: true,
  })
  lengthMaxM?: string;

  /** Matters for tunnels and ferries, not just for parking. */
  @Column({
    name: 'height_m',
    type: 'numeric',
    precision: 3,
    scale: 1,
    nullable: true,
  })
  heightM?: string;

  @Column({
    name: 'mass_t',
    type: 'numeric',
    precision: 3,
    scale: 2,
    nullable: true,
  })
  massT?: string;

  @Column({ name: 'licence_class', type: 'enum', enum: LicenceClass })
  licenceClass: LicenceClass;

  @Column({ name: 'sleeps_min', type: 'int', nullable: true })
  sleepsMin?: number;

  @Column({ name: 'sleeps_max', type: 'int', nullable: true })
  sleepsMax?: number;

  @Column({ name: 'has_toilet', default: false })
  hasToilet: boolean;

  @Column({ name: 'has_shower', default: false })
  hasShower: boolean;

  /**
   * An estimate, and labelled as one everywhere it is shown. Real
   * consumption depends on the load and the driver.
   */
  @Column({
    name: 'fuel_estimate_l_100km',
    type: 'numeric',
    precision: 4,
    scale: 1,
    nullable: true,
  })
  fuelEstimateL100km?: string;

  @Column({ type: 'enum', enum: ContentStatus, default: ContentStatus.DRAFT })
  status: ContentStatus;
}

@Entity('camper_type_translations')
@Index(['camperTypeId', 'languageCode'], { unique: true })
export class CamperTypeTranslation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'camper_type_id' })
  camperTypeId: string;

  @ManyToOne(() => CamperType, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'camper_type_id' })
  camperType: CamperType;

  @Column({ name: 'language_code', length: 16 })
  languageCode: string;

  @Column()
  name: string;

  /** "VW California, «Буллі» · 4,9–5,4 м" - the recognisable examples. */
  @Column({ name: 'alt_names', nullable: true })
  altNames?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;
}

// ---------------------------------------------------------------------------
// Rental city pages
// ---------------------------------------------------------------------------

/**
 * A `/camper-rental/:city` page.
 *
 * 🔴 The three counters are not display data, they are the publication gate
 * from CAMP-83: a city ships only with at least 2 real routes from it, 10
 * campsites within 100 km and one local specific. Two hundred near-identical
 * city pages are doorway pages, and the penalty lands on the whole domain,
 * not on the section. Storing the counters means the rule can be enforced
 * by a check rather than by someone remembering it.
 */
@Entity('rental_cities')
export class RentalCity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  slug: string;

  @Index()
  @Column({ length: 2 })
  country: string;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lat?: string;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  lon?: string;

  @Column({ name: 'partner_count', type: 'int', default: 0 })
  partnerCount: number;

  @Column({ name: 'campsite_count_100km', type: 'int', default: 0 })
  campsiteCount100km: number;

  @Column({ name: 'route_count', type: 'int', default: 0 })
  routeCount: number;

  @Column({ type: 'enum', enum: ContentStatus, default: ContentStatus.DRAFT })
  status: ContentStatus;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /** The gate itself, so nobody has to remember the numbers. */
  meetsPublicationThreshold(): boolean {
    return (
      this.routeCount >= 2 &&
      this.campsiteCount100km >= 10 &&
      this.partnerCount >= 1
    );
  }
}

@Entity('rental_city_translations')
@Index(['rentalCityId', 'languageCode'], { unique: true })
export class RentalCityTranslation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'rental_city_id' })
  rentalCityId: string;

  @ManyToOne(() => RentalCity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rental_city_id' })
  rentalCity: RentalCity;

  @Column({ name: 'language_code', length: 16 })
  languageCode: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  intro?: string;

  /**
   * "Що знати саме тут" - the local specifics (low-emission zone, vignette,
   * pass heights). This being non-empty is the third leg of the publication
   * gate: without it the page is the same page as every other city.
   */
  @Column({ name: 'local_tips', type: 'text', nullable: true })
  localTips?: string;
}
