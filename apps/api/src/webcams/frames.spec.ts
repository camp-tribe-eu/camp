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

/**
 * What a real list answer looks like, and it is NOT "a frame for every
 * id". Cameras go dark, lose their frame and vanish from the catalogue
 * all the time, so the fake has three states and a typical page of three
 * cameras has ALL THREE:
 *
 *   frame      `images.daylight.preview` present          (ref '1')
 *   no frame   listed, but `images` carries no daylight   (ref '2')
 *   gone       not in the answer at all                   (ref '3')
 *
 * The first version of this fake returned a frame for every id, so the
 * two cache holes review found — a camera with no frame never cached,
 * and so every reader's request went to Windy — could not exist in any
 * test. A guard that cannot reproduce a dead camera cannot catch the
 * next bug of that kind.
 */
const NO_FRAME = new Set(['2']);
const GONE = new Set(['3']);

function windyRows(
  ids: string[],
  address: (id: string) => string = addr,
  states: { noFrame: Set<string>; gone: Set<string> } = {
    noFrame: NO_FRAME,
    gone: GONE,
  },
) {
  return (
    ids
      .filter((i) => !states.gone.has(i))
      .map((i) =>
        states.noFrame.has(i)
          ? { webcamId: Number(i), images: {} }
          : row(i, address(i)),
      )
      // Deliberately reversed: Windy does not promise the order.
      .reverse()
  );
}

/** A fake Windy and a clock. `calls` records every URL we asked. */
function rig(over: Partial<FrameDeps> = {}) {
  let t = 1_000_000;
  const calls: string[] = [];
  const states = { noFrame: new Set(NO_FRAME), gone: new Set(GONE) };
  const deps: FrameDeps = {
    now: () => t,
    known: async (refs) => refs,
    callWindy: async (url) => {
      calls.push(url);
      const ids = /webcamIds=([0-9,]+)/.exec(url)![1].split(',');
      return {
        status: 200,
        json: async () => ({
          total: ids.length,
          webcams: windyRows(ids, addr, states),
        }),
      };
    },
    ...over,
  };
  return {
    cache: new FrameCache(deps),
    calls,
    states,
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
            webcams: windyRows(ids, (i) => {
              const a = `${addr(i)}&n=${t}`;
              issued.set(a, t);
              return a;
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
    for (let i = 0; i < 20; i++)
      await expect(cache.frames(['1'])).rejects.toBeInstanceOf(FramesRefused);
    expect(n).toBe(1);
    advance(FAILURE_BACKOFF_MS);
    await expect(cache.frames(['1'])).rejects.toBeInstanceOf(FramesRefused);
    expect(n).toBe(2);
  });
});

describe('🔴 a camera with no frame is an ANSWER, and it is cached like one', () => {
  /** One reader every ten seconds for an hour, on one page. */
  async function hourOn(
    refs: string[],
    over: Partial<FrameDeps> = {},
    tweak?: (r: ReturnType<typeof rig>) => void,
  ) {
    const r = rig(over);
    tweak?.(r);
    let last: Record<string, string> = {};
    for (let i = 0; i < 360; i++) {
      last = await r.cache.frames(refs);
      r.advance(10_000);
    }
    return { calls: r.calls.length, last };
  }

  it('a page with one live camera, one without a frame and one Windy no longer lists costs 6 an hour', async () => {
    // Review measured 360 here: the cameras without an entry were never
    // "fresh", so every reader's request went to Windy.
    const { calls, last } = await hourOn(['1', '2', '3']);
    expect(calls).toBe(6);
    expect(calls).toBeLessThanOrEqual(WINDY_CALLS_PER_PAGE_HOUR);
    expect(last).toEqual({ '1': addr('1') });
  });

  it('a page where EVERY camera is dead costs 6 an hour too, and shows no picture', async () => {
    const { calls, last } = await hourOn(['2', '3']);
    expect(calls).toBe(6);
    expect(last).toEqual({});
  });

  it('a camera that is simply not in the answer is cached as not there', async () => {
    const { cache, calls, advance } = rig();
    await cache.frames(['3']);
    for (let i = 0; i < 50; i++) {
      advance(1_000);
      await cache.frames(['3']);
    }
    expect(calls).toHaveLength(1);
    advance(FRAME_CACHE_MS);
    await cache.frames(['3']);
    expect(calls).toHaveLength(2);
  });

  it('…and the "no frame" does not outlive its ten minutes: a camera that gets one is shown then', async () => {
    const { cache, states, advance } = rig();
    expect(await cache.frames(['2'])).toEqual({});
    states.noFrame.delete('2'); // the camera comes back
    advance(FRAME_CACHE_MS - 1);
    expect(await cache.frames(['2'])).toEqual({});
    advance(1);
    expect(await cache.frames(['2'])).toEqual({ '2': addr('2') });
  });
});

