import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { Point } from 'geojson';

export enum CampingSpotType {
  FREE = 'free',
  PAID = 'paid',
  WILD = 'wild',
  CAMPER_STOP = 'camper_stop',
  RV_PARK = 'rv_park',
}

// Filters from mvp-strategy.md: electricity, water, shower, dog-friendly, wifi
export interface CampingSpotAmenities {
  electricity: boolean;
  water: boolean;
  shower: boolean;
  dogFriendly: boolean;
  wifi: boolean;
}

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
