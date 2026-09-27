import { expect, test } from '@playwright/test';
import {
  type Bounds,
  type RegionSummary,
  BYTES_PER_CAMPSITE,
  CHUNK_ENVELOPE_BYTES,
  VIEW_BUDGET_BYTES,
  bytesInView,
  chunkBody,
  chunkKey,
  chunkUrl,
  chunkWeight,
  chunksInView,
  countInView,
  dataMessage,
  filterCountLabel,
  overlaps,
  withinView,
} from '../../src/lib/map-chunks';

// CAMP-127. The rules that decide what the map fetches — and, more
// importantly, what it says when it has nothing to draw.

const region = (over: Partial<RegionSummary> = {}): RegionSummary => ({
  country: 'FR',
  region: 'Vendée',
  slug: 'vendee',
  count: 100,
  minLon: -2,
  minLat: 46,
  maxLon: -1,
  maxLat: 47,
  lon: -1.5,
  lat: 46.5,
  ...over,
});

/** A campsite, in the shape the chunks hand the map. */
const spot = (lon: number, lat: number, slug = 'spot') => ({
  type: 'Feature' as const,
  geometry: { type: 'Point' as const, coordinates: [lon, lat] as [number, number] },
  properties: { slug },
});

const view = (over: Partial<Bounds> = {}): Bounds => ({
  west: -3,
  south: 45,
  east: 0,
  north: 48,
  ...over,
});

test('a chunk address is built from the country and the slug', () => {
  expect(chunkKey({ country: 'FR', slug: 'vendee' })).toBe('fr/vendee');
  expect(chunkUrl('fr/vendee')).toBe('/data/spots/fr/vendee.geojson');
  // The campsites with no region at all keep their own address.
  expect(chunkKey({ country: 'CY', slug: '_unplaced' })).toBe('cy/_unplaced');
});

test('a region inside the view is in view', () => {
  expect(overlaps(view(), region())).toBe(true);
});

test('a region outside it is not', () => {
  expect(overlaps(view(), region({ minLon: 10, maxLon: 11 }))).toBe(false);
  expect(overlaps(view(), region({ minLat: 60, maxLat: 61 }))).toBe(false);
});

test('a region touching the edge counts as in view', () => {
  // 🔴 A campsite exactly on the boundary must not blink out of
  // existence as the reader pans. That reads as a data bug for weeks.
  expect(overlaps(view(), region({ minLon: 0, maxLon: 5 }))).toBe(true);
  expect(overlaps(view(), region({ minLat: 48, maxLat: 50 }))).toBe(true);
});

test('🔴 a box is read as west ≤ east — the antimeridian is NOT handled', () => {
  // CAMP-133. The module header used to name "a viewport crossing the
  // antimeridian" as a case this file's purity let us test. There was
  // no handling and no test; it was a promise in a comment.
  //
  // This pins the real reading rather than the wished-for one. A
  // viewport wrapped across the antimeridian — MapLibre reports west
  // 170, east −170 — is an INVERTED box to these comparisons, and an
  // inverted box contains nothing: a region sitting on the date line is
  // reported as out of view, and so is every other region on earth. The
  // map would go blank rather than draw the wrong place.
  //
  // Unreachable for EU-27 — measured 27.09.2026, the index spans
  // longitude −31.27 … 34.55 — and now stated instead of implied.
  const wrapped: Bounds = { west: 170, south: -10, east: -170, north: 10 };
  for (const r of [
    region({ slug: 'dateline', minLon: 179, maxLon: -179, minLat: -1, maxLat: 1 }),
    region({ slug: 'fiji', minLon: 177, maxLon: 179, minLat: -1, maxLat: 1 }),
    region({ slug: 'samoa', minLon: -173, maxLon: -171, minLat: -1, maxLat: 1 }),
  ]) {
    expect(
      overlaps(wrapped, r),
      `${r.slug}: if this ever passes, the antimeridian got handled — say so in the comments`,
    ).toBe(false);
  }
  // The same box unwrapped behaves normally, so it is the wrapping that
  // is unhandled, not the longitudes.
  expect(
    overlaps({ west: -180, south: -10, east: 180, north: 10 },
      region({ minLon: 177, maxLon: 179, minLat: -1, maxLat: 1 })),
  ).toBe(true);
});

