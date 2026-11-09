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
 * The theme's offset for a sticky block under the sticky header:
 * `top: calc(var(--header-height-sticky) + 24px)` (collection.build.css).
 * The header's height is read from the live header, not assumed.
 */
const STICKY_GAP = 24;

test.describe('🔴 CAMP-452 — the toolbar stays with the reader', () => {
  for (const [name, width, height] of [
    ['телефон', 375, 812],
    ['десктоп', 1280, 800],
  ] as const) {
    test(`${name}: scrolled past, the toolbar sits under the header; without position:sticky it would be gone`, async ({
      page,
      request,
    }) => {
      const { hub } = await narrowable(request);
      await page.setViewportSize({ width, height });
      await page.goto(hubPath(hub), { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => document.fonts.ready);
      // 🔴 The header writes its own height into `--ct-header-h` once it
      // has hydrated (site-header-frame.tsx); until then the toolbar sits
      // on the 63px fallback, which is right from `sm` up and 10px short
      // on a phone, where the row is 73px. Measured 09.11.2026: without
      // this wait the phone run read 87 where the live header said 97.
      // Waiting for the variable, not for `load` — with a map on the page
      // `load` may never come (touch-targets.spec.ts).
      await page.waitForFunction(
        () => getComputedStyle(document.documentElement).getPropertyValue('--ct-header-h').trim() !== '',
      );

      const header = await rect(page, '[data-testid="site-header"]');
      expect(header.top, 'the header is not at the top before scrolling').toBe(0);
      const before = await rect(page, '[data-testid="region-toolbar"]');
      // The toolbar starts below the header, in the flow, under the map.
      expect(before.top).toBeGreaterThan(header.bottom + STICKY_GAP);

      // Scroll so that the toolbar's natural place is 400px ABOVE the top
      // of the viewport. The page must have that much room, or the claim
      // below would be about nothing — the room is asserted, not hoped.
      const target = Math.round(before.top - header.bottom - STICKY_GAP + 400);
      const max = await page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      );
      expect(max, `${hubPath(hub)} is too short to scroll ${target}px at ${width}px`).toBeGreaterThan(
        target,
      );
      await page.evaluate((y) => window.scrollTo(0, y), target);
      expect(await page.evaluate(() => window.scrollY), 'the page did not scroll').toBe(target);

      const after = await rect(page, '[data-testid="region-toolbar"]');
      // 🔴 THE MEASUREMENT. Stuck under the header at the theme's gap:
      // 63 + 24 = 87 today, read off the header rather than typed in.
      // Mutation — `position:sticky` removed from `.ct-toolbar` in
      // region-toolbar.tsx — puts this at about −400.
      expect(Math.round(after.top)).toBe(Math.round(header.bottom + STICKY_GAP));
      expect(after.bottom).toBeLessThanOrEqual(height);

      // And it is really the thing under the cursor there, not covered by
      // the header or by a card that scrolled over it.
      const centre = [(after.left + after.right) / 2, after.top + 8] as const;
      const onTop = await page.evaluate(
        ([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-testid="region-toolbar"]'),
        centre,
      );
      expect(onTop, 'something else lies on top of the toolbar').toBe(true);
      // The "Filters" link in the toolbar is reachable from here.
      const filters = page.getByRole('link', { name: /^Filters/ });
      const box = await filters.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(header.bottom);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    });
  }
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

    // The legend is the map's OWN count over the markers it drew.
    // Підпис малюється й без WebGL: його числа рахує сервер, не мапа.
    const legend = await page.getByTestId('region-map-legend').textContent();
    const m = /^(\d+) of (\d+) sites in .+ match your filter and are highlighted on the map\.$/.exec(
      legend?.trim() ?? '',
    );
    expect(m, `legend was: ${legend}`).not.toBeNull();
    const highlighted = Number(m![1]);
    const drawn = Number(m![2]);

    // Three counts of the same set in one check: the map's, the API's
    // (the toolbar prints it), and the cards on the page.
    expect(highlighted).toBe(filtered.matched);
    expect(drawn).toBe(all.total);
    await expect(page.locator('[data-hub-match]')).toHaveText(
      new RegExp(`^${filtered.matched} sites? match`),
    );
    const cards = page.locator('main ul.grid li a');
    expect(await cards.count()).toBe(Math.min(filtered.matched, 24));
    const listed = new Set(filtered.items.map((s) => `${hubPath(hub)}/${s.slug}`));
    for (const href of await cards.evaluateAll((as) => as.map((a) => a.getAttribute('href')))) {
      expect(listed.has(href ?? '')).toBe(true);
    }
    // And the map says the same through its attributes, for the record.
    await expect(map).toHaveAttribute('data-highlighted', String(filtered.matched));
    await expect(map).toHaveAttribute('data-total', String(all.total));
  });

  test('on the plain hub, the map highlights every site — no filter, nothing dimmed', async ({
    page,
    request,
  }) => {
    const { hub, all } = await narrowable(request);
    await page.goto(hubPath(hub));
    const map = page.getByTestId('region-map');
    await expect(map).toHaveAttribute('data-map-state', 'ready', { timeout: 20_000 });
    await expect(page.getByTestId('region-map-legend')).toHaveText(
      `${all.total} sites in ${await page.locator('h1').first().evaluate((h) => h.textContent?.replace(/^Campsites in /, ''))} on the map.`,
    );
    await expect(map).toHaveAttribute('data-highlighted', String(all.total));
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
