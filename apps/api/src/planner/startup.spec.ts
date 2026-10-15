import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoverageSnapshot } from './coverage-snapshot';
import { checkHard, HARD, type HardRule } from './hard-constraints';
import { checkReasons, REASON_SOURCES } from './reasons';
import { checkScoring, COMPONENTS } from './scoring';

// CAMP-262 — "the check runs at start-up" is a statement about the PROCESS,
// not about scoring.ts. scoring.spec.ts proves the check refuses what it
// should and says why; this proves the API's own root module RUNS it as it
// loads. Remove the `loadMeasuredScoring()` call from app.module.ts and the
// second test goes red: the weights would still be checkable, by a function
// nobody starts.
//
// CAMP-246 added a second check of the same kind (stage 1's hard constraints,
// `loadMeasuredHardConstraints`); the last two blocks below are its twin, and
// neither replaces a function body (see the comment on the first of them).

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

describe('the hard-constraint check, run for real', () => {
  // 🔴 NO FUNCTION BODY IS REPLACED HERE. An earlier version of this block
  // swapped `loadMeasuredHardConstraints` for a stub that called
  // `assertHardAllowed` itself and then asserted that the stub threw: it
  // tested its own stand-in. Review changed the loader to check `[]` instead
  // of `HARD` — a check that can never fail — and the whole suite stayed
  // green; with that one edit a by-value rule on `dogFriendly`, which is what
  // CAMP-260 exists to forbid, loaded without a word.
  //
  // So, as for the scoring above, what is altered is the TABLE (the real
  // coverage.snapshot.json, read, changed in memory, handed to the module in
  // place of the file) and what runs is the shipped loader over the shipped
  // `HARD`. The shipped corridor rule stands on `location`; make the table
  // say `location` is thinly known and the real loader has to refuse.
  function loadRules(alter: (s: CoverageSnapshot) => void): {
    error?: Error;
    rules?: readonly HardRule[];
  } {
    const snapshot = real();
    alter(snapshot);
    let out: { error?: Error; rules?: readonly HardRule[] } = {};
    jest.isolateModules(() => {
      jest.doMock('./coverage.snapshot.json', () => snapshot);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const m = require('./hard-constraints');
        out = { rules: m.loadMeasuredHardConstraints() };
      } catch (e) {
        out = { error: e as Error };
      }
    });
    jest.dontMock('./coverage.snapshot.json');
    return out;
  }

  const thin = (share: number) => (s: CoverageSnapshot) => {
    // Round numbers, so the share is exactly what the test says it is.
    s.population.n = 52_500;
    s.fields.location.known = Math.round(52_500 * share);
  };

  it('returns the shipped rules for the real coverage table', () => {
    const { rules, error } = loadRules(() => undefined);
    expect(error?.message).toBeUndefined();
    expect(rules?.map((r) => r.id)).toEqual([
      'page',
      'country',
      'corridor',
      'needs',
    ]);
  });

  it('refuses when the field the corridor stands on is known for 30%', () => {
    const { rules, error } = loadRules(thin(0.3));
    expect(rules).toBeUndefined();
    expect(error?.message).toMatch(
      /^CAMP-246 hard constraints refuse to load:/,
    );
    expect(error?.message).toMatch(
      /corridor: hard constraint on location: known for only 30\.0% \(<= 50%\)/,
    );
  });

  it('refuses at exactly the floor: a hard rule needs MORE than half, not half', () => {
    const { rules, error } = loadRules(thin(0.5));
    expect(rules).toBeUndefined();
    expect(error?.message).toMatch(
      /corridor: hard constraint on location: known for only 50\.0%/,
    );
  });

  it('and loads just above it, so the refusal is about this field and nothing else', () => {
    const { error, rules } = loadRules((s) => {
      s.population.n = 52_500;
      s.fields.location.known = 26_251;
    });
    expect(error?.message).toBeUndefined();
    expect(rules).toHaveLength(4);
  });
});

describe('the API root module runs the hard-constraint check', () => {
  // The table `location` known for exactly half: the scoring check refuses
  // below half (`share < floor`) and accepts half, the hard check refuses at
  // half and below (`share <= floor`, "more than half"). So this one table is
  // refused by the hard constraints ALONE, and loading the root module with
  // it proves the module calls the real check — with no scoring stand-in and
  // no replaced loader. Remove the call from app.module.ts and the module
  // loads, and this goes red.
  const half = (s: CoverageSnapshot) => {
    s.population.n = 52_500;
    s.fields.location.known = 26_250;
  };

  it('premise: the scoring check alone accepts that table', () => {
    // If scoring ever starts to refuse it too, the test below would pass on
    // the scoring error and say nothing about stage 1. Say so out loud.
    const snapshot = real();
    half(snapshot);
    expect(checkScoring(COMPONENTS, snapshot)).toEqual([]);
    expect(checkHard(HARD, snapshot)).not.toEqual([]);
  });

  it('refuses to start on it, in the hard constraints own words', () => {
    const { AppModule, error } = loadAppModule(half);
    expect(AppModule).toBeUndefined();
    expect(error?.message).toMatch(
      /^CAMP-246 hard constraints refuse to load:/,
    );
    expect(error?.message).toMatch(
      /corridor: hard constraint on location: known for only 50\.0%/,
    );
  });
});

describe('the API root module runs the reasons check', () => {
  // CAMP-245. Delete the measured `context.water` from the table: scoring
  // stands on location, electricity, greyWater and stars, the hard
  // constraints on location, so BOTH of those load; only the reasons stand on
  // the context. Loading the root module with this table is refused by the
  // reasons check ALONE — with no stand-in and no replaced loader — so remove
  // the call from app.module.ts and the module loads, and this goes red.
  const noContextWater = (s: CoverageSnapshot) => {
    delete s.fields['context.water'];
  };

  it('premise: scoring and the hard constraints accept that table', () => {
    // If either ever starts to refuse it, the test below would pass on THEIR
    // error and say nothing about the reasons.
    const snapshot = real();
    noContextWater(snapshot);
    expect(checkScoring(COMPONENTS, snapshot)).toEqual([]);
    expect(checkHard(HARD, snapshot)).toEqual([]);
    expect(checkReasons(REASON_SOURCES, snapshot)).not.toEqual([]);
  });

  it('refuses to start on it, in the reasons’ own words, naming the field', () => {
    const { AppModule, error } = loadAppModule(noContextWater);
    expect(AppModule).toBeUndefined();
    expect(error?.message).toMatch(/^CAMP-245 reasons refuse to load:/);
    expect(error?.message).toMatch(
      /context\.water: field is not in the coverage snapshot/,
    );
  });

  it('and `water`, the amenity, is still there: it does not stand in for the context', () => {
    const snapshot = real();
    expect(snapshot.fields.water).toBeDefined();
    noContextWater(snapshot);
    expect(snapshot.fields.water).toBeDefined();
  });
});