test('the middle of the screen is fetched first', () => {
  // 🔴 Fetches finish in the order they are made, so this is the order
  // the reader watches the map fill in.
  const index = [
    region({ slug: 'far', lon: -2.9, lat: 45.1, minLon: -3, maxLon: -2.8, minLat: 45, maxLat: 45.2 }),
    region({ slug: 'middle', lon: -1.5, lat: 46.5 }),
  ];
  expect(chunksInView(index, view()).keys).toEqual(['fr/middle', 'fr/far']);
});

// ── the bound is on bytes, and it is spent in bytes ──────────────────

test('🔴 a view too HEAVY says so — and heaviness is measured in bytes', () => {
  // CAMP-133. The bound used to be `limit = 60` on the number of
  // chunks, under a comment calling it "a bound on bytes". Chunks are
  // not the same size: measured 27.09.2026 over all 812, from 6 192 B
  // (median) to 418 923 B (de/bayern). Two regions can outweigh sixty.
  const twoBig = [
    region({ slug: 'bayern', count: 1433 }),
    region({ slug: 'bw', count: 1277 }),
  ];
  const sixtySmall = Array.from({ length: 60 }, (_, i) =>
    region({ slug: `r${i}`, count: 26 }),
  );

  expect(bytesInView(sixtySmall, view())).toBe(60 * chunkWeight(26));
  expect(bytesInView(twoBig, view())).toBeGreaterThan(
    bytesInView(sixtySmall, view()),
  );

  // Sixty chunks of the median region pass; two German states do not.
  expect(chunksInView(sixtySmall, view(), 1_000_000).tooMany).toBe(false);
  expect(chunksInView(twoBig, view(), 1_000_000).tooMany).toBe(true);
});

test('a refused view still names every chunk it would have needed', () => {
  // 🔴 No slicing. The old rule returned the first 60 keys alongside
  // `tooMany`, which is a list nobody may use — and an invitation to
  // draw 60 of 80 chunks as if that were the map.
  const index = Array.from({ length: 80 }, (_, i) =>
    region({ slug: `r${i}`, count: 250 }),
  );
  const out = chunksInView(index, view());
  expect(out.tooMany).toBe(true);
  expect(out.keys).toHaveLength(80);
  expect(out.bytes).toBe(80 * chunkWeight(250));
});

test('🔴 the weight is one per FILE, over everything that file holds', () => {
  // Two region names that slugify to one chunk key. The reader
  // downloads one file — so weighing it twice would refuse a view that
  // costs one file, and weighing only the first row would understate
  // it. The API matches on every name that slugifies to the key, so
  // the file really holds both regions' campsites.
  const out = chunksInView(
    [
      region({ region: 'Nord-Pas-de-Calais', slug: 'npdc', count: 100 }),
      region({ region: 'Nord Pas de Calais', slug: 'npdc', count: 40 }),
    ],
    view(),
  );
  expect(out.keys).toEqual(['fr/npdc']);
  expect(out.bytes).toBe(chunkWeight(140));
  // Not two envelopes, and not one region's worth.
  expect(out.bytes).not.toBe(chunkWeight(100) + chunkWeight(40));
  expect(out.bytes).not.toBe(chunkWeight(100));
});

test('🔴 the weight rule is the one the chunk files are measured against', () => {
  // `chunkWeight` is an UPPER bound on what a chunk file weighs, and
  // the chunk route fails the build when a real file breaks it. Both
  // halves have to be here: the envelope is what an empty collection
  // costs, and the per-campsite figure is what one feature may add.
  expect(CHUNK_ENVELOPE_BYTES).toBe(
    Buffer.byteLength(
      JSON.stringify({ type: 'FeatureCollection', features: [] }),
    ),
  );
  expect(chunkBody([]).length).toBe(CHUNK_ENVELOPE_BYTES);
  expect(chunkWeight(0)).toBe(CHUNK_ENVELOPE_BYTES);
  expect(chunkWeight(10) - chunkWeight(9)).toBe(BYTES_PER_CAMPSITE);

  // Measured 27.09.2026 over all 812 chunks: the worst real chunk cost
  // 360 B per campsite (si/hrpelje-kozina, one campsite in 402 B). The
  // bound has to be above that, and not so far above that it stops
  // bounding anything.
  expect(BYTES_PER_CAMPSITE).toBeGreaterThan(360);
  expect(BYTES_PER_CAMPSITE).toBeLessThan(500);
});

