import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import CampsitePage from '@/app/camping/[country]/[region]/[slug]/page';
import { TRUST_LABEL, TRUST_STATUSES, trustOf } from '@/lib/trust';
import { renderAsyncComponent } from './render-component';
import { visibleText } from './rendered-text';
import { CLIENT_ISLANDS } from './client-islands';
import {
  TRUST_SECTIONS,
  TRUST_SLUG,
} from '../../../api/src/migrations/1797300000000-TrustStatusText';

// CAMP-521 — Trust Layer. The card's "Спосіб перевірки":
//
//   «жоден показник не рендериться без статусу; мутація — вивести значення
//    зі статусом Imported як "Verified", сторож червоніє».
//
// 🔴 WHAT THIS READS. The campsite page is rendered whole, from a campsite
// as the API returns it, and every figure is found in the DELIVERED HTML.
// For each one the test reads the word a person reads next to it — not the
// `data-trust-status` attribute alone, not a class, not `TRUST_LABEL`.
//
// 🔴 THE EXPECTED WORDS ARE WRITTEN BY HAND BELOW, from the fixture, and
// are NOT computed with `trustOf`. A test that asked the code what the
// answer is would agree with the code about its own bug.
//
// 🔴 WHAT THIS DOES NOT CLAIM. Only the line of key facts and the
// Facilities list carry a status today. The other blocks of the page say
// where their figures come from in sentences of their own, and are listed
// by name in `NOT_YET` at the bottom — a list that may only shrink, and
// that a new block cannot stay out of.

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

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/** A campsite as the API returns it. Only what the page reads. */
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
    toilets: 'no',
    dogFriendly: 'unknown',
    // 🔴 The source says "unknown"; the owner says "yes" (below).
    wifi: 'unknown',
    greyWater: 'unknown',
    laundry: 'unknown',
    wheelchair: 'unknown',
    wheelchairFull: 'unknown',
  },
  ownerOverrides: { amenities: { wifi: 'yes' } },
  lastSeenAt: daysAgo(3),
  osmRecordEditedAt: daysAgo(100),
  missingSince: null,
  context: { town: { name: 'Pula', m: 900 } },
  description: null,
  descriptionLang: null,
  stars: null,
  website: null,
  contact: {},
  sources: [
    {
      id: 'osm',
      ref: 'w1',
      updatedAt: daysAgo(3).slice(0, 10),
      fields: ['name', 'location', 'amenities'],
    },
  ],
  warningAreas: null,
  tariffs: [],
  ...extra,
});

/** The CMS page as the API serves it, from the rows the migration seeds. */
const trustPage = {
  slug: TRUST_SLUG,
  title: 'Data status',
  metaTitle: null,
  metaDescription: null,
  noindex: true,
  sections: TRUST_SECTIONS.map((s) => ({
    type: 'prose',
    variant: null,
    slot: s.slot,
    heading: s.heading,
    subheading: null,
    body: s.body,
    imageUrl: null,
    imageAlt: null,
    ctaHref: null,
    ctaLabel: null,
    items: [],
  })),
};

const PARAMS = { country: 'hr', region: 'istria', slug: 'camping-test' };

async function page(
  extra: Record<string, unknown> = {},
  { cms = true }: { cms?: boolean } = {},
): Promise<string> {
  let html = '';
  await withFetch(
    (url) => {
      if (url.includes('/spots/hr/istria/camping-test'))
        return json({ spot: spot(extra), nearby: [] });
      if (cms && url.includes(`/pages/${TRUST_SLUG}`)) return json(trustPage);
      return json({}, 404);
    },
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

interface Figure {
  kind: 'fact' | 'amenity';
  key: string;
  /** Every status mark inside the figure: its attribute and its WORD. */
  marks: { status: string; word: string }[];
}

/** Every figure in the delivered HTML, with the status words printed in it. */
function figures(html: string): Figure[] {
  const out: Figure[] = [];
  const item = /<li\b([^>]*)>([\s\S]*?)<\/li>/g;
  for (const m of html.matchAll(item)) {
    const fact = /\bdata-fact="([^"]+)"/.exec(m[1]);
    const amenity = /\bdata-amenity="([^"]+)"/.exec(m[1]);
    if (!fact && !amenity) continue;
    const marks = [
      ...m[2].matchAll(/<span\b[^>]*\bdata-trust-status="([^"]+)"[^>]*>([\s\S]*?)<\/span>/g),
    ].map((x) => ({ status: x[1], word: visibleText(x[2]) }));
    out.push({
      kind: fact ? 'fact' : 'amenity',
      key: (fact ?? amenity)![1],
      marks,
    });
  }
  return out;
}

