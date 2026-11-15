import { expect, test } from '@playwright/test';
import RegionListing from '@/components/region-listing';
import { hubHref, parseHubQuery } from '@/lib/hub-filters';
import { renderAsyncComponent } from './render-component';
import { decodeEntities, visibleText } from './rendered-text';

// CAMP-520 — travel styles on the region hub, as the HTML a reader is served.
//
// 🔴 THE EVIDENCE IS NOT MADE OF THE THING MEASURED. The API and the CMS
// below are stubs written in THIS file. The rows carry their styles in a
// field of this file's own (`winter`), the stub filters them with its own
// `if`, and the counts beside the chips are written by hand from the rows.
// The words come from a stub CMS page whose headings are deliberately NOT
// the ones the migration seeds — so a label that survives into the HTML
// came through the CMS path and not from a constant in the code.
//
// 🔴 Every assertion reads `visibleText` of the rendered page or an `href`
// in it — never a constant, a class, a data attribute or an `sr-only`.

const COUNTRY = 'si';
const REGION = 'winterland';
const BASE = `/camping/${COUNTRY}/${REGION}`;

/**
 * Twenty rows, every number below a hand count:
 *    4 open in winter, with a source      (yes-1 … yes-4, all `paid`)
 *    2 recorded as closed in winter       (no-1, no-2)
 *   14 with no record                     (blank-1 … blank-14)
 * Known 6 of 20. One row is `wild` and it is a blank one.
 */
interface Row {
  slug: string;
  type: 'paid' | 'free' | 'wild';
  winter: 'yes' | 'no' | null;
}
const ROWS: Row[] = [
  ...[1, 2, 3, 4].map((i): Row => ({ slug: `yes-${i}`, type: 'paid', winter: 'yes' })),
  ...[1, 2].map((i): Row => ({ slug: `no-${i}`, type: 'free', winter: 'no' })),
  ...Array.from({ length: 14 }, (_, i): Row => ({
    slug: `blank-${i + 1}`,
    type: i === 0 ? 'wild' : 'free',
    winter: null,
  })),
];
expect(ROWS).toHaveLength(20);

const WINTER_LABEL = 'Stays open through winter';
const ADULTS_LABEL = 'Grown-ups only';
const GROUP_LABEL = 'How you travel';

interface Cms {
  /** `null`: the CMS has no such page (404). */
  sections: { slot: string; heading: string | null; body: string | null }[] | null;
}
const CMS_FULL: Cms = {
  sections: [
    { slot: 'group', heading: GROUP_LABEL, body: null },
    { slot: 'style-winter', heading: WINTER_LABEL, body: null },
    { slot: 'style-adults-only', heading: ADULTS_LABEL, body: null },
    {
      slot: 'coverage',
      heading: 'Coverage',
      body: '{{label}} — written down for {{known}} of the {{total}} sites here; the rest are left out.',
    },
    { slot: 'map-note', heading: 'Map', body: 'The map ignores travel styles.' },
  ],
};

