import { apiFetch, countryName } from './api';
import { pageContent } from './page-content';
import { EMPTY_HUB_QUERY, hubHref } from './hub-filters';
import type { SectionView } from './page-content';
import { substitute } from './rich-text';
import { isUnpublishedCountry } from './unpublished-countries';

// CAMP-525: /camping/winter — the figures, the words, and the one place the
// two meet.
//
// 🔴 THE FIGURES ARE THE API'S (apps/api/src/spots/winter.ts), THE WORDS ARE
// THE CMS'S (page `winter`, migration WinterPageText). Nothing readable is
// typed here: a sentence is a CMS template with `{{key}}` holes and this
// file fills each hole with a number the API counted. A template that names
// a key this file does not hand over THROWS (`substitute`), so a typo in the
// CMS is a failed build and not «{{yes}}» on the page.
//
// 🔴 THE PAGE NEVER HOLDS A CAMPSITE. The payload has counts, and for the
// regions worth a link a region name and slug. A campsite whose winter
// record is not a sourced yes cannot appear, because there is no campsite
// field to put it in — the card's check by construction, and the DB spec
// asserts the numbers beside it.
//
// 🔴 ONE BAD ROW COSTS ONE ROW. A country the page cannot read (code not two
// letters, a count that is not a count, known above spots) is dropped and the
// others stay.

export const WINTER_PAGE = 'winter';
export const WINTER_PATH = '/camping/winter';

export const SERVICE_KEYS = ['water', 'dump', 'gas'] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

export interface WinterRegion {
  region: string;
  slug: string;
  spots: number;
  known: number;
  yes: number;
}

export interface WinterCountry {
  country: string;
  spots: number;
  known: number;
  yes: number;
  regions: WinterRegion[];
  withinRadius: Record<ServiceKey, number>;
}

export interface WinterData {
  radiusM: number;
  readAt: string | null;
  countries: WinterCountry[];
}

const isCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

const isText = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== '';

function readRegion(raw: unknown, yesOfCountry: number): WinterRegion | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isText(r.region) || !isText(r.slug) || !/^[a-z0-9-]+$/.test(r.slug)) return null;
  if (!isCount(r.spots) || !isCount(r.known) || !isCount(r.yes)) return null;
  if (r.yes < 1 || r.yes > r.known || r.known > r.spots || r.yes > yesOfCountry) return null;
  return { region: r.region, slug: r.slug, spots: r.spots, known: r.known, yes: r.yes };
}

function readCountry(raw: unknown): WinterCountry | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.country !== 'string' || !/^[a-z]{2}$/.test(c.country)) return null;
  if (isUnpublishedCountry(c.country)) return null;
  if (!isCount(c.spots) || !isCount(c.known) || !isCount(c.yes)) return null;
  if (c.yes > c.known || c.known > c.spots) return null;
  const w = c.withinRadius as Record<string, unknown> | null | undefined;
  if (!w || typeof w !== 'object') return null;
  const within = {} as Record<ServiceKey, number>;
  for (const k of SERVICE_KEYS) {
    const v = w[k];
    // More campsites with a tap nearby than campsites there are is not a count.
    if (!isCount(v) || v > c.yes) return null;
    within[k] = v;
  }
  const regions = Array.isArray(c.regions)
    ? c.regions
        .map((r) => readRegion(r, c.yes as number))
        .filter((r): r is WinterRegion => r !== null)
    : [];
  return {
    country: c.country,
    spots: c.spots,
    known: c.known,
    yes: c.yes,
    regions,
    withinRadius: within,
  };
}

/** The payload as the page may use it, or `null` when it is not one. */
export function readWinter(raw: unknown): WinterData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!isCount(o.radiusM) || o.radiusM === 0 || !Array.isArray(o.countries)) return null;
  const countries = o.countries
    .map(readCountry)
    .filter((c): c is WinterCountry => c !== null);
  const readAt =
    typeof o.readAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.readAt) ? o.readAt : null;
  return { radiusM: o.radiusM, readAt, countries };
}

