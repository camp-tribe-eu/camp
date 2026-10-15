import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  LINK_MINUTES,
  MIN_PASSWORD,
  RESEND_SECONDS,
  call,
  clock,
  interpret,
  logIn,
  requestReset,
  resendVerification,
  resetPassword,
  resetStep,
  secondsLeft,
  sentOrWaiting,
  signUp,
  tokenFrom,
  verifyEmail,
  verifyPhase,
  waitUntil,
  type Outcome,
} from '@/lib/account';
import { SESSION_KEY, clearSession, saveSession } from '@/lib/session-store';

// CAMP-228 — як сторінки акаунта говорять з API і читають його відповіді.
//
// 🔴 Усе тут — на ДАНИХ: тілах і статусах, які API справді віддає (вони
// записані в apps/api/src/auth/account.db.spec.ts проти справжньої бази),
// а не на підміненій функції. `fetch` підміняється відповіддю, не логікою.
// Кожне очікування — число чи речення, записане явно.

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

test.describe('interpret: статус і код → стан сторінки', () => {
  test('2xx — ok, з тілом, якщо воно є', () => {
    expect(interpret(201, { token: 't' })).toEqual({ kind: 'ok', body: { token: 't' } });
    expect(interpret(202, { accepted: true })).toEqual({
      kind: 'ok',
      body: { accepted: true },
    });
    expect(interpret(204, null)).toEqual({ kind: 'ok', body: null });
  });

  test('400 розрізняє адресу й пароль за кодом, і несе речення сервера', () => {
    expect(interpret(400, { code: 'bad_email', message: 'M1' })).toEqual({
      kind: 'invalid',
      code: 'bad_email',
      message: 'M1',
    });
    expect(
      interpret(400, { code: 'weak_password', reason: 'too-short', message: 'Use at least 10 characters.' }),
    ).toEqual({ kind: 'invalid', code: 'weak_password', message: 'Use at least 10 characters.' });
  });

  test('400 з невідомим кодом чи без тіла — failed, а не вигадана причина', () => {
    expect(interpret(400, { code: 'something_new' })).toEqual({ kind: 'failed' });
    expect(interpret(400, null)).toEqual({ kind: 'failed' });
    expect(interpret(400, 'text')).toEqual({ kind: 'failed' });
  });

  test('401 — відмова входу; 409 — зайнято; 410 — посилання застаріло', () => {
    expect(interpret(401, { message: 'Email or password is wrong.' })).toEqual({ kind: 'refused' });
    expect(interpret(409, { code: 'email_taken' })).toEqual({ kind: 'taken' });
    expect(interpret(410, { code: 'link_stale' })).toEqual({ kind: 'stale' });
  });

  test('429 з нашим лічильником несе секунди; без нього — загальний обмежувач', () => {
    expect(interpret(429, { code: 'too_soon', retryAfter: 47, message: 'x' })).toEqual({
      kind: 'too-soon',
      retryAfter: 47,
    });
    // ThrottlerException: ні коду, ні секунд.
    expect(interpret(429, { statusCode: 429, message: 'ThrottlerException: Too Many Requests' })).toEqual({
      kind: 'throttled',
    });
    // Код є, а числа нема: не вгадуємо відлік.
    expect(interpret(429, { code: 'too_soon' })).toEqual({ kind: 'throttled' });
    expect(interpret(429, { code: 'too_soon', retryAfter: '47' })).toEqual({ kind: 'throttled' });
  });

  test('503 — пошти немає; усе інше — failed', () => {
    expect(interpret(503, { code: 'mail_unavailable' })).toEqual({ kind: 'unavailable' });
    for (const status of [0, 301, 404, 418, 500, 502, 504])
      expect(interpret(status, null), String(status)).toEqual({ kind: 'failed' });
  });
});

test.describe('call: один POST, який не кидає', () => {
  test('шле JSON на base+path, без cookie, і читає відповідь', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const out = await call('/auth/forgot', { email: 'a@b.co' }, 'https://api.example', async (url, init) => {
      seen.push({ url, init });
      return json(202, { accepted: true });
    });
    expect(out).toEqual({ kind: 'ok', body: { accepted: true } });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://api.example/auth/forgot');
    expect(seen[0].init.method).toBe('POST');
    expect(seen[0].init.credentials).toBe('omit');
    expect(seen[0].init.headers).toEqual({ 'content-type': 'application/json' });
    expect(seen[0].init.body).toBe('{"email":"a@b.co"}');
  });

  test('204 без тіла — ok з null, не помилка', async () => {
    const out = await call('/x', {}, 'https://api.example', async () => new Response(null, { status: 204 }));
    expect(out).toEqual({ kind: 'ok', body: null });
  });

  test('мережа, що впала, — failed, і виняток не виходить назовні', async () => {
    const out = await call('/x', {}, 'https://api.example', async () => {
      throw new TypeError('fetch failed');
    });
    expect(out).toEqual({ kind: 'failed' });
  });

  test('порожня адреса API — unavailable, і запиту не було', async () => {
    let calls = 0;
    const out = await call('/x', {}, '', async () => {
      calls++;
      return json(200, {});
    });
    expect(out).toEqual({ kind: 'unavailable' });
    expect(calls).toBe(0);
  });

  test('тіло, що не JSON, не ламає розбір статусу', async () => {
    const out = await call('/x', {}, 'https://api.example', async () => new Response('<html>', { status: 410 }));
    expect(out).toEqual({ kind: 'stale' });
  });
});

