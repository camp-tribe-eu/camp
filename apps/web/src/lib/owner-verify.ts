import { readSession } from '@/lib/session-store';
import type { Fetch } from '@/lib/spot-claim';

/**
 * «Це мій кемпінг»: самоверифікація власника по домену пошти. CAMP-505.
 *
 * 🔴 ПРАВИЛА ТУТ, РОЗМІТКА В `owner-verify-view.tsx`, МЕРЕЖА В
 * `owner-verify-form.tsx` — той самий поділ, що в `lib/spot-claim.ts`:
 * стан, який можна перевірити лише кліками в браузері, перевіряють один раз.
 *
 * 🔴 ЦЯ СТОРІНКА НІКОЛИ НЕ ЗНАЄ, ЧИ ЗБІГСЯ ДОМЕН. API відповідає однаково
 * («якщо адреса підійшла, лист іде»), і тому тут немає гілки «збіглося» —
 * є лише «прийнято». Додати таку гілку на сторінці означало б, що сервер
 * десь розкриває те, що він навмисно ховає.
 */

export const OWNER_API = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/** Куди писати, коли автоматично не вийшло. Одне місце для всіх текстів. */
export const HELP_ADDRESS = 'hello@camptribe.eu';

export type OwnerOutcome =
  | { kind: 'accepted' }
  | { kind: 'confirmed'; slug: string; name: string | null }
  | { kind: 'refused'; code: string; message: string }
  | { kind: 'signed-out' }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

/** Запасні тексти: `message` із сервера переважає, цей перелік — дно. */
export const OWNER_REFUSAL_TEXT: Record<string, string> = {
  bad_email: 'That does not look like an email address.',
  link_invalid:
    'This link does not work: it has been used, it has expired, or it was started from another account. Start again from the campsite page.',
  mail_unavailable:
    'We cannot send letters right now. Nothing was recorded — try later.',
};

/**
 * Найпростіша перевірка перед відправкою: щоб не рахувати запит за ліміт на
 * друкарській помилці. Остаточно вирішує сервер.
 */
export function emailLooksUsable(input: string): boolean {
  const e = input.trim();
  if (e.length < 6 || e.length > 254) return false;
  if (/[\s,;<>"'()\\[\]]/.test(e)) return false;
  const parts = e.split('@');
  return parts.length === 2 && parts[0] !== '' && parts[1].includes('.');
}

/** Токен із `?t=…`. Порожній рядок — посилання без токена. */
export function tokenFromSearch(search: string): string {
  const t = new URLSearchParams(search).get('t') ?? '';
  return /^[A-Za-z0-9_-]{20,200}$/.test(t) ? t : '';
}

function explain(status: number, body: unknown): OwnerOutcome {
  const rec = (body ?? {}) as Record<string, unknown>;
  const code = typeof rec.code === 'string' ? rec.code : '';
  const fromServer =
    typeof rec.message === 'string' && rec.message !== '' ? rec.message : '';
  if (status === 401) return { kind: 'signed-out' };
  if (status === 202 && rec.accepted === true) return { kind: 'accepted' };
  if (status === 200 && rec.confirmed === true)
    return {
      kind: 'confirmed',
      slug: typeof rec.slug === 'string' ? rec.slug : '',
      name: typeof rec.name === 'string' ? rec.name : null,
    };
  return {
    kind: 'refused',
    code,
    message: fromServer || OWNER_REFUSAL_TEXT[code] || 'That did not work.',
  };
}

async function post(
  path: string,
  payload: unknown,
  base: string,
  fetchImpl: Fetch,
  storage?: Storage,
): Promise<OwnerOutcome> {
  if (base === '') return { kind: 'unavailable' };
  const session = readSession(storage);
  // 🔴 Без сесії запиту НЕ ВІДБУВАЄТЬСЯ: грант кладеться на акаунт.
  if (!session) return { kind: 'signed-out' };
  let res: Response;
  try {
    res = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(payload),
      credentials: 'omit',
    });
  } catch {
    return { kind: 'failed' };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Порожнє тіло — не помилка.
  }
  return explain(res.status, body);
}

export const startOwnerLink = (
  slug: string,
  email: string,
  base: string = OWNER_API,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
  storage?: Storage,
) =>
  post(
    '/spot-claims/by-email',
    { slug, email: email.trim() },
    base,
    fetchImpl,
    storage,
  );

export const confirmOwnerLink = (
  token: string,
  base: string = OWNER_API,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
  storage?: Storage,
) => post('/spot-claims/by-email/confirm', { token }, base, fetchImpl, storage);
