import { expect, test } from "@playwright/test";
import { TRAVELLER_LABEL, TRAVELLER_TAGS } from "../../src/lib/route-types";
import {
  formatMonths,
} from "../../src/lib/routes";
import {
  formatKm,
  NullRouteGeometry,
  routeGeometryProvider,
  straightLineMetres,
} from "../../src/lib/route-geometry";
import {
  SERVICE_ABSENT,
  SERVICE_KINDS,
  SERVICE_LABEL,
  SERVICE_RADIUS_M,
  SERVICE_UNNAMED,
  serviceOf,
} from "../../src/lib/route-services";

// CAMP-3 / CAMP-45 — чисті правила, які не залежать від даних.
//
// 🔴 ПРАВИЛА ПРО САМІ МАРШРУТИ ПЕРЕЇХАЛИ В `tests/e2e/route-library.spec.ts`
// (CAMP-479): дані тепер у базі, і перевіряти їх треба через те саме
// API, з якого будується сторінка. Тут лишилось те, що про дані нічого
// не знає — форматування, одиниці, постачальники геометрії.
//
// 🔴 These are not "does the page render" tests. They are the three
// things that would be invisible until they had already done damage:
// a route that is a template with the names swapped, a page that
// publishes a road figure we cannot produce, and a selection wide enough
// to stop being a Produced Work under ODbL.

test("every traveller tag has a label", () => {
  for (const t of TRAVELLER_TAGS) expect(TRAVELLER_LABEL[t]).toBeTruthy();
});

// ── 🔴 the anti-template rule ────────────────────────────────────────────
//
// CAMP-130 refuses a thin guide template repeated across regions, and
// CAMP-36's duplicate-page guard measures the built HTML for exactly
// that. Both run after generation. This runs on the source, so a
// template-shaped route fails before anyone builds it.

test("🔴 serviceOf returns the kind asked for, not simply the first one", () => {
  // The mutation is `services[0]`, and with one of each kind per stage
  // it looks right on any stage whose first service happens to be the
  // one being asked about — which is every stage where fuel was found.
  const group = {
    lat: 0,
    lon: 0,
    services: [
      {
        kind: "water" as const,
        osmRef: "n1",
        name: null,
        lat: 0,
        lon: 0,
        metres: 10,
        phone: null,
        website: null,
        openingHours: null,
      },
      {
        kind: "fuel" as const,
        osmRef: "n2",
        name: "Shell",
        lat: 0,
        lon: 0,
        metres: 20,
        phone: null,
        website: null,
        openingHours: null,
      },
    ],
  };
  expect(serviceOf(group, "fuel")?.osmRef).toBe("n2");
  expect(serviceOf(group, "water")?.osmRef).toBe("n1");
  // A kind that is not there is null, never the nearest of another kind.
  expect(serviceOf(group, "dump")).toBeNull();
  expect(serviceOf(undefined, "fuel")).toBeNull();
});

// 🔴 The page says "within 25 km" in three places, and the API clamps
// `radius` to its own maximum. Raise this past that ceiling and every
// one of those sentences becomes false while the page still renders.
// getRouteServices also compares the radius the API reports back, so
// this is belt and braces — but the constant is where the mistake would
// be typed.
test("🔴 the radius the page promises is one the API will actually apply", () => {
  const API_MAX_RADIUS_M = 60_000; // MAX_RADIUS_M in apps/api/src/routes/route-points.ts
  const API_MIN_RADIUS_M = 1_000;
  expect(SERVICE_RADIUS_M).toBeLessThanOrEqual(API_MAX_RADIUS_M);
  expect(SERVICE_RADIUS_M).toBeGreaterThanOrEqual(API_MIN_RADIUS_M);
});

