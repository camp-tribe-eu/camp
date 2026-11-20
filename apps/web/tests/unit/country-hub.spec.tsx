/**
 * CAMP-451: /camping/{country} — банер, тікер регіонів, картки регіонів,
 * пагінація й FAQ за стилями теми.
 *
 * Усе нижче читає ВІДДАНИЙ HTML (`renderAsyncComponent` /
 * `renderNestedAsync` проти підміненого `fetch`), а не константи
 * компонентів: число в картці звіряється з рядком API, що його породив;
 * правило CSS пагінації — з `<style>`, який React підняв у розмітку.
 *
 * 🔴 МУТАЦІЇ, ЯКІ ЦЕЙ ФАЙЛ МУСИТЬ ЧЕРВОНИТИ (прогнано 09.11.2026, вивід у
 * PR): у `region-tiles.tsx` надрукувати `spots + 1` → падає «число в
 * картці = число з API»; у `pagination.tsx` прибрати правило
 * `.ct-pagination__link{…}` → падає «пагінація за стилями теми».
 */
import { expect, test } from '@playwright/test';

import CountryHub from '@/app/camping/[country]/page';
import RegionPageN from '@/app/camping/[country]/[region]/page/[n]/page';
import { Pagination, paginationParts } from '@/components/pagination';
import { readRegionCards, regionCountLabel, RegionTiles } from '@/components/region-tiles';
import { HubStatTiles } from '@/components/hub-stats';
import { coatFor } from '@/components/region-emblem';
import CountryMap, { circleRadius } from '@/components/country-map';
import { pickTickerRegions } from '@/components/region-ticker';
import { renderAsyncComponent, renderComponent, renderNestedAsync, rendersNothing } from './render-component';
import { visibleText } from './rendered-text';
import { PANEL_NOTE } from '@/components/listing-panel';

type Fetcher = (url: string) => Response | Promise<Response>;

async function withFetch(impl: Fetcher, run: () => Promise<void>) {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string) =>
    Promise.resolve().then(() => impl(String(url)))) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const en = (n: number): string => n.toLocaleString('en-GB');

// ── Фікстура: сім регіонів однієї країни, як їх віддає /spots/si/regions ──

const REGIONS = [
  { region: 'Bovec', slug: 'bovec', spots: 100, indexable: true },
  { region: 'Kranj', slug: 'kranj', spots: 40, indexable: true },
  { region: 'Ptuj', slug: 'ptuj', spots: 4, indexable: true },
  { region: 'Koper', slug: 'koper', spots: 1, indexable: false },
  { region: 'Maribor', slug: 'maribor', spots: 12, indexable: true },
  { region: 'Bled', slug: 'bled', spots: 1250, indexable: true },
  { region: 'Celje', slug: 'celje', spots: 7, indexable: true },
];

const STATS = REGIONS.map((r) => ({
  region: r.region,
  slug: r.slug,
  spots: r.spots,
  readAt: '2026-10-18',
  freeWild: 0,
  electricity: { yes: 0, no: 0 },
  overnight: { allowed: 0, forbidden: 0 },
  price: { known: 0, minEur: null },
}));

const PER_PAGE = 24;

const card = (i: number) => ({
  slug: `camp-${i}`,
  name: `Camp ${i}`,
  country: 'si',
  region: 'Bled',
  type: 'paid',
  amenities: {},
});

/** Сторінка `page` регіону Bled: 1 250 карток по 24 — остання має дві. */
function bledPage(page: number) {
  const total = 1250;
  const from = (page - 1) * PER_PAGE;
  const n = Math.max(0, Math.min(PER_PAGE, total - from));
  return {
    region: 'Bled',
    total,
    items: Array.from({ length: n }, (_, i) => card(from + i + 1)),
  };
}

/**
 * Індекс мапи так, як його віддає `/spots/map/regions`: ті самі сім
 * регіонів Словенії — і ОДИН ЧУЖИЙ рядок, Австрія. Він тут не для краси:
 * сторінка, яка забуде звузити індекс до своєї країни, інакше виглядала
 * б у HTML так само, як правильна.
 */
const MAP_INDEX = [
  ...REGIONS.map((r, i) => ({
    country: 'SI',
    region: r.region,
    slug: r.slug,
    count: r.spots,
    minLon: 13.5 + i * 0.1,
    minLat: 45.5 + i * 0.1,
    maxLon: 13.9 + i * 0.1,
    maxLat: 45.9 + i * 0.1,
    lon: 13.7 + i * 0.1,
    lat: 45.7 + i * 0.1,
  })),
  {
    country: 'AT',
    region: 'Burgenland',
    slug: 'burgenland',
    count: 9_999,
    minLon: 16.2,
    minLat: 47.1,
    maxLon: 17.1,
    maxLat: 48.1,
    lon: 16.6,
    lat: 47.6,
  },
];

