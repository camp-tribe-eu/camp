import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FAILURE_BACKOFF_MS,
  FRAME_CACHE_MS,
  FRAME_HOST,
  FrameCache,
  FramesRefused,
  MAX_WINDY_CALLS_PER_MINUTE,
  WINDY_CALLS_PER_PAGE_HOUR,
  WINDY_URL_VALID_MS,
  frameAddress,
  framesFrom,
  parseRefs,
  windyUrl,
  type FrameDeps,
} from './frames';

// CAMP-190 — the rules that keep us inside Windy's written terms:
// addresses only as the API gave them, never older than they are valid,
// and never more requests than the tier and their «excessive automated
// requests» clause allow.
//
// Every assertion about time runs against a CLOCK THE TEST MOVES. An
// earlier idea was to compare two constants; a comparison of constants
// passes when the cache logic ignores both.

const MIN = 60_000;
const addr = (id: string) =>
  `https://imgproxy.windy.com/_/preview/plain/daylight/${id}/original.jpg?v=2`;
const row = (id: string, preview: unknown = addr(id)) => ({
  webcamId: Number(id),
  images: { daylight: { preview } },
});

/** A fake Windy and a clock. `calls` records every URL we asked. */
function rig(over: Partial<FrameDeps> = {}) {
  let t = 1_000_000;
  const calls: string[] = [];
  const deps: FrameDeps = {
    now: () => t,
    known: async (refs) => refs,
    callWindy: async (url) => {
      calls.push(url);
      const ids = /webcamIds=([0-9,]+)/.exec(url)![1].split(',');
      // Deliberately reversed: Windy does not promise the order.
      return {
        status: 200,
        json: async () => ({
          total: ids.length,
          webcams: ids.map((i) => row(i)).reverse(),
        }),
      };
    },
    ...over,
  };
  return {
    cache: new FrameCache(deps),
    calls,
    advance: (ms: number) => (t += ms),
  };
}

describe('the address lives for less than Windy says it is valid', () => {
  it('the numbers are the ones in their letter: 15 minutes valid, 10 kept', () => {
    // Written out, so that editing a constant to agree with a wrong
    // constant is not enough.
    expect(WINDY_URL_VALID_MS).toBe(15 * MIN);
    expect(FRAME_CACHE_MS).toBe(10 * MIN);
    expect(FRAME_CACHE_MS).toBeLessThan(WINDY_URL_VALID_MS);
  });

  it('🔴 an address is served from the cache just under ten minutes and refetched at ten', async () => {
    const { cache, calls, advance } = rig();
    await cache.frames(['1']);
    advance(FRAME_CACHE_MS - 1);
    await cache.frames(['1']);
    expect(calls).toHaveLength(1);
    advance(1);
    await cache.frames(['1']);
    expect(calls).toHaveLength(2);
  });

  it('🔴 no address older than Windy allows is ever handed out, at any moment of an hour', async () => {
    // The strongest form of the sentinel: walk a whole hour in 15-second
    // steps and prove that every address returned was issued by Windy
    // less than 15 minutes earlier. A cache that lives 15 minutes — or
    // that never expires — fails this at the first step past the line.
    let t = 0;
    const issued = new Map<string, number>();
    const { cache } = rig({
      now: () => t,
      callWindy: async (url) => {
        const ids = /webcamIds=([0-9,]+)/.exec(url)![1].split(',');
        // Each answer carries a NEW address, so "issued when" is known.
        return {
          status: 200,
          json: async () => ({
            webcams: ids.map((i) => {
              const a = `${addr(i)}&n=${t}`;
              issued.set(a, t);
              return row(i, a);
            }),
          }),
        };
      },
    });
    let oldest = 0;
    for (; t <= 60 * MIN; t += 15_000) {
      const got = await cache.frames(['1', '2', '3']);
      for (const a of Object.values(got))
        oldest = Math.max(oldest, t - (issued.get(a) as number));
    }
    expect(oldest).toBeLessThan(WINDY_URL_VALID_MS);
    expect(oldest).toBeLessThanOrEqual(FRAME_CACHE_MS);
  });
});

