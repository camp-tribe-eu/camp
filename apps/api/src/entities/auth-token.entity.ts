import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

/** What a link in a letter is for. The database holds the same two words. */
export type AuthTokenKind = 'verify_email' | 'reset_password';

/**
 * A single-use link sent by email. CAMP-228.
 *
 * 🔴 THE COLUMN IS `token_hash`, NEVER THE TOKEN — the same rule as
 * `sessions`, for the same reason: a dump of this table must not be a set of
 * working "reset anybody's password" links. The token is 32 bytes from the
 * CSPRNG, so a fast hash is the right one (see `tokenHash` in session.ts).
 *
 * `usedAt` is what makes a link single-use, and it is claimed with
 * `UPDATE … WHERE used_at IS NULL`, so two clicks racing for one token cannot
 * both win.
 */
@Entity('auth_tokens')
export class AuthToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'text' })
  kind: AuthTokenKind;

  @Index({ unique: true })
  @Column({ name: 'token_hash', length: 64 })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
