// CAMP-229 — розмова сторінки налаштувань із API.
//
// 🔴 ЧИСТА ЛОГІКА, БЕЗ React, як і `rights.ts`: адреса API, сховище, годинник
// і `fetch` приходять параметрами, тож усе, що тут вирішується, перевіряється
// на ВІДПОВІДЯХ, які API справді віддає
// (`apps/api/src/auth/account-settings.controller.ts`), а не на підміненій
// функції, що повертає готовий висновок.

import { authed, readJson, type Deps, type Failure } from '@/lib/authed';
import { saveSession } from '@/lib/session-store';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Що показує сторінка налаштувань. Рівно те, що віддає сервер. */
export type Settings = {
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  letters: boolean;
};

export type SettingsCall = { kind: 'ok'; value: Settings } | Failure;

export async function loadSettings(deps: Deps = {}): Promise<SettingsCall> {
  const out = await authed('/account/settings', { method: 'GET' }, deps);
  if (out.kind !== 'response') return out;
  if (!out.res.ok) return { kind: 'failed' };
  const body = await readJson(out.res);
  if (
    !isRecord(body) ||
    typeof body.email !== 'string' ||
    body.email === '' ||
    typeof body.emailVerified !== 'boolean' ||
    typeof body.letters !== 'boolean' ||
    (body.displayName !== null && typeof body.displayName !== 'string')
  )
    return { kind: 'failed' };
  return {
    kind: 'ok',
    value: {
      email: body.email,
      displayName:
        body.displayName === null || (body.displayName as string).trim() === ''
          ? null
          : (body.displayName as string),
      emailVerified: body.emailVerified,
      letters: body.letters,
    },
  };
}

// ── листи ────────────────────────────────────────────────────────────────

export type LettersCall = { kind: 'ok'; letters: boolean } | Failure;

/**
 * 🔴 ВІДПОВІДЬ СЕРВЕРА, А НЕ ТЕ, ЩО МИ ПОПРОСИЛИ. Перемикач показує стан,
 * який підтвердив сервер: якщо він із якоїсь причини не погодився, екран
 * мусить сказати правду, а не те, на що людина натиснула.
 */
export async function setLetters(
  on: boolean,
  deps: Deps = {},
): Promise<LettersCall> {
  const out = await authed(
    '/account/letters',
    { method: 'POST', body: { letters: on } },
    deps,
  );
  if (out.kind !== 'response') return out;
  if (!out.res.ok) return { kind: 'failed' };
  const body = await readJson(out.res);
  if (!isRecord(body) || typeof body.letters !== 'boolean')
    return { kind: 'failed' };
  return { kind: 'ok', letters: body.letters };
}

// ── пароль ───────────────────────────────────────────────────────────────

export type PasswordCall =
  | { kind: 'ok' }
  | { kind: 'wrong-password' }
  | { kind: 'weak'; reason: string; message: string }
  | { kind: 'throttled' }
  | Failure;

/**
 * Змінити пароль — і ЗБЕРЕГТИ НОВИЙ ТОКЕН, який прийшов у відповіді.
 *
 * 🔴 БЕЗ ЦЬОГО ЗБЕРЕЖЕННЯ СТОРІНКА ВМИРАЄ НА НАСТУПНОМУ ЗАПИТІ. Сервер
 * навмисно вбиває всі сесії, включно з цією, і видає нову тут-таки; токен у
 * сховищі після цього мертвий. Людина, яка зробила все правильно, побачила б
 * «ви не ввійшли» — рівно за те, що змінила пароль.
 *
 * 🔴 403 — ЦЕ «ПАРОЛЬ НЕ ТОЙ», А НЕ «СЕСІЯ СКІНЧИЛАСЬ». `authed` чистить
 * сховище на 401; 403 він не чіпає, і це тут суттєво: інакше одна помилка в
 * полі «чинний пароль» викидала б людину на /login.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  deps: Deps = {},
): Promise<PasswordCall> {
  const out = await authed(
    '/account/password',
    { method: 'POST', body: { currentPassword, newPassword } },
    deps,
  );
  if (out.kind !== 'response') return out;
  if (out.res.status === 403) return { kind: 'wrong-password' };
  if (out.res.status === 429) return { kind: 'throttled' };
  const body = await readJson(out.res);
  if (out.res.status === 400 && isRecord(body) && body.code === 'weak_password')
    return {
      kind: 'weak',
      reason: typeof body.reason === 'string' ? body.reason : 'unknown',
      message:
        typeof body.message === 'string'
          ? body.message
          : 'That password cannot be used.',
    };
  if (!out.res.ok) return { kind: 'failed' };
  if (
    !isRecord(body) ||
    typeof body.token !== 'string' ||
    typeof body.expiresAt !== 'string'
  )
    return { kind: 'failed' };
  saveSession(
    {
      token: body.token,
      expiresAt: body.expiresAt,
      // Адреса не мінялась; сховище тримає її для показу, не для доступу.
      email: typeof body.email === 'string' ? body.email : '',
    },
    deps.storage as Pick<Storage, 'setItem'> | undefined,
  );
  return { kind: 'ok' };
}

// ── пошта ────────────────────────────────────────────────────────────────

export type EmailCall =
  | { kind: 'sent' }
  | { kind: 'wrong-password' }
  | { kind: 'bad-email' }
  | { kind: 'same-email' }
  | { kind: 'throttled'; retryAfter: number }
  | Failure;

/**
 * Попросити переїзд. Нічого не змінює — лист іде на нову адресу.
 *
 * 🔴 «ЗАЙНЯТО» СЮДИ НЕ ПРИХОДИТЬ, І ЦЕ НЕ НЕДОГЛЯД. Сервер відповідає
 * однаково для вільної й зайнятої адреси, щоб форма не стала оракулом
 * перелічення. Екран каже «якщо ця адреса приймає листи, підтвердження вже
 * в дорозі» — речення, однаково правдиве в обох випадках.
 */
export async function requestEmailChange(
  password: string,
  email: string,
  deps: Deps = {},
): Promise<EmailCall> {
  const out = await authed(
    '/account/email',
    { method: 'POST', body: { password, email } },
    deps,
  );
  if (out.kind !== 'response') return out;
  if (out.res.status === 403) return { kind: 'wrong-password' };
  const body = await readJson(out.res);
  if (out.res.status === 429)
    return {
      kind: 'throttled',
      retryAfter:
        isRecord(body) && typeof body.retryAfter === 'number'
          ? body.retryAfter
          : 60,
    };
  if (out.res.status === 400 && isRecord(body)) {
    if (body.code === 'same_email') return { kind: 'same-email' };
    return { kind: 'bad-email' };
  }
  if (out.res.status !== 202) return { kind: 'failed' };
  return { kind: 'sent' };
}
