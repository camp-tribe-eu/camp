import { expect, test } from '@playwright/test';
import { renderComponent } from './render-component';
import { CampsiteMedia } from '@/components/campsite-media';
import SiteMapEmbed from '@/components/site-map-embed';
import { CLIENT_ISLANDS } from './client-islands';
import {
  outlineBounds,
  OUTLINE_FILL_OPACITY,
  OUTLINE_LINE_WIDTH,
  type Outline,
} from '@/lib/outline';

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
  const html = renderComponent(CampsiteMedia, { ...base, outline: SQUARE }, { omit: CLIENT_ISLANDS });
  expect(html).toContain('data-outline="yes"');
  expect(html).toContain('as mapped in OpenStreetMap');
  // Атрибуція лишається незалежно від обрису — це умова ліцензії.
  expect(html).toContain('OpenFreeMap');
});

test('🔴 БЕЗ обрису сторінка його не обіцяє', () => {
  const html = renderComponent(CampsiteMedia, { ...base, outline: null }, { omit: CLIENT_ISLANDS });
  expect(html).toContain('data-outline="no"');
  // Саме цього речення там бути не може: обрису не існує в OSM.
  expect(html).not.toContain('as mapped in OpenStreetMap');
  expect(html).toContain('This is where it is');
  expect(html).toContain('OpenFreeMap');
});

test('проп не переданий читається як «обрису немає», а не як помилка', () => {
  const html = renderComponent(CampsiteMedia, { ...base }, { omit: CLIENT_ISLANDS });
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

/**
 * 🔴 ПРОП, А НЕ HTML. Рендер-тести вище пропускають острів мапи
 * (`CLIENT_ISLANDS`), тож структурно НЕ МОЖУТЬ побачити, чи дійшов до
 * нього контур. Рецензія це довела мутацією: прибрати `outline={outline}`
 * з `<SiteMapEmbed>` — і всі шість тестів лишались зеленими, підпис
 * і далі обіцяв обрис, а мапа його не отримувала.
 *
 * Тому дивимось у ДЕРЕВО елементів, а не в розмітку: шукаємо вузол
 * мапи й питаємо, що йому передали.
 */
function propsOfIsland(node: unknown, island: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = propsOfIsland(child, island);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  const n = node as { type?: unknown; props?: Record<string, unknown> };
  if (n.type === island) return n.props ?? {};
  return n.props ? propsOfIsland(n.props.children, island) : null;
}

test('🔴 контур ДОХОДИТЬ до компонента мапи, а не лише до підпису', () => {
  const tree = CampsiteMedia({ ...base, outline: SQUARE });
  const props = propsOfIsland(tree, SiteMapEmbed);
  expect(props).not.toBeNull();
  expect(props?.outline).toEqual(SQUARE);
});

test('а коли контуру немає — мапа отримує саме null', () => {
  const tree = CampsiteMedia({ ...base, outline: null });
  expect(propsOfIsland(tree, SiteMapEmbed)?.outline).toBeNull();
});

// 🔴 ЛАНЦЮГ МАЄ ТРИ ЛАНКИ, А СТЕРІГ Я ОДНУ. Рецензія довела мутацією:
// замінити в `site-map-embed.tsx` розгортання `{...props}` на чотири
// названі пропи без `outline` — і 1 829 тестів лишались зеленими, tsc
// теж, підпис і далі обіцяв обрис, а мапа його не бачила.
//
// Перевіряти «проп дійшов» на першій ланці й лишати другу голою означає
// стерегти двері, лишивши вікно.
test('🔴 і ДРУГА ланка: embed передає контур далі, а не губить його', () => {
  const node = SiteMapEmbed({ ...base, outline: SQUARE }) as {
    props?: Record<string, unknown>;
  };
  expect(node.props?.outline).toEqual(SQUARE);
  // І решта пропів теж не загубилась — інакше «передає» означало б
  // «передає лише те, про що є тест».
  expect(node.props?.lat).toBe(base.lat);
  expect(node.props?.lon).toBe(base.lon);
  expect(node.props?.type).toBe(base.type);
  expect(node.props?.label).toBe(base.label);
});

// 🔴 ВИДИМИЙ ОБРИС — ЦЕ ТЕЖ ВИМОГА, А НЕ ОЗДОБА.
//
// Рецензія PR #292 довела мутацією: `fill-opacity: 0.14 → 0` разом із
// `line-width: 2 → 0` лишає обрис цілком невидимим, а геть усе — зеленим.
// Шари існують, джерело додане, пропси доходять, підпис обіцяє контур —
// і під ним порожня мапа на 54% сторінок.
//
// Це та сама форма дефекту, що й решта цього файла: нічого не падає,
// просто сторінка каже неправду. Тут вона коштує один рядок.
test('🔴 фарба обрису лишається видимою — нуль тут робить мапу порожньою', () => {
  expect(OUTLINE_FILL_OPACITY).toBeGreaterThan(0);
  expect(OUTLINE_LINE_WIDTH).toBeGreaterThan(0);
});