test('the budget is a real number of bytes, and it has both ends measured', () => {
  // 🔴 A guard on the constant itself. CAMP-127 argued one world file
  // was unviable at 2.4 MB; a "budget" above that bounds nothing.
  expect(VIEW_BUDGET_BYTES).toBeLessThan(2_400_000);

  // And the floor: at the worst point in EU-27 (lon 10.196, lat 49.406)
  // three German states overlap — Bayern 1 433, Baden-Württemberg
  // 1 277, Hessen 578, measured 27.09.2026 — and a chunk is a whole
  // region however far the reader zooms. Below this the map would say
  // "zoom in" for ever. The index route re-checks it against the live
  // index on every build; this checks the constant can satisfy it at
  // all.
  const unavoidable =
    chunkWeight(1433) + chunkWeight(1277) + chunkWeight(578);
  expect(VIEW_BUDGET_BYTES).toBeGreaterThan(unavoidable);
});

test('an empty index asks for nothing and claims nothing', () => {
  const out = chunksInView([], view());
  expect(out.keys).toEqual([]);
  expect(out.tooMany).toBe(false);
  expect(out.bytes).toBe(0);
  expect(countInView([], view())).toBe(0);
});

// ── the denominator the panel prints ─────────────────────────────────

test('🔴 "in view" is the campsites inside the box, edges included', () => {
  const view: Bounds = { west: 0, south: 0, east: 10, north: 10 };
  const inside = withinView(
    [
      spot(5, 5, 'middle'),
      spot(0, 0, 'corner'),
      spot(10, 10, 'far-corner'),
      spot(10.0001, 5, 'just-outside'),
      spot(5, -0.0001, 'just-below'),
    ],
    view,
  );
  expect(inside.map((f) => f.properties.slug)).toEqual([
    'middle',
    'corner',
    'far-corner',
  ]);
});

test('🔴 every campsite in view is in a chunk the map asked for', () => {
  // CAMP-133. This is the argument that makes "N of M in view" a
  // statement about the world rather than about how far somebody has
  // panned: a campsite inside the view is inside its own region's
  // bounding box, so that box overlaps the view, so its chunk is in the
  // list. Driven here rather than asserted in a comment.
  const index = [
    region({ slug: 'a', minLon: 0, maxLon: 4, minLat: 0, maxLat: 4, lon: 2, lat: 2 }),
    region({ slug: 'b', minLon: 3, maxLon: 9, minLat: 3, maxLat: 9, lon: 6, lat: 6 }),
    region({ slug: 'far', minLon: 40, maxLon: 44, minLat: 40, maxLat: 44, lon: 42, lat: 42 }),
  ];
  const chunkOf = new Map([
    ['fr/a', [spot(1, 1, 'a1'), spot(3.5, 3.5, 'a2')]],
    ['fr/b', [spot(8, 8, 'b1'), spot(3.5, 3.5, 'b2')]],
    ['fr/far', [spot(42, 42, 'f1')]],
  ]);

  const view: Bounds = { west: 3, south: 3, east: 5, north: 5 };
  const { keys } = chunksInView(index, view);
  const loaded = keys.flatMap((k) => chunkOf.get(k) ?? []);

  // Everything anywhere, filtered to the view — the honest answer.
  const everywhere = [...chunkOf.values()].flat();
  expect(withinView(loaded, view).map((f) => f.properties.slug).sort()).toEqual(
    withinView(everywhere, view).map((f) => f.properties.slug).sort(),
  );
  // And it is not vacuous: there IS something in view, and something out.
  expect(withinView(loaded, view)).toHaveLength(2);
  expect(everywhere.length).toBeGreaterThan(2);
});

test('the count in view comes from the index, without fetching', () => {
  const index = [
    region({ slug: 'a', count: 40 }),
    region({ slug: 'b', count: 2 }),
    region({ slug: 'far', count: 9999, minLon: 100, maxLon: 101 }),
  ];
  expect(countInView(index, view())).toBe(42);
});

// ── what the reader is told ────────────────────────────────────────────

test('🔴 a failure is never silent, and never reads as "none here"', () => {
  // The defect this card exists for. Seen on screen 24.09.2026: the data
  // request answered 500 and the panel read "0 campsites".
  const msg = dataMessage({ kind: 'failed', what: 'HTTP 500', loaded: 0 });
  expect(msg).toContain('could not be loaded');
  expect(msg).toContain('HTTP 500');
  expect(msg).toContain('not because there is nothing here');
});

