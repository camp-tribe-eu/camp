import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { corsOptions } from './cors';

// CAMP-229 — which request headers the browser may send to this API.
//
// 🔴 THE PREFLIGHT IS REAL. A browser asks `OPTIONS` before a cross-origin GET
// that carries `Authorization`, and refuses the GET itself unless the answer
// names the header. So this spec does not compare an options object with
// another options object: it starts a server, applies `corsOptions` through
// the same `enableCors` `main.ts` calls, and sends the preflight a browser
// sends. Nothing is mocked; the answer is the one the page would read.

const SITE = 'https://site.example';
const STRANGER = 'https://stranger.example';

@Controller('probe')
class Probe {
  @Get()
  read() {
    return { ok: true };
  }
}

let app: INestApplication;
let base: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [Probe],
  }).compile();
  app = moduleRef.createNestApplication();
  app.enableCors(corsOptions([SITE]));
  await app.listen(0);
  base = await app.getUrl();
});
afterAll(() => app?.close());

/** What a browser sends before a GET with an Authorization header. */
const preflight = (origin: string, headers = 'authorization') =>
  fetch(`${base}/probe`, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'GET',
      'access-control-request-headers': headers,
      connection: 'close',
    },
  });

const allowedHeaders = (res: Response) =>
  (res.headers.get('access-control-allow-headers') ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

describe('🔴 the preflight for the account page', () => {
  it('names authorization for the site, so the browser sends the real request', async () => {
    const res = await preflight(SITE);
    expect(res.status).toBe(204);
    expect(allowedHeaders(res)).toContain('authorization');
    expect(allowedHeaders(res)).toContain('content-type');
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE);
  });

  it('does not lift the other half: no credentials, and a stranger gets no allowance', async () => {
    const ok = await preflight(SITE);
    // The header is absent, not "false": `credentials: false` sends nothing.
    expect(ok.headers.get('access-control-allow-credentials')).toBeNull();

    const stranger = await preflight(STRANGER);
    expect(stranger.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('allows exactly those two headers, not whatever is asked for', async () => {
    const res = await preflight(SITE, 'authorization, x-anything-else');
    expect(allowedHeaders(res).sort()).toEqual([
      'authorization',
      'content-type',
    ]);
  });

  it('lets the real GET through for the site and tags the answer for the site only', async () => {
    const res = await fetch(`${base}/probe`, {
      headers: { origin: SITE, authorization: 'Bearer x', connection: 'close' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE);
    const stranger = await fetch(`${base}/probe`, {
      headers: { origin: STRANGER, connection: 'close' },
    });
    expect(stranger.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('the options themselves', () => {
  it('keep the origin an allowlist, never a wildcard or a reflection', () => {
    expect(corsOptions([SITE]).origin).toEqual([SITE]);
    expect(corsOptions([]).origin).toEqual([]);
  });

  it('keep credentials off and the methods to the two we use', () => {
    const o = corsOptions([SITE]);
    expect(o.credentials).toBe(false);
    expect(o.methods).toEqual(['GET', 'POST']);
  });
});

// 🔴 The options above are worth testing only if they are the ones the server
// boots with. `main.ts` cannot be imported by a test, so this reads it — the
// way `throttle.spec.ts` reads the controller — and asks for the one call.
describe('main.ts uses them', () => {
  const main = readFileSync(join(__dirname, 'main.ts'), 'utf8')
    // Code only: a comment that names the function is not a call to it.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('passes corsOptions(origins) to enableCors and spells out no options of its own', () => {
    expect(main).toMatch(
      /app\.enableCors\(\s*corsOptions\(\s*origins\s*\)\s*\)/,
    );
    expect(main).not.toMatch(/allowedHeaders|credentials\s*:|methods\s*:/);
  });
});
