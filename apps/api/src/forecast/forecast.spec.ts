import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import {
  type BucketMeta,
  type ChunkRead,
  type Series,
  GRID,
  VARIABLES,
  cellOf,
  chunksNeeded,
  conditionOf,
  dailyForecast,
  joinChunks,
  parseSlug,
  nextDate,
  MIN_DAYS_TO_SHOW,
  stepTime,
  zoneFor,
} from './forecast';

// CAMP-477. The fixtures are REAL reads from the bucket (captured
// 16.11.2026 with readChunks, values rounded to two decimals), not
// invented numbers; no test here touches the network.

interface Fixture {
  nowSec: number;
  meta: BucketMeta;
  reads: Array<{ chunk: number; values: Record<string, Array<number | null>> }>;
}
const load = (name: string): Fixture =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8'));

const reads = (f: Fixture): ChunkRead[] =>
  f.reads.map((r) => ({
    chunk: r.chunk,
    values: Object.fromEntries(
      Object.entries(r.values).map(([k, v]) => [
        k,
        v.map((x) => (x === null ? NaN : x)),
      ]),
    ) as unknown as ChunkRead['values'],
  }));

const seriesOf = (f: Fixture): Series => joinChunks(f.meta, reads(f))!;

// 🔴 `fixtures/expected.json` was computed by a SEPARATE implementation
// (Python, zoneinfo, straight off the fixture JSON), not copied from this
// code's output. It uses the BACKWARDS rule for the stored extremes
// (`temperature_2m_max/min` cover the three hours before their stamp, as in
// Open-Meteo's EcmwfVariable.swift), which the first version of this table
// did not: it moved Vendée 18.11 min 13->12, 19.11 max 14->13, 20.11 min
// 11->10, and a reviewer found it.
const EXPECTED = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'expected.json'), 'utf8'),
) as Record<'vendee' | 'finland', unknown[]>;

describe('dailyForecast on real bucket reads', () => {
  it('Vendée, Europe/Paris: seven days equal the independent table', () => {
    const f = load('vendee');
    expect(dailyForecast(seriesOf(f), 'Europe/Paris', f.nowSec)).toEqual(
      EXPECTED.vendee,
    );
  });

  it('Finland, Europe/Helsinki: seven days equal the independent table', () => {
    const f = load('finland');
    expect(dailyForecast(seriesOf(f), 'Europe/Helsinki', f.nowSec)).toEqual(
      EXPECTED.finland,
    );
  });

  it('the day is the LOCAL day: Helsinki and UTC split the same rain differently', () => {
    const f = load('finland');
    const local = dailyForecast(seriesOf(f), 'Europe/Helsinki', f.nowSec);
    const utc = dailyForecast(seriesOf(f), 'UTC', f.nowSec);
    expect(utc.map((d) => d.precipMm)).not.toEqual(
      local.map((d) => d.precipMm),
    );
  });

  it('a day starts at today: yesterday is never returned', () => {
    const f = load('vendee');
    const days = dailyForecast(seriesOf(f), 'Europe/Paris', f.nowSec);
    expect(days[0].date).toBe('2026-11-16');
  });

  it('a chunk that was not read leaves NaN, and the days it covered are LEFT OUT, not zero', () => {
    const f = load('vendee');
    const only = reads(f).slice(0, 1); // chunk 1597 only: ends 2026-11-17 00:00 UTC
    const s = joinChunks(f.meta, only)!;
    const days = dailyForecast(s, 'Europe/Paris', f.nowSec);
    // Everything from the 17th on is beyond the read chunk.
    expect(days.map((d) => d.date)).toEqual(['2026-11-16']);
    // …and it did not invent a rainless week.
    expect(days.every((d) => d.precipMm > 0)).toBe(true);
  });

  it('a gap in the middle is not closed up: positions stay times', () => {
    const f = load('vendee');
    const [a, b] = reads(f);
    const gap = joinChunks(f.meta, [a, { ...b, chunk: b.chunk + 1 }])!;
    expect(gap.temperature_2m.length).toBe(3 * f.meta.chunk_time_length);
    expect(gap.temperature_2m.slice(104, 208).every(Number.isNaN)).toBe(true);
    expect(gap.temperature_2m[208]).toBe(b.values.temperature_2m[0]);
  });

  it('only 5 of 8 steps for a day: the day is left out', () => {
    const f = load('vendee');
    const s = seriesOf(f);
    // Blank every step of the 18th (Paris) but five of them.
    const t0 = Date.UTC(2026, 10, 17, 23) / 1000; // 18th 00:00 Paris
    for (let i = 0; i < s.temperature_2m.length; i++) {
      const t = s.start + i * s.step;
      const off = (t - t0) / s.step;
      if (off >= 0 && off < 8 && off >= 5) s.temperature_2m[i] = NaN;
    }
    const days = dailyForecast(s, 'Europe/Paris', f.nowSec).map((d) => d.date);
    // The run stops at the hole: the 19th is not pulled forward.
    expect(days).toEqual(['2026-11-16', '2026-11-17']);
  });
});

