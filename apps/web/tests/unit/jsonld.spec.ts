import { expect, test } from '@playwright/test';
import {
  campgroundGraph,
  campsiteFaq,
  campsitePageGraph,
  faqGraph,
  sourceLinks,
  surroundingProperties,
  TYPE_EVIDENCE,
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
  contact: {},
};

/**
 * The same site, with everything we are able to hold, held.
 *
 * 🔴 `contact` and `sources` are populated here, and review is the
 * reason. Every fixture in this file used to carry `contact: {}` and
 * `sources: []`, which made the whole CAMP-141 contact surface — and
 * this card's own `sourceLinks` — invisible to the type-evidence walk
 * below: a type gated on `contact.phone` could be emitted on every
 * campsite that has a phone and no fixture would ever see it.
 * Demonstrated with an invented `Offer`, which shipped past all ten
 * tests. The richest fixture has to actually be the richest.
 */
const full: Spot = {
  ...bare,
  name: 'Camping Bled',
  amenities: { ...unknownAmenities, shower: 'yes', wifi: 'no', dogFriendly: 'yes' },
  stars: 4,
  website: 'https://www.camping-bled.com/',
  contact: {
    phone: '+386 4 575 20 00',
    email: 'info@camping-bled.com',
    website: 'https://osm.example/camping-bled',
    operator: 'Sava Turizem d.d.',
    openingHours: '24/7',
    capacity: 137,
    address: { street: 'Kidričeva cesta 10c', city: 'Bled', postcode: '4260' },
  },
  sources: [
    { id: 'osm', ref: 'a194007848', updatedAt: '2026-09-24', fields: ['name', 'location', 'amenities'] },
    { id: 'datatourisme', ref: 'https://data.datatourisme.fr/13/abc', updatedAt: '2026-01-15', fields: ['stars', 'website'] },
  ],
  context: {
    water: { m: 365, name: 'Lake Bled', kind: 'lake' },
    town: { m: 1200, name: 'Bled' },
    supermarket: { m: 800 },
    station: { m: 2100, name: 'Lesce-Bled' },
    elevation: 475,
    terrain: { relief: 210, type: 'hilly' },
  },
  // 🔴 CAMP-147, and it is in the RICHEST fixture on purpose — read the
  // note above this object. `Offer` and `PriceSpecification` are gated
  // on `spot.tariffs`, so a fixture without one would let the whole
  // price markup ship without the type-evidence walk ever seeing it.
  // That is the exact failure this fixture was once caught committing,
  // with an invented `Offer`.
  //
  // 🔴 The season deliberately spans 2020–2099. It has to be CURRENT
  // whenever this suite runs, and a real-looking 2026 season would turn
  // these assertions green today and red for ever afterwards without
  // anything having changed. The rule that an expired tariff emits no
  // markup is asserted separately, on a fixture built to be expired.
  tariffs: [
    {
      offer: 'BarePitch',
      mode: 'Overnight',
      policy: 'BaseRateFullRate',
      minPrice: '18.00',
      maxPrice: '25.00',
      currency: 'EUR',
      validFrom: '2020-04-01',
      validUntil: '2099-09-26',
      label: 'Pour une nuit avec électricité, wifi, eau',
      labelLang: 'fr',
      sourceUpdatedAt: '2026-08-31',
      sourceId: 'datatourisme',
    },
    {
      offer: 'TouristTax',
      mode: 'PerPerson',
      policy: null,
      minPrice: '0.66',
      maxPrice: '0.66',
      currency: 'EUR',
      validFrom: '2020-04-01',
      validUntil: '2099-09-26',
      label: null,
      labelLang: null,
      sourceUpdatedAt: '2026-08-31',
      sourceId: 'datatourisme',
    },
  ],
  tariffsWithheld: 3,
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
  expect(validates(campgroundGraph(full, '/camping/si/gorenjska/camping-bled'))).toEqual([]);
});

test('and so does the graph of a site we know nothing about', () => {
  expect(validates(campgroundGraph(bare, '/camping/si/gorenjska/nowhere'))).toEqual([]);
});

