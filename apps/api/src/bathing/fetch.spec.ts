import {
  ATTEMPTS,
  RETRY_PAUSE_MS,
  countUrl,
  fetchAllFeatures,
  fetchUpstream,
  PAGE_SIZE,
  pageUrl,
} from './fetch';
import { UpstreamUnavailable } from './upstream';

// CAMP-168: ArcGIS answers a failed page with HTTP 200 and an `error`
// object, so "the loop ended" is never evidence that the data ended.
// These tests are about the ways this fetch is allowed to fail.

const LAYER = 'https://example.test/MapServer/3';

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const noSleep = async () => undefined;

/** A fetch that serves `total` fake features in pages of PAGE_SIZE. */
function server(total: number, opts: { reportCount?: number } = {}) {
  return (async (url: string) => {
    if (String(url).includes('returnCountOnly=true')) {
      return ok({ count: opts.reportCount ?? total });
    }
    const offset = Number(
      new URL(String(url)).searchParams.get('resultOffset'),
    );
    const n = Math.max(0, Math.min(PAGE_SIZE, total - offset));
    return ok({
      features: Array.from({ length: n }, (_, i) => ({
        attributes: { bathingWaterIdentifier: `X${offset + i}` },
      })),
      exceededTransferLimit: offset + n < total,
    });
  }) as unknown as typeof fetch;
}

describe('pageUrl', () => {
  it('asks for a stable order, or paging by offset means nothing', () => {
    expect(pageUrl(0, LAYER)).toContain('orderByFields=OBJECTID');
  });

  it("asks for the server's own page size", () => {
    expect(pageUrl(0, LAYER)).toContain(`resultRecordCount=${PAGE_SIZE}`);
    expect(PAGE_SIZE).toBe(2000);
  });

  it('carries the offset', () => {
    expect(pageUrl(4000, LAYER)).toContain('resultOffset=4000');
  });

  // 🔴 The repository is public and has leaked once. This source needs
  // no key, and nothing in these URLs may ever carry one.
  it.each([pageUrl(0, LAYER), countUrl(LAYER)])(
    'carries no key or token (%#)',
    (url) => {
      expect(url).not.toMatch(/token|api[-_]?key|apikey|secret/i);
    },
  );
});

describe('fetchAllFeatures', () => {
  it('pages until the server stops saying there is more', async () => {
    const all = await fetchAllFeatures(server(4500), LAYER);
    expect(all).toHaveLength(4500);
    expect(all[0].bathingWaterIdentifier).toBe('X0');
    expect(all[4499].bathingWaterIdentifier).toBe('X4499');
  });

  // 🔴 THE ONE THAT MATTERS. A silently short read produces a table that
  // is 40% of the truth, and every page built from it says "no
  // designated bathing water nearby" about places that have one —
  // indistinguishable, on the page, from an honest answer.
  it('refuses a short read', async () => {
    await expect(
      fetchAllFeatures(server(1000, { reportCount: 22010 }), LAYER),
    ).rejects.toThrow(/refusing a short read/);
  });

  // CAMP-440: a 5xx is retried and then named as the source's failure.
  it('a 5xx on every attempt is UpstreamUnavailable, not a plain Error', async () => {
    const f = (async () => ({
      ok: false,
      status: 503,
    })) as unknown as typeof fetch;
    const p = fetchAllFeatures(f, LAYER, {
      sleep: noSleep,
      log: () => undefined,
    });
    await expect(p).rejects.toThrow(UpstreamUnavailable);
    await expect(p).rejects.toThrow(/HTTP 503 on all 3 attempts/);
  });

  // mutation: `isUpstreamStatus` → `status >= 400` → red
  it("🔴 a 404 is NOT retried and NOT the source's fault — the layer moved, which is ours", async () => {
    let calls = 0;
    const f = (async () => {
      calls += 1;
      return { ok: false, status: 404 };
    }) as unknown as typeof fetch;
    const p = fetchAllFeatures(f, LAYER, {
      sleep: noSleep,
      log: () => undefined,
    });
    await expect(p).rejects.toThrow(/count answered HTTP 404/);
    await expect(p).rejects.not.toThrow(UpstreamUnavailable);
    expect(calls).toBe(1);
  });

  // ArcGIS reports query failures inside a 200.
  it('throws on an error object served with HTTP 200', async () => {
    const f = (async (url: string) =>
      String(url).includes('returnCountOnly=true')
        ? ok({ count: 10 })
        : ok({
            error: { message: 'Unable to complete operation' },
          })) as unknown as typeof fetch;
    await expect(fetchAllFeatures(f, LAYER)).rejects.toThrow(
      /Unable to complete operation/,
    );
  });

  it('throws when the count itself fails', async () => {
    const f = (async () =>
      ok({ error: { message: 'nope' } })) as unknown as typeof fetch;
    await expect(fetchAllFeatures(f, LAYER)).rejects.toThrow(/nope/);
  });
});

