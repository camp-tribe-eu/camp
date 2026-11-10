import { expect, test } from "@playwright/test";
import {
  ageInDays,
  isStale,
  MEASURED,
  MEASURED_CODES,
  measuredFor,
  percent,
  placementFileProblems,
  PLACEMENTS,
  rankOf,
  shareOf,
  STALE_AFTER_DAYS,
} from "../../src/lib/rental";
import { THRESHOLDS, SHAPES } from "../../src/data/rental/thresholds";

// CAMP-4 / CAMP-54 — the rental section's content rules, as assertions.
//
// 🔴 Two of these rules cannot be checked any other way.
//
// The first is "no page is another page with the name swapped". That is a
// property of the SET of pages, invisible from inside any one of them,
// and it is the difference between a section and a penalty on the whole
// domain (CAMP-130, and Google's March 2024 scaled-content policy).
//
// The second is that every superlative on a country page is still true.
// Those sentences are computed from a snapshot of our own database, and
// a re-import can quietly turn "the highest share in the Union" into a
// falsehood on a page nobody opens for a year. Recomputing them here
// means the build breaks instead.

test("the snapshot carries its own date and covers all 27 member states", () => {
  expect(MEASURED.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(MEASURED.total.countries).toBe(27);
  expect(Object.keys(MEASURED.countries)).toHaveLength(27);
});

test("no count exceeds the number of records it was counted from", () => {
  // 🔴 The check that catches a half-written or hand-edited data file —
  // the state in which the site still builds and still prints shares, some
  // of them above 100%.
  for (const code of MEASURED_CODES) {
    const row = MEASURED.countries[code];
    for (const [key, value] of Object.entries(row)) {
      if (key === "spots" || key === "regions") continue;
      expect(
        value,
        `${code}.${key} = ${value} of ${row.spots}`,
      ).toBeLessThanOrEqual(row.spots);
      expect(value, `${code}.${key}`).toBeGreaterThanOrEqual(0);
    }
    expect(row.regions).toBeGreaterThan(0);
  }
  const summed = MEASURED_CODES.reduce(
    (n, code) => n + MEASURED.countries[code].spots,
    0,
  );
  expect(summed).toBe(MEASURED.total.spots);
});

test("France is where our data is thickest, as its page claims", () => {
  // The French page is the only one that claims a source nobody else has.
  // DATAtourisme gives us websites, telephone numbers and official star
  // ratings; if a future import spreads those across the Union, the claim
  // stops being true and this fails.
  const fr = MEASURED.countries.fr;
  for (const field of ["website", "stars", "phone"] as const) {
    const total = MEASURED_CODES.reduce(
      (n, code) => n + MEASURED.countries[code][field],
      0,
    );
    expect(fr[field], `no French ${field} data at all`).toBeGreaterThan(0);
    expect(
      fr[field] / total,
      `${field} is no longer mostly French`,
    ).toBeGreaterThan(0.9);
  }
});

// ── Honesty of the arithmetic ──────────────────────────────────────────

test("percentages are never rounded in the flattering direction", () => {
  // 0.5 must not become "50.0%" by luck and 0.4999 must not become 50%.
  expect(percent(0.4999)).toBe("49.9%");
  expect(percent(0.5)).toBe("50.0%");
  expect(percent(0.99999)).toBe("99.9%");
  expect(percent(1)).toBe("100.0%");
  expect(percent(0)).toBe("0.0%");
});

test("a share is computed over the country that owns it", () => {
  const de = measuredFor("de");
  expect(de).not.toBeNull();
  const row = de as NonNullable<typeof de>;
  expect(shareOf(row, "rvPark")).toBeCloseTo(row.rvPark / row.spots, 10);
  expect(shareOf(row, "vehicleOnly")).toBeCloseTo(
    (row.rvPark + row.camperStop) / row.spots,
    10,
  );
});

test("the snapshot says how old it is rather than pretending to be today", () => {
  const measured = new Date(`${MEASURED.measuredAt}T00:00:00Z`);
  expect(ageInDays(measured)).toBe(0);
  const later = new Date(
    measured.getTime() + (STALE_AFTER_DAYS + 1) * 86_400_000,
  );
  expect(isStale(later)).toBe(true);
  expect(isStale(measured)).toBe(false);
});

test("rankOf refuses to rank a country it has no row for", () => {
  expect(rankOf("xx", "spots", "count")).toBeNull();
});

// ── The commercial slot, and the thresholds ────────────────────────────

test("there are no affiliate placements, and the file is valid anyway", () => {
  // 🔴 The shipped state, asserted so that a placement added later is a
  // deliberate act with a test to update, not a drive-by edit. The second
  // half matters more: the validator runs over whatever the file holds,
  // so a malformed placement fails here rather than at render time.
  expect(PLACEMENTS).toEqual([]);
  expect(placementFileProblems()).toEqual([]);
});

test("every threshold cites somebody with the authority to set it", () => {
  expect(THRESHOLDS.length).toBeGreaterThanOrEqual(4);
  for (const t of THRESHOLDS) {
    expect(t.source.url, t.id).toMatch(/^https:\/\//);
    expect(
      t.decides.length,
      `${t.id} says what it decides`,
    ).toBeGreaterThanOrEqual(2);
  }
  // Every shape points at a threshold that exists — a dangling id would
  // render an empty "Read first:" line and nothing would fail.
  const ids = new Set(THRESHOLDS.map((t) => t.id));
  for (const s of SHAPES) {
    expect(ids.has(s.checkFirst), `${s.id} points at a missing threshold`).toBe(
      true,
    );
  }
});
