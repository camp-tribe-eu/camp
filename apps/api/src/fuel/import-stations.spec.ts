import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import {
  DELETE_REFRESHED_SQL,
  gatherSources,
  KNOWN_FLAGS,
  requireOneSource,
  unknownArgs,
  whyFailed,
} from './import-stations';
import type { ParseResult } from './stations';

// CAMP-154 / refresh-timers: one source's bad day costs that source.
//
// Measured 28.10.2026 from the production machine: www.mimit.gov.it did
// not answer a TCP connection, and the importer — which let the first
// failure escape — would have refreshed neither Spain nor France.

const result = (n: number): ParseResult =>
  ({
    stations: new Array(n).fill(null),
    rejected: [],
    feedRecords: n,
  }) as unknown as ParseResult;

const SRC = [
  { id: 'es-minetur' },
  { id: 'fr-data-economie' },
  { id: 'it-mimit' },
];

describe('gatherSources — a source that cannot be read is named, not fatal', () => {
  it('keeps the sources that were read when one of them throws', async () => {
    const { ok, failed } = await gatherSources(SRC, async (s) => {
      if (s.id === 'it-mimit') throw new Error('it-mimit unreachable');
      return result(3);
    });
    expect(ok.map((o) => o.source.id)).toEqual([
      'es-minetur',
      'fr-data-economie',
    ]);
    expect(failed.map((f) => f.source.id)).toEqual(['it-mimit']);
    expect(failed[0].why).toBe('it-mimit unreachable');
  });

  it('reports every failure, not just the first', async () => {
    const { ok, failed } = await gatherSources(SRC, async (s) => {
      if (s.id !== 'fr-data-economie') throw new Error(`${s.id} down`);
      return result(1);
    });
    expect(ok).toHaveLength(1);
    expect(failed.map((f) => f.source.id)).toEqual(['es-minetur', 'it-mimit']);
  });

  it('keeps the order of the sources it was given', async () => {
    const seen: string[] = [];
    await gatherSources(SRC, async (s) => {
      seen.push(s.id);
      return result(1);
    });
    expect(seen).toEqual(['es-minetur', 'fr-data-economie', 'it-mimit']);
  });
});

describe('requireOneSource — nothing read means nothing is written', () => {
  it('throws, naming every source, when none was read', () => {
    const failed = SRC.map((source) => ({ source, why: 'down' }));
    expect(() => requireOneSource([], failed)).toThrow(
      /every source failed \(es-minetur, fr-data-economie, it-mimit\)/,
    );
  });

  it('lets a run with one good source through', () => {
    expect(() =>
      requireOneSource([{ source: SRC[0], result: result(1) }], []),
    ).not.toThrow();
  });
});

describe('whyFailed — the network error’s own cause is the useful half', () => {
  it('appends the cause that undici hides behind "fetch failed"', () => {
    const err = Object.assign(new TypeError('fetch failed'), {
      cause: new Error(
        'Connect Timeout Error (attempted address: www.mimit.gov.it:443)',
      ),
    });
    expect(whyFailed(err)).toBe(
      'fetch failed (Connect Timeout Error (attempted address: www.mimit.gov.it:443))',
    );
  });

  it('is the first line of a plain error, never a stack', () => {
    expect(whyFailed(new Error('boom\n    at somewhere'))).toBe('boom');
  });
});

// 🔴 A REAL DATABASE, because "keeps the other source's rows" is a claim
// about what DELETE does, not about what a string contains. A temp table
// named like the real one shadows it for this session only: nothing in the
// database the URL names is read or written.
//
// A MISSING DATABASE IS A FAILURE, NOT A SKIP (see account.db.spec.ts).
describe('DELETE_REFRESHED_SQL — rows of a failed source survive', () => {
  const URL = process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;
  let db: Client;

  beforeAll(async () => {
    if (!URL) {
      throw new Error(
        'set CAMP_TEST_DATABASE_URL (or CI_DATABASE_URL): any reachable PostgreSQL',
      );
    }
    db = new Client({ connectionString: URL });
    await db.connect();
    await db.query(
      `CREATE TEMP TABLE fuel_station_prices (source text NOT NULL, station_ref text NOT NULL)`,
    );
    await db.query(
      `INSERT INTO fuel_station_prices VALUES
         ('es-minetur','e1'), ('es-minetur','e2'),
         ('fr-data-economie','f1'),
         ('it-mimit','i1'), ('it-mimit','i2'), ('it-mimit','i3')`,
    );
  });
  afterAll(async () => {
    await db?.end();
  });

  it('removes the refreshed sources and leaves the one that failed', async () => {
    const r = await db.query(DELETE_REFRESHED_SQL, [
      ['es-minetur', 'fr-data-economie'],
    ]);
    expect(r.rowCount).toBe(3);
    const left = await db.query(
      `SELECT source, count(*)::int AS n FROM fuel_station_prices GROUP BY 1 ORDER BY 1`,
    );
    expect(left.rows).toEqual([{ source: 'it-mimit', n: 3 }]);
  });
});

