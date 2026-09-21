// CAMP-89: the two moderation queues (CAMP-52 photos, CAMP-53 reviews).
//
// 🔴 Both queues reference `users`, which is OUR table, not a Directus one.
// Site visitors and campsite owners never get Directus accounts - they
// authenticate against our API. That is a deliberate boundary: it keeps
// Directus seats down, and it is also what our Open Innovation Grant
// eligibility rests on, since the grant is assessed on the organisations
// whose people log into the Directus Studio (CAMP-62).

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CampingSpot } from './camping-spot.entity';
import { User } from './user.entity';

export enum ModerationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/**
 * Who took the photo, as shown publicly: "📷 Фото: власник, червень 2026".
 */
export enum PhotoSource {
  OWNER = 'owner',
  COMMUNITY = 'community',
}

@Entity('photo_submissions')
export class PhotoSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'camping_spot_id' })
  campingSpotId: string;

  @ManyToOne(() => CampingSpot, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'camping_spot_id' })
  campingSpot: CampingSpot;

  /** Null once the account is deleted but the photo is kept unattributed. */
  @Column({ name: 'submitted_by_id', nullable: true })
  submittedById?: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'submitted_by_id' })
  submittedBy?: User;

  /** Object key in storage, not the file itself. */
  @Column({ name: 'storage_key' })
  storageKey: string;

  @Column({ type: 'enum', enum: PhotoSource })
  source: PhotoSource;

  /**
   * 🔴 Mandatory and shown publicly (CAMP-86). A campsite photo without a
   * date is worth very little - the whole differentiator is that a visitor
   * can tell whether they are looking at this year or at 2013.
   */
  @Column({ name: 'shot_on', type: 'date' })
  shotOn: Date;

  /**
   * Three separate consents, not one checkbox, because they are three
   * different permissions and bundling them would make the consent
   * meaningless. Without `licence_sublicense` the photo cannot be handed to
   * social networks or AI assistants - which is channel number one in
   * photo-content-strategy, so it is tracked separately on purpose.
   */
  @Column({ name: 'licence_publish', default: false })
  licencePublish: boolean;

  @Column({ name: 'licence_sublicense', default: false })
  licenceSublicense: boolean;

  @Column({ name: 'licence_attribution_name', nullable: true })
  licenceAttributionName?: string;

  @Column({
    type: 'enum',
    enum: ModerationStatus,
    default: ModerationStatus.PENDING,
  })
  status: ModerationStatus;

  /**
   * Shown to the submitter verbatim ("на фото немає самого кемпінгу").
   * A bare red mark just makes them send the same photo again.
   */
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt?: Date;

  /** A Directus user id - moderation is done by our people, not by visitors. */
  @Column({ name: 'reviewed_by_directus_id', type: 'uuid', nullable: true })
  reviewedByDirectusId?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'camping_spot_id' })
  campingSpotId: string;

  @ManyToOne(() => CampingSpot, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'camping_spot_id' })
  campingSpot: CampingSpot;

  @Column({ name: 'author_id', nullable: true })
  authorId?: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'author_id' })
  author?: User;

  /** 1-5. Constrained in the migration, not only here. */
  @Column({ type: 'int' })
  rating: number;

  @Column({ type: 'text', nullable: true })
  body?: string;

  /**
   * When they actually stayed. A review of a 2019 visit is not wrong, but
   * the reader deserves to know - same principle as the photo shoot date.
   */
  @Column({ name: 'stayed_on', type: 'date', nullable: true })
  stayedOn?: Date;

  @Column({
    type: 'enum',
    enum: ModerationStatus,
    default: ModerationStatus.PENDING,
  })
  status: ModerationStatus;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason?: string;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt?: Date;

  @Column({ name: 'reviewed_by_directus_id', type: 'uuid', nullable: true })
  reviewedByDirectusId?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
