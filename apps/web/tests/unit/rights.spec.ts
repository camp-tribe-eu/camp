import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DELETION_WINDOW_DAYS,
  EMPTY_DELETE,
  EXPORT_HOURS,
  PHOTO_CHOICES,
  archiveFrom,
  askForExport,
  canDelete,
  deleteMyAccount,
  formatWhen,
  getExportFile,
  getExportStatus,
  parseExportStatus,
  type DeleteDraft,
  type Deps,
} from '@/lib/rights';
import { SESSION_KEY } from '@/lib/session-store';

// CAMP-229 (3/3) — розмова сторінок «Ваші дані» і «Видалити акаунт» з API.
//
// 🔴 `Response` ТУТ СПРАВЖНІЙ (як у cabinet.spec.ts): підміна віддає сирі байти зі
// статусом, а розбирає їх сам код. Тіла — ті, що API справді віддає
// (`apps/api/src/auth/account-rights.controller.ts`, і `account-rights.db.spec.ts`
// читає їх з живого сервера).

const BASE = 'https://api.example';
const NOW = Date.parse('2026-10-16T12:00:00Z');
const TOKEN = 'T'.repeat(43);

const session = () =>
  JSON.stringify({
    token: TOKEN,
    expiresAt: new Date(NOW + 3_600_000).toISOString(),
    email: 'anna@example.com',
  });

function memory(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    has: (k: string) => m.has(k),
  };
}

type Call = { url: string; init: RequestInit };
function server(respond: () => Response | never) {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond();
    },
  };
}
const json = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

const signedIn = () => memory({ [SESSION_KEY]: session() });
const deps = (store: ReturnType<typeof memory>, s: ReturnType<typeof server>, over: Deps = {}): Deps => ({
  base: BASE,
  storage: store,
  now: NOW,
  fetchImpl: s.fetch,
  ...over,
});

const FULL: DeleteDraft = { photos: 'keep-anonymous', password: 'pw', understood: true };

test.describe('🔴 the numbers and words the screens quote are the API’s', () => {
  const api = readFileSync(
    join(__dirname, '..', '..', '..', 'api', 'src', 'auth', 'account-deletion.ts'),
    'utf8',
  );

  test('thirty days', () => {
    expect(/export const DELETION_WINDOW_DAYS = (\d+);/.exec(api)?.[1]).toBe(
      String(DELETION_WINDOW_DAYS),
    );
    expect(DELETION_WINDOW_DAYS).toBe(30);
  });

  test('the two answers about photos, in the same order, and no third', () => {
    const list = /export const PHOTO_CHOICES = \[([^\]]*)\] as const;/.exec(api)?.[1] ?? '';
    const fromApi = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(fromApi.length).toBeGreaterThan(0);
    expect(fromApi).toEqual([...PHOTO_CHOICES]);
    expect([...PHOTO_CHOICES]).toEqual(['delete', 'keep-anonymous']);
  });

  test('the archive lives 24 hours', () => {
    expect(api).toContain('const DAY_MS = 24 * 60 * 60 * 1000;');
    expect(api).toContain('export const EXPORT_TTL_MS = DAY_MS;');
    expect(EXPORT_HOURS).toBe(24);
  });
});

test.describe('🔴 the form starts empty', () => {
  test('nothing chosen, no password, nothing ticked — written out, not read back', () => {
    expect(EMPTY_DELETE).toEqual({ photos: null, password: '', understood: false });
  });

  test('and an empty form cannot be sent: each of the three, missing alone, blocks it', () => {
    expect(canDelete(FULL)).toBe(true);
    expect(canDelete({ ...FULL, photos: null })).toBe(false);
    expect(canDelete({ ...FULL, password: '' })).toBe(false);
    expect(canDelete({ ...FULL, understood: false })).toBe(false);
    expect(canDelete(EMPTY_DELETE)).toBe(false);
  });
});

