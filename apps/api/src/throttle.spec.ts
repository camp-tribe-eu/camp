import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  BULK_LIMIT,
  BULK_ROUTES,
  bucketOf,
  clientKey,
  CONSENT_LIMIT,
  CONSENT_ROUTES,
  DEFAULT_LIMIT,
  isBulkPath,
  isExempt,
  LOGIN_ROUTES,
  MAIL_LIMIT,
  MAIL_ROUTES,
  PLAN_LIMIT,
  PLAN_ROUTES,
} from './throttle';

// CAMP-69 — the rate limit, checked without booting Nest.
//
// 🔴 The interesting failures here are not "the limiter counts wrong" —
// @nestjs/throttler does the counting and is tested by its authors. They
// are ours: a number that drifts into uselessness, an expensive route
// added later without the tighter limit, and counting every reader in
// Europe as one caller because we read the wrong header.

describe('the numbers', () => {
  it('the default is generous for a person and mean to a scraper', () => {
    expect(DEFAULT_LIMIT.ttl).toBe(60_000);
    // Two a second sustained. Below this a reader clicking around is
    // never affected; above it, the number stops meaning anything.
    expect(DEFAULT_LIMIT.limit).toBeGreaterThanOrEqual(60);
    expect(DEFAULT_LIMIT.limit).toBeLessThanOrEqual(300);
  });

  it('the bulk limit is far below the default, or it is not a limit', () => {
    expect(BULK_LIMIT.ttl).toBe(60_000);
    // 🔴 The assertion that matters. If somebody "fixes a flaky build"
    // by raising this to the default, the tighter limit has been deleted
    // while still looking present.
    expect(BULK_LIMIT.limit).toBeLessThan(DEFAULT_LIMIT.limit / 10);
    // And at least enough for the build, which asks for each once.
    expect(BULK_LIMIT.limit).toBeGreaterThanOrEqual(3);
  });
});

// 🔴 Everything in this block was missing, and an adversarial review
// found the holes by measuring the running API. Each case below is one
// it confirmed, written so the hole cannot reopen.
describe('🔴 the token branch, which no test used to execute', () => {
  it('a matching token exempts', () => {
    expect(isExempt('/spots/index', 'secret', 'secret')).toBe(true);
  });

  it('a wrong token does not', () => {
    expect(isExempt('/spots/index', 'guess', 'secret')).toBe(false);
  });

  it('an empty token does not, even against an empty expectation', () => {
    // The `undefined === undefined` shape that lets the world through.
    expect(isExempt('/spots/index', '', '')).toBe(false);
    expect(isExempt('/spots/index', undefined, undefined)).toBe(false);
    expect(isExempt('/spots/index', null, '')).toBe(false);
  });

  it('nothing is exempt when no token is configured at all', () => {
    expect(isExempt('/spots/index', 'anything', undefined)).toBe(false);
    expect(isExempt('/spots/index', 'anything', '')).toBe(false);
  });
});

describe('🔴 which bucket a path lands in', () => {
  // Without this, @nestjs/throttler keys per handler and the three
  // whole-dataset routes each get their own six a minute — eighteen
  // where the file promises six. Measured on the running API.
  it('every bulk route is recognised', () => {
    for (const r of BULK_ROUTES) {
      expect(isBulkPath(`/${r}`)).toBe(true);
      expect(isBulkPath(`/${r}?limit=20000`)).toBe(true);
      expect(isBulkPath(`/${r}/`)).toBe(true);
    }
  });

  it('an ordinary route is not', () => {
    expect(isBulkPath('/spots/countries')).toBe(false);
    expect(isBulkPath('/spots/fr/lot/camping-du-lac')).toBe(false);
    expect(isBulkPath('/guides')).toBe(false);
    expect(isBulkPath('/')).toBe(false);
  });

  it('a path that merely starts like one is not', () => {
    // /spots/index-of-something must not inherit the bulk bucket, and
    // /spots/indexes must not either.
    expect(isBulkPath('/spots/indexes')).toBe(false);
    expect(isBulkPath('/spots/index-of-things')).toBe(false);
  });
});

