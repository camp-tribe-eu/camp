import { readFileSync } from 'fs';
import { join } from 'path';

import { ForecastCache } from './cache';
import {
  type BucketMeta,
  type ChunkRead,
  type Series,
  joinChunks,
} from './forecast';

// CAMP-477. The cache, driven by a clock and a reader of our own: no
// network, no sleeping.

interface Fix {
  nowSec: number;
  meta: BucketMeta;
  reads: Array<{ chunk: number; values: Record<string, Array<number | null>> }>;
}
const fixture = (name: string): Fix =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8'));
const EXPECTED = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'expected.json'), 'utf8'),
) as Record<'vendee' | 'finland', unknown[]>;
const fx = fixture('vendee');
const seriesOf = (f: Fix): Series =>
  joinChunks(
    f.meta,
    f.reads.map((r) => ({
      chunk: r.chunk,
      values: Object.fromEntries(
        Object.entries(r.values).map(([k, v]) => [
          k,
          v.map((x) => (x === null ? NaN : x)),
        ]),
      ),
    })) as unknown as ChunkRead[],
  )!;
const series = (): Series => seriesOf(fx);

const T0 = fx.nowSec * 1000;
const HALF = (fx.meta.update_interval_seconds * 1000) / 2; // three hours
const PARIS = { lat: 46.6, lon: -1.8, country: 'fr' };

function rig(
  over: {
    maxEntries?: number;
    maxConcurrent?: number;
    maxQueue?: number;
    failureMemoryMs?: number;
  } = {},
) {
  let now = T0;
  const calls: Array<[number, number]> = [];
  let fail: Error | null = null;
  const c = new ForecastCache({
    now: () => now,
    read: async (lat, lon) => {
      calls.push([lat, lon]);
      if (fail) throw fail;
      return { meta: fx.meta, series: series() };
    },
    ...over,
  });
  return {
    c,
    calls,
    tick: (ms: number) => (now += ms),
    breakIt: (e: Error | null) => (fail = e),
  };
}

