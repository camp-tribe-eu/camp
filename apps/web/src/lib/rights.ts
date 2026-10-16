// CAMP-229 (3/3) — розмова сторінок «Ваші дані» і «Видалити акаунт» з API.
//
// 🔴 ЧИСТА ЛОГІКА, БЕЗ React. Адреса API, сховище, годинник і `fetch` приходять
// параметрами, тож усе, що тут вирішується, перевіряється на ВІДПОВІДЯХ, які
// API справді віддає (`apps/api/src/auth/account-rights.controller.ts`), а не на
// підміненій функції, що повертає готовий висновок. Сторінки лише переносять
// результат у розмітку.
//
// 🔴 СЕСІЯ ЧИТАЄТЬСЯ ТУТ ЖЕ, А НЕ ПЕРЕДАЄТЬСЯ ЗВЕРХУ. Токен лежить у сховищі
// (lib/session-store.ts); функція, що його потребує, бере його сама й чистить, коли
// сервер сказав «ні». Компонент, якому токен передали б пропсом, тримав би його в
// памʼяті довше, ніж він живий.

import { ACCOUNT_API } from '@/lib/account';
import { clearSession, readSession } from '@/lib/session-store';

/**
 * Скільки днів видалений акаунт можна повернути входом.
 *
 * 🔴 ДУБЛЬ ЧИСЛА З API (`DELETION_WINDOW_DAYS` у `account-deletion.ts`) — він
 * стоїть у тексті екрана («30 днів»), і сервер тримає акаунт рівно стільки.
 * `tests/unit/rights.spec.ts` читає API-файл і порівнює.
 */
export const DELETION_WINDOW_DAYS = 30;

/** Як довго живе готовий архів, годин. Дубль `EXPORT_TTL_MS` API; та сама перевірка. */
export const EXPORT_HOURS = 24;

/**
 * Дві відповіді на «що зробити з моїми фото» — і ТРЕТЬОЇ немає.
 *
 * 🔴 Дубль `PHOTO_CHOICES` з API; `rights.spec.ts` читає той файл і порівнює
 * списки. Порядок — порядок на екрані.
 */
export const PHOTO_CHOICES = ['delete', 'keep-anonymous'] as const;
export type PhotoChoice = (typeof PHOTO_CHOICES)[number];

/**
 * Чернетка форми видалення.
 *
 * 🔴 ЦЕ ПОЧАТКОВИЙ СТАН ФОРМИ, І ВІН ПОРОЖНІЙ: доля фото не обрана (`null`), пароль
 * порожній, «розумію» не поставлено. Компонент стартує саме з цієї константи, а
 * тест рендерить компонент у цьому стані й читає HTML: жодного `checked` у жодного
 * варіанта. Нам вигідніше, щоб фото лишились, — тому тут не стоїть `'keep-anonymous'`
 * (Planet49, C-673/17: наперед позначений варіант — не вибір).
 */
export type DeleteDraft = {
  photos: PhotoChoice | null;
  password: string;
  understood: boolean;
};
export const EMPTY_DELETE: DeleteDraft = { photos: null, password: '', understood: false };

/** Чи є що надсилати. Кнопка вимкнена, доки людина сама не обрала й не підтвердила. */
export const canDelete = (d: DeleteDraft): boolean =>
  d.photos !== null && d.password !== '' && d.understood;

// ── Архів ───────────────────────────────────────────────────────────────

export type ExportStatus =
  | { status: 'none' }
  | { status: 'preparing' }
  | { status: 'ready'; expiresAt: string }
  | { status: 'failed' };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Стан архіву потрібної форми — і лише він. Інше — `null`, а не вгадана відповідь. */
export function parseExportStatus(body: unknown): ExportStatus | null {
  if (!isRecord(body)) return null;
  switch (body.status) {
    case 'none':
    case 'preparing':
    case 'failed':
      return { status: body.status };
    case 'ready':
      // Готовий архів без строку — не готовий: сторінка не скаже, до якого часу він живе.
      return typeof body.expiresAt === 'string' && Number.isFinite(Date.parse(body.expiresAt))
        ? { status: 'ready', expiresAt: body.expiresAt }
        : null;
    default:
      return null;
  }
}

/**
 * Де архів, у термінах екрана. `checking` — поки сервер не відповів; `unreachable` —
 * не вдалось дізнатись (мережа, 5xx, відповідь не тієї форми), і це НЕ «не вийшло
 * приготувати»: про архів нічого не відомо.
 */
export type ArchiveState =
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'preparing' }
  | { kind: 'ready'; expiresAt: string }
  | { kind: 'failed' }
  | { kind: 'unreachable' }
  | { kind: 'unavailable' };

/** Стан, який назвав сервер, → стан екрана. Назви збігаються, окрім `status` → `kind`. */
export const archiveFrom = (s: ExportStatus): ArchiveState =>
  s.status === 'ready' ? { kind: 'ready', expiresAt: s.expiresAt } : { kind: s.status };

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type SessionStorageLike = Pick<Storage, 'getItem' | 'removeItem'>;

export type Deps = {
  base?: string;
  storage?: SessionStorageLike;
  now?: number;
  fetchImpl?: Fetch;
};

/** Чому відповіді немає. Спільне для всіх викликів. */
type Failure = { kind: 'signed-out' } | { kind: 'unavailable' } | { kind: 'failed' };

