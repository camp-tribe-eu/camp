import {
  UpstreamUnavailable,
  fetchUpstream,
  upstreamVerdict,
} from './upstream';

// CAMP-440: what the shared loop adds over the one that lived in
// bathing/fetch.ts — request options that are fresh per attempt (the
// air importer sends a timeout signal and a POST body), a named source,
// and a threshold that each importer must state. The behaviour the two
// importers share is pinned by their own specs (bathing/fetch.spec.ts,
// bathing/upstream.spec.ts, air/upstream.spec.ts), which import from
// here through them.
//
// 🔴 MUTATIONS. Each test below went red on the mutation named above it.

const noSleep = async () => undefined;
const quiet = () => undefined;

describe('fetchUpstream: request options', () => {
  // mutation: call `opts.init()` once outside the loop → red (1 init, not 3)
  it('🔴 an init FUNCTION is called afresh for every attempt — a spent timeout signal must not be reused', async () => {
    let inits = 0;
    const seen: RequestInit[] = [];
    const f = (async (_url: string, init?: RequestInit) => {
      seen.push(init!);
      return { ok: false, status: 503 } as Response;
    }) as unknown as typeof fetch;
    await expect(
      fetchUpstream(f, 'u', 'thing', {
        sleep: noSleep,
        log: quiet,
        init: () => ({ method: 'POST', headers: { n: String(++inits) } }),
      }),
    ).rejects.toThrow(UpstreamUnavailable);
    expect(inits).toBe(3);
    expect(seen.map((i) => (i.headers as Record<string, string>).n)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('an init OBJECT is passed through as it is', async () => {
    let got: RequestInit | undefined;
    const f = (async (_url: string, init?: RequestInit) => {
      got = init;
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    await fetchUpstream(f, 'u', 'thing', { init: { method: 'POST' } });
    expect(got).toEqual({ method: 'POST' });
  });

  it('without init, fetch is called with the url alone', async () => {
    let args = -1;
    const f = (async (...a: unknown[]) => {
      args = a.length;
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    await fetchUpstream(f, 'u', 'thing');
    expect(args).toBe(1);
  });
});

describe('fetchUpstream: naming', () => {
  // mutation: drop `source` from the message → red
  it('🔴 names the source the caller gave, so the journal says WHOSE server', async () => {
    const f = (async () =>
      ({ ok: false, status: 500 }) as Response) as unknown as typeof fetch;
    await expect(
      fetchUpstream(f, 'u', 'the roster index', {
        sleep: noSleep,
        log: quiet,
        source: 'the EEA air-quality blob store',
      }),
    ).rejects.toThrow(
      /^the EEA air-quality blob store is unavailable: the roster index answered HTTP 500 on all 3 attempts/,
    );
  });

  it('falls back to "the source" when none is given', async () => {
    const f = (async () =>
      ({ ok: false, status: 502 }) as Response) as unknown as typeof fetch;
    await expect(
      fetchUpstream(f, 'u', 'x', { sleep: noSleep, log: quiet }),
    ).rejects.toThrow(/^the source is unavailable: x answered HTTP 502/);
  });

  // 🔴 A timeout is a transport failure — the source did not answer in
  // time — and must be retried and tolerated like an unreachable host,
  // not fail the unit as a bug of ours.
  it("🔴 our own timeout (fetch rejects) is 'unreachable': retried, then the source's fault", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      throw Object.assign(
        new Error('The operation was aborted due to timeout'),
        {
          name: 'TimeoutError',
        },
      );
    }) as unknown as typeof fetch;
    const log: string[] = [];
    await expect(
      fetchUpstream(f, 'u', 'x', { sleep: noSleep, log: (l) => log.push(l) }),
    ).rejects.toThrow(
      /unreachable \(The operation was aborted due to timeout\)/,
    );
    expect(calls).toBe(3);
    expect(log).toHaveLength(3);
  });
});

describe('upstreamVerdict with an explicit threshold', () => {
  // mutation: `streak % every === 0` → `streak >= every` → red on 3
  it('🔴 every 2: the second, fourth, sixth fail; the odd ones do not', () => {
    expect(
      [1, 2, 3, 4, 5, 6].map((n) => upstreamVerdict(n, 2).failUnit),
    ).toEqual([false, true, false, true, false, true]);
    expect(upstreamVerdict(1, 2).say).toMatch(
      /1 upstream failure\(s\).*NOT failing.*1 more/,
    );
    expect(upstreamVerdict(2, 2).say).toMatch(
      /2 upstream failures in a row — failing/,
    );
  });

  it('every 1 is the old behaviour: every failure fails', () => {
    expect(upstreamVerdict(1, 1).failUnit).toBe(true);
    expect(upstreamVerdict(2, 1).failUnit).toBe(true);
  });

  // mutation: drop the `every` guard → `upstreamVerdict(1, 0)` divides by
  // zero into NaN and returns failUnit false forever → red
  it('🔴 refuses a threshold that is not a count of runs', () => {
    expect(() => upstreamVerdict(1, 0)).toThrow(/"every" is a count of runs/);
    expect(() => upstreamVerdict(1, 1.5)).toThrow(/"every" is a count of runs/);
    expect(() => upstreamVerdict(1, undefined as unknown as number)).toThrow(
      /"every" is a count of runs/,
    );
  });
});