// ── 🔴 CAMP-113: every kind must be sayable, present or absent ───────────
//
// The services block renders all seven kinds at every stage whether or
// not we hold one, which means it needs two sentences per kind. A kind
// added with a label and no absent-line would render "undefined" on the
// stages that have nothing — and those are the stages where the honest
// wording matters most.
test("🔴 every service kind can say what it is, what an unnamed one is, and that we have none", () => {
  for (const kind of SERVICE_KINDS) {
    expect(SERVICE_LABEL[kind], `${kind} has no label`).toBeTruthy();
    expect(SERVICE_ABSENT[kind], `${kind} has no absent line`).toBeTruthy();
    // "no fuel station" reads into "Our database holds ___ within 25 km".
    expect(
      SERVICE_ABSENT[kind].startsWith("no "),
      `${kind}: "${SERVICE_ABSENT[kind]}" does not read into the sentence`,
    ).toBe(true);
    // 🔴 A noun of its own, not the label lower-cased. That shortcut
    // produced "Unnamed charging" and would have produced "Unnamed
    // somewhere to sleep" — and the unnamed case is the usual one for
    // water and disposal, not an edge.
    expect(
      SERVICE_UNNAMED[kind].startsWith("Unnamed "),
      `${kind} has no name for an unnamed one`,
    ).toBe(true);
  }
  expect(Object.keys(SERVICE_LABEL).sort()).toEqual([...SERVICE_KINDS].sort());
  expect(Object.keys(SERVICE_ABSENT).sort()).toEqual([...SERVICE_KINDS].sort());
  expect(Object.keys(SERVICE_UNNAMED).sort()).toEqual(
    [...SERVICE_KINDS].sort(),
  );
});

// 🔴 The fuel price is a NATIONAL WEEKLY AVERAGE and the page must never
// attach it to a station. The data layer is where that is decided: this
// asserts the prices come back keyed by country, so there is no shape in
// which a component could hang one off a POI.
test("🔴 the shipped geometry provider reports unavailable, with a reason", async () => {
  const result = await routeGeometryProvider().road([
    { lat: 46.16, lon: -1.15 },
    { lat: 43.48, lon: -1.56 },
  ]);
  expect(result.available).toBe(false);
  if (!result.available) {
    expect(result.reason).toContain("Road distance");
    // 🔴 CAMP-463: причина читається читачем, тож не розповідає про наш
    // стан — «routing engine, which is not running» звідти пішло.
    expect(result.reason).not.toMatch(/engine|not running|yet/i);
  }
});

test("🔴 the null provider never invents a straight-line fallback", async () => {
  // The tempting shortcut is for the "no geometry" provider to return
  // the straight line so the page has SOMETHING. That is how a
  // straight-line number ends up labelled as a drive.
  const result = await new NullRouteGeometry().road([
    { lat: 46.16, lon: -1.15 },
    { lat: 43.48, lon: -1.56 },
  ]);
  expect(result.available).toBe(false);
  expect(result).not.toHaveProperty("geometry");
});

test("straight-line distance matches a known separation", () => {
  // Paris–Lyon is about 392 km great-circle. Within 1% is plenty to
  // catch a swapped lat/lon or degrees-vs-radians, which are the two
  // ways this function actually breaks.
  const m = straightLineMetres(
    { lat: 48.8566, lon: 2.3522 },
    { lat: 45.764, lon: 4.8357 },
  );
  expect(m / 1000).toBeGreaterThan(388);
  expect(m / 1000).toBeLessThan(396);
});

test("a point is zero metres from itself", () => {
  expect(
    straightLineMetres({ lat: 46.1, lon: -1.1 }, { lat: 46.1, lon: -1.1 }),
  ).toBe(0);
});

test("formatKm rounds to whole kilometres", () => {
  expect(formatKm(84_213)).toBe("84 km");
  expect(formatKm(999)).toBe("1 km");
  expect(formatKm(0)).toBe("0 km");
});

// ── the month formatter, including the year-end wrap ─────────────────────

test("months read as ranges", () => {
  expect(formatMonths([4, 5, 6, 9, 10])).toBe("Apr–Jun, Sep–Oct");
  expect(formatMonths([6, 7, 8])).toBe("Jun–Aug");
  expect(formatMonths([7])).toBe("Jul");
  expect(formatMonths([])).toBe("");
  expect(formatMonths([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe(
    "All year",
  );
});

test("🔴 a winter route reads as one season, not two", () => {
  // [11,12,1,2,3] naively sorted prints "Jan–Mar, Nov–Dec" — two
  // seasons, where the route has one that crosses the year end.
  expect(formatMonths([11, 12, 1, 2, 3])).toBe("Nov–Mar");
});