test('the FAQ block validates too', () => {
  const doc = faqGraph(campsiteFaq(full), '/camping/si/gorenjska/camping-bled');
  expect(doc).not.toBeNull();
  // 🔴 Not on its own any more. Since CAMP-114 the FAQ says what it is
  // about and which page it belongs to, by `@id`, so validating it in
  // isolation now reports those references as dangling — correctly. The
  // whole page is validated in the section below; here we only check
  // that nothing else about the block is wrong.
  expect(
    validates(doc).filter((e) => !e.includes('referenced but no block defines it')),
  ).toEqual([]);
});

// ── CAMP-114: no type without data, checked on the graph that ships ────
//
// 🔴 This is the card's verification clause, and the reason it is here
// rather than in a comment.
//
// The tests below this section each name a property they expect to be
// absent. That is a hand-written list: it catches the mistakes somebody
// thought of, and a type added next month appears in none of them. So
// this block works the other way round — it walks every node of every
// block the page actually emits, and for each `@type` it finds it asks
// `TYPE_EVIDENCE` what fact must be true first. A type with no entry
// fails. A type whose entry is false for this campsite fails.

const PATH = '/camping/si/gorenjska/camping-bled';
const CRUMBS = [
  { name: 'Camping', path: '/camping' },
  { name: 'Slovenia', path: '/camping/si' },
  { name: 'Gorenjska', path: '/camping/si/gorenjska' },
  { name: 'Camping Bled', path: PATH },
];

const graphFor = (spot: Spot) =>
  campsitePageGraph({ spot, path: PATH, crumbs: CRUMBS, faq: campsiteFaq(spot) });

/** Every `@type` anywhere in the page's blocks, nested ones included. */
function typesIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) typesIn(v, found);
    return found;
  }
  if (value && typeof value === 'object') {
    const t = (value as Record<string, unknown>)['@type'];
    if (typeof t === 'string') found.add(t);
    else if (Array.isArray(t)) for (const x of t) found.add(String(x));
    for (const v of Object.values(value as Record<string, unknown>)) {
      typesIn(v, found);
    }
  }
  return found;
}

/**
 * The fixtures a type has to survive. `bare` is the honest worst case —
 * a campsite we know nothing about but where it is — and each of the
 * others turns exactly one fact on.
 */
const FIXTURES: [string, Spot][] = [
  ['a campsite we know nothing about', bare],
  ['everything we can hold, held', full],
  ['no region', { ...bare, region: null }],
  ['stars only', { ...bare, stars: 3 }],
  ['one amenity only', {
    ...bare,
    amenities: { ...unknownAmenities, shower: 'yes' },
  }],
  ['one measurement only', { ...bare, context: { elevation: 475 } }],
  ['a free site, priced by its type', { ...bare, type: 'free' }],
  // 🔴 The CAMP-141 contact surface, one field at a time. Without these
  // a type gated on a phone number, an address or opening hours is
  // emitted on thousands of pages and seen by none of these tests.
  ['a phone and nothing else', { ...bare, contact: { phone: '+386 4 575 20 00' } }],
  ['an email and nothing else', { ...bare, contact: { email: 'x@example.si' } }],
  ['an address and nothing else', {
    ...bare,
    contact: { address: { street: 'Kidričeva cesta 10c', city: 'Bled', postcode: '4260' } },
  }],
  ['opening hours and nothing else', { ...bare, contact: { openingHours: '24/7' } }],
  ['an operator and a capacity, which we publish for neither', {
    ...bare,
    contact: { operator: 'Sava Turizem d.d.', capacity: 137 },
  }],
  ['an OpenStreetMap website and nothing else', {
    ...bare,
    contact: { website: 'https://osm.example/x' },
  }],
  // And the source records, which this card turned into `sameAs`.
  ['one OpenStreetMap source', {
    ...bare,
    sources: [{ id: 'osm', ref: 'n123', updatedAt: '2026-09-24', fields: ['name', 'location'] }],
  }],
  ['one DATAtourisme source', {
    ...bare,
    sources: [{ id: 'datatourisme', ref: 'https://data.datatourisme.fr/13/x', updatedAt: '2026-01-15', fields: ['name', 'location'] }],
  }],
  ['two sources, one of them joined by a rule', {
    ...bare,
    sources: [
      { id: 'osm', ref: 'a194007848', updatedAt: '2026-09-24', fields: ['name', 'location'] },
      { id: 'datatourisme', ref: 'https://data.datatourisme.fr/13/x', updatedAt: '2026-01-15', fields: ['stars'] },
    ],
  }],
];

