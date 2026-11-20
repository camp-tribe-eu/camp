import { isPlainAddress } from '../auth/mail-smtp';

// Підписка на листи — правила публічної форми, без Nest і без TypeORM (та сама
// причина, що в contact.rules.ts: правило поруч із декорованим класом цей
// jest-налаштунок не перевіряє).
//
// 🔴 ЩО ЗБИРАЄТЬСЯ, СКАЗАНО ПОВНІСТЮ: одна адреса — плюс два числа, які не про
// людину (скільки відкрита сторінка й поле, що має лишитись порожнім). Нічого
// більше тіло не несе: зайве поле — відмова, а не мовчазне відкидання.
//
// 🔴 ОДНА ВІДПОВІДЬ НА ВСЕ. Скрипт, що заповнив приховане поле чи натиснув
// надто швидко, отримує те саме «перевірте пошту», що й людина, і нічого не
// відбувається — бот, якому відмовили, пробує інакше; бот, якому подякували,
// іде. Ціна хибного спрацювання — одна людина мусить натиснути ще раз, тож
// сторінка сама чекає залишок часу (див. `waitBeforeSending` у вебі).

export const LIMITS = { email: 254 } as const;

/** Те саме, що `MIN_FILL_MS` у contact.rules.ts, окремою константою: дві форми — два рішення. */
export const MIN_FILL_MS = 3000;

const ALLOWED_KEYS = new Set(['email', 'leaveBlank', 'elapsedMs']);

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;

export type NewsletterProblem = {
  field: 'body' | 'email';
  code:
    | 'not_an_object'
    | 'unknown_field'
    | 'missing'
    | 'not_text'
    | 'too_long'
    | 'invalid';
  message: string;
};

export type ParsedSubscription = {
  /** Нижній регістр, обрізані пробіли: саме це йде в базу. */
  email: string;
  /** `true`, коли сторінка схожа на скриптову: пастка заповнена або форма відкрита надто коротко. */
  spam: boolean;
};

export type ParseResult =
  | { ok: true; subscription: ParsedSubscription }
  | { ok: false; problems: NewsletterProblem[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseSubscription(body: unknown): ParseResult {
  if (!isRecord(body)) {
    return {
      ok: false,
      problems: [
        {
          field: 'body',
          code: 'not_an_object',
          message: 'The request body must be a JSON object.',
        },
      ],
    };
  }

  const problems: NewsletterProblem[] = [];
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) {
      problems.push({
        field: 'body',
        code: 'unknown_field',
        message: `Unexpected field "${key}". A subscription carries an email address — nothing else.`,
      });
    }
  }

  const raw = body.email;
  let email: string | null = null;
  if (raw === undefined || raw === null || raw === '') {
    problems.push({
      field: 'email',
      code: 'missing',
      message: 'Please fill in your email address.',
    });
  } else if (typeof raw !== 'string') {
    problems.push({
      field: 'email',
      code: 'not_text',
      message: 'The email address must be text.',
    });
  } else {
    const value = raw.trim();
    if (value === '') {
      problems.push({
        field: 'email',
        code: 'missing',
        message: 'Please fill in your email address.',
      });
    } else if (value.length > LIMITS.email) {
      problems.push({
        field: 'email',
        code: 'too_long',
        message: `The email address is too long: at most ${LIMITS.email} characters.`,
      });
    } else if (
      CONTROL.test(value) ||
      !isPlainAddress(value) ||
      !value.slice(value.lastIndexOf('@') + 1).includes('.')
    ) {
      // 🔴 Той самий `isPlainAddress`, що перевіряє кожну адресу відправника:
      // що тут прийнято, те відправник прийме. CR/LF відсікаються окремо —
      // адреса йде в заголовок `To`.
      problems.push({
        field: 'email',
        code: 'invalid',
        message: 'That does not look like an email address.',
      });
    } else {
      email = value.toLowerCase();
    }
  }

  if (problems.length > 0 || email === null) return { ok: false, problems };

  const trap = body.leaveBlank;
  const trapped = trap !== undefined && trap !== null && trap !== '';
  const elapsed = body.elapsedMs;
  const tooFast =
    typeof elapsed !== 'number' ||
    !Number.isFinite(elapsed) ||
    elapsed < MIN_FILL_MS;

  return { ok: true, subscription: { email, spam: trapped || tooFast } };
}

/**
 * Токен із посилання — того вигляду, який ми самі видаємо (base64url від 32
 * байтів = 43 символи). Усе інше відсікається ДО бази: запит із сміттям не
 * коштує ні запиту, ні рядка в журналі.
 */
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43,128}$/;
export const isTokenShaped = (v: unknown): v is string =>
  typeof v === 'string' && TOKEN_SHAPE.test(v);

export type LinkActionResult = { ok: true; token: string } | { ok: false };

/**
 * Тіло `POST /newsletter/confirm|unsubscribe`: рівно `{ token }`, і токен —
 * такого вигляду, який ми видаємо. Усе інше — відмова до бази.
 */
export function parseLinkAction(body: unknown): LinkActionResult {
  if (!isRecord(body)) return { ok: false };
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'token') return { ok: false };
  return isTokenShaped(body.token)
    ? { ok: true, token: body.token }
    : { ok: false };
}