const words = (html: string) =>
  Object.fromEntries(
    figures(html).map((f) => [`${f.kind}:${f.key}`, f.marks.map((x) => x.word).join('|')]),
  );

// ═══ 1. Every figure has a status, and it is the right one ══════════════

test('🔴 жоден показник не віддається без статусу, і слово відповідає походженню', async () => {
  const html = await page();
  // Written by hand from the fixture above.
  expect(words(html)).toEqual({
    'fact:type': 'Imported',
    'fact:town': 'Imported',
    'fact:facilities': 'Imported',
    'amenity:electricity': 'Imported',
    'amenity:water': 'Not recorded',
    'amenity:shower': 'Imported',
    'amenity:toilets': 'Imported',
    'amenity:greyWater': 'Not recorded',
    'amenity:laundry': 'Not recorded',
    'amenity:dogFriendly': 'Not recorded',
    'amenity:wifi': 'Owner confirmed',
    'amenity:wheelchair': 'Not recorded',
    'amenity:wheelchairFull': 'Not recorded',
  });
});

test('🔴 рівно одне слово статусу на показник, і атрибут каже те саме, що слово', async () => {
  const all = figures(await page());
  // Anchor: the selector found the figures at all (3 facts + 10 facilities).
  expect(all.length).toBe(13);
  const label = TRUST_LABEL as Record<string, string>;
  for (const f of all) {
    expect(f.marks.length, `${f.kind}:${f.key}`).toBe(1);
    expect(f.marks[0].word, `${f.kind}:${f.key}`).toBe(label[f.marks[0].status]);
  }
});

test('🔴 статус читається як окреме слово, а не зліплений зі значенням', async () => {
  const html = await page();
  const row = /<li\b[^>]*data-amenity="electricity"[^>]*>[\s\S]*?<\/li>/.exec(html)![0];
  expect(visibleText(row)).toBe('Electricity Yes · Imported');
  const none = /<li\b[^>]*data-amenity="water"[^>]*>[\s\S]*?<\/li>/.exec(html)![0];
  // One "we do not know", said once.
  expect(visibleText(none)).toBe('Drinking water Not recorded');
});

// ═══ 2. The card's mutation: Imported must never read "Verified" ════════

/** The statuses no process of ours can produce today. */
const UNEARNED = ['Verified', 'Recently updated', 'Community reported', 'Conflicting'];

test('🔴 на сторінці з імпортованих даних немає слова «Verified» — ніде', async () => {
  const text = visibleText(await page());
  // Anchor: the text is the page, and it does carry statuses.
  expect(text).toContain('Imported');
  for (const w of UNEARNED) expect(text, w).not.toContain(w);
});

test('🔴 «verified» не можна отримати з імпорту — лише з перевірки з методом і датою', () => {
  const today = new Date('2026-11-13T00:00:00Z');
  expect(trustOf({ kind: 'import', sourceId: 'osm' }, today)).toBe('imported');
  expect(trustOf({ kind: 'derived', sourceId: 'osm' }, today)).toBe('imported');
  expect(trustOf({ kind: 'owner' }, today)).toBe('owner-confirmed');
  expect(trustOf({ kind: 'none' }, today)).toBe('unknown');
  expect(
    trustOf({ kind: 'verification', method: 'site visit', at: '2026-10-12' }, today),
  ).toBe('verified');
  expect(() =>
    trustOf({ kind: 'verification', method: ' ', at: '2026-10-12' }, today),
  ).toThrow(/method and a date/);
  expect(() =>
    trustOf({ kind: 'verification', method: 'site visit', at: 'soon' }, today),
  ).toThrow(/method and a date/);
});

