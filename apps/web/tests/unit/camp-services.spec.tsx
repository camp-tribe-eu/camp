import { expect, test } from '@playwright/test';
import { renderComponent } from './render-component';
import CampServices from '@/components/camp-services';
import { GROUPS, RADIUS_KINDS, SLOTS, TEMPLATE_SLOTS, servicesView } from '@/lib/camp-services';
import type { CampServicesPayload } from '@/lib/api';
import { applyValues, type PageView, type SectionView } from '@/lib/page-content';
import { CAMP_SERVICES_SECTIONS as V1 } from '../../../api/src/migrations/1796900000000-CampServicesText';
import {
  CAMP_SERVICES_ADDED_SECTIONS,
  NEW_INTRO_HEADING,
} from '../../../api/src/migrations/1797000100000-CampServicesGroups';
import {
  NEW_GROCERIES_BODY,
  NEW_GROCERIES_HEADING,
  NEW_INTRO_BODY,
  NEW_SOURCE_BODY,
  NEW_SOURCE_HEADING,
  WITHIN_SECTION,
} from '../../../api/src/migrations/1797140000000-CampServicesOnSiteTruth';
import {
  CAMP_SERVICE_GROUPS,
  RADIUS_KINDS as API_RADIUS_KINDS,
} from '../../../api/src/spots/camp-services';

// What the page holds after ALL THREE migrations: the first seed with the
// intro heading the second gives it and the intro body and groceries words the
// third gives, plus the slots the second and third add. (That the migrations
// really leave the database like this is camp-services-text.db.spec.ts.)
const CAMP_SERVICES_SECTIONS = [
  ...V1.map((s) =>
    s.slot === 'intro' ? { ...s, heading: NEW_INTRO_HEADING, body: NEW_INTRO_BODY } : s,
  ),
  ...CAMP_SERVICES_ADDED_SECTIONS.map((s) =>
    s.slot === 'kind-groceries'
      ? { ...s, heading: NEW_GROCERIES_HEADING, body: NEW_GROCERIES_BODY }
      : s.slot === 'source'
        ? { ...s, heading: NEW_SOURCE_HEADING, body: NEW_SOURCE_BODY }
        : s,
  ),
  WITHIN_SECTION,
];

// CAMP-503 — the services block, read out of the RENDERED HTML.
//
// 🔴 The words are the migration's own (CAMP_SERVICES_SECTIONS), served as
// the API serves a CMS page — not constants of this file, and not the classes
// of the component. Every assertion reads text a reader reads.

const asPage = (ss: ReadonlyArray<{ slot: string; heading: string; body: string | null }>): PageView => ({
  slug: 'camp-services', title: 'Campsite services', metaTitle: null, metaDescription: null, noindex: true,
  sections: ss.map((s) => ({
    type: 'prose', variant: null, slot: s.slot, heading: s.heading, subheading: null,
    body: s.body, imageUrl: null, imageAlt: null, ctaHref: null, ctaLabel: null, items: [],
  })),
} as PageView);

// 🔴 THROUGH THE REAL LOADER. The page gets its sections from `pageContent`,
// which runs `applyValues` over them — and that throws on a `{{key}}` it does
// not know in ANY heading. This spec used to hand the migration's rows
// straight to the view, so it stayed green while CAMP-506's `{{date}}` in the
// `source` heading made the loader throw and the block vanish from every page.
const sections: SectionView[] = applyValues(asPage(CAMP_SERVICES_SECTIONS)).sections;

test('🔴 the page as CAMP-506 left it does not survive the loader — the reason the block was not drawn', () => {
  // The defect, pinned: if this ever stops throwing, the loader changed and
  // the "templates live in a body" rule below needs a second look.
  expect(() => applyValues(asPage([...V1, ...CAMP_SERVICES_ADDED_SECTIONS]))).toThrow(/date/);
});

test('🔴 no heading of the seeded page carries a {{placeholder}}; the two templates are bodies', () => {
  // MUTATION (done): put "{{onsite}}" into WITHIN_SECTION.heading → this is
  // red AND every render test above/below is (the loader throws at import).
  for (const s of CAMP_SERVICES_SECTIONS) expect(s.heading, s.slot).not.toContain('{{');
  expect(TEMPLATE_SLOTS).toEqual(['source', 'within']);
  expect(CAMP_SERVICES_SECTIONS.find((s) => s.slot === 'source')!.body).toContain('{{date}}');
  expect(WITHIN_SECTION.body).toContain('{{onsite}}');
});

test('🔴 a template slot with an empty body draws nothing, not a line without its label', async () => {
  const blank = sections.map((s) => (s.slot === 'within' ? { ...s, body: ' ' } : s));
  expect(await html(payload, undefined as never, blank)).toBe('');
});

const payload: CampServicesPayload = {
  nearbyM: 10_000,
  onSiteM: 150,
  items: [
    { kind: 'water', onSite: { name: 'Tap by the gate', metres: 73, seen: '2026-11-05' }, withinRadius: null, nearby: { name: 'Village fountain', metres: 773, seen: '2026-11-05' } },
    { kind: 'ev_charging', onSite: null, nearby: { name: 'Ionity Zell', metres: 4210, seen: '2026-11-05' } },
    { kind: 'gas', onSite: null, nearby: { name: null, metres: 5558, seen: null } },
    { kind: 'pharmacy', onSite: null, nearby: { name: 'Lekarna Bled', metres: 2310, seen: '2026-11-12' } },
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
  expect(t).toContain('Within 90 m, by distance: where no outline is mapped');
  expect(t).toContain('up to 7.0 km');
});