type Facet = { toggled: number; known: number; yes: number; offered: boolean };
interface Api {
  /** Hand-written per query; `undefined` → an API from before the card. */
  styles?: (on: boolean, types: string[]) => Record<string, Facet | undefined>;
}
/** Hand counts from the twenty rows. */
const API_FULL: Api = {
  styles: (on, types) => ({
    // off → click adds winter: the 4 yes rows (0 of them wild);
    // on  → click removes it: all 20 (1 of them wild).
    winter: {
      toggled: types.includes('wild') ? (on ? 1 : 0) : on ? 20 : 4,
      known: 6,
      yes: 4,
      offered: true,
    },
    adultsOnly: { toggled: 0, known: 0, yes: 0, offered: false },
  }),
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const asked: string[] = [];
function stub(raw: string, api: Api, cms: Cms): Response {
  const url = new URL(raw);
  asked.push(url.pathname + url.search);
  if (url.pathname === `/spots/${COUNTRY}/regions`) {
    return json([
      { region: 'Winterland', slug: REGION, spots: ROWS.length, indexable: true },
      // A neighbour, so the card list is followed by the section `cardLinks` ends on.
      { region: 'Otherland', slug: 'otherland', spots: 4, indexable: false },
    ]);
  }
  if (url.pathname === '/pages/travel-styles') {
    if (!cms.sections) return new Response('not found', { status: 404 });
    return json({
      slug: 'travel-styles',
      title: 'Travel style',
      metaTitle: null,
      metaDescription: null,
      noindex: true,
      sections: cms.sections.map((s) => ({
        type: 'prose',
        variant: null,
        subheading: null,
        imageUrl: null,
        imageAlt: null,
        ctaHref: null,
        ctaLabel: null,
        items: [],
        ...s,
      })),
    });
  }
  if (url.pathname === `/spots/${COUNTRY}/${REGION}`) {
    const split = (v: string | null) => (v ? v.split(',') : []);
    const types = split(url.searchParams.get('types'));
    const styles = split(url.searchParams.get('styles'));
    const on = styles.includes('winter');
    // The stub's own filter: a recorded yes, nothing else.
    const matched = ROWS.filter(
      (r) => (types.length === 0 || types.includes(r.type)) && (!on || r.winter === 'yes'),
    );
    const dropOne = [
      ...(types.includes('wild') && on ? [{ kind: 'type', key: 'wild', matched: 4 }] : []),
      ...(on ? [{ kind: 'style', key: 'winter', matched: types.includes('wild') ? 1 : 20 }] : []),
    ];
    return json({
      region: 'Winterland',
      total: ROWS.length,
      matched: matched.length,
      unknownExcluded: 0,
      items: matched.slice(0, 24).map((r) => ({
        slug: r.slug,
        name: r.slug,
        country: 'SI',
        region: 'Winterland',
        type: r.type,
        amenities: {},
      })),
      facets: {
        types: {},
        amenities: {},
        ...(api.styles ? { styles: api.styles(on, types) } : {}),
      },
      dropOne,
      sort: 'name',
    });
  }
  return new Response('not found', { status: 404 });
}

async function render(
  searchParams: Record<string, string>,
  { api = API_FULL, cms = CMS_FULL }: { api?: Api; cms?: Cms } = {},
): Promise<string> {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string) =>
    Promise.resolve().then(() => stub(String(url), api, cms))) as typeof fetch;
  asked.length = 0;
  try {
    return await renderAsyncComponent(RegionListing, {
      country: COUNTRY,
      region: REGION,
      page: 1,
      searchParams,
    });
  } finally {
    globalThis.fetch = real;
  }
}

const links = (html: string) =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: decodeEntities(m[1]),
    rel: /\brel="([^"]+)"/.exec(m[0])?.[1],
    text: visibleText(m[2]),
  }));

function cardLinks(html: string): string[] {
  const main = html.slice(html.indexOf('<main'));
  const list = /<ul class="ct-cards[^"]*">([\s\S]*?)<\/ul>\s*(?:<nav|<section)/.exec(main);
  return list ? links(list[1]).map((l) => l.href) : [];
}

// ── the chip, its number and its caveat ───────────────────────────────────

test('🔴 the hub offers the style the region has records for — named by the CMS, counted by the API, with its coverage', async () => {
  const html = await render({});
  const text = visibleText(html);

  expect(text).toContain(GROUP_LABEL);
  // The caveat, with the region's own numbers in the CMS's own sentence.
  expect(text).toContain(
    `${WINTER_LABEL} — written down for 6 of the 20 sites here; the rest are left out.`,
  );
  // The chip: a plain link into the filtered address, with the click's count.
  const chip = links(html).filter((l) => l.text.startsWith(WINTER_LABEL));
  expect(chip).toEqual([
    { href: `${BASE}/filter?styles=winter`, rel: 'nofollow', text: `${WINTER_LABEL} 4` },
  ]);
  // No placeholder reached the reader.
  expect(text).not.toContain('{{');
});

test('🔴 a style with no coverage in the region is not offered: no chip, no sentence, no word of it', async () => {
  const text = visibleText(await render({}));
  // The CMS names «Grown-ups only» and the API counts 0 known → not drawn.
  expect(text).not.toContain(ADULTS_LABEL);
});

test('🔴 below the floor (`offered: false`) the whole group is gone', async () => {
  const thin: Api = {
    styles: () => ({
      winter: { toggled: 1, known: 1, yes: 1, offered: false },
      adultsOnly: { toggled: 0, known: 0, yes: 0, offered: false },
    }),
  };
  const text = visibleText(await render({}, { api: thin }));
  expect(text).not.toContain(WINTER_LABEL);
  expect(text).not.toContain(GROUP_LABEL);
  // The hub itself is intact.
  expect(text).toContain('20 sites in Winterland');
});

// ── the filter ────────────────────────────────────────────────────────────