test.describe('що саме відправляє кожен запит', () => {
  /** Остання відправка: шлях і розібране тіло. */
  async function sent(run: (f: (url: string, init: RequestInit) => Promise<Response>) => Promise<unknown>) {
    let path = '';
    let body: Record<string, unknown> = {};
    await run(async (url, init) => {
      path = url.replace('https://api.example', '');
      body = JSON.parse(init.body as string);
      return json(200, {});
    });
    return { path, body };
  }

  test('реєстрація: рівно email, password, newsletter — і ніякого поля «умови»', async () => {
    const r = await sent((f) =>
      signUp({ email: 'a@b.co', password: 'p'.repeat(12), newsletter: false }, 'https://api.example', f),
    );
    expect(r.path).toBe('/auth/signup');
    expect(Object.keys(r.body).sort()).toEqual(['email', 'newsletter', 'password']);
    // Булеве як є: сервер рахує згодою лише справжнє `true`.
    expect(r.body.newsletter).toBe(false);
  });

  test('згода йде як `true`, коли людина її поставила', async () => {
    const r = await sent((f) =>
      signUp({ email: 'a@b.co', password: 'p'.repeat(12), newsletter: true }, 'https://api.example', f),
    );
    expect(r.body.newsletter).toBe(true);
  });

  test('решта запитів: шлях і форма тіла', async () => {
    expect(await sent((f) => logIn('a@b.co', 'pw', 'https://api.example', f))).toEqual({
      path: '/auth/login',
      body: { email: 'a@b.co', password: 'pw' },
    });
    expect(await sent((f) => requestReset('a@b.co', 'https://api.example', f))).toEqual({
      path: '/auth/forgot',
      body: { email: 'a@b.co' },
    });
    expect(await sent((f) => resendVerification('a@b.co', 'https://api.example', f))).toEqual({
      path: '/auth/resend-verification',
      body: { email: 'a@b.co' },
    });
    expect(await sent((f) => verifyEmail('TOK', 'https://api.example', f))).toEqual({
      path: '/auth/verify-email',
      body: { token: 'TOK' },
    });
    expect(await sent((f) => resetPassword('TOK', 'new password 123', 'https://api.example', f))).toEqual({
      path: '/auth/reset-password',
      body: { token: 'TOK', password: 'new password 123' },
    });
  });
});

test.describe('відлік «надіслати ще раз можна через 0:47»', () => {
  test('secondsLeft: ціле вгору, ніколи менше нуля', () => {
    expect(secondsLeft(60_000, 0)).toBe(60);
    expect(secondsLeft(60_000, 12_300)).toBe(48);
    expect(secondsLeft(60_000, 59_999)).toBe(1);
    expect(secondsLeft(60_000, 60_000)).toBe(0);
    expect(secondsLeft(60_000, 90_000)).toBe(0);
  });

  test('clock: хвилини й дві цифри секунд', () => {
    expect(clock(47)).toBe('0:47');
    expect(clock(60)).toBe('1:00');
    expect(clock(5)).toBe('0:05');
    expect(clock(0)).toBe('0:00');
    expect(clock(-3)).toBe('0:00');
    expect(clock(125)).toBe('2:05');
  });
});

test.describe('🔴 «лист пішов» — рішення, яке форми «надіслати посилання» не мають права розрізняти', () => {
  const ALL: Outcome[] = [
    { kind: 'ok', body: { accepted: true } },
    { kind: 'too-soon', retryAfter: 47 },
    { kind: 'invalid', code: 'bad_email', message: 'x' },
    { kind: 'refused' },
    { kind: 'taken' },
    { kind: 'stale' },
    { kind: 'throttled' },
    { kind: 'unavailable' },
    { kind: 'failed' },
  ];

  test('лише ok і too-soon означають «лист пішов»; решта — помилка на місці', () => {
    expect(ALL.filter(sentOrWaiting).map((o) => o.kind)).toEqual(['ok', 'too-soon']);
  });

  test('відлік після ok — 60 секунд', () => {
    expect(waitUntil({ kind: 'ok', body: null }, 1_000_000)).toBe(1_060_000);
  });

  test('відлік після too-soon — стільки, скільки назвав сервер, а не 60', () => {
    expect(waitUntil({ kind: 'too-soon', retryAfter: 47 }, 1_000_000)).toBe(1_047_000);
    expect(waitUntil({ kind: 'too-soon', retryAfter: 1 }, 1_000_000)).toBe(1_001_000);
  });
});

