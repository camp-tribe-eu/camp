// CAMP-477 — what the server remembers, so that a campsite page does not
// cost the bucket a read.
//
// 🔴 THE CACHE HOLDS THE RAW SERIES FOR A GRID CELL, NOT THE FINISHED DAYS.
//
//   · Two campsites in the same 25 km cell share one entry (the grid is
//     0.25 degrees, so the key is the cell, not the coordinate).
//   · "Today" is worked out at ANSWER time. An entry kept three hours is
//     still right about which day is today; an entry holding finished days
//     would be wrong about it after midnight.
//
// 🔴 THE TTL IS HALF THE MODEL'S UPDATE INTERVAL, taken from the bucket's
// own meta.json (`update_interval_seconds`, 21 600 on 16.11.2026, so three
// hours), not a number of ours. A fresh run lands every six hours; keeping
// an entry for half of that bounds how stale a reader's forecast can be at
// three hours behind the newest run, and costs one read per cell per three
// hours.
//
// 🔴 WHEN THE BUCKET FAILS, AN OLD ANSWER IS BETTER THAN NONE, UP TO A
// POINT. A stale entry is served when the refresh fails, for as long as it
// is younger than two update intervals (twelve hours): the forecast then
// comes from the run before last, which is still a forecast for the same
// days. Past that, the answer is "unavailable" and the page shows nothing.
//
// 🔴 BOUNDS. At most `maxEntries` cells (one entry is five arrays of about
// 200 numbers, a few kilobytes), the oldest-used dropped first, and at most
// `maxConcurrent` reads in flight; a burst of distinct cells queues instead
// of opening a hundred connections to the bucket.

import {
  type BucketMeta,
  type ForecastDay,
  type Series,
  MIN_DAYS_TO_SHOW,
  MODEL,
  cellOf,
  dailyForecast,
  zoneFor,
  type ForecastQuery,
} from './forecast';

export interface ForecastAnswer {
  model: string;
  /** ISO time of the model run the numbers come from. */
  runAt: string;
  days: ForecastDay[];
}

interface Entry {
  meta: BucketMeta;
  series: Series;
  fetchedAt: number;
}

export interface CacheDeps {
  read: (
    lat: number,
    lon: number,
    nowSec: number,
  ) => Promise<{ meta: BucketMeta; series: Series }>;
  /** Milliseconds. */
  now: () => number;
  maxEntries?: number;
  maxConcurrent?: number;
}

export class ForecastCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<Entry>>();
  private running = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly maxEntries: number;
  private readonly maxConcurrent: number;

  constructor(private readonly deps: CacheDeps) {
    this.maxEntries = deps.maxEntries ?? 2000;
    this.maxConcurrent = deps.maxConcurrent ?? 4;
  }

  /** The answer, or null when there is nothing honest to show. */
  async forecast(q: ForecastQuery): Promise<ForecastAnswer | null> {
    const { y, x } = cellOf(q.lat, q.lon);
    const key = `${y}:${x}`;
    const nowMs = this.deps.now();
    let entry = this.entries.get(key);
    const fresh =
      entry !== undefined &&
      nowMs - entry.fetchedAt < (entry.meta.update_interval_seconds * 1000) / 2;
    if (!fresh) {
      try {
        entry = await this.load(key, q);
      } catch (e) {
        const usable =
          entry !== undefined &&
          nowMs - entry.fetchedAt < entry.meta.update_interval_seconds * 2000;
        if (!usable) throw e;
        // Serve the old one; the next request tries again.
      }
    } else {
      // Most recently used goes to the back of the Map's insertion order.
      this.entries.delete(key);
      this.entries.set(key, entry!);
    }
    const e = entry!;
    const nowSec = Math.floor(nowMs / 1000);
    const days = dailyForecast(
      e.series,
      zoneFor(q.country, q.lat, q.lon),
      nowSec,
    );
    if (days.length < MIN_DAYS_TO_SHOW) return null;
    return {
      model: MODEL,
      runAt: new Date(e.meta.last_run_initialisation_time * 1000).toISOString(),
      days,
    };
  }

  private load(key: string, q: ForecastQuery): Promise<Entry> {
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.slot(async () => {
      const nowMs = this.deps.now();
      const got = await this.deps.read(q.lat, q.lon, Math.floor(nowMs / 1000));
      const entry: Entry = { ...got, fetchedAt: nowMs };
      this.entries.delete(key);
      this.entries.set(key, entry);
      while (this.entries.size > this.maxEntries) {
        const oldest = this.entries.keys().next().value as string;
        this.entries.delete(oldest);
      }
      return entry;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async slot<T>(job: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.running++;
    try {
      return await job();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }

  /** For tests: how many cells are held. */
  size(): number {
    return this.entries.size;
  }
}