/** Скільки кемпінгів мапа має назвати: сума ЛИШЕ словенських рядків. */
const MAP_SPOTS = REGIONS.reduce((n, r) => n + r.spots, 0);

/** Marker rows as `/spots/map/region/si/{slug}` hands them over (more fields than we read). */
type Points = Record<string, unknown>;

function api(regions: unknown = REGIONS, points: Points = {}): Fetcher {
  return (url) => {
    const m2 = /\/spots\/map\/region\/si\/([^/?]+)$/.exec(url);
    if (m2) return m2[1] in points ? json(points[m2[1]]) : json({}, 404);
    if (url.endsWith('/spots/si/regions')) return json(regions);
    if (url.endsWith('/spots/map/regions')) return json(MAP_INDEX);
    if (url.endsWith('/spots/hub-stats/si')) return json(STATS);
    const m = /\/spots\/si\/bled\?page=(\d+)/.exec(url);
    if (m) return json(bledPage(Number(m[1])));
    return json({}, 404);
  };
}

async function countryHtml(regions: unknown = REGIONS, points: Points = {}): Promise<string> {
  let html = '';
  await withFetch(api(regions, points), async () => {
    html = await renderAsyncComponent(CountryHub, {
      params: Promise.resolve({ country: 'si' }),
    });
  });
  return html;
}

/** Початок тегу `<a class="ct-rtile" … href="/camping/si/{slug}">`, або −1. */
function cardLinkAt(html: string, slug: string): number {
  const re = /<a\b[^>]*class="ct-rtile"[^>]*>/g;
  for (const m of html.matchAll(re)) {
    if (m[0].includes(`href="/camping/si/${slug}"`)) return m.index;
  }
  return -1;
}

