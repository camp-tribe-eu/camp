import { expect, test } from '@playwright/test';

import {
  checkDraft,
  EMPTY_DRAFT,
  fieldOrder,
  initialState,
  MAX_DAYS,
  MAX_VIA,
  planReducer,
  planTrip,
  splitDays,
  straightM,
  type ChosenPlace,
  type LegRequest,
  type LegResult,
  type PlanAction,
  type PlanDraft,
  type PlanRequest,
  type PlanState,
} from '@/lib/plan';

// CAMP-456 — поїздка з проміжними точками, зворотним шляхом і габаритами,
// без браузера. Правила чернетки однієї пари точок — у plan.spec.ts; тут те,
// що додалося: перегони, дні між ними, габарити, порядок проміжних точок.

const A = '46.0, 14.0';
const B = '45.0, 15.0';
const C = '44.0, 16.0';
/** Підпис зупинки з координатами — числа в нормалізованому вигляді, як їх друкує форма. */
const LA = '46, 14';
const LB = '45, 15';
const LC = '44, 16';

const BASE: PlanDraft = { ...EMPTY_DRAFT, from: A, to: C, days: '9' };

const withVia = (...texts: string[]): PlanDraft => ({
  ...BASE,
  via: texts.map((text, i) => ({ id: String(i + 1), text, place: null })),
});

const errorsOf = (draft: PlanDraft) => {
  const r = checkDraft(draft);
  return r.ok ? {} : r.errors;
};

const REQUIRED = ['from', 'to', 'days'] as const;

const LEG: LegRequest = {
  from: { label: LA, point: { lat: 46, lon: 14 } },
  to: { label: LC, point: { lat: 44, lon: 16 } },
  days: 9,
  offset: 0,
};
const answer = (status: 'failed' | 'throttled'): LegResult[] => [{ leg: LEG, outcome: { status } }];

