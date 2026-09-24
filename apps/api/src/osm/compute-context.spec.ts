import { saysSomething } from './compute-context';
import type { SpotContext } from './spot-context';

// CAMP-108 — the one rule in compute-context that can publish a lie.
//
// 🔴 Why this file exists. CAMP-105 lifts `noindex` the moment `context`
// stops being empty: `AND (context IS NULL OR context = '{}'::jsonb)`.
// `at` is written on every context so the next run can tell whether the
// campsite has moved — it is a note to ourselves, not a fact about the
// place. A context of nothing but `at` is therefore non-empty, lifts the
// noindex, and publishes a page that still says nothing.
//
// That is precisely what CAMP-108 was opened to prevent, and this test is
// the only thing standing between the two.

const at = { at: { lat: 46.36, lon: 14.09 } };

describe('saysSomething', () => {
  it('refuses a context that is only the coordinates we measured from', () => {
    expect(saysSomething(at as SpotContext)).toBe(false);
  });

  it('refuses an empty context', () => {
    expect(saysSomething({} as SpotContext)).toBe(false);
  });

  it.each([
    ['water', { water: { m: 125, kind: 'river' as const, name: 'Sava' } }],
    ['town', { town: { m: 18200, name: 'Jesenice' } }],
    ['supermarket', { supermarket: { m: 900, name: 'Mercator' } }],
    ['station', { station: { m: 17600, name: 'Jesenice' } }],
    ['elevation', { elevation: 749 }],
    ['terrain', { terrain: { relief: 351, type: 'mountainous' as const } }],
  ])('accepts a context carrying %s', (_field, extra) => {
    expect(saysSomething({ ...at, ...extra } as SpotContext)).toBe(true);
  });

  it('accepts the quota-limited shape: distances without any height', () => {
    // 🔴 The case the slicing change creates. When Open-Meteo's daily
    // limit stops a run, the PostGIS half is still known and costs
    // nothing — those spots are written and their pages go live saying
    // what is around them, with the height filled in on a later day.
    const distancesOnly = {
      ...at,
      water: { m: 125, kind: 'lake' as const, name: 'Bled' },
      town: { m: 2600, name: 'Bled' },
    };
    expect(saysSomething(distancesOnly as SpotContext)).toBe(true);
  });

  it('refuses a height that came back null, rather than writing a bare at', () => {
    // `elevation` is only set when the DEM answered. If it did not, and
    // nothing else was found either, the spot must stay unmeasured.
    expect(saysSomething({ ...at } as SpotContext)).toBe(false);
  });
});
