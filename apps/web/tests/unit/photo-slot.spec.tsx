/**
 * Слоти фото власника — рішення 16.11.2026: «нароби заглушки фото де треба,
 * а я виведу перед відкриттям сайту вже те, що мені буде потрібно».
 *
 * 🔴 КОЖНА ТВЕРДЖЕННЯ ТУТ — ПРО ВІДДАНИЙ HTML сторінки (чотири сторінки
 * рендеряться справді, проти підміненого `fetch`), а не про клас, константу
 * чи `sr-only`. Місця, де стоїть слот, — це сторінки, не рядок у списку.
 *
 * 🔴 МУТАЦІЇ, ЯКІ ЦЕЙ ФАЙЛ МУСИТЬ ЧЕРВОНИТИ (прогін — у тілі PR):
 *   1. `PhotoFrame`: при порожньому `src` малювати `<img src="">` замість
 *      заглушки → червоніє «порожній слот».
 *   2. `getPhotoSlot`: не перевіряти файл Directus (`bannerFileUsable`)
 *      → червоніє «файл, якого Directus не віддасть».
 *   3. `readRawPhotoSlot` без `readRawBanner` (брати `src` як є) → червоніє
 *      «зіпсований запис».
 *   4. прибрати `<PhotoSlot>` зі сторінки маршруту/гіда/теми/провайдера
 *      → червоніє відповідна сторінка.
 *   5. маршрут `/media/photo`: прибрати `isPhotoSlotKey` → червоніє
 *      «ключ не з переліку».
 *   6. розійтись переліком із API → червоніє «перелік дзеркалить API».
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

import GuidePage from '@/app/guides/[slug]/page';
import GuidesByTopic from '@/app/guides/topic/[topic]/page';
import { GET } from '@/app/media/photo/[key]/route';
import ProviderPageView from '@/app/camper-rental/providers/[slug]/page';
import RoutePage from '@/app/routes/[slug]/page';
import RouteMapEmbed from '@/components/route-map-embed';
import { PhotoFrame } from '@/components/photo-frame';
import { PhotoSlot } from '@/components/photo-slot';
import { testHooks } from '@/lib/cms-file';
import {
  PHOTO_SLOT_KEYS,
  photoSlotTestHooks,
  type PhotoSlotKey,
} from '@/lib/photo-slot';
import { ROUTE_FIXTURE } from '../fixtures/route';
import { visibleText } from './rendered-text';
import { renderAsyncComponent, renderComponent, renderNestedAsync } from './render-component';

const CMS = 'http://cms.photo-slots.invalid';
const FILE = '33333333-3333-4333-8333-333333333333';
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

interface World {
  /** Що API віддає для слота; `null` — 404; функція — довільна відповідь. */
  slot?: Record<string, unknown> | string | null | (() => Response);
  /** Directus недоступний. */
  cmsDown?: boolean;
  /** Решта запитів (для сторінок). */
  other?: (url: string) => Response | null;
}

/** Запити, які бачив підмінений fetch. */
let seen: string[] = [];