/** Розмітка однієї картки регіону: `<li>`, у якому стоїть посилання на неї. */
function cardHtml(html: string, slug: string): string {
  const at = cardLinkAt(html, slug);
  expect(at, `картки з посиланням на /camping/si/${slug} немає`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<li', at);
  const end = html.indexOf('</li>', at);
  return html.slice(start, end);
}

const cardCount = (html: string): number =>
  html.match(/class="ct-rtiles__col"/g)?.length ?? 0;

// ── Картки регіонів ────────────────────────────────────────────────────────

test('🔴 число в картці дорівнює числу, яке віддає API — для кожного рядка фікстури', async () => {
  const html = await countryHtml();
  test.info().annotations.push({
    type: 'denominator',
    description: `${REGIONS.length} rows from /spots/si/regions, ${cardCount(html)} cards rendered`,
  });
  expect(cardCount(html)).toBe(REGIONS.length);
  const wrong: string[] = [];
  for (const row of REGIONS) {
    const text = visibleText(cardHtml(html, row.slug));
    const expected = `${en(row.spots)} ${row.spots === 1 ? 'campsite' : 'campsites'}`;
    if (!text.includes(expected)) wrong.push(`${row.slug}: «${text}» не містить «${expected}»`);
    if (!text.includes(row.region)) wrong.push(`${row.slug}: без назви регіону`);
  }
  expect(wrong, `картки, чиє число не збігається з API:\n  ${wrong.join('\n  ')}`).toEqual([]);
});

test('🔴 картка регіону без даних не ламає сторінку: рядок без числа стоїть і каже про це, рядок без slug випадає сам', async () => {
  const broken = [
    ...REGIONS,
    { region: 'Nova Gorica', slug: 'nova-gorica' }, // числа немає
    { region: 'Ghost', spots: 9 }, // немає куди вести
    { slug: 'no-name', spots: 9 },
    null,
    'not a row',
    { region: 'Odd', slug: 'odd', spots: 'many' },
    { region: 'Up', slug: '../up', spots: 3 },
  ];
  const html = await countryHtml(broken);
  // 7 повних + Nova Gorica + Odd (число не ціле → «не записано»); решта випала.
  expect(cardCount(html)).toBe(REGIONS.length + 2);
  const text = visibleText(html);
  expect(text).toContain('Campsites in Slovenia');
  expect(visibleText(cardHtml(html, 'nova-gorica'))).toContain('Campsite count not recorded');
  expect(visibleText(cardHtml(html, 'odd'))).toContain('Campsite count not recorded');
  expect(html).not.toContain('Ghost');
  expect(html).not.toContain('no-name');
  expect(html).not.toContain('../up');
  expect(text).not.toMatch(/\bNaN\b|undefined/);
  // Сума в банері — лише з чисел, що дійшли.
  const total = REGIONS.reduce((n, r) => n + r.spots, 0);
  expect(text).toContain(`${en(total)} campsites, motorhome parks and camper stops across 9 regions`);
});

test('картки — всі регіони, і кожна веде на сторінку регіону', async () => {
  const html = await countryHtml();
  for (const r of REGIONS) {
    expect(cardLinkAt(html, r.slug), `картки /camping/si/${r.slug} немає`).toBeGreaterThan(-1);
  }
  // CAMP-441: прапор країни НЕ зображення картки регіону. Він може стояти
  // лише як знак біля назви (`ct-emblem`), ніколи в рамці зображення.
  for (const wrapper of html.match(/<span class="ct-rtile__image-wrapper">[\s\S]*?<\/span>/g) ?? []) {
    expect(wrapper).not.toContain('/flags/');
  }
});

test('RegionTiles без жодного регіону не малює нічого; readRegionCards обрізає пробіли', () => {
  expect(rendersNothing(RegionTiles, { country: 'si', regions: [] })).toBe(true);
  expect(readRegionCards([{ region: ' Bled ', slug: ' bled ', spots: 2 }])).toEqual([
    { region: 'Bled', slug: 'bled', spots: 2, iso: null },
  ]);
  expect(regionCountLabel(1)).toBe('1 campsite');
  expect(regionCountLabel(1250)).toBe('1,250 campsites');
  expect(regionCountLabel(null)).toBe('Campsite count not recorded');
});

// ── Склад сторінки ─────────────────────────────────────────────────────────

test('🔴 склад: h1 у банері → тікер → лічильники → дві картки-переходи → картки регіонів → два банери → банер про нас', async () => {
  const html = await countryHtml();
  const order = [
    '<h1 class="ct-banner__heading">Campsites in Slovenia</h1>',
    'role="marquee"',
    'aria-label="Key figures"',
    'data-testid="country-next"',
    'class="ct-rtiles__row"',
    '<section class="ct-grid-banner',
    '<section class="ct-box-banner',
  ].map((marker) => html.indexOf(marker));
  for (const [i, at] of order.entries()) expect(at, `секція №${i + 1} відсутня`).toBeGreaterThan(-1);
  for (let i = 1; i < order.length; i++) {
    expect(order[i], `секція №${i + 1} стоїть не після №${i}`).toBeGreaterThan(order[i - 1]);
  }
  expect(html.match(/<h1\b/g)?.length, 'h1 має бути рівно один').toBe(1);
});

// CAMP-441 (53): замість двох кнопок — дві картки «іконка зліва, тайтл,
// опис» (FeatureRow), що ведуть на мапу й планувальник.
test('дві картки: мапа й планувальник — іконка, тайтл, опис, посилання', async () => {
  const html = await countryHtml();
  const nav = /<ul\b[^>]*data-testid="country-next"[\s\S]*?<\/ul>/.exec(html)?.[0] ?? '';
  expect(nav, 'карток немає').not.toBe('');
  const cards = [...nav.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: /href="([^"]*)"/.exec(m[1])?.[1],
    html: m[2],
    text: visibleText(m[2]),
  }));
  expect(cards.map((c) => c.href)).toEqual(['/map', '/plan']);
  for (const c of cards) {
    expect(c.html, `${c.href}: немає іконки`).toContain('ct-feat__icon');
    expect(c.html, `${c.href}: немає опису`).toContain('ct-feat__text');
  }
  expect(cards[0].text).toContain('Open the campsite map');
  expect(cards[1].text).toContain('in straight lines for now');
  expect(html).not.toMatch(/data-ct-button="[^"]*"[^>]*href="\/plan"|href="\/plan"[^>]*data-ct-button/);
  expect(html).toContain('href="#regions"');
  expect(html).toContain('id="regions"');
});

