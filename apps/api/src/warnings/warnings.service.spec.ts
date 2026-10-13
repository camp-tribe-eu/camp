import { findFetcher, WarningsService } from './warnings.service';
import { countShapes } from './snapshot';

const COUNTRIES = ['france', 'italy', 'croatia'];

const fetcher = {
  countries: COUNTRIES,
  feedUrl: (c: string) => `https://feeds.invalid/${c}`,
  warningsFrom: (_p: unknown, country: string) => ({
    kept: [
      {
        event: `Fog ${country}`,
        areas: [
          {
            name: country,
            codes: [`X:${country}`],
            polygons: ['1,2 3,4'],
            circles: ['1,2 5'],
          },
        ],
      },
    ],
  }),
};

const make = (
  over: Partial<ConstructorParameters<typeof WarningsService>[0]> = {},
) => {
  let clock = new Date('2026-10-13T12:00:00Z');
  const calls: string[] = [];
  const svc = new WarningsService({
    loader: async () => fetcher,
    now: () => clock,
    fetchImpl: async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({}) };
    },
    ...over,
  });
  return {
    svc,
    calls,
    tick: (minutes: number) => {
      clock = new Date(clock.getTime() + minutes * 60_000);
    },
  };
};

describe('CAMP-302: оновлювач у памʼяті', () => {
  it('🔴 до першого оберту часу немає — і це не «свіжо»', async () => {
    const { svc } = make();
    expect(svc.current().fetchedAt).toBeNull();
    await svc.refresh();
    expect(svc.current().fetchedAt).toBe('2026-10-13T12:00:00.000Z');
  });

  it('🔴 два оберти з проміжком дають РІЗНИЙ час — знімок не вічний', async () => {
    const { svc, tick } = make();
    await svc.refresh();
    const first = svc.current().fetchedAt;
    tick(6);
    await svc.refresh();
    expect(svc.current().fetchedAt).not.toBe(first);
  });

  it('🔴 геометрія не доїжджає до памʼяті взагалі', async () => {
    const { svc } = make();
    await svc.refresh();
    expect(countShapes(svc.current().warnings)).toBe(0);
    expect(svc.current().warnings).toHaveLength(3);
  });

  it('🔴 фіди питаються раз на ОБЕРТ, а не раз на запит читача', async () => {
    const { svc, calls } = make();
    await svc.refresh();
    expect(calls).toHaveLength(3);
    expect(svc.callsLastCycle()).toBe(3);

    // Сто читачів підряд — жодного нового звернення.
    for (let i = 0; i < 100; i += 1) svc.current();
    expect(calls).toHaveLength(3);
  });

  it('🔴 фід замовк — знімок СТАРІЄ, а не порожніє', async () => {
    // Це головне речення картки: «ми не знаємо» і «попереджень немає» —
    // різні відповіді, і друга з них брехня.
    const dead = { ok: false, status: 503, json: async () => ({}) };
    let alive = true;
    const { svc, tick } = make({
      fetchImpl: async () =>
        alive ? { ok: true, status: 200, json: async () => ({}) } : dead,
    });
    await svc.refresh();
    const good = svc.current();
    expect(good.warnings).toHaveLength(3);

    alive = false;
    tick(20);
    await svc.refresh();

    expect(svc.current()).toBe(good);
    expect(svc.current().fetchedAt).toBe(good.fetchedAt);
    expect(svc.current().warnings).toHaveLength(3);
  });

  it('🔴 сам завантажувач упав — знімок теж лишається', async () => {
    const { svc, tick } = make();
    await svc.refresh();
    const good = svc.current();

    const broken = new WarningsService({
      loader: async () => {
        throw new Error('модуль не читається');
      },
      now: () => new Date('2026-10-13T13:00:00Z'),
    });
    // На порожньому знімку падіння не вигадує часу.
    await broken.refresh();
    expect(broken.current().fetchedAt).toBeNull();

    tick(1);
    expect(good.fetchedAt).toBe('2026-10-13T12:00:00.000Z');
  });

  it('частковий провал знімок ОНОВЛЮЄ — 24 із 27 це не мовчання', async () => {
    const { svc, tick } = make({
      fetchImpl: async (url: string) =>
        url.endsWith('italy')
          ? { ok: false, status: 503, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => ({}) },
    });
    await svc.refresh();
    const first = svc.current().fetchedAt;
    tick(6);
    await svc.refresh();
    expect(svc.current().fetchedAt).not.toBe(first);
    expect(svc.current().warnings).toHaveLength(2);
  });

  it('таймер зупиняється разом із модулем', () => {
    const { svc } = make({ intervalMs: 1_000 });
    svc.onModuleInit();
    svc.onModuleDestroy();
    // Другий виклик не має падати — саме так Nest і робить при перезапуску.
    expect(() => svc.onModuleDestroy()).not.toThrow();
  });
});

describe('🔴 CAMP-302: справжній завантажувач, не заглушка', () => {
  // 🔴 ЦЕЙ БЛОК ІСНУЄ ТОМУ, ЩО ЙОГО НЕ БУЛО. Кожен тест вище підставляє
  // свій `loader`, тож справжнього шляху не торкався жоден — а перша
  // редакція падала б у продакшні при першому ж оберті:
  // `"module": "commonjs"` перетворює `import()` на `require()`, і на
  // ESM із верхньорівневим await це `ERR_REQUIRE_ASYNC_MODULE`.

  it('файл фетчера знаходиться вгору від модуля', () => {
    expect(findFetcher()).not.toBeNull();
  });

  // 🔴 А ЧИ ВІН СПРАВДІ ЗАВАНТАЖУЄТЬСЯ — ДОВОДИТЬСЯ НЕ ТУТ, і це не
  // лінощі. Jest виконує модулі у власній VM, де динамічний імпорт ESM
  // дає `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` — тобто Jest не може
  // відтворити те, що робить зібраний API. Доказ живе в
  // `apps/api/test/warnings-loader.probe.cjs`: звичайний Node,
  // звичайний CommonJS, 5 перевірок, і він ганяється в CI.
  //
  // Якби я лишив цю перевірку тут, вона або падала б завжди, або — що
  // гірше — я підставив би заглушку й назвав це доказом.

  it('якщо файлу немає, пошук каже null, а не кидає', () => {
    expect(findFetcher('/')).toBeNull();
  });
});