test('🔴 styles=winter lists the four recorded sites and nothing else, and asks the API for exactly that', async () => {
  const html = await render({ styles: 'winter' });
  const text = visibleText(html);

  expect(asked).toContain(`/spots/${COUNTRY}/${REGION}?page=1&styles=winter`);
  expect(text).toContain('4 sites match');
  expect(cardLinks(html).sort()).toEqual([1, 2, 3, 4].map((i) => `${BASE}/yes-${i}`));
  // Neither a recorded no nor a blank is on the page as a card.
  expect(cardLinks(html).join(' ')).not.toMatch(/no-|blank-/);

  // The style is a pill that removes itself, and the chip now unticks.
  const bar = /<nav aria-label="Sort and current filters"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  expect(links(bar).filter((l) => l.text === WINTER_LABEL)).toEqual([
    { href: BASE, rel: undefined, text: WINTER_LABEL },
  ]);
  expect(visibleText(bar)).toContain('Filters (1)');
  // The ticked chip's number predicts ITS click: unticking gives all 20.
  const panel = /<nav aria-label="Filter campsites"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  expect(links(panel).filter((l) => l.text.startsWith(WINTER_LABEL))).toEqual([
    { href: BASE, rel: undefined, text: `${WINTER_LABEL} 20` },
  ]);
  // No offer to "include the unrecorded": a style is never guessed.
  expect(text).not.toContain('include them');
  expect(text).not.toContain('more where nobody recorded');
  // The map beside the list does not apply the style, and the page says so.
  expect(text).toContain('The map ignores travel styles.');
  // …and only then: the plain hub does not carry the note.
  expect(visibleText(await render({}))).not.toContain('The map ignores travel styles.');
});

test('a style combines with a type, and an empty combination names the style by the CMS’s word', async () => {
  // The one wild row has no record → wild + winter is empty.
  const html = await render({ types: 'wild', styles: 'winter' });
  const text = visibleText(html);
  expect(asked).toContain(`/spots/${COUNTRY}/${REGION}?page=1&types=wild&styles=winter`);
  expect(text).toContain('0 sites match');
  expect(text).toContain('Nothing matches all 2 filters');
  expect(text).toContain(`No wild camping spot in Winterland is recorded with “${WINTER_LABEL}”`);
  // Dropping the type brings 4 back, dropping the style brings 1: the type wins.
  expect(text).toContain('Drop “Wild camping” and 4 sites come back');
  expect(cardLinks(html)).toEqual([]);
});

// ── nothing is drawn that cannot be named or counted ──────────────────────

test('🔴 no CMS page: the hub renders without the group — and a style in the address is a 404, not an unfiltered list', async () => {
  const none: Cms = { sections: null };
  const text = visibleText(await render({}, { cms: none }));
  expect(text).toContain('20 sites in Winterland');
  expect(text).not.toContain(GROUP_LABEL);
  expect(text).not.toContain(WINTER_LABEL);
  await expect(render({ styles: 'winter' }, { cms: none })).rejects.toThrow(/404|NOT_FOUND/);
});

test('🔴 a CMS page without the coverage sentence draws no chip: the filter never appears without its caveat', async () => {
  const noCaveat: Cms = {
    sections: (CMS_FULL.sections ?? []).filter((s) => s.slot !== 'coverage'),
  };
  const text = visibleText(await render({}, { cms: noCaveat }));
  expect(text).not.toContain(WINTER_LABEL);
  expect(text).not.toContain(GROUP_LABEL);
});

test('🔴 an API from before the card (no style counts): no group, and styles= is a 404', async () => {
  const old: Api = {};
  const text = visibleText(await render({}, { api: old }));
  expect(text).not.toContain(WINTER_LABEL);
  await expect(render({ styles: 'winter' }, { api: old })).rejects.toThrow(/404|NOT_FOUND/);
});

test('counts that contradict each other draw nothing', async () => {
  const broken: Api = {
    styles: () => ({
      // More known than there are sites in the region.
      winter: { toggled: 4, known: 21, yes: 4, offered: true },
      adultsOnly: undefined,
    }),
  };
  expect(visibleText(await render({}, { api: broken }))).not.toContain(WINTER_LABEL);
});

// ── the address ───────────────────────────────────────────────────────────

test('only styles the code has a rule for survive the address; one state, one URL', () => {
  // «family» and «quiet» have no source that states them (CAMP-520), so
  // they are not keys — a link that names them opens the plain hub.
  const q = parseHubQuery({ styles: 'quiet,winter,family,adultsOnly' });
  expect(q.styles).toEqual(['winter', 'adultsOnly']);
  expect(parseHubQuery({ styles: 'family' }).styles).toEqual([]);
  expect(hubHref(BASE, parseHubQuery({ styles: 'family' }))).toBe(BASE);
  expect(hubHref(BASE, parseHubQuery({ styles: 'adultsOnly,winter', types: 'free' }))).toBe(
    `${BASE}/filter?types=free&styles=winter%2CadultsOnly`,
  );
});