describe('how much we ask of Windy', () => {
  it('🔴 one page costs at most 6 calls an hour, however many readers it has', async () => {
    const { cache, calls, advance } = rig();
    // A reader every ten seconds for an hour: 360 readers of one page.
    for (let i = 0; i < 360; i++) {
      await cache.frames(['1', '2', '3']);
      advance(10_000);
    }
    expect(WINDY_CALLS_PER_PAGE_HOUR).toBe(6);
    expect(calls.length).toBe(6);
    expect(calls.length).toBeLessThanOrEqual(WINDY_CALLS_PER_PAGE_HOUR);
    // …and each call is ONE request for all three cameras, not three.
    expect(calls.every((u) => /webcamIds=1,2,3&/.test(u))).toBe(true);
  });

  it('🔴 a page whose cameras are shared with another page still costs at most 6 an hour', async () => {
    // Page D holds camera 3 and was read six minutes before page A, which
    // also shows camera 3. That phase difference is what staggers expiry:
    // if A only refreshed what it was MISSING, camera 3 would expire
    // mid-window and A would call a second time in the same ten minutes.
    // A is read BEFORE D in every tick, so A is the one that meets the
    // expired camera. The rule under test: each call of A refreshes all
    // of A, so A's own calls stay at one per ten minutes.
    const { cache, calls, advance } = rig();
    await cache.frames(['3']); // D, six minutes earlier
    advance(6 * MIN);
    let aCalls = 0;
    for (let i = 0; i < 720; i++) {
      const before = calls.length;
      await cache.frames(['1', '2', '3']); // A
      if (calls.length > before) aCalls += 1;
      await cache.frames(['3']); // D
      advance(5_000);
    }
    expect(aCalls).toBeGreaterThan(0);
    expect(aCalls).toBeLessThanOrEqual(WINDY_CALLS_PER_PAGE_HOUR);
  });

  it('concurrent readers of one page share one call', async () => {
    const { cache, calls } = rig();
    await Promise.all(
      Array.from({ length: 50 }, () => cache.frames(['1', '2'])),
    );
    expect(calls).toHaveLength(1);
  });

  it('🔴 a hard ceiling per minute, whatever the traffic, then 429', async () => {
    const { cache, calls } = rig();
    for (let i = 1; i <= MAX_WINDY_CALLS_PER_MINUTE; i++)
      await cache.frames([String(i)]);
    expect(calls).toHaveLength(MAX_WINDY_CALLS_PER_MINUTE);
    await expect(cache.frames(['999'])).rejects.toMatchObject({ status: 429 });
    expect(calls).toHaveLength(MAX_WINDY_CALLS_PER_MINUTE);
  });

  it('…and the ceiling is a tenth of what the Free tier allows, written out', () => {
    // x-ratelimit-limit: 300 per 60 s, measured 02.11.2026.
    expect(MAX_WINDY_CALLS_PER_MINUTE).toBe(30);
  });

  it('the ceiling lifts when the minute is over', async () => {
    const { cache, advance } = rig();
    for (let i = 1; i <= MAX_WINDY_CALLS_PER_MINUTE; i++)
      await cache.frames([String(i)]);
    advance(60_001);
    await expect(cache.frames(['999'])).resolves.toHaveProperty('999');
  });

  it('🔴 a refusal from Windy is remembered, not retried by every reader', async () => {
    let n = 0;
    const { cache, advance } = rig({
      callWindy: async () => {
        n += 1;
        return { status: 429, json: async () => ({}) };
      },
    });
    await expect(cache.frames(['1'])).rejects.toBeInstanceOf(FramesRefused);
    for (let i = 0; i < 20; i++) await cache.frames(['1']);
    expect(n).toBe(1);
    advance(FAILURE_BACKOFF_MS);
    await expect(cache.frames(['1'])).rejects.toBeInstanceOf(FramesRefused);
    expect(n).toBe(2);
  });
});