test('тікер: до шести найбільших регіонів за числом, з назвою й числом; без даних — його немає', async () => {
  const picked = pickTickerRegions(readRegionCards(REGIONS));
  expect(picked.map((r) => r.slug)).toEqual(['bled', 'bovec', 'kranj', 'maribor', 'celje', 'ptuj']);
  expect(pickTickerRegions(readRegionCards([...REGIONS].reverse()))).toEqual(picked);
  const html = await countryHtml();
  const marquee = /<section class="ct-ticker[^"]*" role="marquee"[\s\S]*?<\/section>/.exec(html);
  expect(marquee).not.toBeNull();
  const text = visibleText(marquee![0]);
  // Назва й число — окремі `<span>` із `gap` у CSS, тож у зчитаному тексті
  // між ними пробілу немає; перевіряються поодинці, як у тікері країн.
  for (const r of picked) {
    expect(text).toContain(r.region);
    expect(text).toContain(`${en(r.spots as number)} campsites`);
    expect(marquee![0]).toContain(`href="/camping/si/${r.slug}"`);
  }
  expect(text).not.toContain('Koper');
  expect(
    pickTickerRegions([
      { region: 'A', slug: 'a', spots: 0 },
      { region: 'B', slug: 'b', spots: null },
    ]),
  ).toEqual([]);
});

// ── Пагінація за стилями теми ──────────────────────────────────────────────

test('paginationParts: перша, остання, поточна з сусідами, крапки лише над прогалиною ≥ 2', () => {
  const nums = (page: number, pages: number) =>
    paginationParts(page, pages).map((p) => (p.kind === 'gap' ? '…' : p.n));
  expect(nums(1, 26)).toEqual([1, 2, '…', 26]);
  expect(nums(10, 26)).toEqual([1, '…', 9, 10, 11, '…', 26]);
  expect(nums(26, 26)).toEqual([1, '…', 25, 26]);
  expect(nums(3, 5)).toEqual([1, 2, 3, 4, 5]);
  expect(nums(1, 1)).toEqual([]);
  expect(nums(99, 4)).toEqual([1, 2, 3, 4]);
});

