// CAMP-228 — розмова сторінок акаунта з API: що вони відправляють і як
// читають відповідь.
//
// 🔴 ЧИСТА ЛОГІКА, БЕЗ React І БЕЗ МЕРЕЖІ ПО ЗАМОВЧУВАННЮ. `fetch` і
// адреса API приходять параметрами, тож усе, що тут вирішується, можна
// перевірити на ДАНИХ — відповідях, які API справді віддає, — а не на
// підміненій функції. Сторінки (components/account-forms.tsx) лише
// з'єднують це з React.
//
// 🔴 ОДНЕ СЛОВО НА КОЖЕН СПОСІБ, ЯКИМ ВІДПОВІДЬ МОЖЕ БУТИ ПОГАНОЮ, і
// жодного «щось пішло не так» там, де ми знаємо причину. API відповідає
// `{ code, message }`; сторінка розгалужується за `code`, ніколи за
// текстом. Невідомий код чи не-JSON — це `failed`, а не вигадана причина.

/**
 * Адреса API з боку браузера. Порожня — акаунти вимкнені, і сторінка
 * каже про це прямо, а не шле запити на хост, якого немає (так само
 * поводиться звітувач помилок, CAMP-92).
 */
export const ACCOUNT_API = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/**
 * Скільки чекати між двома листами одного виду на одну адресу.
 *
 * 🔴 ДУБЛЬ ЧИСЛА З API (`COOLDOWN_MS` в `account.service.ts`) — і лише
 * для лічильника на сторінці. Сервер усе одно рахує сам і повертає
 * `retryAfter`; цим числом сторінка тільки запускає відлік ПІСЛЯ
 * успішного відправлення. `account.spec.ts` читає API-файл і порівнює.
 */
export const RESEND_SECONDS = 60;

/** Мінімальна довжина нового пароля. Дубль `MIN_LENGTH` з API; див. вище. */
export const MIN_PASSWORD = 10;

/** Як довго живе посилання з листа. Те саме число, що в листах API. */
export const LINK_MINUTES = 60;

export type Outcome =
  /** 2xx. `body` — розібраний JSON або `null` (204). */
  | { kind: 'ok'; body: Record<string, unknown> | null }
  /** 400: адреса чи пароль не годяться. `code` каже, що саме. */
  | { kind: 'invalid'; code: 'bad_email' | 'weak_password'; message: string }
  /** 401 на вхід: однакове речення і для «немає акаунта», і для «хибний пароль». */
  | { kind: 'refused' }
  /** 409: адреса зайнята (лише реєстрація). */
  | { kind: 'taken' }
  /** 410: посилання прострочене, використане чи не те. */
  | { kind: 'stale' }
  /** 429 від лічильника «60 секунд»: скільки лишилось чекати. */
  | { kind: 'too-soon'; retryAfter: number }
  /** 429 від обмежувача за адресою відвідувача: тут `retryAfter` нема. */
  | { kind: 'throttled' }
  /** 503: пошту ще не підключено, або акаунтів тут немає. */
  | { kind: 'unavailable' }
  /** Усе інше: мережа, 5xx, відповідь не тієї форми. */
  | { kind: 'failed' };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Відповідь API → один зі станів сторінки.
 *
 * 🔴 `status` вирішує все, що він може вирішити, а `code` — лише там,
 * де один статус має два значення (400: адреса чи пароль; 429: наш
 * лічильник чи загальний обмежувач). Тіло, яке не збігається з
 * очікуваним, не вгадується — це `failed`.
 */
export function interpret(status: number, body: unknown): Outcome {
  const b = isRecord(body) ? body : null;
  if (status >= 200 && status < 300) return { kind: 'ok', body: b };
  if (status === 400 && b) {
    if (b.code === 'bad_email' || b.code === 'weak_password')
      return {
        kind: 'invalid',
        code: b.code,
        message: typeof b.message === 'string' ? b.message : '',
      };
    return { kind: 'failed' };
  }
  if (status === 401) return { kind: 'refused' };
  if (status === 409) return { kind: 'taken' };
  if (status === 410) return { kind: 'stale' };
  if (status === 429) {
    if (b?.code === 'too_soon' && typeof b.retryAfter === 'number')
      return { kind: 'too-soon', retryAfter: b.retryAfter };
    return { kind: 'throttled' };
  }
  if (status === 503) return { kind: 'unavailable' };
  return { kind: 'failed' };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Один POST із JSON. Не кидає: мережа, що впала, — це `failed`.
 *
 * Порожня адреса API — `unavailable`, і запиту не відбувається.
 */
export async function call(
  path: string,
  payload: unknown,
  base: string = ACCOUNT_API,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
): Promise<Outcome> {
  if (base === '') return { kind: 'unavailable' };
  try {
    const res = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      // Ні cookie, ні заголовка Authorization: API так само налаштоване.
      credentials: 'omit',
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // 204 і порожні тіла: не помилка.
    }
    return interpret(res.status, body);
  } catch {
    return { kind: 'failed' };
  }
}

