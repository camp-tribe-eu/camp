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
  ['everything we can measure, measured', full],
  ['no region', { ...bare, region: null }],
  ['stars only', { ...bare, stars: 3 }],
  ['one amenity only', {
    ...bare,
    amenities: { ...unknownAmenities, shower: 'yes' },
  }],
  ['one measurement only', { ...bare, context: { elevation: 475 } }],
  ['a free site, priced by its type', { ...bare, type: 'free' }],
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
  // nothing at all. Every entry that is true of `full` must appear.
  const emitted = typesIn(graphFor(full));
  for (const [type, evidence] of Object.entries(TYPE_EVIDENCE)) {
    if (evidence(full)) {
      expect(emitted.has(type), `${type} is backed by data and missing`).toBe(true);
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
  const json = JSON.stringify(graphFor(withCapacity));
  expect(json).not.toContain('maximumAttendeeCapacity');
  // Not under any other name either — the number itself must be absent,
  // and no property may be named for it.
  expect(json).not.toContain('137');
  expect(json).not.toMatch(/pitch|capacit/i);
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
    const node = campgroundGraph({ ...full, website } as Spot, '/x') as Record<string, unknown>;
    expect(node.sameAs).toBeUndefined();
  });
}

test('sameAs accepts the operator\'s real site', () => {
  const node = campgroundGraph(full, '/x') as Record<string, unknown>;
  expect(node.sameAs).toEqual(['https://www.camping-bled.com/']);
});

// ── CAMP-114: the source record is an identity too ─────────────────────

test('the OpenStreetMap record joins the campsite in sameAs', () => {
  const node = campgroundGraph(
    {
      ...full,
      sources: [
        { id: 'osm', ref: 'n123', updatedAt: '2026-09-24', fields: ['name'] },
      ],
    },
    '/x',
  ) as Record<string, unknown>;
  expect(node.sameAs).toEqual([
    'https://www.camping-bled.com/',
    'https://www.openstreetmap.org/node/123',
  ]);
});

test('an area ref is decoded to the way it stands for, never guessed', () => {
  // Verified against the OpenStreetMap API on 28.09.2026: `a3018798900`
  // is way 1509399450, "Jugendzeltplatz Eschachtal", tourism=camp_site.
  const link = (ref: string) =>
    sourceLinks({
      ...bare,
      sources: [{ id: 'osm', ref, updatedAt: '2026-09-24', fields: ['name'] }],
    });
  expect(link('a3018798900')).toEqual([
    'https://www.openstreetmap.org/way/1509399450',
  ]);
  // Odd area ids are relations. None exist in the data today; the rule
  // is here so the day one arrives it is not published as a way.
  expect(link('a3')).toEqual(['https://www.openstreetmap.org/relation/1']);
  expect(link('w871234')).toEqual(['https://www.openstreetmap.org/way/871234']);
  // 🔴 A shape we do not recognise produces NO link. A permalink to the
  // wrong object is a machine-readable claim that this campsite is
  // something else entirely.
  for (const bogus of ['r5', '12345', 'node/5', '', 'a', 'a12x']) {
    expect(link(bogus), bogus).toEqual([]);
  }
});

test('the DATAtourisme record is used as it stands, if it is a URL', () => {
  const link = (ref: string) =>
    sourceLinks({
      ...bare,
      sources: [
        { id: 'datatourisme', ref, updatedAt: '2026-09-24', fields: ['stars'] },
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
