import { countUrl, fetchAllFeatures, PAGE_SIZE, pageUrl } from './fetch';

// CAMP-168: ArcGIS answers a failed page with HTTP 200 and an `error`
// object, so "the loop ended" is never evidence that the data ended.
// These tests are about the ways this fetch is allowed to fail.

const LAYER = 'https://example.test/MapServer/3';

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

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

  it('throws on an HTTP error', async () => {
    const f = (async () => ({
      ok: false,
      status: 503,
    })) as unknown as typeof fetch;
    await expect(fetchAllFeatures(f, LAYER)).rejects.toThrow(/HTTP 503/);
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
