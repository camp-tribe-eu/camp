import { expect, test } from '@playwright/test';
import CampsitePage from '@/app/camping/[country]/[region]/[slug]/page';
import { renderAsyncComponent } from './render-component';
import { visibleText } from './rendered-text';
import { CLIENT_ISLANDS } from './client-islands';
import { nextTab, spotTabs, SPOT_TAB_ORDER } from '@/lib/spot-tabs';

// CAMP-453 — сторінка кемпінгу як PDP теми: таби, колонка карток, умови нижче.
//
// 🔴 КОЖНЕ ТВЕРДЖЕННЯ ЧИТАЄ HTML, ЯКИЙ ВІДДАЄ СПРАВЖНЯ `CampsitePage`, а не
// константу, не клас і не `sr-only`. Сторінка рендериться з підміненим
// `fetch`, тож компонент, що сам правий, а сторінка передала йому не те, —
// ловиться тут і більше ніде.
//
// 🔴 ПОЗИЦІЮ НА ЕКРАНІ ЦЕЙ ФАЙЛ НЕ ВИМІРЮЄ: юніт не має розкладки. Що зручності
// лежать у першому екрані, а мапа лишається видимою при прокрутці, доводить
// `tests/e2e/campsite-pdp.spec.ts` у браузері. Тут — що лежить у розмітці й
// в якому порядку.

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

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const spot = (extra: Record<string, unknown>) => ({
  slug: 'camping-test',
  name: 'Camping Test',
  country: 'hr',
  region: 'Istria',
  type: 'paid',
  lat: 45.1,
  lon: 13.9,
  amenities: {
    electricity: 'yes',
    water: 'unknown',
    shower: 'yes',
    toilets: 'unknown',
    dogFriendly: 'unknown',
    wifi: 'unknown',
    greyWater: 'unknown',
    laundry: 'unknown',
    wheelchair: 'unknown',
    wheelchairFull: 'unknown',
  },
  ownerOverrides: {},
  lastSeenAt: '2026-10-12T05:00:00.000Z',
  missingSince: null,
  context: {},
  description: null,
  descriptionLang: null,
  stars: null,
  website: null,
  contact: {},
  sources: [
    { id: 'osm', ref: 'w1', updatedAt: '2026-10-12', fields: ['name', 'location', 'amenities'] },
  ],
  warningAreas: null,
  tariffs: [],
  ...extra,
});

const PARAMS = { country: 'hr', region: 'istria', slug: 'camping-test' };

async function pageHtml(extra: Record<string, unknown>): Promise<string> {
  let html = '';
  await withFetch(
    (url) =>
      url.includes('/spots/hr/istria/camping-test')
        ? json({ spot: spot(extra), nearby: [] })
        : json({}, 404),
    async () => {
      html = await renderAsyncComponent(
        CampsitePage,
        { params: Promise.resolve(PARAMS) },
        { omit: CLIENT_ISLANDS },
      );
    },
  );
  return html;
}

/** Які таби віддала розмітка, у порядку, в якому вони стоять. */
const tabsIn = (html: string): string[] =>
  [...html.matchAll(/data-testid="spot-tablist"[\s\S]*?<\/(?:nav|div)>/g)]
    .flatMap((m) => [...m[0].matchAll(/data-tab="(\w+)"/g)].map((t) => t[1]));

const FRESH_CAM = {
  ref: '1',
  title: 'Poreč: harbour',
  categories: ['harbor'],
  detailUrl: 'https://windy.com/webcams/1',
  providerUrl: null,
  lastFrameAt: minutesAgo(10),
  metres: 1200,
};

// ── чисте рішення ────────────────────────────────────────────────────────

test.describe('які таби існують', () => {
  test('мапа є завжди; решта — лише коли прапорець явно true', () => {
    expect(spotTabs({}).map((t) => t.id)).toEqual(['map']);
    expect(spotTabs({ webcams: false, alerts: false, weather: false }).map((t) => t.id)).toEqual(['map']);
    // Відсутній ключ — не «невідомо», а «немає».
    expect(spotTabs({ alerts: true }).map((t) => t.id)).toEqual(['map', 'alerts']);
  });

  test('порядок один: мапа, погода, камери, тривоги — хоч би в якому порядку прийшли прапорці', () => {
    expect(spotTabs({ alerts: true, webcams: true, weather: true }).map((t) => t.id)).toEqual([
      'map',
      'weather',
      'webcams',
      'alerts',
    ]);
    expect([...SPOT_TAB_ORDER]).toEqual(['map', 'weather', 'webcams', 'alerts']);
  });

  test('стрілки йдуть по колу, Home і End — до країв, чужа клавіша — нічого', () => {
    const tabs = spotTabs({ webcams: true, alerts: true });
    expect(nextTab(tabs, 'map', 'ArrowRight')).toBe('webcams');
    expect(nextTab(tabs, 'alerts', 'ArrowRight')).toBe('map');
    expect(nextTab(tabs, 'map', 'ArrowLeft')).toBe('alerts');
    expect(nextTab(tabs, 'webcams', 'Home')).toBe('map');
    expect(nextTab(tabs, 'webcams', 'End')).toBe('alerts');
    expect(nextTab(tabs, 'map', 'Enter')).toBeNull();
  });
});

// ── що віддає сторінка ───────────────────────────────────────────────────

