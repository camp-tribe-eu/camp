import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Point } from 'geojson';
import { AmenityValue, CampingSpotAmenities } from '../osm/tag-mapping';

export enum CampingSpotType {
  FREE = 'free',
  PAID = 'paid',
  WILD = 'wild',
  CAMPER_STOP = 'camper_stop',
  RV_PARK = 'rv_park',
}

// Filters from mvp-strategy.md: electricity, water, shower, dog-friendly, wifi.
//
// CAMP-27 changed these from boolean to a three-state value. A boolean cannot
// say "nobody recorded this", so every unmapped OSM site would have claimed
// "no shower" and we would have printed that on the page as fact. The shape
// lives in osm/tag-mapping.ts next to the rules that produce it.
export { AmenityValue, CampingSpotAmenities } from '../osm/tag-mapping';

/** Every amenity unknown - the correct state for a spot we know nothing about. */
export const UNKNOWN_AMENITIES: CampingSpotAmenities = {
  electricity: AmenityValue.UNKNOWN,
  water: AmenityValue.UNKNOWN,
  shower: AmenityValue.UNKNOWN,
  toilets: AmenityValue.UNKNOWN,
  dogFriendly: AmenityValue.UNKNOWN,
  wifi: AmenityValue.UNKNOWN,
  // CAMP-35 / CAMP-25. No migration: the column is jsonb and
  // `readAmenities` walks AMENITY_KEYS, so a row written before these
  // existed reads them as `unknown` — which is the truth about it until
  // the next import.
  greyWater: AmenityValue.UNKNOWN,
  laundry: AmenityValue.UNKNOWN,
  wheelchair: AmenityValue.UNKNOWN,
  wheelchairFull: AmenityValue.UNKNOWN,
};

/** One source's contribution to one campsite. */
export type SpotSource = {
  /** Short stable id, e.g. "osm", "datatourisme". */
  id: string;
  /** The record's identity in that source. */
  ref: string;
  /** ISO date the source last changed it — required by Licence Ouverte. */
  updatedAt: string;
  /** Which of our fields this source is responsible for. */
  fields: string[];
};

@Entity('camping_spots')
export class CampingSpot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * CAMP-28: the stable key the weekly import upserts on, e.g. `n175673134`
   * or `w871234`. Comes from `osmium export -u type_id`.
   *
   * The type prefix is part of the key because a node and a way can carry
   * the same number. Nullable so a spot can exist without an OSM origin
   * later; Postgres allows many NULLs under a unique index.
   */
  @Index({ unique: true })
  @Column({ name: 'osm_ref', nullable: true })
  osmRef?: string;

  /**
   * Nullable because 26% of Slovenian campsites in OSM have no name at all
   * (measured, 118 of 448). Dropping a quarter of the map would be worse
   * than showing a pin whose name we honestly do not know - the same
   * principle as `unknown` amenities.
   */
  @Column({ nullable: true })
  name?: string;

  @Index()
  @Column()
  country: string;

  @Column({ nullable: true })
  region?: string;

  @Index({ unique: true })
  @Column()
  slug: string;

  @Column({ type: 'enum', enum: CampingSpotType })
  type: CampingSpotType;

  // jsonb, so the three-state change needs no migration - but note that a
  // row written before CAMP-27 would hold booleans. Nothing has been
  // imported yet, so there are no such rows; the weekly import (CAMP-28)
  // writes this shape from the start.
  @Column({ type: 'jsonb', default: {} })
  amenities: CampingSpotAmenities;

  @Index({ spatial: true })
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  location: Point;

  /**
   * 🔴 CAMP-28: fields the campsite owner corrected, which win over OSM at
   * read time — e.g. `{"name": "...", "amenities": {"shower": "yes"}}`.
   *
   * Without this the weekly import would silently erase every owner
   * correction from the claim portal (CAMP-86) once a week, and the owner
   * would watch their work disappear with no explanation. The import
   * rewrites the OSM layer and never touches this column.
   */
  @Column({ name: 'owner_overrides', type: 'jsonb', default: {} })
  ownerOverrides: Record<string, unknown>;

  /**
   * CAMP-101. The operator's own words, verbatim, in their own language.
   *
   * 🔴 Never translated by us. A machine translation of somebody's
   * description, published as though it were theirs, is invention — the
   * one thing this site exists not to do. It is carried as written and
   * rendered with `lang`, so a reader and a crawler both know what they
   * are looking at.
   */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** BCP 47, e.g. "fr". Required whenever `description` is set. */
  @Column({
    name: 'description_lang',
    type: 'varchar',
    length: 8,
    nullable: true,
  })
  descriptionLang: string | null;

  /** The operator's own site, where a source gives us one. */
  @Column({ type: 'text', nullable: true })
  website: string | null;

  /**
   * Official national classification, 1–5, where one exists.
   *
   * France publishes it (91% of Provence, 53% of Occitanie); OSM does
   * not carry it at all. It is one of the few facts we can state that a
   * volunteer map cannot — and it is an official rating, not ours.
   */
  @Column({ type: 'smallint', nullable: true })
  stars: number | null;

  /**
   * Where each field came from, and when that source last changed it.
   *
   * 🔴 Per FIELD, not per record. One campsite can be built from OSM
   * (ODbL, share-alike) and DATAtourisme (Licence Ouverte, attribution
   * with the update date). The two licences do not ask the same thing of
   * the same fields, so "sources: OSM, DATAtourisme" at the foot of a
   * page attributes neither correctly.
   */
  @Column({ type: 'jsonb', default: [] })
  sources: SpotSource[];

  /** Last import run in which OSM still contained this spot. */
  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt?: Date;

  /**
   * Set when a spot stops appearing in OSM, cleared when it comes back.
   *
   * Feeds the 410 rule from CAMP-87: an object is only declared gone after
   * it has been missing from four consecutive imports, because objects
   * deleted by mistake usually reappear within a week.
   */
  @Column({ name: 'missing_since', type: 'timestamptz', nullable: true })
  missingSince?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
