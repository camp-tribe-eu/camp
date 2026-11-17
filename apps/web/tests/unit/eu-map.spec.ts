import { expect, test } from "@playwright/test";
import { euMapRows } from "@/lib/eu-map";

/** CAMP-441 (35): one circle per country on /camping, from the same index as the country maps. */
const r = (country: string, slug: string, count: number, lon: number, lat: number) => ({
  country, region: slug, slug, count, lon, lat, minLon: lon - 1, minLat: lat - 1, maxLon: lon + 1, maxLat: lat + 1,
});
const tiles = [
  { code: "fr", name: "France" },
  { code: "fi", name: "Finland" },
];

test("sums regions per country, weights the centre by campsites, links to the country page", () => {
  const rows = euMapRows([r("FR", "a", 300, 0, 45), r("FR", "b", 100, 4, 49)], tiles);
  expect(rows).toHaveLength(1);
  const fr = rows[0];
  expect(fr.count).toBe(400);
  expect(fr.lon).toBeCloseTo(1); // (0×300 + 4×100) / 400
  expect(fr.lat).toBeCloseTo(46);
  expect([fr.minLon, fr.maxLon]).toEqual([-1, 5]);
  expect(fr.href).toBe("/camping/fr");
  expect(fr.region).toBe("France");
});

test("🔴 the map shows the tiles' set: Åland folds into Finland, a country without a tile gets no circle", () => {
  const rows = euMapRows([r("AX", "aland", 19, 20, 60), r("FI", "x", 81, 25, 62), r("CY", "c", 60, 33, 35)], tiles);
  expect(rows.map((x) => x.slug)).toEqual(["fi"]);
  expect(rows[0].count).toBe(100);
});