test('loading says loading, rather than nothing', () => {
  expect(dataMessage({ kind: 'loading' })).toMatch(/Loading/);
});

test('a wide view explains the circles instead of pretending they are campsites', () => {
  const msg = dataMessage({ kind: 'wide', count: 61557 }) ?? '';
  expect(msg).toContain('61,557');
  expect(msg).toContain('zoom in');
  expect(msg).toContain('regions');
});

test('and a map that is simply working says nothing at all', () => {
  expect(dataMessage({ kind: 'ready' })).toBeNull();
});

// ── the count in the filter panel ─────────────────────────────────

test.describe('filterCountLabel', () => {
  const counts = { shown: 12, total: 1079, filtering: false };

  test('\u{1F534} a zoomed-out map never says a number, least of all zero', () => {
    // The whole reason this function exists. The panel printed a bold 0
    // directly above "3,116 campsites in view" — two numbers about the
    // same map, disagreeing, on one screen.
    for (const filtering of [false, true]) {
      const label = filterCountLabel(
        { kind: 'wide', count: 3116 },
        { ...counts, shown: 0, total: 0, filtering },
      );
      expect(label.value, 'a wide view has no campsite count').toBeNull();
      expect(label.text).toMatch(/zoom in/i);
    }
  });

  test('\u{1F534} nor does a map that failed to load', () => {
    const label = filterCountLabel(
      { kind: 'failed', what: 'HTTP 500', loaded: 0 },
      { ...counts, shown: 0, total: 0 },
    );
    expect(label.value).toBeNull();
    // And it does not tell the reader to zoom in, which would not help.
    expect(label.text).not.toMatch(/zoom in/i);
    expect(label.text).toMatch(/did not load/i);
  });

  test('nor one that has not finished loading', () => {
    expect(filterCountLabel({ kind: 'loading' }, counts).value).toBeNull();
  });

  test('🔴 a ready map says the number IS of the visible area', () => {
    // CAMP-133. The denominator used to be every campsite fetched so
    // far ("306 of 1 308 campsites", reviewed 25.09.2026), and chunks
    // are never discarded — so it only ever grew, with the reader's
    // route rather than with the screen. Both sides now name the set,
    // and it is a set the reader can see.
    expect(filterCountLabel({ kind: 'ready' }, counts)).toEqual({
      value: 12,
      text: ' campsites in view',
    });
    expect(
      filterCountLabel({ kind: 'ready' }, { ...counts, filtering: true }).text,
    ).toBe(' of 1,079 campsites in view');
  });

  test('a ready map with genuinely nothing shown may say zero', () => {
    // \u{1F534} The one place a zero is honest: the data IS loaded and the
    // filters match none of it. Suppressing it here would be the
    // opposite mistake — hiding a true answer.
    const label = filterCountLabel(
      { kind: 'ready' },
      { shown: 0, total: 1079, filtering: true },
    );
    expect(label.value).toBe(0);
  });

  test('every state answers — none falls through to silence', () => {
    const states = [
      { kind: 'ready' as const },
      { kind: 'loading' as const },
      { kind: 'wide' as const, count: 5 },
      { kind: 'failed' as const, what: 'x', loaded: 0 },
    ];
    for (const s of states) {
      const label = filterCountLabel(s, counts);
      expect(label.text.trim(), `${s.kind} says nothing`).not.toBe('');
    }
  });
});

test('🔴 chunksInView never returns the same key twice', () => {
  // Two different region names that slugify identically. The caller
  // fetches every key it is handed, so a repeat is the same file
  // appended twice — and every campsite in it drawn twice.
  const dup = (name: string, slug: string) =>
    region({ region: name, slug, count: 10, minLon: 0, minLat: 0, maxLon: 10, maxLat: 10, lon: 5, lat: 5 });
  const { keys } = chunksInView(
    [dup('Nord-Pas-de-Calais', 'nord-pas-de-calais'),
     dup('Nord Pas de Calais', 'nord-pas-de-calais')],
    { west: 0, south: 0, east: 10, north: 10 },
  );
  expect(keys).toEqual(['fr/nord-pas-de-calais']);
});

// ── the file the index measures is the file the map fetches ──────────

