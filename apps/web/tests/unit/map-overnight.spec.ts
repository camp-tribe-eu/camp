import { expect, test } from '@playwright/test';
import MapFilters, { MapCount } from '@/components/map-filters';
import {
  applyFilters,
  EMPTY_FILTERS,
  fromSearchParams,
  isFiltering,
  knownOvernight,
  matchesLenient,
  matchesStrict,
  overnightOf,
  overnightTally,
  toSearchParams,
  type MapFilterState,
} from '@/lib/map-filter';
import {
  chunkBody,
  chunkWeight,
  overnightCountLabel,
  type ChunkMarker,
  type MapDataState,
} from '@/lib/map-chunks';
import { AMENITY_KEYS, SPOT_TYPES } from '@/lib/api';
import { byTestId, renderComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-255 — the map's overnight filter, and the number beside it.
//
// 🔴 THE RULE UNDER TEST: a place whose overnight stay we do not know is
// NEVER drawn under "confirmed allowed", whatever else the reader ticked,
// and the number of such places is always printed beside the filter. The
// twin of this rule is in apps/api/src/spots/filters.ts and its spec.

const feature = (
  props: Record<string, unknown>,
): { properties: Record<string, unknown> } => ({
  properties: { type: 'paid', ...props },
});
const state = (over: Partial<MapFilterState> = {}): MapFilterState => ({
  ...EMPTY_FILTERS,
  ...over,
});

// Eight campsites, every combination that matters: the three overnight
// answers (y / n / absent) crossed with a known and an unrecorded shower,
// plus one carrying a code nobody defined.
const CAMPS = [
  feature({ id: 'y-shower', o: 'y', shower: 'yes' }),
  feature({ id: 'y-noshower-recorded', o: 'y', shower: 'no' }),
  feature({ id: 'y-shower-unrecorded', o: 'y' }),
  feature({ id: 'n-shower', o: 'n', shower: 'yes' }),
  feature({ id: 'unknown-shower', shower: 'yes' }),
  feature({ id: 'unknown-bare' }),
  feature({ id: 'unknown-wild', type: 'wild' }),
  feature({ id: 'garbage-code', o: 'allowed', shower: 'yes' }),
];
const ids = (fs: { properties: Record<string, unknown> }[]) =>
  fs.map((f) => f.properties.id as string).sort();

test.describe('what the chunk says, and how it is read', () => {
  test('anchor: both known answers and the fallback are distinct', () => {
    expect(overnightOf({ o: 'y' })).toBe('allowed');
    expect(overnightOf({ o: 'n' })).toBe('forbidden');
    expect(overnightOf({})).toBe('unknown');
  });

  test('🔴 anything that is not exactly y or n is unknown — never an answer', () => {
    for (const o of ['allowed', 'yes', 'Y', 'N', '1', 1, true, '', null, undefined, {}, []]) {
      expect([String(o), overnightOf({ o })]).toEqual([String(o), 'unknown']);
    }
  });

  test('only a known answer gets a code; unknown gets none', () => {
    expect(knownOvernight('allowed')).toBe('y');
    expect(knownOvernight('forbidden')).toBe('n');
    expect(knownOvernight('unknown')).toBeUndefined();
    expect(knownOvernight(undefined)).toBeUndefined();
    expect(knownOvernight(null)).toBeUndefined();
  });
});

test.describe('the filter is strict, in both questions', () => {
  test('anchor: off, it matches everything and is not "filtering"', () => {
    expect(isFiltering(state())).toBe(false);
    expect(ids(applyFilters(CAMPS, state()).shown)).toHaveLength(CAMPS.length);
  });

  test('on, it counts as filtering', () => {
    expect(isFiltering(state({ overnight: true }))).toBe(true);
  });

  test('🔴 shows exactly the confirmed ones', () => {
    const out = applyFilters(CAMPS, state({ overnight: true }));
    expect(ids(out.shown)).toEqual(['y-noshower-recorded', 'y-shower', 'y-shower-unrecorded']);
    // Nothing was "hidden for want of an amenity", so nothing is owed.
    expect(out.unknownExcluded).toBe(0);
  });

  test('strict and lenient agree on it', () => {
    const s = state({ overnight: true });
    for (const f of CAMPS) {
      expect([f.properties.id, matchesStrict(f.properties, s)]).toEqual([
        f.properties.id,
        matchesLenient(f.properties, s),
      ]);
    }
  });

  // 🔴 THE RULE, in the one combination that could break it: the reader
  // asks for places where a missing shower tag is let through, and also
  // for confirmed overnight. The amenity half loosens; the overnight half
  // must not.
  test('🔴 loosening an amenity never lets an unknown overnight in', () => {
    const s = state({ overnight: true, amenities: ['shower'], includeUnknown: true });
    const shown = ids(applyFilters(CAMPS, s).shown);
    expect(shown).toEqual(['y-shower', 'y-shower-unrecorded']);
    // …and the loosening itself DID work on the amenity side.
    expect(shown).toContain('y-shower-unrecorded');
    for (const f of CAMPS) {
      if (overnightOf(f.properties) !== 'allowed') {
        expect([f.properties.id, shown.includes(f.properties.id as string)]).toEqual([
          f.properties.id,
          false,
        ]);
      }
    }
  });

  test('the amenity count still counts only amenity-unknowns', () => {
    const out = applyFilters(
      CAMPS,
      state({ overnight: true, amenities: ['shower'], includeUnknown: false }),
    );
    expect(ids(out.shown)).toEqual(['y-shower']);
    // `y-shower-unrecorded` fell out ONLY for want of a shower tag.
    expect(out.unknownExcluded).toBe(1);
  });
});

test.describe('the number beside the filter', () => {
  test('🔴 confirmed, not allowed, not known and left out add up to what is in view', () => {
    const t = overnightTally(CAMPS, state({ overnight: true }));
    expect(t).toEqual({ allowed: 3, forbidden: 1, unknown: 4, leftOut: 0 });
    expect(t.allowed + t.forbidden + t.unknown + t.leftOut).toBe(CAMPS.length);
  });

  // 🔴 CAMP-255 review: it used to be 1 + 1 ≠ 7 here. The overnight answers
  // are still asked of what passes the OTHER filters (so `allowed` is the
  // number of pins), and what those filters set aside is counted too, so
  // the four are one set — checked with another filter ACTIVE, which the
  // original test never did.
  test('is asked of what passes the OTHER filters, and still adds up to everything in view', () => {
    const wild = overnightTally(CAMPS, state({ overnight: true, types: ['wild'] }));
    // Wild only: one campsite, and it is not known; the other seven are
    // set aside by the type filter.
    expect(wild).toEqual({ allowed: 0, forbidden: 0, unknown: 1, leftOut: 7 });
    // A strict shower filter: the four that definitely have one.
    const shower = overnightTally(CAMPS, state({ overnight: true, amenities: ['shower'] }));
    expect(shower).toEqual({ allowed: 1, forbidden: 1, unknown: 2, leftOut: 4 });
    for (const t of [wild, shower]) {
      expect(t.allowed + t.forbidden + t.unknown + t.leftOut).toBe(CAMPS.length);
    }
  });

  test('the same number whether or not the overnight filter is on', () => {
    expect(overnightTally(CAMPS, state({ overnight: false }))).toEqual(
      overnightTally(CAMPS, state({ overnight: true })),
    );
  });

  test('over nothing, it is four zeros', () => {
    expect(overnightTally([], state({ overnight: true }))).toEqual({
      allowed: 0,
      forbidden: 0,
      unknown: 0,
      leftOut: 0,
    });
  });
});

test.describe('the link carries it', () => {
  test('writes the same name and word the API takes', () => {
    expect(toSearchParams(state({ overnight: true }))).toBe('overnight=allowed');
    expect(toSearchParams(state())).toBe('');
  });

  test('round-trips, alongside the other filters', () => {
    const s = state({ overnight: true, types: ['wild'], amenities: ['shower'] });
    expect(fromSearchParams(toSearchParams(s), SPOT_TYPES, AMENITY_KEYS)).toEqual(s);
  });

  test('only the one word turns it on', () => {
    for (const raw of ['overnight=1', 'overnight=true', 'overnight=forbidden', 'overnight=ALLOWED', 'overnight=', 'overnight']) {
      expect([raw, fromSearchParams(`?${raw}`, SPOT_TYPES, AMENITY_KEYS).overnight]).toEqual([raw, false]);
    }
    expect(fromSearchParams('?overnight=allowed', SPOT_TYPES, AMENITY_KEYS).overnight).toBe(true);
  });
});

// ── what the chunk file carries ───────────────────────────────────────────

const marker = (over: Partial<ChunkMarker> = {}): ChunkMarker => ({
  slug: 's',
  name: 'N',
  type: 'camp_site',
  lat: 1,
  lon: 2,
  path: '/camping/hr/x/s',
  amenities: null,
  ...over,
});
const props = (m: ChunkMarker) =>
  (JSON.parse(chunkBody([m])) as { features: { properties: Record<string, unknown> }[] })
    .features[0].properties;

test.describe('the chunk file', () => {
  test('writes y for allowed and n for forbidden', () => {
    expect(props(marker({ overnight: 'allowed' })).o).toBe('y');
    expect(props(marker({ overnight: 'forbidden' })).o).toBe('n');
  });

  // 🔴 Absent, never written out: 97% of campsites would otherwise spend
  // bytes on "we do not know", and the budget is measured.
  test('🔴 unknown, and a marker from an older API, write no key at all', () => {
    expect('o' in props(marker({ overnight: 'unknown' }))).toBe(false);
    expect('o' in props(marker())).toBe(false);
    expect(chunkBody([marker({ overnight: 'unknown' })])).not.toContain('unknown');
  });

  test('a chunk round-trips through the filter: what was written is what is matched', () => {
    const body = chunkBody([
      marker({ slug: 'a', overnight: 'allowed' }),
      marker({ slug: 'f', overnight: 'forbidden' }),
      marker({ slug: 'u', overnight: 'unknown' }),
    ]);
    const features = (JSON.parse(body) as { features: { properties: Record<string, unknown> }[] }).features;
    const out = applyFilters(features, state({ overnight: true }));
    expect(out.shown.map((f) => f.properties.slug)).toEqual(['a']);
  });

  test('a thousand confirmed campsites stay inside the per-campsite budget', () => {
    const many = Array.from({ length: 1000 }, (_, i) =>
      marker({ slug: `camp-${i}`, overnight: 'allowed', warningAreas: ['EMMA_ID:HR008', 'NUTS3:HR033'] }),
    );
    expect(chunkBody(many).length).toBeLessThan(chunkWeight(many.length));
  });
});

// ── what the panel and the counter say ────────────────────────────────────

// 🔴 ОБХІД ДЕРЕВА ЖИВЕ В `render-component`, А НЕ ТУТ.
//
// Тут була власна копія: свій `walk`, своя перевірка `__pw_type`. Вона
// мовчки зламалась, коли Playwright поїхав 1.63 → 1.64 — два тести
// нижче впали з `Received: undefined`, і причина не була видна ні з
// повідомлення, ні з коду. Заміряно під час CAMP-351.
//
// Дублювати обхід означало дублювати знання про внутрішній формат
// чужої бібліотеки. Тепер воно в одному місці, і там же стоїть канарка,
// яка падає з діагнозом, щойно формат зміниться.

const panelProps = (s: MapFilterState, onChange: (n: MapFilterState) => void = () => {}) => ({
  state: s,
  onChange,
  unknownExcluded: 0,
});

test.describe('the panel', () => {
  const said = (s: MapFilterState) => visibleText(renderComponent(MapFilters, panelProps(s)));

  test('has the group, its one chip and no "include unknown" for it', () => {
    const text = said(EMPTY_FILTERS);
    expect(text).toContain('Overnight stay');
    expect(text).toContain('Confirmed allowed');
    // The amenity checkbox is not offered for overnight: ticking only the
    // overnight filter does not produce an "also show where not recorded".
    expect(said(state({ overnight: true }))).not.toContain('not recorded');
  });

  test('the chip toggles only the overnight filter', () => {
    let next: MapFilterState | null = null;
    const base = state({ types: ['wild'], amenities: ['shower'], includeUnknown: true });
    const chip = byTestId(MapFilters(panelProps(base, (n) => (next = n))), 'filter-overnight-allowed');
    expect(chip).toBeTruthy();
    (chip!.props!.onClick as () => void)();
    expect(next).toEqual({ ...base, overnight: true });
  });

  // 🔴 The hand-written reset this card found: a field added to the state
  // is the one a literal object forgets.
  test('🔴 "Clear filters" clears the overnight filter too', () => {
    let next: MapFilterState | null = null;
    const clear = byTestId(
      MapFilters(panelProps(state({ overnight: true }), (n) => (next = n))),
      'filter-clear',
    );
    expect(clear).toBeTruthy();
    (clear!.props!.onClick as () => void)();
    expect(next).toEqual(EMPTY_FILTERS);
    expect(next!.overnight).toBe(false);
  });

  test('"Clear filters" is offered when ONLY the overnight filter is on', () => {
    expect(said(state({ overnight: true }))).toContain('Clear filters');
    expect(said(EMPTY_FILTERS)).not.toContain('Clear filters');
  });
});

const count = (dataState: MapDataState, s: MapFilterState, tally = { allowed: 12, forbidden: 3, unknown: 2447, leftOut: 0 }) =>
  visibleText(
    renderComponent(MapCount, {
      shown: 12,
      total: 2462,
      dataState,
      state: s,
      overnight: tally,
    }),
  );

test.describe('the counter above the panel', () => {
  const ready: MapDataState = { kind: 'ready' };
  const on = state({ overnight: true });

  test('anchor: it still says how many campsites are in view', () => {
    expect(count(ready, on)).toContain('12 of 2,462 campsites in view');
  });

  test('🔴 says confirmed against not known, and not allowed', () => {
    expect(count(ready, on)).toContain(
      'Overnight stay: 12 confirmed allowed · 2,447 not known · 3 not allowed.',
    );
  });

  test('prints nothing about overnight while the filter is off', () => {
    expect(count(ready, EMPTY_FILTERS)).not.toContain('Overnight stay');
    expect(count(ready, state({ types: ['wild'] }))).not.toContain('confirmed allowed');
  });

  // 🔴 The empty result: not "0", and not silence. "None" and a sentence
  // saying not known is not the same as there being none.
  test('🔴 when none is confirmed it says none, and that not known is not none', () => {
    const text = count(ready, on, { allowed: 0, forbidden: 0, unknown: 1400, leftOut: 0 });
    expect(text).toContain('Overnight stay: none confirmed allowed · 1,400 not known.');
    expect(text).toContain('Not known means no source says either way here. It does not mean there are no places.');
    expect(text).not.toContain('not allowed');
  });

  test('says nothing odd over an area with no campsites at all', () => {
    const text = count(ready, on, { allowed: 0, forbidden: 0, unknown: 0, leftOut: 0 });
    expect(text).toContain('none confirmed allowed');
    expect(text).not.toContain('Not known means');
  });

  test('before the chunks arrive it says it is counting — not zero', () => {
    const text = count({ kind: 'loading' }, on, { allowed: 0, forbidden: 0, unknown: 0, leftOut: 0 });
    expect(text).toContain('Counting overnight answers…');
    expect(text).not.toContain('none confirmed');
  });

  test('zoomed out it says to zoom in — not a number it did not count', () => {
    const text = count({ kind: 'wide', count: 5609 }, on, { allowed: 0, forbidden: 0, unknown: 0, leftOut: 0 });
    expect(text).toContain('Zoom in to see how many campsites are confirmed for overnight stays and how many are not known.');
  });

  test('after a partial failure it says what loaded; after a total one, that nothing did', () => {
    expect(count({ kind: 'failed', what: 'x', loaded: 848 }, on)).toContain('Overnight stay (of what loaded):');
    expect(count({ kind: 'failed', what: 'x', loaded: 0 }, on)).toContain('Not counted — the campsites did not load.');
  });

  test('the label function and the component agree on the states', () => {
    expect(overnightCountLabel({ kind: 'ready' }, { allowed: 1, forbidden: 0, unknown: 2, leftOut: 4 })).toEqual({
      kind: 'counts', allowed: 1, forbidden: 0, unknown: 2, leftOut: 4, partial: false,
    });
  });
});

// 🔴 CAMP-255 review. The two rows of the counter must count ONE set.
//
// "N of M campsites in view" counts M over everything on screen; the
// overnight row used to count only what passed the reader's OTHER filters.
// With "Wild camping" ticked beside the overnight filter it printed
// "1 of 7 campsites in view · Overnight stay: 1 confirmed allowed · 1 not
// known" — 1 + 1 is not 7, and the reader is shown the contradiction. With
// no other filter the two agree (3 + 1 + 3 = 7), which is the one state
// the author looked at, so every earlier test passed.
//
// The numbers below are read off the HTML the component serves, and the
// total is read off the SAME page — never a constant standing in for it.
test.describe('the two rows of the counter count one set', () => {
  // Seven in view: three confirmed (one of them wild), three not allowed,
  // one wild place nobody has an answer for — the 3 + 3 + 1 of the report.
  const VIEW = [
    feature({ id: 'wild-yes', type: 'wild', o: 'y', shower: 'yes' }),
    feature({ id: 'wild-unknown', type: 'wild' }),
    feature({ id: 'paid-yes-1', o: 'y', shower: 'yes' }),
    feature({ id: 'paid-yes-2', o: 'y' }),
    feature({ id: 'paid-no-1', o: 'n', shower: 'yes' }),
    feature({ id: 'paid-no-2', o: 'n' }),
    feature({ id: 'paid-no-3', o: 'n', shower: 'no' }),
  ];

  const page = (s: MapFilterState): string =>
    visibleText(
      renderComponent(MapCount, {
        shown: applyFilters(VIEW, s).shown.length,
        total: VIEW.length,
        dataState: { kind: 'ready' } as MapDataState,
        state: s,
        overnight: overnightTally(VIEW, s),
      }),
    );
  const num = (raw: string) => Number(raw.replace(/,/g, ''));
  /** The "M" of "N of M campsites in view", as printed. */
  const printedTotal = (text: string) =>
    num(/of ([\d,]+) campsites in view/.exec(text)![1]);
  /** The "N" of "N of M campsites in view", as printed. */
  const printedShown = (text: string) =>
    num(/([\d,]+) of [\d,]+ campsites in view/.exec(text)![1]);
  /** Every figure in the overnight sentence, as printed. */
  const printedParts = (text: string) => {
    const sentence = /Overnight stay[^:]*:(.*?)\.(?: |$)/.exec(text)![1];
    return (sentence.match(/\d[\d,]*/g) ?? []).map(num);
  };

  const OTHER_FILTERS: [string, Partial<MapFilterState>][] = [
    ['no other filter', {}],
    ['wild only', { types: ['wild'] }],
    ['paid only', { types: ['paid'] }],
    ['a strict shower filter', { amenities: ['shower'] }],
    ['wild and a shower', { types: ['wild'], amenities: ['shower'] }],
    ['a shower, unknown included', { amenities: ['shower'], includeUnknown: true }],
    ['a type nothing here has', { types: ['rv_park'] }],
  ];

  for (const [name, other] of OTHER_FILTERS) {
    test(`🔴 ${name}: the figures in the overnight row add up to the total in the row above`, () => {
      const text = page(state({ overnight: true, ...other }));
      const total = printedTotal(text);
      expect(total).toBe(7); // anchor: it is the whole view, not a subset
      const parts = printedParts(text);
      expect(parts.length).toBeGreaterThanOrEqual(2); // anchor: it read something
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      // …and the old property survives the fix: "confirmed allowed" is
      // still the number of pins, so a reader can count them and check.
      const confirmed = /Overnight stay[^:]*: (none|[\d,]+) confirmed allowed/.exec(
        text,
      )![1];
      expect(confirmed === 'none' ? 0 : num(confirmed)).toBe(printedShown(text));
    });
  }

  test('the report’s own case, word for word', () => {
    const text = page(state({ overnight: true, types: ['wild'] }));
    expect(text).toContain('1 of 7 campsites in view');
    expect(text).toContain(
      'Overnight stay: 1 confirmed allowed · 1 not known · 5 left out by your other filters.',
    );
  });

  test('with no other filter nothing is left out, and nothing says so', () => {
    const text = page(state({ overnight: true }));
    expect(text).toContain(
      'Overnight stay: 3 confirmed allowed · 1 not known · 3 not allowed.',
    );
    expect(text).not.toContain('left out');
  });
});