describe('precipitation belongs to the day holding the middle of its three hours', () => {
  const meta = load('vendee').meta;
  const mk = (): Series => {
    const n = 2 * meta.chunk_time_length;
    const z = () => new Array<number>(n).fill(0);
    return {
      start: stepTime(meta, 1597, 0),
      step: meta.temporal_resolution_seconds,
      temperature_2m: z().map(() => 10),
      temperature_2m_max: z().map(() => 11),
      temperature_2m_min: z().map(() => 9),
      precipitation: z(),
      cloud_cover: z().map(() => 50),
    };
  };
  const rain = (zone: string, at: number) => {
    const s = mk();
    s.precipitation[(at / 1000 - s.start) / s.step] = 6;
    const days = dailyForecast(s, zone, Date.UTC(2026, 10, 16, 12) / 1000);
    return Object.fromEntries(days.map((d) => [d.date, d.precipMm]));
  };

  it('UTC: the step stamped 00:00 covers 21:00-00:00 and counts for the day before', () => {
    const by = rain('UTC', Date.UTC(2026, 10, 18, 0));
    expect(by['2026-11-17']).toBe(6);
    expect(by['2026-11-18']).toBe(0);
  });

  it('Paris: the step stamped 01:00 local covers 22:00-01:00 and counts for the day before', () => {
    // 00:00Z on the 18th is 01:00 in Paris.
    const by = rain('Europe/Paris', Date.UTC(2026, 10, 18, 0));
    expect(by['2026-11-17']).toBe(6);
    expect(by['2026-11-18']).toBe(0);
  });

  it('Paris: the step stamped 04:00 local covers 01:00-04:00 and counts for that day', () => {
    const by = rain('Europe/Paris', Date.UTC(2026, 10, 18, 3));
    expect(by['2026-11-18']).toBe(6);
    expect(by['2026-11-17']).toBe(0);
  });
});

describe('the word for a day reads daytime cloud only', () => {
  it('a clear day with cloudy nights is Clear', () => {
    const meta = load('vendee').meta;
    const n = 2 * meta.chunk_time_length;
    const start = stepTime(meta, 1597, 0);
    const s: Series = {
      start,
      step: meta.temporal_resolution_seconds,
      temperature_2m: new Array<number>(n).fill(20),
      temperature_2m_max: new Array<number>(n).fill(21),
      temperature_2m_min: new Array<number>(n).fill(19),
      precipitation: new Array<number>(n).fill(0),
      // UTC zone: 100 % cloud at night (21:00-03:00), 0 % from 06:00 to 18:00.
      cloud_cover: Array.from({ length: n }, (_, i) => {
        const h = new Date((start + i * 10800) * 1000).getUTCHours();
        return h >= 6 && h <= 20 ? 0 : 100;
      }),
    };
    const days = dailyForecast(s, 'UTC', Date.UTC(2026, 10, 16, 12) / 1000);
    expect(days[0].condition).toBe('clear');
  });
});

