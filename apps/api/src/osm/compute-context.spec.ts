import { carryForward, heightGuard, saysSomething } from './compute-context';
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

// CAMP-496 — a manual run over a row without `at` erased its stored height.
//
// 🔴 The write replaces the whole context, and 1 711 live rows have a height
// and relief but no `at`. They are always picked up (`!at`), and the carry
// used to require `previous.at`. Reproduced on a scratch database: 5 of 5
// such rows lost their height.

const here = { lat: 46.3, lon: 14.05 };
const stored = {
  elevation: 505,
  terrain: { relief: 105, type: 'hilly' as const },
};

describe('carryForward', () => {
  it('keeps height and relief of a row WITHOUT `at` — the 1 711', () => {
    const fresh = { at: here } as SpotContext;
    const kept = carryForward(fresh, stored as SpotContext, here);
    expect(kept).toBe(true);
    expect(fresh.elevation).toBe(505);
    expect(fresh.terrain).toEqual({ relief: 105, type: 'hilly' });
  });

  it('still keeps them for a row WITH `at` at the same coordinates', () => {
    const fresh = { at: here } as SpotContext;
    carryForward(fresh, { ...stored, at: { ...here } } as SpotContext, here);
    expect(fresh.elevation).toBe(505);
    expect(fresh.terrain).toBeDefined();
  });

  it('does not carry a height measured somewhere else (`at` differs)', () => {
    const fresh = { at: here } as SpotContext;
    const kept = carryForward(
      fresh,
      { ...stored, at: { lat: 47.0, lon: 15.0 } } as SpotContext,
      here,
    );
    expect(kept).toBe(false);
    expect(fresh.elevation).toBeUndefined();
    expect(fresh.terrain).toBeUndefined();
  });

  it('never overwrites a height that was just computed', () => {
    const fresh = { at: here, elevation: 600 } as SpotContext;
    expect(carryForward(fresh, stored as SpotContext, here)).toBe(false);
    expect(fresh.elevation).toBe(600);
  });

  it('does nothing without a previous context', () => {
    const fresh = { at: here } as SpotContext;
    expect(carryForward(fresh, null, here)).toBe(false);
    expect(fresh.elevation).toBeUndefined();
  });
});

describe('heightGuard', () => {
  const row = (id: string, context: SpotContext | null) => ({
    id,
    ...here,
    context,
  });

  it('watches rows with a height, with or without `at`, and prints who', () => {
    const { watched } = heightGuard([
      row('a', stored as SpotContext),
      row('b', { ...stored, at: { ...here } } as SpotContext),
      row('c', { at: here } as SpotContext),
      row('d', null),
    ]);
    expect(watched).toEqual(['a', 'b']);
  });

  it('does not watch a row that moved: its old height was never ours to keep', () => {
    const { watched } = heightGuard([
      row('m', { ...stored, at: { lat: 50, lon: 20 } } as SpotContext),
    ]);
    expect(watched).toEqual([]);
  });
});

describe('carry plus guard, end to end over one batch', () => {
  it('after the carry, every watched row still has its height (lost = 0 of N)', () => {
    const batch = [
      { id: 'a', ...here, context: stored as SpotContext },
      {
        id: 'b',
        ...here,
        context: { ...stored, at: { ...here } } as SpotContext,
      },
    ];
    const { watched } = heightGuard(batch);
    const written = batch.map((r) => {
      const next = { at: { lat: here.lat, lon: here.lon } } as SpotContext;
      carryForward(next, r.context, r);
      return { id: r.id, context: next };
    });
    const lost = written.filter(
      (w) => watched.includes(w.id) && w.context.elevation === undefined,
    );
    expect({ lost: lost.length, of: watched.length }).toEqual({
      lost: 0,
      of: 2,
    });
  });
});
