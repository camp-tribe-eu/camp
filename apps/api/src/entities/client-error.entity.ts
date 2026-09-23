import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// CAMP-92 — what the browser told us went wrong.
//
// 🔴 There is deliberately no user column, no session column and no IP
// column. The web side strips anything a person could have typed before
// the report leaves the page (apps/web/src/lib/error-report.ts); this
// side has to not put it back. An IP address is personal data under
// GDPR, and storing one to find a JavaScript bug is collecting something
// we have no basis for and no use for — the browser string and the path
// answer "which device, which page", which is the whole question.
//
// `fingerprint` is what turns a table of thousands of rows into a list
// of a dozen problems.

@Entity('client_errors')
export class ClientError {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  kind: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'text', nullable: true })
  stack: string | null;

  @Index()
  @Column({ type: 'varchar', length: 512 })
  path: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  source: string | null;

  @Column({ type: 'int', nullable: true })
  line: number | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 512 })
  userAgent: string;

  @Column({ name: 'since_load_ms', type: 'int' })
  sinceLoadMs: number;

  /** message + first stack frame — the unit a human actually triages. */
  @Index()
  @Column({ type: 'varchar', length: 512 })
  fingerprint: string;

  @Index()
  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;
}
