// CAMP-40: the URL shape for other languages, decided now rather than
// after thousands of pages are indexed.
//
// 🔴 THE DECISION, and why it is this one.
//
// English stays where it is — `/camping/hr/istria/...` — and every other
// language gets a prefix: `/nl/camping/hr/istria/...`.
//
// The alternative, moving English under `/en/`, is the one that cannot be
// taken back cheaply. We already publish 1256 URLs and the whole crawl
// path from CAMP-71 runs through them; relocating all of them buys a
// tidier scheme and costs 1256 redirects plus the ranking they carry.
// Google treats an unprefixed default with prefixed alternates as
// completely ordinary, so there is nothing to win.
//
// Deciding it today is the entire point of the card: the expensive part
// of i18n is never the second language, it is retrofitting the first.
//
// 🔴 A locale appears in hreflang only when its pages EXIST.
//
// This is the rule the file is built around. An `hreflang="nl"` pointing
// at a URL that 404s does not merely waste a line — Google discards the
// whole alternates cluster, so one dead language takes the working ones
// with it. So `live: false` is not a to-do marker, it is a promise that
// nothing claims to exist before it does, and flipping it is what makes
// a language appear everywhere at once.
//
// Translations themselves are a separate card. This file is the shape
// they will land in.

export interface Locale {
  /** BCP 47 language subtag — what goes in `hreflang` and `<html lang>`. */
  code: string;
  /** What a reader would call it, in its own language. */
  label: string;
  /**
   * Whether pages exist in this language today. Nothing is emitted for a
   * locale that is false — see the note above.
   */
  live: boolean;
  /** Why it is on the list at all, so the order is not folklore. */
  market: string;
}

/**
 * The order is the market order from the research (NL → FR → ES → IT →
 * CH), kept here so that adding the next language is reading a list
 * rather than remembering a conversation.
 *
 * Switzerland is `de` because that is the language, not the country —
 * hreflang takes a language, optionally with a region. When we genuinely
 * serve Switzerland differently from Germany, that becomes `de-CH` and
 * this is the line that changes.
 */
export const LOCALES: Locale[] = [
  { code: 'en', label: 'English', live: true, market: 'default' },
  { code: 'nl', label: 'Nederlands', live: false, market: 'Netherlands' },
  { code: 'fr', label: 'Français', live: false, market: 'France' },
  { code: 'es', label: 'Español', live: false, market: 'Spain' },
  { code: 'it', label: 'Italiano', live: false, market: 'Italy' },
  { code: 'de', label: 'Deutsch', live: false, market: 'Switzerland, Germany' },
];

/** The language served without a prefix. Also the `x-default`. */
export const DEFAULT_LOCALE = 'en';

export const liveLocales = (): Locale[] => LOCALES.filter((l) => l.live);

export function isKnownLocale(code: string): boolean {
  return LOCALES.some((l) => l.code === code);
}

/**
 * Where a page lives in a given language.
 *
 * The default locale returns the path unchanged — that is the decision
 * at the top of this file, expressed once so nothing else has to know
 * about it.
 */
export function localePath(path: string, locale: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return clean;
  // `/` must become `/nl`, not `/nl/`, or the canonical and the alternate
  // disagree about the same page by one character.
  return clean === '/' ? `/${locale}` : `/${locale}${clean}`;
}

/** Splits `/nl/camping/hr` into its locale and the path without it. */
export function readLocale(path: string): { locale: string; rest: string } {
  const m = /^\/([a-z]{2}(?:-[A-Z]{2})?)(\/.*)?$/.exec(path);
  if (m && isKnownLocale(m[1]) && m[1] !== DEFAULT_LOCALE) {
    return { locale: m[1], rest: m[2] ?? '/' };
  }
  return { locale: DEFAULT_LOCALE, rest: path || '/' };
}

export interface Alternates {
  canonical: string;
  /**
   * Keyed by hreflang value, as Next's Metadata wants it. Includes
   * `x-default`, which is not a language — it is the page to send a
   * reader whose language we do not serve.
   */
  languages: Record<string, string>;
}

/**
 * The alternates for one page, in every language that has one.
 *
 * 🔴 Self-referencing on purpose. A page must list ITSELF among its
 * alternates; a cluster where the pages do not all point at each other,
 * themselves included, is one Google ignores. With one live language
 * that looks redundant — `en` and `x-default` both pointing here — and
 * it is exactly what makes the second language cost nothing.
 *
 * @param path the page's path in the default language, e.g. `/camping/hr`
 */
export function alternatesFor(path: string): Alternates {
  const languages: Record<string, string> = {};
  for (const l of liveLocales()) {
    languages[l.code] = localePath(path, l.code);
  }
  languages['x-default'] = localePath(path, DEFAULT_LOCALE);
  return { canonical: path, languages };
}

/** Absolute alternates, for the sitemap and JSON-LD, which need full URLs. */
export function absoluteAlternates(
  path: string,
  site: string,
): { hreflang: string; href: string }[] {
  const { languages } = alternatesFor(path);
  return Object.entries(languages).map(([hreflang, p]) => ({
    hreflang,
    href: `${site}${p}`,
  }));
}