for (const [label, spot] of FIXTURES) {
  test(`every type has a field behind it — ${label}`, () => {
    for (const type of typesIn(graphFor(spot))) {
      const evidence = TYPE_EVIDENCE[type];
      expect(
        evidence,
        `${type} is emitted but TYPE_EVIDENCE does not say what backs it`,
      ).toBeDefined();
      expect(
        evidence(spot),
        `${type} is in the markup while the data behind it is not`,
      ).toBe(true);
    }
  });
}

test('and a type whose data IS there is actually emitted', () => {
  // 🔴 The other direction, or the table could be satisfied by emitting
  // nothing at all — and across EVERY fixture, not just the richest one.
  // Running it on `full` alone let a table entry be true for a campsite
  // whose type the graph never emits, which is the same lie the other
  // way round.
  for (const [label, spot] of FIXTURES) {
    const emitted = typesIn(graphFor(spot));
    for (const [type, evidence] of Object.entries(TYPE_EVIDENCE)) {
      if (evidence(spot)) {
        expect(
          emitted.has(type),
          `${label}: ${type} is backed by data and missing from the markup`,
        ).toBe(true);
      }
    }
  }
});

test('the bare campsite carries no optional type at all', () => {
  // Named explicitly, so that a change making one of these unconditional
  // has to be argued for here rather than slipping through the loop.
  const emitted = typesIn(graphFor(bare));
  for (const type of [
    'Rating',
    'LocationFeatureSpecification',
    'PropertyValue',
    'FAQPage',
    'Question',
    'Answer',
  ]) {
    expect(emitted.has(type), `${type} appeared with nothing behind it`).toBe(false);
  }
  // And what is left is genuinely true of every row in the database.
  expect([...emitted].sort()).toEqual([
    'BreadcrumbList',
    'Campground',
    'GeoCoordinates',
    'ListItem',
    'Organization',
    'Place',
    'PostalAddress',
    'WebPage',
    'WebSite',
  ]);
});

test('the page as a whole validates, blocks and cross-references', () => {
  // 🔴 All the blocks together, the way the build sees a page. One at a
  // time would hide the thing this most needs to catch: a reference from
  // one block to an `@id` that no other block defines.
  for (const [label, spot] of FIXTURES) {
    const html = graphFor(spot)
      .map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
      .join('');
    expect(validateHtml(html, label).errors, label).toEqual([]);
  }
});

test('every @id a block points at is a block that exists', () => {
  // 🔴 A dangling reference is a claim about a node that is not there.
  // `mainEntity: {"@id": "…#campground"}` pointing at nothing tells an
  // assistant the page is about something it cannot find, and neither
  // the vocabulary check nor a screenshot would show it.
  const blocks = graphFor(full);
  const defined = new Set<string>();
  const referenced = new Set<string>();
  const walk = (v: unknown, isRefHolder = false) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, isRefHolder));
    if (!v || typeof v !== 'object') return;
    const node = v as Record<string, unknown>;
    const id = node['@id'];
    if (typeof id === 'string') {
      // A node carrying only @id is a reference; one with a @type defines.
      if (node['@type'] !== undefined) defined.add(id);
      else referenced.add(id);
    }
    for (const val of Object.values(node)) walk(val);
  };
  walk(blocks);
  for (const ref of referenced) {
    expect(defined.has(ref), `${ref} is referenced but never defined`).toBe(true);
  }
  // And the linkage this card added is really there.
  expect(defined.has(`https://camptribe.eu${PATH}#campground`)).toBe(true);
  expect(defined.has(`https://camptribe.eu${PATH}#page`)).toBe(true);
});