async function inWorld<T>(w: World, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const env = { u: process.env.CMS_INTERNAL_URL, t: process.env.CMS_ASSET_TOKEN };
  process.env.CMS_INTERNAL_URL = CMS;
  process.env.CMS_ASSET_TOKEN = 'photo.slots.guard.token';
  testHooks.reset();
  photoSlotTestHooks.reset();
  seen = [];
  globalThis.fetch = ((u: string) =>
    Promise.resolve().then(() => {
      const url = new URL(String(u));
      seen.push(url.origin === new URL(CMS).origin ? `cms${url.pathname}` : url.pathname);
      if (url.origin === new URL(CMS).origin) {
        if (w.cmsDown) throw new TypeError('connect ECONNREFUSED');
        if (url.pathname.startsWith('/files/')) {
          return json({ data: { type: 'image/png', filesize: PNG.length } });
        }
        if (url.pathname.startsWith('/assets/')) return new Response(PNG);
        return json({}, 404);
      }
      const m = /^\/pages\/photo-slot\/(.+)$/.exec(url.pathname);
      if (m) {
        if (typeof w.slot === 'function') return w.slot();
        if (w.slot === undefined || w.slot === null) return json({ message: 'none' }, 404);
        return json(w.slot);
      }
      const other = w.other?.(url.pathname + url.search);
      if (other) return other;
      return json({}, 404);
    })) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
    testHooks.reset();
    photoSlotTestHooks.reset();
    for (const [k, v] of [
      ['CMS_INTERNAL_URL', env.u],
      ['CMS_ASSET_TOKEN', env.t],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const imgs = (html: string) => html.match(/<img\b[^>]*>/g) ?? [];
const slotHtml = (key: PhotoSlotKey) =>
  renderAsyncComponent(PhotoSlot, { slot: key });

// ── 1. сам слот ──────────────────────────────────────────────────────────

test('🔴 порожній слот: заглушка без <img>, сховано від читача екрана, без тексту', async () => {
  for (const key of PHOTO_SLOT_KEYS) {
    const html = await inWorld({ slot: null }, () => slotHtml(key));
    expect(imgs(html), key).toEqual([]);
    expect(html, key).toContain('data-testid="photo-placeholder"');
    expect(html, key).toContain(`data-photo-slot="${key}"`);
    expect(html, key).toContain('aria-hidden="true"');
    expect(html, key).toContain('<svg');
    // Порожнє не малюємо словами.
    expect(visibleText(html).trim(), key).toBe('');
  }
});

test('🔴 порожній рядок і пробіли в полі — теж заглушка, не <img src="">', async () => {
  for (const src of ['', '   ']) {
    const html = await inWorld({ slot: { src, alt: 'x' } }, () => slotHtml('route-hero'));
    expect(imgs(html), JSON.stringify(src)).toEqual([]);
    expect(html).toContain('data-testid="photo-placeholder"');
  }
  // PhotoFrame напряму: порожній src — не картинка.
  const direct = renderComponent(PhotoFrame, { image: { src: ' ', alt: 'x' } });
  expect(imgs(direct)).toEqual([]);
});

test('🔴 заповнений слот: <img> із правильним src і alt, заглушки немає', async () => {
  const html = await inWorld(
    { slot: { src: '/banners/lake.webp', alt: 'Lake at dawn' } },
    () => slotHtml('guide-hero'),
  );
  const found = imgs(html);
  expect(found).toHaveLength(1);
  expect(found[0]).toContain('src="/banners/lake.webp"');
  expect(found[0]).toContain('alt="Lake at dawn"');
  expect(html).not.toContain('photo-placeholder');
});

test('фото без опису — декоративне (alt="")', async () => {
  const html = await inWorld({ slot: { src: '/banners/lake.webp' } }, () =>
    slotHtml('guide-hero'),
  );
  expect(imgs(html)[0]).toContain('alt=""');
});

test('🔴 файл із Directus іде з нашого origin, а не з адреси CMS', async () => {
  const html = await inWorld({ slot: { src: FILE, alt: 'Own photo' } }, () =>
    slotHtml('provider-hero'),
  );
  const found = imgs(html);
  expect(found).toHaveLength(1);
  expect(found[0]).toContain(`src="/media/photo/provider-hero?f=${FILE}"`);
  expect(html).not.toContain('cms.photo-slots.invalid');
});

test('🔴 файл, якого Directus не віддасть, — заглушка, а не зламаний <img>', async () => {
  const html = await inWorld({ slot: { src: FILE, alt: 'x' }, cmsDown: true }, () =>
    slotHtml('route-hero'),
  );
  expect(imgs(html)).toEqual([]);
  expect(html).toContain('data-testid="photo-placeholder"');
});

test('🔴 один зіпсований запис — одна заглушка; решта сторінки ціла', async () => {
  for (const bad of [
    { src: 'https://evil.example/x.jpg', alt: 'x' },
    { src: '//evil.example/x.jpg', alt: 'x' },
    { src: 'javascript:alert(1)', alt: 'x' },
    { src: 'data:image/svg+xml,<svg/>', alt: 'x' },
    { src: 42, alt: 'x' },
    { alt: 'x' },
    'not an object',
  ]) {
    const html = await inWorld({ slot: bad }, () => slotHtml('route-hero'));
    expect(imgs(html), JSON.stringify(bad)).toEqual([]);
    expect(html, JSON.stringify(bad)).toContain('data-testid="photo-placeholder"');
  }
  const down = await inWorld(
    {
      slot: () => {
        throw new Error('connection reset');
      },
    },
    () => slotHtml('route-hero'),
  );
  expect(imgs(down)).toEqual([]);
  expect(down).toContain('data-testid="photo-placeholder"');
});

test('заглушка не стає og:image: слот не виводить жодних meta-тегів', async () => {
  const html = await inWorld({ slot: null }, () => slotHtml('route-hero'));
  expect(html).not.toContain('<meta');
  expect(html).not.toContain('og:image');
});

// ── 2. чотири сторінки: слот стоїть у відданому HTML ─────────────────────

const route = ROUTE_FIXTURE;

const routeWorld = (slot: World['slot']): World => ({
  slot,
  other: (u) => {
    if (u.includes('/routes/content')) {
      return json(/\/routes\/content\/.+/.test(u) ? route : { routes: [route] });
    }
    if (u.includes('/routes/near')) {
      return json({
        groups: route.stages.map((s) => ({ lat: s.lat, lon: s.lon, spots: [] })),
        perPoint: 3,
        radiusMetres: 15000,
        returned: 0,
      });
    }
    if (u.includes('/routes/services')) {
      return json({
        groups: route.stages.map((s) => ({ lat: s.lat, lon: s.lon, services: [] })),
        radiusMetres: 5000,
        perKind: 1,
        returned: 0,
        truncated: false,
      });
    }
    return null;
  },
});

const providerWorld = (slot: World['slot']): World => ({
  slot,
  other: (u) =>
    u.startsWith('/rental/providers/')
      ? json({
          slug: 'nordic-campers',
          name: 'Nordic Campers',
          intro: 'A Finnish company.',
          homeCountry: 'FI',
          services: [],
          vehicles: [],
          reviewProfiles: [],
        })
      : null,
});

const guideWorld = (slot: World['slot']): World => {
  const guide = {
    slug: 'fr-ain-water',
    category: 'region',
    title: 'Water near Ain',
    summary: null,
    body: 'Some text.',
    provenance: 'human',
    generator: null,
    authorName: 'A. Writer',
    authorCredentials: null,
    readingMinutes: 2,
    factsCheckedAt: null,
    publishedAt: null,
  };
  return {
    slot,
    other: (u) => {
      if (u.startsWith('/guides/fr-ain-water')) return json(guide);
      if (u.startsWith('/guides')) return json([guide]);
      return null;
    },
  };
};

const DEFAULT_BG: Record<string, string> = {
  'guide-hero': '/banners/guides.webp',
  'guide-topic-hero': '/banners/guides.webp',
  'provider-hero': '/banners/camper.webp',
};

const renderers = {
  'route-hero': (slot: World['slot']) =>
    inWorld(routeWorld(slot), () =>
      renderNestedAsync(
        RoutePage,
        { params: Promise.resolve({ slug: route.slug }) },
        { omit: [RouteMapEmbed] },
      ),
    ),
  'provider-hero': (slot: World['slot']) =>
    inWorld(providerWorld(slot), () =>
      renderNestedAsync(ProviderPageView, {
        params: Promise.resolve({ slug: 'nordic-campers' }),
      }),
    ),
  'guide-hero': (slot: World['slot']) =>
    inWorld(guideWorld(slot), () =>
      renderNestedAsync(GuidePage, {
        params: Promise.resolve({ slug: 'fr-ain-water' }),
      }),
    ),
  'guide-topic-hero': (slot: World['slot']) =>
    inWorld(guideWorld(slot), () =>
      renderNestedAsync(GuidesByTopic, {
        params: Promise.resolve({ topic: 'water' }),
      }),
    ),
} as const;

/** `src` усіх фонових шарів банерів на сторінці. */
const bannerBackgrounds = (html: string): string[] =>
  [...html.matchAll(/<img\b[^>]*class="ct-banner__background"[^>]*>/g)].map(
    (m) => /src="([^"]*)"/.exec(m[0])?.[1] ?? '',
  );

test('🔴 /routes/[slug] без банера: слот стоїть окремим фото, заглушка при порожньому', async () => {
  const html = await renderers['route-hero'](null);
  expect(html).toContain('data-photo-slot="route-hero"');
  expect(html).toContain('data-testid="photo-placeholder"');
  expect(html.match(/data-photo-slot="/g)).toHaveLength(1);
  const filled = await renderers['route-hero']({ src: '/banners/lake.webp', alt: 'Hero' });
  expect(filled).toContain('src="/banners/lake.webp"');
  expect(filled).toContain('alt="Hero"');
  expect(filled).not.toContain('data-testid="photo-placeholder"');
});

for (const key of ['guide-hero', 'guide-topic-hero', 'provider-hero'] as const) {
  test(`🔴 ${key}: слот живить ФОН банера, окремого фото під банером немає`, async () => {
    const empty = await renderers[key](null);
    // Порожній слот → нинішній фон, нічого не змінилось.
    expect(bannerBackgrounds(empty), key).toEqual([DEFAULT_BG[key]]);
    expect(empty, key).not.toContain('data-photo-slot');
    expect(empty, key).not.toContain('data-testid="photo-placeholder"');

    const filled = await renderers[key]({ src: '/banners/lake.webp', alt: 'Own photo' });
    expect(bannerBackgrounds(filled), key).toEqual(['/banners/lake.webp']);
    expect(filled, key).toContain('alt="Own photo"');
    // Рівно одне героїчне зображення: банер, без PhotoFrame під ним.
    expect(filled, key).not.toContain('data-photo-slot');
    expect(filled.match(/class="ct-banner__background"/g), key).toHaveLength(1);
  });

  test(`🔴 ${key}: зіпсований слот лишає дефолтний фон`, async () => {
    for (const bad of [{ src: 'https://evil.example/x.jpg', alt: 'x' }, { src: 42 }, 'junk']) {
      const html = await renderers[key](bad as World['slot']);
      expect(bannerBackgrounds(html), JSON.stringify(bad)).toEqual([DEFAULT_BG[key]]);
    }
  });
}

// ── 3. маршрут /media/photo/<ключ> ───────────────────────────────────────

const get = (key: string) =>
  GET(new Request(`http://localhost/media/photo/${key}`), {
    params: Promise.resolve({ key }),
  });

test('🔴 /media/photo віддає файл, указаний у полі цього слота', async () => {
  await inWorld({ slot: { src: FILE, alt: 'x' } }, async () => {
    const res = await get('route-hero');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...PNG]);
  });
});

test('🔴 ключ не з переліку — 404 без жодного запиту', async () => {
  await inWorld({ slot: { src: FILE, alt: 'x' } }, async () => {
    for (const key of ['camping', 'ROUTE-HERO', '../route-hero', 'si', '']) {
      const res = await get(key);
      expect(res.status, key).toBe(404);
    }
    expect(seen).toEqual([]);
  });
});

test('слот без файла Directus (шлях від кореня) — 404, статику віддає public/', async () => {
  await inWorld({ slot: { src: '/banners/lake.webp', alt: 'x' } }, async () => {
    expect((await get('route-hero')).status).toBe(404);
  });
});

// ── 4. перелік дзеркалить API ────────────────────────────────────────────

test('🔴 перелік слотів у вебі дорівнює переліку в API і в міграції', () => {
  const api = readFileSync(
    join(__dirname, '..', '..', '..', 'api', 'src', 'pages', 'photo-slots.ts'),
    'utf8',
  );
  const apiKeys = [...api.matchAll(/key:\s*'([a-z-]+)'/g)].map((m) => m[1]);
  expect(apiKeys.length).toBeGreaterThan(0);
  expect([...PHOTO_SLOT_KEYS].sort()).toEqual([...apiKeys].sort());
});
