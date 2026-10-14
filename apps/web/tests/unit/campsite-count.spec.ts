import { expect, test } from '@playwright/test';

import { generateMetadata } from '@/app/routes/page';
import { GET as llmsTxt } from '@/app/llms.txt/route';
import { publishableCampsiteCount } from '@/lib/campsite-count';

// CAMP-308: кількість кемпінгів у `description` сторінки `/routes`.
//
// 🔴 Тут читається те, що віддає `generateMetadata`, — тобто те, що Next
// покладе в `<meta name="description">`, — а не константа й не функція, з
// якої воно складене. Кожен випадок підміняє `fetch`, як це робить
// `route-services-fetch.spec.ts`, і тому проганяє справжню дорогу від
// відповіді API до тексту.

/**
 * 🔴 ТРИ РІЗНІ ЧИСЛА, а не одне й те саме. Якби `countries` і `regions`
 * збігались зі `spots`, помилка «взяв сусіднє поле» була б невидимою.
 */
const SUMMARY = { spots: 52501, countries: 27, regions: 800 };

/** Підміна `fetch` на час одного випробування; завжди повертається назад. */
async function withApi(
  answers: Record<string, { status?: number; body: unknown }>,
  run: () => Promise<void>,
) {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string) => {
    const hit = answers[new URL(String(url)).pathname];
    const { status = 200, body } = hit ?? { body: [] };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

const descriptionOf = async () => String((await generateMetadata()).description);

/** Усі числа, що трапились у тексті, як написані. */
const numbersIn = (s: string) => s.match(/\d[\d,]*/g) ?? [];

test('🔴 опис /routes несе число, яке відповів API, а не набране', async () => {
  // Два різні числа поспіль: зашита константа збіглась би з одним із них.
  await withApi({ '/spots/summary': { body: SUMMARY } }, async () => {
    expect(await descriptionOf()).toContain('52,501 campsites');
  });
  await withApi(
    { '/spots/summary': { body: { ...SUMMARY, spots: 70123 } } },
    async () => {
      expect(await descriptionOf()).toContain('70,123 campsites');
    },
  );
});

test('🔴 число одне, і це `spots`, а не `countries` чи `regions`', async () => {
  await withApi({ '/spots/summary': { body: SUMMARY } }, async () => {
    // Усі числа, що читач чи Google побачать в описі.
    expect(numbersIn(await descriptionOf())).toEqual(['52,501']);
  });
});

test('🔴 минулі числа не повертаються', async () => {
  // 61 422 — заміряне 27.09.2026 і набране руками; 63 031 — рядки в
  // `camping_spots` на 13.10, число, якого сторінка не мала б
  // друкувати за жодних обставин (це не сторінки, а рядки).
  await withApi({ '/spots/summary': { body: SUMMARY } }, async () => {
    const said = await descriptionOf();
    for (const stale of ['61 422', '61,422', '61422', '63 031', '63,031']) {
      expect(said, `в описі стоїть ${stale}`).not.toContain(stale);
    }
  });
});

test('🔴 немає даних — немає числа, а не нуль', async () => {
  // `getSummary` у відповідь на помилку віддає нулі. Для заголовка з
  // власним порожнім станом це правильно, для речення — ні: «from our
  // own database of 0» пішло б у видачу через один 429.
  const unsayable: [string, { status?: number; body: unknown }][] = [
    ['відповідь 500', { status: 500, body: { error: 'x' } }],
    ['відповідь 429', { status: 429, body: { error: 'x' } }],
    ['нуль із 200', { body: { ...SUMMARY, spots: 0 } }],
    ['тіло без поля', { body: {} }],
    ['число рядком', { body: { ...SUMMARY, spots: '52501' } }],
    ['від’ємне', { body: { ...SUMMARY, spots: -5 } }],
    ['дробове', { body: { ...SUMMARY, spots: 52501.5 } }],
  ];
  for (const [what, answer] of unsayable) {
    await withApi({ '/spots/summary': answer }, async () => {
      expect(await publishableCampsiteCount(), what).toBeNull();
      const said = await descriptionOf();
      expect(said, `${what}: в описі лишилась цифра`).not.toMatch(/\d/);
      // Опис лишається описом, а не обрубком: речення дочитується.
      expect(said, what).toMatch(/real campsites near every stop, from our own database\.$/);
    });
  }
});

test('🔴 /routes і llms.txt називають одне й те саме число', async () => {
  // Картка: «число в llms.txt і в тексті сторінок те саме». llms.txt
  // складає його з переліку країн, /routes бере готову суму — це два
  // шляхи до одного числа, і вони не мають права розійтись.
  await withApi(
    {
      '/spots/summary': { body: SUMMARY },
      '/spots/countries': {
        body: [
          { country: 'hr', spots: 30000, regions: 7 },
          { country: 'si', spots: 22501, regions: 5 },
        ],
      },
    },
    async () => {
      const llms = await (await llmsTxt()).text();
      const inLlms = /\*\*(\d+) campsites\*\*/.exec(llms)?.[1];
      const inRoutes = /([\d,]+) campsites in our own database/.exec(await descriptionOf())?.[1];

      expect(inLlms, 'llms.txt не називає числа').toBeDefined();
      expect(inRoutes, '/routes не називає числа').toBeDefined();
      expect(Number(inRoutes!.replace(/,/g, ''))).toBe(Number(inLlms));
      expect(Number(inLlms)).toBe(52501);
    },
  );
});
