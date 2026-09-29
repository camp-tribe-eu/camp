import {
  fetchModelledBands,
  fetchRoster,
  fetchStationFile,
  mapPool,
  newestRosterFile,
  rasterWindow,
  sleeper,
} from './fetch';
import {
  AIR_RASTER_BATCH,
  AIR_RASTER_SENTINEL,
  AIR_RASTER_URL,
  AIR_ROSTER_INDEX_URL,
  airRosterUrl,
  airStationUrl,
} from './source';

// CAMP-164: the ways this fetch is allowed to fail, and the ways it is
// not. Every assertion was checked by deleting the line it names.

beforeAll(() => {
  // The retry waits half a second; a test suite does not.
  sleeper.sleep = async () => undefined;
});

type Handler = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;

function res(
  body: unknown,
  init: { status?: number; length?: number } = {},
): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    headers: {
      get: (h: string) =>
        h.toLowerCase() === 'content-length' && init.length !== undefined
          ? String(init.length)
          : null,
    },
  } as unknown as Response;
}

const fake = (h: Handler) => h as unknown as typeof fetch;

describe('newestRosterFile', () => {
  // 🔴 The index lists the files out of order, and the viewer's
  // "sort the names and pop" would work until 2100. By number.
  it('picks the largest number, not the last entry', () => {
    expect(
      newestRosterFile({
        contents: [
          'raw_stations.json.26091800',
          'raw_stations.json.26091100',
          'raw_stations.json.26090400',
          'raw_stations.json.26092500',
        ],
      }),
    ).toBe('raw_stations.json.26092500');
  });

  it('ignores names that are not roster files', () => {
    expect(
      newestRosterFile({
        contents: [
          'readme.txt',
          'raw_stations.json.26090400',
          'raw_stations.json.bak',
        ],
      }),
    ).toBe('raw_stations.json.26090400');
  });

  it('throws when there is no roster file, instead of guessing', () => {
    expect(() => newestRosterFile({ contents: ['x'] })).toThrow(
      /no raw_stations/,
    );
    expect(() => newestRosterFile({})).toThrow(/no "contents"/);
    expect(() => newestRosterFile(null)).toThrow(/no "contents"/);
  });
});

describe('fetchRoster', () => {
  const index = { contents: ['raw_stations.json.26092500'] };

  it('reads the newest roster', async () => {
    const seen: string[] = [];
    const f = fake((url) => {
      seen.push(url);
      return url === AIR_ROSTER_INDEX_URL ? res(index) : res([{ code: 'A' }]);
    });
    const r = await fetchRoster(f);
    expect(r.file).toBe('raw_stations.json.26092500');
    expect(r.rows).toEqual([{ code: 'A' }]);
    expect(seen).toEqual([
      AIR_ROSTER_INDEX_URL,
      airRosterUrl('raw_stations.json.26092500'),
    ]);
  });

  // The roster is 1.8 MB. A transfer cut short answers 200 with fewer
  // bytes than it announced; half a list is a JSON error only by luck.
  it('refuses a short read', async () => {
    const f = fake((url) =>
      url === AIR_ROSTER_INDEX_URL
        ? res(index)
        : res([{ code: 'A' }], { length: 999_999 }),
    );
    await expect(fetchRoster(f)).rejects.toThrow(/refusing a short read/);
  });

  it('refuses an empty roster', async () => {
    const f = fake((url) =>
      url === AIR_ROSTER_INDEX_URL ? res(index) : res([]),
    );
    await expect(fetchRoster(f)).rejects.toThrow(/non-empty list/);
  });

  it('refuses a roster that is not a list', async () => {
    const f = fake((url) =>
      url === AIR_ROSTER_INDEX_URL ? res(index) : res({ a: 1 }),
    );
    await expect(fetchRoster(f)).rejects.toThrow(/non-empty list/);
  });

  it('throws on an HTTP error', async () => {
    await expect(
      fetchRoster(fake(() => res('', { status: 503 }))),
    ).rejects.toThrow(/HTTP 503/);
  });

  it('throws on a 404 for the index or the roster rather than treating it as empty', async () => {
    await expect(
      fetchRoster(fake(() => res('', { status: 404 }))),
    ).rejects.toThrow(/answered 404/);
    const f = fake((url) =>
      url === AIR_ROSTER_INDEX_URL ? res(index) : res('', { status: 404 }),
    );
    await expect(fetchRoster(f)).rejects.toThrow(/answered 404/);
  });

  // The viewer's own code calls JSON.parse on what it gets; some hosts
  // hand the list back serialised twice.
  it('reads a list that was serialised twice', async () => {
    const f = fake((url) =>
      url === AIR_ROSTER_INDEX_URL
        ? res(index)
        : res(JSON.stringify(JSON.stringify([{ code: 'A' }]))),
    );
    expect((await fetchRoster(f)).rows).toEqual([{ code: 'A' }]);
  });

  it('retries once on a transient error', async () => {
    let calls = 0;
    const f = fake((url) => {
      if (url === AIR_ROSTER_INDEX_URL)
        return ++calls === 1 ? res('', { status: 502 }) : res(index);
      return res([{ code: 'A' }]);
    });
    expect((await fetchRoster(f)).rows).toHaveLength(1);
    expect(calls).toBe(2);
  });
});