test.describe('the archive: what the server says', () => {
  test('every status the API sends is read, and nothing else is', () => {
    expect(parseExportStatus({ status: 'none' })).toEqual({ status: 'none' });
    expect(parseExportStatus({ status: 'preparing', requestedAt: 'x' })).toEqual({
      status: 'preparing',
    });
    expect(parseExportStatus({ status: 'failed', requestedAt: 'x' })).toEqual({ status: 'failed' });
    expect(
      parseExportStatus({ status: 'ready', requestedAt: 'x', expiresAt: '2026-10-17T12:00:00.000Z' }),
    ).toEqual({ status: 'ready', expiresAt: '2026-10-17T12:00:00.000Z' });
    for (const bad of [
      null,
      undefined,
      'ready',
      [],
      {},
      { status: 'done' },
      { status: 'ready' },
      { status: 'ready', expiresAt: 'tomorrow' },
      { status: 'ready', expiresAt: 5 },
    ])
      expect(parseExportStatus(bad), JSON.stringify(bad)).toBeNull();
  });

  test('a status maps to the screen state of the same name', () => {
    expect(archiveFrom({ status: 'none' })).toEqual({ kind: 'none' });
    expect(archiveFrom({ status: 'preparing' })).toEqual({ kind: 'preparing' });
    expect(archiveFrom({ status: 'failed' })).toEqual({ kind: 'failed' });
    expect(archiveFrom({ status: 'ready', expiresAt: 'e' })).toEqual({
      kind: 'ready',
      expiresAt: 'e',
    });
  });

  test('asks with the session token, no cookie, and no cache', async () => {
    const s = server(() => json(200, { status: 'none' }));
    const out = await getExportStatus(deps(signedIn(), s));
    expect(out).toEqual({ kind: 'ok', value: { status: 'none' } });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].url).toBe(`${BASE}/account/export`);
    expect(s.calls[0].init.method).toBe('GET');
    expect((s.calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(s.calls[0].init.credentials).toBe('omit');
    expect(s.calls[0].init.cache).toBe('no-store');
  });

  test('no session: signed out, and the server is not asked', async () => {
    const s = server(() => json(200, { status: 'none' }));
    expect(await getExportStatus(deps(memory(), s))).toEqual({ kind: 'signed-out' });
    expect(s.calls).toHaveLength(0);
  });

  test('no API address: unavailable, and nothing is asked', async () => {
    const s = server(() => json(200, { status: 'none' }));
    expect(await getExportStatus(deps(signedIn(), s, { base: '' }))).toEqual({ kind: 'unavailable' });
    expect(s.calls).toHaveLength(0);
  });

  test('401 means the token is dead: signed out AND the stored session is cleared', async () => {
    const store = signedIn();
    const s = server(() => json(401, { code: 'no_session', message: 'x' }));
    expect(store.has(SESSION_KEY)).toBe(true);
    expect(await getExportStatus(deps(store, s))).toEqual({ kind: 'signed-out' });
    expect(store.has(SESSION_KEY)).toBe(false);
  });

  test('a failure is a failure, not a signed-out person: the session stays', async () => {
    for (const respond of [
      () => json(500, 'boom'),
      () => json(200, { status: 'surprising' }),
      () => json(200, 'not json'),
      () => {
        throw new Error('network');
      },
    ]) {
      const store = signedIn();
      expect(await getExportStatus(deps(store, server(respond)))).toEqual({ kind: 'failed' });
      expect(store.has(SESSION_KEY)).toBe(true);
    }
  });

  test('429 is "throttled", not a failure to be retried at once', async () => {
    expect(await getExportStatus(deps(signedIn(), server(() => json(429, {}))))).toEqual({
      kind: 'throttled',
    });
  });

  test('asking for an archive wants 202 and a status; a 200 is not what was asked for', async () => {
    const ok = server(() => json(202, { status: 'preparing', requestedAt: 'x' }));
    expect(await askForExport(deps(signedIn(), ok))).toEqual({
      kind: 'ok',
      value: { status: 'preparing' },
    });
    expect(ok.calls[0].init.method).toBe('POST');
    expect(ok.calls[0].url).toBe(`${BASE}/account/export`);
    expect(
      await askForExport(deps(signedIn(), server(() => json(200, { status: 'preparing' })))),
    ).toEqual({ kind: 'failed' });
  });
});

test.describe('🔴 the file: only what opens is offered', () => {
  const ARCHIVE = JSON.stringify({ about: { format: 'camptribe-data-export' }, account: { email: 'a@b.co' } });

  test('a file that parses is handed over with a dated name', async () => {
    const out = await getExportFile(deps(signedIn(), server(() => json(200, ARCHIVE))));
    expect(out).toEqual({ kind: 'ok', filename: 'camptribe-data-2026-10-16.json', text: ARCHIVE });
    // and what is handed over parses back to what was sent
    if (out.kind === 'ok') expect(JSON.parse(out.text).account.email).toBe('a@b.co');
  });

  test('a body that is not JSON is a failure, not a file saved to disk', async () => {
    for (const body of ['<html>nope</html>', '{"truncated": ', '']) {
      const store = signedIn();
      expect(await getExportFile(deps(store, server(() => json(200, body))))).toEqual({ kind: 'failed' });
      expect(store.has(SESSION_KEY)).toBe(true);
    }
  });

  test('404 is "gone": the day ran out, or there was never one', async () => {
    expect(await getExportFile(deps(signedIn(), server(() => json(404, { code: 'no_export' }))))).toEqual({
      kind: 'gone',
    });
  });

  test('401 signs out and clears the session; 500 fails', async () => {
    const store = signedIn();
    expect(await getExportFile(deps(store, server(() => json(401, {}))))).toEqual({ kind: 'signed-out' });
    expect(store.has(SESSION_KEY)).toBe(false);
    expect(await getExportFile(deps(signedIn(), server(() => json(500, {}))))).toEqual({ kind: 'failed' });
  });
});