test('словник — рівно вісім статусів картки, у кожного своє слово', () => {
  expect([...TRUST_STATUSES]).toEqual([
    'verified',
    'owner-confirmed',
    'recently-updated',
    'community-reported',
    'imported',
    'conflicting',
    'unknown',
    'outdated',
  ]);
  const labels = TRUST_STATUSES.map((s) => TRUST_LABEL[s]);
  expect(new Set(labels).size).toBe(8);
  expect(TRUST_LABEL.imported).toBe('Imported');
  expect(TRUST_LABEL.verified).toBe('Verified');
});

// ═══ 3. Owner confirmed: only what the owner actually said ══════════════

test('🔴 слово власника стосується лише того поля, яке він назвав', async () => {
  const w = words(await page());
  expect(w['amenity:wifi']).toBe('Owner confirmed');
  // The owner said nothing about electricity; it stays what the source gave.
  expect(w['amenity:electricity']).toBe('Imported');
  // One of three counted facilities is the owner's: the count is not his.
  expect(w['fact:facilities']).toBe('Imported');
});

test('лічильник зручностей — «Owner confirmed» лише коли власник назвав УСЕ пораховане', async () => {
  const html = await page({
    amenities: { ...spot({}).amenities, electricity: 'unknown', shower: 'unknown' },
  });
  const w = words(html);
  expect(w['fact:facilities']).toBe('Owner confirmed');
});

// ═══ 4. Outdated: by the source record's edit date, not by our import ═══

test('🔴 запис, якого в джерелі не правили понад два роки, читається «Outdated»', async () => {
  const w = words(await page({ osmRecordEditedAt: daysAgo(900) }));
  expect(w['amenity:electricity']).toBe('Outdated');
  expect(w['fact:type']).toBe('Outdated');
  // The owner's word and a gap do not age with the source record.
  expect(w['amenity:wifi']).toBe('Owner confirmed');
  expect(w['amenity:water']).toBe('Not recorded');
  // A distance is ours, calculated on the weekly import.
  expect(w['fact:town']).toBe('Imported');
});

test('🔴 дата НАШОГО імпорту не робить запис ані свіжим, ані застарілим', async () => {
  // Our importer looked 900 days ago, a mapper edited 100 days ago: not outdated.
  const old = await page({
    sources: [{ id: 'osm', ref: 'w1', updatedAt: daysAgo(900).slice(0, 10), fields: ['amenities'] }],
  });
  expect(words(old)['amenity:electricity']).toBe('Imported');
  // No edit date at all: we do not know its age, and do not invent one.
  const unknown = await page({ osmRecordEditedAt: null });
  expect(words(unknown)['amenity:electricity']).toBe('Imported');
});

test('межа: 730 днів ще «Imported», 731 — «Outdated»', () => {
  const today = new Date('2026-11-13T12:00:00Z');
  const at = (d: number) => new Date(today.getTime() - d * 86_400_000).toISOString();
  expect(trustOf({ kind: 'import', sourceId: 'osm', recordEditedAt: at(730) }, today)).toBe('imported');
  expect(trustOf({ kind: 'import', sourceId: 'osm', recordEditedAt: at(731) }, today)).toBe('outdated');
});

// ═══ 5. The legend: the words on this page, explained from the CMS ══════