describe('🔴 a failure is a fact about Windy, so the pause is Windy-wide', () => {
  it('rotating a second ref does not get round the pause', async () => {
    // Review: with the pause keyed by the SET of refs, `A,x1`, `A,x2`, …
    // were all different keys and each one called Windy while it was
    // refusing — thirty times a minute at the ceiling.
    let n = 0;
    const { cache, advance } = rig({
      callWindy: async () => {
        n += 1;
        return { status: 503, json: async () => ({}) };
      },
    });
    await expect(cache.frames(['1', '10'])).rejects.toBeInstanceOf(
      FramesRefused,
    );
    for (let i = 11; i < 111; i++) {
      await expect(cache.frames(['1', String(i)])).rejects.toBeInstanceOf(
        FramesRefused,
      );
      advance(100);
    }
    expect(n).toBe(1); // not `n` calls into a closed door in one minute
  });

  it('a 429 from Windy, a 5xx and a timeout each pause every page, once', async () => {
    for (const fail of [
      async () => ({ status: 429, json: async () => ({}) }),
      async () => ({ status: 500, json: async () => ({}) }),
      async () => {
        throw new Error('timeout');
      },
    ]) {
      let n = 0;
      const { cache, advance } = rig({
        callWindy: async () => {
          n += 1;
          return fail();
        },
      });
      await expect(cache.frames(['1'])).rejects.toBeInstanceOf(FramesRefused);
      advance(1_000);
      await expect(cache.frames(['40'])).rejects.toBeInstanceOf(FramesRefused);
      await expect(cache.frames(['41', '42'])).rejects.toBeInstanceOf(
        FramesRefused,
      );
      expect(n).toBe(1);
      advance(FAILURE_BACKOFF_MS);
      await expect(cache.frames(['43'])).rejects.toBeInstanceOf(FramesRefused);
      expect(n).toBe(2);
    }
  });

  it('what is already cached is still served during the pause', async () => {
    let fail = false;
    const { cache, advance } = rig({
      callWindy: async (url) => {
        if (fail) return { status: 503, json: async () => ({}) };
        const ids = /webcamIds=([0-9,]+)/.exec(url)![1].split(',');
        return { status: 200, json: async () => ({ webcams: windyRows(ids) }) };
      },
    });
    await cache.frames(['1']);
    fail = true;
    advance(FRAME_CACHE_MS);
    await expect(cache.frames(['1'])).rejects.toBeInstanceOf(FramesRefused);
    advance(1_000);
    // A fresh entry for another camera, fetched before the failure, is
    // not lost to the pause: only a MISS needs Windy.
    fail = false;
    advance(FAILURE_BACKOFF_MS);
    await expect(cache.frames(['1'])).resolves.toEqual({ '1': addr('1') });
  });
});

/** A healthy Windy for this URL. */
const okRows = (url: string) => {
  const ids = /webcamIds=([0-9,]+)/.exec(url)![1].split(',');
  return { status: 200, json: async () => ({ webcams: windyRows(ids) }) };
};