test('🔴 пагінація за стилями теми: правило посилання стоїть у ВІДДАНОМУ HTML, і кожне посилання його носить', () => {
  const html = renderComponent(Pagination, {
    page: 10,
    pages: 26,
    href: (n: number) => (n === 1 ? '/camping/fr/x' : `/camping/fr/x/page/${n}`),
  });
  const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  expect(style, 'стилю пагінації немає у відданому HTML').toContain('.ct-pagination__link{');
  const rule = /\.ct-pagination__link\{([^}]*)\}/.exec(style)?.[1] ?? '';
  // Числа теми: 36×36, радіус 12, рамка 1px, вага 600 (main.build.css Fuse).
  for (const decl of ['width:36px', 'height:36px', 'border-radius:12px', 'border:1px solid', 'font-weight:600']) {
    expect(rule, `у правилі .ct-pagination__link немає «${decl}»`).toContain(decl);
  }
  expect(style).toContain('.ct-pagination__item-wrapper{');
  expect(style).toMatch(/@media\(min-width:576px\)\{[\s\S]*?\.ct-pagination__link\{width:48px;height:48px/);

  const links = [...html.matchAll(/<a\b([^>]*)>/g)].map((m) => m[1]);
  expect(links.length).toBe(7); // prev, 1, 9, 10, 11, 26, next
  for (const a of links) expect(a).toMatch(/class="ct-pagination__link[^"]*touch-target"/);
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('href="/camping/fr/x/page/9"');
  expect(html).toContain('href="/camping/fr/x/page/11"');
  expect(html).toContain('href="/camping/fr/x"');
  // Дві крапки в розмітці (клас у `<style>` не рахується).
  expect(html.match(/class="ct-pagination__link ct-pagination__link--ellipsis"/g)?.length).toBe(2);
  // Одна сторінка — пагінатора немає.
  expect(rendersNothing(Pagination, { page: 1, pages: 1, href: () => '/' })).toBe(true);
});

test('🔴 остання сторінка регіону віддає непорожній список, а пагінатор стоїть на ній без «далі»', async () => {
  const last = Math.ceil(1250 / PER_PAGE); // 53
  let html = '';
  await withFetch(api(), async () => {
    html = await renderNestedAsync(RegionPageN, {
      params: Promise.resolve({ country: 'si', region: 'bled', n: String(last) }),
    });
  });
  const cards = html.match(/href="\/camping\/si\/bled\/camp-\d+"/g) ?? [];
  expect(cards.length, 'на останній сторінці має бути 1 250 − 52·24 = 2 картки').toBe(2);
  expect(html).toContain('href="/camping/si/bled/camp-1250"');
  const nav = /<nav aria-label="Pagination"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  expect(nav).not.toBe('');
  expect(nav).toContain(
    `<a aria-current="page" class="ct-pagination__link is-active touch-target" href="/camping/si/bled/page/${last}">${last}</a>`,
  );
  expect(nav).toContain(`href="/camping/si/bled/page/${last - 1}"`);
  expect(nav).not.toContain(`href="/camping/si/bled/page/${last + 1}"`);
  expect(nav).toContain('aria-label="Previous page"');
  expect(nav).not.toContain('aria-label="Next page"');
  expect(visibleText(html)).toContain(`page ${last} of ${last}`);
});

test('перша сторінка пагінатора: «2» — посилання з доступним іменем «2», без «далі»-застою', () => {
  const html = renderComponent(Pagination, {
    page: 1,
    pages: 26,
    href: (n: number) => (n === 1 ? '/r' : `/r/page/${n}`),
  });
  expect(html).toContain('<a class="ct-pagination__link touch-target" href="/r/page/2">2</a>');
  expect(html).not.toContain('aria-label="Page 2"');
  expect(html).toContain('aria-label="Next page"');
  expect(html).not.toContain('aria-label="Previous page"');
});


test('🔴 лічильники: між `dl` і `dt`/`dd` рівно ОДИН `div` — два роблять список не списком', () => {
  // Перша редакція CAMP-451 мала два (`div.ct-stat > div.ct-stat__panel`),
  // щоб повторити дві коробки теми. Lighthouse на /camping/hr/zadarska
  // почервонів: accessibility 0.89 при стелі 0.9 — `definition-list`
  // («direct children that are not allowed: div > div») і `dlitem`
  // («does not have a <dl> parent element»), по 7 ваги кожен. Для читача
  // екрана підписи й значення переставали належати списку означень.
  //
  // Міряно, а не припущено: `npx lighthouse … --only-categories=accessibility`
  // на тій самій сторінці дав ті самі 0.89 і ті самі два аудити.
  const html = renderComponent(HubStatTiles, {
    tiles: [
      { key: 'campsites', label: 'Campsites', value: '7', note: 'of 7 listed' },
      { key: 'price', label: 'From', value: '€12' },
    ],
    asOf: null,
  });
  const dl = html.slice(html.indexOf('<dl'), html.indexOf('</dl>'));
  const aboveFirstTerm = dl.slice(0, dl.indexOf('<dt'));
  const levels = (aboveFirstTerm.match(/<div\b/g) ?? []).length;
  expect(levels, `між <dl> і <dt> рівнів <div>: ${levels}`).toBe(1);
  // І значення лежить у тому самому рівні, що й підпис, а не глибше.
  expect(dl, 'dd має йти одразу за dt').toContain('</dt><dd');

  // Дві коробки теми лишились — тепер однією рамкою: смуга 4px
  // `--color-surface-2` поверх панелі `--color-surface`. Внутрішній радіус
  // CSS рахує сам: 16−4 = 12 = calc(r * .75), рівно число теми.
  expect(html).toContain('border:4px solid var(--color-surface-2)');
});

/**
 * CAMP-474 — мапа країни. Рішення власника 09.11.2026: «нам точно треба
 * мати і мапу і банер … банер може бути на горі а мапа трохи нижче».
 *
 * 🔴 ЧОМУ ЦЕ ЧИТАЄ HTML, А НЕ КОМПОНЕНТ. Мапу малює MapLibre, якого в
 * юніті немає й не буде. Те, що тут МОЖНА довести без браузера, —
 * найдорожче: чи дала сторінка мапі ТІ САМІ рядки, що й переліку. Решту
 * (чи зʼявились кружечки) міряє e2e на справжній збірці.
 *
 * 🔴 МУТАЦІЇ, ЯКІ ЦЕЙ РОЗДІЛ МУСИТЬ ЧЕРВОНИТИ (прогнано 09.11.2026):
 *  · у `page.tsx` прибрати звуження `r.country === params.country` →
 *    падає «мапа рахує лише свою країну» (австрійський рядок пролазить);
 *  · у `country-map.tsx` рахувати `spots` з `regions.length` замість
 *    суми `count` → падає те саме твердження;
 *  · у `country-map.tsx` зробити радіус лінійним → падає «площа, а не
 *    радіус, пропорційна кількості».
 */
test.describe('CAMP-474: мапа країни', () => {
  test('🔴 мапа дістає рядки СВОЄЇ країни, і підпис рахує їх, а не весь індекс', async () => {
    const html = await countryHtml();
    const at = html.indexOf('data-testid="country-map"');
    expect(at, 'мапи країни немає в розмітці').toBeGreaterThan(-1);

    const tag = html.slice(html.lastIndexOf('<div', at), html.indexOf('>', at) + 1);
    // Сім словенських рядків, і жодного австрійського.
    expect(tag, `атрибути мапи: ${tag}`).toContain(`data-regions="${REGIONS.length}"`);
    expect(tag, 'мапа взяла суму всього індексу, а не своєї країни').toContain(
      `data-spots="${MAP_SPOTS}"`,
    );

    const text = visibleText(html);
    expect(text).toContain(`${REGIONS.length} regions of Slovenia on the map`);
    expect(text).toContain(`${MAP_SPOTS} campsites between them`);
    // Якір: 9 999 — це австрійський рядок. Якщо він опинився в сумі,
    // число в підписі змінилось би, і верхнє твердження вже впало б;
    // цей рядок доводить, що фікстура справді несе чужу країну.
    expect(MAP_INDEX.some((r) => r.country === 'AT' && r.count === 9_999)).toBe(true);
  });

  test('мапа стоїть НИЖЧЕ банера і ВИЩЕ плиток регіонів', async () => {
    const html = await countryHtml();
    const banner = html.indexOf('data-testid="layered-banner"');
    const map = html.indexOf('data-testid="country-map"');
    const tiles = cardLinkAt(html, 'bled');
    expect(map, 'мапи немає').toBeGreaterThan(-1);
    expect(tiles, 'плиток регіонів немає').toBeGreaterThan(-1);
    if (banner > -1) expect(map, 'мапа опинилась вище банера').toBeGreaterThan(banner);
    expect(map, 'мапа опинилась нижче плиток').toBeLessThan(tiles);
  });

  test('кредит OpenFreeMap стоїть під мапою — умова ліцензії, не прикраса', async () => {
    const text = visibleText(await countryHtml());
    expect(text).toContain('OpenFreeMap © OpenMapTiles');
  });

  test('🔴 площа кружечка пропорційна кількості, а не його радіус', () => {
    // Регіон учетверо більший має бути вдвічі ширшим, а не вчетверо.
    // Інакше 1 250 кемпінгів Бледа закривають усю Словенію.
    const max = 1_000;
    const big = circleRadius(max, max);
    const quarter = circleRadius(max / 4, max);
    const zero = circleRadius(0, max);
    // Радіус лінійно росте з коренем: (r − r₀) має подвоїтись від ¼ до 1.
    const span = big - zero;
    const quarterSpan = quarter - zero;
    expect(
      Math.abs(span / quarterSpan - 2),
      `від ¼ до повного розміру приріст радіуса виріс у ${(span / quarterSpan).toFixed(2)} раза, ` +
        'очікувалось рівно вдвічі — тобто радіус рахують лінійно',
    ).toBeLessThan(0.05);
  });

  test('без рядків мапа не малює нічого — і не порожню рамку', async () => {
    // 🔴 ЧОМУ ЦЕ НЕ ТЕСТ СТОРІНКИ, А ТЕСТ КОМПОНЕНТА. Перша редакція
    // перевіряла саме сторінку: індекс віддає 500, сторінка ловить,
    // мапи немає. Вона ВПАЛА, і через справжню властивість коду:
    // `mapRegions()` тримає вдалу обіцянку в змінній модуля на весь
    // процес (CAMP-127, щоб чанки не летіли в мережу десятками), тож
    // після першого вдалого рендера в цьому ж файлі збій індексу вже
    // недосяжний. Писати тест, який залежить від порядку файлів, — це
    // сторож, що одного дня позеленіє сам.
    //
    // Тому: сторінка віддає мапі порожній перелік (саме це робить її
    // `catch`), а компонент на порожньому переліку не малює НІЧОГО —
    // ні рамки, ні підпису, бо порожня мапа гірша за її відсутність.
    const html = renderComponent(CountryMap, {
      country: 'si',
      countryName: 'Slovenia',
      regions: [],
    });
    expect(visibleText(html).trim()).toBe('');
    expect(html).not.toContain('data-testid="country-map"');
  });

});


// ── CAMP-441: картинки карток регіонів і нижня панель ──────────────────────

const marker = (lat: number, lon: number) => ({ slug: `m-${lat}-${lon}`, name: null, type: 'paid', lat, lon, amenities: null, path: null });

/** Крапки Бледа й Боветса лежать у різних місцях — малюнки МУСЯТЬ відрізнятись. */
const POINTS: Points = {
  bled: [marker(46.36, 14.09), marker(46.38, 14.11), marker(46.41, 14.05), marker(46.3, 14.2)],
  bovec: [marker(46.33, 13.55), marker(46.36, 13.6), marker(46.31, 13.5)],
};

const dotsOf = (html: string, slug: string): string | null =>
  /<path class="ct-art__dots" d="([^"]*)"/.exec(cardHtml(html, slug))?.[1] ?? null;

