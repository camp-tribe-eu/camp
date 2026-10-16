import { expect, test } from '@playwright/test';
import {
  changePassword,
  loadSettings,
  requestEmailChange,
  setLetters,
} from '@/lib/settings';
import { SESSION_KEY } from '@/lib/session-store';
import type { Deps } from '@/lib/authed';

// CAMP-229 — розмова сторінки налаштувань із API.
//
// 🔴 `Response` ТУТ СПРАВЖНІЙ: підміна віддає сирі байти зі статусом, а
// розбирає їх сам код. Тіла — ті, що API справді віддає
// (`apps/api/src/auth/account-settings.controller.ts`, і
// `account-settings.db.spec.ts` читає їх із живого сервера).

const BASE = 'https://api.example';
const NOW = Date.parse('2026-10-16T12:00:00Z');
const TOKEN = 'T'.repeat(43);
const NEXT_TOKEN = 'N'.repeat(43);

const session = () =>
  JSON.stringify({
    token: TOKEN,
    expiresAt: new Date(NOW + 3_600_000).toISOString(),
    email: 'anna@example.com',
  });

function memory(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    has: (k: string) => m.has(k),
    read: (k: string) => m.get(k) ?? null,
  };
}

type Call = { url: string; init: RequestInit };
function server(respond: () => Response) {
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
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
  });

const signedIn = () => memory({ [SESSION_KEY]: session() });
const deps = (
  store: ReturnType<typeof memory>,
  s: ReturnType<typeof server>,
): Deps => ({ base: BASE, storage: store, now: NOW, fetchImpl: s.fetch });

const SETTINGS = {
  email: 'anna@example.com',
  displayName: null,
  emailVerified: true,
  letters: false,
};

test.describe('що показує сторінка', () => {
  test('повний відповідь розбирається', async () => {
    const store = signedIn();
    const s = server(() => json(200, SETTINGS));
    const out = await loadSettings(deps(store, s));
    expect(out).toEqual({ kind: 'ok', value: SETTINGS });
    expect(s.calls[0].url).toBe(`${BASE}/account/settings`);
  });

  test('🔴 тіло не тієї форми — `failed`, а не напівпорожній екран', async () => {
    for (const body of [
      {},
      { email: 'a@b.c' },
      { ...SETTINGS, letters: 'yes' },
      { ...SETTINGS, emailVerified: 'true' },
      'not json at all',
    ]) {
      const s = server(() => json(200, body));
      expect((await loadSettings(deps(signedIn(), s))).kind).toBe('failed');
    }
  });

  test('401 — `signed-out`, і мертвий токен прибирається зі сховища', async () => {
    const store = signedIn();
    const s = server(() => json(401, { code: 'no_session' }));
    expect((await loadSettings(deps(store, s))).kind).toBe('signed-out');
    expect(store.has(SESSION_KEY)).toBe(false);
  });

  test('немає адреси API — `unavailable`, і ЖОДНОГО запиту', async () => {
    const s = server(() => json(200, SETTINGS));
    const out = await loadSettings({
      base: '',
      storage: signedIn(),
      now: NOW,
      fetchImpl: s.fetch,
    });
    expect(out.kind).toBe('unavailable');
    expect(s.calls).toHaveLength(0);
  });
});

test.describe('листи', () => {
  test('🔴 повертається те, що сказав СЕРВЕР, а не те, що попросили', async () => {
    const s = server(() => json(200, { letters: false }));
    // Натиснули «увімкнути», сервер сказав «вимкнено» — екран мусить
    // показати правду, інакше перемикач бреше про стан згоди.
    const out = await setLetters(true, deps(signedIn(), s));
    expect(out).toEqual({ kind: 'ok', letters: false });
    expect(JSON.parse(String(s.calls[0].init.body))).toEqual({ letters: true });
  });

  test('тіло без булевого `letters` — failed', async () => {
    const s = server(() => json(200, { letters: 'on' }));
    expect((await setLetters(true, deps(signedIn(), s))).kind).toBe('failed');
  });
});

