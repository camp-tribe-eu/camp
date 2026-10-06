import { Repository } from 'typeorm';
import { DEFAULT_LIMIT, LOGIN_LIMIT, bucketOf } from '../throttle';
import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';
import { AuthService } from './auth.service';
import { hashPassword, looksLikeStoredHash } from './password';
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
 * 🔴 CAMP-176's lesson, applied to the login limit — and my first
 * attempt at this test WAS the bug.
 *
 * I wrote `expect(/@Throttle\(\s*LOGIN\s*\)/.test(source)).toBe(true)`:
 * a regex over the controller's own text, citing CAMP-176 while
 * repeating it. It confirmed the decorator was TYPED and could not
 * confirm the decorator MEANT anything — a safeguard that agrees with
 * itself, on exactly the line that was broken.
 *
 * What was broken: `@Throttle(LOGIN)` set the number to ten, while
 * `generateKey` still filed `/auth/login` under `ordinary`. Review
 * measured it — ten `GET /spots/countries`, then the FIRST EVER
 * `POST /auth/login` answered 429 without `signIn` being called. Anyone
 * who read ten pages in a minute could not sign in.
 *
 * So this now asserts the BUCKET, which is the thing that was wrong.
 */
describe('🔴 the login route is counted in its own bucket', () => {
  it('does not share a counter with ordinary browsing', () => {
    expect(bucketOf('/auth/login')).not.toBe(bucketOf('/spots/countries'));
  });

  it('files sign-in under login', () => {
    expect(bucketOf('/auth/login')).toBe('login');
  });

  it('leaves ordinary reading where it was', () => {
    expect(bucketOf('/spots/countries')).toBe('ordinary');
  });

  it('does not steal the bulk routes', () => {
    expect(bucketOf('/spots/index')).toBe('bulk');
  });

  // The router is case-insensitive and tolerates a trailing slash, so
  // the bucket must be too — the same hole isBulkPath already had.
  it.each(['/auth/login/', '/AUTH/LOGIN', '/auth/login?next=/map'])(
    'files %s under login as well',
    (path) => {
      expect(bucketOf(path)).toBe('login');
    },
  );

  // The number still has to be the small one.
  it('carries a limit far below the ordinary one', () => {
    expect(LOGIN_LIMIT.limit).toBeLessThan(DEFAULT_LIMIT.limit / 4);
  });
});

