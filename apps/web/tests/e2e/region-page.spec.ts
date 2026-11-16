import { expect, test, type APIRequestContext, type Page } from './api-request';
import { hasWebGl } from '../map-ready';
import { API_BASE } from '@/lib/api';

// CAMP-452 — the region page: the controls sit above what they control,
// and the map is a representation of the same set as the list.
//
// 🔴 EVERY CLAIM BELOW IS A MEASUREMENT OF THE LIVE PAGE, not a reading
// of a class or a constant: the toolbar's position after a real scroll,
// the computed style of a checkbox box before anyone clicked it, the
// number the map counted over the markers it drew against the number
// the API counted in SQL for the same address.
//
// Regions are resolved from the API, never named — as in hubs.spec. The
// region chosen is the first whose some type is a real subset of it
// (0 < n < total), so the filter actually narrows.

interface Hub {
  country: string;
  slug: string;
  spots: number;
}

interface Listing {
  total: number;
  matched: number;
  facets: { types: Record<string, number> };
  items: { slug: string }[];
}

const listing = async (request: APIRequestContext, h: Hub, search = ''): Promise<Listing> =>
  (await request.get(`${API_BASE}/spots/${h.country}/${h.slug}?page=1${search}`)).json();

async function narrowable(request: APIRequestContext) {
  const countries: { country: string }[] = await (
    await request.get(`${API_BASE}/spots/countries`)
  ).json();
  for (const { country } of countries) {
    const regions: Omit<Hub, 'country'>[] = await (
      await request.get(`${API_BASE}/spots/${country}/regions`)
    ).json();
    for (const r of regions) {
      const h = { ...r, country };
      const l = await listing(request, h);
      const t = Object.entries(l.facets.types).find(([, n]) => n > 0 && n < l.total);
      if (t) return { hub: h, type: t[0], all: l };
    }
  }
  throw new Error('No region in the data has a type that is a strict subset of it');
}

const hubPath = (h: Hub) => `/camping/${h.country}/${h.slug}`;

/** `getBoundingClientRect()` of the first match, as plain numbers. */
const rect = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      width: r.width,
      height: r.height,
    };
  });

/**
 * 🔴 CAMP-441 (50–53) — THE BOTTOM PANEL, MEASURED ON THE LIVE PAGE.
 *
 * Until 16.11.2026 the controls were a sticky bar under the header
 * (CAMP-452), and the 15.11 review found the header island covering it.
 * The owner's design — the theme's collection panel — is a bar fixed to the
 * BOTTOM of the screen with filters, sort, the grid density and "up".
 *
 * Every claim is a measurement, not a reading of the CSS:
 *   - it is where the CSS says (fixed, above the cookie banner), after a
 *     real scroll, at 375 and 1280;
 *   - nothing sideways: `scrollWidth` does not exceed the viewport at 375;
 *   - the island never covers it, and it never covers the island, at five
 *     widths (the 15.11 finding);
 *   - the density buttons change the number of columns the browser lays
 *     out, to 1/2/3 on a phone and 3/4/5 from 768px;
 *   - at the end of the page the footer is clear of it.
 *
 * Mutations that turn these red: `position:fixed` → `sticky` in
 * listing-panel.tsx (the panel scrolls away: bottom ≠ viewport bottom);
 * deleting the `--consent-h` offset (the panel lies under the banner);
 * deleting a `body:has(#ct-density-…)` rule (the column count stays).
 */
