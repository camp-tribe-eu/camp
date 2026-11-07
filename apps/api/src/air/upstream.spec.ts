import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UpstreamUnavailable,
  readStreak,
  recordFailure,
} from '../shared/upstream';
import { ESCALATE_EVERY, failsTheUnit, run, type DbLike } from './import';
import {
  AIR_FRESH_FOR_HOURS,
  AIR_RASTER_URL,
  AIR_ROSTER_INDEX_URL,
  airRosterUrl,
} from './source';

// CAMP-440: measured 04.11.2026 18:25 UTC — air.discomap.eea.europa.eu
// answered HTTP 500 on the raster's `?f=json`, the import exited 1 and
// the owner got a letter about the EEA's server. The source being down
// is told apart from our collector being broken BY TYPE, counted in
// $STATE_DIRECTORY, and fails the unit only on every ESCALATE_EVERY-th
// consecutive run — a number derived from THIS timer's cadence, not
// copied from the weekly bathing importer.
//
// 🔴 MUTATIONS. Each test below went red on the mutation named above it.

const INFRA = join(__dirname, '../../../../infra/systemd');
const noSleep = async () => undefined;

/** The hour the fake raster holds; `now` sits inside it. */
const NOW = new Date('2026-11-05T12:30:00Z');
const WINDOW_OK = {
  timeInfo: {
    timeExtent: [
      Date.parse('2026-11-04T00:00:00Z'),
      Date.parse('2026-11-06T00:00:00Z'),
    ],
  },
  maxValues: [6],
};
/** The 03.11.2026 situation (CAMP-439): the raster stopped on 28.10. */
const WINDOW_STALE = {
  timeInfo: {
    timeExtent: [
      Date.parse('2026-10-25T00:00:00Z'),
      Date.parse('2026-10-28T12:00:00Z'),
    ],
  },
  maxValues: [6],
};
const ROSTER_FILE = 'raw_stations.json.26110500';
const STATION = {
  code: 'DEBB021',
  name: 'Berlin Neukölln',
  operational: 1,
  lon: 13.4386,
  lat: 52.4895,
  station_type: 'Background',
  area_classification: 'Urban',
  municipality: 'Berlin',
};

