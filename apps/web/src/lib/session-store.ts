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
