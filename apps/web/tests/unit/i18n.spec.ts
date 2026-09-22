import { expect, test } from '@playwright/test';
import {
  absoluteAlternates,
  alternatesFor,
  DEFAULT_LOCALE,
  isKnownLocale,
  liveLocales,
  localePath,
  LOCALES,
  readLocale,
} from '../../src/lib/i18n';
import { urlsetXml } from '../../src/lib/sitemap';

// CAMP-40 — the URL shape for other languages.
//
// 🔴 The last describe block is the card's own acceptance criterion:
// "додавання нової локалі не потребує зміни структури". It is checked by
// actually switching one on and watching every derived thing follow,
// which is the only way to know it rather than believe it.

test.describe('where a page lives in each language', () => {
  test('the default language keeps the path it already has', () => {
    // The decision this card exists to make. 1256 URLs are published at
    // these paths; moving them under /en/ would cost that many redirects
    // and buy nothing.
    expect(localePath('/camping/hr/istria', 'en')).toBe('/camping/hr/istria');
    expect(localePath('/', 'en')).toBe('/');
  });

  test('every other language is prefixed', () => {
    expect(localePath('/camping/hr/istria', 'nl')).toBe(
      '/nl/camping/hr/istria',
    );
  });

  // 🔴 `/nl`, not `/nl/`. One trailing character is the difference between
  // the canonical and the alternate describing the same page, and Google
  // treats them as two URLs.
  test('the home page becomes /nl, without a trailing slash', () => {
    expect(localePath('/', 'nl')).toBe('/nl');
  });

  test('tolerates a path given without its leading slash', () => {
    expect(localePath('camping', 'nl')).toBe('/nl/camping');
    expect(localePath('camping', 'en')).toBe('/camping');
  });
});

test.describe('reading a locale back off a path', () => {
  test('finds a prefixed locale and returns the rest', () => {
    expect(readLocale('/nl/camping/hr')).toEqual({
      locale: 'nl',
      rest: '/camping/hr',
    });
    expect(readLocale('/nl')).toEqual({ locale: 'nl', rest: '/' });
  });

  test('an unprefixed path is the default language', () => {
    expect(readLocale('/camping/hr')).toEqual({
      locale: DEFAULT_LOCALE,
      rest: '/camping/hr',
    });
  });

  // 🔴 `hr` is a country in our URLs and a language code in the world.
  // `/camping/hr` must not be read as Croatian; only a segment we have
  // actually declared counts, and only in first position.
  test('does not mistake a country segment for a language', () => {
    expect(readLocale('/camping/hr').locale).toBe(DEFAULT_LOCALE);
    expect(isKnownLocale('hr')).toBe(false);
  });

  test('an undeclared two-letter prefix is left alone', () => {
    expect(readLocale('/zz/camping')).toEqual({
      locale: DEFAULT_LOCALE,
      rest: '/zz/camping',
    });
  });
});

test.describe('the alternates a page declares', () => {
  test('points at itself, which is what makes a cluster valid', () => {
    const a = alternatesFor('/camping/hr');
    expect(a.canonical).toBe('/camping/hr');
    expect(a.languages.en).toBe('/camping/hr');
  });

  test('always names an x-default', () => {
    // Not a language: the page for a reader whose language we do not serve.
    expect(alternatesFor('/camping/hr').languages['x-default']).toBe(
      '/camping/hr',
    );
  });

  // 🔴 The rule the whole file is built around. An hreflang pointing at a
  // URL that does not exist makes Google discard the entire cluster — so
  // one language declared too early takes the working ones down with it.
  test('says nothing about a language whose pages do not exist yet', () => {
    const codes = Object.keys(alternatesFor('/camping/hr').languages);
    for (const l of LOCALES.filter((x) => !x.live)) {
      expect(codes, `${l.code} is not live and must not be declared`).not.toContain(
        l.code,
      );
    }
  });

  test('absolute form is used where full URLs are required', () => {
    const abs = absoluteAlternates('/camping/hr', 'https://camptribe.eu');
    for (const a of abs) {
      expect(a.href.startsWith('https://camptribe.eu/')).toBe(true);
    }
    expect(abs.map((a) => a.hreflang)).toContain('x-default');
  });
});

// ---------------------------------------------------------------------------
// The card's acceptance criterion, exercised rather than asserted
// ---------------------------------------------------------------------------

test.describe('adding a language changes data, not structure', () => {
  /** Switch one on, run the body, switch it back whatever happens. */
  function withLocaleLive(code: string, body: () => void) {
    const entry = LOCALES.find((l) => l.code === code)!;
    const before = entry.live;
    entry.live = true;
    try {
      body();
    } finally {
      entry.live = before;
    }
  }

  test('one flag turns Dutch on everywhere at once', () => {
    expect(liveLocales()).toHaveLength(1);

    withLocaleLive('nl', () => {
      expect(liveLocales()).toHaveLength(2);

      const a = alternatesFor('/camping/hr/istria');
      // The English page did not move…
      expect(a.canonical).toBe('/camping/hr/istria');
      expect(a.languages.en).toBe('/camping/hr/istria');
      expect(a.languages['x-default']).toBe('/camping/hr/istria');
      // …and Dutch appeared beside it, derived, not written down.
      expect(a.languages.nl).toBe('/nl/camping/hr/istria');
    });

    // And it is genuinely reversible — the test leaves nothing behind.
    expect(liveLocales()).toHaveLength(1);
    expect(alternatesFor('/camping/hr').languages.nl).toBeUndefined();
  });

  test('the sitemap grows alternates without being touched', () => {
    const urls = [{ loc: 'https://camptribe.eu/camping/hr' }];

    // With one language, repeating the loc as its own alternate would be
    // 1256 lines of XML saying nothing.
    expect(urlsetXml(urls)).not.toContain('xhtml:link');
    // The namespace is declared regardless, so nothing has to be
    // re-validated the day a language goes live.
    expect(urlsetXml(urls)).toContain('xmlns:xhtml');

    withLocaleLive('nl', () => {
      const xml = urlsetXml(urls);
      expect(xml).toContain('hreflang="en"');
      expect(xml).toContain('hreflang="nl"');
      expect(xml).toContain('hreflang="x-default"');
      expect(xml).toContain('href="https://camptribe.eu/nl/camping/hr"');
    });
  });
});
