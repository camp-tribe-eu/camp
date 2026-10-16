import { expect, test } from '@playwright/test';
import { loadCabinet, parseProfile, type CabinetState } from '@/lib/cabinet';
import { SESSION_KEY, readSession } from '@/lib/session-store';

// CAMP-229 — кабінет питає сервер, хто це, і розрізняє «ви не ввійшли» від
// «не вдалось дізнатись».
//
// 🔴 `Response` ТУТ СПРАВЖНІЙ, а не обʼєкт із готовою відповіддю: функція, яку
// підміняє `fetch`, віддає сирі байти зі статусом, а розбирає їх сам код. Тест,
// у якому підміна повертала б уже розібране `{ kind: 'ready' }`, перевіряв би
// власну підміну. Тіла — те, що API справді віддає (`auth.controller.ts`):
// `{ email, displayName, emailVerified }` і `{ code, message }` на 401.

const BASE = 'https://api.example';
const NOW = Date.parse('2026-10-16T12:00:00Z');
const TOKEN = 'T'.repeat(43);

const session = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    token: TOKEN,
    expiresAt: new Date(NOW + 3_600_000).toISOString(),
    email: 'anna@example.com',
    ...over,
  });

function memory(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    has: (k: string) => m.has(k),
  };
}

const PROFILE = { email: 'anna@example.com', displayName: 'Anna', emailVerified: true };

type Call = { url: string; init: RequestInit };
/** `fetch`, що записує виклики й віддає сирий `Response`. */
function server(respond: () => Response | Promise<Response> | never) {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond();
    },
  };
}
const json = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

const run = (
  store: ReturnType<typeof memory>,
  s: ReturnType<typeof server>,
  base = BASE,
): Promise<CabinetState> => loadCabinet(base, store, NOW, s.fetch);

test.describe('🔴 хто ввійшов: рішення береться в сервера, а не зі сховища', () => {
  test('справна сесія й 200 з профілем — `ready`, з трьома полями', async () => {
    const store = memory({ [SESSION_KEY]: session() });
    const s = server(() => json(200, PROFILE));
    expect(await run(store, s)).toEqual({ kind: 'ready', profile: PROFILE });
    expect(store.has(SESSION_KEY), 'сесію не зачеплено').toBe(true);
  });

  test('запит — GET /auth/me з токеном у заголовку, а не в адресі; без cookie', async () => {
    const store = memory({ [SESSION_KEY]: session() });
    const s = server(() => json(200, PROFILE));
    await run(store, s);
    expect(s.calls).toHaveLength(1);
    const { url, init } = s.calls[0];
    expect(url).toBe(`${BASE}/auth/me`);
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ authorization: `Bearer ${TOKEN}` });
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
  });

  test('📌 нічого не збережено — `signed-out`, і до сервера НЕ ходили', async () => {
    const s = server(() => json(200, PROFILE));
    expect(await run(memory(), s)).toEqual({ kind: 'signed-out' });
    expect(s.calls).toHaveLength(0);
  });

  test('📌 сесія прострочена за власним годинником — `signed-out`, без запиту, сховище очищено', async () => {
    const store = memory({
      [SESSION_KEY]: session({ expiresAt: new Date(NOW - 1000).toISOString() }),
    });
    const s = server(() => json(200, PROFILE));
    expect(await run(store, s)).toEqual({ kind: 'signed-out' });
    expect(s.calls).toHaveLength(0);
    expect(store.has(SESSION_KEY)).toBe(false);
  });

  test('📌 зіпсований запис сесії — `signed-out`, без запиту, і запис не лишається', async () => {
    const store = memory({ [SESSION_KEY]: '{"token":' });
    const s = server(() => json(200, PROFILE));
    expect(await run(store, s)).toEqual({ kind: 'signed-out' });
    expect(s.calls).toHaveLength(0);
    expect(store.has(SESSION_KEY)).toBe(false);
  });

  test('🔴 401 від сервера — `signed-out`, і мертвий токен прибрано зі сховища', async () => {
    const store = memory({ [SESSION_KEY]: session() });
    const s = server(() => json(401, { code: 'no_session', message: 'You are not signed in.' }));
    expect(await run(store, s)).toEqual({ kind: 'signed-out' });
    expect(s.calls).toHaveLength(1);
    expect(store.has(SESSION_KEY)).toBe(false);
  });

  test('401 вирішує статус, а не тіло: порожнє чи чуже тіло — теж `signed-out`', async () => {
    for (const body of ['', 'oops', '{"x":1}']) {
      const store = memory({ [SESSION_KEY]: session() });
      expect(await run(store, server(() => json(401, body)))).toEqual({ kind: 'signed-out' });
    }
  });

  // 🔴 НАЙДОРОЖЧА МЕЖА: збій — не відмова. Мережа моргнула чи API впало, і людину
  // не можна викидати на /login з вилученою сесією, хоч нічого не сталося.
  for (const status of [400, 403, 404, 429, 500, 502, 503]) {
    test(`🔴 ${status} — це \`failed\`, а не \`signed-out\`; сесія ЛИШАЄТЬСЯ`, async () => {
      const store = memory({ [SESSION_KEY]: session() });
      expect(await run(store, server(() => json(status, { code: 'x' })))).toEqual({
        kind: 'failed',
      });
      expect(store.has(SESSION_KEY)).toBe(true);
    });
  }

  test('🔴 мережа впала (fetch кидає) — `failed`, сесія лишається', async () => {
    const store = memory({ [SESSION_KEY]: session() });
    const s = server(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await run(store, s)).toEqual({ kind: 'failed' });
    expect(store.has(SESSION_KEY)).toBe(true);
  });

  test('адреси API немає, а сесія є — `unavailable`, запиту не було, сесію не чіпали', async () => {
    const store = memory({ [SESSION_KEY]: session() });
    const s = server(() => json(200, PROFILE));
    expect(await run(store, s, '')).toEqual({ kind: 'unavailable' });
    expect(s.calls).toHaveLength(0);
    expect(store.has(SESSION_KEY)).toBe(true);
  });

  test('📌 адреси API немає і сесії немає — все одно `signed-out`: на /login ведуть і тоді, коли акаунти вимкнено', async () => {
    const s = server(() => json(200, PROFILE));
    expect(await run(memory(), s, '')).toEqual({ kind: 'signed-out' });
    expect(s.calls).toHaveLength(0);
  });

  // 🔴 200 ще не «ready»: тіло перевіряється на форму.
  const BAD_BODIES: readonly (readonly [string, unknown])[] = [
    ['не JSON', 'not json at all'],
    ['порожнє тіло', ''],
    ['порожній обʼєкт', {}],
    ['null', 'null'],
    ['масив', []],
    ['рядок', '"anna"'],
    ['пошта числом', { ...PROFILE, email: 5 }],
    ['порожня пошта', { ...PROFILE, email: '' }],
    ['без пошти', { displayName: 'Anna', emailVerified: true }],
    ['імʼя числом', { ...PROFILE, displayName: 5 }],
    ['імʼя відсутнє, а не null', { email: 'a@b.co', emailVerified: true }],
    ['emailVerified рядком', { ...PROFILE, emailVerified: 'yes' }],
    ['emailVerified відсутнє', { email: 'a@b.co', displayName: null }],
    ['відповідь на вхід, а не профіль', { token: TOKEN, expiresAt: '2026-11-01T00:00:00Z' }],
  ];
  for (const [name, body] of BAD_BODIES) {
    test(`200 із тілом «${name}» — \`failed\`, не \`ready\` із порожньою людиною`, async () => {
      const store = memory({ [SESSION_KEY]: session() });
      expect(await run(store, server(() => json(200, body)))).toEqual({ kind: 'failed' });
      expect(store.has(SESSION_KEY)).toBe(true);
    });
  }

  test('лишнє в тілі не доходить до сторінки: рівно три поля, хоч би що прислали', async () => {
    const store = memory({ [SESSION_KEY]: session() });
    const s = server(() =>
      json(200, { ...PROFILE, passwordHash: 'scrypt$LEAK', id: 'u-1', marketingConsentAt: 'x' }),
    );
    const out = await run(store, s);
    expect(out.kind).toBe('ready');
    if (out.kind !== 'ready') return;
    expect(Object.keys(out.profile).sort()).toEqual(['displayName', 'email', 'emailVerified']);
    expect(JSON.stringify(out)).not.toContain('LEAK');
  });

  test('порожнє чи пробільне імʼя — це відсутнє імʼя', async () => {
    for (const displayName of ['', '   ']) {
      const out = await run(
        memory({ [SESSION_KEY]: session() }),
        server(() => json(200, { ...PROFILE, displayName })),
      );
      expect(out).toEqual({ kind: 'ready', profile: { ...PROFILE, displayName: null } });
    }
  });
});