// CAMP-223 — a stored hash that is not a hash must cost what a miss costs.
//
// 🔴 FOUND BY REVIEW, NOT BY A TEST, and the reason no test found it is
// the reason this one is written the way it is: `??` catches `null` and
// `undefined`, so every test that writes a hash writes a real one, and
// the gap only exists for a value no test produces. Review measured it
// at 0.1 ms against 173 ms — a 1 700× answer to "does this account
// exist", readable from any network.
//
// The database now refuses to store such a row at all
// (`users_password_hash_shape`), so this exercises the second refusal:
// the one in `signIn`, which has to hold when the database was bypassed.
describe('a stored value that is not a hash costs what a miss costs', () => {
  /** Milliseconds for one signIn, measured not guessed. */
  async function took(user: User | null): Promise<number> {
    const service = new AuthService(usersOf(user), sessionsOf(null));
    const started = process.hrtime.bigint();
    await service.signIn('a@example.com', 'whatever the password is');
    return Number(process.hrtime.bigint() - started) / 1e6;
  }

  const broken = (hash: string) =>
    ({ id: USER_ID, email: 'a@example.com', passwordHash: hash }) as User;

  // Each of these reached `verifyPassword` directly before the fix, and
  // each is refused there while parsing — which is to say, instantly.
  const b64 = (n: number) => Buffer.alloc(n, 7).toString('base64');

  const SHAPES: [string, string][] = [
    // 🔴 THE SECOND ROUND, AND IT IS THE SAME DEFECT ONE DOOR ALONG.
    //
    // Every case below the divider is shape-INVALID, so all six only ever
    // exercised the decoy branch. Review asked the question I had not:
    // what passes the shape and STILL refuses instantly? Measured here:
    //
    //   honest hash                      202.7 ms
    //   scrypt$1$1$1$…    (N not 2^k)      0.1 ms    ← 2000×
    //   N = 2^30          (over Node's)    0.3 ms
    //   N = 2^20, r = 32  (over maxmem)    0.0 ms
    //   N = 2^20, r = 1   (N < 2^16r)      0.0 ms
    //   p = 16 = MAX.p                  3495.3 ms    ← 17× the other way
    //
    // The shape said yes to all five. Checking that a hash LOOKS like
    // ours is not the same as checking that scrypt can evaluate it, and
    // the gap between those two is exactly the oracle CAMP-223 is about.
    ['N that is not a power of two', `scrypt$1$1$1$${b64(16)}$${b64(32)}`],
    [
      'N past what Node will accept',
      `scrypt$1073741824$8$1$${b64(16)}$${b64(32)}`,
    ],
    [
      'N and r past the memory ceiling',
      `scrypt$1048576$32$1$${b64(16)}$${b64(32)}`,
    ],
    ['N past the N < 2^16r rule', `scrypt$1048576$1$1$${b64(16)}$${b64(32)}`],
    // ── shapes that never looked like ours in the first place ──
    ['empty', ''],
    ['the format name alone', 'scrypt'],
    ['too few fields', 'scrypt$131072$8$1'],
    [
      'a salt too short to be ours',
      'scrypt$131072$8$1$AA==$AAAAAAAAAAAAAAAAAAAAAA==',
    ],
    ['a key too short to be ours', 'scrypt$131072$8$1$AAAAAAAAAAA=$AA=='],
    [
      'another algorithm',
      'bcrypt$131072$8$1$AAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAA==',
    ],
  ];

  // 🔴 The whole run is one measurement, not one per case: scrypt costs
  // ~200 ms and six of those plus a baseline is most of a minute.
  jest.setTimeout(60_000);

  it.each(SHAPES)(
    '%s is not faster than an unknown address',
    async (_what, hash) => {
      // The baseline is measured in the same process, on the same run, so
      // a slow machine moves both numbers together. A ratio against a
      // hard-coded millisecond count would be a test of the runner.
      const miss = await took(null);
      const withBrokenRow = await took(broken(hash));

      // 🔴 The card's own bar: "no more than twice". Stated as a ratio
      // because the absolute number is the machine's, not the code's.
      expect(withBrokenRow).toBeGreaterThan(miss / 2);
      expect(withBrokenRow).toBeLessThan(miss * 2);
    },
  );

  // 🔴 THE RESIDUAL, NAMED RATHER THAN HIDDEN. `p = 16` is inside what
  // `verifyPassword` permits and inside what `hashPassword` can make, so
  // a row carrying it is refused by nothing — and it costs about 17× an
  // honest verify. That is deliberate after review:
  //
  //   the ceiling that used to refuse it SIGNED REAL USERS OUT (p = 5, 8
  //   and 16 all hash, verify, and were refused), inverted into a floor
  //   if SCRYPT were ever lowered, and drifted from the database the
  //   moment the migration was applied.
  //
  // Writing such a row needs write access to `password_hash`, and anyone
  // with that can store a hash of a password they know and sign in as
  // whoever they like. A CPU amplifier is not the marginal risk there.
  it('a costly-but-legal hash is SLOWER, not faster — the opposite of an oracle', async () => {
    const miss = await took(null);
    const costly = await took(
      broken(`scrypt$131072$8$16$${b64(16)}$${b64(32)}`),
    );
    expect(costly).toBeGreaterThan(miss);
  }, 60_000);

  it('…and the old `??` really was the gap, not a theory', () => {
    // Pinned as an assertion rather than a sentence in a comment: `??`
    // passes an empty string through, and that single fact is the whole
    // defect. If JavaScript ever changed this, the comment above would
    // quietly become wrong.
    const empty = '';
    expect(empty ?? 'decoy').toBe('');
    expect(looksLikeStoredHash(empty)).toBe(false);
  });
});