// Review of #555. A campsite with NO outline: the tap 77 m from its point and
// the fuel station 120 m from it. Nothing here is inside anything.
const noOutline: CampServicesPayload = {
  nearbyM: 10_000,
  onSiteM: 150,
  items: [
    { kind: 'fuel', onSite: null, withinRadius: null, nearby: { name: 'Shell', metres: 120, seen: '2026-11-10' } },
    { kind: 'water', onSite: null, withinRadius: { name: 'Tap A near', metres: 77, seen: '2026-11-10' }, nearby: { name: 'Tap 400', metres: 401, seen: '2026-11-10' } },
  ],
};

test('🔴 without an outline the HTML never says "On site": water is "within 150 m, by distance", fuel is "Nearby"', async () => {
  // MUTATION (done): label the `within` line with the `onsite` slot → red;
  // drop the `within` line from the view → red.
  const h = await html(noOutline);
  const t = text(h);
  expect(h).toMatch(/data-where="within"[^>]*>\s*<dt[^>]*>Within 150 m, by distance<\/dt>\s*<dd[^>]*>Tap A near, 77 m/);
  expect(h).toMatch(/data-where="nearby"[^>]*>\s*<dt[^>]*>Nearby<\/dt>\s*<dd[^>]*>Shell, 120 m/);
  expect(h).not.toContain('data-where="onsite"');
  // the only "On site" left on the page is the intro's definition of the term
  expect(t.match(/On site/g)).toEqual(['On site']);
  expect(t).toContain('outline, and said only where OpenStreetMap maps one.');
  expect(t).toContain('the distance alone does not tell whether it belongs to the campsite');
});

test('🔴 a "within the radius" answer on fuel is not drawn at all — the page keeps its own list of the two kinds', async () => {
  // MUTATION (done): take `item.withinRadius` for every kind → red.
  const lying: CampServicesPayload = {
    ...noOutline,
    items: [{ kind: 'fuel', onSite: null, withinRadius: { name: 'Shell', metres: 120, seen: null }, nearby: null }],
  };
  expect(await html(lying)).toBe('');
  expect([...RADIUS_KINDS]).toEqual([...API_RADIUS_KINDS]);
});

test('an API older than the field (no `withinRadius`) still draws the rest', async () => {
  const old = { nearbyM: 10_000, onSiteM: 150, items: [{ kind: 'water', onSite: null, nearby: { name: 'Tap', metres: 300, seen: null } }] };
  expect(text(await html(old))).toContain('Tap, 300 m');
});

test('🔴 the groceries row says it is the nearest food shop of either size, and how it differs from the supermarket figure', async () => {
  const h = await html({ ...noOutline, items: [{ kind: 'groceries', onSite: null, withinRadius: null, nearby: { name: 'Spar express', metres: 900, seen: null } }] });
  const t = text(h.match(/<li[^>]*data-kind="groceries".*?<\/li>/s)![0]);
  expect(t).toContain('Nearest food shop');
  expect(t).toContain('A supermarket or a convenience shop, whichever is closer.');
  expect(t).toContain('counts supermarkets only');
  expect(t).toContain('Nearby Spar express, 900 m');
  expect(t).not.toContain('Supermarket or shop');
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

test('the slots the page reads are exactly the slots the migrations seed', () => {
  expect([...SLOTS].sort()).toEqual(CAMP_SERVICES_SECTIONS.map((s) => s.slot).sort());
});

test('the page groups by the same list the API does', () => {
  expect(GROUPS.map((g) => ({ group: g.group, kinds: [...g.kinds] }))).toEqual(
    CAMP_SERVICE_GROUPS.map((g) => ({ group: g.group, kinds: [...g.kinds] })),
  );
});

test('🔴 groups come in the order of the need, each with its own CMS heading, and only the ones with points', async () => {
  const h = await html(payload);
  const groups = [...h.matchAll(/data-group="(\w+)"/g)].map((m) => m[1]);
  // no fuel/groceries/water-less group is invented: before (EV, gas), stay (water), trouble (pharmacy)
  expect(groups).toEqual(['before', 'stay', 'trouble']);
  const t = text(h);
  expect(t.indexOf('Before you arrive')).toBeLessThan(t.indexOf('At the campsite'));
  expect(t.indexOf('At the campsite')).toBeLessThan(t.indexOf('If something goes wrong'));
  const trouble = h.match(/data-group="trouble".*?<\/div>\s*<\/div>|data-group="trouble".*?<\/section>/s)![0];
  expect(text(trouble)).toContain('Pharmacy');
  expect(text(trouble)).toContain('Lekarna Bled, 2.3 km');
  // an empty group is not drawn
  const only = await html({ ...payload, items: [payload.items[3]] });
  expect([...only.matchAll(/data-group="(\w+)"/g)].map((m) => m[1])).toEqual(['trouble']);
});

test('🔴 the date we know it from is read out of the payload, per point, in the CMS words', async () => {
  const t = text(await html(payload));
  expect(t).toContain('Lekarna Bled, 2.3 km OpenStreetMap, imported 2026-11-12');
  expect(t).toContain('Ionity Zell, 4.2 km OpenStreetMap, imported 2026-11-05');
  // a point with no known day says no day — nothing invented
  expect(t).toContain('Not named in OpenStreetMap, 5.6 km');
  expect(t).not.toMatch(/Not named in OpenStreetMap, 5\.6 km\s+OpenStreetMap, imported/);
});
