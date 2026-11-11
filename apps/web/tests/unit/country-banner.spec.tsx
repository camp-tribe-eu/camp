/**
 * CAMP-469: власне зображення банера країни.
 *
 * Усе читає ВІДДАНИЙ HTML сторінки `/camping/si` проти підміненого
 * `fetch`, а не константу чи клас: «сторінка показує зображення» означає,
 * що в розмітці є `<img>` з його шляхом.
 *
 * 🔴 МУТАЦІЇ, ЯКІ ЦЕЙ ФАЙЛ МУСИТЬ ЧЕРВОНИТИ (вивід у PR):
 *   • прибрати запасний шлях — `readCountryBanner` віддає об'єкт для
 *     відсутнього/зіпсованого запису → червоніє «без зображення»;
 *   • не передати `foreground` у `LayeredBanner` → червоніє «з зображенням»;
 *   • прибрати перевірку адреси → червоніє «чужий origin».
 */
import { expect, test } from '@playwright/test';

import CountryHub from '@/app/camping/[country]/page';
import { readCountryBanner } from '@/lib/country-banner';
import { renderAsyncComponent } from './render-component';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const REGIONS = [{ region: 'Bled', slug: 'bled', spots: 12, indexable: true }];

async function countryHtml(
  banner: (() => Response | Promise<Response>) | null,
): Promise<string> {
  const real = globalThis.fetch;
  globalThis.fetch = ((u: string) =>
    Promise.resolve().then(() => {
      const url = String(u);
      if (url.endsWith('/spots/si/regions')) return json(REGIONS);
      if (url.endsWith('/spots/map/regions')) return json([]);
      if (url.endsWith('/pages/camping-country/si')) {
        return banner ? banner() : json({ message: 'none' }, 404);
      }
      return json({}, 404);
    })) as typeof fetch;
  try {
    return await renderAsyncComponent(CountryHub, {
      params: Promise.resolve({ country: 'si' }),
    });
  } finally {
    globalThis.fetch = real;
  }
}

/** Усі `<img>` шару переднього плану банера. */
const foregroundImgs = (html: string): string[] =>
  html.match(/<img\b[^>]*class="ct-banner__media-img"[^>]*>/g) ?? [];

const BACKGROUND = 'src="/banners/eu-dawn.svg"';

test('🔴 країна БЕЗ зображення: банер такий, як був — фон є, переднього фото й обгортки немає', async () => {
  const html = await countryHtml(null);
  expect(html).toContain(BACKGROUND);
  expect(foregroundImgs(html)).toEqual([]);
  expect(html).not.toContain('ct-banner__media"');
  // Жодної обіцянки фото на сторінці.
  expect(html.toLowerCase()).not.toContain('photo coming');
});

test('🔴 країна З зображенням: у відданому HTML його шлях і його опис', async () => {
  const html = await countryHtml(() =>
    json({ src: '/banners/si-test.jpg', alt: 'Lake Bled at dawn' }),
  );
  const imgs = foregroundImgs(html);
  expect(imgs).toHaveLength(1);
  expect(imgs[0]).toContain('src="/banners/si-test.jpg"');
  expect(imgs[0]).toContain('alt="Lake Bled at dawn"');
  // Пара: фон нікуди не подівся, зображення ДОДАЛОСЬ, а не підмінило.
  expect(html).toContain(BACKGROUND);
});

test('🔴 збій API банера кладе зображення, а не сторінку', async () => {
  const html = await countryHtml(() => {
    throw new Error('connection reset');
  });
  expect(html).toContain('Campsites in Slovenia');
  expect(foregroundImgs(html)).toEqual([]);
});

test('🔴 один зіпсований запис — один банер без фото; сторінка ціла', async () => {
  for (const bad of [
    { src: 'https://evil.example/x.jpg', alt: 'x' },
    { src: '//evil.example/x.jpg', alt: 'x' },
    { src: 'javascript:alert(1)', alt: 'x' },
    { src: 42, alt: 'x' },
    { src: '', alt: 'x' },
    { alt: 'x' },
    'not an object',
    null,
  ]) {
    const html = await countryHtml(() => json(bad));
    expect(foregroundImgs(html), JSON.stringify(bad)).toEqual([]);
    expect(html, JSON.stringify(bad)).toContain('Campsites in Slovenia');
  }
});

test('зображення без опису — декоративне, а не з вигаданим описом', () => {
  expect(readCountryBanner({ src: '/banners/a.jpg' })).toEqual({
    src: '/banners/a.jpg',
    alt: '',
  });
  expect(readCountryBanner({ src: ' /banners/a.jpg ', alt: ' ok ' })).toEqual({
    src: '/banners/a.jpg',
    alt: 'ok',
  });
});