test('🔴 chunkBody writes only what is KNOWN about a campsite', () => {
  // The index records the LENGTH of this string as the chunk's weight,
  // and the map refuses views on that number. If this shape drifted
  // from what the chunk route serves, the budget would be spent on a
  // file nobody downloads. One function, so it cannot.
  const body = chunkBody([
    {
      slug: 'spot-1',
      name: 'Camping Vendée',
      type: 'campsite',
      lat: 46.5,
      lon: -1.5,
      path: '/camping/fr/vendee/spot-1',
      amenities: { toilets: 'yes', shower: 'unknown', wifi: 'no' } as never,
    },
  ]);
  const parsed = JSON.parse(body) as {
    type: string;
    features: { geometry: { coordinates: number[] }; properties: Record<string, unknown> }[];
  };
  expect(parsed.type).toBe('FeatureCollection');
  expect(parsed.features[0].geometry.coordinates).toEqual([-1.5, 46.5]);
  expect(parsed.features[0].properties).toEqual({
    slug: 'spot-1',
    name: 'Camping Vendée',
    type: 'campsite',
    href: '/camping/fr/vendee/spot-1',
    toilets: 'yes',
    wifi: 'no',
  });
  // 🔴 "unknown" is absent, not written out. CAMP-107 measured that
  // spelling it cost 2.26 MB of a 4.9 MB file.
  expect(body).not.toContain('unknown');
});

test('🔴 a campsite with no page keeps its pin and loses its link', () => {
  // 135 campsites carry no region and therefore no URL. `path` is null
  // for those; `slug` never is.
  const parsed = JSON.parse(
    chunkBody([
      { slug: 'arazi', name: null, type: 'campsite', lat: 35, lon: 33, path: null, amenities: null },
    ]),
  ) as { features: { properties: { slug: string; href: string | null } }[] };
  expect(parsed.features[0].properties.href).toBeNull();
  expect(parsed.features[0].properties.slug).toBe('arazi');
});

// ── a partial failure is not an empty map ────────────────────────────

test.describe('when some chunks load and some do not', () => {
  // 🔴 Measured in review: 13 of 14 chunks loaded, 848 campsites drawn
  // on screen — and the page said "This map is empty because of that"
  // over a map full of campsites, with "Not counted" beside it.
  const partial = { kind: 'failed' as const, what: 'hr/zadarska: HTTP 500', loaded: 848 };

  test('🔴 the message does not call a full map empty', () => {
    const msg = dataMessage(partial) ?? '';
    expect(msg).not.toMatch(/map is empty/i);
    expect(msg).toContain('848');
    // And it still says not to trust the map as complete.
    expect(msg).toMatch(/not.*complete|missing/i);
  });

  test('a total failure still says the map is empty, because it is', () => {
    const msg = dataMessage({ kind: 'failed', what: 'HTTP 500', loaded: 0 }) ?? '';
    expect(msg).toMatch(/map is empty/i);
  });

  test('🔴 the count reports what did load, rather than refusing', () => {
    const label = filterCountLabel(partial, { shown: 848, total: 848, filtering: false });
    expect(label.value).toBe(848);
    expect(label.text).toContain('loaded');
  });

  test('🔴 and it stops claiming the area, because a chunk is missing', () => {
    // CAMP-133. "In view" is only complete while every chunk touching
    // the view is in hand. In this state one is not, so the sentence
    // may claim the fetch and nothing more.
    const label = filterCountLabel(partial, {
      shown: 848,
      total: 900,
      filtering: true,
    });
    expect(label.text).toBe(' of 900 campsites in view that loaded');
  });

  test('a total failure still refuses to give a number', () => {
    const label = filterCountLabel(
      { kind: 'failed', what: 'HTTP 500', loaded: 0 },
      { shown: 0, total: 0, filtering: false },
    );
    expect(label.value).toBeNull();
  });
});

test('🔴 the wide message says which set it counted', () => {
  // `countInView` sums whole regions that TOUCH the viewport, so it is
  // not a count of the viewport: measured 3 116 against the API's 2 456
  // for the same box. The sentence must not claim otherwise.
  const msg = dataMessage({ kind: 'wide', count: 3116 }) ?? '';
  expect(msg).toContain('regions in view');
  expect(msg).not.toMatch(/3,116 campsites in view\b/);
});
