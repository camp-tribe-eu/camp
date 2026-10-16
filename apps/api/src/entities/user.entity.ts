import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ name: 'display_name', nullable: true })
  displayName?: string;

  /**
   * When the person proved they can read this mailbox, or null.
   *
   * 🔴 NOT A GATE ON ANYTHING THAT EXISTS. CAMP-228: confirming the address
   * is needed for the letters we send, not for what the person came to do —
   * they save their route first. Anything that later reads this column to
   * refuse an action has to be one of the public ones the mockup names
   * (publishing a photo, confirming ownership of a campsite), and
   * `account.db.spec.ts` fails if signing in itself starts to depend on it.
   */
  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt?: Date | null;

  /**
   * When the person ticked the newsletter box, or null.
   *
   * 🔴 NULL IS THE DEFAULT AND THE ONLY THING A MISSING BOX MAY MEAN. A
   * pre-ticked box is not consent (CJEU Planet49, C-673/17), so the only
   * value that ever lands here is the moment of an explicit `true`.
   * Sending requires BOTH this and `emailVerifiedAt`: the tick is the
   * request, the confirmed address is the proof it came from the owner.
   */
  @Column({ name: 'marketing_consent_at', type: 'timestamptz', nullable: true })
  marketingConsentAt?: Date | null;

  /**
   * When the person asked to delete the account, or null for everyone alive.
   *
   * 🔴 NOT A FLAG THE REST OF THE CODE MAY IGNORE. Access ends in the request
   * that sets this (the sessions are deleted with it); the row stays for
   * `DELETION_WINDOW_DAYS` so that signing in with the same password can undo a
   * mistake, and `AuthService.signIn` is the only reader that treats it as
   * anything but "this person is gone": a reset letter is not sent, a link is
   * not honoured. After the window `AccountRightsService.purge` deletes the row.
   */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
