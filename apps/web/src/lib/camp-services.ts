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

/** Page order. `ev_charging` — never `charging`/`electricity`. */
export const KINDS = ['fuel', 'ev_charging', 'water', 'dump', 'gas'] as const;

export const SLOTS = [
  'intro',
  ...KINDS.map((k) => `kind-${k}`),
  'onsite',
  'nearby',
  'unnamed',
  'hookup',
  'hookup-voltage',
  'hookup-power',
  'hookup-price',
] as const;

export interface ServiceLine {
  where: 'onsite' | 'nearby';
  label: string;
  /** The OSM name, or the CMS's "not named" wording. */
  name: string;
  distance: string;
}
export interface ServiceRow {
  kind: (typeof KINDS)[number];
  heading: string;
  note: string | null;
  lines: ServiceLine[];
}
export interface ServicesView {
  heading: string;
  intro: string;
  rows: ServiceRow[];
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
  const rows: ServiceRow[] = [];
  for (const kind of KINDS) {
    const item = payload.items.find((i) => i.kind === kind);
    if (!item) continue;
    const lines: ServiceLine[] = [];
    for (const [where, p] of [['onsite', item.onSite], ['nearby', item.nearby]] as const) {
      if (!p) continue;
      lines.push({
        where,
        label: s[where].heading!,
        name: p.name ?? s.unnamed.heading!,
        distance: formatDistance(p.metres),
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
  if (rows.length === 0) return null;
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
    rows,
    hookup:
      facts.length > 0
        ? { heading: s.hookup.heading!, note: s.hookup.body, facts }
        : null,
  };
}
