import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';
import { DELETION_WINDOW_MS } from './account-deletion';
import { hashPassword, looksLikeStoredHash, verifyPassword } from './password';
import { normalizeEmail } from './email';
import { Viewer } from './ownership';
import { expiryFrom, isExpired, newToken, tokenHash } from './session';

/**
 * What a successful sign-in hands back. The token is shown once.
 *
 * `restored: true` appears only when this sign-in CANCELLED a deletion the
 * person had asked for (CAMP-229). It is there so that the page can say so:
 * a sign-in that quietly undid "delete my account" would leave a person
 * believing the data is gone while we keep it.
 */
export type SignedIn = { token: string; expiresAt: Date; restored?: true };

/**
 * What the account page is told about the person signed in. CAMP-229.
 *
 * 🔴 THREE FIELDS, WRITTEN OUT, AND THAT IS THE CONTRACT. The page needs a
 * name to greet, an address to show, and whether the address is confirmed.
 * It does not need the id (nothing it renders is addressed by it), the
 * creation date, or the newsletter timestamp — the settings page asks for
 * the last one when it exists, and until then it has no reason to cross the
 * wire. A field that is not here cannot leak, and cannot be rendered by a
 * page that was handed it "just in case".
 *
 * `emailVerified` is a boolean, not the timestamp: the page's only question
 * is yes or no, and the moment somebody confirmed is not its business.
 */
