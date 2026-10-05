import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';
import { TripStop } from './trip-stop.entity';

// A user-planned trip, output of the Trip Planner (CAMP-6) or manually
// assembled.
//
// 🔴 "Trip Planner", never "AI Trip Planner" — the owner's decision, and a
// UCPD one: calling a deterministic algorithm AI misleads about a main
// characteristic of the product. The word was here in a comment, which is
// how it reaches a heading later. 05-planner.html states the rule.
@Entity('trips')
export class Trip {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  name: string;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate?: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate?: string;

  @OneToMany(() => TripStop, (stop) => stop.trip)
  stops: TripStop[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