test.describe('parseProfile', () => {
  test('приймає два допустимі вигляди імені й жодного іншого', () => {
    expect(parseProfile(PROFILE)).toEqual(PROFILE);
    expect(parseProfile({ ...PROFILE, displayName: null })).toEqual({ ...PROFILE, displayName: null });
    expect(parseProfile({ ...PROFILE, displayName: undefined })).toBeNull();
  });
});

test.describe('readSession: що з того, що лежить у сховищі, взагалі сесія', () => {
  const read = (raw: string | null, now = NOW) =>
    readSession(memory(raw === null ? {} : { [SESSION_KEY]: raw }), now);

  test('справна сесія читається як є', () => {
    expect(read(session())).toEqual({
      token: TOKEN,
      expiresAt: new Date(NOW + 3_600_000).toISOString(),
      email: 'anna@example.com',
    });
  });

  test('за мілісекунду до кінця — ще жива, рівно в кінці — вже ні (як сесія в API)', () => {
    const at = new Date(NOW + 5000).toISOString();
    expect(read(session({ expiresAt: at }), NOW + 4999)).not.toBeNull();
    expect(read(session({ expiresAt: at }), NOW + 5000)).toBeNull();
  });

  const BAD: readonly (readonly [string, string | null])[] = [
    ['нічого немає', null],
    ['не JSON', 'nope'],
    ['null', 'null'],
    ['масив', '[]'],
    ['порожній токен', session({ token: '' })],
    ['токен числом', session({ token: 5 })],
    ['без токена', JSON.stringify({ expiresAt: '2099-01-01T00:00:00Z', email: 'a@b.co' })],
    ['строк не розбирається', session({ expiresAt: 'someday' })],
    ['строк числом', session({ expiresAt: 4_000_000_000_000 })],
    ['без пошти', JSON.stringify({ token: TOKEN, expiresAt: '2099-01-01T00:00:00Z' })],
  ];
  for (const [name, raw] of BAD) {
    test(`${name} — не сесія`, () => expect(read(raw)).toBeNull());
  }

  test('сховище, що кидає, — не сесія, а не виняток', () => {
    expect(
      readSession(
        {
          getItem: () => {
            throw new Error('SecurityError');
          },
        },
        NOW,
      ),
    ).toBeNull();
  });
});