describe('who a request is counted against', () => {
  // 🔴 The failure this prevents is not a leak, it is an outage we build
  // ourselves: behind Cloudflare every request arrives from Cloudflare's
  // address, so counting `req.ip` would put all of Europe in one bucket
  // and 429 the seventh reader of the day.
  it('prefers the real client address Cloudflare passes through', () => {
    expect(
      clientKey({ 'cf-connecting-ip': '203.0.113.7' }, '198.51.100.1', true),
    ).toBe('203.0.113.7');
  });

  it('falls back to the socket address when the header is absent', () => {
    expect(clientKey({}, '198.51.100.1', true)).toBe('198.51.100.1');
  });

  it('ignores an empty or absurd header rather than keying on rubbish', () => {
    expect(clientKey({ 'cf-connecting-ip': '' }, '198.51.100.1', true)).toBe(
      '198.51.100.1',
    );
    // Longer than any IPv6 address: somebody is sending us a payload,
    // not an address, and a bucket key of unbounded length is a memory
    // leak with extra steps.
    expect(
      clientKey({ 'cf-connecting-ip': 'x'.repeat(500) }, '198.51.100.1', true),
    ).toBe('198.51.100.1');
  });

  it('ignores a header that is not a string', () => {
    expect(clientKey({ 'cf-connecting-ip': 12345 }, '198.51.100.1', true)).toBe(
      '198.51.100.1',
    );
  });
});

// 🔴 Express matches routes case-insensitively by default, and Nest does
// not override it. So the limiter has to as well, or a capital letter is
// a way round it.
describe('the bulk bucket follows the router, not the spelling', () => {
  it.each([
    '/SPOTS/SEARCH-INDEX',
    '/Spots/Map/Points',
    '/spots/index/',
    '//spots/index',
    '/spots/search-index?x=1',
  ])('%s is still a whole-dataset route', (path) => {
    expect(isBulkPath(path)).toBe(true);
  });

  it.each(['/spots/si', '/spots', '/spots/indexes', '/health'])(
    '%s is not',
    (path) => {
      expect(isBulkPath(path)).toBe(false);
    },
  );
});

describe('what is exempt', () => {
  it('the root, because a monitor is meant to poll it', () => {
    expect(isExempt('/')).toBe(true);
  });

  // 🔴 /health, now that CAMP-59 has made it real.
  //
  // It was exempt before the route existed — measured, it 404d — and the
  // exemption was removed with a note saying it returns when the route
  // does. This test is the other half of that note: it fails if the
  // exemption is ever added back without the controller, and it fails if
  // the controller is deleted while the exemption stays.
  it('and /health, because a monitor polling it must never be throttled', () => {
    expect(isExempt('/health')).toBe(true);
  });

  // 🔴 However the monitor's URL field happened to be filled in.
  //
  // Review found the exemption comparing raw strings, so `/health/` —
  // the commonest way a person types a URL — was throttled like any
  // scraper. The route answers all of these; the exemption must too.
  it.each(['/health/', '/HEALTH', '/Health/', '//health', '/health?probe=1'])(
    '%s is the same route to the router, so it is exempt too',
    (path) => {
      expect(isExempt(path)).toBe(true);
    },
  );

  it('and the root with a query, which a monitor often adds', () => {
    expect(isExempt('/?probe=1')).toBe(true);
  });

  // 🔴 `//` is not the root. Express answers it with a 404, so exempting
  // it bought nothing and gave an unlimited path to anyone who found it.
  // The first version of the normalisation did exactly that.
  it.each(['//', '///', '//?x=1'])(
    '%s is a 404, not the root, and stays counted',
    (path) => {
      expect(isExempt(path)).toBe(false);
    },
  );

  // The normalisation must not turn into "anything containing health".
  it.each(['/health/deep', '/healthz', '/spots/health'])(
    '%s is a different route and stays throttled',
    (path) => {
      expect(isExempt(path)).toBe(false);
    },
  );

  it('the health route exists, or its exemption is a lie', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('node:fs');
    const controller = readFileSync(
      `${__dirname}/health/health.controller.ts`,
      'utf8',
    );
    expect(
      controller.includes("@Controller('health')") + ' in health.controller.ts',
    ).toBe(true + ' in health.controller.ts');
  });

  it('and nothing else — especially not the expensive routes', () => {
    for (const route of BULK_ROUTES) expect(isExempt(`/${route}`)).toBe(false);
    expect(isExempt('/spots/fr/lot/camping-du-lac')).toBe(false);
    expect(isExempt('/client-errors')).toBe(false);
  });
});

