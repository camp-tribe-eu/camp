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

/**
 * A signed-in session. CAMP-50 part 2.
 *
 * 🔴 The column is `token_hash`, never the token. The raw token is
 * returned to the client once, at login, and is not recoverable from
 * this table afterwards — so a dump of `sessions` is not a set of
 * working credentials. See the SHA-256-vs-scrypt note in auth/session.ts
 * for why this one is a fast hash and the password one is not.
 */
@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  // Looked up on every authenticated request, so it is the index.
  @Index({ unique: true })
  @Column({ name: 'token_hash', length: 64 })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