test.describe('🔴 CAMP-441 — the bottom panel', () => {
  for (const [name, width, height] of [
    ['телефон', 375, 812],
    ['десктоп', 1280, 800],
  ] as const) {
    test(`${name}: fixed to the bottom after a scroll, inside the viewport, no sideways scroll, footer clear`, async ({
      page,
      request,
    }) => {
      const { hub } = await narrowable(request);
      await page.setViewportSize({ width, height });
      await page.goto(hubPath(hub), { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => document.fonts.ready);
      const panel = '[data-testid="region-toolbar"]';
      await page.evaluate(() => window.scrollTo(0, 600));
      const gap = width >= 992 ? 32 : 4;
      // 🔴 The consent banner arrives AFTER hydration and writes its height
      // into `--consent-h`; the panel sits above it. So the expectation is
      // recomputed on every poll from the live variable — a one-shot read
      // raced the banner (measured: 0 before it, 149 after).
      const expectedBottom = () =>
        page.evaluate(
          ([h, g]) =>
            h -
            (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--consent-h')) || 0) -
            g,
          [height, gap] as const,
        );
      // Fixed: its bottom is the viewport's bottom less the banner and the gap.
      await expect
        .poll(async () => Math.round((await rect(page, panel)).bottom) - Math.round(await expectedBottom()))
        .toBe(0);
      const r = await rect(page, panel);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(width);
      // Still there after another scroll: it is not a block that was near.
      await page.evaluate(() => window.scrollTo(0, 1400));
      const r2 = await rect(page, panel);
      expect(Math.round(r2.bottom)).toBe(Math.round(r.bottom));
      // Nothing sideways — the 375 requirement of the card.
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(sw, `${hubPath(hub)} scrolls sideways at ${width}px`).toBeLessThanOrEqual(width);
      // It is the thing under the finger there, not covered by a card.
      const onTop = await page.evaluate(
        ([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-testid="region-toolbar"]'),
        [r.left + 24, r.top + r.height / 2] as const,
      );
      expect(onTop, 'something lies on top of the panel').toBe(true);
      // The four controls are all inside it, and really drawn.
      await expect(page.locator(panel).getByRole('link', { name: /^Filters/ })).toBeVisible();
      await expect(page.locator(panel).locator('summary')).toBeVisible();
      await expect(page.locator(panel).getByRole('link', { name: 'Back to top' })).toBeVisible();
      await expect(page.locator(panel).getByRole('group', { name: 'Cards per row' })).toBeVisible();

      // The end of the page: the footer is clear of the panel.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      // The page's own footer is the LAST `<footer>` in the document.
      await expect
        .poll(async () => {
          // Scrolled again on every poll: the page can still be growing.
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          const foot = await page.locator('footer').last().evaluate((el) => el.getBoundingClientRect().bottom);
          return foot - (await rect(page, panel)).top;
        }, { message: 'the panel lies over the footer at the end of the page' })
        .toBeLessThanOrEqual(0);
    });
  }

  test('the island and the panel never cover each other, at five widths', async ({ page, request }) => {
    const { hub } = await narrowable(request);
    for (const width of [375, 768, 1024, 1200, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(hubPath(hub), { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.scrollTo(0, 900));
      await expect(page.getByTestId('site-header')).toHaveAttribute('data-stacked', 'true');
      const bar = await rect(page, '[data-testid="site-header-bar"]');
      const p = await rect(page, '[data-testid="region-toolbar"]');
      expect(p.top, `the panel is at the top at ${width}px`).toBeGreaterThan(bar.bottom + 24);
      expect(p.bottom, `the panel is below the viewport at ${width}px`).toBeLessThanOrEqual(900);
    }
  });

  for (const [name, width, expected] of [
    ['телефон', 375, { a: 1, b: 2, c: 3 }],
    ['десктоп', 1280, { a: 3, b: 4, c: 5 }],
  ] as const) {
    test(`${name}: the density buttons lay out ${expected.a}/${expected.b}/${expected.c} columns`, async ({
      page,
      request,
    }) => {
      const { hub } = await narrowable(request);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(hubPath(hub), { waitUntil: 'domcontentloaded' });
      const columns = () =>
        page.locator('.ct-cards').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(await columns(), 'the default is the middle button').toBe(expected.b);
      for (const k of ['c', 'a', 'b'] as const) {
        await page.locator(`label[for="ct-density-${k}"]`).click();
        expect(await columns(), `density ${k}`).toBe(expected[k]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
    });
  }

  test('"Back to top" returns to the top of the page without a script', async ({ page, request }) => {
    const { hub } = await narrowable(request);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(hubPath(hub), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.getByRole('link', { name: 'Back to top' }).first().click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });
});

test.describe('🔴 CAMP-452 — the map highlights what the list shows', () => {
  test('on a filtered view, the map counts the same number the API counted, and the cards are that set', async ({
    page,
    request,
  }) => {
    const { hub, type, all } = await narrowable(request);
    const filtered = await listing(request, hub, `&types=${type}`);
    expect(filtered.matched).toBeGreaterThan(0);
    expect(filtered.matched).toBeLessThan(all.total);

    await page.goto(`${hubPath(hub)}/filter?types=${type}`);
    const map = page.getByTestId('region-map');

    // 🔴 БЕЗ WebGL МАПИ НЕ БУВАЄ, І ЦЕ НЕ ДЕФЕКТ СТОРІНКИ (CAMP-452).
    //
    // headless Firefox на раннері GitHub не має GPU, тож MapLibre кидає
    // ще на конструкторі, компонент чесно стає `failed/webgl` і показує
    // запасний вміст. Перша редакція цього тесту вимагала `ready`
    // беззастережно й валила e2e рівно на firefox-desktop — тим самим
    // чином, яким це вже ставалось у `campsite-media.spec.ts`. Зонд
    // тепер спільний і живе в `tests/map-ready.ts`.
    //
    // Решта тверджень — числа переліку, чіпів і карток — від WebGL не
    // залежать і перевіряються в КОЖНОМУ браузері, тож пропускається
    // лише те, що без відеоконтексту неперевірне.
    const webgl = await hasWebGl(page);
    if (webgl) {
      // 🔴 Positive wait (tests/map-ready.ts): a misspelt attribute would
      // never equal 'ready', and the test would say so rather than pass.
      await expect(map).toHaveAttribute('data-map-state', 'ready', { timeout: 20_000 });
    } else {
      await expect(map).toHaveAttribute('data-map-state', 'failed', { timeout: 20_000 });
    }

    // 🔴 «READY» І ПРАВИЛЬНІ ЧИСЛА НЕ ОЗНАЧАЮТЬ, ЩО МАПУ ВИДНО.
    //
    // Саме це й трапилось усередині цієї картки, і знайдено було ОКОМ, а
    // не тестом: полотно MapLibre мало 0 px, бо власний CSS бібліотеки
    // приїжджає пізніше й перебивав `position:absolute` нашої обгортки —
    // а підпис при цьому чесно казав «7 of 30 sites … are highlighted».
    // Тобто сторінка з невидимою мапою проходила кожну перевірку нижче.
    //
    // Числа тут перевіряють ЗВʼЯЗОК переліку з мапою; цей блок перевіряє,
    // що мапа взагалі зайняла місце. Межі навмисно грубі: 200×150 — це
    // «щось намальоване», а не макет. Точні розміри міряти тут не можна,
    // вони залежать від ширини проєкту.
    if (webgl) {
      const canvas = await rect(page, '[data-testid="region-map"] canvas');
      expect(
        canvas.width,
        `полотно мапи завширшки ${Math.round(canvas.width)} px — мапи не видно`,
      ).toBeGreaterThan(200);
      expect(
        canvas.height,
        `полотно мапи заввишки ${Math.round(canvas.height)} px — мапи не видно`,
      ).toBeGreaterThan(150);
    }

    // 🔴 ПІДПИС — ЦЕ ВЛАСНИЙ ЛІЧИЛЬНИК МАПИ, А НЕ СЕРВЕРНЕ ЧИСЛО, і я
    // мало не написав тут протилежне. Коли мапи немає, `region-map.tsx`
    // друкує не «N of M», а чесне «The map needs WebGL…». Тобто без
    // відеоконтексту звіряти числа підпису нема з чим — зате є що
    // перевірити: що запасне речення справді про це й каже.
    const legend = (await page.getByTestId('region-map-legend').textContent())?.trim() ?? '';
    if (webgl) {
      const m = /^(\d+) of (\d+) sites in .+ match your filter and are highlighted on the map\.$/.exec(
        legend,
      );
      expect(m, `legend was: ${legend}`).not.toBeNull();
      // Three counts of the same set in one check: the map's, the API's
      // (the toolbar prints it), and the cards on the page.
      expect(Number(m![1])).toBe(filtered.matched);
      expect(Number(m![2])).toBe(all.total);
    } else {
      expect(legend, 'без WebGL підпис мусить пояснити читачеві, чому мапи немає')
        .toContain('needs WebGL');
      expect(legend, 'і сказати, що перелік нижче повний').toContain('list below is complete');
    }
    await expect(page.locator('[data-hub-match]')).toHaveText(
      new RegExp(`^${filtered.matched} sites? match`),
    );
    const cards = page.locator('main ul.grid li a');
    expect(await cards.count()).toBe(Math.min(filtered.matched, 24));
    const listed = new Set(filtered.items.map((s) => `${hubPath(hub)}/${s.slug}`));
    for (const href of await cards.evaluateAll((as) => as.map((a) => a.getAttribute('href')))) {
      expect(listed.has(href ?? '')).toBe(true);
    }
    // And the map says the same through its attributes, for the record —
    // але ці атрибути ставить САМА мапа, тож без WebGL їх не буває.
    if (webgl) {
      await expect(map).toHaveAttribute('data-highlighted', String(filtered.matched));
      await expect(map).toHaveAttribute('data-total', String(all.total));
    }
  });

  test('on the plain hub, the map highlights every site — no filter, nothing dimmed', async ({
    page,
    request,
  }) => {
    const { hub, all } = await narrowable(request);
    await page.goto(hubPath(hub));
    const map = page.getByTestId('region-map');

    // Той самий зонд, що й у тесті вище: без WebGL мапи не буває, і це
    // не дефект сторінки. Підпис рахує сервер, тож він перевіряється
    // всюди; атрибути мапи ставить сама мапа, тож лише там, де вона є.
    const webgl = await hasWebGl(page);
    await expect(map).toHaveAttribute(
      'data-map-state',
      webgl ? 'ready' : 'failed',
      { timeout: 20_000 },
    );
    if (webgl) {
      await expect(page.getByTestId('region-map-legend')).toHaveText(
        `${all.total} sites in ${await page.locator('h1').first().evaluate((h) => h.textContent?.replace(/^Campsites in /, ''))} on the map.`,
      );
      await expect(map).toHaveAttribute('data-highlighted', String(all.total));
    } else {
      await expect(page.getByTestId('region-map-legend')).toContainText('needs WebGL');
    }
  });
});

test.describe('🔴 CAMP-452 — a checkbox looks like a checkbox BEFORE the click', () => {
  test('the box is 24×24 with a border and the tick is invisible; after choosing, the tick shows', async ({
    page,
    request,
  }) => {
    const { hub, type } = await narrowable(request);
    await page.goto(hubPath(hub));

    const chips = page.locator('nav[aria-label="Filter campsites"] a.ct-check');
    expect(await chips.count()).toBe(15);
    // No chip is chosen on the plain hub.
    expect(await page.locator('nav[aria-label="Filter campsites"] a.ct-check[aria-current="true"]').count()).toBe(0);

    const off = await chips
      .first()
      .locator('.ct-check__box')
      .evaluate((el) => {
        const s = getComputedStyle(el);
        const svg = getComputedStyle(el.querySelector('svg')!);
        return {
          width: s.width,
          height: s.height,
          borderLeft: s.borderLeftWidth,
          borderStyle: s.borderLeftStyle,
          display: s.display,
          visibility: s.visibility,
          opacity: s.opacity,
          tickOpacity: svg.opacity,
          background: s.backgroundColor,
        };
      });
    expect(off.width).toBe('24px');
    expect(off.height).toBe('24px');
    expect(off.borderLeft).toBe('1px');
    expect(off.borderStyle).toBe('solid');
    expect(off.display).not.toBe('none');
    expect(off.visibility).toBe('visible');
    expect(off.opacity).toBe('1');
    expect(off.tickOpacity).toBe('0');

    // Choose a type: the chosen chip's box is filled and its tick is visible.
    await page.locator(`a[href="${hubPath(hub)}/filter?types=${type}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${hubPath(hub)}/filter\\?types=${type}$`));
    const chosen = page.locator('nav[aria-label="Filter campsites"] a.ct-check[aria-current="true"]');
    await expect(chosen).toHaveCount(1);
    const on = await chosen.locator('.ct-check__box').evaluate((el) => ({
      tickOpacity: getComputedStyle(el.querySelector('svg')!).opacity,
      background: getComputedStyle(el).backgroundColor,
    }));
    expect(on.tickOpacity).toBe('1');
    expect(on.background).not.toBe(off.background);
    // The other fourteen keep the empty box.
    const others = page.locator('nav[aria-label="Filter campsites"] a.ct-check:not([aria-current="true"]) .ct-check__box svg');
    expect(await others.count()).toBe(14);
    for (const o of await others.evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity))) {
      expect(o).toBe('0');
    }
  });
});
