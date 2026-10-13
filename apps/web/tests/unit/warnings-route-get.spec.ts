import { expect, test } from '@playwright/test';

// CAMP-287 — сам обробник `GET`, якого не торкався жоден тест.
//
// 🔴 РЕЦЕНЗІЯ ПЕРЕЛІЧИЛА, ЩО БУЛО НЕВИДИМИМ: `if (!res.ok)` → `if
// (res.ok)`, `status: 503` → `200`, зняття `cache: 'no-store'`.
// Останнє найважливіше: саме 503 перетворює «не змогли прочитати» на
// `nothing-arrived` у клієнті, бо той дивиться на `r.ok`. Це
// твердження не було доведене нічим.
//
// 🔴 ПІДМІННИК ВІДДАЄ СИРЕ ТІЛО API, а не готовий фід. Шим із готовою
// відповіддю довів би лише сам себе.

const AT = '2026-10-13T14:22:21.335Z';
const apiBody = JSON.stringify({ fetchedAt: AT, warnings: [] });

async function callGet(impl: (url: string) => Promise<Response>) {
  const real = globalThis.fetch;
  const seen: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  globalThis.fetch = ((u: string, i?: RequestInit) => {
    seen.push(String(u));
    inits.push(i);
    return impl(String(u));
  }) as typeof fetch;
  try {
    const { GET } = await import('@/app/data/warnings.json/route');
    const res = await GET();
    return { res, seen, inits };
  } finally {
    globalThis.fetch = real;
  }
}

test('успіх: 200 і тіло у формі, яку читає панель', async () => {
  const { res } = await callGet(async () => new Response(apiBody, { status: 200 }));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { meta?: { fetchedAt?: string } };
  expect(body.meta?.fetchedAt).toBe(AT);
});

test('успіх: відповідь можна кешувати рівно стільки, скільки оголошено', async () => {
  const { res } = await callGet(async () => new Response(apiBody, { status: 200 }));
  const { CACHE_SECONDS } = await import('@/lib/warnings-feed');
  expect(res.headers.get('cache-control')).toBe(`public, max-age=${CACHE_SECONDS}`);
});

test('API відповів 500 → 503, щоб клієнт прочитав це як «нічого не приїхало»', async () => {
  const { res } = await callGet(async () => new Response('boom', { status: 500 }));
  expect(res.status).toBe(503);
});

test('API відповів 200, але не знімком → теж 503, а не «попереджень немає»', async () => {
  const { res } = await callGet(
    async () => new Response(JSON.stringify({ fetchedAt: null, warnings: [] }), { status: 200 }),
  );
  expect(res.status).toBe(503);
});

test('мережа впала → 503, а не виняток назовні', async () => {
  const { res } = await callGet(async () => {
    throw new Error('ECONNREFUSED');
  });
  expect(res.status).toBe(503);
});

test('невдача ніколи не кешується', async () => {
  const { res } = await callGet(async () => new Response('boom', { status: 500 }));
  expect(res.headers.get('cache-control')).toBe('no-store');
});

test('запит до API йде повз кеш — інакше ми кешували б кеш', async () => {
  const { seen, inits } = await callGet(async () => new Response(apiBody, { status: 200 }));
  expect(seen.length).toBe(1);
  expect(seen[0].endsWith('/warnings')).toBe(true);
  expect(inits[0]?.cache).toBe('no-store');
});

test('запит має стелю часу: API, що мовчить, не тримає сторінку', async () => {
  const { inits } = await callGet(async () => new Response(apiBody, { status: 200 }));
  expect(inits[0]?.signal).toBeTruthy();
});
