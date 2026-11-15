// CAMP-520: travel styles on the region hub — the keys, and the words.
//
// 🔴 THE KEYS MIRROR apps/api/src/osm/travel-styles.ts, where the rules
// that produce them live and where it is written why there are two and not
// four: «family-friendly» and «quiet» have no tag that states them, and a
// style is never inferred from a neighbouring fact.
//
// 🔴 THE WORDS ARE NOT HERE. Every label and the coverage sentence come
// from the CMS page `travel-styles` (migration TravelStylesText); without
// them the group is not drawn at all — a filter we cannot name is not
// offered.

import { substitute } from './rich-text';
import type { SectionView } from './page-content';

export const TRAVEL_STYLE_KEYS = ['winter', 'adultsOnly'] as const;
export type TravelStyleKey = (typeof TRAVEL_STYLE_KEYS)[number];

/** The CMS page that holds the filter's words. */
export const TRAVEL_STYLES_PAGE = 'travel-styles';

const STYLE_SLOT: Record<TravelStyleKey, string> = {
  winter: 'style-winter',
  adultsOnly: 'style-adults-only',
};

/** What the API says about one style in one region (region-listing.ts). */
export interface StyleFacet {
  /** `matched` after toggling this style — the number on the chip. */
  toggled: number;
  /** Sites in the region with a sourced yes or no. */
  known: number;
  /** Sites in the region with a sourced yes. */
  yes: number;
  /** The region's coverage reaches the API's floor. */
  offered: boolean;
}

export interface TravelStyleText {
  /** The group's caption, e.g. «Travel style». */
  group: string;
  /** One label per style the CMS names. */
  labels: Partial<Record<TravelStyleKey, string>>;
  /** `{{label}}: recorded for {{known}} of {{total}} …` */
  coverage: string;
  /** Said when a style is on: the map beside the list does not apply it. */
  mapNote: string;
}

const filled = (v: string | null | undefined): v is string =>
  typeof v === 'string' && v.trim() !== '';

const bySlot = (sections: SectionView[], slot: string): SectionView | null => {
  const found = sections.filter((s) => s.slot === slot);
  return found.length === 1 ? found[0] : null;
};

/**
 * The filter's words, or `null` when the page, the caption, the coverage
 * sentence or the map note is missing. A style whose own label is missing is simply not in
 * `labels`: one unnamed chip does not take the named one down with it.
 */
export function travelStyleText(
  sections: SectionView[] | null | undefined,
): TravelStyleText | null {
  if (!sections) return null;
  const group = bySlot(sections, 'group')?.heading;
  const coverage = bySlot(sections, 'coverage')?.body;
  const mapNote = bySlot(sections, 'map-note')?.body;
  if (!filled(group) || !filled(coverage) || !filled(mapNote)) return null;
  const labels: TravelStyleText['labels'] = {};
  for (const key of TRAVEL_STYLE_KEYS) {
    const heading = bySlot(sections, STYLE_SLOT[key])?.heading;
    if (filled(heading)) labels[key] = heading;
  }
  return { group, labels, coverage, mapNote };
}

const isCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/** A facet that reads as one, or `null`: an older API sends none. */
export function readStyleFacet(raw: unknown): StyleFacet | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  if (!isCount(f.toggled) || !isCount(f.known) || !isCount(f.yes)) return null;
  if (typeof f.offered !== 'boolean') return null;
  return { toggled: f.toggled, known: f.known, yes: f.yes, offered: f.offered };
}

export interface StyleChip {
  key: TravelStyleKey;
  label: string;
  /** The number on the chip: what the click answers. */
  count: number;
  /** «Open in winter: recorded for 3 of 6 sites in this region. …» */
  coverage: string;
}

/**
 * The chips to draw, in key order.
 *
 * 🔴 A CHIP EXISTS ONLY WHEN ALL THREE HOLD: the CMS names the style, the
 * API sent its counts, and the region's coverage reaches the floor
 * (`offered`) — or the style is already ON, so the reader who arrived by a
 * link can still see what is applied and untick it.
 *
 * 🔴 THE COVERAGE SENTENCE IS NOT OPTIONAL. If the numbers cannot be put
 * into it (no total, or more known than there are sites) there is no chip:
 * the filter without its caveat is the half the card forbids.
 */
export function styleChips(
  text: TravelStyleText | null,
  facets: Partial<Record<TravelStyleKey, unknown>> | undefined,
  total: number,
  on: readonly TravelStyleKey[],
): StyleChip[] {
  if (!text || !facets || !isCount(total) || total === 0) return [];
  const chips: StyleChip[] = [];
  for (const key of TRAVEL_STYLE_KEYS) {
    const label = text.labels[key];
    const facet = readStyleFacet(facets[key]);
    if (!label || !facet) continue;
    if (facet.known > total || facet.yes > facet.known) continue;
    if (!facet.offered && !on.includes(key)) continue;
    chips.push({
      key,
      label,
      count: facet.toggled,
      coverage: substitute(text.coverage, {
        label,
        known: String(facet.known),
        total: String(total),
      }),
    });
  }
  return chips;
}
