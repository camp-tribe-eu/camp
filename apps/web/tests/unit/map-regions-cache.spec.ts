import { expect, test } from '@playwright/test';
import { mapRegions } from '@/lib/api';

// 🔴 CAMP-476. `mapRegions()` склеює ОДНОЧАСНІ запити, але не тримає
// відповідь довше за політ: інакше тижневий імпорт не доходить до мап
// країн до перезапуску процесу, а тести залежать від порядку файлів.

const row = (country: string) => ({ country, region: 'Somewhere', slug: 'somewhere', spots: 1 });

async function counting(body: unknown, run: (calls: () => number) => Promise<void>) {
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async () => {
    n++;
    await new Promise((r) => setTimeout(r, 5));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    await run(() => n);
  } finally {
    globalThis.fetch = real;
  }
}

test('одночасні виклики — один запит', async () => {
  await counting([row('mt')], async (calls) => {
    const [a, b, c] = await Promise.all([mapRegions(), mapRegions(), mapRegions()]);
    expect(calls()).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

test('🔴 після відповіді наступний виклик питає знову — нові дані доходять', async () => {
  await counting([row('mt')], async (calls) => {
    await mapRegions();
    await mapRegions();
    expect(calls()).toBe(2);
  });
  await counting([row('hr')], async () => {
    const fresh = await mapRegions();
    expect(fresh[0].country).toBe('hr');
  });
});

test('провал не прилипає: наступний виклик пробує ще раз', async () => {
  await counting([], async (calls) => {
    await expect(mapRegions()).rejects.toThrow(/No regions/);
    await expect(mapRegions()).rejects.toThrow(/No regions/);
    expect(calls()).toBe(2);
  });
});
