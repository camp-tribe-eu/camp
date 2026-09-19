import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Trip } from './trip.entity';
import { CampingSpot } from './camping-spot.entity';

// One stop in a trip itinerary; camping spot is optional (a stop can be a waypoint only)
@Entity('trip_stops')
export class TripStop {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Trip, (trip) => trip.stops, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trip_id' })
  trip: Trip;

  @Column({ name: 'trip_id' })
  tripId: string;

  @ManyToOne(() => CampingSpot, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'camping_spot_id' })
  campingSpot?: CampingSpot;

  @Column({ name: 'camping_spot_id', nullable: true })
  campingSpotId?: string;

  @Column()
  sequence: number;

  @Column({ name: 'arrival_date', type: 'date', nullable: true })
  arrivalDate?: string;
}
