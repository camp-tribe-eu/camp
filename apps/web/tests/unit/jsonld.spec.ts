import { expect, test } from '@playwright/test';
import {
  campgroundGraph,
  campsiteFaq,
  faqGraph,
  surroundingProperties,
} from '../../src/lib/jsonld';
import { AMENITY_KEYS, Amenities, Spot } from '../../src/lib/api';

// CAMP-114: the rule this file exists to enforce, in the card's words —
// "no type without data under it, and the test fails if the type is there
// and the data is not".
//
// 🔴 The failure this guards against is the one nobody sees. Invented
// markup does not break a page, does not change a screenshot and does not
// move a Lighthouse score. It is a claim made to machines only, which is
// why only a machine can catch it.
//
// The vocabulary half is not re-implemented here: the same validateHtml
// the build runs is imported, so the two cannot drift apart.

const unknownAmenities = Object.fromEntries(
  AMENITY_KEYS.map((k) => [k, 'unknown']),
) as unknown as Amenities;

/** A campsite about which we know nothing but where it is. */
const bare: Spot = {
  slug: 'nowhere',
  name: null,
  country: 'si',
  region: 'Gorenjska',
  type: 'paid',
  lat: 46.36,
  lon: 14.09,
  amenities: unknownAmenities,
  ownerOverrides: {},
  lastSeenAt: null,
  missingSince: null,
  context: {},
  description: null,
  descriptionLang: null,
  stars: null,
  website: null,
  sources: [],
};

/** The same site, with everything we are able to measure measured. */
const full: Spot = {
  ...bare,
  name: 'Camping Bled',
  amenities: { ...unknownAmenities, shower: 'yes', wifi: 'no', dogFriendly: 'yes' },
  stars: 4,
  website: 'https://www.camping-bled.com/',
  context: {
    water: { m: 365, name: 'Lake Bled', kind: 'lake' },
    town: { m: 1200, name: 'Bled' },
    supermarket: { m: 800 },
    station: { m: 2100, name: 'Lesce-Bled' },
    elevation: 475,
    terrain: { relief: 210, type: 'hilly' },
  },
};

// 🔴 The build's own validator, loaded rather than re-implemented.
//
// Playwright compiles these specs to CommonJS, so the ESM checker cannot
// be a static import — it is pulled in once, dynamically, before the
// tests run. Copying its rules here instead would let the two drift, and
// the copy that drifts is always the one the tests trust.
let validateHtml: (html: string, label: string) => { errors: string[] };

test.beforeAll(async () => {
  ({ validateHtml } = await import(
    '../../../../scripts/seo/check-structured-data.mjs'
  ));
});

const validates = (doc: unknown) => {
  const { errors } = validateHtml(
    `<script type="application/ld+json">${JSON.stringify(doc)}</script>`,
    'unit',
  );
  return errors;
};

test('the full graph validates against the real schema.org vocabulary', () => {
  expect(validates(campgroundGraph(full, '/camping/si/gorenjska/camping-bled', []))).toEqual([]);
});

test('and so does the graph of a site we know nothing about', () => {
  expect(validates(campgroundGraph(bare, '/camping/si/gorenjska/nowhere', []))).toEqual([]);
});

test('the FAQ block validates too', () => {
  const doc = faqGraph(campsiteFaq(full), '/camping/si/gorenjska/camping-bled');
  expect(doc).not.toBeNull();
  expect(validates(doc)).toEqual([]);
});

// ── nothing claimed without a field behind it ──────────────────────────

test('a site with no measurements carries no property claiming any', () => {
  const node = campgroundGraph(bare, '/x', []) as Record<string, unknown>;
  for (const key of [
    'additionalProperty',
    'petsAllowed',
    'starRating',
    'sameAs',
    'amenityFeature',
    'description',
    'aggregateRating',
    'review',
  ]) {
    expect(node[key], `${key} appeared with nothing behind it`).toBeUndefined();
  }
});

