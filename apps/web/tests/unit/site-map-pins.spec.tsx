import { expect, test } from '@playwright/test';
import { renderComponent } from './render-component';
import { CLIENT_ISLANDS } from './client-islands';
import { CampsiteMedia } from '@/components/campsite-media';
import CampDisturbance from '@/components/camp-disturbance';
import { disturbanceView } from '@/lib/disturbance';
import {
  FIT_PIN_WITHIN_M,
  fitBox,
  framedPins,
  metresBetween,
  pinAttributes,
  type Box,
} from '@/lib/site-map-view';
import type { DisturbancePayload } from '@/lib/api';
import type { SectionView } from '@/lib/page-content';
import { DISTURBANCE_SECTIONS_NOW as DISTURBANCE_SECTIONS } from '../../../api/src/migrations/1797100400000-DisturbanceMapLabelBody';
import { DISTURBANCE_RADIUS_M } from '../../../api/src/spots/disturbance';

// CAMP-502 — the «!» pins of the campsite map (review of #557: no test, a
// `title` nobody on a phone can read, and a view zoomed out to an airport).
//
// 🔴 WHAT IS READ HERE IS THE HTML A READER IS SERVED and the two pure
// decisions the map applies (which pins are framed; what a pin's element is).
// The markers are built by the REAL `disturbanceView` from the migration's CMS
// words — not typed in this file — so a marker that lost its caveat on the way
// fails here. The pins themselves live in a WebGL island: the browser half is
// tests/e2e/disturbance-pins.spec.ts.
//
// MUTATIONS (done, see the PR): remove the legend from campsite-media → red;
// print the legend without the caveat → red; drop the `<= FIT_PIN_WITHIN_M`
// filter (fit every pin, as before) → the airport test goes red;
// `role: 'img'` again → red; link to another id → red.

const sections: SectionView[] = DISTURBANCE_SECTIONS.map((s) => ({
  type: 'prose',
  variant: null,
  slot: s.slot,
  heading: s.heading,
  subheading: null,
  body: s.body,
  imageUrl: null,
  imageAlt: null,
  ctaHref: null,
  ctaLabel: null,
  items: [],
}));
// The campsite is at (50.0 N, 5.0 E): a motorway 556 m north, an airport 4 448 m north.
const LAT = 50.0;
const LON = 5.0;
const payload: DisturbancePayload = {
  radiusM: DISTURBANCE_RADIUS_M,
  items: [
    { kind: 'road', metres: 556, lon: 5.0, lat: 50.005, name: 'A1' },
    { kind: 'airport', metres: 4448, lon: 5.0, lat: 50.04, name: 'Airport X' },
  ],
};
const view = disturbanceView(payload, sections)!;
const base = {
  photos: [] as const,
  lat: LAT,
  lon: LON,
  type: 'paid',
  label: 'Camp Test',
};
const media = (props: object) =>
  renderComponent(CampsiteMedia, { ...base, ...props }, { omit: CLIENT_ISLANDS });
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const legendOf = (h: string) =>
  h.match(/<span data-testid="disturbance-legend".*?<\/a>[^<]*<\/span>/s)?.[0] ?? '';

test('🔴 next to the map, in the HTML: every pin named with its distance, and the caveat', async () => {
  const legend = legendOf(await media({ disturbance: view.markers }));
  expect(legend).not.toBe('');
  // nothing of it is hidden from a sighted reader (the «!» badge alone is decorative)
  expect(legend.replace(/<span aria-hidden="true"[^>]*>\s*!\s*<\/span>/, '')).not.toMatch(
    /sr-only|\shidden[\s=>]|display:\s*none|aria-hidden/,
  );
  const t = text(legend);
  expect(t).toContain('Possible disturbance: Motorway or trunk road, 556 m');
  // the airport is OUTSIDE the first view of the map, so this line is where a reader learns of it
  expect(t).toContain('Possible disturbance: Airport, 4.4 km');
  expect(t).toContain('We have not measured noise or air on the spot');
  expect(t).toContain('decide for yourself');
});

test('🔴 the line leads to the block, and the block is there to be led to', async () => {
  const legend = legendOf(await media({ disturbance: view.markers }));
  const href = legend.match(/<a href="#([^"]+)"/)?.[1];
  expect(href).toBe('camp-disturbance-heading');
  const block = await renderComponent(CampDisturbance, { view });
  expect(block).toContain(`<h2 id="${href}"`);
});

test('🔴 no pins, no line — and no «!» left behind', async () => {
  for (const h of [await media({}), await media({ disturbance: [] })]) {
    expect(h).not.toContain('disturbance-legend');
    expect(text(h)).not.toContain('!');
    expect(text(h)).not.toContain('measured noise');
  }
});

test('with a photograph there is no map, so no pins and no line about them', async () => {
  const h = await media({
    disturbance: view.markers,
    photos: [{ url: '/p.jpg', source: 'owner', credit: 'Owner', width: 4, height: 3 }],
  });
  expect(h).not.toContain('disturbance-legend');
});

test('the distances this file states are the distances the points are at', () => {
  expect(Math.abs(metresBetween(LAT, LON, 50.005, 5.0) - 556)).toBeLessThanOrEqual(2);
  expect(Math.abs(metresBetween(LAT, LON, 50.04, 5.0) - 4448)).toBeLessThanOrEqual(5);
  // at 50 N a degree of longitude is 71.5 km, not 111 km
  expect(Math.abs(metresBetween(LAT, LON, 50.0, 5.01) - 715)).toBeLessThanOrEqual(3);
});

test('🔴 a far airport does not widen the first view; a road within 1 km does', () => {
  expect(framedPins(LAT, LON, view.markers).map((d) => d.kind)).toEqual(['road']);
  const box = fitBox(LAT, LON, null, view.markers)!;
  // the frame reaches the motorway (50.005) and stops there — not the airport (50.04)
  expect(box).toEqual([
    [5.0, 50.0],
    [5.0, 50.005],
  ]);
  // by hand: 0.005 deg of latitude is 556 m, against the 4 448 m it used to span
  expect(metresBetween(box[0][1], box[0][0], box[1][1], box[1][0])).toBeLessThan(FIT_PIN_WITHIN_M);
});

test('🔴 only a far pin: the map keeps its own zoom on the campsite (nothing to fit)', () => {
  const airportOnly = view.markers.filter((d) => d.kind === 'airport');
  expect(airportOnly).toHaveLength(1);
  expect(fitBox(LAT, LON, null, airportOnly)).toBeNull();
  expect(fitBox(LAT, LON, null, [])).toBeNull();
});

test('with an outline: the outline, the point and the near pin — still not the airport', () => {
  const outline: Box = [
    [4.999, 49.999],
    [5.001, 50.001],
  ];
  expect(fitBox(LAT, LON, outline, view.markers)).toEqual([
    [4.999, 49.999],
    [5.001, 50.005],
  ]);
  expect(fitBox(LAT, LON, outline, [])).toEqual(outline);
});

test('🔴 a pin is a button that can be focused and pressed, named by the CMS words', () => {
  const road = view.markers[0];
  const a = pinAttributes(road, false);
  expect(a.role).toBe('button');
  expect(a.tabindex).toBe('0');
  expect(a['aria-label']).toBe('Possible disturbance: Motorway or trunk road, 556 m');
  expect(a['aria-expanded']).toBe('false');
  expect(pinAttributes(road, true)['aria-expanded']).toBe('true');
  // the words are not left to a tooltip a touch screen never shows
  expect(Object.keys(a)).not.toContain('title');
});
