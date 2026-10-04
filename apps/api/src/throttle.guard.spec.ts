import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MapQueryService } from './spots/map.service';
import { SpotsController } from './spots/spots.controller';
import { SpotsService } from './spots/spots.service';
import { DEFAULT_LIMIT } from './throttle';
import { ApiThrottlerGuard } from './throttle.guard';

// CAMP-159 — the rate limit, through a real Nest application.
//
// 🔴 Why this file exists next to throttle.spec.ts. That one drives the
// decisions (`isExempt`, `isBulkPath`, `clientKey`) as pure functions and
// says so in its first line: "without booting Nest". Every one of them can
// be green while the GUARD that calls them is not — the three protected
// overrides on ApiThrottlerGuard (getTracker, generateKey, shouldSkip) are
// only overrides for as long as the framework still calls them by those
// names, with the request shaped the way they read it.
//
// A platform upgrade changes exactly that: Nest 10 → 12 swapped the Express
// adapter from 4 to 5, and @nestjs/throttler declares support for 12 only
// from 6.6.0. Nothing in the pure suite would have noticed the guard
// silently ceasing to skip the build, and the day it did the site build
// would have walked into the limit — the 1 558 timeouts and seven hours
// that check-build-bypass.mjs exists to prevent. That script proves it
// against a running API at build time; this proves it on every commit,
// in seconds, with no database.
//
// Real HTTP over a real socket, the real SpotsController with its real
// @Throttle decorators, the real guard. Only the services behind the
// controller are stubs, because they are the part that needs Postgres.
//
// 🔴 The oracle is NOT read from the code under test. The numbers below are
// the documented ones and the header is the literal the site's build
// sends. The first version of this file imported BUILD_TOKEN_HEADER and the
// limits from throttle.ts to build its requests and expectations: renaming
// the header to anything at all left it green (measured — mutant
// "x-build-tokens" survived), and so did raising the default limit tenfold.
// A test that takes its answer from the thing it checks agrees with it by
// construction.

/** BULK_LIMIT in throttle.ts, and the constant check-build-bypass.mjs names. */
const BULK_PER_MINUTE = 6;
/** DEFAULT_LIMIT in throttle.ts: "120 a minute". */
const ORDINARY_PER_MINUTE = 120;
/** What apps/web/src/lib/api.ts writes on the wire — pinned to it below. */
const HEADER = 'x-build-token';
const TOKEN = 'dummy-build-token-for-this-suite-only';
const BULK = '/spots/map/points?bbox=0,0,0.01,0.01';

const stubSpots = {
  allPublishable: async () => [],
  searchDocuments: async () => [],
  countries: async () => [],
};
const stubMap = { points: async () => ({ points: [], truncated: false }) };

let app: INestApplication;
let base: string;

const saved = {
  token: process.env.API_BUILD_TOKEN,
  trust: process.env.TRUST_PROXY_CLIENT_IP,
};

/** A fresh application, so each test starts with empty counters. */
async function boot(env: { token?: string; trustProxy?: boolean } = {}) {
  if (env.token === undefined) delete process.env.API_BUILD_TOKEN;
  else process.env.API_BUILD_TOKEN = env.token;
  if (env.trustProxy) process.env.TRUST_PROXY_CLIENT_IP = '1';
  else delete process.env.TRUST_PROXY_CLIENT_IP;

  // The same wiring app.module.ts declares — pinned to it by the last
  // block in this file rather than trusted to stay in step.
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([DEFAULT_LIMIT])],
    controllers: [SpotsController, AppController],
    providers: [
      AppService,
      { provide: SpotsService, useValue: stubSpots },
      { provide: MapQueryService, useValue: stubMap },
      { provide: APP_GUARD, useClass: ApiThrottlerGuard },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.listen(0);
  base = await app.getUrl();
}

async function status(
  path: string,
  headers: Record<string, string> = {},
): Promise<number> {
  const res = await fetch(base + path, { headers });
  // Drain, so a kept-alive socket does not hold the response open.
  await res.arrayBuffer();
  return res.status;
}

