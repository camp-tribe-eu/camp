import { collect, type CollectDeps } from './collect';
import { countShapes } from './snapshot';

const NOW = new Date('2026-10-13T12:00:00Z');

const block = (country: string) => ({
  event: `Fog in ${country}`,
  areas: [
    {
      name: country,
      codes: [`X:${country}`],
      polygons: ['1,2 3,4'],
      circles: ['1,2 5'],
    },
  ],
});

const deps = (over: Partial<CollectDeps> = {}): CollectDeps => ({
  countries: ['france', 'italy', 'croatia'],
  feedUrl: (c) => `https://feeds.invalid/${c}`,
  warningsFrom: (_p, country) => ({ kept: [block(country)] }),
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  now: () => NOW,
  ...over,
});

describe('CAMP-302: оберт оновлювача', () => {
  it('🔴 кожен фід питається РІВНО один раз за оберт', async () => {
    // Доказ, а не намір: без лічильника «ми не проксуємо на кожен запит»
    // лишалось би твердженням про те, чого ніхто не міряв.
    const seen: string[] = [];
    const r = await collect(
      deps({
        fetchImpl: async (url) => {
          seen.push(url);
          return { ok: true, status: 200, json: async () => ({}) };
        },
      }),
    );
    expect(r.calls).toBe(3);
    expect(new Set(seen).size).toBe(3);
  });

  it('🔴 у знімку НУЛЬ фігур, хоч фід їх і прислав', async () => {
    const r = await collect(deps());
    expect(countShapes(r.snapshot.warnings)).toBe(0);
    // І це не тому, що попереджень немає.
    expect(r.snapshot.warnings).toHaveLength(3);
  });

  it('час знімка — це час ЗНЯТТЯ, один на весь оберт', async () => {
    const r = await collect(deps());
    expect(r.snapshot.fetchedAt).toBe(NOW.toISOString());
  });

  it('🔴 три фіди з 27 мовчать — знімок несе решту, а не порожнечу', async () => {
    const r = await collect(
      deps({
        fetchImpl: async (url) =>
          url.endsWith('italy')
            ? { ok: false, status: 503, json: async () => ({}) }
            : { ok: true, status: 200, json: async () => ({}) },
      }),
    );
    expect(r.failed).toEqual(['italy']);
    expect(r.snapshot.warnings).toHaveLength(2);
  });

  it('фід, що кинув виняток, рахується так само, як той, що відмовив', async () => {
    const r = await collect(
      deps({
        fetchImpl: async (url) => {
          if (url.endsWith('croatia')) throw new Error('мережа');
          return { ok: true, status: 200, json: async () => ({}) };
        },
      }),
    );
    expect(r.failed).toEqual(['croatia']);
    expect(r.calls).toBe(3);
  });

  it('🔴 усі фіди мовчать — знімок порожній, але час у нього Є', async () => {
    // Інакше службі нічим відрізнити «щойно спитали, нічого немає» від
    // «ніколи не питали».
    const r = await collect(
      deps({
        fetchImpl: async () => ({
          ok: false,
          status: 500,
          json: async () => ({}),
        }),
      }),
    );
    expect(r.failed).toHaveLength(3);
    expect(r.snapshot.warnings).toHaveLength(0);
    expect(r.snapshot.fetchedAt).toBe(NOW.toISOString());
  });
});
