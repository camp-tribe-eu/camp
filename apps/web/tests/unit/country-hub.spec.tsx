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
import { pickTickerRegions } from '@/components/region-ticker';
import { renderAsyncComponent, renderComponent, renderNestedAsync, rendersNothing } from './render-component';
import { visibleText } from './rendered-text';

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

function api(regions: unknown = REGIONS): Fetcher {
  return (url) => {
    if (url.endsWith('/spots/si/regions')) return json(regions);
    if (url.endsWith('/spots/hub-stats/si')) return json(STATS);
    const m = /\/spots\/si\/bled\?page=(\d+)/.exec(url);
    if (m) return json(bledPage(Number(m[1])));
    return json({}, 404);
  };
}

async function countryHtml(regions: unknown = REGIONS): Promise<string> {
  let html = '';
  await withFetch(api(regions), async () => {
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
  // Прапор країни — зображенням кожної картки, і це файл, що лежить у public/.
  expect(html.match(/<img class="ct-flag" src="\/flags\/si\.svg"/g)?.length).toBeGreaterThanOrEqual(
    REGIONS.length,
  );
});

test('RegionTiles без жодного регіону не малює нічого; readRegionCards обрізає пробіли', () => {
  expect(rendersNothing(RegionTiles, { country: 'si', regions: [] })).toBe(true);
  expect(readRegionCards([{ region: ' Bled ', slug: ' bled ', spots: 2 }])).toEqual([
    { region: 'Bled', slug: 'bled', spots: 2 },
  ]);
  expect(regionCountLabel(1)).toBe('1 campsite');
  expect(regionCountLabel(1250)).toBe('1,250 campsites');
  expect(regionCountLabel(null)).toBe('Campsite count not recorded');
});

// ── Склад сторінки ─────────────────────────────────────────────────────────

test('🔴 склад: h1 у банері → тікер → лічильники → дві кнопки → картки регіонів → два банери → банер про нас', async () => {
  const html = await countryHtml();
  const order = [
    '<h1 class="ct-banner__heading">Campsites in Slovenia</h1>',
    'role="marquee"',
    'aria-label="Key figures"',
    'data-ct-button="primary"',
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

test('CTA з ієрархією: «Open on map» — головна (primary), «Plan a trip» — тиха (secondary)', async () => {
  const html = await countryHtml();
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    attrs: m[1],
    text: visibleText(m[2]).trim(),
  }));
  const map = anchors.find((a) => a.text === 'Open on map');
  const plan = anchors.find((a) => a.text === 'Plan a trip');
  expect(map?.attrs).toContain('data-ct-button="primary"');
  expect(plan?.attrs).toContain('data-ct-button="secondary"');
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
