import { expect, test } from '@playwright/test';
import { renderComponent } from './render-component';
import CampServices from '@/components/camp-services';
import { SLOTS, servicesView } from '@/lib/camp-services';
import type { CampServicesPayload } from '@/lib/api';
import type { SectionView } from '@/lib/page-content';
import { CAMP_SERVICES_SECTIONS } from '../../../api/src/migrations/1796900000000-CampServicesText';

// CAMP-503 — the services block, read out of the RENDERED HTML.
//
// 🔴 The words are the migration's own (CAMP_SERVICES_SECTIONS), served as
// the API serves a CMS page — not constants of this file, and not the classes
// of the component. Every assertion reads text a reader reads.

const sections: SectionView[] = CAMP_SERVICES_SECTIONS.map((s) => ({
  type: 'prose', variant: null, slot: s.slot, heading: s.heading, subheading: null,
  body: s.body, imageUrl: null, imageAlt: null, ctaHref: null, ctaLabel: null, items: [],
}));

const payload: CampServicesPayload = {
  nearbyM: 10_000,
  onSiteM: 150,
  items: [
    { kind: 'water', onSite: { name: 'Tap by the gate', metres: 73 }, nearby: { name: 'Village fountain', metres: 773 } },
    { kind: 'ev_charging', onSite: null, nearby: { name: 'Ionity Zell', metres: 4210 } },
    { kind: 'gas', onSite: null, nearby: { name: null, metres: 5558 } },
  ],
};

const html = async (p: CampServicesPayload | undefined, hookup = undefined as never, s: SectionView[] | null = sections) =>
  renderComponent(CampServices, { view: servicesView(p, hookup, s) });
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('names and distances are in the HTML, on site apart from nearby', async () => {
  const h = await html(payload);
  const t = text(h);
  expect(t).toContain('Tap by the gate, 73 m');
  expect(t).toContain('Village fountain, 773 m');
  expect(t).toContain('Ionity Zell, 4.2 km');
  expect(h).toMatch(/data-where="onsite"[^>]*>\s*<dt[^>]*>On site<\/dt>\s*<dd[^>]*>Tap by the gate, 73 m/);
  expect(h).toMatch(/data-where="nearby"[^>]*>\s*<dt[^>]*>Nearby<\/dt>\s*<dd[^>]*>Village fountain, 773 m/);
  // kinds the data has no point for are not mentioned
  expect(t).not.toContain('Fuel station');
  // a point without an OSM name says so, in the CMS's words
  expect(t).toContain('Not named in OpenStreetMap, 5.6 km');
});

test('the radii in the intro are the ones the payload carries', async () => {
  const t = text(await html({ ...payload, nearbyM: 7000, onSiteM: 90 }));
  expect(t).toContain('within 90 m of its marked point');
  expect(t).toContain('up to 7.0 km');
});

test('🔴 EV charging is labelled as electric-car charging, not as camper power', async () => {
  const h = await html(payload);
  const li = h.match(/<li[^>]*data-kind="ev_charging".*?<\/li>/s)![0];
  const t = text(li);
  expect(t).toContain('Electric-car charging');
  expect(t).toContain('not a mains hookup for a camper');
  // no hookup facts unless the OWNER filled them
  expect(h).not.toContain('camp-hookup');
});

test('owner hookup facts appear only when the owner gave them', async () => {
  const h = await html(payload, { voltageV: 230, powerKw: 3.7 } as never);
  const t = text(h.match(/data-testid="camp-hookup".*?<\/section>/s)![0]);
  expect(t).toContain('Voltage 230 V');
  expect(t).toContain('Power 3.7 kW');
  expect(t).not.toContain('Price per night');
});

test('🔴 nothing in range draws nothing at all', async () => {
  expect(await html({ nearbyM: 10_000, onSiteM: 150, items: [] })).toBe('');
  expect(await html(undefined)).toBe('');
});

test('🔴 no CMS page, or a slot missing from it, draws nothing — not a block without its caveats', async () => {
  expect(await html(payload, undefined as never, null)).toBe('');
  const noEv = sections.filter((s) => s.slot !== 'kind-ev_charging');
  expect(await html(payload, undefined as never, noEv)).toBe('');
});

test('the slots the page reads are exactly the slots the migration seeds', () => {
  expect([...SLOTS]).toEqual(CAMP_SERVICES_SECTIONS.map((s) => s.slot));
});
