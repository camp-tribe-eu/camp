import { expect, test, type APIRequestContext } from '@playwright/test';
import { DEFAULT_LOCALE, LOCALES } from '@/lib/i18n';

// CAMP-40 — the language declarations, in the pages that are actually
// built rather than in the function that generates them.
//
// 🔴 The test that matters most is "no hreflang points at a 404". That is
// the failure mode this whole design guards against: Google discards an
// entire alternates cluster when one member is dead, so a language
// declared a week before its pages exist silently switches the feature
// off for the languages that do work — and nothing reports it.
//
// 🔴 Read over `request`, not by driving a browser, and that is a
// correctness point before it is a speed one: hreflang and canonical are
// consumed by crawlers parsing raw HTML, so the raw response IS the
// subject. The first version navigated a browser through six pages per
// test and timed out on WebKit under CI load — nine navigations against a
// 30-second budget. It was testing the right thing through the wrong
// instrument.
//
// Fixtures are resolved from the API, the way the rest of this suite does
// it, so the tests never name a slug that a re-import could remove.

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';

/** One real path of each shape the site builds. */
async function pageTypes(request: APIRequestContext): Promise<string[]> {
  const res = await request.get(`${API}/spots/index`);
  expect(res.ok(), 'the API did not answer /spots/index').toBe(true);
  const spots: { country: string; region: string; slug: string }[] =
    await res.json();
  const spot = spots[0];
  expect(spot, 'the fixture holds no campsites').toBeTruthy();

  return [
    '/',
    '/camping',
    '/map',
    `/camping/${spot.country}`,
    `/camping/${spot.country}/${spot.region}`,
    `/camping/${spot.country}/${spot.region}/${spot.slug}`,
    // 🔴 /legal/* joins this list with CAMP-56, not before: a page that
    // does not exist yet would make this test fail for the right reason
    // at the wrong time.
  ];
}

/** Every `<link rel="alternate" hreflang=…>` in a document. */
function alternatesIn(html: string): { hreflang: string; href: string }[] {
  const out: { hreflang: string; href: string }[] = [];
  // Next renders the attribute as `hrefLang`; HTML attribute names are
  // case-insensitive, so the match is too.
  for (const tag of html.match(/<link[^>]*rel="alternate"[^>]*>/gi) ?? []) {
    const lang = /hreflang="([^"]+)"/i.exec(tag)?.[1];
    const href = /href="([^"]+)"/i.exec(tag)?.[1];
    if (lang && href) out.push({ hreflang: lang, href });
  }
  return out;
}

const canonicalIn = (html: string) =>
  /<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i.exec(html)?.[1];

test.describe('hreflang', () => {
  test('every page type declares itself and an x-default', async ({
    request,
  }) => {
    for (const path of await pageTypes(request)) {
      const html = await (await request.get(path)).text();
      const codes = alternatesIn(html).map((a) => a.hreflang);

      expect(codes, `${path} declares no alternates`).toContain(DEFAULT_LOCALE);
      expect(codes, `${path} has no x-default`).toContain('x-default');
    }
  });

  test('the hrefs are absolute, as the spec requires', async ({ request }) => {
    const html = await (await request.get('/camping')).text();
    const hrefs = alternatesIn(html).map((a) => a.href);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href, 'a relative hreflang is ignored by Google').toMatch(
        /^https?:\/\//,
      );
    }
  });

  // 🔴 The one that protects the others.
  test('no hreflang points at a page that does not exist', async ({
    request,
  }) => {
    for (const path of await pageTypes(request)) {
      const html = await (await request.get(path)).text();
      for (const { href } of alternatesIn(html)) {
        // Only the path matters: the declared host is the production
        // domain, while the test server is localhost.
        const target = new URL(href).pathname;
        const res = await request.get(target);
        expect(
          res.status(),
          `${path} declares an alternate at ${target}, which answers ${res.status()}`,
        ).toBeLessThan(400);
      }
    }
  });

  test('x-default and the canonical describe the same page', async ({
    request,
  }) => {
    for (const path of await pageTypes(request)) {
      const html = await (await request.get(path)).text();
      const xDefault = alternatesIn(html).find(
        (a) => a.hreflang === 'x-default',
      )?.href;
      expect(xDefault, `${path} has no x-default`).toBeTruthy();
      expect(canonicalIn(html), `${path}: x-default and canonical disagree`).toBe(
        xDefault,
      );
    }
  });

  // A language is declared only once its pages exist — the rule the
  // registry encodes. Checked against the built site so a premature
  // `live: true` cannot reach production unnoticed.
  test('declares nothing for a language we do not serve yet', async ({
    request,
  }) => {
    const html = await (await request.get('/camping')).text();
    const codes = alternatesIn(html).map((a) => a.hreflang);
    for (const l of LOCALES.filter((x) => !x.live)) {
      expect(codes, `${l.code} is declared but has no pages`).not.toContain(
        l.code,
      );
    }
  });
});

test.describe('the document says what language it is in', () => {
  test('html lang matches the language we declare', async ({ request }) => {
    const html = await (await request.get('/')).text();
    expect(/<html[^>]*\slang="([^"]+)"/i.exec(html)?.[1]).toBe(DEFAULT_LOCALE);
  });
});

test.describe('the sitemap is ready for a second language', () => {
  test('declares the xhtml namespace before it needs it', async ({
    request,
  }) => {
    const res = await request.get('/sitemaps/hubs.xml');
    expect(res.ok()).toBe(true);
    // Declared from the start, so the day a language goes live nothing
    // about the file's shape has to be re-validated.
    expect(await res.text()).toContain(
      'xmlns:xhtml="http://www.w3.org/1999/xhtml"',
    );
  });
});