describe('only cameras we hold, only addresses Windy gave', () => {
  it('🔴 a ref that is not in our table is never sent to Windy', async () => {
    const { cache, calls } = rig({
      known: async (refs) => refs.filter((r) => r !== '666'),
    });
    const got = await cache.frames(['1', '666']);
    expect(Object.keys(got)).toEqual(['1']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain('666');
    expect(await rig({ known: async () => [] }).cache.frames(['666'])).toEqual(
      {},
    );
  });

  it('keys the answer by the camera id, not by position', () => {
    const body = { webcams: [row('2'), row('1')] };
    expect(framesFrom(body, ['1', '2'])).toEqual({
      '1': addr('1'),
      '2': addr('2'),
    });
    // A camera we did not ask about is ignored even if Windy returns it.
    expect(framesFrom({ webcams: [row('9')] }, ['1'])).toEqual({});
  });

  it('returns the address exactly as Windy gave it, whatever its shape', () => {
    const odd =
      'https://imgproxy.windy.com/_/preview/plain/daylight/OPAQUE-7f3a/original.jpg?v=3&x=1';
    expect(framesFrom({ webcams: [row('1', odd)] }, ['1'])).toEqual({
      '1': odd,
    });
  });

  it('refuses an address that is not https, not our frame host, or carries credentials', () => {
    expect(FRAME_HOST).toBe('imgproxy.windy.com');
    for (const bad of [
      'http://imgproxy.windy.com/x.jpg',
      'https://evil.example/x.jpg',
      'https://imgproxy.windy.com.evil.example/x.jpg',
      'https://u:p@imgproxy.windy.com/x.jpg',
      'javascript:alert(1)',
      '',
      42,
      null,
    ]) {
      expect(frameAddress(row('1', bad))).toBeNull();
    }
    expect(frameAddress({})).toBeNull();
    expect(frameAddress(null)).toBeNull();
  });

  it('refuses malformed ref lists, because they go into a URL that carries our key', () => {
    expect(parseRefs('1690466401,1689851105,1611140235')).toEqual([
      '1690466401',
      '1689851105',
      '1611140235',
    ]);
    for (const bad of [
      undefined,
      '',
      '1,2,3,4',
      '1,1',
      '1;2',
      '../1',
      '1&include=x',
      'a',
      '1,',
      ' 1',
      '9'.repeat(21),
    ]) {
      expect(parseRefs(bad)).toBeNull();
    }
    expect(() => windyUrl(['1/../2'])).toThrow();
    expect(() => windyUrl([])).toThrow();
  });

  it('asks for the images of those cameras in one call, and the key is not in the URL', () => {
    const u = windyUrl(['1', '2', '3']);
    expect(u).toBe(
      'https://api.windy.com/webcams/api/v3/webcams?webcamIds=1,2,3&limit=3&include=images',
    );
    expect(u).not.toMatch(/key/i);
  });
});

describe('the key', () => {
  it('🔴 is read in one place and goes into a header, never a URL, log or message', () => {
    const src = readFileSync(join(__dirname, 'frames.service.ts'), 'utf8');
    expect(src.match(/WINDY_WEBCAMS_API_KEY/g)).toHaveLength(1);
    expect(src).toContain("'x-windy-api-key': key");
    // No log or exception interpolates it.
    expect(src).not.toMatch(/(?:log|warn|error)\([^)]*\bkey\b/);
    expect(src).not.toMatch(/Exception\([^)]*\bkey\b/);
  });

  it('a failed call says nothing about why beyond the status', async () => {
    const { cache } = rig({
      callWindy: async () => {
        throw new Error('connect ECONNREFUSED SECRET-IN-ERROR');
      },
    });
    await expect(cache.frames(['1'])).rejects.toThrow(/did not answer/);
    await expect(
      rig({
        callWindy: async () => {
          throw new Error('SECRET-IN-ERROR');
        },
      }).cache.frames(['1']),
    ).rejects.not.toThrow(/SECRET/);
  });
});

describe('the route stays out of every cache but ours', () => {
  it('🔴 answers no-store, so no browser or edge adds to the age of an address', () => {
    const src = readFileSync(join(__dirname, 'frames.controller.ts'), 'utf8');
    expect(src).toContain("@Header('Cache-Control', 'no-store')");
  });
});
