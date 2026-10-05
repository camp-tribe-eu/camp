import { readFileSync } from 'node:fs';
import { Repository } from 'typeorm';
import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';
import { AuthService } from './auth.service';
import { hashPassword } from './password';
import { expiryFrom, tokenHash } from './session';

const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const PASSWORD = 'correct horse battery staple';

const saved: Session[] = [];

const usersOf = (user: User | null) =>
  ({
    findOne: jest.fn().mockResolvedValue(user),
  }) as unknown as Repository<User>;

const sessionsOf = (row: Session | null) =>
  ({
    findOne: jest.fn().mockResolvedValue(row),
    create: jest.fn((v: Session) => v),
    save: jest.fn(async (v: Session) => {
      saved.push(v);
      return v;
    }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  }) as unknown as Repository<Session>;

let account: User;
beforeAll(async () => {
  account = {
    id: USER_ID,
    email: 'a@example.com',
    passwordHash: await hashPassword(PASSWORD),
  } as User;
});
beforeEach(() => (saved.length = 0));

describe('signIn', () => {
  it('issues a token for the right password', async () => {
    const service = new AuthService(usersOf(account), sessionsOf(null));
    const out = await service.signIn('a@example.com', PASSWORD);
    expect(out?.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  // 🔴 The whole reason the column is called token_hash. A dump of the
  // table must not be a set of working credentials.
  it('stores the HASH, never the token itself', async () => {
    const service = new AuthService(usersOf(account), sessionsOf(null));
    const out = await service.signIn('a@example.com', PASSWORD);
    expect(saved[0].tokenHash).toBe(tokenHash(out!.token));
    expect(saved[0].tokenHash).not.toBe(out!.token);
  });

  it('binds the session to the account that signed in', async () => {
    const service = new AuthService(usersOf(account), sessionsOf(null));
    await service.signIn('a@example.com', PASSWORD);
    expect(saved[0].userId).toBe(USER_ID);
  });

  it('refuses the wrong password', async () => {
    const service = new AuthService(usersOf(account), sessionsOf(null));
    await expect(service.signIn('a@example.com', 'wrong')).resolves.toBeNull();
  });

  it('refuses an unknown address', async () => {
    const service = new AuthService(usersOf(null), sessionsOf(null));
    await expect(
      service.signIn('nobody@example.com', PASSWORD),
    ).resolves.toBeNull();
  });

  it('writes no session when the password is wrong', async () => {
    const service = new AuthService(usersOf(account), sessionsOf(null));
    await service.signIn('a@example.com', 'wrong');
    expect(saved).toHaveLength(0);
  });

  /**
   * 🔴 THE TIMING ORACLE, which is the reason the decoy hash exists.
   *
   * Returning early for an unknown address makes the miss ~200 ms
   * faster than the hit — not a subtle signal, the loudest one on the
   * endpoint, and it turns the login form into a test for whether an
   * address is registered.
   *
   * Asserted as "the unknown-address path still does real work" rather
   * than by comparing two timings to each other: a ratio between two
   * measurements on a shared CI runner is a flaky test. scrypt was
   * measured at 179–220 ms here, so a floor of 50 ms separates "spent a
   * real hash" from "returned immediately" with a wide margin.
   */
  it('spends a real hash on an unknown address, so the miss is not faster', async () => {
    const service = new AuthService(usersOf(null), sessionsOf(null));
    const started = Date.now();
    await service.signIn('nobody@example.com', PASSWORD);
    expect(Date.now() - started).toBeGreaterThan(50);
  });
});

describe('resolveViewer', () => {
  const live = {
    userId: USER_ID,
    expiresAt: expiryFrom(new Date()),
  } as Session;

  it('names the account behind a live session', async () => {
    const service = new AuthService(usersOf(account), sessionsOf(live));
    await expect(service.resolveViewer('a-token')).resolves.toEqual({
      id: USER_ID,
    });
  });

  it('looks the session up by the HASH of the token, not the token', async () => {
    const sessions = sessionsOf(live);
    await new AuthService(usersOf(account), sessions).resolveViewer('a-token');
    expect((sessions.findOne as jest.Mock).mock.calls[0][0].where).toEqual({
      tokenHash: tokenHash('a-token'),
    });
  });

  it('is anonymous with no token', async () => {
    const service = new AuthService(usersOf(account), sessionsOf(live));
    await expect(service.resolveViewer(null)).resolves.toBeNull();
  });

  it('does not touch the database with no token', async () => {
    const sessions = sessionsOf(live);
    await new AuthService(usersOf(account), sessions).resolveViewer(null);
    expect(sessions.findOne).not.toHaveBeenCalled();
  });

  it('is anonymous for a token with no session', async () => {
    const service = new AuthService(usersOf(account), sessionsOf(null));
    await expect(service.resolveViewer('ghost')).resolves.toBeNull();
  });

  // 🔴 Expiry enforced in our code, not only in a WHERE clause somebody
  // could tune away.
  it('is anonymous for an expired session even though the row was found', async () => {
    const dead = {
      userId: USER_ID,
      expiresAt: new Date(Date.now() - 1),
    } as Session;
    const service = new AuthService(usersOf(account), sessionsOf(dead));
    await expect(service.resolveViewer('stale')).resolves.toBeNull();
  });
});

describe('signOut', () => {
  it('deletes by the hash of the token', async () => {
    const sessions = sessionsOf(null);
    await new AuthService(usersOf(account), sessions).signOut('a-token');
    expect(sessions.delete).toHaveBeenCalledWith({
      tokenHash: tokenHash('a-token'),
    });
  });

  it('is a no-op without a token', async () => {
    const sessions = sessionsOf(null);
    await new AuthService(usersOf(account), sessions).signOut(null);
    expect(sessions.delete).not.toHaveBeenCalled();
  });
});

/**
 * 🔴 CAMP-176's lesson, applied to the login limit.
 *
 * The number lives in throttle.ts and the decorator lives in the
 * controller, and nothing compares the two. That exact gap let
 * `/spots/map/regions` carry a bulk NUMBER in the ordinary BUCKET for
 * weeks. Here the failure would be quieter still: without the decorator
 * the route silently inherits 120 a minute, which is a password-guessing
 * budget, and every test of the login logic stays green.
 */
describe('🔴 the login route still carries its own limit', () => {
  const source = readFileSync(`${__dirname}/auth.controller.ts`, 'utf8');

  it('declares @Throttle on the login handler', () => {
    expect(/@Throttle\(\s*LOGIN\s*\)/.test(source)).toBe(true);
  });

  it('builds that limit from LOGIN_LIMIT, not a number written twice', () => {
    expect(source).toContain('LOGIN_LIMIT');
  });
});