test('the page is described as the English page that it is', () => {
  const page = graphFor(full).find((b) => b['@type'] === 'WebPage')!;
  expect(page.inLanguage).toBe('en');
  expect(page.publisher).toMatchObject({ '@type': 'Organization', name: 'CampTribe' });
  expect(page.mainEntity).toEqual({ '@id': `https://camptribe.eu${PATH}#campground` });
});

test('🔴 pitches are still not published as structured data', () => {
  // The scar: `maximumAttendeeCapacity` counts PEOPLE and OSM's
  // `capacity` was published into it on 3 683 campsites.
  //
  // 🔴 And it is not published under an honest name either. The
  // OpenStreetMap wiki documents `capacity:pitches`, `capacity:persons`,
  // `capacity:tents` and `capacity:caravans` for tourism=camp_site —
  // plain `capacity`, which is the tag we import, is none of them. Which
  // quantity a mapper meant is a guess, and a guess is exactly what this
  // file refuses to encode. The number is printed on the page, labelled
  // as pitches, where a reader can weigh it.
  const withCapacity = { ...full, contact: { ...full.contact, capacity: 137 } };
  const graph = graphFor(withCapacity);
  const json = JSON.stringify(graph);
  expect(json).not.toContain('maximumAttendeeCapacity');
  // Not under any other name either — the number itself must be absent,
  // and no property may be named for it.
  expect(json).not.toContain('137');

  // 🔴 NARROWED, NOT RELAXED — CAMP-147, and the reason is worth the
  // paragraph.
  //
  // This used to be `expect(json).not.toMatch(/pitch|capacit/i)` over the
  // whole serialised graph. That is a test of the VALUES as well as the
  // keys, and it went red the day the price list arrived, because
  // DATAtourisme's own pricing vocabulary contains `kb:BarePitch` and
  // `kb:CamperPitch` — "Bare pitch, per night" is the name of a tariff,
  // published by the operator, and has nothing to do with how many
  // pitches OpenStreetMap thinks the site has.
  //
  // What this test actually claims, in its own words above, is that the
  // number is absent and that "no property may be named for it". So it
  // now asserts exactly that, over every KEY in the graph. It still
  // fails on `maximumAttendeeCapacity`, on `numberOfPitches`, and on any
  // other property somebody invents for the quantity — which is the
  // whole scar — and it no longer fails on a word appearing inside a
  // value that is not a capacity claim.
  const keys = new Set<string>();
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(collect);
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        keys.add(k);
        collect(v);
      }
    }
  };
  collect(graph);
  expect([...keys].filter((k) => /pitch|capacit/i.test(k))).toEqual([]);
});

// ── nothing claimed without a field behind it ──────────────────────────

test('a site with no measurements carries no property claiming any', () => {
  const node = campgroundGraph(bare, '/x') as Record<string, unknown>;
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
    ) as Record<string, unknown>;
  expect(graph('yes').petsAllowed).toBe(true);
  expect(graph('no').petsAllowed).toBe(false);
  expect(graph('unknown').petsAllowed).toBeUndefined();
});

// ── somebody else's rating, never ours ─────────────────────────────────

test("the star rating is the state's classification, with its scale", () => {
  const node = campgroundGraph(full, '/x') as Record<string, unknown>;
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
  const node = campgroundGraph(full, '/x') as Record<string, unknown>;
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
  const free = campgroundGraph({ ...full, type: 'free' }, '/x') as Record<string, unknown>;
  const wild = campgroundGraph({ ...full, type: 'wild' }, '/x') as Record<string, unknown>;
  expect(free.isAccessibleForFree).toBe(true);
  expect(wild.isAccessibleForFree).toBe(true);
  for (const type of ['paid', 'camper_stop', 'rv_park'] as const) {
    const node = campgroundGraph({ ...full, type }, '/x') as Record<string, unknown>;
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
    const node = campgroundGraph(spot, '/x') as Record<string, unknown>;
    expect(node.starRating).toBeUndefined();
    const asked = campsiteFaq(spot).find((f) => f.q.includes('classification'));
    expect(asked, 'a classification was claimed without one').toBeUndefined();
  });
}