test('🔴 картка регіону має СВОЮ мінікарту з його координат; регіон без координат — картку без картинки, не прапор і не порожню рамку', async () => {
  const html = await countryHtml(REGIONS, POINTS);
  const bled = dotsOf(html, 'bled');
  const bovec = dotsOf(html, 'bovec');
  expect(bled, 'у Бледа немає мінікарти').toMatch(/^M\d+ \d+h0(m-?\d+ -?\d+h0)*$/);
  expect(bovec, 'у Боветса немає мінікарти').not.toBeNull();
  // Одна й та сама картинка на двох картках — це і був дефект (один прапор).
  expect(bled).not.toBe(bovec);
  // Бліда мінікарта має стільки крапок, скільки зайнято клітинок: чотири точки, чотири далекі клітинки.
  expect(bled!.match(/h0/g)).toHaveLength(4);
  // Решта п'ять регіонів: координат немає (404) — жодної картинки, жодного прапора.
  for (const slug of ['kranj', 'ptuj', 'koper', 'maribor', 'celje']) {
    const card = cardHtml(html, slug);
    expect(card, slug).not.toContain('ct-art');
    expect(card, slug).not.toContain('ct-rtile__image-wrapper');
    expect(card, slug).toContain('See campsites');
  }
  expect(cardCount(html)).toBe(REGIONS.length);
  // CAMP-441: прапор тепер стоїть біля назви як знак-запас, але ніколи не в рамці картинки.
  expect(cardHtml(html, 'kranj')).toContain('data-emblem="flag"');
  for (const wrapper of html.match(/<span class="ct-rtile__image-wrapper">[\s\S]*?<\/span>/g) ?? []) {
    expect(wrapper).not.toContain('ct-flag');
  }
});