test.describe('straightM — пряма між точками, лише щоб поділити дні', () => {
  // 🔴 Корпус не ділить поле з тим, що міряє: відповіді тут — геометрія кулі,
  // виписана руками (градус по меридіану й по екватору на кулі радіуса
  // 6 371 008,8 м — це 2πR/360), а не результат іншого виклику цієї ж функції.
  const DEGREE_M = (2 * Math.PI * 6_371_008.8) / 360;

  test('градус по екватору й по меридіану — 111 195 м', () => {
    expect(straightM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(DEGREE_M, 0);
    expect(straightM({ lat: 10, lon: 20 }, { lat: 11, lon: 20 })).toBeCloseTo(DEGREE_M, 0);
  });

  test('одна точка — нуль, і порядок точок не важить', () => {
    expect(straightM({ lat: 46, lon: 14 }, { lat: 46, lon: 14 })).toBe(0);
    const ab = straightM({ lat: 46, lon: 14 }, { lat: 43.5, lon: 16.4 });
    expect(straightM({ lat: 43.5, lon: 16.4 }, { lat: 46, lon: 14 })).toBeCloseTo(ab, 6);
  });
});

test.describe('splitDays — дні між перегонами', () => {
  test('виписано руками: порівну, залишок — за найбільшою дробовою часткою, а за рівності — першому', () => {
    expect(splitDays(4, [1, 1, 1])).toEqual([2, 1, 1]);
    expect(splitDays(3, [5, 5, 5])).toEqual([1, 1, 1]);
    // spare 6 за вагами 1:2:6 → 0.67, 1.33, 4 → [1,2,5] + залишок 1 → перший
    expect(splitDays(9, [1, 2, 6])).toEqual([2, 2, 5]);
  });

  test('🔴 довший перегін не отримує менше днів, ніж коротший; сума завжди дорівнює числу днів', () => {
    const rng = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let seed = 1; seed <= 500; seed++) {
      const next = rng(seed);
      const n = 1 + Math.floor(next() * 7);
      const lengths = Array.from({ length: n }, () => Math.floor(next() * 900_000));
      const total = n + Math.floor(next() * (MAX_DAYS - n + 1));
      const out = splitDays(total, lengths);
      expect(out.reduce((s, d) => s + d, 0), `seed ${seed}`).toBe(total);
      for (const d of out) expect(d, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          if (lengths[i] > lengths[j]) expect(out[i], `seed ${seed}`).toBeGreaterThanOrEqual(out[j]);
    }
  });

  test('перегони нульової довжини діляться порівну, а днів менше за перегони — помилка, не здогад', () => {
    expect(splitDays(6, [0, 0, 0])).toEqual([2, 2, 2]);
    expect(() => splitDays(2, [1, 1, 1])).toThrow();
    expect(splitDays(5, [])).toEqual([]);
  });
});

test.describe('fieldOrder', () => {
  test('«звідки», проміжні, «куди», дні, габарити — у порядку екрана', () => {
    // Підсумок помилок іде в цьому порядку; поле, якого тут немає,
    // мовчки випало б із підсумку.
    expect(fieldOrder(EMPTY_DRAFT)).toEqual(['from', 'to', 'days', 'height', 'length', 'weight']);
    const via = [
      { id: '4', text: '', place: null },
      { id: '2', text: '', place: null },
    ];
    expect(fieldOrder({ via })).toEqual(['from', 'via-4', 'via-2', 'to', 'days', 'height', 'length', 'weight']);
  });
});

test.describe('checkDraft — проміжні точки, зворотний шлях, габарити', () => {
  test('A → B → C: два перегони, дні поділені, нумерація наскрізна', () => {
    const r = checkDraft(withVia(B));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.trip.legs.map((l) => [l.from.label, l.to.label])).toEqual([
      [LA, LB],
      [LB, LC],
    ]);
    expect(r.trip.legs.reduce((s, l) => s + l.days, 0)).toBe(9);
    expect(r.trip.legs[0].offset).toBe(0);
    expect(r.trip.legs[1].offset).toBe(r.trip.legs[0].days);
  });

  test('🔴 зворотний шлях додає перегін назад до старту: A → C → A', () => {
    const r = checkDraft({ ...withVia(), roundTrip: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.trip.legs.map((l) => [l.from.label, l.to.label])).toEqual([
      [LA, LC],
      [LC, LA],
    ]);
    // Той самий шлях удвічі: порівну, зайвий день — першому.
    expect(r.trip.legs.map((l) => l.days)).toEqual([5, 4]);
  });

  test('🔴 днів менше, ніж перегонів, — помилка на полі днів, а не перегін без дня', () => {
    const r = checkDraft({ ...withVia(B), roundTrip: true, days: '2' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.days).toBe('This trip has 3 legs, so it needs at least 3 days: one per leg.');
    expect(checkDraft({ ...withVia(B), roundTrip: true, days: '3' }).ok).toBe(true);
  });

  test('🔴 зіпсована проміжна точка — помилка саме її поля, решта цілі', () => {
    const r = checkDraft(withVia(B, 'Nowhere', C));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors)).toEqual(['via-2']);
    expect(r.errors['via-2']).toContain('is not guessed.');
  });

  test('більше за MAX_VIA проміжних — відмова, навіть якщо прийшло з посилання', () => {
    const many = Array.from({ length: MAX_VIA + 1 }, () => B);
    const tooMany = { ...withVia(...many), days: '30' };
    expect(checkDraft(tooMany).ok).toBe(false);
    expect(checkDraft({ ...tooMany, via: tooMany.via.slice(1) }).ok).toBe(true);
  });

  test('🔴 габарити: межі включно, кома й крапка, пусте — без помилки, поза межею — з нею', () => {
    const sizes = (vehicle: Partial<PlanDraft['vehicle']>) =>
      errorsOf({ ...BASE, vehicle: { type: '', height: '', length: '', weight: '', ...vehicle } });
    expect(sizes({})).toEqual({});
    expect(sizes({ height: '1', length: '2', weight: '0.5' })).toEqual({});
    expect(sizes({ height: '4.5', length: '18,75', weight: '44' })).toEqual({});
    expect(sizes({ height: '0.9' }).height).toBe('Height must be between 1 and 4.5 metres.');
    expect(sizes({ height: '4.51' }).height).toBe('Height must be between 1 and 4.5 metres.');
    expect(sizes({ length: '19' }).length).toBe('Length must be between 2 and 18.75 metres.');
    expect(sizes({ weight: '45' }).weight).toBe('Weight must be between 0.5 and 44 tonnes.');
    for (const bad of ['tall', '3.1m', '-3', '3..1', '1e1', '３']) {
      expect(sizes({ height: bad }).height, bad).toBe('Height is a number in metres, for example 3.1.');
    }
  });
});

