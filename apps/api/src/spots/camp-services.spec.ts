import {
  readCampServices,
  reconcileGroceries,
  type CampServiceView,
} from './camp-services';
import { toView } from './spots.service';

// Review of #555/#556 — the two pure steps between the SQL and the page.
//
// MUTATIONS (done, each red):
//   * readCampServices keeps `withinRadius` for every kind → "fuel" test.
//   * reconcileGroceries: `m > metres` → `m >= metres` (an equal distance is
//     left as two sources) → "same shop" test; condition removed (the
//     supermarket always wins) → "a nearer convenience shop stays" test;
//     `item.onSite !== null` guard removed → "on site" test.
//   * spots.service sends readCampServices(...) without reconcileGroceries →
//     "the API response" test.

const pt = (name: string | null, metres: number) => ({
  name,
  metres,
  seen: '2026-11-10',
});

test('🔴 a withinRadius on anything but water and dump is dropped', () => {
  const v = readCampServices([
    {
      kind: 'fuel',
      onSite: null,
      withinRadius: pt('Shell', 120),
      nearby: null,
    },
    {
      kind: 'ev_charging',
      onSite: null,
      withinRadius: pt('EV', 90),
      nearby: pt('EV far', 900),
    },
    { kind: 'water', onSite: null, withinRadius: pt('Tap', 77), nearby: null },
  ]);
  // fuel had nothing else to say, so it is not an entry at all
  expect(v.map((e) => e.kind)).toEqual(['ev_charging', 'water']);
  expect(v[0].withinRadius).toBeNull();
  expect(v[1].withinRadius).toEqual(pt('Tap', 77));
});

test('a payload written before the field existed reads as no withinRadius', () => {
  const v = readCampServices([
    { kind: 'water', onSite: null, nearby: pt('Tap', 300) },
  ]);
  expect(v).toEqual([
    {
      kind: 'water',
      group: 'stay',
      onSite: null,
      withinRadius: null,
      nearby: pt('Tap', 300),
    },
  ]);
});

const groceries = (
  nearby: CampServiceView['nearby'],
  onSite: CampServiceView['onSite'] = null,
): CampServiceView[] => [
  { kind: 'groceries', group: 'before', onSite, withinRadius: null, nearby },
  {
    kind: 'pharmacy',
    group: 'trouble',
    onSite: null,
    withinRadius: null,
    nearby: pt('Lekarna', 2000),
  },
];

test('🔴 same shop, two measurements: the line carries the page’s one supermarket figure', () => {
  // the supermarket's wall is 804 m away, its centre point 877 m
  const out = reconcileGroceries(groceries(pt('Super U', 877)), {
    supermarket: { name: 'Super U', m: 804 },
  });
  expect(out[0].nearby).toEqual({ name: 'Super U', metres: 804, seen: null });
  // 🔴 equal is the same shop too (a supermarket mapped as a node)
  const eq = reconcileGroceries(groceries(pt('Lidl node', 500)), {
    supermarket: { name: 'Lidl', m: 500 },
  });
  expect(eq[0].nearby).toEqual({ name: 'Lidl', metres: 500, seen: null });
  // nothing else is touched
  expect(out[1].nearby).toEqual(pt('Lekarna', 2000));
});

test('🔴 a convenience shop nearer than the supermarket stays, with its own date', () => {
  const out = reconcileGroceries(groceries(pt('Spar express', 900)), {
    supermarket: { name: 'Mercator', m: 2400 },
  });
  expect(out[0].nearby).toEqual(pt('Spar express', 900));
});

test('🔴 a shop inside the outline: "nearby" means outside it and is not replaced', () => {
  const out = reconcileGroceries(
    groceries(pt('Village shop', 900), pt('Camp shop', 50)),
    { supermarket: { name: 'Camp shop', m: 30 } },
  );
  expect(out[0].onSite).toEqual(pt('Camp shop', 50));
  expect(out[0].nearby).toEqual(pt('Village shop', 900));
});

test('no usable supermarket figure, or no groceries line, changes nothing', () => {
  const items = groceries(pt('Spar', 900));
  for (const ctx of [
    null,
    undefined,
    {},
    { supermarket: null },
    { supermarket: { name: 'X' } },
    { supermarket: { name: 'X', m: '300' } },
    { supermarket: { name: 'X', m: -1 } },
    { supermarket: { name: 'X', m: NaN } },
  ])
    expect(reconcileGroceries(items, ctx)).toEqual(items);
  // a supermarket in the context does not INVENT a groceries line
  const none = groceries(null);
  expect(
    reconcileGroceries(none, { supermarket: { name: 'X', m: 300 } }),
  ).toEqual(none);
  // an unnamed supermarket: the name is null, not the other source's
  expect(
    reconcileGroceries(items, { supermarket: { m: 300.4 } })[0].nearby,
  ).toEqual({ name: null, metres: 300, seen: null });
});

test('🔴 the API response itself carries the reconciled line, not only the helper', () => {
  const view = toView({
    slug: 's',
    name: null,
    country: 'FR',
    region: 'Vendée',
    type: 'paid',
    lat: 46,
    lon: 14,
    outline: null,
    amenities: {},
    context: { supermarket: { name: 'Super U', m: 804 } },
    camp_services: [
      { kind: 'groceries', onSite: null, nearby: pt('Super U', 877) },
      {
        kind: 'water',
        onSite: null,
        withinRadius: pt('Tap', 77),
        nearby: null,
      },
    ],
  });
  expect(view.campServices.items).toEqual([
    {
      kind: 'groceries',
      group: 'before',
      onSite: null,
      withinRadius: null,
      nearby: { name: 'Super U', metres: 804, seen: null },
    },
    {
      kind: 'water',
      group: 'stay',
      onSite: null,
      withinRadius: pt('Tap', 77),
      nearby: null,
    },
  ]);
});
