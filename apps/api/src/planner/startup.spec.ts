import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoverageSnapshot } from './coverage-snapshot';
import type { HardRule } from './hard-constraints';

// CAMP-262 — "the check runs at start-up" is a statement about the PROCESS,
// not about scoring.ts. scoring.spec.ts proves the check refuses what it
// should and says why; this proves the API's own root module RUNS it as it
// loads. Remove the `loadMeasuredScoring()` call from app.module.ts and the
// second test goes red: the weights would still be checkable, by a function
// nobody starts.
//
// CAMP-246 added a second check of the same kind (stage 1's hard constraints,
// `loadMeasuredHardConstraints`); the last test below is its twin.

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
    // The message, not the object: red here prints the refusal's own words.
    expect(error?.message).toBeUndefined();
    expect(AppModule).toBeDefined();
  });

  it('refuses to load when a weight is heavier than its coverage allows', () => {
    const { AppModule, error } = loadAppModule((s) => {
      s.fields.location.known = Math.floor(s.population.n * 0.3);
    });
    expect(AppModule).toBeUndefined();
    expect(error?.message).toMatch(/^CAMP-262 scoring refuses to load:/);
    expect(error?.message).toMatch(
      /distance_fit: weight [\d.]+ on "location", known for only 30\.0% \(< 50%\)/,
    );
  });
});

describe('the API root module and the hard-constraint check', () => {
  // No shipped rule rejects by a value the data lacks, so the real list can
  // never fail the real table — and a test that waited for that would wait
  // for ever. This one gives the loader a list with such a rule in it, the
  // one CAMP-246 names: "must allow dogs" read as `dogFriendly = 'yes'`.
  // What it proves is that app.module CALLS the check, and says what it
  // found; remove the call and the module loads without a word.
  const dogByValue: HardRule = {
    id: 'dog-by-value',
    rejects: 'by-value',
    field: 'dogFriendly',
    sql: () => ({ where: '', params: [] }),
  };

  function loadWithRule(rule: HardRule): {
    error?: Error;
    AppModule?: unknown;
  } {
    const snapshot = real();
    let out: { error?: Error; AppModule?: unknown } = {};
    jest.isolateModules(() => {
      jest.doMock('./hard-constraints', () => {
        const actual = jest.requireActual('./hard-constraints');
        return {
          ...actual,
          loadMeasuredHardConstraints: () => {
            actual.assertHardAllowed(snapshot, [...actual.HARD, rule]);
            return actual.HARD;
          },
        };
      });
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        out = { AppModule: require('../app.module').AppModule };
      } catch (e) {
        out = { error: e as Error };
      }
    });
    jest.dontMock('./hard-constraints');
    return out;
  }

  it('refuses to load when a rule rejects by a value the data mostly lacks', () => {
    const { AppModule, error } = loadWithRule(dogByValue);
    expect(AppModule).toBeUndefined();
    expect(error?.message).toMatch(
      /^CAMP-246 hard constraints refuse to load:/,
    );
    expect(error?.message).toMatch(
      /dog-by-value: hard constraint on dogFriendly: known for only \d+\.\d%/,
    );
  });

  it('loads when the extra rule is by value on a field the data does carry', () => {
    const { AppModule, error } = loadWithRule({
      ...dogByValue,
      field: 'location',
    });
    expect(error?.message).toBeUndefined();
    expect(AppModule).toBeDefined();
  });
});