test('🔴 зіпсовані координати коштують одного регіону: нечислові точки пропущено, решта малюється, сторінка стоїть', async () => {
  const html = await countryHtml(REGIONS, {
    bled: [marker(46.36, 14.09), { lat: 'x', lon: null }, null, 'junk', marker(999, 14), marker(46.4, 14.1)],
    bovec: 'not an array',
    kranj: [],
  });
  expect(dotsOf(html, 'bled')!.match(/h0/g)).toHaveLength(2);
  expect(cardHtml(html, 'bovec')).not.toContain('ct-art');
  expect(cardHtml(html, 'kranj')).not.toContain('ct-art');
  expect(cardCount(html)).toBe(REGIONS.length);
});

test('🔴 нижня панель країни: фільтр, сортування, густина 1-2-3 / 3-4-5, «вгору» — у відданому HTML', async () => {
  const html = await countryHtml(REGIONS, POINTS);
  const panel = /<nav aria-label="Filter, sort and view the regions"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  expect(panel, 'панелі немає').not.toBe('');
  const text = visibleText(panel);
  expect(text).toContain('Filters');
  expect(text).toContain('Sort by');
  expect(text).toContain('Most campsites');
  expect(text).toContain('Regions with 2+ campsites');
  // Густина: три радіо; за замовчуванням середнє (4 / 2).
  const dens = [...panel.matchAll(/<input\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes('name="ct-density"'));
  const idOf = (tag: string) => /\bid="ct-density-([abc])"/.exec(tag)?.[1];
  expect(dens.map(idOf)).toEqual(['a', 'b', 'c']);
  expect(dens.filter((tag) => /\bchecked\b/.test(tag)).map(idOf)).toEqual(['b']);
  // Значок кнопки малює стільки смуг, скільки карток у ряду: на великому
  // екрані 3/4/5, на телефоні 1/2/3 — рахуємо `<rect>` у відданій розмітці.
  for (const [id, desktop, phone] of [['a', 3, 1], ['b', 4, 2], ['c', 5, 3]] as const) {
    const label = new RegExp(`<label for="ct-density-${id}"[\\s\\S]*?</label>`).exec(panel)?.[0] ?? '';
    const [d, m] = [/<span class="ct-dens__d">([\s\S]*?)<\/span><span class="ct-dens__m">/.exec(label)?.[1] ?? '', /<span class="ct-dens__m">([\s\S]*)/.exec(label)?.[1] ?? ''];
    expect(d.match(/<rect\b/g)?.length, `густина ${id}, великий екран`).toBe(desktop);
    expect(m.match(/<rect\b/g)?.length, `густина ${id}, телефон`).toBe(phone);
  }
  // «Вгору» — якір, який уже веде на `<body id="top">`, без скрипту.
  expect(panel).toMatch(/<a href="#top"[^>]*aria-label="Back to top"/);
  // Панель живе під картками в розмітці, а не в шапці сторінки.
  expect(html.indexOf('data-testid="country-panel"')).toBeGreaterThan(html.indexOf('class="ct-rtiles__row"'));
  // CAMP-441 (50): під фільтром — речення, що дані можуть бути застарілими.
  expect(visibleText(panel)).toContain(PANEL_NOTE);
  expect(panel).toContain('data-testid="panel-note"');
});

test('🔴 сортування й фільтр регіонів: порядок записано в самих картках, і він збігається з ручним підрахунком', async () => {
  const html = await countryHtml();
  const rank = (slug: string) => {
    const style = /style="([^"]*)"/.exec(cardHtml(html, slug).split('>')[0])?.[1] ?? '';
    return {
      name: Number(/--ct-name:(\d+)/.exec(style)?.[1]),
      count: Number(/--ct-count:(\d+)/.exec(style)?.[1]),
    };
  };
  // Рахунок вручну з фікстури: за кількістю — Bled 1250, Bovec 100, Kranj 40,
  // Maribor 12, Celje 7, Ptuj 4, Koper 1; за назвою — A→Я.
  expect(rank('bled')).toEqual({ name: 1, count: 1 });
  expect(rank('bovec')).toEqual({ name: 2, count: 2 });
  expect(rank('celje')).toEqual({ name: 3, count: 5 });
  expect(rank('koper')).toEqual({ name: 4, count: 7 });
  expect(rank('kranj')).toEqual({ name: 5, count: 3 });
  expect(rank('maribor')).toEqual({ name: 6, count: 4 });
  expect(rank('ptuj')).toEqual({ name: 7, count: 6 });
  // Фільтр «2+» ховає ЛИШЕ регіон із одним кемпінгом — і не прибирає його з документа.
  expect(html.match(/<li[^>]*class="ct-rtiles__col"[^>]*data-single=""/g)).toHaveLength(1);
  expect(html.match(/<li[^>]*data-single=""[^>]*>[\s\S]*?<\/li>/)![0]).toContain('/camping/si/koper');
});


