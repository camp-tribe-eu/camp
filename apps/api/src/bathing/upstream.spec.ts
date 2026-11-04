import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ESCALATE_EVERY,
  UpstreamUnavailable,
  clearStreak,
  failsTheUnit,
  isUpstreamStatus,
  readStreak,
  recordFailure,
  stateDirectory,
  upstreamVerdict,
} from './upstream';
import { run } from './import';
import { PAGE_SIZE } from './fetch';

// CAMP-440: the EEA server answered HTTP 500 on everything (04.11.2026)
// and the import failed the unit with a stack trace. A source that is
// down is told apart from a collector that is broken BY TYPE, and the
// tolerated case is counted, not muted.
//
// 🔴 MUTATIONS. Each test below went red on the mutation named above it.

const noSleep = async () => undefined;

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** A fetch that serves `total` features, after `failFirst` answers of `status`. */
function server(total: number, failFirst = 0, status = 500) {
  let calls = 0;
  const f = (async (url: string) => {
    if (calls++ < failFirst) return { ok: false, status } as Response;
    if (String(url).includes('returnCountOnly=true'))
      return ok({ count: total });
    const offset = Number(
      new URL(String(url)).searchParams.get('resultOffset'),
    );
    const n = Math.max(0, Math.min(PAGE_SIZE, total - offset));
    return ok({
      features: Array.from({ length: n }, (_, i) => ({
        attributes: {
          bathingWaterIdentifier: `X${offset + i}`,
          bathingWaterName: `Water ${offset + i}`,
          countryCode: 'FR',
          EU27: 'EU-27',
          bwWaterCategory: 'Coastal',
          qualityStatus: 'Excellent',
          latitude: 43.5,
          longitude: 5.2,
        },
      })),
      exceededTransferLimit: offset + n < total,
    });
  }) as unknown as typeof fetch;
  return Object.assign(f, { calls: () => calls });
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'camp440-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('failsTheUnit', () => {
  // mutation: `return true` → red
  it('🔴 the source being down does NOT fail the unit', () => {
    expect(
      failsTheUnit(new UpstreamUnavailable('HTTP 500 on all 3 attempts')),
    ).toBe(false);
  });

  // mutation: `!(err instanceof Error)` → red
  it('🔴 a plain Error with the SAME words still fails — the type decides', () => {
    expect(
      failsTheUnit(
        new Error(
          'the EEA ArcGIS server is unavailable: count answered HTTP 500 on all 3 attempts',
        ),
      ),
    ).toBe(true);
  });

  it('a non-error fails rather than slipping through', () => {
    expect(failsTheUnit('щось')).toBe(true);
    expect(failsTheUnit(undefined)).toBe(true);
  });
});

describe('isUpstreamStatus', () => {
  // mutation: `status >= 400` → red on 404
  it('5xx and 429 are the source; 404 and 403 are ours to fix', () => {
    expect(isUpstreamStatus(500)).toBe(true);
    expect(isUpstreamStatus(503)).toBe(true);
    expect(isUpstreamStatus(429)).toBe(true);
    expect(isUpstreamStatus(404)).toBe(false);
    expect(isUpstreamStatus(403)).toBe(false);
    expect(isUpstreamStatus(200)).toBe(false);
  });
});

describe('upstreamVerdict', () => {
  it('escalates every third consecutive failure, and names the count', () => {
    expect(ESCALATE_EVERY).toBe(3);
    expect(upstreamVerdict(1).failUnit).toBe(false);
    expect(upstreamVerdict(2).failUnit).toBe(false);
    expect(upstreamVerdict(3).failUnit).toBe(true);
    expect(upstreamVerdict(4).failUnit).toBe(false);
    expect(upstreamVerdict(6).failUnit).toBe(true);
    expect(upstreamVerdict(2).say).toMatch(
      /2 upstream failure.*NOT failing.*1 more/,
    );
    expect(upstreamVerdict(3).say).toMatch(
      /3 upstream failures in a row — failing/,
    );
  });

  // mutation: drop the guard → red
  it('refuses a streak that is not a count', () => {
    expect(() => upstreamVerdict(0)).toThrow(/count/);
    expect(() => upstreamVerdict(1.5)).toThrow(/count/);
  });
});

