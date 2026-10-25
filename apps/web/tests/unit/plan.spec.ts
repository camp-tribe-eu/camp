import { expect, test } from '@playwright/test';

import {
  checkDraft,
  EMPTY_DRAFT,
  EXAMPLE,
  FIELD_ORDER,
  initialState,
  MAX_DAYS,
  parsePoint,
  planReducer,
  settle,
  type PlanAction,
  type PlanDraft,
  type PlanOutcome,
  type PlanRequest,
  type PlanState,
  type Planner,
} from '@/lib/plan';

// CAMP-205 — правила /plan, без браузера.
// CAMP-391 — тепер поля місць — координати, а відповідь справжня.
//
// 🔴 Тут перевіряється те, що не видно, поки джерело відповідає
// миттєво: що буде, коли воно стане повільним, впаде чи поверне сміття.
// Ці гілки важко відтворити з браузера, тому й тримаються тут — кожна
// має мутацію, яка її червонить (див. PR).

const GOOD: PlanDraft = { from: '46.0569, 14.5058', to: '43.5081, 16.4402', days: '7' };
const REQUEST: PlanRequest = {
  from: { lat: 46.0569, lon: 14.5058 },
  to: { lat: 43.5081, lon: 16.4402 },
  days: 7,
};

const errorsOf = (draft: Partial<PlanDraft>) => {
  const r = checkDraft({ ...GOOD, ...draft });
  return r.ok ? {} : r.errors;
};

test.describe('parsePoint — «широта, довгота»', () => {
  const ok = (text: string) => {
    const r = parsePoint(text);
    return r.ok ? r.point : r.why;
  };

  test('🔴 що приймається: кома, крапка з комою, пробіл, градуси, мінус із мап', () => {
    const want = { lat: 46.0569, lon: 14.5058 };
    for (const text of [
      '46.0569, 14.5058',
      '46.0569,14.5058',
      '46.0569 14.5058',
      '46.0569;14.5058',
      '46.0569 ; 14.5058',
      '  46.0569  ,  14.5058  ',
      '+46.0569, +14.5058',
      '46.0569°, 14.5058°',
      '46.0569\t14.5058',
    ]) {
      expect(ok(text), JSON.stringify(text)).toEqual(want);
    }
    // «−» (U+2212), яким копіюють деякі застосунки, — теж мінус.
    expect(ok('\u221238.7223, \u22129.1393')).toEqual({ lat: -38.7223, lon: -9.1393 });
    expect(ok('-38.7223, -9.1393')).toEqual({ lat: -38.7223, lon: -9.1393 });
    expect(ok('46, 14')).toEqual({ lat: 46, lon: 14 });
  });

  test('межі земної кулі включно: ±90 і ±180', () => {
    expect(ok('90, 180')).toEqual({ lat: 90, lon: 180 });
    expect(ok('-90, -180')).toEqual({ lat: -90, lon: -180 });
    expect(ok('0, 0')).toEqual({ lat: 0, lon: 0 });
  });

  test('🔴 не приймається, і це «format», а не вгадування', () => {
    for (const text of [
      'Ljubljana',
      '46.0569',
      // Кома як десятковий роздільник: два числа чи чотири? Не вгадуємо.
      '46,0569 14,5058',
      '46,0569, 14,5058',
      '46.0569, 14.5058, 120',
      '46.0569 N, 14.5058 E',
      '1e2, 5',
      '46.0569,, 14.5058',
      ',',
      '46.0569/14.5058',
      '46.0569, abc',
      '٤٦.٠٥٦٩, ١٤.٥٠٥٨',
      '46.0569 -- 14.5058',
      '4 6.0569, 14.5058',
    ]) {
      expect(ok(text), JSON.stringify(text)).toBe('format');
    }
  });

  test('порожнє й самі пробіли — «empty»', () => {
    expect(ok('')).toBe('empty');
    expect(ok('   ')).toBe('empty');
    expect(ok('°')).toBe('empty');
  });

  test('🔴 поза кулею — «range», зокрема число, що не вміщається в число', () => {
    for (const text of ['91, 14', '-90.0001, 14', '46, 180.0001', '46, -181', `${'9'.repeat(400)}, 1`]) {
      expect(ok(text), text.slice(0, 30)).toBe('range');
    }
  });

  test('🔴 порядок — як надруковано: «широта перша» — це договір, а не вгадування', () => {
    // Любляна навпаки — це 14.5058°N 46.0569°E, у межах кулі, тож форма її
    // пропускає. Що це не Любляна, каже сервер (межі ЄС), і сторінка
    // підказує про порядок.
    expect(ok('14.5058, 46.0569')).toEqual({ lat: 14.5058, lon: 46.0569 });
  });
});

