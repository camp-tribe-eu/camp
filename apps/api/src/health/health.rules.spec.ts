import {
  evaluate,
  IMPORT_STALE_HOURS,
  MIN_COUNTRIES,
  MIN_PER_COUNTRY,
  MIN_SPOTS,
  SLOW_DB_MS,
  statusCode,
  type Facts,
} from './health.rules';

// CAMP-59 — the alarm's own logic, driven through every branch that
// only happens when something is already broken.
//
// 🔴 The card's rule: a blind alarm is worse than no alarm, because
// people rely on it. These tests are the first of its three steps — the
// query returns something real. Steps two and three (break it, watch it
// go red; fix it, watch it go green) are done against the running API
// and written into the card, because they cannot be asserted here.

const healthy: Facts = {
  databaseMs: 3,
  postgis: '3.6',
  spots: 61521,
  withSurroundings: 9812,
  importAgeHours: 12,
  countries: 27,
  smallestCountry: 14,
};

describe('evaluate', () => {
  it('says ok when everything answers', () => {
    const r = evaluate(healthy);
    expect(r.status).toBe('ok');
    expect(Object.values(r.checks).every((c) => c.ok)).toBe(true);
  });

  // 🔴 Blindness mode 4: a silent zero is not "nothing to report".
  it.each([
    ['databaseMs', { databaseMs: null }],
    ['postgis', { postgis: null }],
    ['spots', { spots: null }],
    ['withSurroundings', { withSurroundings: null }],
    ['importAgeHours', { importAgeHours: null }],
    ['countries', { countries: null }],
    ['smallestCountry', { smallestCountry: null }],
  ])(
    'a measurement that did not happen (%s) is a failure, never a pass',
    (_f, patch) => {
      const r = evaluate({ ...healthy, ...(patch as Partial<Facts>) });
      expect(r.status).not.toBe('ok');
    },
  );

  // 🔴 Blindness mode 2: "less than" on an empty result reads as healthy.
  it('zero campsites is down, not quietly fine', () => {
    const r = evaluate({ ...healthy, spots: 0 });
    expect(r.status).toBe('down');
    expect(r.checks.spots.detail).toContain('0 campsites');
  });

  it('a half-imported database is down before anyone browses it', () => {
    // The shape the throttled build produced: everything answers, the
    // site is nearly empty, and every response is a 200.
    const r = evaluate({
      ...healthy,
      spots: 50,
      countries: 1,
      smallestCountry: 50,
    });
    expect(r.status).toBe('down');
  });

  // 🔴 The absolute floor is only a backstop now; the per-country check is
  // what catches a country vanishing. Review showed the old floor of 1,000
  // calling a database that had lost France and Germany healthy.
  it('losing a whole country is down, whatever the total', () => {
    const r = evaluate({ ...healthy, countries: 26, smallestCountry: 0 });
    expect(r.status).toBe('down');
    expect(r.checks.countries.detail).toMatch(/no campsites at all/);
  });

  it('a database holding only a few countries is down', () => {
    // The state this project was actually in before the import was fixed,
    // and it looked entirely healthy at the time.
    const r = evaluate({ ...healthy, countries: 3, smallestCountry: 282 });
    expect(r.status).toBe('down');
    expect(r.checks.countries.detail).toMatch(/only 3 countries/);
  });

  it('the absolute floor stays a backstop, not the main check', () => {
    expect(MIN_SPOTS).toBeGreaterThan(0);
    expect(MIN_COUNTRIES).toBeGreaterThan(1);
    expect(MIN_PER_COUNTRY).toBeGreaterThan(0);
  });

  // 🔴 NaN and Infinity are not "absent", so the null checks miss them.
  // Review demonstrated evaluate() reporting NaN campsites as healthy.
  it.each([
    ['NaN spots', { spots: Number.NaN }],
    ['Infinity spots', { spots: Number.POSITIVE_INFINITY }],
    ['fractional spots', { spots: 1.5 }],
    ['negative spots', { spots: -5 }],
    ['NaN countries', { countries: Number.NaN }],
    ['more surroundings than campsites', { withSurroundings: 999999 }],
  ])('%s is never healthy', (_name, patch) => {
    const r = evaluate({ ...healthy, ...(patch as Partial<Facts>) });
    expect(r.status).not.toBe('ok');
  });

  it('an import stamped in the future is a failure, not freshness', () => {
    const r = evaluate({ ...healthy, importAgeHours: -500 });
    expect(r.status).toBe('degraded');
    expect(r.checks.osmImport.detail).toMatch(/future/);
  });

  it('a database that answers slowly is down, not ok', () => {
    expect(evaluate({ ...healthy, databaseMs: SLOW_DB_MS + 1 }).status).toBe(
      'down',
    );
    expect(evaluate({ ...healthy, databaseMs: SLOW_DB_MS }).status).toBe('ok');
  });

  it('no PostGIS is down — every map query depends on it', () => {
    const r = evaluate({ ...healthy, postgis: null });
    expect(r.status).toBe('down');
    expect(r.checks.postgis.detail).toMatch(/map/);
  });

  it('losing the surroundings degrades rather than downs', () => {
    // The site still serves; it is just no longer the thing that makes
    // it different. Worth saying, not worth a 503.
    const r = evaluate({ ...healthy, withSurroundings: 0 });
    expect(r.status).toBe('degraded');
    expect(statusCode(r.status)).toBe(200);
  });

  // 🔴 Blindness mode 1: a window shorter than the watched job's pace.
  it('the staleness limit is longer than the import interval and its watchdog', () => {
    // osm-weekly runs every 7 days; CAMP-103's watchdog allows 8.
    expect(IMPORT_STALE_HOURS).toBeGreaterThan(8 * 24);
  });

  it('a stale import degrades and says how stale in days', () => {
    const r = evaluate({ ...healthy, importAgeHours: IMPORT_STALE_HOURS + 24 });
    expect(r.status).toBe('degraded');
    expect(r.checks.osmImport.detail).toMatch(/\d+ days ago/);
  });

  it('an import that is merely late but inside the limit stays ok', () => {
    expect(
      evaluate({ ...healthy, importAgeHours: IMPORT_STALE_HOURS }).status,
    ).toBe('ok');
  });

  it('every check says something a person can act on', () => {
    for (const bad of [
      { databaseMs: null },
      { postgis: null },
      { spots: 0 },
      { withSurroundings: 0 },
      { importAgeHours: 10_000 },
    ] as Partial<Facts>[]) {
      const r = evaluate({ ...healthy, ...bad });
      const failing = Object.values(r.checks).filter((c) => !c.ok);
      expect(failing.length).toBeGreaterThan(0);
      for (const c of failing) {
        // Not a code, not a boolean: a sentence.
        expect(c.detail.length).toBeGreaterThan(15);
        expect(c.detail).toMatch(/[a-z]{4}/);
      }
    }
  });
});

describe('statusCode', () => {
  it('is 503 only when we genuinely cannot serve', () => {
    expect(statusCode('ok')).toBe(200);
    expect(statusCode('degraded')).toBe(200);
    expect(statusCode('down')).toBe(503);
  });
});