test('and asks no questions it cannot answer', () => {
  expect(campsiteFaq(bare)).toEqual([]);
  // 🔴 Null, not an empty FAQPage: a type promising answers it has none of.
  expect(faqGraph([], '/x')).toBeNull();
});

test('each measurement produces exactly one property, and only when present', () => {
  expect(surroundingProperties(bare)).toEqual([]);
  expect(surroundingProperties(full)).toHaveLength(6);

  const only = surroundingProperties({ ...bare, context: { elevation: 475 } });
  expect(only).toHaveLength(1);
  expect(only[0]).toMatchObject({ value: 475, unitCode: 'MTR' });
});

test('every measured value in the graph is the number we hold, unrounded', () => {
  const props = surroundingProperties(full) as { name: string; value: number }[];
  const byName = (part: string) => props.find((p) => p.name.includes(part))?.value;
  expect(byName('Lake Bled')).toBe(365);
  expect(byName('Bled')).toBeDefined();
  expect(byName('supermarket')).toBe(800);
  expect(byName('Lesce-Bled')).toBe(2100);
  expect(byName('Elevation')).toBe(475);
  expect(byName('Relief')).toBe(210);
});

// ── the tri-state, all the way through ─────────────────────────────────

test('petsAllowed follows the recorded answer, and stays silent without one', () => {
  const graph = (v: 'yes' | 'no' | 'unknown') =>
    campgroundGraph(
      { ...bare, amenities: { ...unknownAmenities, dogFriendly: v } },
      '/x',
      [],
    ) as Record<string, unknown>;
  expect(graph('yes').petsAllowed).toBe(true);
  expect(graph('no').petsAllowed).toBe(false);
  expect(graph('unknown').petsAllowed).toBeUndefined();
});

// ── somebody else's rating, never ours ─────────────────────────────────

test("the star rating is the state's classification, with its scale", () => {
  const node = campgroundGraph(full, '/x', []) as Record<string, unknown>;
  expect(node.starRating).toEqual({
    '@type': 'Rating',
    ratingValue: 4,
    bestRating: 5,
    worstRating: 1,
  });
  // The scale is what makes it readable, and the validator agrees.
  expect(validates(node)).toEqual([]);
});

test('we never publish a rating of our own', () => {
  const node = campgroundGraph(full, '/x', []) as Record<string, unknown>;
  expect(node.aggregateRating).toBeUndefined();
  expect(node.reviewCount).toBeUndefined();
  expect(node.ratingValue).toBeUndefined();
});

// ── the questions themselves ───────────────────────────────────────────

test('every answer carries the number rather than a yes or a no', () => {
  for (const { q, a } of campsiteFaq(full)) {
    // 🔴 A yes/no question about a distance is a lie at one distance and
    // the truth at another, and the markup cannot tell which. Questions
    // are phrased so the answer must carry the measurement.
    expect(q, `"${q}" invites a bare yes`).not.toMatch(/^Is there|^Are there|^Does it have/);
    expect(a.length, `"${q}" has an empty answer`).toBeGreaterThan(10);
  }
});

test('the facilities answer counts the gaps instead of hiding them', () => {
  const a = campsiteFaq(full).find((f) => f.q.includes('facilities'))?.a ?? '';
  // Verbatim, as the page prints them — "Wi-Fi", not "wi-fi".
  expect(a).toContain('Showers');
  expect(a).toContain('Wi-Fi');
  // Three recorded of the whole list, so the rest are unknown — and the
  // answer says so in those words rather than implying they are missing.
  expect(a).toContain(`${AMENITY_KEYS.length - 3} of ${AMENITY_KEYS.length}`);
});

test('a free site is told as free, a paid one says nothing about price', () => {
  const free = campsiteFaq({ ...full, type: 'free' }).some((f) => f.q.includes('cost'));
  const paid = campsiteFaq({ ...full, type: 'paid' }).some((f) => f.q.includes('cost'));
  expect(free).toBe(true);
  // 🔴 We hold no prices (CAMP-115). Silence, not a guess.
  expect(paid).toBe(false);
});