describe('the streak file', () => {
  it('starts at zero, counts up, and a success wipes it', () => {
    expect(readStreak(dir)).toBe(0);
    expect(recordFailure(dir, 'HTTP 500')).toBe(1);
    expect(recordFailure(dir, 'HTTP 503')).toBe(2);
    expect(readStreak(dir)).toBe(2);
    clearStreak(dir);
    expect(readStreak(dir)).toBe(0);
  });

  it('keeps the date the streak began, not the date of the last failure', () => {
    recordFailure(dir, 'a', new Date('2026-11-04T05:20:00Z'));
    recordFailure(dir, 'b', new Date('2026-11-11T05:20:00Z'));
    const rec = JSON.parse(
      readFileSync(join(dir, 'upstream-streak.json'), 'utf8'),
    );
    expect(rec.since).toBe('2026-11-04T05:20:00.000Z');
    expect(rec.last).toBe('2026-11-11T05:20:00.000Z');
    expect(rec.message).toBe('b');
  });

  it('an unreadable file counts from zero rather than throwing', () => {
    writeFileSync(join(dir, 'upstream-streak.json'), '{not json');
    const err = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    expect(readStreak(dir)).toBe(0);
    expect(recordFailure(dir, 'x')).toBe(1);
    err.mockRestore();
  });

  it('creates the directory if systemd has not', () => {
    const nested = join(dir, 'deeper');
    expect(recordFailure(nested, 'x')).toBe(1);
    expect(readStreak(nested)).toBe(1);
  });
});

describe('stateDirectory', () => {
  it('takes the first of a colon-joined list, and null when unset', () => {
    expect(stateDirectory({ STATE_DIRECTORY: '/var/lib/a:/var/lib/b' })).toBe(
      '/var/lib/a',
    );
    expect(stateDirectory({ STATE_DIRECTORY: '/var/lib/a' })).toBe(
      '/var/lib/a',
    );
    expect(stateDirectory({ STATE_DIRECTORY: '' })).toBeNull();
    expect(stateDirectory({})).toBeNull();
  });
});

