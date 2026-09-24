import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BULK_LIMIT,
  BULK_ROUTES,
  clientKey,
  DEFAULT_LIMIT,
  isBulkPath,
  isExempt,
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
describe('🔴 every bulk route actually carries the bulk limit', () => {
  const controller = readFileSync(
    join(__dirname, 'spots', 'spots.controller.ts'),
    'utf8',
  );

  it.each([...BULK_ROUTES])('%s is decorated', (route) => {
    const handler = route.replace(/^spots\//, '');
    const pattern = new RegExp(
      `@Throttle\\(BULK\\)\\s*\\n\\s*@Get\\('${handler.replace('/', '\\/')}'\\)`,
    );
    // The message is built into the compared value, because jest's
    // expect takes no message argument — and "expected false to be true"
    // would tell whoever hits this nothing about what to do.
    const found = pattern.test(controller)
      ? 'decorated'
      : `@Get('${handler}') has no @Throttle(BULK) above it`;
    expect(found).toBe('decorated');
  });

  it('and the list is not empty, or this suite proves nothing', () => {
    expect(BULK_ROUTES.length).toBeGreaterThan(0);
  });
});
