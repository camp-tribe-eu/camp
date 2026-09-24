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

// 🔴 This test was written narrowly enough to let the shipped code
// through. Review pointed out that the regex missed "Is it officially
// classified?" — a yes/no question the same file forbids, answered
// "Yes — 4 stars", three functions below the rule. The check is now
// structural: a question may not open with an auxiliary verb at all.
const AUXILIARY = /^(is|are|was|were|does|do|did|can|could|will|would|has|have|had|should|may|must)\b/i;

test('no question can be answered with a bare yes or no', () => {
  for (const { q } of campsiteFaq(full)) {
    // A yes/no question about a distance is a lie at one distance and the
    // truth at another, and the markup cannot tell which.
    expect(q, `"${q}" opens with an auxiliary — it invites a bare yes`).not.toMatch(AUXILIARY);
  }
});

test('and no answer opens with one either', () => {
  for (const { q, a } of campsiteFaq(full)) {
    expect(a, `"${q}" is answered with a bare yes/no`).not.toMatch(/^(yes|no)\b/i);
    expect(a.length, `"${q}" has an empty answer`).toBeGreaterThan(10);
  }
});

// 🔴 Every answer must contain a number we hold, or name a field we hold.
// Four invented-prose mutations survived the first version of this file.
test('every answer is built from a value, not from prose', () => {
  for (const { q, a } of campsiteFaq(full)) {
    expect(a, `"${q}" carries no figure at all`).toMatch(/\d/);
  }
});

test('the distance answers keep the straight-line caveat', () => {
  const measured = campsiteFaq(full).filter((f) => /How far/.test(f.q));
  expect(measured.length).toBeGreaterThan(2);
  for (const { q, a } of measured) {
    // 🔴 Without this, an answer can quietly grow a claim about paths or
    // walking time that we have never measured. A mutation doing exactly
    // that survived the first version of these tests.
    expect(a, `"${q}" drops the straight-line caveat`).toMatch(/straight[- ]line/);
  }
});

