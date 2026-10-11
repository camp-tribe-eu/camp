import { expect, test } from "@playwright/test";
import {
  SATELLITE_SOURCES,
  SATELLITE_NOT_YET,
  satelliteFor,
  whySatelliteUnavailable,
  rasterSourceSpec,
} from "../../src/lib/satellite-sources";

// CAMP-221 — the satellite base layer, checked without a map.
//
// 🔴 WHY THIS FILE EXISTS. Before 11.10.2026 there was no test with the
// word "satellite" in it anywhere under `tests/`, and the layer shipped a
// defect that only a measurement could find: the Spanish WMTS answers a
// tile over FRANCE with HTTP 200 and 1561 bytes of flat green fill, while
// the French one answers a Spanish tile with 404. So a reader driving
// Spain → France with the layer on saw that fill credited to
// "© IGN España" — a national mapping agency credited with an image it
// never served. Under CC BY that is a licence breach as well as a lie.
//
// Every case below is written so that deleting the line it covers makes
// it fail. Checked by mutation, one at a time — see the card.

const ES = "es";
const FR = "fr";
/** A country we have a source for must stay findable by its own code. */
const COVERED = SATELLITE_SOURCES.map((s) => s.country);

test("the data we ship covers exactly the countries the module thinks it does", () => {
  // Not a tautology: it pins the set, so adding a source without adding a
  // test is visible here rather than six months later on the map.
  expect(COVERED.sort()).toEqual([ES, FR].sort());
});

test("one country on screen gets that country’s own source", () => {
  expect(satelliteFor([ES])?.country).toBe(ES);
  expect(satelliteFor([FR])?.country).toBe(FR);
});

test("case does not decide the answer", () => {
  expect(satelliteFor(["ES"])?.country).toBe(ES);
  expect(satelliteFor(["Fr"])?.country).toBe(FR);
});

test("the same country repeated is still one country", () => {
  expect(satelliteFor([ES, ES, ES])?.country).toBe(ES);
});

// 🔴 THE DEFECT THIS FILE WAS WRITTEN FOR.
//
// The first implementation filtered SATELLITE_SOURCES by the countries on
// screen and returned `covered[0]`, with a comment calling it "the one
// the view is mostly in". There is no "mostly": `covered` is in the order
// of the data file. A view holding both countries therefore returned
// whichever entry was typed first — and that source's service answers the
// other country's tiles with a flat fill under its own credit.
test("a view crossing a border gets NO imagery, in either order", () => {
  expect(satelliteFor([ES, FR])).toBeNull();
  expect(satelliteFor([FR, ES])).toBeNull();
});

test("a border view says why, and the sentence is reachable", () => {
  // Reachable matters: the old wording lived behind a branch that could
  // never run, because the function it guarded returned a source instead
  // of null for exactly this input.
  const why = whySatelliteUnavailable([ES, FR]);
  expect(why).toContain("crosses a border");
  expect(satelliteFor([ES, FR])).toBeNull();
});

// 🔴 THE CASE THE CI FIXTURE ACTUALLY IS, and the one my first rewrite got
// wrong. The map fixture shows Croatia and Slovenia — two countries, neither
// covered. Saying "this view crosses a border" is true and useless: it
// implies that zooming into one of them would show photographs. The reason
// is that we have no imagery for either.
test("two uncovered countries are told the real reason, not the border one", () => {
  const why = whySatelliteUnavailable(["hr", "si"]);
  expect(why).not.toContain("crosses a border");
  expect(why).toContain("HR");
  expect(why).toContain("SI");
});

test("a covered pair IS told it crosses a border", () => {
  expect(whySatelliteUnavailable([ES, FR])).toContain("crosses a border");
});

test("a mixed pair names the uncovered one, not the covered one", () => {
  const why = whySatelliteUnavailable([ES, "pl"]);
  expect(why).not.toContain("crosses a border");
  expect(why).toContain("PL");
});

test("no countries on screen is not an error, it is a zoom level", () => {
  expect(satelliteFor([])).toBeNull();
  expect(whySatelliteUnavailable([])).toContain("Zoom in");
});

test("a country with no source gets no source", () => {
  expect(satelliteFor(["pl"])).toBeNull();
});

// 🔴 "WE LOOKED AND THERE IS NONE" IS NOT "WE HAVE NOT LOOKED".
//
// The first version printed "No open orthophoto service we can use covers
// X yet" for every country without a source — twenty-five of them — when
// exactly one had been researched. Asserting a negative result nobody
// measured is the same fault this repository keeps finding in its guards,
// moved onto the page where a reader believes it.
test("a researched country says what was found", () => {
  const researched = SATELLITE_NOT_YET.map((n) => n.country);
  expect(researched.length).toBeGreaterThan(0);
  const why = whySatelliteUnavailable([researched[0]]);
  expect(why).toContain("No orthophoto service we can use covers");
});

test("an unresearched country admits nobody looked", () => {
  const unresearched = "pl";
  expect(SATELLITE_NOT_YET.some((n) => n.country === unresearched)).toBe(false);
  const why = whySatelliteUnavailable([unresearched]);
  expect(why).toContain("have not yet looked");
  expect(why).not.toContain("No orthophoto service we can use covers");
});

test("a covered country is never told imagery is missing", () => {
  for (const c of COVERED) {
    expect(whySatelliteUnavailable([c])).not.toContain("have not yet looked");
  }
});

// 🔴 The credit must come from the record, and the component must have
// nowhere to write one of its own. The guard used to prove this by
// grepping the .tsx for `attribution: source.attribution` — and a
// commented-out line still matches a grep.
test("the raster spec carries the source’s own credit, verbatim", () => {
  for (const source of SATELLITE_SOURCES) {
    const spec = rasterSourceSpec(source);
    expect(spec.attribution).toBe(source.attribution);
    expect(spec.tiles).toEqual([source.tiles]);
    expect(spec.type).toBe("raster");
    expect(spec.maxzoom).toBe(source.maxzoom);
  }
});

test("every shipped credit names its provider", () => {
  for (const source of SATELLITE_SOURCES) {
    expect(source.attribution).toContain(source.providerShort);
    expect(source.attribution.length).toBeGreaterThan(20);
  }
});

test("every shipped source carries the licence and where it was read", () => {
  for (const source of SATELLITE_SOURCES) {
    expect(source.licenceVerbatim.trim()).not.toBe("");
    expect(source.readFrom).toMatch(/^https:\/\//);
    expect(source.readField.trim()).not.toBe("");
  }
});

test("a country is never both enabled and not enabled", () => {
  const enabled = new Set(SATELLITE_SOURCES.map((s) => s.country));
  for (const n of SATELLITE_NOT_YET) {
    expect(enabled.has(n.country)).toBe(false);
  }
});