describe('ForecastCache', () => {
  it('answers seven days with the model and run', async () => {
    const r = rig();
    const a = await r.c.forecast(PARIS);
    expect(a?.days).toHaveLength(7);
    expect(a?.model).toBe('ecmwf_ifs025');
    expect(a?.runAt).toBe('2026-11-16T00:00:00.000Z');
  });

  it('a second view inside the TTL costs no read', async () => {
    const r = rig();
    await r.c.forecast(PARIS);
    r.tick(HALF - 1);
    await r.c.forecast(PARIS);
    expect(r.calls).toHaveLength(1);
  });

  it('the TTL is half the update interval from the bucket: at that age it reads again', async () => {
    const r = rig();
    await r.c.forecast(PARIS);
    r.tick(HALF);
    await r.c.forecast(PARIS);
    expect(r.calls).toHaveLength(2);
    expect(HALF).toBe(3 * 3600 * 1000);
  });

  it('two campsites in one 0.25 degree cell share one read; the next cell does not', async () => {
    const r = rig();
    await r.c.forecast({ ...PARIS, lat: 46.55, lon: -1.78 });
    await r.c.forecast({ ...PARIS, lat: 46.62, lon: -1.83 });
    expect(r.calls).toHaveLength(1);
    await r.c.forecast({ ...PARIS, lat: 46.9, lon: -1.8 });
    expect(r.calls).toHaveLength(2);
  });

  it('a burst for one cell is ONE read in flight, not ten', async () => {
    const r = rig();
    await Promise.all(Array.from({ length: 10 }, () => r.c.forecast(PARIS)));
    expect(r.calls).toHaveLength(1);
  });

  it('when the refresh fails an entry under two update intervals old is still served', async () => {
    const r = rig();
    await r.c.forecast(PARIS);
    r.breakIt(new Error('bucket down'));
    r.tick(HALF + 1); // stale, refresh fails
    expect((await r.c.forecast(PARIS))?.days).toHaveLength(7);
    // Within a day (24 h) of 16.11 the same days are still in the series.
  });

  it('past two update intervals a failed refresh is an error, not an old answer', async () => {
    const r = rig();
    await r.c.forecast(PARIS);
    r.breakIt(new Error('bucket down'));
    r.tick(fx.meta.update_interval_seconds * 2000 + 1);
    await expect(r.c.forecast(PARIS)).rejects.toThrow('bucket down');
  });

  it('a cell never read and a failing bucket is an error', async () => {
    const r = rig();
    r.breakIt(new Error('bucket down'));
    await expect(r.c.forecast(PARIS)).rejects.toThrow('bucket down');
  });

  it('answers null (no section) when fewer than three days can be shown', async () => {
    const short = new ForecastCache({
      now: () => T0,
      read: async () => {
        const s = series();
        // Keep only what ends two days after today's start: 12 days of
        // lead-in (chunk start 04.11, today 16.11) plus two.
        const keep = 12 * 8 + 2 * 8;
        for (const k of Object.keys(s) as Array<keyof Series>) {
          if (Array.isArray(s[k])) (s[k] as number[]).length = keep;
        }
        return { meta: fx.meta, series: s };
      },
    });
    expect(await short.forecast(PARIS)).toBeNull();
  });

  it('holds at most maxEntries cells, dropping the least recently used', async () => {
    const r = rig({ maxEntries: 2 });
    await r.c.forecast({ ...PARIS, lat: 46.0 });
    await r.c.forecast({ ...PARIS, lat: 47.0 });
    await r.c.forecast({ ...PARIS, lat: 46.0 }); // touch the first
    await r.c.forecast({ ...PARIS, lat: 48.0 }); // evicts 47.0
    expect(r.c.size()).toBe(2);
    expect(r.calls).toHaveLength(3);
    await r.c.forecast({ ...PARIS, lat: 46.0 });
    expect(r.calls).toHaveLength(3); // still held
    await r.c.forecast({ ...PARIS, lat: 47.0 });
    expect(r.calls).toHaveLength(4); // was evicted
  });

  it('never has more than maxConcurrent reads in flight', async () => {
    let running = 0;
    let peak = 0;
    const gates: Array<() => void> = [];
    const c = new ForecastCache({
      now: () => T0,
      maxConcurrent: 2,
      read: async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise<void>((res) => gates.push(res));
        running--;
        return { meta: fx.meta, series: series() };
      },
    });
    const all = Promise.all(
      [40, 41, 42, 43, 44, 45].map((lat) =>
        c.forecast({ ...PARIS, lat: lat + 0.01 }),
      ),
    );
    // Release reads as they start until all six have run.
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setImmediate(r));
      gates.shift()?.();
    }
    await new Promise((r) => setImmediate(r));
    while (gates.length) gates.shift()!();
    await all;
    expect(peak).toBe(2);
  });

  // 🔴 THE LOCAL DAY ON THE PATH THAT ACTUALLY ANSWERS. The pure function is
  // tested with a zone handed in; this proves the cache hands it the right
  // one. Finland on the Helsinki clock is the table a separate
  // implementation computed; the same series on a UTC clock is not.
  it('answers Finland on the Helsinki clock, and France on the Paris clock', async () => {
    const f = fixture('finland');
    const c = new ForecastCache({
      now: () => f.nowSec * 1000,
      read: async () => ({ meta: f.meta, series: seriesOf(f) }),
    });
    const a = await c.forecast({ lat: 61.5, lon: 23.8, country: 'fi' });
    expect(a?.days).toEqual(EXPECTED.finland);
    const r = rig();
    expect((await r.c.forecast(PARIS))?.days).toEqual(EXPECTED.vendee);
  });

  describe('a failing cell is remembered, and the bucket is left alone', () => {
    it('within ten minutes a failed cell is not read again, for any campsite in it', async () => {
      const r = rig();
      r.breakIt(new Error('chunk missing'));
      await expect(r.c.forecast(PARIS)).rejects.toThrow('chunk missing');
      expect(r.calls).toHaveLength(1);
      r.breakIt(null);
      r.tick(9 * 60_000);
      await expect(r.c.forecast({ ...PARIS, lat: 46.62 })).rejects.toThrow(
        'failed recently',
      );
      expect(r.calls).toHaveLength(1); // the bucket was not touched
    });

    it('after ten minutes it is tried again and recovers', async () => {
      const r = rig();
      r.breakIt(new Error('x'));
      await expect(r.c.forecast(PARIS)).rejects.toThrow();
      r.breakIt(null);
      r.tick(10 * 60_000);
      expect((await r.c.forecast(PARIS))?.days).toHaveLength(7);
      expect(r.calls).toHaveLength(2);
    });

    it('another cell is not affected', async () => {
      const r = rig();
      r.breakIt(new Error('x'));
      await expect(r.c.forecast(PARIS)).rejects.toThrow();
      r.breakIt(null);
      expect((await r.c.forecast({ ...PARIS, lat: 48.1 }))?.days).toHaveLength(
        7,
      );
    });

    it('a stale entry is still served while its refresh is in the failure window', async () => {
      const r = rig();
      await r.c.forecast(PARIS);
      r.breakIt(new Error('x'));
      r.tick(HALF + 1);
      await r.c.forecast(PARIS); // refresh fails, stale served
      r.tick(60_000);
      expect((await r.c.forecast(PARIS))?.days).toHaveLength(7);
      expect(r.calls).toHaveLength(2); // the second view did not read
    });
  });

  describe('the waiting line is bounded', () => {
    it('past maxQueue waiting readers a request is refused at once, without a read', async () => {
      const gates: Array<() => void> = [];
      let reads = 0;
      const c = new ForecastCache({
        now: () => T0,
        maxConcurrent: 1,
        maxQueue: 2,
        read: async () => {
          reads++;
          await new Promise<void>((res) => gates.push(res));
          return { meta: fx.meta, series: series() };
        },
      });
      const cell = (i: number) => ({ ...PARIS, lat: 40 + i * 0.5 });
      const ok = [0, 1, 2].map((i) => c.forecast(cell(i))); // 1 running, 2 waiting
      await new Promise((r) => setImmediate(r));
      await expect(c.forecast(cell(3))).rejects.toThrow('saturated');
      expect(reads).toBe(1); // only the running one touched the bucket
      while (gates.length || reads < 3) {
        gates.shift()?.();
        await new Promise((r) => setImmediate(r));
        if (!gates.length && reads >= 3) break;
      }
      while (gates.length) gates.shift()!();
      await Promise.all(ok);
    });

    it('a refusal for being busy is not held against the cell', async () => {
      const gates: Array<() => void> = [];
      const c = new ForecastCache({
        now: () => T0,
        maxConcurrent: 1,
        maxQueue: 0,
        read: async () => {
          await new Promise<void>((res) => gates.push(res));
          return { meta: fx.meta, series: series() };
        },
      });
      const first = c.forecast({ ...PARIS, lat: 40 });
      await new Promise((r) => setImmediate(r));
      await expect(c.forecast({ ...PARIS, lat: 41 })).rejects.toThrow(
        'saturated',
      );
      gates.shift()!();
      await first;
      const again = c.forecast({ ...PARIS, lat: 41 });
      await new Promise((r) => setImmediate(r));
      gates.shift()!();
      expect((await again)?.days).toHaveLength(7);
    });
  });
});