test('no answer claims a path, a walk or a drive time we never measured', () => {
  for (const { q, a } of campsiteFaq(full)) {
    expect(a, `"${q}" invents a route`).not.toMatch(
      /\beasy walk\b|\bmarked path\b|\bminutes(?: |')? (?:walk|drive)\b|\bdirectly on\b/i,
    );
  }
});

test('the facilities answer counts the gaps instead of hiding them', () => {
  const a = campsiteFaq(full).find((f) => f.q.includes('facilities'))?.a ?? '';
  // Verbatim, as the page prints them — "Wi-Fi", not "wi-fi".
  expect(a).toContain('Showers');
  expect(a).toContain('Wi-Fi');
  expect(a).toContain(`${AMENITY_KEYS.length - 3} of ${AMENITY_KEYS.length}`);
  // 🔴 And says what an unrecorded facility IS: a gap in the data.
  //
  // Asserting only the count let a mutation through that read "the
  // remaining 7 of 10 are not available at this campsite" — a fabricated
  // negative claim about a real business, which is the one thing this
  // project exists not to do.
  expect(a).toMatch(/have not been recorded/);
  expect(a).toMatch(/gap in the data/);
  // The honest disclaimer says "not a statement that they are missing",
  // so the forbidden phrases are the ASSERTIONS of absence, not the word.
  expect(a).not.toMatch(/are not available|does not have|it has no /i);
});

// 🔴 The graph property, not just the question. A mutation that set
// isAccessibleForFree unconditionally — marking every paid campsite free
// — survived the first version of these tests.
test('isAccessibleForFree is claimed only where the type carries no fee', () => {
  const free = campgroundGraph({ ...full, type: 'free' }, '/x', []) as Record<string, unknown>;
  const wild = campgroundGraph({ ...full, type: 'wild' }, '/x', []) as Record<string, unknown>;
  expect(free.isAccessibleForFree).toBe(true);
  expect(wild.isAccessibleForFree).toBe(true);
  for (const type of ['paid', 'camper_stop', 'rv_park'] as const) {
    const node = campgroundGraph({ ...full, type }, '/x', []) as Record<string, unknown>;
    expect(node.isAccessibleForFree, `${type} was marked free`).toBeUndefined();
  }
});

test('a free site is told as free, a paid one says nothing about price', () => {
  const free = campsiteFaq({ ...full, type: 'free' }).some((f) => f.q.includes('price'));
  const paid = campsiteFaq({ ...full, type: 'paid' }).some((f) => f.q.includes('price'));
  expect(free).toBe(true);
  // 🔴 We hold no prices (CAMP-115). Silence, not a guess.
  expect(paid).toBe(false);
});

// ── the shapes an API version skew can hand us ─────────────────────────
//
// 🔴 None of these is reachable through today's API: it normalises stars
// to null, drops empty names and never writes a null distance. That is
// exactly why they are here. The Spot interface already carries a comment
// about tolerating an older API (`indexable?`), and review found the graph
// and the FAQ disagreeing about `stars` — one checked null and undefined,
// the other only null, and the page printed "undefined stars in the
// national classification" while the graph correctly said nothing.

for (const [label, stars] of [
  ['absent', undefined],
  ['null', null],
  ['zero', 0],
  ['six, above the scale', 6],
  ['a string', '4'],
] as const) {
  test(`stars ${label}: neither the graph nor the FAQ claims a classification`, () => {
    const spot = { ...full, stars } as unknown as Spot;
    const node = campgroundGraph(spot, '/x', []) as Record<string, unknown>;
    expect(node.starRating).toBeUndefined();
    const asked = campsiteFaq(spot).find((f) => f.q.includes('classification'));
    expect(asked, 'a classification was claimed without one').toBeUndefined();
  });
}

test('a real classification still appears in both, and they agree', () => {
  const node = campgroundGraph(full, '/x', []) as Record<string, unknown>;
  const answer = campsiteFaq(full).find((f) => f.q.includes('classification'))?.a ?? '';
  expect((node.starRating as Record<string, unknown>).ratingValue).toBe(4);
  expect(answer).toContain('4 stars');
});

for (const [label, website] of [
  ['a javascript: URL', 'javascript:alert(1)'],
  ['a data: URL', 'data:text/html,<script>x</script>'],
  ['an empty string', ''],
  ['whitespace', '   '],
  ['a bare hostname', 'camping-bled.com'],
] as const) {
  test(`sameAs refuses ${label}`, () => {
    const node = campgroundGraph({ ...full, website } as Spot, '/x', []) as Record<string, unknown>;
    expect(node.sameAs).toBeUndefined();
  });
}

test('sameAs accepts the operator\'s real site', () => {
  const node = campgroundGraph(full, '/x', []) as Record<string, unknown>;
  expect(node.sameAs).toBe('https://www.camping-bled.com/');
});

test('a null measurement is not a measurement of null', () => {
  const spot = {
    ...bare,
    context: {
      elevation: null,
      water: { m: null, kind: 'lake', name: null },
      town: { m: 900, name: '' },
    },
  } as unknown as Spot;
  // Nothing may be published with a null or blank value in it.
  const props = surroundingProperties(spot) as { name: string; value: unknown }[];
  for (const pv of props) {
    expect(pv.value, `${pv.name} carries a null`).not.toBeNull();
    expect(pv.name.trim().endsWith('to'), `"${pv.name}" ends with nothing`).toBe(false);
  }
  for (const { q, a } of campsiteFaq(spot)) {
    expect(a, `"${q}" prints a null or undefined`).not.toMatch(/null|undefined/);
  }
  // And the whole graph still validates.
  expect(validates(campgroundGraph(spot, '/x', []))).toEqual([]);
});

test('a terrain type we do not recognise does not take the page down', () => {
  const spot = {
    ...bare,
    context: { terrain: { relief: 120, type: 'lunar' } },
  } as unknown as Spot;
  expect(() => surroundingProperties(spot)).not.toThrow();
  expect(() => campsiteFaq(spot)).not.toThrow();
  const answer = campsiteFaq(spot)[0]?.a ?? '';
  expect(answer).toContain('120 m of relief');
  expect(answer).not.toMatch(/undefined/);
});
