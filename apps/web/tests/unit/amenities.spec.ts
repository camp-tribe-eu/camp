import { expect, test } from '@playwright/test';
import {
  ACCESSIBILITY_KEYS,
  AMENITY_KEYS,
  AMENITY_LABEL,
  AMENITY_LABEL_SHORT,
  GENERAL_AMENITY_KEYS,
} from '../../src/lib/api';

// 🔴 The bug this file exists to stop repeating.
//
// The home page counted recorded facilities against a hardcoded "of 5".
// CAMP-25 added greyWater, laundry, wheelchair and wheelchairFull and
// never touched the 5, so the page told readers "8 of 5 facilities
// recorded" — on the one page whose entire pitch is that we do not
// invent numbers. It shipped, no test saw it, and it was found by
// looking at the first visual baseline.
//
// The lesson is not "fix the 5". It is that any number describing a list
// has to be derived from that list, and that the derivation needs a test
// — the same rule the dependency guard learned when its workspace list
// was hand-written.

test('every amenity key has both labels', () => {
  for (const key of AMENITY_KEYS) {
    expect(AMENITY_LABEL[key], `no full label for ${key}`).toBeTruthy();
    expect(AMENITY_LABEL_SHORT[key], `no short label for ${key}`).toBeTruthy();
  }
});

test('the groups together are exactly the whole list, with no overlap', () => {
  expect([...GENERAL_AMENITY_KEYS, ...ACCESSIBILITY_KEYS].sort()).toEqual(
    [...AMENITY_KEYS].sort(),
  );
  for (const key of ACCESSIBILITY_KEYS) {
    expect(GENERAL_AMENITY_KEYS).not.toContain(key);
  }
});

test('🔴 the list has grown past five, which is why nothing may hardcode it', () => {
  // Not an arbitrary assertion: 5 was the number written into the home
  // page, and this is the fact that made it wrong.
  expect(AMENITY_KEYS.length).toBeGreaterThan(5);
  // And no duplicates, or a count would over-report.
  expect(new Set(AMENITY_KEYS).size).toBe(AMENITY_KEYS.length);
});