describe('🔴 a 200 is not always an answer', () => {
  it('a 200 whose BODY stalls or breaks pauses Windy like any failure: 20 readers, 1 call', async () => {
    // Review: `fetch()` resolves on the headers, `json()` then rejects
    // (our own timeout covers the body). Outside the `try` that was a
    // generic 503 with no pause: 20 readers in 20 seconds made 20 calls.
    for (const broken of [
      () =>
        Promise.reject(
          new DOMException('The operation timed out.', 'TimeoutError'),
        ),
      () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    ]) {
      let n = 0;
      const { cache, advance } = rig({
        callWindy: async () => {
          n += 1;
          return { status: 200, json: broken };
        },
      });
      for (let i = 0; i < 20; i++) {
        await expect(cache.frames([String(i * 4 + 1)])).rejects.toBeInstanceOf(
          FramesRefused,
        );
        advance(1_000);
      }
      expect(n).toBe(1);
    }
  });

  it('a 200 that is NOT A LIST pauses and caches NOTHING, so the next minute can recover', async () => {
    // Review: `{}`, `{"webcams":null}`, `{"status":"error"}`, `null`
    // became "no frames" for every camera on the page for ten minutes —
    // 59 of 59 later readers got empty cards while Windy was fine.
    for (const bad of [
      {},
      { webcams: null },
      { status: 'error' },
      null,
      [],
      { webcams: {} },
      { webcams: 'x' },
    ]) {
      let n = 0;
      let healthy = false;
      const { cache, advance } = rig({
        callWindy: async (url) => {
          n += 1;
          return healthy ? okRows(url) : { status: 200, json: async () => bad };
        },
      });
      await expect(cache.frames(['1'])).rejects.toBeInstanceOf(FramesRefused);
      for (let i = 0; i < 59; i++) {
        advance(1_000);
        await expect(cache.frames(['1'])).rejects.toBeInstanceOf(FramesRefused);
      }
      expect(n).toBe(1); // for every shape of non-list, `bad` included
      // Windy recovers. The very next minute shows the frame; nothing
      // wrong was remembered for ten.
      healthy = true;
      advance(FAILURE_BACKOFF_MS);
      await expect(cache.frames(['1'])).resolves.toEqual({ '1': addr('1') });
    }
  });

  it('…but a LIST that is empty is a true answer — "not listed" — and IS cached', async () => {
    // What Windy really sends for a camera that has been taken down:
    // 200 {"total":0,"webcams":[]}. Two of three Bovec cameras are there.
    let n = 0;
    const { cache, advance } = rig({
      callWindy: async () => {
        n += 1;
        return { status: 200, json: async () => ({ total: 0, webcams: [] }) };
      },
    });
    for (let i = 0; i < 60; i++) {
      await expect(cache.frames(['1', '2', '3'])).resolves.toEqual({});
      advance(1_000);
    }
    expect(n).toBe(1);
    advance(FRAME_CACHE_MS);
    await cache.frames(['1', '2', '3']);
    expect(n).toBe(2);
  });
});

describe('🔴 a refusal takes away nothing that is already fresh', () => {
  /** 1 and 4 are cached and fresh; 6 never was. Windy can be made to fail. */
  async function pageWithTwoFresh() {
    const state = { failing: false };
    const r = rig({
      callWindy: async (url) =>
        state.failing ? { status: 500, json: async () => ({}) } : okRows(url),
    });
    await r.cache.frames(['1', '4']);
    r.advance(5 * MIN);
    return { ...r, state };
  }

  it('during the pause the fresh cameras are still shown', async () => {
    const { cache, advance, state } = await pageWithTwoFresh();
    state.failing = true;
    // Windy fails for some other page: the pause is set.
    await expect(cache.frames(['9'])).rejects.toBeInstanceOf(FramesRefused);
    advance(1_000);
    expect(await cache.frames(['1', '4', '6'])).toEqual({
      '1': addr('1'),
      '4': addr('4'),
    });
  });

  it('at the ceiling the fresh cameras are still shown', async () => {
    const { cache, advance } = await pageWithTwoFresh();
    for (let i = 100; i < 100 + MAX_WINDY_CALLS_PER_MINUTE; i++)
      await cache.frames([String(i)]);
    advance(1_000);
    expect(await cache.frames(['1', '4', '6'])).toEqual({
      '1': addr('1'),
      '4': addr('4'),
    });
  });

  it('and when NOTHING is fresh the refusal still reaches the reader', async () => {
    const { cache } = rig({
      callWindy: async () => ({ status: 500, json: async () => ({}) }),
    });
    await expect(cache.frames(['1', '4', '6'])).rejects.toBeInstanceOf(
      FramesRefused,
    );
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

  it('🔴 padding a real ref with ids we do not hold costs Windy nothing, ever', async () => {
    // Review: `refs=<ours>,<invented>` made the set uncacheable (the
    // invented id was never "fresh"), so every request called Windy and
    // 120 of them a minute spent the whole ceiling in fifteen seconds.
    const { cache, calls } = rig({
      known: async (refs) => refs.filter((r) => r === '1'),
    });
    for (let i = 0; i < 200; i++)
      await cache.frames(['1', String(9_000_000 + i)]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('webcamIds=1&');
    // …and the ceiling is untouched: a different real camera still gets through.
    await expect(cache.frames(['1'])).resolves.toEqual({ '1': addr('1') });
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