describe('conditionOf', () => {
  it.each([
    [0, 10, 10, 'clear'],
    [0, 10, 24.9, 'clear'],
    [0, 10, 25, 'partly-cloudy'],
    [0, 10, 59.9, 'partly-cloudy'],
    [0, 10, 60, 'cloudy'],
    [0, 10, null, 'partly-cloudy'],
    [0.9, 10, 100, 'cloudy'],
    [1, 10, 100, 'rain'],
    [9.9, 10, 100, 'rain'],
    [10, 10, 100, 'heavy-rain'],
    [5, 1, 100, 'snow'],
    [5, 1.1, 100, 'rain'],
    [0.5, -5, 100, 'cloudy'],
  ] as const)('%s mm, max %s, cloud %s -> %s', (mm, tMax, cloud, want) => {
    expect(conditionOf(mm, tMax, cloud)).toBe(want);
  });
});

describe('grid and chunks', () => {
  it('cellOf: Vendée and the date line', () => {
    expect(cellOf(46.6, -1.8)).toEqual({ y: 546, x: 713 });
    expect(cellOf(0, -180)).toEqual({ y: 360, x: 0 });
    expect(cellOf(0, 179.9)).toEqual({ y: 360, x: 0 });
    expect(GRID.ny).toBe(721);
  });

  it('chunksNeeded: the two chunks around 16.11.2026, and none past the data', () => {
    const f = load('vendee');
    expect(chunksNeeded(f.meta, f.nowSec)).toEqual([1597, 1598]);
    const span = f.meta.chunk_time_length * f.meta.temporal_resolution_seconds;
    const shortEnd = { ...f.meta, data_end_time: 1598 * span }; // ends where 1598 would begin
    expect(chunksNeeded(shortEnd, f.nowSec)).toEqual([1597]);
  });

  it('stepTime: chunk 1597 begins 2026-11-04T00:00Z', () => {
    const f = load('vendee');
    expect(new Date(stepTime(f.meta, 1597, 0) * 1000).toISOString()).toBe(
      '2026-11-04T00:00:00.000Z',
    );
  });

  it('the fixture really holds every variable we read', () => {
    const f = load('vendee');
    for (const v of VARIABLES) expect(f.reads[0].values[v]).toHaveLength(104);
  });
});

describe('zones', () => {
  it.each([
    ['fr', 48, 2, 'Europe/Paris'],
    ['fi', 61.5, 23.8, 'Europe/Helsinki'],
    ['ax', 60.1, 19.9, 'Europe/Helsinki'],
    ['es', 40, -3, 'Europe/Madrid'],
    ['es', 28.3, -16.5, 'Atlantic/Canary'],
    ['pt', 38.7, -9.1, 'Europe/Lisbon'],
    ['pt', 38.6, -28, 'Atlantic/Azores'],
    ['cy', 35, 33, 'Asia/Nicosia'],
  ] as const)('%s %s,%s -> %s', (c, lat, lon, zone) => {
    expect(zoneFor(c, lat, lon)).toBe(zone);
  });

  it('every EU-27 code (and ax) has a zone, and a non-member has none', () => {
    const eu = JSON.parse(
      readFileSync(join(__dirname, '../osm/eu-member-states.json'), 'utf8'),
    ) as { members: Record<string, unknown> };
    const codes = Object.keys(eu.members).map((c) => c.toLowerCase());
    expect(codes).toHaveLength(27);
    for (const c of codes) expect(() => zoneFor(c, 50, 10)).not.toThrow();
    expect(() => zoneFor('gb', 51, 0)).toThrow();
  });
});

describe('parseSlug', () => {
  it.each(['camp-bovec', 'a', '3', 'ac-san-marino-dt'])('%s is a slug', (v) => {
    expect(parseSlug(v)).toBe(v);
  });
  it.each([
    undefined,
    '',
    '-x',
    'A',
    'a b',
    'a/b',
    '../x',
    "a'; drop",
    'a'.repeat(201),
  ])('%j is refused', (v) => {
    expect(parseSlug(v)).toBeNull();
  });
});