test('a real classification still appears in both, and they agree', () => {
  const node = campgroundGraph(full, '/x') as Record<string, unknown>;
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
    // 🔴 Asserted against the LIST, not against its absence. `full` now
    // carries a source record, so `sameAs` is legitimately non-empty —
    // and a test that only checked "the property is missing" would have
    // started passing for the wrong reason the day it became a list.
    const spot = { ...full, website, contact: { ...full.contact, website } } as Spot;
    const node = campgroundGraph(spot, '/x') as Record<string, unknown>;
    const list = (node.sameAs ?? []) as string[];
    expect(list).not.toContain(website);
    for (const entry of list) {
      expect(entry, `${label} reached sameAs`).toMatch(/^https:\/\/(www\.openstreetmap\.org|data\.datatourisme\.fr)\//);
    }
  });
}

test('sameAs accepts the operator\'s real site', () => {
  const node = campgroundGraph({ ...full, sources: [] }, '/x') as Record<string, unknown>;
  expect(node.sameAs).toEqual(['https://www.camping-bled.com/']);
});

// ── CAMP-114: the source record is an identity too ─────────────────────

test('the OpenStreetMap record joins the campsite in sameAs', () => {
  const node = campgroundGraph(
    {
      ...full,
      sources: [
        { id: 'osm', ref: 'n123', updatedAt: '2026-09-24', fields: ['name', 'location'] },
      ],
    },
    '/x',
  ) as Record<string, unknown>;
  expect(node.sameAs).toEqual([
    'https://www.camping-bled.com/',
    'https://www.openstreetmap.org/node/123',
  ]);
});

test('🔴 a record joined by a rule is attribution, not identity', () => {
  // CAMP-144 joins a DATAtourisme record to an OSM campsite by name and
  // distance, and `link-evidence.ts` says of its own measurement: "This
  // does not prove the links are right." So the joined record is shown
  // on the page with its licence and date, and is NOT published as
  // `sameAs`. Only the source that contributed `location` is — the
  // record this row's geometry, slug and URL actually come from.
  const merged = {
    ...bare,
    sources: [
      { id: 'osm', ref: 'n123', updatedAt: '2026-09-24', fields: ['name', 'location'] },
      { id: 'datatourisme', ref: 'https://data.datatourisme.fr/13/x', updatedAt: '2026-01-15', fields: ['stars', 'website'] },
    ],
  } as Spot;
  expect(sourceLinks(merged)).toEqual(['https://www.openstreetmap.org/node/123']);
  // A DATAtourisme record that IS the row — 8 752 of them — still counts.
  expect(
    sourceLinks({
      ...bare,
      sources: [{ id: 'datatourisme', ref: 'https://data.datatourisme.fr/13/x', updatedAt: '2026-01-15', fields: ['name', 'location'] }],
    } as Spot),
  ).toEqual(['https://data.datatourisme.fr/13/x']);
});

test('a payload whose sources are not a list does not take the page down', () => {
  // `getSpot` is res.json() with a day of cache behind it. `for…of` on
  // an object throws, and api.ts records that a stale payload already
  // took this page down once the same way.
  for (const sources of [{}, null, 'osm', 42] as unknown[]) {
    const spot = { ...bare, sources } as unknown as Spot;
    expect(() => sourceLinks(spot), JSON.stringify(sources)).not.toThrow();
    expect(sourceLinks(spot)).toEqual([]);
    expect(() => campgroundGraph(spot, '/camping/si/gorenjska/x')).not.toThrow();
  }
});

