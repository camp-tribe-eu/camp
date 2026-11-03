import { OwnerListingService } from './owner-listing.service';
import type { SpotClaimService } from './spot-claim.service';

// CAMP-51 / CAMP-86 — ПОРЯДОК перевірок і те, що бачить чужий.
//
// 🔴 ЦЕ ТЕСТ ПРО ВІДМОВИ, А НЕ ПРО ЩАСЛИВИЙ ШЛЯХ. `auth/ownership.ts`
// каже це прямо: зламану авторизацію не ловить жодна кількість перевірок
// щасливого шляху, бо щасливий шлях — це власник, що читає СВОЄ.
//
// 🔴 І ЧОМУ СТАБ ТУТ ЧЕСНИЙ. Він не повторює логіку сервісу: він віддає
// РЯДКИ (що знайшлось у таблиці) і булеве (чи є грант), а перевіряється
// рішення, яке сервіс із них ухвалює. Стаб, написаний за формулою коду,
// підтверджував би його ж баг — цей нічого не обчислює.

type Row = Record<string, unknown>;

function serviceWith(opts: {
  spot?: Row | null;
  owner: boolean;
  onUpdate?: (sql: string, params: unknown[]) => unknown;
}) {
  const seen: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      seen.push({ sql, params });
      if (/FROM camping_spots WHERE slug/.test(sql))
        return opts.spot === null
          ? []
          : [opts.spot ?? { id: 's1', owner_overrides: {} }];
      if (/UPDATE camping_spots/.test(sql))
        return opts.onUpdate?.(sql, params) ?? [[{ id: 's1' }], 1];
      return [];
    },
  };
  const claims = {
    isOwner: async () => opts.owner,
  } as unknown as SpotClaimService;
  return {
    svc: new OwnerListingService(db as never, claims),
    seen,
  };
}

describe('хто може правити листинг', () => {
  it('власник — може', async () => {
    const { svc } = serviceWith({ owner: true });
    const res = await svc.edit('alpenblick', 'u1', { name: 'A' });
    expect(res).toEqual({ ok: true, overrides: { name: 'A' } });
  });

  it('🔴 анонім — відмова, і до бази запиту НЕ ЙДЕ', async () => {
    const { svc, seen } = serviceWith({ owner: true });
    expect(await svc.edit('x', null, { name: 'A' })).toEqual({
      ok: false,
      why: 'anonymous',
    });
    expect(seen).toHaveLength(0);
  });

  it('🔴 чужий кемпінг і НЕІСНУЮЧИЙ відповідають однаково', async () => {
    // Інакше різниця між «not-yours» і «no-spot» перетворює кінцеву
    // точку на довідник про те, які slug справжні.
    const stranger = serviceWith({ owner: false });
    const missing = serviceWith({ owner: true, spot: null });
    expect(await stranger.svc.edit('x', 'u2', { name: 'A' })).toEqual({
      ok: false,
      why: 'not-yours',
    });
    expect(await missing.svc.edit('x', 'u1', { name: 'A' })).toEqual({
      ok: false,
      why: 'not-yours',
    });
  });

  it('🔴 чужий НЕ дізнається навіть того, що правка погана', async () => {
    // Права перевіряються ДО вмісту. Інакше «поле website не
    // редагується» на чужий кемпінг каже, що кемпінг існує.
    const { svc } = serviceWith({ owner: false });
    const res = await svc.edit('x', 'u2', { website: 'https://x.invalid' });
    expect(res).toEqual({ ok: false, why: 'not-yours' });
  });

  it('🔴 і нічого не пише в базу, коли відмовив', async () => {
    const { svc, seen } = serviceWith({ owner: false });
    await svc.edit('x', 'u2', { name: 'A' });
    expect(seen.some((q) => /UPDATE/.test(q.sql))).toBe(false);
  });

  it('власникові погана правка каже, ЩО САМЕ не так', async () => {
    const { svc, seen } = serviceWith({ owner: true });
    const res = await svc.edit('x', 'u1', { website: 'https://x.invalid' });
    expect(res.ok).toBe(false);
    if (res.ok === false && res.why === 'bad-patch') {
      expect(res.faults[0]).toContain('website');
    } else {
      throw new Error(`чекали bad-patch, отримали ${JSON.stringify(res)}`);
    }
    expect(seen.some((q) => /UPDATE/.test(q.sql))).toBe(false);
  });
});

describe('що саме лягає в колонку', () => {
  it('правка накладається на наявні, а не затирає їх', async () => {
    const { svc, seen } = serviceWith({
      owner: true,
      spot: {
        id: 's1',
        owner_overrides: { name: 'Old', amenities: { wifi: 'no' } },
      },
    });
    const res = await svc.edit('x', 'u1', { amenities: { shower: 'yes' } });
    expect(res).toEqual({
      ok: true,
      overrides: { name: 'Old', amenities: { wifi: 'no', shower: 'yes' } },
    });
    // І в SQL іде саме це, рядком JSON — не об'єктом і не фрагментом.
    const upd = seen.find((q) => /UPDATE/.test(q.sql));
    expect(JSON.parse(String(upd?.params[1]))).toEqual({
      name: 'Old',
      amenities: { wifi: 'no', shower: 'yes' },
    });
  });

  it('🔴 UPDATE, що не зачепив жодного рядка, — це не успіх', async () => {
    const { svc } = serviceWith({
      owner: true,
      onUpdate: () => [[], 0],
    });
    expect(await svc.edit('x', 'u1', { name: 'A' })).toEqual({
      ok: false,
      why: 'no-spot',
    });
  });
});
