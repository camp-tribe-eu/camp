// Підписка на листи — що шле поле в підвалі й як читає відповідь.
//
// 🔴 ЧИСТА ЛОГІКА, БЕЗ React І БЕЗ МЕРЕЖІ ЗА ЗАМОВЧУВАННЯМ: `fetch`, адреса API
// й годинник приходять параметрами, тож усе, що тут вирішується, перевіряється
// на даних. Компонент (components/newsletter-form.tsx) лише зʼєднує це з React —
// той самий поділ, що в contact-form.ts.
//
// 🔴 ЩО ЙДЕ ДРОТОМ, БУДУЄ `requestBody` І НІДЕ ІНДЕ: адреса і два числа, які не
// про людину (поле, яке має лишитись порожнім, і скільки мілісекунд форма була
// відкрита). API відмовляє тілу з будь-яким іншим полем (`newsletter.rules.ts`),
// тож «корисне» доповнення тут — це 400 на першому ж натисканні, а не стовпчик
// даних, який ніхто не вирішував збирати.

/** Адреса API з браузера. Порожньо — запиту немає, і форма так і каже. */
export const NEWSLETTER_API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

/** Ті самі межі, що в API (`LIMITS`, `MIN_FILL_MS` у newsletter.rules.ts; специфікація їх порівнює). */
export const MAX_EMAIL = 254;
export const MIN_FILL_MS = 3000;
/** Запас над мінімумом, щоб тремтіння таймера ніколи не кинуло людину під нього. */
export const FILL_MARGIN_MS = 250;

// Схожа на адресу; суддя — API (`isPlainAddress`).
const ADDRESS = /^[^\s@<>(),;:"\\[\]]+@[^\s@<>(),;:"\\[\]]+\.[^\s@<>(),;:"\\[\]]+$/;
const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;

/** `null` — адреса прийнятна; інакше — що сказати людині. */
export function validateEmail(raw: string): string | null {
  const email = raw.trim();
  if (email === "") return "Please give your email address.";
  if (email.length > MAX_EMAIL || CONTROL.test(email) || !ADDRESS.test(email))
    return "That does not look like an email address.";
  return null;
}

export type SubscriptionBody = {
  email: string;
  leaveBlank: "";
  elapsedMs: number;
};

/** Єдине місце, де будується тіло запиту. */
export function requestBody(email: string, elapsedMs: number): SubscriptionBody {
  return { email: email.trim(), leaveBlank: "", elapsedMs: Math.round(elapsedMs) };
}

/** Скільки кнопка ще мусить зачекати, перш ніж API прийме запит. */
export function waitBeforeSending(openedForMs: number): number {
  return Math.max(0, MIN_FILL_MS + FILL_MARGIN_MS - openedForMs);
}

export type SubscribeOutcome =
  /** 200: прийнято. Це НЕ означає «лист пішов» — API відповідає так само на будь-яку адресу. */
  | "sent"
  /** 400: сервер не погодився з адресою. */
  | "invalid"
  /** 429: з цього зʼєднання вже досить. */
  | "throttled"
  /** Немає адреси API: форма нічого не може відправити. */
  | "unavailable"
  /** 503, мережа чи відповідь не того вигляду. */
  | "failed";

/** Статус → наслідок. Вирішує `status`; тіло не читається. */
export function interpret(status: number): SubscribeOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 400) return "invalid";
  if (status === 429) return "throttled";
  return "failed";
}

/**
 * 🔴 «Check your inbox to confirm» — ЄДИНА ВІДПОВІДЬ УСПІХУ, і вона не каже, чи
 * лист справді пішов: API однаково відповідає на нову, очікувану й уже
 * підтверджену адресу (інакше форма була б способом дізнатися, хто у списку).
 * Тому речення чесно ставить умову, а не обіцяє лист.
 */
export const SENT_TITLE = "Check your inbox to confirm";
export const SENT_BODY =
  "We have sent a letter with a confirmation link, unless this address is already on our list. You are not subscribed until you press “Confirm” on the page that link opens, and we send nothing else until then.";

export function messageFor(outcome: Exclude<SubscribeOutcome, "sent">): string {
  switch (outcome) {
    case "invalid":
      return "That does not look like an email address.";
    case "throttled":
      return "Enough requests from this connection for now. Please try again in a few minutes.";
    case "unavailable":
      return "Subscribing is not available right now. Nothing was sent.";
    case "failed":
      return "We could not subscribe you just now. Please try again in a little while.";
  }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Попросити підписку.
 *
 * 🔴 ПОРОЖНЯ АДРЕСА API НІЧОГО НЕ ШЛЕ — `fetchImpl` не викликається, і наслідок
 * це каже. Ні облікових даних, ні куки: `credentials: 'omit'` сказано, а не
 * залишено за замовчуванням, бо сесія читача не має їхати разом із адресою.
 */
export async function sendSubscription(
  body: SubscriptionBody,
  api: string = NEWSLETTER_API,
  fetchImpl: Fetch = (i, init) => fetch(i, init),
): Promise<SubscribeOutcome> {
  if (api === "") return "unavailable";
  try {
    const res = await fetchImpl(`${api}/newsletter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(body),
    });
    return interpret(res.status);
  } catch {
    return "failed";
  }
}

// ── посилання з листа: сторінка сайту + кнопка ────────────────────────
//
// 🔴 ВІДКРИТТЯ ПОСИЛАННЯ НІЧОГО НЕ МІНЯЄ. Поштові сканери (Safe Links, проксі
// Gmail, корпоративні шлюзи) відкривають усі посилання з листа самі; зміну
// робить лише кнопка на сторінці — `POST /newsletter/confirm|unsubscribe` із
// токеном У ТІЛІ (не в адресі запиту: адресу пише журнал вебсервера).

export type LinkAction = "confirm" | "unsubscribe";

/** Такий токен ми видаємо (base64url від 32 байтів); те саме, що `TOKEN_SHAPE` в API. */
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;

/** Токен із `?token=…` адреси сторінки; порожній рядок — токена немає чи він не нашого вигляду. */
export function tokenFrom(search: string): string {
  const t = new URLSearchParams(search).get("token") ?? "";
  return TOKEN.test(t) ? t : "";
}

export type LinkOutcome =
  /** 200: зроблено. */
  | "done"
  /** 400: посилання прострочене, використане чи не те. */
  | "invalid"
  | "throttled"
  | "unavailable"
  | "failed";

export function interpretLink(status: number): LinkOutcome {
  if (status >= 200 && status < 300) return "done";
  if (status === 400) return "invalid";
  if (status === 429) return "throttled";
  return "failed";
}

/** Натиснути кнопку: один POST, токен у тілі, без облікових даних. Порожня адреса API нічого не шле. */
export async function sendLinkAction(
  action: LinkAction,
  token: string,
  api: string = NEWSLETTER_API,
  fetchImpl: Fetch = (i, init) => fetch(i, init),
): Promise<LinkOutcome> {
  if (api === "") return "unavailable";
  try {
    const res = await fetchImpl(`${api}/newsletter/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ token }),
    });
    return interpretLink(res.status);
  } catch {
    return "failed";
  }
}
