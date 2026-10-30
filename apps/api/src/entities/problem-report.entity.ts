import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { ProblemKind } from '../reports/problem-reports.rules';
import { CampingSpot } from './camping-spot.entity';

/**
 * One «Report a problem» from a campsite page — the first step of the
 * arbitration the owner asked for: a reader or a campsite owner says the data
 * is wrong, a person looks, and only then is anything changed. Nothing here is
 * applied to the campsite automatically, and nothing here is published.
 *
 * 🔴 WHAT IS NOT IN THIS TABLE, ON PURPOSE. No IP address, no browser string,
 * no account, no page timing, no geolocation. The web side sends four fields
 * (`apps/web/src/lib/problem-report.ts`) and the API refuses a body with a
 * fifth (`problem-reports.rules.ts`), so neither side can add one without the
 * other noticing. `contact` is the only thing that can identify a person, and
 * it is given by the person, optionally, for the one stated purpose of being
 * asked a follow-up question. `problem-reports.db.spec.ts` reads the column
 * list back from Postgres and fails on an extra one.
 *
 * 🔴 `created_at` IS THE PURGE KEY. There is no lawyer to set the term, so the
 * term is not set here; the column exists so that it CAN be, by date, when it
 * is (GDPR-REGISTER.md §10 lists this as open).
 *
 * `spot_path` is derived by the server from the row the slug resolved to, not
 * taken from the browser — it is the link the moderator clicks in Directus.
 * `ON DELETE CASCADE`: a report about a campsite that leaves the table leaves
 * with it; there is nothing to arbitrate about a row that no longer exists.
 */
@Entity('problem_reports')
export class ProblemReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'camping_spot_id', type: 'uuid' })
  campingSpotId: string;

  @ManyToOne(() => CampingSpot, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'camping_spot_id' })
  campingSpot: CampingSpot;

  /** `/camping/<cc>/<region>/<slug>` as the page is served. */
  @Column({ name: 'spot_path', type: 'text' })
  spotPath: string;

  /** One of PROBLEM_KINDS; the table's CHECK names the same values. */
  @Column({ type: 'text' })
  kind: ProblemKind;

  @Column({ type: 'text' })
  description: string;

  /** Optional. `null` is the normal case, not a missing value. */
  @Column({ type: 'text', nullable: true })
  contact: string | null;

  /** `new` → `resolved` | `dismissed`, set by a moderator in Directus. */
  @Index()
  @Column({ type: 'text', default: 'new' })
  status: 'new' | 'resolved' | 'dismissed';

  /** What the moderator did about it — for the next moderator, not shown anywhere. */
  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  /** A Directus user id — moderation is done by our people, not by visitors. */
  @Column({ name: 'reviewed_by_directus_id', type: 'uuid', nullable: true })
  reviewedByDirectusId: string | null;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