// ── Запити сторінок. Тонкі: форма запиту — це вся їхня робота. ─────────

export type SignUpInput = { email: string; password: string; newsletter: boolean };

export const signUp = (input: SignUpInput, base?: string, f?: Fetch) =>
  // 🔴 `newsletter` іде булевим, як є. API рахує згодою лише справжнє
  // `true`; "on" чи 1 — не згода. Поля «умови» тут немає взагалі.
  call('/auth/signup', input, base, f);

export const logIn = (email: string, password: string, base?: string, f?: Fetch) =>
  call('/auth/login', { email, password }, base, f);

export const requestReset = (email: string, base?: string, f?: Fetch) =>
  call('/auth/forgot', { email }, base, f);

export const resendVerification = (email: string, base?: string, f?: Fetch) =>
  call('/auth/resend-verification', { email }, base, f);

export const verifyEmail = (token: string, base?: string, f?: Fetch) =>
  call('/auth/verify-email', { token }, base, f);

export const resetPassword = (token: string, password: string, base?: string, f?: Fetch) =>
  call('/auth/reset-password', { token, password }, base, f);

// ── Відлік «надіслати ще раз можна через 0:47» ─────────────────────────

/** Скільки секунд лишилось, ніколи не менше нуля й завжди ціле вгору. */
export function secondsLeft(untilMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
}

/** `47` → `0:47`, `60` → `1:00`. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Відповідь, що означає «лист пішов, чекайте»: `ok`, або сервер каже, що
 * попередній лист пішов щойно (`too-soon`).
 *
 * 🔴 `too-soon` — НЕ помилка для форм «надіслати посилання». Другий запит
 * за хвилину на ту саму адресу отримує ту саму відповідь для адреси, яку
 * ми знаємо, і для вигаданої; показати її як помилку означало б показати
 * людині екран, що відрізняється від першого, — а першому ми не
 * дозволяємо нічого казати про існування акаунта. Тож вона веде на той
 * самий екран «Перевірте пошту» з відліком, який назвав сервер.
 */
export const sentOrWaiting = (o: Outcome): boolean =>
  o.kind === 'ok' || o.kind === 'too-soon';

/**
 * Коли знову дозволено питати, у мілісекундах епохи: за словами сервера,
 * а коли він нічого не казав (звичайний `ok`) — через `RESEND_SECONDS`.
 */
export const waitUntil = (o: Outcome, nowMs: number): number =>
  nowMs + (o.kind === 'too-soon' ? o.retryAfter : RESEND_SECONDS) * 1000;

/** Що показати після спроби підтвердити пошту за посиланням. */
export type VerifyPhase = 'verified' | 'stale' | 'failed';
export const verifyPhase = (o: Outcome): VerifyPhase =>
  o.kind === 'ok' ? 'verified' : o.kind === 'stale' ? 'stale' : 'failed';

/**
 * Що показати після спроби змінити пароль: готово, посилання застаріло
 * (форма зникає, бо нічого більше цим посиланням не зробиш), або помилка
 * на місці (слабкий пароль: посилання ЖИВЕ, і людина пробує ще раз).
 */
export type ResetStep = 'done' | 'stale' | 'error';
export const resetStep = (o: Outcome): ResetStep =>
  o.kind === 'ok' ? 'done' : o.kind === 'stale' ? 'stale' : 'error';

// ── Токен із адреси сторінки ───────────────────────────────────────────

/**
 * Значення `?t=` або порожній рядок.
 *
 * Береться з рядка адреси, а не з `useSearchParams`: той вимагає межі
 * Suspense на статичній сторінці й без неї ламає збірку. Порожній — це
 * «посилання зіпсоване», і сторінка показує «застаріло», а не питає
 * сервер про нічого.
 */
export function tokenFrom(search: string): string {
  try {
    return new URLSearchParams(search).get('t') ?? '';
  } catch {
    return '';
  }
}