function res(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return {
    ok: status < 400,
    status,
    text: async () => text,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

/**
 * The EEA, scripted: `raster` is the sequence of answers to the raster's
 * description (a status, or a body for 200), repeated at its last entry;
 * `index` the same for the roster index. Everything else answers well,
 * and every station file is a 404 (the reading is cleared, not kept).
 */
function eea(
  script: { raster?: (number | object)[]; index?: (number | object)[] } = {},
) {
  const raster = [...(script.raster ?? [WINDOW_OK])];
  const index = [...(script.index ?? [{ contents: [ROSTER_FILE] }])];
  const next = (q: (number | object)[]) => (q.length > 1 ? q.shift()! : q[0]);
  const answer = (a: number | object) =>
    typeof a === 'number' ? res('', a) : res(a);
  const calls = { raster: 0, index: 0, samples: 0 };
  const f = (async (url: string) => {
    if (url === AIR_ROSTER_INDEX_URL) {
      calls.index++;
      return answer(next(index));
    }
    if (url === airRosterUrl(ROSTER_FILE)) return res([STATION]);
    if (url === `${AIR_RASTER_URL}?f=json`) {
      calls.raster++;
      return answer(next(raster));
    }
    if (url === `${AIR_RASTER_URL}/getSamples`) {
      calls.samples++;
      return res({ samples: [] });
    }
    return res('', 404); // a station file
  }) as unknown as typeof fetch;
  return Object.assign(f, { calls });
}

/** A database that answers what the import asks and remembers the SQL. */
function fakeDb() {
  const sql: string[] = [];
  const db = {
    connect: async () => undefined,
    end: async () => undefined,
    query: async (text: string) => {
      sql.push(text);
      if (text.includes('count(*)')) return { rows: [{ n: '0' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  } as unknown as DbLike;
  return Object.assign(db, { sql });
}

let dir: string;
let out: string[];
let logSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'camp440-air-'));
  out = [];
  logSpy = jest.spyOn(console, 'log').mockImplementation((...a) => {
    out.push(a.join(' '));
  });
  errSpy = jest.spyOn(console, 'error').mockImplementation((...a) => {
    out.push(a.join(' '));
  });
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

const env = (over: Record<string, string | undefined> = {}) => ({
  STATE_DIRECTORY: dir,
  DATABASE_URL: 'postgres://nobody@127.0.0.1:1/nowhere',
  ...over,
});

function deps(fetchImpl: typeof fetch, db: DbLike = fakeDb(), e = env()) {
  return { fetchImpl, sleep: noSleep, env: e, openDb: () => db, now: NOW };
}

describe('ESCALATE_EVERY is derived from the cadence, not copied', () => {
  const timer = readFileSync(
    join(INFRA, 'camptribe-air-quality.timer'),
    'utf8',
  );
  const period = Number(
    /^OnCalendar=\*-\*-\* 00\/(\d+):\d\d:\d\d UTC$/m.exec(timer)?.[1],
  );

  // mutation: ESCALATE_EVERY = 3 (bathing's number) → red
  it('🔴 is the first run that KNOWS the freshness budget is gone: the smallest N with N × period > budget', () => {
    expect(period).toBe(3); // every three hours, read from the timer
    expect(AIR_FRESH_FOR_HOURS).toBe(4);
    const smallest = Math.floor(AIR_FRESH_FOR_HOURS / period) + 1;
    expect(ESCALATE_EVERY).toBe(smallest);
    expect(ESCALATE_EVERY).toBe(2);
    // in hours: a one-off outage is tolerated, a 6-hour one is not
    expect((ESCALATE_EVERY - 1) * period).toBeLessThanOrEqual(
      AIR_FRESH_FOR_HOURS,
    );
    expect(ESCALATE_EVERY * period).toBeGreaterThan(AIR_FRESH_FOR_HOURS);
  });
});

describe('failsTheUnit', () => {
  it('🔴 the source being down does not fail the unit on the spot — the streak decides', () => {
    expect(failsTheUnit(new UpstreamUnavailable('x'))).toBe(false);
  });
});

describe('run() while the EEA is down', () => {
  // mutation: `if (failsTheUnit(modelledError)) code = 1` → `if (true)` → red
  it("🔴 the raster's description 500 on all attempts: words about the source, exit 0 once, exit 1 the second time", async () => {
    const db = fakeDb();
    expect(await run(['--apply'], deps(eea({ raster: [500] }), db))).toBe(0);
    expect(readStreak(dir)).toBe(1);
    expect(await run(['--apply'], deps(eea({ raster: [500] }), fakeDb()))).toBe(
      1,
    );
    expect(readStreak(dir)).toBe(2);
    const journal = out.join('\n');
    expect(journal).toMatch(
      /the EEA ArcGIS server is unavailable: the raster's description answered HTTP 500 on all 3 attempts/,
    );
    expect(journal).toMatch(/the source, not this import/);
    expect(journal).toMatch(
      /the stations are in and committed; only the raster could not be read/,
    );
    expect(journal).toMatch(
      /1 upstream failure\(s\) in a row — NOT failing the unit; 1 more/,
    );
    expect(journal).toMatch(/2 upstream failures in a row — failing the unit/);
    expect(journal).not.toMatch(
      /\bat (fetchUpstream|getJsonFromSource|rasterWindow)\b/,
    ); // words, not a stack
    expect(db.sql).toContain('COMMIT'); // the stations were kept
    expect(db.sql).toContain('ROLLBACK TO SAVEPOINT stations_done');
  });

  // mutation: `if (upstreamFailsTheUnit(err)) throw err` → `if (true)` → red
  it('🔴 the roster index 500 on all attempts: tolerated before the database is even opened', async () => {
    const never: DbLike = {
      connect: async () => {
        throw new Error(
          'the database must not be opened when there is no roster',
        );
      },
    } as unknown as DbLike;
    expect(await run(['--apply'], deps(eea({ index: [500] }), never))).toBe(0);
    expect(readStreak(dir)).toBe(1);
    const journal = out.join('\n');
    expect(journal).toMatch(
      /the EEA air-quality blob store is unavailable: the roster index answered HTTP 500 on all 3 attempts/,
    );
    expect(journal).toMatch(/no row was parsed and no table was touched/);
  });

  // mutation: `attempts` loop `i <= 1` → red (no second attempt, run fails)
  it('🔴 500 then 200: the run succeeds, the failed attempt is in the journal, the raster was asked twice', async () => {
    const f = eea({ raster: [500, WINDOW_OK] });
    const slept: number[] = [];
    expect(
      await run(['--apply'], {
        ...deps(f),
        sleep: async (ms) => {
          slept.push(ms);
        },
      }),
    ).toBe(0);
    const journal = out.join('\n');
    expect(journal).toMatch(
      /the raster's description: attempt 1 of 3 — HTTP 500, waiting 30 s/,
    );
    expect(journal).not.toMatch(/attempt 2 of 3/); // the second answered 200: not a failure
    expect(journal).toMatch(/campsites with no station in 15 km\s+0/);
    expect(journal).toMatch(/✓ committed/);
    expect(journal).not.toMatch(/NOT refreshed/);
    expect(f.calls.raster).toBe(2);
    expect(slept).toEqual([30_000]);
    expect(readStreak(dir)).toBe(0);
  });

  // 🔴 THE REVERSE. mutation: catch everything → red
  it('🔴 a bug in OUR raster reader still fails loudly, even while the source answers 200', async () => {
    const wrongProduct = { ...WINDOW_OK, maxValues: [5] };
    expect(await run(['--apply'], deps(eea({ raster: [wrongProduct] })))).toBe(
      1,
    );
    expect(out.join('\n')).toMatch(/reports maxValues \[5\], not \[6\]/);
    expect(readStreak(dir)).toBe(0); // not counted as the source's fault
  });

  it('🔴 a roster that is not a list is OURS and throws, with nothing counted', async () => {
    const f = eea();
    const liar = (async (url: string) =>
      url === airRosterUrl(ROSTER_FILE)
        ? res({ not: 'a list' })
        : f(url)) as unknown as typeof fetch;
    await expect(run(['--apply'], deps(liar))).rejects.toThrow(
      /not a non-empty list of stations/,
    );
    expect(readStreak(dir)).toBe(0);
  });

  it('🔴 a 404 on the raster is ours (the service moved) and fails loudly', async () => {
    expect(await run(['--apply'], deps(eea({ raster: [404] })))).toBe(1);
    expect(out.join('\n')).toMatch(/did not describe an image service: 404/);
    expect(readStreak(dir)).toBe(0);
  });

  it('🔴 a raster that stands still (CAMP-439) still does not fail the unit, and is not counted either', async () => {
    recordFailure(dir, 'yesterday');
    expect(await run(['--apply'], deps(eea({ raster: [WINDOW_STALE] })))).toBe(
      0,
    );
    const journal = out.join('\n');
    expect(journal).toMatch(
      /the raster holds 2026-10-25T00:00:00.000Z to 2026-10-28T12:00:00.000Z/,
    );
    expect(journal).toMatch(/This does NOT fail the unit/);
    expect(readStreak(dir)).toBe(0); // the source answered: the streak is over
  });

  // mutation: drop `if (!stateDir)` → red (would return 0 with nowhere to count)
  it('🔴 without a STATE_DIRECTORY there is nowhere to count, so it fails as before', async () => {
    expect(
      await run(
        ['--apply'],
        deps(
          eea({ raster: [500] }),
          fakeDb(),
          env({ STATE_DIRECTORY: undefined }),
        ),
      ),
    ).toBe(1);
    expect(out.join('\n')).toMatch(/No STATE_DIRECTORY/);
  });

  it('a dry run records nothing and exits 1 so the shell sees it', async () => {
    expect(await run([], deps(eea({ raster: [500] })))).toBe(1);
    expect(readStreak(dir)).toBe(0);
    expect(out.join('\n')).toMatch(
      /dry run — the failure streak is not recorded/,
    );
  });

  // mutation: drop `clearStreak` → red
  it('🔴 a successful run wipes the streak — but only a real run, not a dry one', async () => {
    recordFailure(dir, 'x');
    expect(await run([], deps(eea()))).toBe(0);
    expect(readStreak(dir)).toBe(1);
    expect(await run(['--apply'], deps(eea()))).toBe(0);
    expect(readStreak(dir)).toBe(0);
  });

  it('🔴 a plain Error with the words of the outage, thrown by fetch, buys nothing: it is "unreachable"', async () => {
    const f = eea();
    const liar = (async (url: string) => {
      if (url === `${AIR_RASTER_URL}?f=json`)
        throw new Error(
          'the EEA ArcGIS server is unavailable: answered HTTP 500 on all 3 attempts',
        );
      return f(url);
    }) as unknown as typeof fetch;
    expect(await run(['--apply'], deps(liar))).toBe(0);
    expect(out.join('\n')).toMatch(
      /unreachable \(the EEA ArcGIS server is unavailable/,
    );
  });

  it('exits 2 without a DATABASE_URL, as before', async () => {
    expect(
      await run(
        ['--apply'],
        deps(eea(), fakeDb(), env({ DATABASE_URL: undefined })),
      ),
    ).toBe(2);
  });
});

// 🔴 The code above assumes a STATE_DIRECTORY; the unit is what provides
// one. Without this line the fallback is loud (exit 1 on every 5xx),
// which is the pre-CAMP-440 behaviour the card exists to end — so the
// unit file is read here, not recalled.
describe('camptribe-air-quality.service', () => {
  const unit = readFileSync(
    join(INFRA, 'camptribe-air-quality.service'),
    'utf8',
  );
  it('declares the StateDirectory the streak lives in', () => {
    expect(unit).toMatch(/^StateDirectory=camptribe-air-quality$/m);
  });
  it('still reports a failure, or the second failed run would be silent too', () => {
    expect(unit).toMatch(/^OnFailure=camptribe-failed@%n\.service$/m);
  });
});