// CAMP-440: the retry loop, in the shape of osm-weekly.yml's download
// loop — separate attempts, each named in the log, the failure named
// once after the loop.
describe('fetchUpstream', () => {
  it('three attempts, thirty seconds apart', () => {
    expect(ATTEMPTS).toBe(3);
    expect(RETRY_PAUSE_MS).toBe(30_000);
  });

  // mutation: `return res` before the status check → red
  it('🔴 500 then 200: returns the 200, logs the one failed attempt, slept once', async () => {
    const answers = [500, 200];
    const f = (async () => {
      const status = answers.shift();
      return { ok: status === 200, status, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const slept: number[] = [];
    const log: string[] = [];
    const res = await fetchUpstream(f, 'u', 'count', {
      sleep: async (ms) => {
        slept.push(ms);
      },
      log: (l) => log.push(l),
    });
    expect(res.status).toBe(200);
    expect(slept).toEqual([30_000]);
    expect(log).toEqual(['  count: attempt 1 of 3 — HTTP 500, waiting 30 s']);
  });

  // mutation: `i < attempts` sleep guard removed → slept 3 times → red
  it('🔴 500 ×3: every attempt in the log, two pauses, then UpstreamUnavailable in words', async () => {
    const f = (async () => ({
      ok: false,
      status: 500,
    })) as unknown as typeof fetch;
    const slept: number[] = [];
    const log: string[] = [];
    await expect(
      fetchUpstream(f, 'u', 'count', {
        sleep: async (ms) => {
          slept.push(ms);
        },
        log: (l) => log.push(l),
      }),
    ).rejects.toThrow(
      /the EEA ArcGIS server is unavailable: count answered HTTP 500 on all 3 attempts, 30 s apart — the source, not this import/,
    );
    expect(slept).toEqual([30_000, 30_000]);
    expect(log).toEqual([
      '  count: attempt 1 of 3 — HTTP 500, waiting 30 s',
      '  count: attempt 2 of 3 — HTTP 500, waiting 30 s',
      '  count: attempt 3 of 3 — HTTP 500',
    ]);
  });

  // mutation: `catch` removed → the TypeError escapes as itself → red
  it("🔴 an unreachable host (fetch throws) is retried and is the source's fault", async () => {
    const f = (async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED' },
      });
    }) as unknown as typeof fetch;
    const log: string[] = [];
    await expect(
      fetchUpstream(f, 'u', 'page at offset 0', {
        sleep: noSleep,
        log: (l) => log.push(l),
      }),
    ).rejects.toThrow(UpstreamUnavailable);
    expect(log[0]).toBe(
      '  page at offset 0: attempt 1 of 3 — unreachable (fetch failed, ECONNREFUSED), waiting 30 s',
    );
  });

  it('429 is retried like a 5xx; 403 is handed back on the first attempt', async () => {
    const f429 = (async () => ({
      ok: false,
      status: 429,
    })) as unknown as typeof fetch;
    await expect(
      fetchUpstream(f429, 'u', 'count', {
        sleep: noSleep,
        log: () => undefined,
      }),
    ).rejects.toThrow(UpstreamUnavailable);
    const f403 = (async () => ({
      ok: false,
      status: 403,
    })) as unknown as typeof fetch;
    expect(
      (await fetchUpstream(f403, 'u', 'count', { sleep: noSleep })).status,
    ).toBe(403);
  });
});
