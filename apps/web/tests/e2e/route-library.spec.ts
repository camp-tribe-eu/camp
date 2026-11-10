import { expect, test } from "@playwright/test";

import {
  validateRoute,
  type CuratedRoute,
} from "../../src/lib/route-types";
import {
  CAMPSITES_PER_STAGE,
  ODBL_SUBSTANTIAL_FLOOR,
  routeShape,
} from "../../src/lib/routes";
import {
  routeGeometryProvider,
  straightLineLegs,
} from "../../src/lib/route-geometry";
import { routeTripGraph } from "../../src/lib/route-jsonld";
import {
  FUEL_BULLETIN_DATE,
  routeFuelPrices,
  SERVICE_KINDS,
  SERVICES_PER_KIND,
  WATER_NEAR_KINDS,
} from "../../src/lib/route-services";

/**
 * CAMP-3 / CAMP-45 / CAMP-479 — правила, яким мусить відповідати
 * бібліотека маршрутів.
 *
 * 🔴 ЦІ ТЕСТИ ПЕРЕЇХАЛИ З ЮНІТІВ, І ЦЕ НЕ ПЕРЕЙМЕНУВАННЯ ТЕКИ.
 *
 * Поки маршрути були файлами в репозиторії, перевіряти їх можна було
 * без мережі: дані лежали поруч із тестом. Після CAMP-479 вони живуть у
 * базі, і єдиний чесний спосіб їх перевірити — спитати те саме API, з
 * якого будується сторінка. Лишити юніт над копією даних означало б
 * стерегти копію, а не те, що бачить читач.
 *
 * 🔴 ЖОДНЕ ПРАВИЛО НЕ ЗНИКЛО ПРИ ПЕРЕЇЗДІ. Їх двадцять два, і всі вони
 * про те, що стає видно вже після шкоди: маршрут-шаблон із підміненими
 * назвами, сторінка з дорожньою цифрою, якої ми не вміємо порахувати,
 * і вибірка, широка настільки, що перестає бути Produced Work за ODbL.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

let ROUTES: CuratedRoute[] = [];

/** Один маршрут із API; `null` на 404, виняток на будь-що інше. */
async function getRoute(slug: string): Promise<CuratedRoute | null> {
  const res = await fetch(`${API}/routes/content/${encodeURIComponent(slug)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /routes/content/${slug} → ${res.status}`);
  return (await res.json()) as CuratedRoute;
}

test.beforeAll(async () => {
  const url = `${API}/routes/content`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const body = (await res.json()) as { routes?: CuratedRoute[] };
  ROUTES = body.routes ?? [];

  // 🔴 ЗНАМЕННИК. Порожня бібліотека зробила б кожне правило нижче
  // істинним ні про що: «жодні два маршрути не однакові» над нулем
  // маршрутів — зелений тест, який нічого не стереже.
  if (ROUTES.length === 0) {
    throw new Error(
      `${url} віддав 200 і жодного маршруту. Правила нижче перевіряти ` +
        `нема на чому — це збій фікстури, а не чистий прогін.`,
    );
  }
});

test("every published route passes its own validator", async () => {
  const problems = ROUTES.flatMap(validateRoute);
  expect(problems, problems.join("\n")).toEqual([]);
});

