// CAMP-520: travel styles — "does this place suit the way I travel" — as a
// filter, and ONLY from a statement somebody made about the place.
//
// 🔴 THE CARD'S RULE, AND THE WHOLE POINT OF THIS FILE: a style is never
// inferred from a neighbouring fact. "Quiet" is not a distance to a road,
// "family-friendly" is not a playground. A style exists on a row exactly
// when a source said the thing itself, and the source travels with it.
//
// 🔴 WHAT WAS MEASURED BEFORE ANYTHING WAS BUILT (production, 13.11.2026).
// The raw tags on production are `osm_camping_staging` — the LAST country
// imported, which is FRANCE: 12 968 OSM objects (12 836 of the 12 885 that
// match a row are FR). The other 26 countries' tags are not on the
// machine; their coverage is first known when the importer prints it.
// THIS FILE's rules, run over those 12 968 tag sets:
//
//   winter       yes 1 550 (11.95 %) · no 610 · known 16.66 %
//   adultsOnly   yes 4 (0.03 %) · no 0
//   family       no tag says it. `playground=yes` (40) is an indirect sign.
//   quiet        `quiet_time` on 1 object, and it is a curfew, not a claim.
//
// So two styles have a tag that states them and two have none. The two
// without are NOT in this file: there is no rule to write, and a key with
// no rule would be a label waiting for somebody to invent one. They arrive
// with the owner's cabinet (CAMP-500, CAMP-505) or not at all.
//
// `adultsOnly` is mapped — `min_age=18` is the statement itself — and the
// hub then hides it wherever the share of sites with any record is below
// `STYLE_MIN_KNOWN_SHARE` (spots/region-listing.ts), which today is
// everywhere. Hidden by a measurement, not by a constant somebody must
// remember to flip.
//
// Pure: tags in, values out, no database.

import type { OsmTags } from './tag-mapping';

export const TRAVEL_STYLE_KEYS = ['winter', 'adultsOnly'] as const;
export type TravelStyleKey = (typeof TRAVEL_STYLE_KEYS)[number];

/**
 * One style on one row. There is no `unknown` value: unknown is the KEY
 * BEING ABSENT, so "an answer without a source" has no spelling at all —
 * and the table's CHECK (migration SpotTravelStyles) refuses the rest.
 */
export interface TravelStyleEntry {
  value: 'yes' | 'no';
  /** `osm:seasonal=no` — the same spelling as `overnight_source`. */
  source: string;
}

export type TravelStyles = Partial<Record<TravelStyleKey, TravelStyleEntry>>;

/** What a stored source must look like; the CHECK holds the same pattern. */
export const STYLE_SOURCE_PATTERN = /^[a-z_]+:\S/;

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
/** December, January, February — indices into MONTHS. */
const WINTER = [11, 0, 1];
const SEASONS = new Set(['spring', 'summer', 'autumn', 'fall', 'winter']);

const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)';
/**
 * `Apr-Oct`, `Apr 1 - Oct 31`, `Apr 01-Sep 30` and nothing wider. Anything
 * with weekdays, hours, several rules or a comment is NOT read: an
 * opening_hours grammar half-understood is how a closed campsite becomes
 * "open in winter".
 */
const MONTH_RANGE = new RegExp(
  `^${MONTH}(?: ?\\d{1,2})? ?- ?${MONTH}(?: ?\\d{1,2})?$`,
);

type Opinion = TravelStyleEntry | null;

function fromSeasonal(raw: string | undefined | null): Opinion {
  if (!raw) return null;
  const tokens = raw
    .toLowerCase()
    .split(/[;/,]/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const source = `osm:seasonal=${tokens.join(';')}`;
  // "Not seasonal": the place does not close for a season.
  if (tokens.length === 1 && tokens[0] === 'no') {
    return { value: 'yes', source };
  }
  // A list of seasons answers the question either way. `seasonal=yes`
  // says a season exists and not which one, so it answers nothing.
  if (!tokens.every((t) => SEASONS.has(t))) return null;
  return { value: tokens.includes('winter') ? 'yes' : 'no', source };
}

function fromOpeningHours(raw: string | undefined | null): Opinion {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === '24/7') return { value: 'yes', source: 'osm:opening_hours=24/7' };
  const m = MONTH_RANGE.exec(v);
  if (!m) return null;
  const from = MONTHS.indexOf(m[1]);
  const to = MONTHS.indexOf(m[2]);
  const open = new Set<number>();
  for (let i = from; ; i = (i + 1) % 12) {
    open.add(i);
    if (i === to) break;
  }
  const winterOpen = WINTER.filter((i) => open.has(i)).length;
  const source = `osm:opening_hours=${raw.trim()}`;
  if (winterOpen === WINTER.length) return { value: 'yes', source };
  if (winterOpen === 0) return { value: 'no', source };
  // Open for part of the winter (`Feb-Nov`): neither answer is true.
  return null;
}

function winter(tags: OsmTags): Opinion {
  const a = fromSeasonal(tags.seasonal);
  const b = fromOpeningHours(tags.opening_hours);
  // 🔴 Two tags that disagree are not an answer. Measured: 6 French
  // objects say seasonal=no and carry a month in opening_hours.
  if (a && b && a.value !== b.value) return null;
  return a ?? b;
}

function adultsOnly(tags: OsmTags): Opinion {
  const raw = tags.min_age?.trim();
  if (!raw || !/^\d{1,2}$/.test(raw)) return null;
  return {
    value: Number(raw) >= 18 ? 'yes' : 'no',
    source: `osm:min_age=${raw}`,
  };
}

const RULES: Record<TravelStyleKey, (tags: OsmTags) => Opinion> = {
  winter,
  adultsOnly,
};

/** Every style a tag states, each with the tag that states it. */
export function mapTravelStyles(tags: OsmTags): TravelStyles {
  const out: TravelStyles = {};
  for (const key of TRAVEL_STYLE_KEYS) {
    const entry = RULES[key](tags);
    if (entry) out[key] = entry;
  }
  return out;
}

/**
 * The condition every reader uses for "this row HAS this style": a recorded
 * yes AND a source of the right shape. The source is tested here as well as
 * by the CHECK so that a table without the constraint (a hand-made one, a
 * restore made before the migration) still cannot put an unsourced row
 * under the filter.
 *
 * `key` is a member of TRAVEL_STYLE_KEYS, a constant of this codebase —
 * which is why it may be spliced in as text.
 */
export function styleYesSql(key: TravelStyleKey): string {
  return (
    `(travel_styles -> '${key}' ->> 'value' = 'yes'` +
    ` AND travel_styles -> '${key}' ->> 'source' ~ '^[a-z_]+:[^[:space:]]')`
  );
}

/** A recorded yes or no, with a source: the "we know" half of the coverage. */
export function styleKnownSql(key: TravelStyleKey): string {
  return (
    `(travel_styles -> '${key}' ->> 'value' IN ('yes', 'no')` +
    ` AND travel_styles -> '${key}' ->> 'source' ~ '^[a-z_]+:[^[:space:]]')`
  );
}