// ── CAMP-441: герб біля назви, інакше прапор країни ─────────────────────────

/** Jesenice має чистий герб (CC0) у `data/coats.json`; Gorenjska — код, якого там немає. */
const WITH_ISO = [
  { region: 'Jesenice', slug: 'jesenice', spots: 12, indexable: true, iso3166_2: 'SI-041' },
  { region: 'Gorenjska', slug: 'gorenjska', spots: 30, indexable: true, iso3166_2: 'SI-999' },
  { region: 'Koper', slug: 'koper', spots: 1, indexable: false, iso3166_2: null },
  { region: 'Celje', slug: 'celje', spots: 7, indexable: true },
  { region: 'Kranj', slug: 'kranj', spots: 40, indexable: true, iso3166_2: 'constructor' },
];

test('🔴 регіон із чистим гербом показує герб; решта — прапор країни; мінікарта нікуди не ділась', async () => {
  const html = await countryHtml(WITH_ISO, { jesenice: [marker(46.43, 14.05), marker(46.44, 14.06)] });
  const jesenice = cardHtml(html, 'jesenice');
  expect(jesenice).toContain('data-emblem="coat"');
  expect(jesenice).toMatch(/<img class="ct-coat" src="\/coats\/si-041\.svg" alt=""/);
  expect(jesenice).not.toContain('/flags/');
  // Мінікарта лишилась на тій самій картці.
  expect(jesenice).toContain('ct-rtile__image-wrapper');
  expect(jesenice).toContain('ct-art__dots');
  for (const slug of ['gorenjska', 'koper', 'celje', 'kranj']) {
    const card = cardHtml(html, slug);
    expect(card, slug).toContain('data-emblem="flag"');
    expect(card, slug).toContain('src="/flags/si.svg"');
    expect(card, slug).not.toContain('/coats/');
  }
  // Назва стоїть поруч словами: знак німий для читача екрана.
  expect(visibleText(jesenice)).toContain('Jesenice');
  expect(html.match(/<img class="ct-coat"/g)).toHaveLength(1);
});

test('🔴 файл герба, названий манифестом, справді існує на диску, і код-не-код (`constructor`) герба не дає', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  const coats = JSON.parse(readFileSync('src/data/coats.json', 'utf8')) as Record<string, unknown>;
  const entry = coatFor('SI-041');
  expect(entry?.file).toBe('/coats/si-041.svg');
  expect(existsSync(`public${entry!.file}`)).toBe(true);
  expect(coatFor('constructor')).toBeNull();
  expect(coatFor('__proto__')).toBeNull();
  expect(coatFor(null)).toBeNull();
  expect(Object.keys(coats).length).toBeGreaterThan(50);
});