const legend = (html: string): Record<string, string> => {
  const block = /<section\b[^>]*data-testid="trust-legend"[\s\S]*?<\/section>/.exec(html);
  if (!block) return {};
  return Object.fromEntries(
    [...block[0].matchAll(/<div\b[^>]*data-trust-meaning="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g)].map(
      (m) => [m[1], visibleText(m[2])],
    ),
  );
};

test('🔴 легенда пояснює рівно ті статуси, що є на сторінці, текстом із CMS', async () => {
  const rows = legend(await page());
  expect(Object.keys(rows)).toEqual(['owner-confirmed', 'imported', 'unknown']);
  const body = (slot: string) => TRUST_SECTIONS.find((s) => s.slot === slot)!.body!;
  expect(rows.imported).toBe(`Imported — ${body('status-imported')}`);
  expect(rows['owner-confirmed']).toBe(
    `Owner confirmed — ${body('status-owner-confirmed')}`,
  );
});

test('🔴 без CMS легенди немає, а слова на показниках лишаються', async () => {
  const html = await page({}, { cms: false });
  expect(html).not.toContain('data-testid="trust-legend"');
  expect(words(html)['amenity:electricity']).toBe('Imported');
  expect(figures(html).every((f) => f.marks.length === 1)).toBe(true);
});

test('міграція сіє речення для кожного з восьми статусів', () => {
  const slots = TRUST_SECTIONS.map((s) => s.slot);
  expect(slots).toEqual(['intro', ...TRUST_STATUSES.map((s) => `status-${s}`)]);
  for (const s of TRUST_SECTIONS.slice(1)) {
    expect(s.body?.trim().length ?? 0, s.slot).toBeGreaterThan(10);
    // The seeded heading is the word the page prints.
    expect(s.heading).toBe(
      (TRUST_LABEL as Record<string, string>)[s.slot.replace('status-', '')],
    );
  }
  // 🔴 The sentence for an import must not suggest we checked it.
  expect(TRUST_SECTIONS.find((s) => s.slot === 'status-imported')!.body).toContain(
    'We have not checked it',
  );
});

// ═══ 6. What is NOT covered yet — by name, and only shrinking ═══════════

/**
 * 🔴 Every block the campsite page renders is in exactly one of two lists.
 * `COVERED` blocks print a status on each figure (tests above). `NOT_YET`
 * blocks print figures WITHOUT one of the eight words — they explain their
 * origin in their own sentences. A block added to the page and to neither
 * list fails here, so "no status" is always somebody's written decision.
 */
const COVERED = ['SpotFactsLine', 'AmenityList', 'TrustLegend'];

const NOT_YET = [
  'Around',
  'BathingWaterNote',
  'CampDisturbance',
  'CampServices',
  'Contact',
  'DroughtPanel',
  'OpeningHours',
  'OvernightStay',
  'RecordEdited',
  'SpotEvents',
  'TariffTable',
  'WarningsForSpot',
  'WebcamNote',
  'AirQualityNote',
];

/** Blocks that hold no figure about the place: layout, links, forms, media. */
const NO_FIGURES = [
  'Block', 'Breadcrumbs', 'ButtonLink', 'CampsiteMedia', 'ClaimListing', 'Faq',
  'Link', 'MissingNotice', 'NearbyCard', 'NoPhotos', 'ReportProblem',
  'ScaleTrack', 'Section', 'SourceNote', 'TravelNotice',
];

test('🔴 кожен блок сторінки кемпінгу або має статус, або названий серед тих, що ще ні', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/app/camping/[country]/[region]/[slug]/page.tsx'),
    'utf8',
  );
  const used = [...new Set([...src.matchAll(/(?<!\w)<([A-Z][A-Za-z0-9]*)\b/g)].map((m) => m[1]))].sort();
  // Anchor: the page was parsed.
  expect(used.length).toBeGreaterThan(20);
  const known = new Set([...COVERED, ...NOT_YET, ...NO_FIGURES]);
  expect(used.filter((u) => !known.has(u))).toEqual([]);
  // And no list names a block that is gone: a stale entry hides nothing,
  // but it makes the debt look larger or smaller than it is.
  expect([...known].filter((k) => !used.includes(k)).sort()).toEqual([]);
  // 🔴 The debt, as a number. It may go down. It may not go up.
  expect(NOT_YET.length).toBe(14);
});
