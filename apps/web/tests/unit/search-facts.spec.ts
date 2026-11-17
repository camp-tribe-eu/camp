import { expect, test } from "@playwright/test";

import { packIndex, searchFacts, unpackIndex, type SearchDoc } from "@/lib/search";
import { factsLine } from "@/components/search-cards";

/** CAMP-442/3: type and «yes» amenities ride in the index and reach the card. */
const doc = (over: Partial<SearchDoc>): SearchDoc => ({
  kind: "campsite", name: "Camping Les Pins", path: "/camping/fr/vendee/camping-les-pins",
  country: "fr", region: "vendee", near: [], text: "", ...over,
});

test("round trip: type and amenities survive pack → unpack, in AMENITY_KEYS order", () => {
  const facts = searchFacts("paid", ["wifi", "shower", "electricity", "bogus"]);
  const [back] = unpackIndex(packIndex([doc(facts)]));
  expect(back.type).toBe("paid");
  expect(back.has).toEqual(["electricity", "shower", "wifi"]);
});

test("🔴 nothing recorded: no trailing element, no type, no line on the card", () => {
  const packed = packIndex([doc(searchFacts(null, []))]);
  expect(packed.d[0].length).toBe(4);
  const [back] = unpackIndex(packed);
  expect(back.type).toBeUndefined();
  expect(back.has).toBeUndefined();
  expect(factsLine(back)).toBeNull();
});

test("a row with facts but nothing near keeps near empty and still reads", () => {
  const [back] = unpackIndex(packIndex([doc(searchFacts("wild", []))]));
  expect(back.near).toEqual([]);
  expect(back.type).toBe("wild");
});

test("🔴 an older chunk without the element reads exactly as before", () => {
  const packed = packIndex([doc({})]);
  const [back] = unpackIndex(packed);
  expect(back.name).toBe("Camping Les Pins");
  expect(back.has).toBeUndefined();
});

test("card line: type, at most four amenities, then a count", () => {
  expect(
    factsLine({ type: "paid", has: ["electricity", "water", "shower", "toilets", "wifi", "laundry"] }),
  ).toMatch(/^Paid · .+ · .+ · .+ · .+ · \+2 more$/);
  expect(factsLine({ has: ["wifi"] })).not.toContain("Paid");
});
