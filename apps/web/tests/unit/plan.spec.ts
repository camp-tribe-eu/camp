import { expect, test } from '@playwright/test';

import {
  checkDraft,
  EMPTY_DRAFT,
  FIELD_ORDER,
  initialState,
  MAX_DAYS,
  MAX_PLACE,
  planReducer,
  settle,
  type PlanAction,
  type PlanDraft,
  type PlanOutcome,
  type PlanRequest,
  type PlanState,
  type Planner,
} from '@/lib/plan';
import { planRoute } from '@/lib/plan-source';

// CAMP-205 — правила /plan, без браузера.
//
// 🔴 Тут перевіряється те, що не видно, поки джерело відповідає
// миттєво: що буде, коли воно стане повільним, впаде чи поверне сміття.
// Сьогодні ці гілки недосяжні з браузера, тому й тримаються тут — кожна
// має мутацію, яка її червонить (див. PR).

const GOOD: PlanDraft = { from: 'Ljubljana', to: 'Split', days: '7', vehicleId: 'motorhome' };
const REQUEST: PlanRequest = { from: 'Ljubljana', to: 'Split', days: 7, vehicleId: 'motorhome' };

const errorsOf = (draft: Partial<PlanDraft>) => {
  const r = checkDraft({ ...GOOD, ...draft });
  return r.ok ? {} : r.errors;
};

