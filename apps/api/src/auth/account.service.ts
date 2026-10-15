import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { AuthToken, AuthTokenKind } from '../entities/auth-token.entity';
import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';
import { AuthService } from './auth.service';
import { Cooldown } from './cooldown';
import { isPlausibleEmail, normalizeEmail } from './email';
import {
  LINK_TTL_MS,
  Mailer,
  linkFor,
  resetPasswordMessage,
  verifyEmailMessage,
} from './mail';
import { PasswordProblem, checkNewPassword } from './password-policy';
import { hashPassword } from './password';
import { isExpired, newToken, tokenHash } from './session';

/** Injection token for the mailer, or null when this process cannot send. */
export const MAILER = Symbol('MAILER');

/** The wait between two letters of one kind to one address. The card's 60. */
export const COOLDOWN_MS = 60_000;

// Domain errors. The controller maps each to one HTTP answer; nothing here
// knows about HTTP, so the rules can be exercised without a server.
export class BadEmail extends Error {}
export class WeakPassword extends Error {
  constructor(readonly problem: PasswordProblem) {
    super(problem);
  }
}
export class EmailTaken extends Error {}
export class MailUnavailable extends Error {}
export class StaleLink extends Error {}
export class TooSoon extends Error {
  constructor(readonly retryAfterSec: number) {
    super('too soon');
  }
}

export type SignedUp = {
  token: string;
  expiresAt: Date;
  email: string;
  emailVerified: false;
};

/** `23505` is Postgres's `unique_violation`; TypeORM wraps the driver error. */
const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; driverError?: { code?: string } };
  return err?.code === '23505' || err?.driverError?.code === '23505';
};

/**
 * Sign-up, confirmation and password reset (CAMP-228).
 *
 * The four legal decisions the card records, and where each lives:
 *
 *  1. The newsletter box is empty — `signUp` stores consent only for a literal
 *     `true`; anything else, including "absent", is null. (Planet49.)
 *  2. Terms have no box — nothing here takes a "terms accepted" input at all.
 *     The basis is the contract (GDPR 6(1)(b)), and an input that could be
 *     `false` would be a choice we do not offer.
 *  3. "If an account exists" — `requestLink` answers, and takes, the same for
 *     an address we hold and one we do not.
 *  4. The 60-second counter — `Cooldown`, keyed by address.
 */
@Injectable()
export class AccountService implements BeforeApplicationShutdown {
  private readonly log = new Logger(AccountService.name);

  /** Work started after a response was sent; see `later`. */
  private readonly pending = new Set<Promise<void>>();

