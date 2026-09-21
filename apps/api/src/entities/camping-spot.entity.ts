import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
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
  dogFriendly: AmenityValue.UNKNOWN,
  wifi: AmenityValue.UNKNOWN,
};

@Entity('camping_spots')
export class CampingSpot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
