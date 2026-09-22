import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RoutePoint } from './route-point.entity';

// Curated routes per mvp-strategy.md, e.g. "Norway Fjords 10 Days"
@Entity('routes')
export class Route {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Index({ unique: true })
  @Column()
  slug: string;

  @Index()
  @Column()
  country: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'duration_days' })
  durationDays: number;

  @Column({ name: 'distance_km', type: 'float', nullable: true })
  distanceKm?: number;

  @OneToMany(() => RoutePoint, (point) => point.route)
  points: RoutePoint[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