/**
 * Один запит із токеном сесії. Не кидає.
 *
 * Порядок свідомий, як у `loadCabinet`: нема сесії → `signed-out` БЕЗ запиту;
 * нема адреси API → `unavailable`; мережа впала → `failed`; 401 → `signed-out` і
 * сховище чиститься (токен мертвий).
 */
async function authed(
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

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export type StatusCall = { kind: 'ok'; value: ExportStatus } | Failure | { kind: 'throttled' };

/** Де архів: немає, готується, готовий чи не вийшов. */
export async function getExportStatus(deps: Deps = {}): Promise<StatusCall> {
  const out = await authed('/account/export', { method: 'GET' }, deps);
  if (out.kind !== 'response') return out;
  if (out.res.status === 429) return { kind: 'throttled' };
  if (out.res.status !== 200) return { kind: 'failed' };
  const value = parseExportStatus(await readJson(out.res));
  return value === null ? { kind: 'failed' } : { kind: 'ok', value };
}

/** Попросити архів. 202 і тіло «готується» — інакше це не те, про що ми просили. */
export async function askForExport(deps: Deps = {}): Promise<StatusCall> {
  const out = await authed('/account/export', { method: 'POST', body: {} }, deps);
  if (out.kind !== 'response') return out;
  if (out.res.status === 429) return { kind: 'throttled' };
  if (out.res.status !== 202) return { kind: 'failed' };
  const value = parseExportStatus(await readJson(out.res));
  return value === null ? { kind: 'failed' } : { kind: 'ok', value };
}

export type FileCall =
  | { kind: 'ok'; filename: string; text: string }
  /** 404: файлу вже немає (строк минув) або ще немає. */
  | { kind: 'gone' }
  | Failure;

/**
 * Сам файл.
 *
 * 🔴 ПЕРЕД ТИМ, ЯК ВІДДАТИ ЛЮДИНІ, ВІН РОЗБИРАЄТЬСЯ: файл, що не відкривається, —
 * це «Завантажити», яке нічого не дає. Тіло, що не є JSON, — `failed`, а не
 * збережений на диск уламок.
 *
 * Імʼя файлу складається тут, а не береться із `Content-Disposition`: браузер
 * ховає заголовки відповіді з іншого origin, що не вказані в CORS (API їх не
 * відкриває), тож заголовок сторінка прочитати не може.
 */
export async function getExportFile(deps: Deps = {}): Promise<FileCall> {
  const out = await authed('/account/export/file', { method: 'GET' }, deps);
  if (out.kind !== 'response') return out;
  if (out.res.status === 404) return { kind: 'gone' };
  if (out.res.status !== 200) return { kind: 'failed' };
  let text: string;
  try {
    text = await out.res.text();
    JSON.parse(text);
  } catch {
    return { kind: 'failed' };
  }
  const day = new Date(deps.now ?? Date.now()).toISOString().slice(0, 10);
  return { kind: 'ok', filename: `camptribe-data-${day}.json`, text };
}

// ── Видалення ───────────────────────────────────────────────────────────

export type DeleteCall =
  /** Усе зроблено; `restorableUntil` — остання мить, коли вхід поверне акаунт. */
  | { kind: 'ok'; restorableUntil: string }
  /** 403: пароль не той. Нічого не видалено. */
  | { kind: 'wrong-password' }
  /** 400: форма неповна. Сторінка не мала б це надіслати — але сервер не вірить сторінці. */
  | { kind: 'incomplete'; code: string }
  | { kind: 'throttled' }
  | Failure;

/**
 * Видалити акаунт.
 *
 * 🔴 `photos` ТУТ НЕ МАЄ ТИПОВОГО ЗНАЧЕННЯ: чернетка без вибору не надсилається
 * взагалі (`canDelete`), а не доповнюється. Сервер у цьому ж місці відповів би 400,
 * і це друга лінія, а не перша.
 *
 * 🔴 ПІСЛЯ УСПІХУ СЕСІЯ ЧИСТИТЬСЯ ТУТ ЖЕ. API закрило всі сесії акаунта в тому самому
 * запиті; токен у сховищі мертвий, і тримати його означало б показувати «ви ввійшли»
 * на наступній сторінці, поки перший запит не скаже 401.
 */
export async function deleteMyAccount(draft: DeleteDraft, deps: Deps = {}): Promise<DeleteCall> {
  if (!canDelete(draft)) return { kind: 'incomplete', code: 'not_filled_in' };
  const out = await authed(
    '/account/delete',
    {
      method: 'POST',
      body: { password: draft.password, photos: draft.photos, understood: draft.understood },
    },
    deps,
  );
  if (out.kind !== 'response') return out;
  const { res } = out;
  if (res.status === 403) return { kind: 'wrong-password' };
  if (res.status === 429) return { kind: 'throttled' };
  if (res.status === 400) {
    const b = await readJson(res);
    return { kind: 'incomplete', code: isRecord(b) && typeof b.code === 'string' ? b.code : '' };
  }
  if (res.status !== 200) return { kind: 'failed' };
  const body = await readJson(res);
  if (
    !isRecord(body) ||
    body.deleted !== true ||
    typeof body.restorableUntil !== 'string' ||
    !Number.isFinite(Date.parse(body.restorableUntil))
  )
    return { kind: 'failed' };
  clearSession(deps.storage);
  return { kind: 'ok', restorableUntil: body.restorableUntil };
}

/** `2026-11-15T12:00:00Z` → «15 November 2026, 12:00 UTC». Один формат, без залежності від пояса читача. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  return `${date}, ${time} UTC`;
}
