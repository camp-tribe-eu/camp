import { randomBytes } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { MEASURES } from './data-quality';
import { DataQualityController } from './data-quality.controller';
import { CACHE_MS, DataQualityService } from './data-quality.service';

// CAMP-522 — the endpoint: who gets the report, and how often the
// database is asked for it. The numbers themselves are
// data-quality.db.spec.ts; here the database is a counter.

// 🔴 Made up per run, never written down: a literal here is a string
// shaped like a credential in a public repository, and the secret scan
// is right to refuse it.
const TOKEN = randomBytes(18).toString('hex');

function fakeDb(opts: { failConnect?: () => boolean } = {}) {
  const calls = { connects: 0, releases: 0, measures: 0, runs: 0 };
  const db = {
    createQueryRunner: () => ({
      connect: async () => {
        calls.connects += 1;
        if (opts.failConnect?.()) throw new Error('the database is down');
      },
      release: async () => {
        calls.releases += 1;
      },
      query: async (sql: string) => {
        if (sql.startsWith('BEGIN')) calls.runs += 1;
        if (sql.includes('current_database()')) {
          return [{ at: `2026-01-01T00:00:0${calls.runs}Z`, db: 'fake' }];
        }
        if (/^(WITH|SELECT)/.test(sql)) {
          calls.measures += 1;
          return [{ label: null, n: '1', of: '2' }];
        }
        return [];
      },
    }),
  } as unknown as DataSource;
  return { db, calls };
}

let before: string | undefined;
beforeEach(() => {
  before = process.env.API_BUILD_TOKEN;
  process.env.API_BUILD_TOKEN = TOKEN;
});
afterEach(() => {
  if (before === undefined) delete process.env.API_BUILD_TOKEN;
  else process.env.API_BUILD_TOKEN = before;
});

describe('GET /ops/data-quality', () => {
  it('🔴 answers a caller without the token 404 and asks the database nothing', async () => {
    const { db, calls } = fakeDb();
    const controller = new DataQualityController(new DataQualityService(db));
    await expect(controller.get(undefined)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(controller.get('wrong')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(calls).toEqual({ connects: 0, releases: 0, measures: 0, runs: 0 });
  });

  it('🔴 answers nobody when the API has no token configured', async () => {
    delete process.env.API_BUILD_TOKEN;
    const { db, calls } = fakeDb();
    const controller = new DataQualityController(new DataQualityService(db));
    await expect(controller.get('')).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.get(undefined)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(calls.connects).toBe(0);
  });

  it('gives the caller with the token every measure, on one connection it gives back', async () => {
    const { db, calls } = fakeDb();
    const controller = new DataQualityController(new DataQualityService(db));
    const report = await controller.get(TOKEN);
    expect(report.database).toBe('fake');
    expect(report.lines.map((l) => l.key)).toEqual(MEASURES.map((m) => m.key));
    expect(calls).toEqual({
      connects: 1,
      releases: 1,
      measures: MEASURES.length,
      runs: 1,
    });
  });
});

describe('how often the database is asked', () => {
  it('once per CACHE_MS, however many callers', async () => {
    const { db, calls } = fakeDb();
    const service = new DataQualityService(db);
    const first = await service.report(1_000);
    expect(await service.report(1_000 + CACHE_MS - 1)).toBe(first);
    expect(calls.runs).toBe(1);
    const second = await service.report(1_000 + CACHE_MS);
    expect(calls.runs).toBe(2);
    expect(second.measuredAt).not.toBe(first.measuredAt);
  });

  it('once for callers that arrive while it is being measured', async () => {
    const { db, calls } = fakeDb();
    const service = new DataQualityService(db);
    const [a, b, c] = await Promise.all([
      service.report(5),
      service.report(5),
      service.report(5),
    ]);
    expect(calls.runs).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('🔴 again after a failure: a failure is not kept for ten minutes', async () => {
    let down = true;
    const { db, calls } = fakeDb({ failConnect: () => down });
    const service = new DataQualityService(db);
    await expect(service.report(10)).rejects.toThrow('the database is down');
    // the connection is given back even though it never worked
    expect(calls.releases).toBe(1);
    down = false;
    const report = await service.report(11);
    expect(report.database).toBe('fake');
    expect(calls.connects).toBe(2);
  });
});
