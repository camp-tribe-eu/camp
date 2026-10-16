// CAMP-229 — що кабінет вирішує, перш ніж щось показати: хто ця людина.
//
// 🔴 ЧИСТА ЛОГІКА, БЕЗ React І БЕЗ МЕРЕЖІ ПО ЗАМОВЧУВАННЮ. `fetch`, адреса API,
// сховище й годинник приходять параметрами, тож усе, що тут вирішується,
// перевіряється на ДАНИХ — відповідях, які API справді віддає, — а не на
// підміненій функції. Компонент (account-cabinet.tsx) лише переносить стан у
// розмітку й виконує два побічні дії: запамʼятати, куди повернути, і піти
// на /login.
//
// 🔴 П'ЯТЬ СТАНІВ, І МЕЖІ МІЖ НИМИ — ТЕ, ЩО ТУТ ВАЖЛИВО.
//
//   signed-out   нема сесії, сесія прострочена, або СЕРВЕР СКАЗАВ 401.
//   ready        сервер сказав 200 і віддав профіль потрібної форми.
//   unavailable  акаунти вимкнено (адреси API немає): запиту не було.
//   failed       мережа, 5xx, 429, відповідь не тієї форми.
//   checking     поки відповіді немає (лише в компоненті).
//
// 🔴 `failed` — НЕ `signed-out`. Це ціна, яку легко недоплатити: мережа
// моргнула, і людину викинуто на /login з вилученою сесією, хоч нічого не
// сталося. Лише 401 від сервера (і нечитабельна чи прострочена сесія ще до
// запиту) означає «ви не ввійшли». Усе інше — «спробуйте ще раз», сесія
// лишається. Тест тримає саме цю межу: падіння мережі НЕ чистить сховище.
//
// 🔴 ТІЛО 200 НЕ ВІРИТЬСЯ. Профіль, що прийшов, перевіряється на форму: пошта —
// рядок, імʼя — рядок чи null, `emailVerified` — булеве. Інакше це `failed`,
// а не «ready» з порожньою людиною: кабінет, який привітав `undefined`, гірший
// за кабінет, який чесно сказав «не вдалось».
//
// І рівно ці три поля йдуть далі. Усе зайве, що API колись додасть, сюди не
// проходить: сторінка не показує того, про що не домовлялась.

import { ACCOUNT_API } from '@/lib/account';
import { clearSession, readSession } from '@/lib/session-store';

export type Profile = {
  email: string;
  displayName: string | null;
  emailVerified: boolean;
};

export type CabinetState =
  | { kind: 'checking' }
  | { kind: 'signed-out' }
  | { kind: 'ready'; profile: Profile }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Профіль потрібної форми — і лише він. Три поля, ні одним більше. */
export function parseProfile(body: unknown): Profile | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { email, displayName, emailVerified } = body as Record<string, unknown>;
  if (typeof email !== 'string' || email === '') return null;
  if (displayName !== null && typeof displayName !== 'string') return null;
  if (typeof emailVerified !== 'boolean') return null;
  return {
    email,
    // Порожнє імʼя — це відсутнє імʼя: вітати порожній рядок нікого.
    displayName: displayName === null || displayName.trim() === '' ? null : displayName,
    emailVerified,
  };
}

/** Сховище, з якого читають і в якому чистять; `undefined` — браузерне. */
type SessionStorageLike = Pick<Storage, 'getItem' | 'removeItem'>;

/**
 * Хто ввійшов — одним викликом.
 *
 * Порядок свідомий:
 *   1. сесії нема чи її строк минув → `signed-out` БЕЗ запиту: відповідь відома,
 *      і вона не залежить від того, чи є API. Тому людину без сесії ведуть на
 *      /login навіть там, де акаунти вимкнено (форма входу сама скаже про це), і
 *      тому цю гілку можна перевірити в CI, де адреси API немає;
 *   2. адреси API нема → `unavailable`, запиту немає (хост, якого нема, не
 *      питаємо);
 *   3. запит; 401 → `signed-out` і сховище ЧИСТИТЬСЯ (токен мертвий, і
 *      тримати його означало б показувати «ви ввійшли» там, де сервер каже ні);
 *   4. усе інше, що не є справним 200, → `failed`, сховище не чіпається.
 */
export async function loadCabinet(
  base: string = ACCOUNT_API,
  storage?: SessionStorageLike,
  now: number = Date.now(),
  fetchImpl: Fetch = (url, init) => fetch(url, init),
): Promise<CabinetState> {
  // `undefined` у параметрі за замовчуванням — це «браузерне сховище».
  const session = readSession(storage, now);
  if (session === null) {
    // Прострочену чи зіпсовану сесію в сховищі не лишаємо: вона вже нічого не
    // відкриє, а людина зараз піде входити наново.
    clearSession(storage);
    return { kind: 'signed-out' };
  }
  if (base === '') return { kind: 'unavailable' };

  let res: Response;
  try {
    res = await fetchImpl(`${base}/auth/me`, {
      method: 'GET',
      headers: { authorization: `Bearer ${session.token}` },
      // Ні cookie: сесія — токен, який сторінка прикладає сама.
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    return { kind: 'failed' };
  }

  if (res.status === 401) {
    clearSession(storage);
    return { kind: 'signed-out' };
  }
  if (res.status !== 200) return { kind: 'failed' };

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    return { kind: 'failed' };
  }
  const profile = parseProfile(body);
  return profile === null ? { kind: 'failed' } : { kind: 'ready', profile };
}
