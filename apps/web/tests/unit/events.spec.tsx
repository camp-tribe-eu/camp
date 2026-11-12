import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import CampsitePage from '@/app/camping/[country]/[region]/[slug]/page';
import {
  filterTokens,
  referrerHost,
  sendSpotEvent,
  sendZeroResult,
  websiteHref,
} from '@/lib/events';
import { CLIENT_ISLANDS } from './client-islands';
import { renderAsyncComponent } from './render-component';

// CAMP-504 — запис подій з боку сторінки.
//
// 🔴 Твердження про сторінку читає HTML, який рендерить СПРАВЖНЯ
// `CampsitePage` (fetch підмінено на готову відповідь API): справжні теги
// `<a>`, а не константа чи клас.

const API = 'https://api.camptribe.test';
const SITE = 'https://camping-events.example/welcome';

const SPOT = {
  slug: 'camping-events-test',
  name: 'Camping Events Test',
  country: 'hr',
  region: 'Istria',
  type: 'paid',
  lat: 45.1,
  lon: 13.9,
  website: SITE,
  contact: { phone: '+385 52 123 456' },
  amenities: {
    electricity: 'yes', water: 'unknown', shower: 'unknown', toilets: 'unknown',
    dogFriendly: 'unknown', wifi: 'unknown', greyWater: 'unknown',
    laundry: 'unknown', wheelchair: 'unknown', wheelchairFull: 'unknown',
  },
  ownerOverrides: {},
  lastSeenAt: '2026-10-12T05:00:00.000Z',
  osmRecordEditedAt: '2023-06-14T10:11:12.000Z',
  missingSince: null,
  context: {},
  description: null,
};

async function pageHtml(env: string | undefined): Promise<string> {
  const real = globalThis.fetch;
  const prev = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (env === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
  else process.env.NEXT_PUBLIC_API_BASE_URL = env;
  globalThis.fetch = ((url: string) =>
    Promise.resolve(
      String(url).includes('/spots/hr/istria/camping-events-test')
        ? new Response(JSON.stringify({ spot: SPOT, nearby: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('{}', { status: 404 }),
    )) as typeof fetch;
  try {
    return await renderAsyncComponent(
      CampsitePage,
      { params: Promise.resolve({ country: 'hr', region: 'istria', slug: 'camping-events-test' }) },
      { omit: CLIENT_ISLANDS },
    );
  } finally {
    globalThis.fetch = real;
    if (prev === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = prev;
  }
}

const anchors = (html: string) =>
  [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);

test.describe('картка кемпінгу, як її віддано', () => {
  test('anchor: сторінка справді рендерить цей кемпінг і його контакти', async () => {
    const html = await pageHtml(API);
    expect(html).toContain('Camping Events Test');
    expect(html).toContain('camping-events.example/welcome');
  });

  test('🔴 посилання на сайт веде через /out/<slug> і не несе чужого URL', async () => {
    const html = await pageHtml(API);
    const site = anchors(html).filter((a) => a.includes('nofollow ugc'));
    expect(site.length).toBe(1);
    expect(site[0]).toContain(`href="${API}/out/camping-events-test"`);
    expect(site[0]).not.toContain('camping-events.example');
    expect(site[0]).not.toMatch(/[?&](url|to|next)=/);
  });

  test('без налаштованого API посилання пряме (нічого не ламається)', async () => {
    const html = await pageHtml(undefined);
    const site = anchors(html).filter((a) => a.includes('nofollow ugc'));
    expect(site[0]).toContain(`href="${SITE}"`);
  });

  test('🔴 телефон несе data-ct-event="phone_click" і лишається tel:', async () => {
    const html = await pageHtml(API);
    const tel = anchors(html).filter((a) => a.includes('href="tel:'));
    expect(tel.length).toBe(1);
    expect(tel[0]).toContain('data-ct-event="phone_click"');
    expect(tel[0]).toContain('href="tel:+38552123456"');
  });
});

test.describe('що йде мережею', () => {
  test('перегляд: рівно три поля — подія, slug, хост', () => {
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    sendSpotEvent('spot_view', 'a-b', 'google.com', API, (url, init) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
    });
    expect(sent).toEqual([
      { url: `${API}/events`, body: { event: 'spot_view', slug: 'a-b', ref: 'google.com' } },
    ]);
  });

  test('без адреси API нічого не надсилається', () => {
    let calls = 0;
    sendSpotEvent('spot_view', 'a', '', '', () => void (calls += 1));
    sendZeroResult('map', [], '', () => void (calls += 1));
    expect(calls).toBe(0);
  });

  test('збій fetch не вибухає', () => {
    expect(() =>
      sendSpotEvent('spot_view', 'a', '', API, () => {
        throw new Error('boom');
      }),
    ).not.toThrow();
  });

  test('реферер → лише хост, без шляху й запиту', () => {
    expect(referrerHost('https://www.google.com/search?q=jane+doe')).toBe('www.google.com');
    expect(referrerHost('')).toBe('');
    expect(referrerHost('%%%')).toBe('');
  });

  test('фільтри карти → токени закритого переліку', () => {
    expect(
      filterTokens({ types: ['free'], amenities: ['shower'], overnight: true, includeUnknown: false }),
    ).toEqual(['type:free', 'amenity:shower', 'overnight']);
  });

  test('websiteHref: лише slug у шляху', () => {
    expect(websiteHref('a-b', SITE, API)).toBe(`${API}/out/a-b`);
    expect(websiteHref('a-b', SITE, '')).toBe(SITE);
  });

  test('події браузера збігаються з API', () => {
    const api = readFileSync(
      join(__dirname, '..', '..', '..', 'api', 'src', 'events', 'events.rules.ts'),
      'utf8',
    );
    const block = /BROWSER_EVENTS: readonly SpotEvent\[\] = \[([\s\S]*?)\]/.exec(api)![1];
    const apiEvents = [...block.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    const web = readFileSync(join(__dirname, '..', '..', 'src', 'lib', 'events.ts'), 'utf8');
    const type = /export type BrowserEvent =([\s\S]*?);/.exec(web)![1];
    const webEvents = [...type.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    expect(webEvents).toEqual(apiEvents);
  });

  test('🔴 нічого не пишеться в браузер: ні cookie, ні сховища', () => {
    for (const f of ['lib/events.ts', 'components/spot-events.tsx']) {
      // Без коментарів: вони згадують ці слова саме щоб сказати «ні».
      const src = readFileSync(join(__dirname, '..', '..', 'src', f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(src).not.toMatch(/document\.cookie|localStorage|sessionStorage|indexedDB|\.setItem\(/);
    }
  });
});