/**
 * The winter figures, or `null` when the API has no such route (it deploys
 * separately) or answers with something else: the page then says there is
 * nothing recorded, never a table of zeros.
 */
export async function getWinter(): Promise<WinterData | null> {
  const res = await apiFetch('/spots/winter', { next: { revalidate: 86400 } });
  if (!res.ok) return null;
  return readWinter(await res.json());
}

// ── the words ─────────────────────────────────────────────────────────────

export interface WinterText {
  intro: string;
  countriesHeading: string;
  countries: string;
  countryCard: string;
  regionLink: string;
  none: string;
  empty: string;
  pain: { heading: string; body: string };
  services: Record<ServiceKey, { heading: string; body: string }>;
  figure: string;
  method: string;
  asOf: string | null;
}

const bySlot = (sections: SectionView[], slot: string): SectionView | null => {
  const found = sections.filter((s) => s.slot === slot);
  return found.length === 1 ? found[0] : null;
};

/**
 * The page's words, or `null` when a required slot is missing, duplicated or
 * blank. A page without its words is not drawn: a table of figures with no
 * caveat is the half the card forbids.
 */
export function winterText(sections: SectionView[] | null | undefined): WinterText | null {
  if (!sections) return null;
  const body = (slot: string) => {
    const v = bySlot(sections, slot)?.body;
    return isText(v) ? v : null;
  };
  const head = (slot: string) => {
    const v = bySlot(sections, slot)?.heading;
    return isText(v) ? v : null;
  };
  const intro = body('intro');
  const countries = body('countries');
  const countriesHeading = head('countries');
  const countryCard = body('country-card');
  const regionLink = body('region-link');
  const none = body('none');
  const empty = body('empty');
  const painHeading = head('pain');
  const painBody = body('pain');
  const figure = body('figure');
  const method = body('method');
  if (
    !intro || !countries || !countriesHeading || !countryCard || !regionLink || !none || !empty ||
    !painHeading || !painBody || !figure || !method
  ) {
    return null;
  }
  const services = {} as WinterText['services'];
  for (const k of SERVICE_KEYS) {
    const h = head(k);
    const b = body(k);
    if (!h || !b) return null;
    services[k] = { heading: h, body: b };
  }
  return {
    intro,
    countriesHeading,
    countries,
    countryCard,
    regionLink,
    none,
    empty,
    pain: { heading: painHeading, body: painBody },
    services,
    figure,
    method,
    asOf: body('as-of'),
  };
}

// ── the view ──────────────────────────────────────────────────────────────

const n = (v: number) => v.toLocaleString('en-GB');

export interface WinterRegionLink {
  label: string;
  href: string;
}

export interface WinterCountryRow {
  country: string;
  name: string;
  /** The country hub, when the site has one. */
  href: string | null;
  card: string;
  regions: WinterRegionLink[];
}

export interface WinterServiceBlock {
  key: ServiceKey;
  heading: string;
  body: string;
  rows: { country: string; name: string; text: string }[];
}

export interface WinterView {
  intro: string;
  countriesHeading: string;
  /** `null` when no country has a campsite recorded as open in winter. */
  lead: string | null;
  empty: string | null;
  rows: WinterCountryRow[];
  none: string | null;
  pain: { heading: string; body: string } | null;
  services: WinterServiceBlock[];
  method: string | null;
  asOf: string | null;
}

/** The one canonical address of a region hub with the winter filter on. */
export function winterHubHref(country: string, regionSlug: string): string {
  return hubHref(`/camping/${country}/${regionSlug}`, {
    ...EMPTY_HUB_QUERY,
    styles: ['winter'],
  });
}

/**
 * Everything the page prints, built from the figures and the words.
 *
 * 🔴 ONLY COUNTRIES WITH `yes > 0` GET A ROW. A country with a record for
 * some campsites and none of them open in winter is not a winter country,
 * and a row reading «0 open in winter» would be the empty card the project
 * does not draw. Those countries are named once, in `none`, with their
 * count against the number of countries — so the reader learns the gap
 * instead of finding a shorter list.
 */