test.describe('що показати після посилання з листа', () => {
  test('підтвердження: ok — готово, 410 — застаріло, усе інше — не вдалось (посилання не витрачене)', () => {
    expect(verifyPhase({ kind: 'ok', body: { verified: true } })).toBe('verified');
    expect(verifyPhase({ kind: 'stale' })).toBe('stale');
    for (const o of [
      { kind: 'failed' },
      { kind: 'unavailable' },
      { kind: 'throttled' },
      { kind: 'too-soon', retryAfter: 3 },
    ] as Outcome[])
      expect(verifyPhase(o), o.kind).toBe('failed');
  });

  test('пароль: ok — готово, 410 — застаріло, слабкий пароль і мережа — помилка на місці', () => {
    expect(resetStep({ kind: 'ok', body: null })).toBe('done');
    expect(resetStep({ kind: 'stale' })).toBe('stale');
    // 🔴 Слабкий пароль НЕ ховає форму: посилання живе, і людина пробує ще.
    expect(resetStep({ kind: 'invalid', code: 'weak_password', message: 'x' })).toBe('error');
    expect(resetStep({ kind: 'failed' })).toBe('error');
    expect(resetStep({ kind: 'throttled' })).toBe('error');
  });
});

test.describe('токен із адреси сторінки', () => {
  test('?t= — значення; без нього, порожній чи зіпсований — порожній рядок', () => {
    expect(tokenFrom('?t=abc-DEF_123')).toBe('abc-DEF_123');
    expect(tokenFrom('?x=1&t=abc')).toBe('abc');
    expect(tokenFrom('?t=a%26b')).toBe('a&b');
    expect(tokenFrom('')).toBe('');
    expect(tokenFrom('?x=1')).toBe('');
    expect(tokenFrom('?t=')).toBe('');
  });
});

test.describe('сховище сесії', () => {
  test('кладе JSON під одним ключем і каже, що вдалось', () => {
    const store = new Map<string, string>();
    const ok = saveSession(
      { token: 'T', expiresAt: '2026-11-14T00:00:00.000Z', email: 'a@b.co' },
      { setItem: (k, v) => void store.set(k, v) },
    );
    expect(ok).toBe(true);
    expect(SESSION_KEY).toBe('camptribe.session');
    expect(JSON.parse(store.get('camptribe.session')!)).toEqual({
      token: 'T',
      expiresAt: '2026-11-14T00:00:00.000Z',
      email: 'a@b.co',
    });
  });

  test('приватне вікно, де запис кидає, — false, а не виняток', () => {
    const ok = saveSession(
      { token: 'T', expiresAt: 'x', email: 'a@b.co' },
      {
        setItem: () => {
          throw new DOMException('quota', 'QuotaExceededError');
        },
      },
    );
    expect(ok).toBe(false);
  });

  test('без сховища — false', () => {
    expect(saveSession({ token: 'T', expiresAt: 'x', email: 'a@b.co' }, null)).toBe(false);
  });

  test('clearSession забуває рівно цей ключ і більше нічого', () => {
    const store = new Map<string, string>([
      ['camptribe.session', '{"token":"T"}'],
      ['camptribe.consent', 'reject'],
    ]);
    expect(clearSession({ removeItem: (k) => void store.delete(k) })).toBe(true);
    expect([...store.keys()]).toEqual(['camptribe.consent']);
  });

  test('clearSession без сховища чи з винятком — false', () => {
    expect(clearSession(null)).toBe(false);
    expect(
      clearSession({
        removeItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe(false);
  });
});

// 🔴 ДВА СПИСКИ ОДНОГО ПРАВИЛА (self-check №9). Числа й коди, якими
// сторінка мовить про API, живуть у двох місцях: тут і в API. Перейменування
// одного мовчки лишало б сторінку з відліком, якого сервер не чекає, чи з
// кодом, який ніхто не надсилає. Тест читає API-файли й порівнює.
test.describe('збігається з API', () => {
  const api = (file: string) =>
    readFileSync(join(__dirname, '../../../api/src/auth', file), 'utf8');
  const num = (source: string, name: string): number => {
    const m = new RegExp(`export const ${name} = ([0-9_ *]+);`).exec(source);
    // 🔴 Якщо анкер не знайдено — це провал, а не «0 збігів».
    expect(m, `не знайшов ${name}`).not.toBeNull();
    return Function(`return ${m![1].replace(/_/g, '')}`)() as number;
  };

  test('мінімальна довжина пароля', () => {
    expect(num(api('password-policy.ts'), 'MIN_LENGTH')).toBe(MIN_PASSWORD);
    expect(MIN_PASSWORD).toBe(10);
  });

  test('60 секунд між листами', () => {
    expect(num(api('account.service.ts'), 'COOLDOWN_MS')).toBe(RESEND_SECONDS * 1000);
    expect(RESEND_SECONDS).toBe(60);
  });

  test('60 хвилин життя посилання', () => {
    expect(num(api('mail.ts'), 'LINK_TTL_MS')).toBe(LINK_MINUTES * 60_000);
    expect(LINK_MINUTES).toBe(60);
  });

  test('коди, за якими сторінка розгалужується, справді існують в API', () => {
    const controller = api('auth.controller.ts');
    for (const code of ['bad_email', 'weak_password', 'email_taken', 'link_stale', 'mail_unavailable', 'too_soon'])
      expect(controller, code).toContain(`code: '${code}'`);
  });
});
