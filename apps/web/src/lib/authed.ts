// CAMP-229 — один спосіб сходити в API з токеном сесії, і лише один.
//
// 🔴 ЦЕ ЖИЛО В `rights.ts`, ПОКИ КОРИСТУВАЧ БУВ ОДИН. Із налаштуваннями
// (`lib/settings.ts`) користувачів стало двоє, і копія цього файлу була б
// другим місцем, де вирішують, коли чистити сховище й що означає 401.
// Такі два місця розходяться не одразу, а тоді, коли одне з них правлять.
//
// 🔴 СЕСІЯ ЧИТАЄТЬСЯ ТУТ ЖЕ, А НЕ ПЕРЕДАЄТЬСЯ ЗВЕРХУ. Токен лежить у
// сховищі; функція, що його потребує, бере його сама й чистить, коли сервер
// сказав «ні». Компонент, якому токен передали б пропсом, тримав би його в
// памʼяті довше, ніж він живий.

import { ACCOUNT_API } from '@/lib/account';
import { clearSession, readSession } from '@/lib/session-store';

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type SessionStorageLike = Pick<Storage, 'getItem' | 'removeItem'>;

export type Deps = {
  base?: string;
  storage?: SessionStorageLike;
  now?: number;
  fetchImpl?: Fetch;
};

/** Чому відповіді немає. Спільне для всіх викликів. */
export type Failure = { kind: 'signed-out' } | { kind: 'unavailable' } | { kind: 'failed' };

/**
 * Один запит із токеном сесії. Не кидає.
 *
 * Порядок свідомий, як у `loadCabinet`: нема сесії → `signed-out` БЕЗ запиту;
 * нема адреси API → `unavailable`; мережа впала → `failed`; 401 → `signed-out` і
 * сховище чиститься (токен мертвий).
 */
export async function authed(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  { base = ACCOUNT_API, storage, now = Date.now(), fetchImpl }: Deps,
): Promise<{ kind: 'response'; res: Response } | Failure> {
  const session = readSession(storage, now);
  if (session === null) {
    clearSession(storage);
    return { kind: 'signed-out' };
  }
  if (base === '') return { kind: 'unavailable' };
  const doFetch: Fetch = fetchImpl ?? ((url, i) => fetch(url, i));
  let res: Response;
  try {
    res = await doFetch(`${base}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${session.token}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
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
  return { kind: 'response', res };
}

export async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

