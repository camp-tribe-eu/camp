import { expect, test } from '@playwright/test';

import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

import { generateMetadata } from '@/app/routes/page';
import { GET as llmsTxt } from '@/app/llms.txt/route';
import Home from '@/app/page';
import SearchPage from '@/app/search/page';
import {
  heroLead,
  printable,
  publishableCampsiteCount,
  searchDescription,
  searchLead,
} from '@/lib/campsite-count';

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

// 🔴 CAMP-308, ДРУГА ПОЛОВИНА. Картка була написана про /routes, бо там
// лежало набране `61 422`. Але та сама недовіра до числа потрібна ще
// трьом поверхням, і вони друкували `summary.spots` сирим:
//
//   page.tsx:90        «0 campsites and motorhome parks across 0 regions»
//   search/page.tsx:67 «0 campsites across 27 countries»
//   search/page.tsx:51 той самий нуль, усередині JSON-LD
//
// `getSummary` віддає нулі на БУДЬ-ЯКУ невдалу відповідь, і статична
// збірка запікає їх до наступного деплою. Нуль це не «немає даних»;
// надрукований як факт, він хибний.
//
// Властивість, яку тут перевіряємо, одна: **якщо числу не можна вірити,
// воно не зʼявляється в тексті взагалі** — ні цифрою, ні нулем.
test.describe('число, якому не можна вірити, не друкується', () => {
  test('printable пропускає лише додатне ціле', () => {
    expect(printable(52501), 'справжнє число').toBe(52501);
    expect(printable(1), 'один кемпінг — теж відповідь').toBe(1);
    expect(printable(0), '🔴 нуль від помилки API').toBeNull();
    expect(printable(-3), 'відʼємне').toBeNull();
    expect(printable(1.5), 'дробове').toBeNull();
    expect(printable(Number.NaN), 'NaN').toBeNull();
    expect(printable('52501'), 'рядок із JSON, не число').toBeNull();
    expect(printable(undefined), 'поля немає').toBeNull();
    expect(printable(null), 'поле є, але порожнє').toBeNull();
  });

  // Не «чи дорівнює очікуваному рядку», а «чи немає в ньому цифри» —
  // інакше тест переказує означення, а дефект був саме в тому, що в
  // тексті зʼявлялась цифра, якої ми не знаємо.
  const noDigits = (s: string, what: string) =>
    expect(s, `${what}: «${s}» містить цифру`).not.toMatch(/\d/);

  test('головна без чисел не каже «0»', () => {
    noDigits(heroLead(null, null), 'обидва невідомі');
    expect(heroLead(null, null)).toMatch(/^[A-Z]/);
    expect(heroLead(null, 800), 'регіони відомі').toContain('800 regions');
    expect(heroLead(null, 800)).not.toMatch(/\d+ campsites/);
    expect(heroLead(52501, null), 'кемпінги відомі').toContain('52,501 campsites');
    expect(heroLead(52501, null)).not.toMatch(/\d+ regions/);
    expect(heroLead(52501, 800)).toBe(
      '52,501 campsites and motorhome parks across 800 regions',
    );
  });

  test('/search без числа не каже «0 campsites»', () => {
    expect(searchLead(null, 27)).toBe('Campsites across 27 countries');
    expect(searchLead(null, 27)).not.toMatch(/\d+ campsites/);
    expect(searchLead(52501, 27)).toBe('52,501 campsites across 27 countries');
    noDigits(searchDescription(null), 'опис для пошуковика');
    expect(searchDescription(52501)).toContain('among 52,501');
  });

  // Рівно той шлях, яким дефект доходив до читача: відповідь API з
  // помилкою → нулі → текст. Жодна з трьох поверхонь не сміє назвати нуль.
  test('🔴 помилка API: жодна поверхня не друкує нуль', () => {
    const z = { spots: 0, countries: 0, regions: 0 };
    noDigits(heroLead(printable(z.spots), printable(z.regions)), 'головна');
    noDigits(searchDescription(printable(z.spots)), 'JSON-LD пошуку');
    expect(searchLead(printable(z.spots), 27)).not.toMatch(/\b0\b/);
  });
});

// 🔴 І ОКРЕМО — ЧИ СТОРІНКИ ЦИМИ ПОМІЧНИКАМИ КОРИСТУЮТЬСЯ.
//
// Випадки вище перевіряють `heroLead` і `searchLead`. Жоден із них не
// впаде, якщо сторінка перестане їх кликати й знову надрукує
// `summary.spots` сирим — саме так дефект і жив. Тож тут рендериться
// справжня сторінка на справжній невдалій відповіді API.
test.describe('поверхні справді кличуть помічники', () => {
  const failing = { '/spots/summary': { status: 500, body: {} } };

  test('🔴 головна на помилці API не друкує «0 campsites»', async () => {
    await withApi({ ...failing, '/spots/countries': { body: [] } }, async () => {
      const tree = await (Home as unknown as () => Promise<unknown>)();
      const text = visibleText(renderComponent(() => tree, {}));
      expect(text, `головна: «${text.slice(0, 140)}»`).not.toMatch(/\d+ campsites/);
      expect(text).toContain('Campsites and motorhome parks');
    });
  });

  test('🔴 /search на помилці API не друкує «0 campsites»', async () => {
    await withApi({ ...failing, '/spots/countries': { body: [] } }, async () => {
      const tree = await (SearchPage as unknown as () => Promise<unknown>)();
      const html = renderComponent(() => tree, {});
      const text = visibleText(html);
      expect(text, `/search: «${text.slice(0, 140)}»`).not.toMatch(/\d+ campsites/);
      expect(text).toContain('Campsites across');
      // JSON-LD не входить у видимий текст, тож дивимось на сирий HTML.
      expect(html, 'опис у JSON-LD').not.toMatch(/among \d/);
    });
  });
});