test.describe('checkDraft', () => {
  test('правильна форма дає запит із обрізаними рядками, числами й числом днів', () => {
    const r = checkDraft({ from: '  46.0569 ,14.5058 ', to: ' 43.5081;16.4402', days: ' 007 ' });
    expect(r).toEqual({ ok: true, request: REQUEST });
  });

  test('🔴 запит — рівно три ключі, і жодного транспорту: його ніхто не читає', () => {
    const r = checkDraft(GOOD);
    expect(r.ok && Object.keys(r.request).sort()).toEqual(['days', 'from', 'to']);
    expect(r.ok && Object.keys(r.request.from).sort()).toEqual(['lat', 'lon']);
  });

  test('🔴 порожня форма скаржиться на всі три поля, а не на перше', () => {
    const r = checkDraft(EMPTY_DRAFT);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual([...FIELD_ORDER].sort());
  });

  test('FIELD_ORDER — це рівно поля чернетки', () => {
    // Підсумок помилок іде в цьому порядку; поле, якого тут немає,
    // мовчки випало б із підсумку.
    expect([...FIELD_ORDER].sort()).toEqual(Object.keys(EMPTY_DRAFT).sort());
    expect([...FIELD_ORDER]).toEqual(['from', 'to', 'days']);
  });

  test('🔴 пробіли замість координат — це порожньо, і повідомлення називає приклад', () => {
    expect(errorsOf({ from: '   ' }).from).toBe(
      `Enter where the trip starts, as latitude and longitude, for example ${EXAMPLE.from}.`,
    );
    expect(errorsOf({ to: '   ' }).to).toBe(
      `Enter where the trip ends, as latitude and longitude, for example ${EXAMPLE.to}.`,
    );
  });

  test('🔴 назва замість координат: прямо кажемо, що назва не шукається', () => {
    expect(errorsOf({ from: 'Ljubljana' }).from).toBe(
      `Write where the trip starts as two numbers, latitude then longitude, for example ${EXAMPLE.from}. A place name is not looked up.`,
    );
    expect(errorsOf({ to: 'Split' }).to).toContain('A place name is not looked up.');
  });

  test('поза кулею: порядок названо, бо це найчастіша помилка', () => {
    expect(errorsOf({ from: '120, 14' }).from).toBe(
      'Latitude goes from -90 to 90 and longitude from -180 to 180. Latitude comes first.',
    );
  });

  test('приклад у підказці — це справжні координати Любляни й Сплита', () => {
    // Перевірено проти пари, яку цей файл бере за правильну: інакше підказка
    // могла б вчити формату, який сама ж відхиляє.
    expect(checkDraft({ ...GOOD, from: EXAMPLE.from, to: EXAMPLE.to }).ok).toBe(true);
    expect(parsePoint(EXAMPLE.from)).toEqual({ ok: true, point: { lat: 46.0569, lon: 14.5058 } });
    expect(parsePoint(EXAMPLE.to)).toEqual({ ok: true, point: { lat: 43.5081, lon: 16.4402 } });
  });

  test('🔴 дні: межі 1 і MAX_DAYS включно, 0 і MAX_DAYS+1 — ні', () => {
    expect(errorsOf({ days: '1' }).days).toBeUndefined();
    expect(errorsOf({ days: String(MAX_DAYS) }).days).toBeUndefined();
    expect(errorsOf({ days: '0' }).days).toBe(`Days must be between 1 and ${MAX_DAYS}.`);
    expect(errorsOf({ days: String(MAX_DAYS + 1) }).days).toBe(`Days must be between 1 and ${MAX_DAYS}.`);
  });

  test('🔴 дні: 60 — це ліміт API, а не лише форми', () => {
    // Дві копії одного числа: форма перевіряє раніше, сервер — остаточно.
    // Звіряються тут, а не вважаються однаковими.
    expect(MAX_DAYS).toBe(60);
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

  test('«звідки» дорівнює «куди» — це коло, а не помилка форми', () => {
    expect(checkDraft({ ...GOOD, from: '46.0569, 14.5058', to: '46.0569 14.5058' }).ok).toBe(true);
  });

  test('один зіпсований рядок не ховає решту: помилка рівно в одному полі', () => {
    expect(Object.keys(errorsOf({ days: 'x' }))).toEqual(['days']);
    expect(Object.keys(errorsOf({ to: 'x' }))).toEqual(['to']);
  });
});

test.describe('settle — джерело не може зламати сторінку', () => {
  const answers = (outcome: unknown): Planner => async () => outcome as PlanOutcome;

  test('чесні відповіді проходять без змін', async () => {
    for (const outcome of [
      { status: 'failed' },
      { status: 'throttled' },
      { status: 'outside-union', fields: ['from'] },
      { status: 'refused', reason: 'round-trip' },
    ] as PlanOutcome[]) {
      expect(await settle(answers(outcome), REQUEST), outcome.status).toEqual(outcome);
    }
  });

  test('🔴 запит доходить до джерела таким, яким пройшов перевірку', async () => {
    let seen: PlanRequest | undefined;
    await settle(async (r) => {
      seen = r;
      return { status: 'failed' };
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
    for (const junk of [undefined, null, 0, 'planned', [], {}, { status: 7 }, { status: 'routed' }, { Status: 'failed' }]) {
      expect(await settle(answers(junk), REQUEST), JSON.stringify(junk)).toEqual({ status: 'failed' });
    }
  });

  test('🔴 «unavailable» більше не статус: планувальник рахує, і слова «не рахує» немає', async () => {
    // Варіант, який казав «планувальник ще не рахує маршрути», зник разом із
    // заглушкою (plan-source.ts обіцяв це). Відповідь із тим словом — сміття.
    expect(await settle(answers({ status: 'unavailable' }), REQUEST)).toEqual({ status: 'failed' });
  });

  test('🔴 статус з прототипа об’єкта — не статус', async () => {
    // `'constructor' in {}` — true. Перевірка через `in` пропустила б це
    // як відповідь, а сторінка потім не знала б, що малювати.
    for (const status of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(await settle(answers({ status }), REQUEST), status).toEqual({ status: 'failed' });
    }
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
    expect(fixed.draft.days).toBe('7');
  });

  test('🔴 правило 1: змінив поле — результат зникає', () => {
    const done = act(filled(), { type: 'submit' }, { type: 'settled', id: 1, outcome: { status: 'throttled' } });
    expect(done.run.phase).toBe('done');
    const edited = act(done, { type: 'edit', field: 'to', value: '44.1194, 15.2314' });
    expect(edited.run).toEqual({ phase: 'idle' });
  });

  test('🔴 правило 2: відповідь на скасований запит не затирає нового', () => {
    // Запит 1 пішов, людина виправила поле, відправила знову (запит 2),
    // і тільки тоді прийшла відповідь на запит 1.
    let s = act(filled(), { type: 'submit' });
    expect(s.run).toMatchObject({ phase: 'pending', id: 1 });
    s = act(s, { type: 'edit', field: 'to', value: '44.1194, 15.2314' }, { type: 'submit' });
    expect(s.run).toMatchObject({ phase: 'pending', id: 2 });

    const late = act(s, { type: 'settled', id: 1, outcome: { status: 'failed' } });
    expect(late).toBe(s); // не змінилось нічого, навіть посилання
    const right = act(s, { type: 'settled', id: 2, outcome: { status: 'throttled' } });
    expect(right.run).toMatchObject({ phase: 'done', id: 2, outcome: { status: 'throttled' } });
    expect(right.run.phase === 'done' && right.run.request.to).toEqual({ lat: 44.1194, lon: 15.2314 });
  });

  test('🔴 відповідь на запит, який скасувало редагування, ігнорується', () => {
    const editing = act(filled(), { type: 'submit' }, { type: 'edit', field: 'days', value: '9' });
    expect(editing.run).toEqual({ phase: 'idle' });
    const late = act(editing, { type: 'settled', id: 1, outcome: { status: 'throttled' } });
    expect(late).toBe(editing);
  });

  test('відповідь без запиту, і друга відповідь на той самий запит, ігноруються', () => {
    const idle = filled();
    expect(act(idle, { type: 'settled', id: 1, outcome: { status: 'failed' } })).toBe(idle);
    const done = act(idle, { type: 'submit' }, { type: 'settled', id: 1, outcome: { status: 'throttled' } });
    // Дев-режим React викликає ефект двічі; друга відповідь не має права
    // змінити вже показане.
    expect(act(done, { type: 'settled', id: 1, outcome: { status: 'failed' } })).toBe(done);
  });

  test('🔴 правило 3: друга відправка, поки перша йде, нічого не змінює', () => {
    const pending = act(filled(), { type: 'submit' });
    expect(act(pending, { type: 'submit' })).toBe(pending);
  });

  test('номери запитів не повторюються, навіть коли відправляють те саме знову', () => {
    let s = act(filled(), { type: 'submit' }, { type: 'settled', id: 1, outcome: { status: 'throttled' } });
    s = act(s, { type: 'submit' });
    expect(s.run).toMatchObject({ phase: 'pending', id: 2 });
    s = act(s, { type: 'settled', id: 2, outcome: { status: 'throttled' } }, { type: 'submit' });
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
      from: ['', ' ', 'Bled', '46.3683, 14.1146', '44.1194, 15.2314', '46.3683, 14.1146', '44.1194, 15.2314'],
      to: ['', 'Split', '43.5081, 16.4402', '46.3683, 14.1146', '43.5081, 16.4402', '43.5081 16.4402'],
      days: ['', '0', '7', '7.5', '61', '14', '7', '14', '7'],
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
                  outcome: { status: 'throttled' },
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