describe('fetchStationFile', () => {
  // 🔴 THREE OUTCOMES, kept apart because the page tells them apart.
  it('says no-file for a 404', async () => {
    expect(
      await fetchStationFile(
        'X1',
        fake(() => res('', { status: 404 })),
      ),
    ).toEqual({
      outcome: 'no-file',
    });
  });

  // 🔴 The one that matters. A timeout says nothing about the station; if
  // it were stored as "no file" the page would say the station stopped
  // reporting because OUR request failed.
  it('says failed — not no-file — for a server error, after one retry', async () => {
    let calls = 0;
    const out = await fetchStationFile(
      'X1',
      fake(() => {
        calls++;
        return res('', { status: 500 });
      }),
    );
    expect(out.outcome).toBe('failed');
    expect(calls).toBe(2);
  });

  it('says failed for a network error', async () => {
    const out = await fetchStationFile(
      'X1',
      fake(() => {
        throw new Error('socket hang up');
      }),
    );
    expect(out).toEqual({ outcome: 'failed', detail: 'socket hang up' });
  });

  it('says failed for a body that is not JSON', async () => {
    expect(
      (
        await fetchStationFile(
          'X1',
          fake(() => res('<html>')),
        )
      ).outcome,
    ).toBe('failed');
  });

  it('recovers on the retry', async () => {
    let calls = 0;
    const out = await fetchStationFile(
      'X1',
      fake(() => (++calls === 1 ? res('', { status: 503 }) : res({ a: 1 }))),
    );
    expect(out).toEqual({ outcome: 'ok', body: { a: 1 }, bytes: 7 });
  });

  it('asks for the station by its code, escaped', async () => {
    let asked = '';
    await fetchStationFile(
      'A B/1',
      fake((url) => ((asked = url), res({}))),
    );
    expect(asked).toBe(airStationUrl('A B/1'));
    expect(asked).toContain('A%20B%2F1');
  });
});

describe('mapPool', () => {
  it('never runs more than the limit at once, and keeps input order', async () => {
    let live = 0;
    let peak = 0;
    const out = await mapPool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 2));
      live--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(peak).toBe(3);
  });

  it('handles an empty list', async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
  });
});

describe('rasterWindow', () => {
  const good = {
    timeInfo: { timeExtent: [1790553600000, 1790856000000] },
    maxValues: [6],
  };

  it('reads the hours the service holds', async () => {
    expect(await rasterWindow(fake(() => res(good)))).toEqual({
      start: 1790553600000,
      end: 1790856000000,
    });
  });

  // ArcGIS answers a service that is not there with HTTP 200.
  it('refuses a description with no time extent — a retired service answers 200', async () => {
    await expect(rasterWindow(fake(() => res({})))).rejects.toThrow(
      /no time extent/,
    );
  });

  it('refuses an ArcGIS error served with HTTP 200', async () => {
    await expect(
      rasterWindow(
        fake(() => res({ error: { message: 'Service not found' } })),
      ),
    ).rejects.toThrow(/Service not found/);
  });

  it('refuses a raster that is not levels 1–6', async () => {
    await expect(
      rasterWindow(fake(() => res({ ...good, maxValues: [500] }))),
    ).rejects.toThrow(/not \[6\]/);
  });

  it('asks the year-suffixed service', async () => {
    let asked = '';
    await rasterWindow(fake((url) => ((asked = url), res(good))));
    expect(asked).toBe(`${AIR_RASTER_URL}?f=json`);
    expect(AIR_RASTER_URL).toContain('AQMobile_2025');
  });
});

/**
 * A fake getSamples. `cap` is how many points of a request the server
 * looks at — 1 000 in reality, and the whole point of the sentinel.
 * `level(lon, lat)` is the value at a point, or null for no value.
 */
function raster(
  opts: {
    cap?: number;
    level?: (lon: number, lat: number) => number | null;
    onRequest?: (points: number[][]) => void;
    error?: string;
    status?: number;
  } = {},
) {
  const level = opts.level ?? (() => 2);
  return fake(async (_url: string, init?: RequestInit) => {
    if (opts.status) return res('', { status: opts.status });
    const form = new URLSearchParams(
      (init!.body as URLSearchParams).toString(),
    );
    const points: number[][] = JSON.parse(form.get('geometry')!).points;
    opts.onRequest?.(points);
    if (opts.error) return res({ error: { message: opts.error } });
    const looked = points.slice(0, opts.cap ?? 1000);
    const samples = looked.flatMap(([lon, lat], i) => {
      const v = level(lon, lat);
      return v === null ? [] : [{ locationId: i, value: `${v}.000000000` }];
    });
    return res({ samples });
  });
}