test.describe('🔴 deleting: what is sent, and what is done with the answer', () => {
  const OK = { deleted: true, restorableUntil: '2026-11-15T12:00:00.000Z' };

  test('sends exactly the three fields the server requires, as typed', async () => {
    const s = server(() => json(200, OK));
    await deleteMyAccount(FULL, deps(signedIn(), s));
    expect(s.calls[0].url).toBe(`${BASE}/account/delete`);
    expect(s.calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(s.calls[0].init.body))).toEqual({
      password: 'pw',
      photos: 'keep-anonymous',
      understood: true,
    });
    expect((s.calls[0].init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect((s.calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });

  test('an unfinished form is never sent, and nothing is filled in for it', async () => {
    const s = server(() => json(200, OK));
    for (const draft of [
      EMPTY_DELETE,
      { ...FULL, photos: null },
      { ...FULL, password: '' },
      { ...FULL, understood: false },
    ]) {
      const out = await deleteMyAccount(draft, deps(signedIn(), s));
      expect(out.kind).toBe('incomplete');
    }
    expect(s.calls).toHaveLength(0);
  });

  test('success: the session is cleared at once — the server has closed it', async () => {
    const store = signedIn();
    const out = await deleteMyAccount(FULL, deps(store, server(() => json(200, OK))));
    expect(out).toEqual({ kind: 'ok', restorableUntil: OK.restorableUntil });
    expect(store.has(SESSION_KEY)).toBe(false);
  });

  test('a wrong password is its own answer, and the session stays: the person is still signed in', async () => {
    const store = signedIn();
    const out = await deleteMyAccount(
      FULL,
      deps(store, server(() => json(403, { code: 'wrong_password', message: 'x' }))),
    );
    expect(out).toEqual({ kind: 'wrong-password' });
    expect(store.has(SESSION_KEY)).toBe(true);
  });

  test('429, 400 and a failure leave the session alone too', async () => {
    for (const [respond, want] of [
      [() => json(429, {}), { kind: 'throttled' }],
      [
        () => json(400, { code: 'photo_choice_required', message: 'x' }),
        { kind: 'incomplete', code: 'photo_choice_required' },
      ],
      [() => json(500, {}), { kind: 'failed' }],
      [
        () => {
          throw new Error('network');
        },
        { kind: 'failed' },
      ],
    ] as const) {
      const store = signedIn();
      expect(await deleteMyAccount(FULL, deps(store, server(respond)))).toEqual(want);
      expect(store.has(SESSION_KEY)).toBe(true);
    }
  });

  test('401 is signed-out and clears the session', async () => {
    const store = signedIn();
    expect(await deleteMyAccount(FULL, deps(store, server(() => json(401, {}))))).toEqual({
      kind: 'signed-out',
    });
    expect(store.has(SESSION_KEY)).toBe(false);
  });

  test('a 200 that is not the promised answer is not trusted as "done"', async () => {
    for (const body of [{}, { deleted: false }, { deleted: true }, { deleted: true, restorableUntil: 'soon' }, 'ok']) {
      const store = signedIn();
      expect(await deleteMyAccount(FULL, deps(store, server(() => json(200, body))))).toEqual({
        kind: 'failed',
      });
      expect(store.has(SESSION_KEY), JSON.stringify(body)).toBe(true);
    }
  });
});

test.describe('dates', () => {
  test('one format, in UTC, whatever the reader’s zone', () => {
    expect(formatWhen('2026-11-15T12:00:00.000Z')).toBe('15 November 2026, 12:00 UTC');
    expect(formatWhen('2026-10-17T00:05:00.000Z')).toBe('17 October 2026, 00:05 UTC');
    expect(formatWhen('2026-12-31T23:59:00.000Z')).toBe('31 December 2026, 23:59 UTC');
  });
});
