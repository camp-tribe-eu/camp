import { readSession } from '@/lib/session-store';

/**
 * «Claim your listing» на боці сторінки. CAMP-51.
 *
 * 🔴 ПРАВИЛА ТУТ, РОЗМІТКА В `claim-view.tsx`, МЕРЕЖА В `claim-form.tsx` —
 * той самий поділ, що в `lib/account.ts`. Причина та сама: стан, який
 * можна перевірити лише кліками в браузері, перевіряють один раз.
 *
 * 🔴 І ЦЕЙ ПОТІК НЕСЕ ТОКЕН, НА ВІДМІНУ ВІД `lib/account.ts`. Там запити
 * свідомо йдуть без `Authorization`: вхід і скидання пароля роблять ті,
 * хто ще не ввійшов. Заявка на володіння — навпаки, вона НЕ МАЄ СЕНСУ
 * без акаунта, бо грант кладеться саме на нього.
 */

export const CLAIM_API = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Що відповіло API. `code` — його ж слово, щоб сторінка не вгадувала. */
export type ClaimOutcome =
  | { kind: 'sent'; sentTo: string; expiresAt: string }
  | { kind: 'confirmed' }
  | { kind: 'refused'; code: string; message: string }
  | { kind: 'signed-out' }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

/**
 * 🔴 ТЕКСТИ ТУТ, А НЕ ЗІ СЕРВЕРА — І ЦЕ НЕ ДУБЛЮВАННЯ.
 *
 * Сервер теж має речення на кожну відмову, і вони кращі за «щось пішло
 * не так». Але сторінка мусить лишатись зрозумілою, якщо API колись
 * відповість кодом без тексту; `message` із сервера переважає, цей
 * перелік — запасне дно. Без нього «тихий» код перетворився б на
 * порожній екран.
 */
export const REFUSAL_TEXT: Record<string, string> = {
  no_spot: 'We do not have a campsite at that address.',
  no_email:
    'This place has no public email in OpenStreetMap, so there is nowhere to send a code. Adding one to OSM is the way in.',
  already_claimed: 'Someone has already confirmed this listing.',
  spot_flooded: 'This place has had its letters for today. Try tomorrow.',
  user_flooded: 'You have asked for several codes today. Try tomorrow.',
  mail_unavailable:
    'We cannot send letters right now. Nothing was recorded — try later.',
  no_pending: 'No code is waiting for this place on your account.',
  expired: 'That code has expired. Ask for a new one.',
  burned: 'That code was typed wrong too many times. Ask for a new one.',
  wrong_code: 'That code does not match.',
};

/** Те саме зведення, що робить API: пробіли, дефіси й регістр не рахуються. */
export function normaliseCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

/** Довжина коду в листі. Кнопка не вмикається, доки введено менше. */
export const CODE_LENGTH = 8;

export const codeLooksComplete = (input: string): boolean =>
  normaliseCode(input).length === CODE_LENGTH;

/** Крок, на якому стоїть сторінка. */
export type ClaimStep = 'ask' | 'code' | 'done';

/**
 * 🔴 ВІДМОВА НЕ ВІДКОЧУЄ КРОК — І ЦЕ ПЕРЕВІРЯЄТЬСЯ.
 *
 * Людина, яка помилилась кодом, має лишитись на введенні коду, а не
 * повернутись до кнопки «надіслати»: інакше кожна помилка коштує нового
 * листа чужому кемпінгу, і три помилки вичерпують денну межу.
 */
export function nextStep(now: ClaimStep, outcome: ClaimOutcome): ClaimStep {
  if (outcome.kind === 'sent') return 'code';
  if (outcome.kind === 'confirmed') return 'done';
  // 🔴 Два коди повертають на початок, бо на кроці коду робити вже нічого:
  // заявки немає (її не починали або вона згоріла зовсім).
  if (outcome.kind === 'refused' && outcome.code === 'no_pending') return 'ask';
  return now;
}

/** Чи має сенс пропонувати «надіслати ще раз». */
export function canAskAgain(outcome: ClaimOutcome | null): boolean {
  if (!outcome || outcome.kind !== 'refused') return false;
  return outcome.code === 'expired' || outcome.code === 'burned';
}

function explain(status: number, body: unknown): ClaimOutcome {
  const asRecord = (body ?? {}) as Record<string, unknown>;
  const code = typeof asRecord.code === 'string' ? asRecord.code : '';
  const fromServer =
    typeof asRecord.message === 'string' && asRecord.message !== ''
      ? asRecord.message
      : '';
  if (status === 401) return { kind: 'signed-out' };
  if (status === 202) {
    const sentTo = typeof asRecord.sentTo === 'string' ? asRecord.sentTo : '';
    const expiresAt =
      typeof asRecord.expiresAt === 'string' ? asRecord.expiresAt : '';
    return { kind: 'sent', sentTo, expiresAt };
  }
  if (status === 200 && asRecord.confirmed === true) return { kind: 'confirmed' };
  return {
    kind: 'refused',
    code,
    message: fromServer || REFUSAL_TEXT[code] || 'That did not work.',
  };
}

async function post(
  path: string,
  payload: unknown,
  base: string,
  fetchImpl: Fetch,
  storage?: Storage,
): Promise<ClaimOutcome> {
  if (base === '') return { kind: 'unavailable' };
  const session = readSession(storage);
  // 🔴 Без сесії запиту НЕ ВІДБУВАЄТЬСЯ. Інакше кожне відкриття сторінки
  // анонімом коштувало б нам 401 і виглядало б у логах як спроба.
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

export const startClaim = (
  slug: string,
  base: string = CLAIM_API,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
  storage?: Storage,
) => post('/spot-claims', { slug }, base, fetchImpl, storage);

export const confirmClaim = (
  slug: string,
  code: string,
  base: string = CLAIM_API,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
  storage?: Storage,
) =>
  post(
    '/spot-claims/confirm',
    { slug, code: normaliseCode(code) },
    base,
    fetchImpl,
    storage,
  );