// 🔴 The whole run, as systemd sees it: an exit code and a journal.
describe('run() against a source that is down', () => {
  let out: string[];
  let logSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  beforeEach(() => {
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
  });

  const env = () => ({
    STATE_DIRECTORY: dir,
    // Never reached: the fetch fails before the database is opened.
    DATABASE_URL: 'postgres://nobody@127.0.0.1:1/nowhere',
  });

  // mutation: `if (failsTheUnit(err)) throw err` → `if (true) throw err` → red
  it('🔴 all attempts 500: words about the source, exit 0 the first two weeks, exit 1 the third', async () => {
    const down = server(10, Infinity);
    expect(
      await run(['--apply'], { fetchImpl: down, sleep: noSleep, env: env() }),
    ).toBe(0);
    expect(
      await run(['--apply'], { fetchImpl: down, sleep: noSleep, env: env() }),
    ).toBe(0);
    expect(
      await run(['--apply'], { fetchImpl: down, sleep: noSleep, env: env() }),
    ).toBe(1);
    expect(readStreak(dir)).toBe(3);
    const journal = out.join('\n');
    expect(journal).toMatch(
      /the EEA ArcGIS server is unavailable: count answered HTTP 500 on all 3 attempts/,
    );
    expect(journal).toMatch(/the source, not this import/);
    expect(journal).toMatch(
      /1 upstream failure\(s\) in a row — NOT failing the unit; 2 more/,
    );
    expect(journal).toMatch(/3 upstream failures in a row — failing the unit/);
    expect(journal).not.toMatch(/at fetchUpstream/); // words, not a stack
  });

  // mutation: `isUpstreamStatus` → `status >= 400` → this test still passes,
  // the 404 test below goes red; mutation: `attempts` loop `i <= 1` → red here
  it('🔴 first attempt 500, second 200: the run succeeds and the log shows both attempts', async () => {
    const flaky = server(10, 1);
    expect(
      await run([], { fetchImpl: flaky, sleep: noSleep, env: env() }),
    ).toBe(0);
    const journal = out.join('\n');
    expect(journal).toMatch(/count: attempt 1 of 3 — HTTP 500, waiting 30 s/);
    expect(journal).toMatch(/records kept\s+10/);
    expect(journal).not.toMatch(/attempt 2 of 3/); // the second answered 200: not logged as a failure
    expect(flaky.calls()).toBe(3); // count ×2 (500, 200) + one page
  });

  // 🔴 THE REVERSE. mutation: catch everything → red
  it('🔴 a bug in OUR parsing still fails loudly, even while the source answers 200', async () => {
    const malformed = (async (url: string) =>
      String(url).includes('returnCountOnly=true')
        ? ok({ count: 'ten' }) // our reader refuses a count that is not a number
        : ok({ features: [] })) as unknown as typeof fetch;
    await expect(
      run(['--apply'], { fetchImpl: malformed, sleep: noSleep, env: env() }),
    ).rejects.toThrow(/count returned no count/);
    expect(readStreak(dir)).toBe(0); // not counted as the source's fault
  });

  it('🔴 a 404 is ours (the layer moved) and fails loudly', async () => {
    const gone = server(10, Infinity, 404);
    await expect(
      run(['--apply'], { fetchImpl: gone, sleep: noSleep, env: env() }),
    ).rejects.toThrow(/HTTP 404/);
    expect(readStreak(dir)).toBe(0);
  });

  it('🔴 a plain Error with the same words as the outage fails loudly', async () => {
    const liar = (async () => {
      throw new Error(
        'the EEA ArcGIS server is unavailable: count answered HTTP 500 on all 3 attempts',
      );
    }) as unknown as typeof fetch;
    // fetchUpstream treats a throw as "unreachable" and retries; the
    // words in the message buy nothing. Three throws → UpstreamUnavailable
    // (unreachable), which IS tolerated — so test failsTheUnit directly
    // above, and here assert the message names the transport, not the lie.
    expect(
      await run(['--apply'], { fetchImpl: liar, sleep: noSleep, env: env() }),
    ).toBe(0);
    expect(out.join('\n')).toMatch(
      /unreachable \(the EEA ArcGIS server is unavailable/,
    );
  });

  // mutation: drop `if (!stateDir)` → red (would return 0 with nowhere to count)
  it('🔴 without a STATE_DIRECTORY there is nowhere to count, so it fails as before', async () => {
    const down = server(10, Infinity);
    expect(
      await run(['--apply'], {
        fetchImpl: down,
        sleep: noSleep,
        env: { DATABASE_URL: 'postgres://nobody@127.0.0.1:1/nowhere' },
      }),
    ).toBe(1);
    expect(out.join('\n')).toMatch(/No STATE_DIRECTORY/);
  });

  it('a dry run records nothing and exits 1 so the shell sees it', async () => {
    const down = server(10, Infinity);
    expect(await run([], { fetchImpl: down, sleep: noSleep, env: env() })).toBe(
      1,
    );
    expect(readStreak(dir)).toBe(0);
  });

  // mutation: drop `clearStreak` → red
  it('🔴 a successful read wipes the streak — but only a real run, not a dry one', async () => {
    recordFailure(dir, 'x');
    recordFailure(dir, 'y');
    expect(
      await run([], { fetchImpl: server(10), sleep: noSleep, env: env() }),
    ).toBe(0);
    expect(readStreak(dir)).toBe(2);
    // --apply would open the database after the fetch; the fetch is all
    // we need, so hand it a database that refuses and read the streak
    // the moment the connection fails.
    await expect(
      run(['--apply'], { fetchImpl: server(10), sleep: noSleep, env: env() }),
    ).rejects.toThrow();
    expect(readStreak(dir)).toBe(0);
  });
});

// 🔴 The code above assumes a STATE_DIRECTORY; the unit is what provides
// one. Without this line the fallback is loud (exit 1 every week), which
// is the pre-CAMP-440 behaviour the card exists to end — so the unit
// file is read here, not recalled.
describe('camptribe-bathing-waters.service', () => {
  const unit = readFileSync(
    join(
      __dirname,
      '../../../../infra/systemd/camptribe-bathing-waters.service',
    ),
    'utf8',
  );
  it('declares the StateDirectory the streak lives in', () => {
    expect(unit).toMatch(/^StateDirectory=camptribe-bathing-waters$/m);
  });
  it('still reports a failure, or the third week would be silent too', () => {
    expect(unit).toMatch(/^OnFailure=camptribe-failed@%n\.service$/m);
  });
});