// 🔴 The test that earns its place.
//
// The tighter limit is applied with a decorator, and a decorator is
// something you have to remember. The next expensive route will be added
// by somebody who does not know this file exists, it will silently
// inherit the generous default, and nothing will fail — until the
// traffic bill. So the list of routes that MUST carry it is data, and
// this reads the controller to check the decorator is actually there.
// 🔴 CAMP-176 FOLDED TWO READINGS OF THE SAME FILE INTO ONE.
//
// This block used to re-read `spots.controller.ts` with its own regex,
// which demanded `@Throttle(BULK)` on the line directly ABOVE `@Get`.
// Nest does not care about that order and no formatter enforces it, so
// writing the two the other way round turned this red while the route
// was perfectly well decorated — a test that fails on correct code
// teaches people to edit the test.
//
// The parse now lives in one place, below, and reads every controller.
// What remains here is the half that parse cannot assert about itself.
describe('🔴 every bulk route actually carries the bulk limit', () => {
  it('and the list is not empty, or this suite proves nothing', () => {
    expect(BULK_ROUTES.length).toBeGreaterThan(0);
  });
});

// 🔴 CAMP-176. THE DECORATOR AND THE LIST ARE TWO STATEMENTS ABOUT ONE
// ROUTE, AND NOTHING COMPARED THEM.
//
// `@Throttle(BULK)` sets the NUMBER the library enforces; `BULK_ROUTES`
// decides which BUCKET the request is counted in. `/spots/map/regions`
// had the first and not the second, so it carried a six-a-minute limit
// while sharing the ordinary counter — measured against the running API,
// six calls to `/spots/countries` were enough to make the next
// `/spots/map/regions` answer 429, without that route being called at
// all.
//
// A list kept by hand beside a decorator drifts. This reads the
// controller and compares, so the next one cannot.
describe('🔴 the decorator and the bucket list agree', () => {
  /**
   * Every controller, not one of them.
   *
   * 🔴 The first version read `spots.controller.ts` alone. Review put a
   * `@Throttle(BULK)` on a route in `routes.controller.ts` and this
   * suite stayed green — and the other direction was worse: adding a
   * legitimately heavy route from another controller to BULK_ROUTES
   * turned the suite RED although everything was right. A check that is
   * blind outwards and blocks growth inwards is not a check, it is a
   * fence around one file.
   */
  const controllers = (function find(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? find(join(dir, e.name))
        : e.name.endsWith('.controller.ts')
          ? [join(dir, e.name)]
          : [],
    );
  })(__dirname);

  /**
   * The paths whose handler carries a bulk throttle, read by PAIRING
   * decorators with the route they sit above.
   *
   * 🔴 One regex spanning both decorators was wrong in four ways review
   * demonstrated, each leaving the suite green while the route stayed in
   * the ordinary bucket: the decorators written in the other order (Nest
   * does not care, and no formatter reorders them), double quotes, a
   * BLOCK comment between them, and `@Throttle({ default: BULK_LIMIT })`
   * — which is Nest's own canonical spelling.
   *
   * So: strip comments, walk the lines, and collect the decorators that
   * belong to each route whichever order they appear in.
   */
  const routesCarrying = (THROTTLE: RegExp): string[] =>
    controllers
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8').replace(
          /\/\*[\s\S]*?\*\//g,
          '',
        );
        const prefixes = [
          ...source.matchAll(
            /@Controller\(\s*(?:\[([^\]]*)\]|['"`]([^'"`]*)['"`])?\s*\)/g,
          ),
        ].flatMap((m) =>
          m[1]
            ? [...m[1].matchAll(/['"`]([^'"`]*)['"`]/g)].map((q) => q[1])
            : [m[2] ?? ''],
        );
        const prefix = prefixes[0] ?? '';

        const ROUTE =
          /^\s*@(?:Get|Post|Put|Patch|Delete|All)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/;

        const out: string[] = [];
        let pending: string[] = [];
        for (const raw of source.split('\n')) {
          const line = raw.replace(/\/\/.*$/, '');
          if (/^\s*$/.test(line)) continue;
          const route = ROUTE.exec(line);
          if (route) {
            // The throttle may sit above the route OR below it; both are
            // collected, because Nest applies them the same way.
            if (pending.some((d) => THROTTLE.test(d))) {
              out.push([prefix, route[1] ?? ''].filter(Boolean).join('/'));
            }
            pending = [line];
            continue;
          }
          if (/^\s*@/.test(line)) {
            pending.push(line);
            // A throttle written UNDER its route decorator belongs to it.
            if (THROTTLE.test(line)) {
              const prev = pending.find((d) => ROUTE.test(d));
              const m = prev ? ROUTE.exec(prev) : null;
              if (m) out.push([prefix, m[1] ?? ''].filter(Boolean).join('/'));
            }
            continue;
          }
          pending = [];
        }
        return out;
      })
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort();

  const decorated = routesCarrying(/^\s*@Throttle\(.*\bBULK(?:_LIMIT)?\b/);

  // 🔴 An empty reading passes every comparison below. If the decorator
  // is ever spelled differently, this is what says so instead of
  // quietly agreeing that there are no bulk routes at all.
  it('the controllers really were read', () => {
    expect(controllers.length).toBeGreaterThan(0);
    expect(decorated.length).toBeGreaterThan(0);
  });

  // 🔴 The offenders are collected and asserted as a LIST, so the
  // failure names every route at once instead of stopping at the first.
  it('every route a controller marks heavy is in the heavy bucket', () => {
    const decoratedNotBucketed = decorated.filter(
      (p) => !(BULK_ROUTES as readonly string[]).includes(p),
    );
    expect(decoratedNotBucketed).toEqual([]);
  });

  it('and nothing is in the heavy bucket without the decorator', () => {
    const bucketedNotDecorated = (BULK_ROUTES as readonly string[]).filter(
      (p) => !decorated.includes(p),
    );
    expect(bucketedNotDecorated).toEqual([]);
  });
});

// CAMP-228. THE SAME TWO STATEMENTS ABOUT ONE ROUTE, FOR THE OTHER TWO BUCKETS.
//
// The check above compares the BULK decorator with BULK_ROUTES. Sign-in and
// the letter routes have the same shape of risk — `@Throttle(LOGIN)` sets the
// number, `LOGIN_ROUTES` sets the bucket — and nothing compared either pair:
// the comment on `login()` says a test reads the controller, and the test
// that did was replaced by one that asserts the bucket. So the comparison is
// made here, with the same reading of the controllers, for both.
describe('🔴 the login, mail, consent and plan decorators agree with their route lists', () => {
  const controllers = (function find(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? find(join(dir, e.name))
        : e.name.endsWith('.controller.ts')
          ? [join(dir, e.name)]
          : [],
    );
  })(__dirname);

  /** `@Throttle(NAME…)` above (or below) `@Post('x')`, as `prefix/x`. */
  function carrying(name: string): string[] {
    const throttle = new RegExp(`^\\s*@Throttle\\(.*\\b${name}(?:_LIMIT)?\\b`);
    const out: string[] = [];
    for (const file of controllers) {
      const source = readFileSync(file, 'utf8').replace(
        /\/\*[\s\S]*?\*\//g,
        '',
      );
      const prefix =
        /@Controller\(\s*['"`]([^'"`]*)['"`]\s*\)/.exec(source)?.[1] ?? '';
      const route =
        /^\s*@(?:Get|Post|Put|Patch|Delete|All)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/;
      let pending: string[] = [];
      for (const raw of source.split('\n')) {
        const line = raw.replace(/\/\/.*$/, '');
        if (/^\s*$/.test(line)) continue;
        const m = route.exec(line);
        if (m) {
          if (pending.some((d) => throttle.test(d)))
            out.push([prefix, m[1] ?? ''].filter(Boolean).join('/'));
          pending = [line];
        } else if (/^\s*@/.test(line)) {
          pending.push(line);
          if (throttle.test(line)) {
            const prev = pending.find((d) => route.test(d));
            const pm = prev ? route.exec(prev) : null;
            if (pm) out.push([prefix, pm[1] ?? ''].filter(Boolean).join('/'));
          }
        } else pending = [];
      }
    }
    return out.filter((v, i, a) => a.indexOf(v) === i).sort();
  }

  it('the controllers really were read', () => {
    expect(carrying('LOGIN')).not.toEqual([]);
    expect(carrying('MAIL')).not.toEqual([]);
    expect(carrying('CONSENT')).not.toEqual([]);
    expect(carrying('PLAN')).not.toEqual([]);
  });

  // CAMP-391. `@Throttle(PLAN)` sets the number, `PLAN_ROUTES` sets the bucket:
  // the same two statements about one route as the three above.
  it('every route marked PLAN is in PLAN_ROUTES, and nothing else is', () => {
    expect(carrying('PLAN')).toEqual([...PLAN_ROUTES].sort());
  });

  it('every route marked CONSENT is in CONSENT_ROUTES, and nothing else is', () => {
    expect(carrying('CONSENT')).toEqual([...CONSENT_ROUTES].sort());
  });

  it('every route marked LOGIN is in LOGIN_ROUTES, and nothing else is', () => {
    expect(carrying('LOGIN')).toEqual([...LOGIN_ROUTES].sort());
  });

  it('every route marked MAIL is in MAIL_ROUTES, and nothing else is', () => {
    expect(carrying('MAIL')).toEqual([...MAIL_ROUTES].sort());
  });

  // 🔴 CAMP-229 ЗРОБИЛА ЇХ ЧОТИРМА. `account/email` шле лист на вказану
  // адресу, тож належить сюди, а не до LOGIN_ROUTES, де він спершу й був:
  // кошик входу вдесятеро щедріший (10 за 60 с проти 10 за 600 с), і
  // маршрут, що шле листи, там підняв би стелю бомбардування чужої
  // скриньки з 60 листів на годину до 600.
  it('and the routes it names are the four that can send a letter', () => {
    expect([...MAIL_ROUTES].sort()).toEqual([
      'account/email',
      'auth/forgot',
      'auth/resend-verification',
      'auth/signup',
    ]);
  });
});

describe('🔴 the mail bucket (CAMP-228)', () => {
  it.each([
    '/auth/signup',
    '/auth/forgot',
    '/auth/resend-verification',
    '/account/email',
  ])('files %s under mail', (path) => {
    expect(bucketOf(path)).toBe('mail');
  });

  // The router is case-insensitive and tolerates a trailing slash and a
  // query, so the bucket must be too — the hole isBulkPath already had.
  it.each([
    '/auth/forgot/',
    '/AUTH/FORGOT',
    '/auth/forgot?utm=x',
    '//auth/forgot',
    '/Auth/Resend-Verification/',
  ])('files %s under mail as well', (path) => {
    expect(bucketOf(path)).toBe('mail');
  });

  it('does not share a counter with sign-in, ordinary reading or the bulk routes', () => {
    expect(bucketOf('/auth/login')).toBe('login');
    expect(bucketOf('/spots/countries')).toBe('ordinary');
    expect(bucketOf('/spots/index')).toBe('bulk');
    expect(bucketOf('/auth/forgot')).not.toBe(bucketOf('/auth/login'));
  });

  // The routes that SPEND a one-time link stay in the ordinary bucket, and the
  // reason is not "that is where they landed":
  //
  //   · a garbage token costs one indexed lookup (1.02 ms measured), so there
  //     is nothing scarce to count;
  //   · the one expensive thing — a scrypt hash on /auth/reset-password — is
  //     reached only through a VALID link, and the service allows one hash per
  //     link (twelve concurrent posts: one hash, `account.db.spec.ts`), and a
  //     link costs a letter, which IS the mail bucket's;
  //   · guessing a link is not what any bucket here stops. Its 256 bits are,
  //     and the length is asserted as a literal in `account.db.spec.ts` and
  //     `session.spec.ts`.
  //
  // This pins it so a "tidy-up" that moves them into mail (and lets ten wrong
  // clicks lock out sign-up) is a red test and not a surprise — and so that
  // anyone who wants them elsewhere has to read the three lines above first.
  // CAMP-229 adds `/auth/me`: the account page asks it once per visit, and it
  // must not share a counter with password guessing, or a person who opens
  // their cabinet four times in a minute would be spending the budget that
  // exists to stop someone else guessing their password.
  it.each([
    '/auth/verify-email',
    '/auth/reset-password',
    '/auth/logout',
    '/auth/me',
  ])('leaves %s in the ordinary bucket', (path) => {
    expect(bucketOf(path)).toBe('ordinary');
  });

  // CAMP-229 (3/3). Deleting an account checks a password, so it is counted
  // WITH sign-in; the export routes cost a few indexed reads and a status poll
  // every second or two, so they are ordinary.
  it.each(['/account/delete', '/ACCOUNT/DELETE/', '/account/delete?x=1'])(
    'files %s with sign-in, not with ordinary reading',
    (path) => {
      expect(bucketOf(path)).toBe('login');
    },
  );

  it.each(['/account/export', '/account/export/file', '/account'])(
    'leaves %s in the ordinary bucket',
    (path) => {
      expect(bucketOf(path)).toBe('ordinary');
    },
  );

  it('allows ten in ten minutes — written out, not read back', () => {
    expect(MAIL_LIMIT.limit).toBe(10);
    expect(MAIL_LIMIT.ttl).toBe(600_000);
  });
});

// 🔴 CAMP-390: `POST /account/letters` appends a row to an append-only journal on
// every accepted request. Under the default bucket one person could append 120
// a minute; the bucket below caps it, and it is its OWN bucket for the CAMP-176
// reason: the number and the counter are two statements about one route.
describe('🔴 the consent bucket (CAMP-390)', () => {
  it.each([
    '/account/letters',
    '/ACCOUNT/LETTERS/',
    '/account/letters?x=1',
    '//account/letters',
  ])('files %s under consent', (path) => {
    expect(bucketOf(path)).toBe('consent');
  });

  it('does not share a counter with sign-in, mail, ordinary reading or the bulk routes', () => {
    const consent = bucketOf('/account/letters');
    for (const other of [
      '/auth/login',
      '/account/password',
      '/auth/signup',
      '/account/email',
      '/account/settings',
      '/spots/countries',
      '/spots/index',
    ])
      expect(bucketOf(other)).not.toBe(consent);
    // The page that LOADS the switch is a plain GET and must stay ordinary: four
    // visits to the settings page must not spend the toggling budget.
    expect(bucketOf('/account/settings')).toBe('ordinary');
  });

  it('allows ten in ten minutes — written out, not read back', () => {
    expect(CONSENT_LIMIT.limit).toBe(10);
    expect(CONSENT_LIMIT.ttl).toBe(600_000);
  });

  it('and that is far below the default, or it is not a limit', () => {
    // Per hour: what one caller can append.
    const perHour = (CONSENT_LIMIT.limit * 3_600_000) / CONSENT_LIMIT.ttl;
    const defaultPerHour =
      (DEFAULT_LIMIT.limit * 3_600_000) / DEFAULT_LIMIT.ttl;
    expect(perHour).toBe(60);
    expect(perHour).toBeLessThan(defaultPerHour / 100);
  });
});

// 🔴 CAMP-391: `POST /plan` runs the planner — a corridor, a read of the
// campsite table and a dynamic programme on the API's one thread. Its own
// bucket, for the CAMP-176 reason: the number and the counter are two
// statements about one route, and a person who presses the button four times
// must not be spending what stops somebody guessing a password, or reading
// ten pages what stops somebody planning.
describe('🔴 the plan bucket (CAMP-391)', () => {
  it.each(['/plan', '/PLAN', '/plan/', '/plan?x=1', '//plan', '/Plan/?a=b'])(
    'files %s under plan',
    (path) => {
      expect(bucketOf(path)).toBe('plan');
    },
  );

  it('does not share a counter with sign-in, mail, consent, ordinary reading or the bulk routes', () => {
    const plan = bucketOf('/plan');
    for (const other of [
      '/auth/login',
      '/auth/signup',
      '/account/letters',
      '/account/settings',
      '/spots/countries',
      '/routes/near',
      '/spots/index',
    ])
      expect(bucketOf(other)).not.toBe(plan);
  });

  it('a path that merely starts like it is ordinary', () => {
    for (const path of [
      '/planner',
      '/plan/x',
      '/plans',
      '/spots/plan',
      '/trips/plan',
    ]) {
      expect(bucketOf(path)).toBe('ordinary');
    }
  });

  it('allows ten a minute — written out, not read back', () => {
    expect(PLAN_LIMIT.limit).toBe(10);
    expect(PLAN_LIMIT.ttl).toBe(60_000);
  });

  it('and that is far below the default, or it is not a limit', () => {
    expect(PLAN_LIMIT.limit).toBeLessThan(DEFAULT_LIMIT.limit / 10);
    // …and room for a person trying seven days, then eight, then another end.
    expect(PLAN_LIMIT.limit).toBeGreaterThanOrEqual(5);
  });

  it('the route list names the one route that runs the planner', () => {
    expect([...PLAN_ROUTES]).toEqual(['plan']);
  });
});