test.describe('planTrip — перегони, і один зіпсований коштує одного', () => {
  const trip = () => {
    const r = checkDraft({ ...withVia(B), days: '6' });
    if (!r.ok) throw new Error('fixture');
    return r.trip;
  };

  test('кожен перегін питається окремо, зі своїми днями, і відповіді йдуть у порядку перегонів', async () => {
    const asked: PlanRequest[] = [];
    const legs = await planTrip(async (req) => {
      asked.push(req);
      return { status: 'throttled' };
    }, trip());
    expect(asked.map((q) => [q.from.lat, q.to.lat])).toEqual([
      [46, 45],
      [45, 44],
    ]);
    expect(asked.reduce((s, q) => s + q.days, 0)).toBe(6);
    expect(legs.map((l) => l.leg.offset)).toEqual([0, asked[0].days]);
  });

  test('🔴 один перегін упав — він failed, а другий лишається тим, чим відповіло джерело', async () => {
    let n = 0;
    const legs = await planTrip(async () => {
      if (n++ === 0) throw new Error('boom');
      return { status: 'throttled' };
    }, trip());
    expect(legs.map((l) => l.outcome.status)).toEqual(['failed', 'throttled']);
  });
});

test.describe('planReducer — проміжні точки, зворотний шлях, посилання', () => {
  const act = (state: PlanState, ...actions: PlanAction[]) => actions.reduce(planReducer, state);
  const ids = (s: PlanState) => s.draft.via.map((v) => v.id);
  const bled: ChosenPlace = {
    kind: 'town',
    name: 'Bled',
    country: 'si',
    lat: 46.3683,
    lon: 14.1146,
    label: 'Bled, Slovenia',
  };

  test('додати: нові точки мають свої номери, і видалена не віддає номер наступній', () => {
    let s = act(initialState(), { type: 'add-via' }, { type: 'add-via' });
    expect(ids(s)).toEqual(['1', '2']);
    s = act(s, { type: 'remove-via', id: '1' }, { type: 'add-via' });
    expect(ids(s)).toEqual(['2', '3']);
  });

  test('🔴 не більше MAX_VIA, і стан тоді не змінюється взагалі', () => {
    let s = initialState();
    for (let i = 0; i < MAX_VIA; i++) s = act(s, { type: 'add-via' });
    expect(s.draft.via).toHaveLength(MAX_VIA);
    expect(act(s, { type: 'add-via' })).toBe(s);
  });

  test('переставити: за номером і за місцем, не виходячи за межі; те саме місце — той самий стан', () => {
    let s = act(initialState(), { type: 'add-via' }, { type: 'add-via' }, { type: 'add-via' });
    s = act(s, { type: 'move-via', id: '3', to: 0 });
    expect(ids(s)).toEqual(['3', '1', '2']);
    s = act(s, { type: 'move-via', id: '3', to: 99 });
    expect(ids(s)).toEqual(['1', '2', '3']);
    expect(act(s, { type: 'move-via', id: '2', to: 1 })).toBe(s);
    expect(act(s, { type: 'move-via', id: 'nope', to: 0 })).toBe(s);
  });

  test('🔴 переставлена точка тягне за собою свій текст і своє місце, а не лишає їх на місці', () => {
    let s = act(initialState(), { type: 'add-via' }, { type: 'add-via' });
    s = act(s, { type: 'pick', field: 'via-1', place: bled }, { type: 'edit', field: 'via-2', value: '45, 15' });
    s = act(s, { type: 'move-via', id: '1', to: 1 });
    expect(s.draft.via.map((v) => [v.id, v.text, v.place?.name ?? null])).toEqual([
      ['2', '45, 15', null],
      ['1', 'Bled, Slovenia', 'Bled'],
    ]);
  });

  test('🔴 правило 1 для нових дій: зміна чернетки скидає результат', () => {
    const filled = act(initialState(), { type: 'load', draft: { ...BASE, days: '7' } });
    const done = act(filled, { type: 'submit' }, { type: 'settled', id: 1, legs: answer('throttled') });
    expect(done.run.phase).toBe('done');
    const actions: PlanAction[] = [
      { type: 'add-via' },
      { type: 'round-trip', value: true },
      { type: 'vehicle-type', value: 'tent' },
      { type: 'edit', field: 'height', value: '3' },
    ];
    for (const a of actions) expect(act(done, a).run, a.type).toEqual({ phase: 'idle' });
  });

  test('вписати руками після вибору прибирає обране місце', () => {
    const picked = act(initialState(), { type: 'pick', field: 'from', place: bled });
    expect(picked.draft.from).toBe('Bled, Slovenia');
    expect(picked.draft.fromPlace).toEqual(bled);
    const edited = act(picked, { type: 'edit', field: 'from', value: 'Bled, Slovenia!' });
    expect(edited.draft.fromPlace).toBeNull();
  });

  test('🔴 обране місце приймається, а змінене після вибору — вже ні', () => {
    const picked = act(initialState(), { type: 'load', draft: BASE }, { type: 'pick', field: 'from', place: bled });
    const ok = checkDraft(picked.draft);
    expect(ok.ok && ok.trip.stops[0]).toEqual({ label: 'Bled, Slovenia', point: { lat: 46.3683, lon: 14.1146 } });
    const changed = act(picked, { type: 'edit', field: 'from', value: 'Bled, Slovenia x' });
    expect(errorsOf(changed.draft).from).toContain('is not guessed.');
    // Місце лишилось у чернетці, а в полі координати: перемагають координати як вписані.
    const typed = checkDraft({ ...picked.draft, from: '45, 14' });
    expect(typed.ok && typed.trip.stops[0].point).toEqual({ lat: 45, lon: 14 });
  });

  test('«зворотний шлях» міняє кількість перегонів, тож стара помилка днів зникає', () => {
    let s = act(
      initialState(),
      { type: 'load', draft: { ...BASE, days: '1' } },
      { type: 'round-trip', value: true },
      { type: 'submit' },
    );
    expect(s.errors.days).toContain('at least 2 days');
    s = act(s, { type: 'round-trip', value: false });
    expect(s.errors.days).toBeUndefined();
  });

  test('load замінює чернетку цілком, скидає помилки й результат, а лічильник точок іде за найбільшим номером', () => {
    const bad = act(initialState(), { type: 'submit' });
    expect(Object.keys(bad.errors).length).toBeGreaterThan(0);
    const s = act(bad, { type: 'load', draft: withVia(B, B) });
    expect(s.errors).toEqual({});
    expect(s.run).toEqual({ phase: 'idle' });
    expect(ids(act(s, { type: 'add-via' }))).toEqual(['1', '2', '3']);
  });

  test('validate: показує помилки й нічого не запитує; для правильної чернетки — лише чистить помилки', () => {
    const bad = act(initialState(), { type: 'validate' });
    expect(Object.keys(bad.errors).sort()).toEqual([...REQUIRED].sort());
    expect(bad.rejected).toBe(1);
    expect(bad.run).toEqual({ phase: 'idle' });
    const good = act(initialState(), { type: 'load', draft: BASE }, { type: 'validate' });
    expect(good.errors).toEqual({});
    expect(good.rejected).toBe(0);
    expect(good.run).toEqual({ phase: 'idle' });
  });
});