  readonly cooldown = new Cooldown(COOLDOWN_MS);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuthToken) private readonly tokens: Repository<AuthToken>,
    private readonly auth: AuthService,
    @Inject(MAILER) private readonly mailer: Mailer | null,
  ) {}

  // ── sign-up ────────────────────────────────────────────────────────────

  /**
   * Create an account and sign it in.
   *
   * 🔴 THIS ONE DOES TELL YOU WHETHER AN ADDRESS IS TAKEN, and it is the one
   * door that cannot be made not to. The card requires that a person saves
   * their route BEFORE confirming the address, which means a session exists
   * the moment the account does; a session handed out for a new address and
   * withheld for an old one is itself the answer, whatever else is made
   * uniform. The recovery form and the "send it again" form — the two that
   * take an address and promise nothing — are uniform, and measured so
   * (`account.db.spec.ts`). This one is bounded rather than hidden: it
   * costs a scrypt hash and a letter per new address, it is counted in the
   * `mail` bucket, and it never sends a letter to an address that already has
   * an account, so it cannot be used to mail a stranger twice.
   *
   * The alternative — no session until the link is clicked — keeps this
   * uniform and breaks the card's central sentence, so it is the owner's to
   * choose, not mine.
   */
  async signUp(
    input: { email: unknown; password: unknown; newsletter: unknown },
    now: Date = new Date(),
  ): Promise<SignedUp> {
    const email = normalizeEmail(input.email);
    if (!isPlausibleEmail(email)) throw new BadEmail();
    const problem = checkNewPassword(input.password, email);
    if (problem) throw new WeakPassword(problem);
    // 🔴 Refused BEFORE the account exists. An account whose confirmation
    // letter can never be sent is an account nobody can finish creating.
    if (!this.mailer) throw new MailUnavailable();

    // Checked first only to spare the ~200 ms hash; the unique index below is
    // what actually decides, and a race lands in the `catch`.
    const taken = await this.users.findOne({
      where: { email },
      select: { id: true },
    });
    if (taken) throw new EmailTaken();

    const passwordHash = await hashPassword(input.password as string);
    let user: User;
    try {
      user = await this.users.save(
        this.users.create({
          email,
          passwordHash,
          // 🔴 `=== true`, not truthiness. "on", 1, "true" and a missing
          // field are all NOT consent; only the explicit boolean the form
          // sends when the box was ticked by a person is.
          marketingConsentAt: input.newsletter === true ? now : null,
          emailVerifiedAt: null,
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new EmailTaken();
      throw e;
    }

    const session = await this.auth.startSession(user.id, now);
    // The first letter starts the clock for "send it again", so the counter
    // the page shows is the one the server enforces.
    this.cooldown.take(`verify_email:${email}`, now);
    this.later(() => this.issue('verify_email', user, now));
    return { ...session, email, emailVerified: false };
  }

  // ── "send me a link" — the two forms that must not tell ─────────────────

  /** Forgot password. Same answer, and same wait, for every address. */
  requestReset(rawEmail: unknown, now: Date = new Date()): Promise<void> {
    return this.requestLink('reset_password', rawEmail, now);
  }

  /** Send the confirmation letter again. Same promise as `requestReset`. */
  requestVerification(
    rawEmail: unknown,
    now: Date = new Date(),
  ): Promise<void> {
    return this.requestLink('verify_email', rawEmail, now);
  }

  /**
   * 🔴 THE EXISTENCE ORACLE, THIRD TIME (CAMP-50 twice before). Everything an
   * outsider can observe about this request is decided BEFORE we know whether
   * the address has an account, or is the same work for both:
   *
   *   - configuration (503) and input shape (400) depend on neither;
   *   - the cooldown is keyed by address, so asking twice is refused alike;
   *   - the one lookup runs for every address, hit or miss;
   *   - everything that only a HIT does — minting the token, writing the row,
   *     calling the mail provider (a network round trip to a vendor; the test
   *     uses 150 ms and checks 400 in a one-off measurement) — is deferred
   *     with `later`, i.e. after the response has been written.
   *
   * The last line is the one the other three depend on: a hit that awaited
   * its own letter would answer hundreds of milliseconds after a miss, and
   * that gap is readable from any network. It is what
   * `account.db.spec.ts` measures.
   */
  private async requestLink(
    kind: AuthTokenKind,
    rawEmail: unknown,
    now: Date,
  ): Promise<void> {
    if (!this.mailer) throw new MailUnavailable();
    const email = normalizeEmail(rawEmail);
    if (!isPlausibleEmail(email)) throw new BadEmail();

    const gate = this.cooldown.take(`${kind}:${email}`, now);
    if (gate.ok === false) throw new TooSoon(gate.retryAfterSec);

    const user = await this.users.findOne({ where: { email } });
    // A confirmation letter is for an address not yet confirmed; a reset is
    // for anyone. Both are decided here but only ACTED on after the response.
    if (user && (kind === 'reset_password' || !user.emailVerifiedAt))
      this.later(() => this.issue(kind, user, now));
  }

  // ── following a link ─────────────────────────────────────────────────────

  /** Confirm the address behind a link. Throws `StaleLink` for any bad link. */
  async verifyEmail(rawToken: unknown, now: Date = new Date()): Promise<void> {
    const row = await this.liveToken('verify_email', rawToken, now);
    await this.tokens.manager.transaction(async (m) => {
      await this.claim(m, row, now);
      // Only if still unconfirmed: the FIRST confirmation is the one worth
      // remembering, and a second link must not move it.
      await m.update(
        User,
        { id: row.userId, emailVerifiedAt: IsNull() },
        { emailVerifiedAt: now },
      );
    });
  }

  /** Set a new password with a reset link. */
  async resetPassword(
    rawToken: unknown,
    newPassword: unknown,
    now: Date = new Date(),
  ): Promise<void> {
    const row = await this.liveToken('reset_password', rawToken, now);
    const user = await this.users.findOne({ where: { id: row.userId } });
    if (!user) throw new StaleLink();
    // 🔴 BEFORE the link is spent. A password that is too short must leave
    // the person able to try again, not holding a dead letter.
    const problem = checkNewPassword(newPassword, user.email);
    if (problem) throw new WeakPassword(problem);
    const passwordHash = await hashPassword(newPassword as string);

    await this.tokens.manager.transaction(async (m) => {
      await this.claim(m, row, now);
      await m.update(User, { id: user.id }, { passwordHash });
      // Any OTHER reset link we sent this person is dead as well: the reason
      // to reset is often "somebody else may have my letters".
      await m.update(
        AuthToken,
        { userId: user.id, kind: 'reset_password', usedAt: IsNull() },
        { usedAt: now },
      );
      // 🔴 And every session. A reset that leaves the old sessions alive
      // locks out the owner and lets in whoever made the reset necessary.
      await m.delete(Session, { userId: user.id });
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * The unspent, unexpired link of this KIND for this token, or `StaleLink`.
   *
   * One sentence for every way a link can be bad — unknown, expired, used,
   * the wrong kind — so the answer says nothing about which tokens exist.
   * The kind is part of the lookup: a confirmation link must not open the
   * reset form, and the reverse would be worse.
   */
  private async liveToken(
    kind: AuthTokenKind,
    raw: unknown,
    now: Date,
  ): Promise<AuthToken> {
    if (typeof raw !== 'string' || raw === '' || raw.length > 256)
      throw new StaleLink();
    const row = await this.tokens.findOne({
      where: { tokenHash: tokenHash(raw), kind },
    });
    if (!row || row.usedAt || isExpired(row.expiresAt, now))
      throw new StaleLink();
    return row;
  }

  /** Spend a link. `affected !== 1` means somebody else just did. */
  private async claim(
    m: EntityManager,
    row: AuthToken,
    now: Date,
  ): Promise<void> {
    const claimed = await m.update(
      AuthToken,
      { id: row.id, usedAt: IsNull() },
      { usedAt: now },
    );
    if (claimed.affected !== 1) throw new StaleLink();
  }

  /** Mint a link, store its hash, and send it. Runs after the response. */
  private async issue(
    kind: AuthTokenKind,
    user: Pick<User, 'id' | 'email'>,
    now: Date,
  ): Promise<void> {
    const mailer = this.mailer as Mailer;
    const token = newToken();
    await this.tokens.save(
      this.tokens.create({
        userId: user.id,
        kind,
        tokenHash: tokenHash(token),
        expiresAt: new Date(now.getTime() + LINK_TTL_MS),
        usedAt: null,
      }),
    );
    const link = linkFor(mailer.webBase, kind, token);
    await mailer.sender.send(
      kind === 'verify_email'
        ? verifyEmailMessage(user.email, link)
        : resetPasswordMessage(user.email, link),
    );
  }

  /**
   * Run `job` after the current response has gone out.
   *
   * 🔴 WHAT MATTERS IS THAT NOTHING HERE IS AWAITED BY THE REQUEST. That is
   * measured: a hit that awaited its own letter answered 150+ ms after a
   * miss (`account.db.spec.ts`, mutation "inline"). `setImmediate` rather
   * than a bare call is on top of that, and it is NOT measurable: with the
   * provider at 150 ms and 40 samples each way, the hit-minus-miss median
   * was +0.04 ms with it and +0.06 ms without. It stays because it costs
   * nothing and puts the hit-only work behind the response by construction
   * rather than by speed — but no test distinguishes the two, and nobody
   * should read this comment as one that does.
   *
   * Failures are logged by class only: a provider's error text can contain
   * the recipient, and a log of failed addresses is a list of people.
   */
  private later(job: () => Promise<void>): void {
    const done = new Promise<void>((resolve) => {
      setImmediate(() => {
        job()
          .catch((e: unknown) =>
            this.log.error(
              `letter not sent (${(e as { name?: string })?.name ?? 'error'})`,
            ),
          )
          .finally(resolve);
      });
    });
    this.pending.add(done);
    void done.then(() => this.pending.delete(done));
  }

  /** Wait for every deferred letter. Tests call it; shutdown does too. */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  /**
   * 🔴 `before`, not `on`. TypeORM closes its connection in
   * `onApplicationShutdown`, and a letter still being written when that runs
   * is a failed INSERT and a person who was told "check your email" and will
   * never get one. All `beforeApplicationShutdown` hooks run first.
   */
  beforeApplicationShutdown(): Promise<void> {
    return this.drain();
  }
}