export function winterView(
  data: WinterData | null,
  text: WinterText,
  hubs: ReadonlySet<string>,
): WinterView {
  const open = (data?.countries ?? []).filter((c) => c.yes > 0);
  const closed = (data?.countries ?? []).filter((c) => c.yes === 0);
  const nameOf = (c: WinterCountry) => countryName(c.country);
  const sorted = [...open].sort(
    (a, b) => b.yes - a.yes || nameOf(a).localeCompare(nameOf(b)),
  );

  if (!data || open.length === 0) {
    return {
      intro: text.intro,
      countriesHeading: text.countriesHeading,
      lead: null,
      empty: text.empty,
      rows: [],
      none: null,
      pain: null,
      services: [],
      method: null,
      asOf: null,
    };
  }

  const sum = (f: (c: WinterCountry) => number) => data.countries.reduce((t, c) => t + f(c), 0);
  const km = n(Math.round(data.radiusM / 1000));

  const rows = sorted.map((c): WinterCountryRow => ({
    country: c.country,
    name: nameOf(c),
    href: hubs.has(c.country) ? `/camping/${c.country}` : null,
    card: substitute(text.countryCard, {
      yes: n(c.yes),
      known: n(c.known),
      total: n(c.spots),
    }),
    regions: c.regions.map((r) => ({
      label: substitute(text.regionLink, {
        region: r.region,
        yes: n(r.yes),
        spots: n(r.spots),
      }),
      href: winterHubHref(c.country, r.slug),
    })),
  }));

  const services = SERVICE_KEYS.map((key): WinterServiceBlock => ({
    key,
    heading: text.services[key].heading,
    body: text.services[key].body,
    rows: sorted.map((c) => ({
      country: c.country,
      name: nameOf(c),
      text: substitute(text.figure, {
        count: n(c.withinRadius[key]),
        total: n(c.yes),
        km,
      }),
    })),
  }));

  return {
    intro: text.intro,
    countriesHeading: text.countriesHeading,
    lead: substitute(text.countries, {
      yes: n(sum((c) => c.yes)),
      known: n(sum((c) => c.known)),
      total: n(sum((c) => c.spots)),
      countries: n(open.length),
    }),
    empty: null,
    rows,
    none:
      closed.length === 0
        ? null
        : substitute(text.none, {
            count: n(closed.length),
            countries: n(data.countries.length),
            names: closed
              .map(nameOf)
              .sort((a, b) => a.localeCompare(b))
              .join(', '),
          }),
    pain: text.pain,
    services,
    method: substitute(text.method, { km }),
    asOf: data.readAt && text.asOf ? substitute(text.asOf, { readAt: data.readAt }) : null,
  };
}

// ── the sitemap ───────────────────────────────────────────────────────────

/** What `hubUrls` needs of an entry; the shape is `SitemapUrl`'s. */
export interface WinterSitemapEntry {
  path: string;
  lastmod?: string;
}

/**
 * The page's sitemap entry, or `null`.
 *
 * 🔴 AN ENTRY ONLY FOR A PAGE THAT SAYS SOMETHING AND MAY BE INDEXED. No CMS
 * page, a page missing a slot, a page marked `noindex` or no country with a
 * recorded winter campsite → no entry: the sitemap must not call a crawler to
 * the sentence «nothing recorded yet» (the blog's rule, sitemap.ts), nor
 * contradict a `noindex` the editor set. A failing source reads as «no
 * entry» too — the page is then simply absent from this build's sitemap, not
 * a failed sitemap.
 *
 * `lastmod` is the day of the last import that saw the counted campsites,
 * never the build date.
 */
export async function winterSitemapEntry(): Promise<WinterSitemapEntry | null> {
  const [page, data] = await Promise.all([
    pageContent(WINTER_PAGE).catch(() => null),
    getWinter().catch(() => null),
  ]);
  if (!page || page.noindex || !winterText(page.sections)) return null;
  if (!data || !data.countries.some((c) => c.yes > 0)) return null;
  return { path: WINTER_PATH, ...(data.readAt ? { lastmod: data.readAt } : {}) };
}
