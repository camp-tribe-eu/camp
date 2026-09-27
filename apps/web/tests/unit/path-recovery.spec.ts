import { expect, test } from '@playwright/test';
import { readPath } from '@/components/path-recovery';
import type { Place } from '@/lib/api';

// CAMP-143 — the URL guesser on the 404, which had no test at all.
//
// 🔴 Written while moving `places` off a prop and onto a fetched file.
// The move is the kind that looks harmless and is not: `readPath` is the
// only thing that turns a dead URL into a useful page, and it now runs
// against data that arrives later and may not arrive at all. So the
// behaviour it is supposed to have is written down here first, where a
// change can fail, rather than living in the shape of a prop.
//
// What is NOT tested here, said plainly rather than left to be assumed:
// the fetch itself. That lives in an effect in a client component, and a
// test that mocks `fetch` and asserts it was called proves only that the
// mock works. The claim worth holding — one static file instead of
// 65 435 embedded copies — is a property of the BUILD, and it is
// measured on the build output, not here.

const places: Place[] = [
  {
    country: 'si',
    name: 'Slovenia',
    regions: [
      { slug: 'radovljica', name: 'Radovljica', spots: 12 },
      { slug: 'bovec', name: 'Bovec', spots: 7 },
    ],
  },
  {
    country: 'fr',
    name: 'France',
    regions: [{ slug: 'calvados', name: 'Calvados', spots: 96 }],
  },
];

test('recognises country and region, and names what is missing', () => {
  const g = readPath('/camping/si/radovljica/some-camp', places);
  expect(g.country?.country, 'country').toBe('si');
  expect(g.region?.slug, 'region').toBe('radovljica');
  expect(g.missing, 'the slug that matched nothing').toBe('some-camp');
});

test('a dead region still recovers the country', () => {
  const g = readPath('/camping/si/nowhere-at-all', places);
  expect(g.country?.country, 'country').toBe('si');
  expect(g.region, 'region').toBeUndefined();
  // 🔴 The region slug is what is missing here, not a campsite slug.
  // Getting this wrong would show the reader "we could not find
  // undefined", which is worse than saying nothing.
  expect(g.missing, 'the part that matched nothing').toBe('nowhere-at-all');
});

test('gives up on a path that is not a campsite URL', () => {
  // The component relies on this: it skips the fetch entirely for these,
  // so if readPath ever started returning a country for them the two
  // would disagree about what is recoverable.
  for (const p of ['/', '/guides/x', '/tools', '/map', '/camping']) {
    expect(readPath(p, places), p).toEqual({});
  }
});

test('an unknown country is not half-recovered', () => {
  // `xx` is not ours. Returning a partial guess here would put a link to
  // /camping/xx on the page — a second 404 offered as the fix for the
  // first.
  expect(readPath('/camping/xx/anything', places), 'unknown country').toEqual(
    {},
  );
});

test('case in the URL does not decide whether we help', () => {
  const g = readPath('/camping/SI/Radovljica/Camp', places);
  expect(g.country?.country, 'country').toBe('si');
  expect(g.region?.slug, 'region').toBe('radovljica');
});

test('survives an empty places list instead of throwing', () => {
  // 🔴 This is the state the component is in before the fetch lands, and
  // the state it stays in forever if the file 404s. It must be silent,
  // not a client-side exception on a page that is already an apology.
  expect(readPath('/camping/si/radovljica/x', []), 'no places yet').toEqual({});
});