test('an area ref is decoded to the way it stands for, never guessed', () => {
  // Verified against the OpenStreetMap API on 28.09.2026: `a3018798900`
  // is way 1509399450, "Jugendzeltplatz Eschachtal", tourism=camp_site.
  const link = (ref: string) =>
    sourceLinks({
      ...bare,
      sources: [{ id: 'osm', ref, updatedAt: '2026-09-24', fields: ['name', 'location'] }],
    });
  expect(link('a3018798900')).toEqual([
    'https://www.openstreetmap.org/way/1509399450',
  ]);
  expect(link('w871234')).toEqual(['https://www.openstreetmap.org/way/871234']);
  expect(link('n123')).toEqual(['https://www.openstreetmap.org/node/123']);
  // 🔴 A shape we do not recognise produces NO link. A permalink to the
  // wrong object is a machine-readable claim that this campsite is
  // something else entirely.
  for (const bogus of ['r5', '12345', 'node/5', '', 'a', 'a12x', 'n12x']) {
    expect(link(bogus), bogus).toEqual([]);
  }
  // Surrounding whitespace is trimmed, as everywhere else in this file.
  expect(link('  n1  ')).toEqual(['https://www.openstreetmap.org/node/1']);
  // 🔴 An ODD area id is not published as a relation, although that is
  // what libosmium's numbering would make it. `import.sh` filters `n/`
  // and `w/` only, so a relation cannot enter this data and all 32 413
  // of our area ids are even — an odd one is corrupt input, and the
  // first version of this answered corrupt input with a confident
  // permalink to an unrelated OSM object.
  for (const odd of ['a1', 'a3', 'a4294967295']) {
    expect(link(odd), odd).toEqual([]);
  }
  // Nor is an id OpenStreetMap never issues.
  for (const zero of ['a0', 'n0', 'w0']) {
    expect(link(zero), zero).toEqual([]);
  }
});

test('the DATAtourisme record is used as it stands, if it is a URL', () => {
  const link = (ref: string) =>
    sourceLinks({
      ...bare,
      sources: [
        { id: 'datatourisme', ref, updatedAt: '2026-09-24', fields: ['name', 'location'] },
      ],
    });
  expect(link('https://data.datatourisme.fr/13/964b537f')).toEqual([
    'https://data.datatourisme.fr/13/964b537f',
  ]);
  for (const bogus of ['javascript:alert(1)', 'data:text/html,x', '13/964b']) {
    expect(link(bogus), bogus).toEqual([]);
  }
});