async function statuses(
  n: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<number[]> {
  const out: number[] = [];
  // In sequence: the counter is per caller, and the order is the point.
  for (let i = 0; i < n; i++) out.push(await status(path, headers));
  return out;
}

const ok = (n: number) => Array<number>(n).fill(200);

afterEach(async () => {
  await app?.close();
  if (saved.token === undefined) delete process.env.API_BUILD_TOKEN;
  else process.env.API_BUILD_TOKEN = saved.token;
  if (saved.trust === undefined) delete process.env.TRUST_PROXY_CLIENT_IP;
  else process.env.TRUST_PROXY_CLIENT_IP = saved.trust;
});

describe('🔴 the limits bite, through the framework', () => {
  it('lets six bulk requests through and answers the seventh with 429', async () => {
    await boot();
    const got = await statuses(BULK_PER_MINUTE + 2, BULK);
    expect(got).toEqual([...ok(BULK_PER_MINUTE), 429, 429]);
  });

  it('holds the ordinary routes to 120 — a different number, in its own bucket', async () => {
    await boot();
    const got = await statuses(ORDINARY_PER_MINUTE + 1, '/spots/countries');
    expect(got.slice(0, ORDINARY_PER_MINUTE)).toEqual(ok(ORDINARY_PER_MINUTE));
    expect(got[ORDINARY_PER_MINUTE]).toBe(429);
  });
});

describe('🔴 the build token lifts the limit — the bypass that cost seven hours', () => {
  it('a matching token is never throttled, far past the limit', async () => {
    await boot({ token: TOKEN });
    const got = await statuses(BULK_PER_MINUTE * 4, BULK, { [HEADER]: TOKEN });
    expect(got).toEqual(ok(BULK_PER_MINUTE * 4));
  });

  it('and it still beats a bucket that is already exhausted', async () => {
    await boot({ token: TOKEN });
    // Fill the caller's bucket without the token, and see it full.
    await statuses(BULK_PER_MINUTE, BULK);
    expect(await status(BULK)).toBe(429);
    // The build arrives from the same address, mid-minute.
    expect(await status(BULK, { [HEADER]: TOKEN })).toBe(200);
  });

  it('a wrong token gets no exemption', async () => {
    await boot({ token: TOKEN });
    const got = await statuses(BULK_PER_MINUTE + 1, BULK, {
      [HEADER]: 'not-the-token',
    });
    expect(got).toEqual([...ok(BULK_PER_MINUTE), 429]);
  });

  it('an empty token gets none either', async () => {
    await boot({ token: TOKEN });
    const got = await statuses(BULK_PER_MINUTE + 1, BULK, { [HEADER]: '' });
    expect(got).toEqual([...ok(BULK_PER_MINUTE), 429]);
  });

  it('🔴 fails CLOSED: an API with no token configured exempts nobody', async () => {
    // The afternoon of 27.09.2026, reproduced: the build sends a token,
    // the process answering has never heard of one.
    await boot();
    const got = await statuses(BULK_PER_MINUTE + 1, BULK, { [HEADER]: TOKEN });
    expect(got).toEqual([...ok(BULK_PER_MINUTE), 429]);
  });

  it('the header this suite sends is the one the site build writes', () => {
    // Both ends of the wire, so a rename on either side is red here.
    const client = readFileSync(
      join(__dirname, '../../web/src/lib/api.ts'),
      'utf8',
    );
    expect(client).toContain(`'${HEADER}': token`);
    const probe = readFileSync(
      join(__dirname, '../../web/scripts/check-build-bypass.mjs'),
      'utf8',
    );
    expect(probe).toContain(`'${HEADER}': TOKEN`);
  });
});

// 🔴 What this block does NOT say. It covers the routes BULK_ROUTES
// lists and nothing else. That used not to be the same set as "every
// route with the bulk limit", which is the next paragraph.
//
// 🔴 WAS A LIVE DEFECT WHEN THIS FILE WAS WRITTEN, FIXED IN CAMP-176.
//
// `/spots/map/regions` carried `@Throttle(BULK)` (limit 6) and was absent
// from BULK_ROUTES, so `generateKey` filed it under `ordinary`: the bulk
// NUMBER in the ordinary BUCKET. Measured through this suite's own
// application — six calls to `/spots/countries` all answered 200, and the
// next call to `/spots/map/regions` answered 429.
//
// This file deliberately asserted neither behaviour at the time, which was
// right: a test written to today's behaviour fixes a bug in place. The
// route is now in BULK_ROUTES and `throttle.spec.ts` reads the controllers
// and fails if a decorator and the list ever disagree again, in either
// direction.
describe('🔴 two buckets per caller, not one per route — for the routes BULK_ROUTES lists', () => {
  it('every route BULK_ROUTES lists shares one bulk bucket', async () => {
    await boot();
    // Two on each route is six in all — the limit — if they share.
    // If the library's per-handler key were back, each route would have
    // its own six and all of these would pass.
    const got = [
      ...(await statuses(2, '/spots/map/points?bbox=0,0,0.01,0.01')),
      ...(await statuses(2, '/spots/search-index')),
      ...(await statuses(2, '/spots/index')),
    ];
    expect(got).toEqual(ok(6));
    expect(await status('/spots/index')).toBe(429);
    expect(await status('/spots/search-index')).toBe(429);
  });

  it('and spelling the route in capitals does not open another bucket', async () => {
    await boot();
    await statuses(BULK_PER_MINUTE, '/spots/index');
    // Express answers this route case-insensitively; the bucket must too.
    expect(await status('/SPOTS/SEARCH-INDEX')).toBe(429);
  });

  it('a spent bulk bucket leaves the ordinary routes untouched', async () => {
    await boot();
    await statuses(BULK_PER_MINUTE + 1, '/spots/index');
    expect(await status('/spots/countries')).toBe(200);
  });
});

describe('what is exempt without any token', () => {
  it('the root route, so a monitor can poll it for ever', async () => {
    await boot();
    const got = await statuses(ORDINARY_PER_MINUTE + 20, '/');
    expect(got).toEqual(ok(ORDINARY_PER_MINUTE + 20));
  });
});

describe('who a request is counted against', () => {
  it('🔴 one IPv6 /64 is one caller, however many addresses it writes', async () => {
    await boot({ trustProxy: true });
    // Six different addresses inside 2001:db8:0:1::/64. Counted by
    // address they would be six callers with a fresh bucket each.
    const inside = [1, 2, 3, 4, 5, 6].map((n) => `2001:db8:0:1::${n}`);
    const got: number[] = [];
    for (const ip of inside) {
      got.push(await status(BULK, { 'cf-connecting-ip': ip }));
    }
    expect(got).toEqual(ok(6));
    // A seventh address, same /64, arrives with a bucket already spent.
    expect(
      await status(BULK, { 'cf-connecting-ip': '2001:db8:0:1:ffff::9' }),
    ).toBe(429);
    // A different /64 is a different caller.
    expect(await status(BULK, { 'cf-connecting-ip': '2001:db8:0:2::1' })).toBe(
      200,
    );
  });

  it('🔴 without TRUST_PROXY_CLIENT_IP the header buys nothing', async () => {
    await boot();
    // The forged-header attack an adversarial review measured at 62 MB in
    // a few seconds: a new address on every request, none of them ours to
    // believe.
    const got: number[] = [];
    for (let i = 1; i <= BULK_PER_MINUTE + 1; i++) {
      got.push(await status(BULK, { 'cf-connecting-ip': `203.0.113.${i}` }));
    }
    expect(got).toEqual([...ok(BULK_PER_MINUTE), 429]);
  });
});

describe('the wiring this suite stands in for', () => {
  const source = (file: string) => readFileSync(join(__dirname, file), 'utf8');

  it('app.module.ts registers this guard, globally, with this default', () => {
    const appModule = source('app.module.ts');
    expect(appModule).toMatch(/ThrottlerModule\.forRoot\(\[DEFAULT_LIMIT\]\)/);
    expect(appModule).toMatch(
      /provide:\s*APP_GUARD,\s*useClass:\s*ApiThrottlerGuard/,
    );
  });

  it('and nothing else in the module configures the throttler', () => {
    // A second forRoot, or an APP_GUARD of another class, would make this
    // suite describe an application that is not the one that ships.
    const appModule = source('app.module.ts');
    expect(appModule.match(/ThrottlerModule\./g)).toHaveLength(1);
    expect(appModule.match(/APP_GUARD/g)?.length).toBe(2); // import + provide
  });
});
