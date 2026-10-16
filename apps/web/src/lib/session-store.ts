// CAMP-228 — де браузер тримає сесію після входу чи реєстрації.
//
// 🔴 ЦЕ ЄДИНЕ МІСЦЕ, І ВОНО ТИМЧАСОВЕ ЗА ЗАДУМОМ. Картка про реєстрацію
// мусить кудись покласти токен — інакше сесія, яку API видало, нікому
// не належить. Правило ПОВЕРНЕННЯ після входу (CAMP-227) і кабінет
// (CAMP-229) вирішують, як сесія живе далі, і міняти це доведеться
// тут, а не на кожній сторінці.
//
// Чому `localStorage`, а не `sessionStorage` чи памʼять: вхід у ДРУГІЙ
// вкладці — штатний сценарій за макетом (лист відкривають в іншій
// вкладці), і вкладка, що чекає, мусить побачити сесію. CORS на API
// без credentials, тож cookie не варіант без окремого рішення.
//
// 🔴 Токен у `localStorage` читає будь-який скрипт на цій origin. CSP
// без `unsafe-eval`, але з `unsafe-inline` для скриптів (див.
// scripts/security-headers.mjs) — тобто ін'єкція в HTML цей токен
// забрала б. Це відома ціна й одна з речей, які варто вирішити до
// відкриття, а не після.

export const SESSION_KEY = 'camptribe.session';

export type StoredSession = {
  token: string;
  expiresAt: string;
  email: string;
};

/** Зберегти. Мовчки не вдається в приватному вікні — і це повертається. */
export function saveSession(
  s: StoredSession,
  storage: Pick<Storage, 'setItem'> | null = browserStorage(),
): boolean {
  try {
    storage?.setItem(SESSION_KEY, JSON.stringify(s));
    return storage !== null;
  } catch {
    return false;
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Забути сесію. Після скидання пароля API закриває ВСІ сесії акаунта, у тому
 * числі цю: токен у сховищі після цього — мертвий, і тримати його означало б
 * показувати «ви ввійшли» там, де сервер каже «ні».
 */
export function clearSession(
  storage: Pick<Storage, 'removeItem'> | null = browserStorage(),
): boolean {
  try {
    storage?.removeItem(SESSION_KEY);
    return storage !== null;
  } catch {
    return false;
  }
}

/**
 * Сесія, яку зберіг цей браузер, або `null`.
 *
 * `null` — для всього, що не є справною сесією: нічого не збережено,
 * сховища немає, JSON зіпсований, поля не тієї форми, строк уже минув.
 * Кабінет ставить одне питання — «чи є що показати серверу» — і всі ці
 * випадки для нього одна відповідь.
 *
 * 🔴 ЦЕ ЛИШЕ ЧИТАННЯ, І ВОНО НІЧОГО НЕ РІШАЄ. Токен у сховищі може бути
 * мертвий, хоч його строк не минув (скинули пароль, вийшли в іншому
 * браузері): вирішує сервер, `GET /auth/me`. Власний годинник тут — лише
 * щоб не робити запиту, відповідь на який відома. `now` приходить
 * параметром, щоб межу можна було перевірити без очікування.
 *
 * Строк, що не розбирається, — теж минулий: рядок, чий вік ми прочитати
 * не вміємо, не годиться приймати «на віру».
 */
export function readSession(
  storage: Pick<Storage, 'getItem'> | null = browserStorage(),
  now: number = Date.now(),
): StoredSession | null {
  let raw: string | null;
  try {
    raw = storage?.getItem(SESSION_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { token, expiresAt, email } = value as Record<string, unknown>;
  if (typeof token !== 'string' || token === '') return null;
  if (typeof expiresAt !== 'string') return null;
  if (typeof email !== 'string') return null;
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end) || now >= end) return null;
  return { token, expiresAt, email };
}
