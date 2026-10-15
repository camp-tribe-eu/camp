import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoverageSnapshot } from './coverage-snapshot';

// CAMP-262 — "the check runs at start-up" is a statement about the PROCESS,
// not about scoring.ts. scoring.spec.ts proves scoring.ts throws when it
// loads; this proves the API's own root module loads it. Remove the import
// from app.module.ts and the second test goes red: the weights would still
// be checked, by a module nobody starts.

const real = (): CoverageSnapshot =>
  JSON.parse(readFileSync(join(__dirname, 'coverage.snapshot.json'), 'utf8'));

function loadAppModule(alter: (s: CoverageSnapshot) => void): {
  error?: Error;
  AppModule?: unknown;
} {
  const snapshot = real();
  alter(snapshot);
  let out: { error?: Error; AppModule?: unknown } = {};
  jest.isolateModules(() => {
    jest.doMock('./coverage.snapshot.json', () => snapshot);
    try {
      // jest.isolateModules is synchronous, so it can only load by require.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      out = { AppModule: require('../app.module').AppModule };
    } catch (e) {
      out = { error: e as Error };
    }
  });
  jest.dontMock('./coverage.snapshot.json');
  return out;
}

describe('the API root module and the scoring check', () => {
  it('loads with the real coverage table', () => {
    const { AppModule, error } = loadAppModule(() => undefined);
    expect(error).toBeUndefined();
    expect(AppModule).toBeDefined();
  });

  it('refuses to load when a weight is heavier than its coverage allows', () => {
    const { AppModule, error } = loadAppModule((s) => {
      s.fields.location.known = Math.floor(s.population.n * 0.3);
    });
    expect(AppModule).toBeUndefined();
    expect(error?.message).toMatch(/CAMP-262 scoring refuses to load/);
  });
});
