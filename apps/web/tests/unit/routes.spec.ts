import { expect, test } from '@playwright/test';
import { CURATED_ROUTES } from '../../src/data/routes';
import { validateRoute, TRAVELLER_LABEL, TRAVELLER_TAGS } from '../../src/lib/route-types';
import {
  CAMPSITES_PER_STAGE,
  formatMonths,
  getRoute,
  ODBL_SUBSTANTIAL_FLOOR,
  routeShape,
} from '../../src/lib/routes';
import {
  formatKm,
  NullRouteGeometry,
  routeGeometryProvider,
  straightLineLegs,
  straightLineMetres,
} from '../../src/lib/route-geometry';
import { routeTripGraph } from '../../src/lib/route-jsonld';

// CAMP-3 / CAMP-45 — the rules the route library must satisfy.
//
// 🔴 These are not "does the page render" tests. They are the three
// things that would be invisible until they had already done damage:
// a route that is a template with the names swapped, a page that
// publishes a road figure we cannot produce, and a selection wide enough
// to stop being a Produced Work under ODbL.

test('every published route passes its own validator', () => {
  const problems = CURATED_ROUTES.flatMap(validateRoute);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('slugs are unique, or two routes share a URL', () => {
  const slugs = CURATED_ROUTES.map((r) => r.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
});

test('ids are unique too', () => {
  const ids = CURATED_ROUTES.map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('getRoute finds every route by its slug and nothing else', () => {
  for (const r of CURATED_ROUTES) expect(getRoute(r.slug)?.id).toBe(r.id);
  expect(getRoute('no-such-route')).toBeNull();
  expect(getRoute('')).toBeNull();
});

test('every traveller tag has a label', () => {
  for (const t of TRAVELLER_TAGS) expect(TRAVELLER_LABEL[t]).toBeTruthy();
});

// ── 🔴 the anti-template rule ────────────────────────────────────────────
//
// CAMP-130 refuses a thin guide template repeated across regions, and
// CAMP-36's duplicate-page guard measures the built HTML for exactly
// that. Both run after generation. This runs on the source, so a
// template-shaped route fails before anyone builds it.

test('🔴 no two routes share an opening sentence', () => {
  const openings = CURATED_ROUTES.map((r) => r.intro[0]);
  expect(new Set(openings).size).toBe(openings.length);
});

test('🔴 no two routes share a summary', () => {
  const summaries = CURATED_ROUTES.map((r) => r.summary);
  expect(new Set(summaries).size).toBe(summaries.length);
});

test('🔴 no two routes share a "what the driving is like" paragraph', () => {
  const roads = CURATED_ROUTES.map((r) => r.roads);
  expect(new Set(roads).size).toBe(roads.length);
});

test('🔴 no two stages anywhere in the library share a reason for stopping', () => {
  // The per-stage sentence is where a template shows up first: it is the
  // field a bulk author would fill with "A good place to break the
  // journey." twelve times.
  const whys = CURATED_ROUTES.flatMap((r) => r.stages.map((s) => s.why));
  const seen = new Map<string, number>();
  for (const w of whys) seen.set(w, (seen.get(w) ?? 0) + 1);
  const repeated = [...seen.entries()].filter(([, n]) => n > 1).map(([w]) => w);
  expect(repeated, `repeated stage descriptions:\n${repeated.join('\n')}`).toEqual([]);
});

test('🔴 no two stages in the library sit at the same coordinate', () => {
  const keys = CURATED_ROUTES.flatMap((r) =>
    r.stages.map((s) => `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`),
  );
  expect(new Set(keys).size).toBe(keys.length);
});

// ── 🔴 the ODbL boundary ─────────────────────────────────────────────────

test('🔴 no route page can show a Substantial number of campsites', () => {
  for (const r of CURATED_ROUTES) {
    const most = r.stages.length * CAMPSITES_PER_STAGE;
    expect(
      most,
      `${r.slug} could show ${most} campsites, and our own legal note puts the ` +
        `Substantial line at ${ODBL_SUBSTANTIAL_FLOOR}`,
    ).toBeLessThan(ODBL_SUBSTANTIAL_FLOOR);
  }
});

test('every route says where its campsite data comes from', () => {
  for (const r of CURATED_ROUTES) {
    expect(r.attribution.length, `${r.slug} has no attribution`).toBeGreaterThan(40);
  }
});

// ── 🔴 the constraint: no invented road figures ──────────────────────────

test('🔴 the shipped geometry provider reports unavailable, with a reason', async () => {
  const result = await routeGeometryProvider().road([
    { lat: 46.16, lon: -1.15 },
    { lat: 43.48, lon: -1.56 },
  ]);
  expect(result.available).toBe(false);
  if (!result.available) {
    expect(result.reason).toContain('routing engine');
  }
});

test('🔴 the null provider never invents a straight-line fallback', async () => {
  // The tempting shortcut is for the "no geometry" provider to return
  // the straight line so the page has SOMETHING. That is how a
  // straight-line number ends up labelled as a drive.
  const result = await new NullRouteGeometry().road([
    { lat: 46.16, lon: -1.15 },
    { lat: 43.48, lon: -1.56 },
  ]);
  expect(result.available).toBe(false);
  expect(result).not.toHaveProperty('geometry');
});

test('🔴 no route page can print a road distance today', async () => {
  // The page reads `road.available` and nothing else. If a provider is
  // ever wired in, this test is the thing that says so out loud rather
  // than letting road figures appear unannounced.
  for (const r of CURATED_ROUTES.slice(0, 3)) {
    const result = await routeGeometryProvider().road(r.stages);
    expect(result.available, `${r.slug} unexpectedly has road geometry`).toBe(false);
  }
});

// ── straight-line measurement ────────────────────────────────────────────

test('straight-line distance matches a known separation', () => {
  // Paris–Lyon is about 392 km great-circle. Within 1% is plenty to
  // catch a swapped lat/lon or degrees-vs-radians, which are the two
  // ways this function actually breaks.
  const m = straightLineMetres(
    { lat: 48.8566, lon: 2.3522 },
    { lat: 45.7640, lon: 4.8357 },
  );
  expect(m / 1000).toBeGreaterThan(388);
  expect(m / 1000).toBeLessThan(396);
});

test('a point is zero metres from itself', () => {
  expect(straightLineMetres({ lat: 46.1, lon: -1.1 }, { lat: 46.1, lon: -1.1 })).toBe(0);
});

test('the legs are one fewer than the stages, and sum to the total', () => {
  for (const r of CURATED_ROUTES) {
    const { legs, total } = straightLineLegs(r.stages);
    expect(legs).toHaveLength(r.stages.length - 1);
    expect(total).toBeCloseTo(legs.reduce((a, b) => a + b, 0), 6);
    // 🔴 Sanity: no leg is absurd. A stage coordinate anchored to the
    // wrong country shows up here as a 2 000 km hop inside a route that
    // claims to be a week long.
    for (const leg of legs) {
      expect(leg / 1000, `${r.slug} has a leg of ${Math.round(leg / 1000)} km`).toBeLessThan(700);
    }
  }
});

test('formatKm rounds to whole kilometres', () => {
  expect(formatKm(84_213)).toBe('84 km');
  expect(formatKm(999)).toBe('1 km');
  expect(formatKm(0)).toBe('0 km');
});

// ── the month formatter, including the year-end wrap ─────────────────────

test('months read as ranges', () => {
  expect(formatMonths([4, 5, 6, 9, 10])).toBe('Apr–Jun, Sep–Oct');
  expect(formatMonths([6, 7, 8])).toBe('Jun–Aug');
  expect(formatMonths([7])).toBe('Jul');
  expect(formatMonths([])).toBe('');
  expect(formatMonths([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe('All year');
});

test('🔴 a winter route reads as one season, not two', () => {
  // [11,12,1,2,3] naively sorted prints "Jan–Mar, Nov–Dec" — two
  // seasons, where the route has one that crosses the year end.
  expect(formatMonths([11, 12, 1, 2, 3])).toBe('Nov–Mar');
});

test('routeShape pluralises', () => {
  const fr = CURATED_ROUTES.find((r) => r.slug === 'france-atlantic-coast')!;
  expect(routeShape(fr)).toBe('10 days · 9 nights · 1 country');
});

// ── JSON-LD ──────────────────────────────────────────────────────────────
//
// 🔴 The file this mirrors, src/lib/jsonld.ts, carries three scars:
// `provider` was an unknown field on 2 390 Campground nodes,
// `maximumAttendeeCapacity` published pitches as people, and raw OSM
// opening_hours was 93.7% invalid. All three are the same mistake —
// emitting a field without checking it belongs. These assert the
// negative.

test('🔴 the trip graph carries no field that is invalid on Trip', () => {
  for (const r of CURATED_ROUTES) {
    const g = routeTripGraph(r, `/routes/${r.slug}`) as Record<string, unknown>;
    // `provider` is valid on Action and CreativeWork, NOT on Trip.
    expect(g).not.toHaveProperty('provider');
    // `duration` is valid on Episode, Movie, Event — NOT on Trip. Which
    // is why a route's length in days is on the page and not in here.
    expect(g).not.toHaveProperty('duration');
    // We have no dates for a curated route, so these stay absent even
    // though they ARE legal on Trip.
    expect(g).not.toHaveProperty('arrivalTime');
    expect(g).not.toHaveProperty('departureTime');
    // We rate nothing (CAMP-53).
    expect(g).not.toHaveProperty('aggregateRating');
    expect(g).not.toHaveProperty('ratingValue');
  }
});

test('the trip graph says what it is and where it is', () => {
  const r = CURATED_ROUTES[0];
  const g = routeTripGraph(r, `/routes/${r.slug}`) as Record<string, any>;
  expect(g['@type']).toBe('TouristTrip');
  expect(g['@context']).toBe('https://schema.org');
  expect(g.name).toBe(r.name);
  expect(g.itinerary['@type']).toBe('ItemList');
  expect(g.itinerary.numberOfItems).toBe(r.stages.length);
  // Positions start at 1 and increase without gaps — the rule that,
  // broken, makes Google discard the whole list in silence.
  g.itinerary.itemListElement.forEach((item: any, i: number) => {
    expect(item.position).toBe(i + 1);
    expect(item.item['@type']).toBe('Place');
    expect(item.item.geo.latitude).toBe(r.stages[i].lat);
    expect(item.item.geo.longitude).toBe(r.stages[i].lon);
  });
});

// ── the library is a library, not a template farm ────────────────────────

test('the library is the size it claims to be, and is defensibly small', () => {
  // The card asked for ~50. Twelve is the deliberate answer; if somebody
  // later bulk-generates 40 more, the anti-template tests above start
  // failing first, and this one records the intent.
  expect(CURATED_ROUTES.length).toBeGreaterThanOrEqual(8);
  expect(CURATED_ROUTES.length).toBeLessThanOrEqual(12);
});

test('the library spans more than a couple of countries', () => {
  const countries = new Set(CURATED_ROUTES.flatMap((r) => r.countries));
  expect(countries.size).toBeGreaterThanOrEqual(10);
});

test('🔴 every country a route claims is in the EU-27 our database covers', () => {
  // Norway, Switzerland and the UK are outside the project's scope
  // (owner's decision, 24.09.2026) and we hold ZERO campsites in them —
  // measured. A route through them would render with empty stages all
  // the way down.
  const EU27 = new Set([
    'at', 'be', 'bg', 'hr', 'cy', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr',
    'hu', 'ie', 'it', 'lv', 'lt', 'lu', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk',
    'si', 'es', 'se',
  ]);
  for (const r of CURATED_ROUTES) {
    for (const c of r.countries) {
      expect(EU27.has(c), `${r.slug} claims ${c}, which is outside the EU-27`).toBe(true);
    }
  }
});
