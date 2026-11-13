import { expect, test } from '@playwright/test';
import { renderComponent } from './render-component';
import CampDisturbance from '@/components/camp-disturbance';
import { DISTURBANCE_SLOTS, disturbanceView } from '@/lib/disturbance';
import type { DisturbancePayload } from '@/lib/api';
import type { SectionView } from '@/lib/page-content';
import { DISTURBANCE_SECTIONS } from '../../../api/src/migrations/1797100000000-Disturbance';
import { DISTURBANCE_RADIUS_M } from '../../../api/src/spots/disturbance';

// CAMP-502 — the «Possible disturbance» block, read out of the RENDERED HTML.
//
// 🔴 The words are the migration's own (DISTURBANCE_SECTIONS), served as the API
// serves a CMS page. Every assertion reads text a reader reads — the caveat is
// found in the HTML, outside any `sr-only` element.
//
// MUTATIONS (done, see the PR): delete the `caveat` section from the CMS list →
// the block is not drawn; remove the caveat <p> from the component → the
// "have not measured noise" test goes red; remove the `rows.length === 0`
// return → the "no distance, no block" test goes red.

const toSections = (list: typeof DISTURBANCE_SECTIONS): SectionView[] =>
  list.map((s) => ({
    type: 'prose', variant: null, slot: s.slot, heading: s.heading, subheading: null,
    body: s.body, imageUrl: null, imageAlt: null, ctaHref: null, ctaLabel: null, items: [],
  }));
const sections = toSections(DISTURBANCE_SECTIONS);

const payload: DisturbancePayload = {
  radiusM: DISTURBANCE_RADIUS_M,
  items: [
    { kind: 'road', metres: 556, lon: 5.0, lat: 50.005, name: 'A1' },
    { kind: 'airport', metres: 4448, lon: 5.0, lat: 50.04, name: 'Airport X' },
  ],
};
const html = (p: DisturbancePayload | undefined, s: SectionView[] | null = sections) =>
  renderComponent(CampDisturbance, { view: disturbanceView(p, s) });
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the slots the page reads are exactly the slots the migration seeds', () => {
  expect([...DISTURBANCE_SLOTS].sort()).toEqual(DISTURBANCE_SECTIONS.map((s) => s.slot).sort());
});

test('distances for the kinds that have one, and nothing for the others', async () => {
  const h = await html(payload);
  const t = text(h);
  expect(t).toContain('Possible disturbance');
  expect(h).toMatch(/data-kind="road"[^>]*>\s*<dt[^>]*>Motorway or trunk road<\/dt>\s*<dd[^>]*>556 m</);
  expect(h).toMatch(/data-kind="airport"[^>]*>\s*<dt[^>]*>Airport<\/dt>\s*<dd[^>]*>4\.4 km</);
  expect(t).not.toContain('Railway line');
});

test('🔴 the caveat is visible text next to the numbers: we did not measure noise', async () => {
  const h = await html(payload);
  const block = h.match(/data-testid="camp-disturbance".*?<\/section>/s)![0];
  expect(block).not.toMatch(/sr-only|\shidden[\s=>]|display:\s*none|aria-hidden/);
  const t = text(block);
  expect(t).toContain('We have not measured noise or air on the spot');
  expect(t).toContain('distances we calculated from OpenStreetMap');
  expect(t).toContain('Being close to such objects often means noise');
  expect(t).toContain('decide for yourself');
  // the caveat is in the same section as the numbers, after them
  expect(t.indexOf('556 m')).toBeLessThan(t.indexOf('We have not measured'));
});

test('the thresholds in the intro are the ones the payload carries', async () => {
  const t = text(await html({ ...payload, radiusM: { road: 800, rail: 1200, airport: 6000 } }));
  expect(t).toContain('800 m for a motorway or trunk road');
  expect(t).toContain('1.2 km for a railway line');
  expect(t).toContain('6.0 km for an airport');
});

test('🔴 without the caveat there is no block: a missing slot, an empty body', async () => {
  expect(await html(payload, sections.filter((s) => s.slot !== 'caveat'))).toBe('');
  expect(await html(payload, sections.map((s) => (s.slot === 'caveat' ? { ...s, body: '  ' } : s)))).toBe('');
  expect(await html(payload, sections.map((s) => (s.slot === 'caveat' ? { ...s, body: null } : s)))).toBe('');
  expect(await html(payload, null)).toBe('');
});

test('🔴 no computed distance, no block — not "unknown"', async () => {
  expect(await html({ radiusM: DISTURBANCE_RADIUS_M, items: [] })).toBe('');
  expect(await html(undefined)).toBe('');
  expect(
    await html({ radiusM: DISTURBANCE_RADIUS_M, items: [{ kind: 'road', metres: NaN, lon: 1, lat: 1, name: null }] }),
  ).toBe('');
});

test('map pins: one per computed distance, with the CMS words and the point on the object', () => {
  const v = disturbanceView(payload, sections)!;
  expect(v.markers).toEqual([
    { kind: 'road', lat: 50.005, lon: 5.0, label: 'Possible disturbance: Motorway or trunk road, 556 m' },
    { kind: 'airport', lat: 50.04, lon: 5.0, label: 'Possible disturbance: Airport, 4.4 km' },
  ]);
});