test("slugs are unique, or two routes share a URL", async () => {
  const slugs = ROUTES.map((r) => r.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
});

test("ids are unique too", async () => {
  const ids = ROUTES.map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("getRoute finds every route by its slug and nothing else", async () => {
  for (const r of ROUTES) expect((await getRoute(r.slug))?.id).toBe(r.id);
  expect(await getRoute("no-such-route")).toBeNull();
  expect(await getRoute("")).toBeNull();
});

test("🔴 no two routes share an opening sentence", async () => {
  const openings = ROUTES.map((r) => r.intro[0]);
  expect(new Set(openings).size).toBe(openings.length);
});

test("🔴 no two routes share a summary", async () => {
  const summaries = ROUTES.map((r) => r.summary);
  expect(new Set(summaries).size).toBe(summaries.length);
});

test('🔴 no two routes share a "what the driving is like" paragraph', async () => {
  const roads = ROUTES.map((r) => r.roads);
  expect(new Set(roads).size).toBe(roads.length);
});

test("🔴 no two stages anywhere in the library share a reason for stopping", async () => {
  // The per-stage sentence is where a template shows up first: it is the
  // field a bulk author would fill with "A good place to break the
  // journey." twelve times.
  const whys = ROUTES.flatMap((r) => r.stages.map((s) => s.why));
  const seen = new Map<string, number>();
  for (const w of whys) seen.set(w, (seen.get(w) ?? 0) + 1);
  const repeated = [...seen.entries()].filter(([, n]) => n > 1).map(([w]) => w);
  expect(
    repeated,
    `repeated stage descriptions:\n${repeated.join("\n")}`,
  ).toEqual([]);
});

test("🔴 no two stages in the library sit at the same coordinate", async () => {
  const keys = ROUTES.flatMap((r) =>
    r.stages.map((s) => `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`),
  );
  expect(new Set(keys).size).toBe(keys.length);
});

// ── 🔴 the ODbL boundary ─────────────────────────────────────────────────

test("🔴 no route page can show a Substantial number of campsites", async () => {
  for (const r of ROUTES) {
    const most = r.stages.length * CAMPSITES_PER_STAGE;
    expect(
      most,
      `${r.slug} could show ${most} campsites, and our own legal note puts the ` +
        `Substantial line at ${ODBL_SUBSTANTIAL_FLOOR}`,
    ).toBeLessThan(ODBL_SUBSTANTIAL_FLOOR);
  }
});

test("every route says where its campsite data comes from", async () => {
  for (const r of ROUTES) {
    expect(
      r.attribution.length,
      `${r.slug} has no attribution`,
    ).toBeGreaterThan(40);
  }
});

// 🔴 CAMP-113 put a SECOND kind of OpenStreetMap object on the page, and
// the Substantial line is drawn over objects, not over campsites.
//
// The test above checks the campsites alone, which was the whole page
// when it was written. A seven-stage route now also shows the nearest of
// each of seven service kinds. At one each that is 49, for 77 objects;
// at two each it would be 126, over our own floor, on the page that
// prints the claim in its own footer. This is the test that fails the
// day somebody adds an eighth kind or decides one of each looks thin.
//
// 🔴 CAMP-254 put a THIRD in it: beside a disposal point the page names the
// distance to the nearest drinking water, which is one more OSM object per
// stage (one per kind in `WATER_NEAR_KINDS`). Only the distance is printed,
// not the object — but this line is drawn over objects USED, so it is
// counted. The longest route, seven stages, is now 7 x (4 + 9 + 1) = 98.
test("🔴 no route page can show a Substantial number of OSM objects at all", async () => {
  for (const r of ROUTES) {
    const campsites = r.stages.length * CAMPSITES_PER_STAGE;
    const services = r.stages.length * SERVICE_KINDS.length * SERVICES_PER_KIND;
    const water = r.stages.length * WATER_NEAR_KINDS.length;
    expect(
      campsites + services + water,
      `${r.slug} could show ${campsites} campsites, ${services} services and ` +
        `${water} drinking-water distances, ${campsites + services + water} ` +
        `objects, against a Substantial line of ${ODBL_SUBSTANTIAL_FLOOR}`,
    ).toBeLessThan(ODBL_SUBSTANTIAL_FLOOR);
  }
});

// 🔴 The API refuses to answer about more stages than the ODbL floor
// allows, and it is right to. This is the test that stops such a route
// reaching the repository in the first place, so the refusal stays
// theoretical — review found the previous arithmetic letting a
// nine-stage route pass both suites and then lose its ninth stage
// silently, with the page printing an absence about a stop nothing had
// looked at.
test("🔴 no route has more stages than the services endpoint will answer about", async () => {
  const perStage = CAMPSITES_PER_STAGE + SERVICE_KINDS.length;
  const mostStages = Math.floor((ODBL_SUBSTANTIAL_FLOOR - 1) / perStage);
  for (const r of ROUTES) {
    expect(
      r.stages.length,
      `${r.slug} has ${r.stages.length} stages; at ${perStage} objects each ` +
        `the API will only answer about ${mostStages}`,
    ).toBeLessThanOrEqual(mostStages);
  }
});

// ── 🔴 CAMP-113: the mutations that survived the first version ──────────

test("🔴 fuel prices are per country, never per station", async () => {
  const route = ROUTES.find((r) => r.countries.includes("fr"));
  expect(route, "no French route to check against").toBeTruthy();
  const prices = routeFuelPrices(route!);
  expect(prices.length).toBeGreaterThan(0);
  for (const p of prices) {
    expect(p.code).toMatch(/^[A-Z]{2}$/);
    expect(p.diesel === null || p.diesel > 0).toBe(true);
    expect(p).not.toHaveProperty("osmRef");
  }
  // And the week it was measured is available to print beside them.
  expect(FUEL_BULLETIN_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

// ── 🔴 the constraint: no invented road figures ──────────────────────────

test("🔴 no route page can print a road distance today", async () => {
  // The page reads `road.available` and nothing else. If a provider is
  // ever wired in, this test is the thing that says so out loud rather
  // than letting road figures appear unannounced.
  for (const r of ROUTES.slice(0, 3)) {
    const result = await routeGeometryProvider().road(r.stages);
    expect(result.available, `${r.slug} unexpectedly has road geometry`).toBe(
      false,
    );
  }
});

// ── straight-line measurement ────────────────────────────────────────────

test("the legs are one fewer than the stages, and sum to the total", async () => {
  for (const r of ROUTES) {
    const { legs, total } = straightLineLegs(r.stages);
    expect(legs).toHaveLength(r.stages.length - 1);
    expect(total).toBeCloseTo(
      legs.reduce((a, b) => a + b, 0),
      6,
    );
    // 🔴 Sanity: no leg is absurd. A stage coordinate anchored to the
    // wrong country shows up here as a 2 000 km hop inside a route that
    // claims to be a week long.
    for (const leg of legs) {
      expect(
        leg / 1000,
        `${r.slug} has a leg of ${Math.round(leg / 1000)} km`,
      ).toBeLessThan(700);
    }
  }
});

test("routeShape pluralises", async () => {
  const fr = ROUTES.find((r) => r.slug === "france-atlantic-coast")!;
  expect(routeShape(fr)).toBe("10 days · 9 nights · 1 country");
});

// ── JSON-LD ──────────────────────────────────────────────────────────────
//
// 🔴 The file this mirrors, src/lib/jsonld.ts, carries three scars:
// `provider` was an unknown field on 2 390 Campground nodes,
// `maximumAttendeeCapacity` published pitches as people, and raw OSM
// opening_hours was 93.7% invalid. All three are the same mistake —
// emitting a field without checking it belongs. These assert the
// negative.

test("🔴 the trip graph carries no field that is invalid on Trip", async () => {
  for (const r of ROUTES) {
    const g = routeTripGraph(r, `/routes/${r.slug}`) as Record<string, unknown>;
    // `provider` is valid on Action and CreativeWork, NOT on Trip.
    expect(g).not.toHaveProperty("provider");
    // `duration` is valid on Episode, Movie, Event — NOT on Trip. Which
    // is why a route's length in days is on the page and not in here.
    expect(g).not.toHaveProperty("duration");
    // We have no dates for a curated route, so these stay absent even
    // though they ARE legal on Trip.
    expect(g).not.toHaveProperty("arrivalTime");
    expect(g).not.toHaveProperty("departureTime");
    // We rate nothing (CAMP-53).
    expect(g).not.toHaveProperty("aggregateRating");
    expect(g).not.toHaveProperty("ratingValue");
  }
});

test("the trip graph says what it is and where it is", async () => {
  const r = ROUTES[0];
  // 🔴 `any` тут свідомий, і ось чому він нічого не ховає: це JSON-LD,
  // дерево довільної глибини, і точний тип довелось би кастити на
  // КОЖНОМУ кроці всередину. Тест усе одно стверджує ЗНАЧЕННЯ на кожному
  // рівні — `@type`, `position`, `numberOfItems`, координати, — тож
  // типізація тут не спіймала б нічого, а каст на кожному рядку зробив
  // би перевірку нечитною. Правило лишається ввімкненим на весь проєкт;
  // це названий виняток, а не вимкнений сторож.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = routeTripGraph(r, `/routes/${r.slug}`) as Record<string, any>;
  expect(g["@type"]).toBe("TouristTrip");
  expect(g["@context"]).toBe("https://schema.org");
  expect(g.name).toBe(r.name);
  expect(g.itinerary["@type"]).toBe("ItemList");
  expect(g.itinerary.numberOfItems).toBe(r.stages.length);
  // Positions start at 1 and increase without gaps — the rule that,
  // broken, makes Google discard the whole list in silence.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  g.itinerary.itemListElement.forEach((item: any, i: number) => {
    expect(item.position).toBe(i + 1);
    expect(item.item["@type"]).toBe("Place");
    expect(item.item.geo.latitude).toBe(r.stages[i].lat);
    expect(item.item.geo.longitude).toBe(r.stages[i].lon);
  });
});

// ── the library is a library, not a template farm ────────────────────────

test("the library is the size it claims to be, and is defensibly small", async () => {
  // The card asked for ~50. Twelve is the deliberate answer; if somebody
  // later bulk-generates 40 more, the anti-template tests above start
  // failing first, and this one records the intent.
  expect(ROUTES.length).toBeGreaterThanOrEqual(8);
  expect(ROUTES.length).toBeLessThanOrEqual(12);
});

test("the library spans more than a couple of countries", async () => {
  const countries = new Set(ROUTES.flatMap((r) => r.countries));
  expect(countries.size).toBeGreaterThanOrEqual(10);
});

test("🔴 every country a route claims is in the EU-27 our database covers", async () => {
  // Norway, Switzerland and the UK are outside the project's scope
  // (owner's decision, 24.09.2026) and we hold ZERO campsites in them —
  // measured. A route through them would render with empty stages all
  // the way down.
  const EU27 = new Set([
    "at",
    "be",
    "bg",
    "hr",
    "cy",
    "cz",
    "dk",
    "ee",
    "fi",
    "fr",
    "de",
    "gr",
    "hu",
    "ie",
    "it",
    "lv",
    "lt",
    "lu",
    "mt",
    "nl",
    "pl",
    "pt",
    "ro",
    "sk",
    "si",
    "es",
    "se",
  ]);
  for (const r of ROUTES) {
    for (const c of r.countries) {
      expect(
        EU27.has(c),
        `${r.slug} claims ${c}, which is outside the EU-27`,
      ).toBe(true);
    }
  }
});
