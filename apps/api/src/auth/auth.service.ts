import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';
import { hashPassword, looksLikeStoredHash, verifyPassword } from './password';
import { Viewer } from './ownership';
import { expiryFrom, isExpired, newToken, tokenHash } from './session';

/** What a successful sign-in hands back. The token is shown once. */
export type SignedIn = { token: string; expiresAt: Date };

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
    const user = await this.users.findOne({ where: { email } });
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
    // we could have written". Anything else — empty, truncated,
    // hand-edited, written by a tool that did not know the format —
    // falls to the decoy and costs exactly what a miss costs.
    //
    // The database refuses the same shape (users_password_hash_shape),
    // and `password.spec.ts` asserts the two use the same pattern. Two
    // independent refusals, because each is worth having precisely when
    // the other was bypassed.
    const stored = user?.passwordHash;
    const hash = looksLikeStoredHash(stored) ? stored : await decoyHash();
    const ok = await verifyPassword(password, hash);
    if (!ok || !user) return null;

    const token = newToken();
    const expiresAt = expiryFrom(now);
    await this.sessions.save(
      this.sessions.create({
        userId: user.id,
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