test('a source we do not recognise contributes no identity', () => {
  // 🔴 We can attribute a source we have never heard of (lib/sources
  // deliberately keeps unknown ids), but we cannot state the URL of its
  // record. Silence, not a guess at the shape of somebody else's ids.
  expect(
    sourceLinks({
      ...bare,
      sources: [
        { id: 'inaturalist', ref: '99', updatedAt: '2026-09-24', fields: [] },
      ],
    }),
  ).toEqual([]);
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
  expect(validates(campgroundGraph(spot, '/x'))).toEqual([]);
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

test.describe('CAMP-141: contact reaches the structured data', () => {
  const withContact = (contact: Spot['contact'], over: Partial<Spot> = {}) =>
    campgroundGraph({ ...bare, contact, ...over }, '/camping/si/bovec/x');

  test('🔴 a field with no data does not appear at all', () => {
    // The rule this whole file runs on: an empty property is a claim we
    // cannot back. Before CAMP-141 these were absent because we did not
    // import the tags; they must stay absent when a campsite has none.
    const node = withContact({});
    for (const key of ['telephone', 'email', 'openingHours']) {
      expect(node, key).not.toHaveProperty(key);
    }
    expect(node.address).toEqual({
      '@type': 'PostalAddress',
      addressCountry: bare.country.toUpperCase(),
      addressRegion: bare.region,
    });
  });

  test('phone and email appear when they exist', () => {
    const node = withContact({ phone: '+386 5 388 60 00', email: 'info@example.si' });
    expect(node.telephone).toBe('+386 5 388 60 00');
    expect(node.email).toBe('info@example.si');
  });

  test('🔴 capacity and operator are NOT published as schema', () => {
    // Both were, and both were wrong.
    //
    // `maximumAttendeeCapacity` is defined as the number of INDIVIDUALS
    // a venue may hold; OSM's `capacity` on a campsite counts pitches,
    // so publishing 20 pitches as 20 people understates a site three- to
    // fourfold. `provider` is rejected outright by Google's validator on
    // Campground (UNKNOWN_FIELD) — it belongs to Action, Service and
    // Trip, not to a Place. Both are shown on the page instead, where
    // they need no schema to be useful.
    const node = withContact({ capacity: 120, operator: 'Kamp Bovec d.o.o.' });
    expect(node).not.toHaveProperty('maximumAttendeeCapacity');
    expect(node).not.toHaveProperty('provider');
  });

  test('🔴 opening hours cross over only where the two grammars agree', () => {
    // OSM's syntax is a superset of schema.org's, and 93.7% of our live
    // values are outside the overlap. Emitting them raw put a wrong fact
    // into structured data that the validator does not check.
    expect(withContact({ openingHours: 'Mo-Su 08:00-20:00' }).openingHours)
      .toEqual(['Mo-Su 08:00-20:00']);
    // 24/7 has one exact equivalent — 46% of our values are this.
    expect(withContact({ openingHours: '24/7' }).openingHours)
      .toEqual(['Mo-Su 00:00-23:59']);
    // Several rules become several values.
    expect(withContact({ openingHours: 'Mo-Fr 09:00-18:00; Sa 09:00-13:00' }).openingHours)
      .toEqual(['Mo-Fr 09:00-18:00', 'Sa 09:00-13:00']);
    // 24:00 is the same fact as 24/7 and is written the same way.
    expect(withContact({ openingHours: 'Mo-Su 00:00-24:00' }).openingHours)
      .toEqual(['Mo-Su 00:00-23:59']);
    // A clock that is not a clock is refused, not published.
    for (const bogus of ['Mo-Su 99:99-88:88', 'Mo-Su 25:61-26:62', 'Mo-Su 24:30-25:00']) {
      expect(withContact({ openingHours: bogus }), bogus).not.toHaveProperty('openingHours');
    }
    // And what does not translate is not guessed at.
    for (const osm of [
      'Apr-Oct 08:00-20:00',
      'sunrise-sunset',
      'Mo-Su 09:00-12:00,16:30-18:30',
      'Mo-Su 08:00-20:00; PH off',
      'Apr 01-Oct 31',
    ]) {
      expect(withContact({ openingHours: osm }), osm).not.toHaveProperty('openingHours');
    }
  });

  test('a payload with no contact at all does not throw', () => {
    // `getSpot` is res.json() with a day of cache behind it. A web
    // deploy ahead of the API, or one stale cached payload, used to take
    // the page down on `spot.contact.address`.
    const noContact = { ...bare } as Spot;
    delete (noContact as { contact?: unknown }).contact;
    expect(() => campgroundGraph(noContact, '/camping/si/bovec/x')).not.toThrow();
  });

  test('the address carries the street and town OSM has', () => {
    const node = withContact({
      address: { street: 'Trg golobarskih žrtev 8', city: 'Bovec', postcode: '5230' },
    });
    expect(node.address).toMatchObject({
      streetAddress: 'Trg golobarskih žrtev 8',
      addressLocality: 'Bovec',
      postalCode: '5230',
    });
  });

  test('🔴 the tourism register outranks OpenStreetMap for the website', () => {
    // Two sources, one `sameAs`. DATAtourisme is an official register;
    // `contact.website` is whatever a mapper typed. Where both exist the
    // register wins — and where only OSM has one, it is used, which is
    // the whole point: measured, OSM carries a website for 61.6% of
    // campsites against the 10.7% we had.
    expect(
      withContact({ website: 'https://osm.example/' }, { website: 'https://register.example/' })
        .sameAs,
    ).toEqual(['https://register.example/']);
    expect(withContact({ website: 'https://osm.example/' }, { website: null }).sameAs)
      .toEqual(['https://osm.example/']);
    expect(withContact({}, { website: null })).not.toHaveProperty('sameAs');
  });
});

// ── CAMP-147: the price list, as markup ──────────────────────────────────
//
// 🔴 The card asked for `offers`. `offers` is the next `provider`, and
// the first test below is the evidence rather than the assertion.

test.describe('prices in the graph', () => {
  const priced = (tariffs: Spot['tariffs'], withheld = 0): Spot => ({
    ...full,
    tariffs,
    tariffsWithheld: withheld,
  });
  const path = '/camping/si/gorenjska/camping-bled';

  test('🔴 `offers` would have been rejected on Campground', () => {
    // Asked of the same vocabulary index the build uses. This is why the
    // graph emits `makesOffer`, and the test is here so that anybody
    // "fixing" it back to `offers` meets the reason first.
    const node = {
      '@context': 'https://schema.org',
      '@type': 'Campground',
      '@id': 'https://camptribe.eu/x#campground',
      name: 'Camping Bled',
      url: 'https://camptribe.eu/x',
      address: { '@type': 'PostalAddress', addressCountry: 'SI' },
      geo: { '@type': 'GeoCoordinates', latitude: 46.36, longitude: 14.09 },
      offers: [{ '@type': 'Offer', price: '18.00', priceCurrency: 'EUR' }],
    };
    expect(validates(node).join(' ')).toContain(
      '"offers" is not allowed on Campground',
    );
  });

  test('the graph emits makesOffer and never offers', () => {
    const node = campgroundGraph(full, path) as Record<string, unknown>;
    expect(node).toHaveProperty('makesOffer');
    expect(node).not.toHaveProperty('offers');
    expect(validates(node)).toEqual([]);
  });

  test('every offer states when its price stops being true', () => {
    // 🔴 The card's rule, in the half a reader cannot see. A machine has
    // no way to read "expired" off a label, so the date has to be in the
    // data or the price is published as though it were permanent.
    const node = campgroundGraph(full, path) as Record<string, unknown>;
    const offers = node.makesOffer as Record<string, unknown>[];
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      const price = offer.priceSpecification as Record<string, unknown>;
      expect(price.validThrough ?? price.validFrom).toBeTruthy();
      expect(price.priceCurrency).toBe('EUR');
    }
  });

  test('🔴 an expired tariff produces no markup at all', () => {
    // It stays on the page, labelled as over. It does NOT go into the
    // graph: `makesOffer` states that this business offers this at this
    // price, and nothing in the markup can say "last October".
    const stale = priced([
      { ...full.tariffs![0], validFrom: '2020-04-01', validUntil: '2020-09-26' },
    ]);
    expect(campgroundGraph(stale, path)).not.toHaveProperty('makesOffer');
  });

  test('a campsite with no prices emits no Offer and no PriceSpecification', () => {
    expect(campgroundGraph(bare, path)).not.toHaveProperty('makesOffer');
    expect(campgroundGraph(priced([]), path)).not.toHaveProperty('makesOffer');
  });

  test('🔴 a tariff with no validity period is never marked up', () => {
    const undated = priced([
      { ...full.tariffs![0], validFrom: null, validUntil: null },
    ]);
    expect(campgroundGraph(undated, path)).not.toHaveProperty('makesOffer');
  });

  test('amounts stay strings, exactly as stored', () => {
    const node = campgroundGraph(full, path) as Record<string, unknown>;
    const first = (node.makesOffer as Record<string, unknown>[])[0];
    const price = first.priceSpecification as Record<string, unknown>;
    expect(price.minPrice).toBe('18.00');
    expect(price.maxPrice).toBe('25.00');
  });

  test('a single figure is a price, not a floor', () => {
    const node = campgroundGraph(full, path) as Record<string, unknown>;
    const tax = (node.makesOffer as Record<string, unknown>[])[1];
    const price = tax.priceSpecification as Record<string, unknown>;
    expect(price.price).toBe('0.66');
    expect(price).not.toHaveProperty('minPrice');
  });

  test('a spot whose payload predates prices does not throw', () => {
    // Same reason as `contact`: the API and the site deploy separately.
    const old = { ...full } as Spot;
    delete (old as { tariffs?: unknown }).tariffs;
    expect(() => campgroundGraph(old, path)).not.toThrow();
    expect(campgroundGraph(old, path)).not.toHaveProperty('makesOffer');
  });
});
