// CAMP-503 — the services block: which labels it needs from the CMS, and the
// pure step from API payload + CMS page to what the reader sees.
//
// 🔴 NO WORDS ARE TYPED HERE. Every label, heading and caveat is a section of
// the CMS page `camp-services` (seeded by migration 1796900000000), found by
// slot. If the page or ANY slot is missing, the block is not drawn: a block
// that speaks without its caveats (EV charging is not the camper's hookup) is
// worse than no block. A spec reads the migration's slot list and this one.

import { formatDistance, type CampServicesPayload, type Hookup } from '@/lib/api';
import { substitute } from '@/lib/rich-text';
import type { SectionView } from '@/lib/page-content';

export const CAMP_SERVICES_PAGE = 'camp-services';

// CAMP-506: three groups by the traveller's need, in page order. Mirrors
// CAMP_SERVICE_GROUPS in apps/api/src/spots/camp-services.ts (a spec compares
// them). The page groups by ITS OWN list, not by what the payload claims.
export const GROUPS = [
  { group: 'before', kinds: ['fuel', 'groceries', 'ev_charging', 'gas'] },
  { group: 'stay', kinds: ['water', 'dump'] },
  { group: 'trouble', kinds: ['pharmacy', 'car_repair'] },
] as const;

/** Mirrors RADIUS_KINDS in the API module (a spec compares them). */
export const RADIUS_KINDS = ['water', 'dump'] as const;

/** Page order. `ev_charging` — never `charging`/`electricity`. */
export const KINDS = GROUPS.flatMap((g) => g.kinds) as unknown as readonly [
  'fuel',
  'groceries',
  'ev_charging',
  'gas',
  'water',
  'dump',
  'pharmacy',
  'car_repair',
];

export const SLOTS = [
  'intro',
  ...GROUPS.map((g) => `group-${g.group}`),
  ...KINDS.map((k) => `kind-${k}`),
  'source',
  'onsite',
  'within',
  'nearby',
  'unnamed',
  'hookup',
  'hookup-voltage',
  'hookup-power',
  'hookup-price',
] as const;

/** Slots whose BODY is a template this module fills (`{{date}}`, `{{onsite}}`). */
export const TEMPLATE_SLOTS = ['source', 'within'] as const;

export interface ServiceLine {
  where: 'onsite' | 'within' | 'nearby';
  label: string;
  /** The OSM name, or the CMS's "not named" wording. */
  name: string;
  distance: string;
  /** "OpenStreetMap, imported 2026-11-05"; null when the day is unknown. */
  source: string | null;
}
export interface ServiceRow {
  kind: (typeof KINDS)[number];
  heading: string;
  note: string | null;
  lines: ServiceLine[];
}
export interface ServiceGroup {
  group: (typeof GROUPS)[number]['group'];
  heading: string;
  rows: ServiceRow[];
}
export interface ServicesView {
  heading: string;
  intro: string;
  /** Only groups with at least one row — an empty group is not drawn. */
  groups: ServiceGroup[];
  hookup: { heading: string; note: string | null; facts: { label: string; value: string }[] } | null;
}

const bySlot = (sections: SectionView[], slot: string): SectionView | null => {
  const f = sections.filter((s) => s.slot === slot);
  return f.length === 1 ? f[0] : null;
};

/**
 * `null` = draw nothing: no page, a missing slot, or no point in range.
 * 🔴 Zero items is `null` BEFORE the hookup is looked at — no points in the
 * radius, no block (the owner's hookup is shown inside the block only).
 */
export function servicesView(
  payload: CampServicesPayload | undefined,
  hookup: Hookup | undefined,
  sections: SectionView[] | null,
): ServicesView | null {
  if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) return null;
  if (!sections) return null;
  const s: Record<string, SectionView> = {};
  for (const slot of SLOTS) {
    const sec = bySlot(sections, slot);
    if (!sec || !sec.heading || sec.heading.trim() === '') return null;
    s[slot] = sec;
  }
  // 🔴 A TEMPLATE THE PAGE FILLS ITSELF LIVES IN A BODY, NEVER A HEADING. The
  // CMS loader (page-content.ts applyValues) expands every heading against a
  // fixed whitelist and throws on `{{date}}` / `{{onsite}}` — which is how the
  // whole block went missing after CAMP-506. Bodies it leaves alone.
  for (const slot of TEMPLATE_SLOTS)
    if (!s[slot].body || s[slot].body.trim() === '') return null;
  const groups: ServiceGroup[] = [];
  for (const g of GROUPS) {
  const rows: ServiceRow[] = [];
  for (const kind of g.kinds) {
    const item = payload.items.find((i) => i.kind === kind);
    if (!item) continue;
    const lines: ServiceLine[] = [];
    // 🔴 `within` is a DISTANCE (no outline mapped; water and dump only), and
    // the page takes it only for those kinds — it never becomes "on site".
    const within = (RADIUS_KINDS as readonly string[]).includes(kind)
      ? item.withinRadius
      : null;
    for (const [where, p] of [
      ['onsite', item.onSite],
      ['within', within],
      ['nearby', item.nearby],
    ] as const) {
      if (!p) continue;
      lines.push({
        where,
        label:
          where === 'within'
            ? substitute(s.within.body!, { onsite: formatDistance(payload.onSiteM) })
            : s[where].heading!,
        name: p.name ?? s.unnamed.heading!,
        distance: formatDistance(p.metres),
        source:
          typeof p.seen === 'string' && p.seen !== ''
            ? substitute(s.source.body!, { date: p.seen })
            : null,
      });
    }
    if (lines.length === 0) continue;
    rows.push({
      kind,
      heading: s[`kind-${kind}`].heading!,
      note: s[`kind-${kind}`].body,
      lines,
    });
  }
  if (rows.length > 0)
    groups.push({ group: g.group, heading: s[`group-${g.group}`].heading!, rows });
  }
  if (groups.length === 0) return null;
  const facts: { label: string; value: string }[] = [];
  if (hookup?.voltageV !== undefined)
    facts.push({ label: s['hookup-voltage'].heading!, value: `${hookup.voltageV} V` });
  if (hookup?.powerKw !== undefined)
    facts.push({ label: s['hookup-power'].heading!, value: `${hookup.powerKw} kW` });
  if (hookup?.priceEurPerNight !== undefined)
    facts.push({ label: s['hookup-price'].heading!, value: `€${hookup.priceEurPerNight}` });
  return {
    heading: s.intro.heading!,
    intro: substitute(s.intro.body ?? '', {
      nearby: formatDistance(payload.nearbyM),
      onsite: formatDistance(payload.onSiteM),
    }),
    groups,
    hookup:
      facts.length > 0
        ? { heading: s.hookup.heading!, note: s.hookup.body, facts }
        : null,
  };
}