test.describe('checkDraft', () => {
  test('правильна форма дає запит із обрізаними рядками й числом днів', () => {
    const r = checkDraft({ from: '  Ljubljana ', to: ' Split', days: ' 007 ', vehicleId: 'campervan' });
    expect(r).toEqual({
      ok: true,
      request: { from: 'Ljubljana', to: 'Split', days: 7, vehicleId: 'campervan' },
    });
  });

  test('🔴 порожня форма скаржиться на всі чотири поля, а не на перше', () => {
    const r = checkDraft(EMPTY_DRAFT);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual([...FIELD_ORDER].sort());
  });

  test('FIELD_ORDER — це рівно поля чернетки', () => {
    // Підсумок помилок іде в цьому порядку; поле, якого тут немає,
    // мовчки випало б із підсумку.
    expect([...FIELD_ORDER].sort()).toEqual(Object.keys(EMPTY_DRAFT).sort());
  });

  test('🔴 пробіли замість назви — це порожньо', () => {
    expect(errorsOf({ from: '   ' }).from).toMatch(/starts/);
    expect(errorsOf({ to: '   ' }).to).toMatch(/ends/);
  });

  test('назва місця: 120 символів можна, 121 — ні, і рахується обрізане', () => {
    expect(errorsOf({ from: 'a'.repeat(MAX_PLACE) }).from).toBeUndefined();
    expect(errorsOf({ from: 'a'.repeat(MAX_PLACE + 1) }).from).toBe(`Use ${MAX_PLACE} characters or fewer.`);
    expect(errorsOf({ to: 'a'.repeat(MAX_PLACE + 1) }).to).toBe(`Use ${MAX_PLACE} characters or fewer.`);
    // Пробіли по краях не рахуються — отже, і не відмовляють.
    expect(errorsOf({ from: ` ${'a'.repeat(MAX_PLACE)} ` }).from).toBeUndefined();
  });

  test('🔴 дні: межі 1 і MAX_DAYS включно, 0 і MAX_DAYS+1 — ні', () => {
    expect(errorsOf({ days: '1' }).days).toBeUndefined();
    expect(errorsOf({ days: String(MAX_DAYS) }).days).toBeUndefined();
    expect(errorsOf({ days: '0' }).days).toBe(`Days must be between 1 and ${MAX_DAYS}.`);
    expect(errorsOf({ days: String(MAX_DAYS + 1) }).days).toBe(`Days must be between 1 and ${MAX_DAYS}.`);
  });

  test('🔴 дні: усе, що не ціле число, — окреме повідомлення, а не «між 1 і 60»', () => {
    for (const bad of ['7.5', '7,5', '-3', '+3', '1e2', 'seven', '7 days', '٣']) {
      expect(errorsOf({ days: bad }).days, bad).toBe('Use a whole number of days, for example 7.');
    }
    expect(errorsOf({ days: '' }).days).toBe('Enter how many days the trip lasts.');
    expect(errorsOf({ days: '   ' }).days).toBe('Enter how many days the trip lasts.');
  });

  test('🔴 дні: величезне число — помилка діапазону, а не нескінченність у запиті', () => {
    const r = checkDraft({ ...GOOD, days: '9'.repeat(400) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.days).toBe(`Days must be between 1 and ${MAX_DAYS}.`);
  });

  test('транспорт: порожній і невідомий однаково не проходять', () => {
    expect(errorsOf({ vehicleId: '' }).vehicleId).toBe('Choose your vehicle.');
    expect(errorsOf({ vehicleId: 'tank' }).vehicleId).toBe('Choose your vehicle.');
    // І не з прототипа об'єкта.
    expect(errorsOf({ vehicleId: 'constructor' }).vehicleId).toBe('Choose your vehicle.');
  });

  test('«звідки» дорівнює «куди» — це коло, а не помилка', () => {
    expect(checkDraft({ ...GOOD, from: 'Bled', to: 'Bled' }).ok).toBe(true);
  });

  test('один зіпсований рядок не ховає решту: помилка рівно в одному полі', () => {
    expect(Object.keys(errorsOf({ days: 'x' }))).toEqual(['days']);
  });
});

test.describe('settle — джерело не може зламати сторінку', () => {
  const answers = (outcome: unknown): Planner => async () => outcome as PlanOutcome;

  test('чесні відповіді проходять без змін', async () => {
    expect(await settle(answers({ status: 'unavailable' }), REQUEST)).toEqual({ status: 'unavailable' });
    expect(await settle(answers({ status: 'failed' }), REQUEST)).toEqual({ status: 'failed' });
  });

  test('🔴 запит доходить до джерела таким, яким пройшов перевірку', async () => {
    let seen: PlanRequest | undefined;
    await settle(async (r) => {
      seen = r;
      return { status: 'unavailable' };
    }, REQUEST);
    expect(seen).toEqual(REQUEST);
  });

  test('🔴 відхилений проміс — це failed', async () => {
    expect(await settle(() => Promise.reject(new Error('network down')), REQUEST)).toEqual({ status: 'failed' });
  });

  test('🔴 синхронне виключення — теж failed', async () => {
    const throwing = (() => {
      throw new Error('boom');
    }) as unknown as Planner;
    expect(await settle(throwing, REQUEST)).toEqual({ status: 'failed' });
  });

  test('🔴 сміття замість відповіді — failed, у всіх його видах', async () => {
    for (const junk of [undefined, null, 0, 'unavailable', [], {}, { status: 7 }, { status: 'routed' }, { Status: 'unavailable' }]) {
      expect(await settle(answers(junk), REQUEST), JSON.stringify(junk)).toEqual({ status: 'failed' });
    }
  });

  test('🔴 статус з прототипа об’єкта — не статус', async () => {
    // `'constructor' in {}` — true. Перевірка через `in` пропустила б це
    // як відповідь, а сторінка потім не знала б, що малювати.
    for (const status of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(await settle(answers({ status }), REQUEST), status).toEqual({ status: 'failed' });
    }
  });

  test('джерело сьогодні: каже, що не рахує, — і це відповідь, а не збій', async () => {
    // 🔴 Єдиний тест, який МАЄ змінитись, коли CAMP-46 зробить алгоритм.
    // Він зафіксував сьогоднішній факт; коли факт зміниться, червоний
    // тест — це нагадування, що речення «не рахує» на сторінці тепер
    // неправда.
    expect(await settle(planRoute, REQUEST)).toEqual({ status: 'unavailable' });
  });
});

test.describe('planReducer', () => {
  const act = (state: PlanState, ...actions: PlanAction[]) => actions.reduce(planReducer, state);
  const typed = (state: PlanState, draft: PlanDraft) =>
    act(state, ...(Object.entries(draft) as [keyof PlanDraft, string][]).map(
      ([field, value]) => ({ type: 'edit', field, value }) as const,
    ));
  const filled = () => typed(initialState(), GOOD);

  test('початок: порожньо, нічого не запитано, нічого не відхилено', () => {
    const s = initialState();
    expect(s.draft).toEqual(EMPTY_DRAFT);
    expect(s.errors).toEqual({});
    expect(s.rejected).toBe(0);
    expect(s.run).toEqual({ phase: 'idle' });
  });

  test('невдала відправка: помилки є, лічильник зріс, запиту немає', () => {
    const s = act(initialState(), { type: 'submit' });
    expect(Object.keys(s.errors).sort()).toEqual([...FIELD_ORDER].sort());
    expect(s.rejected).toBe(1);
    expect(s.run).toEqual({ phase: 'idle' });
    expect(act(s, { type: 'submit' }).rejected).toBe(2);
  });

  test('вдала відправка: запит іде з номером, помилки зникають, лічильник стоїть', () => {
    const s = act(initialState(), { type: 'submit' }); // одна невдала
    const next = act(typed(s, GOOD), { type: 'submit' });
    expect(next.run).toEqual({ phase: 'pending', id: 1, request: REQUEST });
    expect(next.errors).toEqual({});
    expect(next.rejected).toBe(1);
  });

  test('🔴 редагування прибирає помилку лише того поля, яке виправляють', () => {
    const s = act(initialState(), { type: 'submit' });
    const fixed = act(s, { type: 'edit', field: 'days', value: '7' });
    expect(fixed.errors.days).toBeUndefined();
    expect(fixed.errors.from).toBeDefined();
    expect(fixed.errors.to).toBeDefined();
    expect(fixed.errors.vehicleId).toBeDefined();
    expect(fixed.draft.days).toBe('7');
  });

  test('🔴 правило 1: змінив поле — результат зникає', () => {
    const done = act(filled(), { type: 'submit' }, { type: 'settled', id: 1, outcome: { status: 'unavailable' } });
    expect(done.run.phase).toBe('done');
    const edited = act(done, { type: 'edit', field: 'to', value: 'Zadar' });
    expect(edited.run).toEqual({ phase: 'idle' });
  });

  test('🔴 правило 2: відповідь на скасований запит не затирає нового', () => {
    // Запит 1 пішов, людина виправила поле, відправила знову (запит 2),
    // і тільки тоді прийшла відповідь на запит 1.
    let s = act(filled(), { type: 'submit' });
    expect(s.run).toMatchObject({ phase: 'pending', id: 1 });
    s = act(s, { type: 'edit', field: 'to', value: 'Zadar' }, { type: 'submit' });
    expect(s.run).toMatchObject({ phase: 'pending', id: 2 });

    const late = act(s, { type: 'settled', id: 1, outcome: { status: 'failed' } });
    expect(late).toBe(s); // не змінилось нічого, навіть посилання
    const right = act(s, { type: 'settled', id: 2, outcome: { status: 'unavailable' } });
    expect(right.run).toMatchObject({ phase: 'done', id: 2, outcome: { status: 'unavailable' } });
    expect(right.run.phase === 'done' && right.run.request.to).toBe('Zadar');
  });

  test('🔴 відповідь на запит, який скасувало редагування, ігнорується', () => {
    const editing = act(filled(), { type: 'submit' }, { type: 'edit', field: 'days', value: '9' });
    expect(editing.run).toEqual({ phase: 'idle' });
    const late = act(editing, { type: 'settled', id: 1, outcome: { status: 'unavailable' } });
    expect(late).toBe(editing);
  });

  test('відповідь без запиту, і друга відповідь на той самий запит, ігноруються', () => {
    const idle = filled();
    expect(act(idle, { type: 'settled', id: 1, outcome: { status: 'failed' } })).toBe(idle);
    const done = act(idle, { type: 'submit' }, { type: 'settled', id: 1, outcome: { status: 'unavailable' } });
    // Дев-режим React викликає ефект двічі; друга відповідь не має права
    // змінити вже показане.
    expect(act(done, { type: 'settled', id: 1, outcome: { status: 'failed' } })).toBe(done);
  });

  test('🔴 правило 3: друга відправка, поки перша йде, нічого не змінює', () => {
    const pending = act(filled(), { type: 'submit' });
    expect(act(pending, { type: 'submit' })).toBe(pending);
  });

  test('номери запитів не повторюються, навіть коли відправляють те саме знову', () => {
    let s = act(filled(), { type: 'submit' }, { type: 'settled', id: 1, outcome: { status: 'unavailable' } });
    s = act(s, { type: 'submit' });
    expect(s.run).toMatchObject({ phase: 'pending', id: 2 });
    s = act(s, { type: 'settled', id: 2, outcome: { status: 'unavailable' } }, { type: 'submit' });
    expect(s.run).toMatchObject({ phase: 'pending', id: 3 });
  });

  test('🔴 ІНВАРІАНТ: панель ніколи не описує запит, відмінний від того, що в формі', () => {
    // Не окремі сценарії, а будь-яка послідовність дій: 400 випадкових
    // (із зафіксованим зерном, щоб червоний прогін можна було повторити)
    // по 60 кроків. Після КОЖНОГО кроку: якщо щось відправлено або
    // показано, то форма зараз саме про це, і номери запитів не
    // повторюються.
    const rng = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // Правильних значень більше, ніж хибних: інакше форма майже ніколи
    // не буває валідною, і половина інваріанта — про порожнечу.
    const values: Record<keyof PlanDraft, string[]> = {
      from: ['', ' ', 'Bled', 'Zadar', 'Bled', 'Zadar', 'Bled'],
      to: ['', 'Split', 'Bled', 'Split', 'Bled', 'Split'],
      days: ['', '0', '7', '7.5', '61', '14', '7', '14', '7'],
      vehicleId: ['', 'tank', 'campervan', 'motorhome', 'campervan', 'motorhome'],
    };
    let submitted = 0;
    let shown = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const next = rng(seed);
      const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)];
      let s = initialState();
      const requestOfId = new Map<number, string>();
      for (let step = 0; step < 60; step++) {
        const roll = next();
        const action: PlanAction =
          roll < 0.45
            ? { type: 'edit', field: pick(FIELD_ORDER), value: '' }
            : roll < 0.8
              ? { type: 'submit' }
              : {
                  type: 'settled',
                  // Здебільшого відповідь на живий запит, інколи — на чужий.
                  id: s.run.phase === 'pending' && next() < 0.8 ? s.run.id : 1 + Math.floor(next() * 6),
                  outcome: { status: 'unavailable' },
                };
        if (action.type === 'edit') action.value = pick(values[action.field]);
        s = planReducer(s, action);

        if (s.run.phase !== 'idle') {
          const now = checkDraft(s.draft);
          expect(now.ok, `seed ${seed} step ${step}: форма невалідна, а запит живий`).toBe(true);
          if (now.ok) expect(s.run.request, `seed ${seed} step ${step}`).toEqual(now.request);
          if (s.run.phase === 'pending') submitted++;
          else shown++;
        }
        if (s.run.phase !== 'idle') {
          expect(s.run.id).toBeLessThan(s.nextId);
          // Один номер — один запит: інакше пізня відповідь на старий
          // запит мала б право лягти на новий.
          const text = JSON.stringify(s.run.request);
          const earlier = requestOfId.get(s.run.id);
          if (earlier === undefined) requestOfId.set(s.run.id, text);
          else expect(text, `seed ${seed} step ${step}: номер ${s.run.id} віддано двом запитам`).toBe(earlier);
        }
      }
    }
    // 🔴 Інваріант, перевірений над порожнечею, нічого не доводить:
    // прогін мусить реально доходити і до запиту, і до показаного
    // результату.
    expect(submitted).toBeGreaterThan(100);
    expect(shown).toBeGreaterThan(100);
  });
});