const pts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ lon: i, lat: 40 }));

describe('fetchModelledBands', () => {
  it('reads a level for each point and null where the model has none', async () => {
    const { bands, badValues } = await fetchModelledBands(
      [
        { lon: 17, lat: 46 },
        { lon: -15, lat: 28 }, // the Canary Islands: no value
        { lon: 2, lat: 48 },
      ],
      1_790_701_200_000,
      raster({ level: (lon) => (lon < 0 ? null : lon > 10 ? 3 : 1) }),
    );
    expect(bands).toEqual([3, null, 1]);
    expect(badValues).toBe(0);
  });

  it('asks for the hour it was given, as a slice of the AQI variable', async () => {
    let rule: any;
    await fetchModelledBands(
      pts(1),
      1_790_701_200_000,
      fake(async (_u: string, init?: RequestInit) => {
        rule = JSON.parse(
          new URLSearchParams((init!.body as URLSearchParams).toString()).get(
            'mosaicRule',
          )!,
        );
        return res({ samples: [{ locationId: 1, value: '2.000000000' }] });
      }),
    );
    expect(rule.multidimensionalDefinition).toEqual([
      {
        variableName: 'AQI',
        dimensionName: 'StdTime',
        values: [1_790_701_200_000],
        isSlice: true,
      },
    ]);
  });

  // 🔴 THE TRAP. The server ignores every point past the first 1 000
  // without an error; a batch of 3 000 costs 2 000 points that look
  // exactly like points outside the model.
  it('never sends more than the batch size, plus one sentinel', async () => {
    const sizes: number[] = [];
    await fetchModelledBands(
      pts(2500),
      0,
      raster({ onRequest: (p) => sizes.push(p.length) }),
    );
    expect(AIR_RASTER_BATCH).toBeLessThan(1000);
    // 2 500 points = five full batches and five over, plus a sentinel each.
    expect(sizes).toEqual([500, 500, 500, 500, 500, 6]);
    expect(Math.max(...sizes)).toBe(AIR_RASTER_BATCH + 1);
  });

  it('puts the sentinel LAST in every batch', async () => {
    const lasts: number[][] = [];
    await fetchModelledBands(
      pts(600),
      0,
      raster({ onRequest: (p) => lasts.push(p[p.length - 1]) }),
    );
    for (const last of lasts) {
      expect(last).toEqual([AIR_RASTER_SENTINEL.lon, AIR_RASTER_SENTINEL.lat]);
    }
    expect(lasts).toHaveLength(2);
  });

  // 🔴 A server that looks at fewer points than it was sent must be
  // caught by the sentinel, and it must throw — not return a partial
  // answer in which the ignored points read as "outside the model".
  it('throws when the server drops the tail of a batch', async () => {
    await expect(
      fetchModelledBands(pts(400), 0, raster({ cap: 250 })),
    ).rejects.toThrow(/sentinel point did not come back/);
  });

  it('passes when the server looks at the whole batch', async () => {
    const { bands } = await fetchModelledBands(
      pts(499),
      0,
      raster({ cap: 500 }),
    );
    expect(bands.every((b) => b === 2)).toBe(true);
  });

  it('throws on an ArcGIS error served with HTTP 200', async () => {
    await expect(
      fetchModelledBands(pts(3), 0, raster({ error: 'nope' })),
    ).rejects.toThrow(/nope/);
  });

  it('throws on an HTTP error', async () => {
    await expect(
      fetchModelledBands(pts(3), 0, raster({ status: 400 })),
    ).rejects.toThrow(/HTTP 400/);
  });

  // The index is levels 1–6 and integers. Anything else is counted and
  // dropped, never stored as a level.
  it.each(['0', '7', '2.5', 'NaN'])(
    'counts a sample of %s as a bad value, not a level',
    async (v) => {
      const f = fake(async (_u: string, init?: RequestInit) => {
        const n = JSON.parse(
          new URLSearchParams((init!.body as URLSearchParams).toString()).get(
            'geometry',
          )!,
        ).points.length;
        return res({
          samples: [
            { locationId: 0, value: v },
            { locationId: n - 1, value: '2.000000000' },
          ],
        });
      });
      const { bands, badValues } = await fetchModelledBands(pts(1), 0, f);
      expect(bands).toEqual([null]);
      expect(badValues).toBe(1);
    },
  );

  it('carries no key or token', async () => {
    let init: RequestInit | undefined;
    let url = '';
    await fetchModelledBands(
      pts(1),
      0,
      fake(async (u: string, i?: RequestInit) => {
        url = u;
        init = i;
        return res({ samples: [{ locationId: 1, value: '2' }] });
      }),
    );
    expect(url + JSON.stringify(init)).not.toMatch(
      /token|api[-_]?key|apikey|secret|authorization/i,
    );
  });
});
