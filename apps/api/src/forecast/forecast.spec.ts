import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import {
  type BucketMeta,
  type ChunkRead,
  type Series,
  BOX,
  GRID,
  VARIABLES,
  cellOf,
  chunksNeeded,
  conditionOf,
  dailyForecast,
  joinChunks,
  parseQuery,
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

// 🔴 These tables were computed by a SEPARATE implementation (Python,
// zoneinfo, straight off the fixture JSON), not copied from this code's
// output: a stub that follows the code's formula would confirm its bug.
const VENDEE = [
  ['2026-11-16', 16, 13, 19.9, 'heavy-rain'],
  ['2026-11-17', 16, 14, 22.2, 'heavy-rain'],
  ['2026-11-18', 15, 13, 13.4, 'heavy-rain'],
  ['2026-11-19', 14, 11, 10.5, 'heavy-rain'],
  ['2026-11-20', 14, 11, 7.6, 'rain'],
  ['2026-11-21', 12, 7, 1.5, 'rain'],
  ['2026-11-22', 14, 11, 11, 'heavy-rain'],
] as const;
const FINLAND = [
  ['2026-11-16', 6, 4, 7.8, 'rain'],
  ['2026-11-17', 5, 2, 21.3, 'heavy-rain'],
  ['2026-11-18', 5, 2, 3.9, 'rain'],
  ['2026-11-19', 3, 1, 6.4, 'rain'],
  ['2026-11-20', 2, 0, 0.2, 'cloudy'],
  ['2026-11-21', 0, -2, 1, 'snow'],
  ['2026-11-22', 1, 0, 2.6, 'snow'],
] as const;
const asDays = (
  t: ReadonlyArray<readonly [string, number, number, number, string]>,
) =>
  t.map(([date, tMax, tMin, precipMm, condition]) => ({
    date,
    tMax,
    tMin,
    precipMm,
    condition,
  }));

describe('dailyForecast on real bucket reads', () => {
  it('Vendée, Europe/Paris: seven days equal the independent table', () => {
    const f = load('vendee');
    expect(dailyForecast(seriesOf(f), 'Europe/Paris', f.nowSec)).toEqual(
      asDays(VENDEE),
    );
  });

  it('Finland, Europe/Helsinki: seven days equal the independent table', () => {
    const f = load('finland');
    expect(dailyForecast(seriesOf(f), 'Europe/Helsinki', f.nowSec)).toEqual(
      asDays(FINLAND),
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
    expect(days).not.toContain('2026-11-18');
    expect(days).toContain('2026-11-17');
    expect(days).toContain('2026-11-19');
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

describe('parseQuery', () => {
  it('accepts a campsite and lower-cases the country', () => {
    expect(parseQuery({ lat: '46.6', lng: '-1.8', country: 'FR' })).toEqual({
      lat: 46.6,
      lon: -1.8,
      country: 'fr',
    });
  });

  it.each([
    [{ lat: '0', lng: '0', country: 'fr' }, 'the Gulf of Guinea'],
    [{ lat: '40', lng: '-74', country: 'es' }, 'New York'],
    [{ lat: '51', lng: '0', country: 'gb' }, 'a non-member'],
    [{ lat: 'abc', lng: '1', country: 'fr' }, 'not a number'],
    [{ lat: '46.6', lng: '1e1', country: 'fr' }, 'exponent notation'],
    [{ lat: '46.6', lng: '-1.8' }, 'no country'],
    [{ lat: '46.6', country: 'fr' }, 'no longitude'],
    [{ lat: '46.1234567', lng: '1', country: 'fr' }, 'seven decimals'],
  ] as Array<[{ lat?: string; lng?: string; country?: string }, string]>)(
    '%j is refused (%s)',
    (q) => {
      expect(parseQuery(q)).toBeNull();
    },
  );

  it('the box holds the outermost EU points', () => {
    for (const [lat, lng, c] of [
      [28.1, -15.4, 'es'], // Canaries
      [38.7, -27.2, 'pt'], // Azores
      [35.0, 34.1, 'cy'], // Cyprus
      [70.1, 27.9, 'fi'], // northern Finland
      [35.9, 14.4, 'mt'],
    ] as const) {
      expect(
        parseQuery({ lat: String(lat), lng: String(lng), country: c }),
      ).not.toBeNull();
    }
    expect(BOX.latMin).toBeLessThan(27.6);
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
        `${f}: ${code.match(/[\w.-]*open-meteo\.com[\w./-]*/g) ?? []}`,
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