test.describe('таби у відданому HTML', () => {
  test('де є свіжа камера й відомі зони тривог — три таби, і в такому порядку', async () => {
    const html = await pageHtml({ webcams: [FRESH_CAM], warningAreas: ['HR001'] });
    expect(tabsIn(html)).toEqual(['map', 'webcams', 'alerts']);
    // Підпис таба читає людина: звіряємо видимий текст, а не атрибут.
    const text = visibleText(html);
    expect(text).toContain('Map');
    expect(text).toContain('Webcams');
    expect(text).toContain('Alerts');
    // Кожен таб веде до панелі, яка є в розмітці.
    for (const id of ['map', 'webcams', 'alerts']) {
      expect(html).toContain(`id="spot-panel-${id}"`);
      expect(html).toContain(`href="#spot-panel-${id}"`);
    }
  });

  test('🔴 погоди немає ні таба, ні рядка-заглушки: джерела прогнозу в коді немає', async () => {
    const html = await pageHtml({ webcams: [FRESH_CAM], warningAreas: ['HR001'] });
    expect(tabsIn(html)).not.toContain('weather');
    expect(html).not.toContain('spot-panel-weather');
    expect(visibleText(html)).not.toMatch(/forecast is not connected|weather on site|coming soon/i);
  });

  test('🔴 таб без даних не малюється: ні камер, ні зон — лишається одна мапа й жодного рядка табів', async () => {
    const html = await pageHtml({ webcams: null, warningAreas: null });
    expect(tabsIn(html)).toEqual([]);
    expect(html).not.toContain('data-testid="spot-tablist"');
    expect(html).toContain('id="spot-panel-map"');
    expect(html).not.toContain('id="spot-panel-webcams"');
    expect(html).not.toContain('id="spot-panel-alerts"');
  });

  test('🔴 «камер у радіусі немає» — відповідь, а не таб: стоїть відкрито в умовах, а табів немає', async () => {
    const html = await pageHtml({ webcams: [], warningAreas: null });
    expect(tabsIn(html)).toEqual([]);
    const text = visibleText(html);
    expect(text).toMatch(/No public webcam within 25 km/);
    // …і стоїть у блоці умов, поза панелями.
    expect(html.indexOf('No public webcam')).toBeGreaterThan(html.indexOf('data-testid="spot-conditions"'));
  });

  test('🔴 усі камери старші за добу — теж відповідь у блоці умов, не таб', async () => {
    const html = await pageHtml({
      webcams: [{ ...FRESH_CAM, lastFrameAt: minutesAgo(60 * 30) }],
      warningAreas: null,
    });
    expect(tabsIn(html)).toEqual([]);
    expect(visibleText(html)).toMatch(/none of them has reported for more than a day/);
  });

  test('зони тривог відомі, але порожні — таб є (це відповідь «тут нічого немає»), камер немає — табу камер немає', async () => {
    const html = await pageHtml({ webcams: null, warningAreas: [] });
    expect(tabsIn(html)).toEqual(['map', 'alerts']);
  });
});

test.describe('порядок у розмітці', () => {
  test('🔴 зручності — у колонці карток, вище за умови довкілля й за «Campsites nearby»', async () => {
    const html = await pageHtml({ webcams: [FRESH_CAM], warningAreas: ['HR001'] });
    // Позиції заголовків h2 у розмітці. Мітка «Facilities» є ще й у плитці
    // ключових фактів, тож шукаємо саме заголовок.
    const h2 = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => ({
      text: visibleText(m[1]).trim(),
      at: m.index ?? -1,
    }));
    const pos = (name: RegExp) => h2.find((h) => name.test(h.text))?.at ?? -1;
    const cards = html.indexOf('data-testid="campsite-cards"');
    const conditions = html.indexOf('data-testid="spot-conditions"');
    const facilities = pos(/^Facilities$/);
    expect(facilities, 'у розмітці немає заголовка Facilities').toBeGreaterThan(-1);
    expect(facilities).toBeGreaterThan(cards);
    expect(facilities).toBeLessThan(conditions);

    // Знаменник: скільки умов довкілля насправді є на цій сторінці. Нуль
    // означав би, що перевірка нижче не бачить жодної.
    const env = h2.filter((h) => /bathing|air quality|drought/i.test(h.text));
    expect(env.length, `умов довкілля на сторінці: ${h2.map((h) => h.text).join(' | ')}`).toBeGreaterThanOrEqual(2);
    for (const h of env) {
      expect(h.at, `«${h.text}» стоїть у колонці карток, а не в блоці умов`).toBeGreaterThan(conditions);
    }
    const nearby = pos(/Campsites nearby/);
    if (nearby > -1) expect(nearby).toBeGreaterThan(conditions);
  });

  test('назва — першою в DOM, мапа — другою, решта карток — третьою (порядок ока = порядок клавіатури)', async () => {
    const html = await pageHtml({ webcams: [FRESH_CAM], warningAreas: ['HR001'] });
    const title = html.indexOf('data-testid="campsite-title"');
    const sticky = html.indexOf('data-testid="campsite-sticky"');
    const cards = html.indexOf('data-testid="campsite-cards"');
    expect(title).toBeGreaterThan(-1);
    expect(title).toBeLessThan(sticky);
    expect(sticky).toBeLessThan(cards);
  });

  test('🔴 жодної порожньої білої картки: картка служб без вмісту не має тексту, тож і не малюється', async () => {
    // Без `campServices` і без «можливого дискомфорту» обгортка служб
    // порожня, і CSS `empty:hidden` її ховає. Доводимо, що вона справді
    // порожня в розмітці (а не що містить пробіл, який `:empty` не візьме).
    const html = await pageHtml({});
    const m = /<div[^>]*data-testid="campsite-services-card"[^>]*>([\s\S]*?)<\/div>/.exec(html);
    expect(m, 'обгортка служб зникла з розмітки').toBeTruthy();
    expect(m![1]).toBe('');
    expect(m![0]).toContain('empty:hidden');
  });
});
