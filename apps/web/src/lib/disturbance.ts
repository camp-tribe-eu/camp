// CAMP-502 — the «Possible disturbance» block: distance to the nearest
// motorway / railway line / airport, with the sentence that says we did not
// measure noise or air.
//
// 🔴 NO WORDS ARE TYPED HERE. Headings, the intro and the caveat are sections of
// the CMS page `camp-disturbance` (migration 1797100000000), found by slot.
// 🔴 NO CAVEAT, NO BLOCK. The numbers without the sentence "we have not measured
// noise" read as a statement about silence we cannot back; a missing or empty
// `caveat` returns null, and so does every other missing slot.
// 🔴 NO COMPUTED DISTANCE, NO BLOCK: not "unknown", not an empty heading.

import { formatDistance, type DisturbancePayload } from '@/lib/api';
import { substitute } from '@/lib/rich-text';
import type { SectionView } from '@/lib/page-content';

export const DISTURBANCE_PAGE = 'camp-disturbance';

export const DISTURBANCE_KINDS = ['road', 'rail', 'airport'] as const;
export type DisturbanceKind = (typeof DISTURBANCE_KINDS)[number];

export const DISTURBANCE_SLOTS = [
  'intro',
  'caveat',
  ...DISTURBANCE_KINDS.map((k) => `kind-${k}`),
  'map-label',
] as const;

export interface DisturbanceRow {
  kind: DisturbanceKind;
  label: string;
  distance: string;
}
export interface DisturbanceMarker {
  kind: DisturbanceKind;
  lat: number;
  lon: number;
  /** Words for the map pin, from the CMS: "Possible disturbance: Airport, 3.2 km". */
  label: string;
}
export interface DisturbanceView {
  heading: string;
  intro: string;
  caveatHeading: string;
  caveat: string;
  rows: DisturbanceRow[];
  markers: DisturbanceMarker[];
}

const bySlot = (sections: SectionView[], slot: string): SectionView | null => {
  const f = sections.filter((s) => s.slot === slot);
  return f.length === 1 ? f[0] : null;
};
const filled = (v: string | null | undefined): v is string =>
  typeof v === 'string' && v.trim() !== '';

export function disturbanceView(
  payload: DisturbancePayload | undefined,
  sections: SectionView[] | null,
): DisturbanceView | null {
  if (!payload || !Array.isArray(payload.items) || !sections) return null;
  const s: Record<string, SectionView> = {};
  for (const slot of DISTURBANCE_SLOTS) {
    const sec = bySlot(sections, slot);
    if (!sec || !filled(sec.heading)) return null;
    s[slot] = sec;
  }
  // The caveat is the BODY of its section: the sentence itself, not a title.
  if (!filled(s.caveat.body) || !filled(s.intro.body) || !filled(s['map-label'].heading))
    return null;

  const rows: DisturbanceRow[] = [];
  const markers: DisturbanceMarker[] = [];
  for (const kind of DISTURBANCE_KINDS) {
    const item = payload.items.find((i) => i.kind === kind);
    if (
      !item ||
      !Number.isFinite(item.metres) ||
      item.metres < 0 ||
      !Number.isFinite(item.lat) ||
      !Number.isFinite(item.lon)
    )
      continue;
    const label = s[`kind-${kind}`].heading!;
    const distance = formatDistance(item.metres);
    rows.push({ kind, label, distance });
    markers.push({
      kind,
      lat: item.lat,
      lon: item.lon,
      label: substitute(s['map-label'].heading!, { kind: label, distance }),
    });
  }
  if (rows.length === 0) return null;
  return {
    heading: s.intro.heading!,
    intro: substitute(s.intro.body!, {
      road: formatDistance(payload.radiusM.road),
      rail: formatDistance(payload.radiusM.rail),
      airport: formatDistance(payload.radiusM.airport),
    }),
    caveatHeading: s.caveat.heading!,
    caveat: s.caveat.body!,
    rows,
    markers,
  };
}
