import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A request that found nothing. CAMP-235.
 *
 * 🔴 WHAT IS DELIBERATELY ABSENT, and why the absence is the design: no
 * IP, no user agent, no session, no cookie, no identifier of any kind.
 * Two requests from one person cannot be joined, by us or by anybody
 * reading this table. That is what keeps the consent banner's "no
 * analytics cookies" true rather than nearly true.
 *
 * What is here answers the only question asked: WHICH DEAD PATH IS BEING
 * ASKED FOR, AND WHO IS STILL LINKING TO IT — the two halves of deciding
 * where a 301 should point. `client_errors` next door made the same
 * choice for the same reason.
 *
 * The referrer is stored WITHOUT its query string; `not-found.rules.ts`
 * strips it, and says why.
 */
@Entity('not_found_hits')
export class NotFoundHit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The path asked for, without query. Indexed: the report groups by it. */
  @Index()
  @Column({ type: 'varchar', length: 512 })
  path: string;

  /** Scheme, host and path of wherever the link was. Null is meaningful: a crawler, or a typed URL. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  referrer: string | null;

  /** Indexed because every report is "the last N days". */
  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
