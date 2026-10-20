import { expect, test } from '@playwright/test';
import { renderComponent } from './render-component';
import { CampsiteMedia } from '@/components/campsite-media';
import SiteMapEmbed from '@/components/site-map-embed';
import { outlineBounds, type Outline } from '@/lib/outline';

// CAMP-352, крок 4 — обрис ділянки на сторінці кемпінгу.
//
// 🔴 ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ. Макет підписує мапу «the real site outline
// from OpenStreetMap». Заміряно 19.10.2026 по 63 159 кемпінгах: обрис є
// у 55,1%, у 31,1% це крапка в OSM, у 13,9% немає навіть `osm_ref`.
//
// Тобто підпис мусить бути УМОВНИМ, і помилка тут особлива: вона не
// падає й не ламає верстку. Сторінка просто обіцяє читачеві «ось межі
// ділянки» там, де першоджерело знає лише точку, — рівно на тій
// сторінці, яка пояснює, чому ми не показуємо чужих фото.
//
// Рендер, а не властивість компонента: перевіряємо те, що прочитає
// людина, бо зламати можна саме текст, лишивши пропси недоторканими.

const SQUARE: Outline = {
  type: 'MultiPolygon',
  coordinates: [[[[14, 46], [14.002, 46], [14.002, 46.002], [14, 46.002], [14, 46]]]],
};

const base = {
  photos: [] as const,
  lat: 46.001,
  lon: 14.001,
  type: 'paid',
  label: 'Camp Test',
};

test('🔴 з обрисом підпис називає його, і це видно читачеві', () => {
  const html = renderComponent(CampsiteMedia, { ...base, outline: SQUARE }, { omit: [SiteMapEmbed] });
  expect(html).toContain('data-outline="yes"');
  expect(html).toContain('as mapped in OpenStreetMap');
  // Атрибуція лишається незалежно від обрису — це умова ліцензії.
  expect(html).toContain('OpenFreeMap');
});

test('🔴 БЕЗ обрису сторінка його не обіцяє', () => {
  const html = renderComponent(CampsiteMedia, { ...base, outline: null }, { omit: [SiteMapEmbed] });
  expect(html).toContain('data-outline="no"');
  // Саме цього речення там бути не може: обрису не існує в OSM.
  expect(html).not.toContain('as mapped in OpenStreetMap');
  expect(html).toContain('This is where it is');
  expect(html).toContain('OpenFreeMap');
});

test('проп не переданий читається як «обрису немає», а не як помилка', () => {
  const html = renderComponent(CampsiteMedia, { ...base }, { omit: [SiteMapEmbed] });
  expect(html).toContain('data-outline="no"');
  expect(html).not.toContain('as mapped in OpenStreetMap');
});

// 🔴 Межі обходяться РЕКУРСИВНО. Polygon це масив кілець, MultiPolygon —
// масив полігонів, і код, писаний під одну з двох форм, мовчки не
// намалював би другу: винятку не буде, кадр просто лишиться на точці.
test('межі рахуються і для Polygon, і для MultiPolygon', () => {
  const multi = outlineBounds(SQUARE);
  expect(multi).toEqual([
    [14, 46],
    [14.002, 46.002],
  ]);

  const single = outlineBounds({
    type: 'Polygon',
    coordinates: [[[14, 46], [14.002, 46], [14.002, 46.002], [14, 46.002], [14, 46]]],
  });
  expect(single).toEqual(multi);
});

test('межі охоплюють ВСІ частини мультиполігона, не лише першу', () => {
  // Дві окремі ділянки одного кемпінгу. Код, що читає лише перший
  // полігон, дав би кадр удвічі менший — і друга половина лишилась би
  // за краєм, без жодної помилки.
  const twoParts: Outline = {
    type: 'MultiPolygon',
    coordinates: [
      [[[14, 46], [14.001, 46], [14.001, 46.001], [14, 46.001], [14, 46]]],
      [[[14.01, 46.01], [14.011, 46.01], [14.011, 46.011], [14.01, 46.011], [14.01, 46.01]]],
    ],
  };
  expect(outlineBounds(twoParts)).toEqual([
    [14, 46],
    [14.011, 46.011],
  ]);
});

test('порожні координати не дають кадру з Infinity', () => {
  // `fitBounds` на Infinity кидає, і мапа зникла б цілком. Краще
  // лишитись на точці, ніж втратити мапу.
  expect(outlineBounds({ type: 'MultiPolygon', coordinates: [] })).toBeNull();
});