export type Profile = {
  email: string;
  displayName: string | null;
  emailVerified: boolean;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
  ) {
    // 🔴 Start minting the decoy now, without awaiting it.
    //
    // Review measured the hole in the lazy version: the FIRST
    // unknown-address sign-in in a process cost 340.8 ms against 173 ms
    // for a known address with a wrong password, because that one
    // request paid for minting the decoy AND then verifying against it.
    // One request per worker, but "an unknown address costs the same" was
    // simply not true for it — and the whole point of the decoy is that
    // sentence.
    //
    // Nest builds this at boot, so the hash is almost always ready
    // before the first request; a request that does arrive first awaits
    // the same promise and pays only what is left of it, never a second
    // hash. Fire-and-forget, with the rejection swallowed: a failure
    // here must not take the process down, and `signIn` will surface it
    // as a refusal.
    void decoyHash().catch(() => undefined);
  }

  /**
   * Sign in, or null.
   *
   * 🔴 ONE null for every failure — unknown email and wrong password
   * alike. Answering "no such account" turns the login form into a test
   * for whether an address is registered, which is a disclosure on its
   * own and the first step of a targeted attack.
   *
   * 🔴 The hash is verified even when no user was found, against a
   * throwaway hash of the same shape. Returning early on an unknown
   * email makes the miss measurably faster than the hit — scrypt here
   * costs ~200 ms, so the difference is not subtle, it is the loudest
   * signal on the endpoint. The wasted work is the point.
   */
  async signIn(
    email: string,
    password: string,
    now: Date = new Date(),
  ): Promise<SignedIn | null> {
    // 🔴 The same spelling every other door uses (CAMP-228). Accounts are
    // now stored lower-cased and trimmed; looking one up as typed would
    // refuse `Anna@Example.com` for an account that is `anna@example.com`.
    const user = await this.users.findOne({
      where: { email: normalizeEmail(email) },
    });
    // 🔴 `??` WAS NOT ENOUGH, AND THE GAP WAS 1 700× (CAMP-223).
    //
    // It catches `null` and `undefined`. It does not catch `''`, and a
    // row with an empty `password_hash` went straight into
    // `verifyPassword('')`, which refuses while parsing the format —
    // 0.1 ms against the 173 ms an honest verify costs. Every sentence
    // this method's comment makes about "an unknown address costs the
    // same" would have been false for that row, and no test would have
    // seen it, because no test writes an empty hash.
    //
    // So the question asked here is not "is it there" but "is it a hash
    // we could have written AND that scrypt can evaluate at our cost".
    //
    // 🔴 THE FIRST VERSION ASKED ONLY THE FIRST HALF, and review measured
    // the gap: `scrypt$1$1$1$<16B>$<32B>` is perfectly shaped, so the
    // decoy was skipped, and Node throws on a non-power-of-two N before
    // scrypt does any work — 0.1 ms against an honest 202.7 ms. The same
    // 1 700× answer, through a different gate. `p = 16`, which
    // `verifyPassword` permits, went the other way: 3 495 ms, a 17×
    // amplifier. Looking like a hash is not the same as being one this
    // process can spend an honest 200 ms on.
    //
    // The database asks the same two questions in its own constraints
    // (`users_password_hash_shape`, `users_password_hash_workable`), and
    // both are built from the constants this module exports, so they
    // cannot drift. Two independent refusals, because each is worth
    // having precisely when the other was bypassed.
    const stored = user?.passwordHash;
    const hash = looksLikeStoredHash(stored) ? stored : await decoyHash();
    const ok = await verifyPassword(password, hash);
    if (!ok || !user) return null;

    // 🔴 CAMP-229: AN ACCOUNT THAT WAS ASKED TO BE DELETED COMES BACK BY THIS
    // DOOR AND NO OTHER, with the same password, inside the window. One
    // `UPDATE … WHERE deleted_at > cutoff` decides, so that an account whose
    // window has run out and which the sweep has not removed yet is refused
    // exactly as a wrong password is (the same `null`, after the same scrypt),
    // and two sign-ins at once cannot both claim to have restored it.
    let restored = false;
    if (user.deletedAt) {
      const cutoff = new Date(now.getTime() - DELETION_WINDOW_MS);
      const back = await this.users.update(
        { id: user.id, deletedAt: MoreThan(cutoff) },
        { deletedAt: null },
      );
      if (back.affected !== 1) return null;
      restored = true;
    }
    const session = await this.startSession(user.id, now);
    return restored ? { ...session, restored: true } : session;
  }

  /**
   * Open a session for an account that has already proved who it is.
   *
   * One place, because sign-in and sign-up must mint the same thing:
   * a token that is shown once, stored only as its hash, with the same
   * expiry. Two copies of this are two chances for one of them to start
   * storing the token itself.
   */
  async startSession(
    userId: string,
    now: Date = new Date(),
  ): Promise<SignedIn> {
    const token = newToken();
    const expiresAt = expiryFrom(now);
    await this.sessions.save(
      this.sessions.create({
        userId,
        tokenHash: tokenHash(token),
        expiresAt,
      }),
    );
    return { token, expiresAt };
  }

  /**
   * Who is calling, from a raw bearer token.
   *
   * 🔴 Expiry is checked HERE, in our code, and not left to a `WHERE
   * expires_at > now()` alone. Both are cheap; one of them can be
   * removed by someone tuning a query, and `isExpired` is covered by
   * tests that do not need a database.
   */
  async resolveViewer(
    token: string | null,
    now: Date = new Date(),
  ): Promise<Viewer> {
    if (!token) return null;
    const session = await this.sessions.findOne({
      where: { tokenHash: tokenHash(token) },
    });
    if (!session || isExpired(session.expiresAt, now)) return null;
    return { id: session.userId };
  }

  /**
   * The account behind a session, shaped for the account page, or null.
   *
   * 🔴 THE PASSWORD HASH NEVER LEAVES THE DATABASE FOR THIS ROUTE, by two
   * independent means, because each is cheap and either alone can be
   * removed by someone tidying: the query names the columns it wants, and
   * the answer is built field by field instead of returning the row. A row
   * returned as it is would carry `passwordHash` into the JSON the moment
   * anyone added a column to `select` — or removed `select`.
   *
   * null when the account is gone. A session whose account was deleted is a
   * session nobody holds, and the route answers it as "not signed in".
   */
  async profile(userId: string): Promise<Profile | null> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { email: true, displayName: true, emailVerifiedAt: true },
    });
    if (!user) return null;
    return {
      email: user.email,
      displayName: user.displayName ?? null,
      emailVerified: user.emailVerifiedAt != null,
    };
  }

  /** Sign out this one session. Unknown tokens are a no-op, not an error. */
  async signOut(token: string | null): Promise<void> {
    if (!token) return;
    await this.sessions.delete({ tokenHash: tokenHash(token) });
  }
}

/**
 * A real scrypt hash of a password nobody holds, so that a sign-in for
 * an unknown address costs the same as one for a real account.
 *
 * 🔴 Computed once, lazily, from fresh randomness — never a literal in
 * the file. This repository is PUBLIC: a hash written here would be a
 * constant an attacker can recognise, which hands back exactly the
 * "unknown email vs wrong password" distinction this decoy exists to
 * remove. It is only ever spent, never compared against anything a user
 * controls.
 *
 * Lazy so that importing the module does not cost a ~200 ms scrypt at
 * boot; the promise is cached, so it is paid at most once per process.
 */
let decoy: Promise<string> | null = null;
const decoyHash = (): Promise<string> =>
  (decoy ??= hashPassword(randomBytes(32).toString('base64url')));