describe('the stored extremes look backwards, like the rain', () => {
  const meta = load('vendee').meta;
  const flat = (): Series => {
    const n = 2 * meta.chunk_time_length;
    const fill = (v: number) => new Array<number>(n).fill(v);
    return {
      start: stepTime(meta, 1597, 0),
      step: meta.temporal_resolution_seconds,
      temperature_2m: fill(10),
      temperature_2m_max: fill(10),
      temperature_2m_min: fill(10),
      precipitation: fill(0),
      cloud_cover: fill(50),
    };
  };
  const now = Date.UTC(2026, 10, 16, 12) / 1000;

  it('a max stamped 01:00 Paris covers 22:00-01:00 and counts for the day before', () => {
    const s = flat();
    // 00:00Z on the 18th = 01:00 Paris. A 25 degree extreme.
    s.temperature_2m_max[
      (Date.UTC(2026, 10, 18, 0) / 1000 - s.start) / s.step
    ] = 25;
    const by = Object.fromEntries(
      dailyForecast(s, 'Europe/Paris', now).map((d) => [d.date, d.tMax]),
    );
    expect(by['2026-11-17']).toBe(25);
    expect(by['2026-11-18']).toBe(10);
  });

  it('the same for a minimum, and an instantaneous value stays with its stamp', () => {
    const s = flat();
    s.temperature_2m_min[
      (Date.UTC(2026, 10, 18, 0) / 1000 - s.start) / s.step
    ] = -4;
    s.temperature_2m[(Date.UTC(2026, 10, 18, 0) / 1000 - s.start) / s.step] =
      30;
    const by = Object.fromEntries(
      dailyForecast(s, 'Europe/Paris', now).map((d) => [
        d.date,
        [d.tMax, d.tMin],
      ]),
    );
    expect(by['2026-11-17']).toEqual([10, -4]);
    // 30 degrees at the stamp 01:00 on the 18th belongs to the 18th.
    expect(by['2026-11-18']).toEqual([30, 10]);
  });
});

describe('a week with a hole', () => {
  it('stops at the first missing day and never pulls a later one forward', () => {
    const f = load('vendee');
    const s = seriesOf(f);
    // Blank every temperature of Paris 19.11 (stamps 18th 23:00Z .. 19th 22:00Z).
    const from = Date.UTC(2026, 10, 18, 23) / 1000;
    for (let i = 0; i < s.temperature_2m.length; i++) {
      const t = s.start + i * s.step;
      if (t >= from && t < from + 24 * 3600) s.temperature_2m[i] = NaN;
    }
    const days = dailyForecast(s, 'Europe/Paris', f.nowSec).map((d) => d.date);
    expect(days).toEqual(['2026-11-16', '2026-11-17', '2026-11-18']);
  });

  it('a missing TODAY means no days at all', () => {
    const f = load('vendee');
    const s = seriesOf(f);
    const from = Date.UTC(2026, 10, 15, 23) / 1000;
    for (let i = 0; i < s.temperature_2m.length; i++) {
      const t = s.start + i * s.step;
      if (t >= from && t < from + 24 * 3600) s.temperature_2m[i] = NaN;
    }
    expect(dailyForecast(s, 'Europe/Paris', f.nowSec)).toEqual([]);
  });

  it('nextDate steps by calendar across a month and a year', () => {
    expect(nextDate('2026-11-30')).toBe('2026-12-01');
    expect(nextDate('2026-12-31')).toBe('2027-01-01');
    expect(nextDate('2028-02-28')).toBe('2028-02-29');
  });

  it('shows at least three days or nothing: the number the page also uses', () => {
    expect(MIN_DAYS_TO_SHOW).toBe(3);
  });
});