// 🔴 THE HELPERS ABOVE ARE ONLY AS GOOD AS main()'s USE OF THEM. A helper
// that is tested and not called is the commonest way for a guard to be
// green and absent, so the wiring is read from the code that ships — with
// comments stripped, because the explanation of a bug is full of the words
// of the bug.
describe('main() is wired to them', () => {
  const code = readFileSync(join(__dirname, 'import-stations.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('deletes through DELETE_REFRESHED_SQL, with the ids it actually read', () => {
    expect(code).toMatch(
      /client\.query\(\s*DELETE_REFRESHED_SQL,\s*\[\s*parsed\.map\(\(p\) => p\.source\.id\)\s*\]/,
    );
  });

  it('has no other DELETE of the prices table', () => {
    expect(code.match(/DELETE FROM fuel_station_prices/g)).toHaveLength(1);
  });

  it('gathers sources through gatherSources and refuses an empty read', () => {
    expect(code).toMatch(/await gatherSources\(SOURCES,/);
    expect(code).toMatch(/requireOneSource\(parsed, failed\)/);
  });

  it('names the sources it did not refresh, after the commit, and stays exit 0', () => {
    const commit = code.indexOf("client.query('COMMIT')");
    const said = code.indexOf('sources were NOT refreshed', commit);
    expect(commit).toBeGreaterThan(0);
    expect(said).toBeGreaterThan(commit);
    // a partial run is not a failed run: the freshness check, per source,
    // is what turns a stuck source into a letter. See the comment in main().
    expect(code).not.toMatch(/process\.exitCode\s*=/);
  });
});

describe('unknown arguments are an error, not a shrug', () => {
  it('names a typo of --dry-run instead of running for real', () => {
    expect(unknownArgs(['--dryrun'])).toEqual(['--dryrun']);
    expect(unknownArgs(['--report', '--dry-run'])).toEqual([]);
  });

  it('takes the value of --from-dir whatever it looks like, and nothing else', () => {
    expect(unknownArgs(['--from-dir', '/tmp/cache'])).toEqual([]);
    expect(unknownArgs(['--from-dir', '--report'])).toEqual([]);
    expect(unknownArgs(['/tmp/cache'])).toEqual(['/tmp/cache']);
  });

  it('main() refuses them before reading a feed', () => {
    const code = readFileSync(join(__dirname, 'import-stations.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const refuse = code.search(
      /const stray = unknownArgs\(args\);\s*if \(stray\.length > 0\) \{\s*throw new Error\(/,
    );
    const first = code.indexOf('await gatherSources(');
    expect(refuse).toBeGreaterThan(0);
    expect(first).toBeGreaterThan(refuse);
  });
});

// 🔴 THE UNIT AND THE SCRIPT ARE TIED IN CI. The freshness sentry's unit
// passed a flag its script did not know for three weeks (CAMP-399).
describe('camptribe-fuel-prices.service', () => {
  const unit = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'infra',
      'systemd',
      'camptribe-fuel-prices.service',
    ),
    'utf8',
  );
  const exec = unit.split('\n').find((l) => l.startsWith('ExecStart='));

  it('runs the compiled importer that the build emits from this source', () => {
    expect(exec).toMatch(/dist\/fuel\/import-stations\.js(\s|$)/);
  });

  it('passes only flags the script knows', () => {
    const flags = (exec ?? '').split(/\s+/).filter((a) => a.startsWith('--'));
    expect(flags.length).toBeGreaterThan(0);
    for (const f of flags)
      expect(KNOWN_FLAGS as readonly string[]).toContain(f);
  });

  it('does not pass --dry-run: a timer that writes nothing would be a green nothing', () => {
    expect(exec).not.toMatch(/--dry-run/);
  });
});