test.describe('пароль', () => {
  test('🔴 успіх ЗБЕРІГАЄ новий токен — інакше наступний запит дасть 401', async () => {
    const store = signedIn();
    const expiresAt = new Date(NOW + 7_200_000).toISOString();
    const s = server(() => json(200, { token: NEXT_TOKEN, expiresAt }));
    const out = await changePassword('old one', 'a new long password', deps(store, s));
    expect(out).toEqual({ kind: 'ok' });
    // Сервер навмисно вбиває ВСІ сесії, включно з цією, і видає нову.
    // Без цього запису людина, яка зробила все правильно, побачила б
    // «ви не ввійшли» — рівно за те, що змінила пароль.
    expect(JSON.parse(String(store.read(SESSION_KEY))).token).toBe(NEXT_TOKEN);
  });

  test('🔴 403 — «пароль не той», і сховище НЕ чиститься', async () => {
    const store = signedIn();
    const s = server(() => json(403, { code: 'wrong_password' }));
    const out = await changePassword('wrong', 'a new long password', deps(store, s));
    expect(out).toEqual({ kind: 'wrong-password' });
    // Одна помилка в полі «чинний пароль» не повинна викидати людину на /login.
    expect(store.has(SESSION_KEY)).toBe(true);
    expect(JSON.parse(String(store.read(SESSION_KEY))).token).toBe(TOKEN);
  });

  test('слабкий пароль несе причину й слова сервера', async () => {
    const s = server(() =>
      json(400, {
        code: 'weak_password',
        reason: 'too-short',
        message: 'Use at least 10 characters.',
      }),
    );
    const out = await changePassword('old one', 'short', deps(signedIn(), s));
    expect(out).toEqual({
      kind: 'weak',
      reason: 'too-short',
      message: 'Use at least 10 characters.',
    });
  });

  test('200 не тієї форми не вважається успіхом', async () => {
    const store = signedIn();
    const s = server(() => json(200, { ok: true }));
    const out = await changePassword('old one', 'a new long password', deps(store, s));
    expect(out.kind).toBe('failed');
    // І старий токен лишається на місці: нічого не підтверджено.
    expect(JSON.parse(String(store.read(SESSION_KEY))).token).toBe(TOKEN);
  });

  test('429 — окремий стан, а не «щось пішло не так»', async () => {
    const s = server(() => json(429, { code: 'throttled' }));
    expect((await changePassword('a', 'b', deps(signedIn(), s))).kind).toBe('throttled');
  });
});

test.describe('пошта', () => {
  test('202 — лист у дорозі, і тіло запиту саме те', async () => {
    const s = server(() => json(202, { status: 'sent' }));
    const out = await requestEmailChange('pw', 'new@example.com', deps(signedIn(), s));
    expect(out).toEqual({ kind: 'sent' });
    expect(s.calls[0].url).toBe(`${BASE}/account/email`);
    expect(JSON.parse(String(s.calls[0].init.body))).toEqual({
      password: 'pw',
      email: 'new@example.com',
    });
  });

  test('403 — пароль не той', async () => {
    const store = signedIn();
    const s = server(() => json(403, { code: 'wrong_password' }));
    expect((await requestEmailChange('x', 'a@b.co', deps(store, s))).kind).toBe('wrong-password');
    expect(store.has(SESSION_KEY)).toBe(true);
  });

  test('400 розрізняє «не схоже на адресу» і «це ваша ж адреса»', async () => {
    const bad = server(() => json(400, { code: 'bad_email' }));
    expect((await requestEmailChange('pw', 'x', deps(signedIn(), bad))).kind).toBe('bad-email');
    const same = server(() => json(400, { code: 'same_email' }));
    expect((await requestEmailChange('pw', 'a@b.co', deps(signedIn(), same))).kind).toBe('same-email');
  });

  test('429 несе лічильник сервера, а коли його немає — 60', async () => {
    const withIt = server(() => json(429, { code: 'too_soon', retryAfter: 42 }));
    expect(await requestEmailChange('pw', 'a@b.co', deps(signedIn(), withIt))).toEqual({
      kind: 'throttled',
      retryAfter: 42,
    });
    const without = server(() => json(429, { code: 'too_soon' }));
    expect(await requestEmailChange('pw', 'a@b.co', deps(signedIn(), without))).toEqual({
      kind: 'throttled',
      retryAfter: 60,
    });
  });

  test('🔴 «зайнято» сюди не приходить: 202 однакова для вільної й чужої адреси', async () => {
    // Сервер навмисно не розрізняє їх, щоб форма не стала оракулом
    // перелічення. Клієнт не має права вигадати тут різницю.
    const s = server(() => json(202, { status: 'sent' }));
    const a = await requestEmailChange('pw', 'free@example.com', deps(signedIn(), s));
    const b = await requestEmailChange('pw', 'taken@example.com', deps(signedIn(), s));
    expect(a).toEqual(b);
  });
});