describe('what the rain sum and the window are made of', () => {
  const meta = load('vendee').meta;
  const span = meta.chunk_time_length * meta.temporal_resolution_seconds;
  const H = 3600;
  const B = 1598 * span; // the start of chunk 1598
  const ahead = { ...meta, data_end_time: B + 100 * span };

  it('the window reaches back 36 hours: 35 h after a boundary still needs the chunk before it', () => {
    expect(chunksNeeded(ahead, B + 35 * H)[0]).toBe(1597);
    expect(chunksNeeded(ahead, B + 36 * H)[0]).toBe(1598);
  });

  it('the window reaches forward 8 days: just under needs no next chunk, just over does', () => {
    const last = (now: number) => chunksNeeded(ahead, now).slice(-1)[0];
    expect(last(B - 8 * 24 * H - 1)).toBe(1597);
    expect(last(B - 8 * 24 * H)).toBe(1598);
  });

  const base = (): Series => {
    const n = 2 * meta.chunk_time_length;
    const fill = (v: number) => new Array<number>(n).fill(v);
    return {
      start: stepTime(meta, 1597, 0),
      step: meta.temporal_resolution_seconds,
      temperature_2m: fill(10),
      temperature_2m_max: fill(11),
      temperature_2m_min: fill(9),
      precipitation: fill(0),
      cloud_cover: fill(50),
    };
  };
  const now = Date.UTC(2026, 10, 16, 12) / 1000;
  const idx = (s: Series, ms: number) => (ms / 1000 - s.start) / s.step;

  it('a day with full temperatures but only five rain steps is left out', () => {
    const s = base();
    // UTC zone: the 18th holds stamps 03:00 .. 24:00 for rain. Blank four.
    for (const h of [3, 6, 9, 12])
      s.precipitation[idx(s, Date.UTC(2026, 10, 18, h))] = NaN;
    const days = dailyForecast(s, 'UTC', now).map((d) => d.date);
    expect(days).toEqual(['2026-11-16', '2026-11-17']);
  });

  it('a negative precipitation value is never subtracted from the sum', () => {
    const s = base();
    s.precipitation[idx(s, Date.UTC(2026, 10, 16, 6))] = 2;
    s.precipitation[idx(s, Date.UTC(2026, 10, 16, 9))] = -1.5;
    expect(dailyForecast(s, 'UTC', now)[0].precipMm).toBe(2);
  });
});

// 🔴 THE TWO PROMISES THE CARD MADE ABOUT WHERE THIS CODE MAY GO.
describe('where the forecast code may reach', () => {
  const dir = __dirname;
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

  it('read the right files', () => {
    expect(sources.map(([f]) => f)).toEqual(
      expect.arrayContaining(['bucket.ts', 'forecast.ts', 'cache.ts']),
    );
  });

  it('no source file names an Open-Meteo API host', () => {
    // Comments explain why the API is NOT used and may name it; code may not.
    for (const [f, src] of sources) {
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !/^\s*\/\//.test(l))
        .join('\n');
      expect(
        // Every host-shaped piece of every token, matched exactly (CodeQL:
        // js/regex/missing-regexp-anchor, js/incomplete-url-substring-sanitization).
        `${f}: ${code
          .split(/[^\w./:-]+/)
          .filter((t) => t.split('/').some((h) => h === 'open-meteo.com' || h.endsWith('.open-meteo.com')))}`,
      ).toBe(`${f}: `);
    }
  });

  it('the only host the code names is the public bucket', () => {
    const hosts = new Set<string>();
    for (const [, src] of sources) {
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const m of code.matchAll(/https?:\/\/([\w.-]+)/g)) hosts.add(m[1]);
    }
    expect([...hosts]).toEqual(['openmeteo.s3.amazonaws.com']);
  });

  it('the GPL-2.0 reader stays on the server: the web workspace does not depend on it', () => {
    const web = JSON.parse(
      readFileSync(join(__dirname, '../../../web/package.json'), 'utf8'),
    ) as Record<string, Record<string, string> | undefined>;
    const all = { ...web.dependencies, ...web.devDependencies };
    expect(Object.keys(all).filter((k) => k.startsWith('@openmeteo'))).toEqual(
      [],
    );
    // And nothing under web/src imports it.
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory()
          ? walk(p)
          : /\.(tsx?|mjs)$/.test(n)
            ? [p]
            : [];
      });
    const web_src = walk(join(__dirname, '../../../web/src'));
    expect(web_src.length).toBeGreaterThan(100);
    expect(
      web_src.filter((p) => readFileSync(p, 'utf8').includes('@openmeteo')),
    ).toEqual([]);
  });
});
