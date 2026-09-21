// CAMP-27: OSM tags -> camping_spots schema.
//
// OSM does not describe an amenity one way. A shower is `shower=yes` on one
// site, `amenity=shower` on the next, and missing entirely on the third -
// and "missing" is not "no shower", it is "nobody wrote it down". Filters
// built directly on raw tags silently drop half the real campsites, which is
// exactly what this layer exists to prevent.
//
// Everything here is pure: tags in, values out, no database. The transform
// that writes rows lives in transform.ts and the weekly de-duplicated import
// is CAMP-28.

/**
 * Three states, not two.
 *
 * `UNKNOWN` is the whole point of this module: the map filter and the spot
 * page must be able to tell "this site has no shower" apart from "we don't
 * know whether this site has a shower". Collapsing them into a boolean is a
 * lie we would then show to users as fact.
 */
export enum AmenityValue {
  YES = 'yes',
  NO = 'no',
  UNKNOWN = 'unknown',
}

export type AmenityKey =
  | 'electricity'
  | 'water'
  | 'shower'
  | 'dogFriendly'
  | 'wifi';

export type OsmTags = Record<string, string | undefined | null>;

/**
 * A rule that reads a yes/no-ish tag, e.g. `shower=yes`.
 *
 * `yes` / `no` list values that count as positive/negative *on top of* the
 * standard OSM truthy set, for keys that use their own vocabulary
 * (`dog=leashed`, `internet_access=wlan`).
 */
interface ValueRule {
  kind: 'value';
  key: string;
  yes?: string[];
  no?: string[];
  /**
   * For keys whose value names a *variety* rather than answering yes/no:
   * `power_supply=cee_17_blue` is someone telling us which socket is
   * fitted, which is a stronger yes than `power_supply=yes`. Measured on
   * the Slovenian extract this was 6 sites we were calling "unknown".
   *
   * Non-committal values (`unknown`, `fixme`) are still not an answer.
   */
  namedVariantMeansYes?: boolean;
}

/**
 * A rule where the key/value pair itself is the statement, e.g.
 * `amenity=shower`. Presence means yes; absence means nothing at all, never
 * "no" - another site's `amenity=toilets` says nothing about showers.
 */
interface PresenceRule {
  kind: 'presence';
  key: string;
  value: string;
}

export type AmenityRule = ValueRule | PresenceRule;

/**
 * Values OSM uses for "yes" across almost every boolean-ish key.
 *
 * `limited` and `customers` are deliberately positive: for someone filtering
 * a map, "there is a shower but with restrictions" belongs with the sites
 * that have one, not with the sites that don't. `designated` is the
 * strongest possible yes (the site is explicitly set up for it).
 */
const TRUTHY = new Set([
  'yes',
  'true',
  '1',
  'designated',
  'limited',
  'customers',
  'public',
  'permissive',
]);

/**
 * `private` sits here on purpose: an amenity marked private is not available
 * to the camper doing the filtering, so answering "yes" would mislead.
 */
const FALSY = new Set(['no', 'false', '0', 'none', 'private']);

/**
 * Values that look like an answer but are not one. Kept out of
 * `namedVariantMeansYes` so a mapper's "I don't know" stays unknown.
 */
const NON_COMMITTAL = new Set(['unknown', 'fixme', 'undefined', 'maybe']);

/**
 * OSM packs several values into one tag with a semicolon:
 * `power_supply=yes;cee_17_blue`. Splitting is not cosmetic - without it
 * the whole tag reads as one unrecognised string and the site falls into
 * "unknown" despite being explicitly tagged.
 */
function splitValues(raw: string): string[] {
  return raw
    .split(';')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

/**
 * OSM tag -> our amenity. Order matters: the first rule that yields a
 * definite answer wins, so the most specific and most standard tag goes
 * first and the sloppy synonyms follow.
 *
 * Adding a synonym is one line here, and the coverage report
 * (report-coverage.ts) shows immediately whether it was worth adding.
 */
export const AMENITY_RULES: Record<AmenityKey, AmenityRule[]> = {
  // `power_supply` is the documented tag for camp/caravan sites.
  // `electricity` is not standard but appears in the wild often enough.
  electricity: [
    // Socket names (cee_17_blue, schuko, ...) are a yes: measured on the
    // Slovenian extract, 6 sites tagged the socket instead of a boolean.
    { kind: 'value', key: 'power_supply', namedVariantMeansYes: true },
    { kind: 'value', key: 'electricity' },
    { kind: 'presence', key: 'amenity', value: 'power_supply' },
    { kind: 'value', key: 'socket', namedVariantMeansYes: true },
  ],

  // Drinking water, not water in general: a lake on site is not a tap.
  // `water_point` is the caravan-filling tag and counts.
  // `conditional` = there is water, with a condition - a camper filtering
  // for water wants to see that site.
  water: [
    { kind: 'value', key: 'drinking_water', yes: ['conditional'] },
    { kind: 'presence', key: 'amenity', value: 'drinking_water' },
    { kind: 'value', key: 'water_point' },
    { kind: 'presence', key: 'amenity', value: 'water_point' },
    { kind: 'value', key: 'drinking_water:refill' },
  ],

  shower: [
    { kind: 'value', key: 'shower' },
    { kind: 'presence', key: 'amenity', value: 'shower' },
    // Non-standard plural, common on older campsite entries.
    { kind: 'value', key: 'showers' },
  ],

  // `leashed` is a yes with a condition, not a no - the dog may come.
  dogFriendly: [
    { kind: 'value', key: 'dog', yes: ['leashed', 'outside'] },
    { kind: 'value', key: 'dogs', yes: ['leashed'] },
    { kind: 'value', key: 'pets', yes: ['leashed'] },
  ],

  // `internet_access=terminal` is a shared computer, not wifi the camper can
  // use from their van - it is explicitly not a match.
  wifi: [
    {
      kind: 'value',
      key: 'internet_access',
      yes: ['wlan', 'wifi'],
      no: ['terminal', 'wired'],
    },
    { kind: 'value', key: 'wifi', yes: ['free'] },
    { kind: 'value', key: 'internet_access:ssid' },
  ],
};

export interface AmenityResolution {
  value: AmenityValue;
  /**
   * Which tag answered, e.g. `amenity=shower`. Null when nothing matched.
   * This is what makes the coverage report actionable: it shows not just
   * how much we recognise, but which synonym earned its place.
   */
  matchedBy: string | null;
}

function readValueRule(rule: ValueRule, tags: OsmTags): AmenityResolution | null {
  const raw = tags[rule.key];
  if (raw === undefined || raw === null || raw === '') return null;

  const parts = splitValues(raw);
  if (parts.length === 0) return null;

  const matchedBy = `${rule.key}=${parts.join(';')}`;

  // Any part saying yes wins: `yes;cee_17_blue` is a yes, and a site that
  // lists two socket types has not become less electrified.
  for (const value of parts) {
    if (rule.yes?.includes(value)) return { value: AmenityValue.YES, matchedBy };
    if (TRUTHY.has(value)) return { value: AmenityValue.YES, matchedBy };
    if (rule.namedVariantMeansYes && !NON_COMMITTAL.has(value) && !FALSY.has(value)) {
      return { value: AmenityValue.YES, matchedBy };
    }
  }

  // Only then consider it a no - and only if every part agrees.
  const allNo = parts.every(
    (value) => rule.no?.includes(value) || FALSY.has(value),
  );
  if (allNo) return { value: AmenityValue.NO, matchedBy };

  // A value we have never seen. Not an error and not a "no" - it is a
  // prompt to add a rule, and the report counts it as unrecognised.
  return null;
}

function readPresenceRule(
  rule: PresenceRule,
  tags: OsmTags,
): AmenityResolution | null {
  const raw = tags[rule.key];
  if (raw === undefined || raw === null) return null;
  if (raw.trim().toLowerCase() !== rule.value) return null;
  return {
    value: AmenityValue.YES,
    matchedBy: `${rule.key}=${rule.value}`,
  };
}

/** Resolves one amenity, reporting which tag decided it. */
export function resolveAmenity(
  amenity: AmenityKey,
  tags: OsmTags,
): AmenityResolution {
  for (const rule of AMENITY_RULES[amenity]) {
    const hit =
      rule.kind === 'value'
        ? readValueRule(rule, tags)
        : readPresenceRule(rule, tags);
    if (hit) return hit;
  }
  return { value: AmenityValue.UNKNOWN, matchedBy: null };
}

export type CampingSpotAmenities = Record<AmenityKey, AmenityValue>;

export const AMENITY_KEYS: AmenityKey[] = [
  'electricity',
  'water',
  'shower',
  'dogFriendly',
  'wifi',
];

/** Resolves the full amenity set for one OSM feature. */
export function mapAmenities(tags: OsmTags): CampingSpotAmenities {
  const out = {} as CampingSpotAmenities;
  for (const key of AMENITY_KEYS) {
    out[key] = resolveAmenity(key, tags).value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spot type
// ---------------------------------------------------------------------------

/**
 * Mirrors CampingSpotType in the entity. Duplicated as a plain union rather
 * than imported so this module stays free of TypeORM and can run in the
 * pipeline without the Nest runtime.
 */
export type SpotType = 'free' | 'paid' | 'wild' | 'camper_stop' | 'rv_park';

export interface SpotTypeResolution {
  type: SpotType;
  /** False when we fell back to a default instead of reading a real tag. */
  confident: boolean;
  reason: string;
}

/**
 * Infers our type enum from OSM.
 *
 * The enum column is NOT NULL, so unlike amenities there is no "unknown" to
 * fall back to - we must pick something. What we can do is be honest about
 * *when* we guessed: `confident=false` is counted by the coverage report, so
 * the size of the guess is a number we watch rather than a thing we forget.
 */
export function mapSpotType(tags: OsmTags): SpotTypeResolution {
  const tourism = tags.tourism?.trim().toLowerCase();
  const fee = tags.fee?.trim().toLowerCase();
  const campSite = tags['camp_site']?.trim().toLowerCase();
  const backcountry = tags.backcountry?.trim().toLowerCase();

  // Caravan sites: a Stellplatz/aire is an overnight parking spot, a proper
  // RV park is a site you stay at. `caravan_site=overnight_parking` is the
  // tag that separates them when it is present.
  if (tourism === 'caravan_site') {
    const kind = tags['caravan_site']?.trim().toLowerCase();
    if (kind === 'overnight_parking') {
      return {
        type: 'camper_stop',
        confident: true,
        reason: 'caravan_site=overnight_parking',
      };
    }
    if (FALSY.has(fee ?? '')) {
      return { type: 'camper_stop', confident: true, reason: 'caravan_site + fee=no' };
    }
    return { type: 'rv_park', confident: true, reason: 'tourism=caravan_site' };
  }

  // Backcountry / basic sites are what a camper means by "wild".
  if (backcountry && TRUTHY.has(backcountry)) {
    return { type: 'wild', confident: true, reason: 'backcountry=yes' };
  }
  if (campSite === 'basic' || campSite === 'wild') {
    return { type: 'wild', confident: true, reason: `camp_site=${campSite}` };
  }

  if (fee && FALSY.has(fee)) {
    return { type: 'free', confident: true, reason: 'fee=no' };
  }
  if (fee && TRUTHY.has(fee)) {
    return { type: 'paid', confident: true, reason: 'fee=yes' };
  }

  // No fee tag at all. Most tourism=camp_site entries in Europe are
  // commercial sites, so `paid` is the least-wrong default - but it IS a
  // default, and the report counts every one of them.
  return {
    type: 'paid',
    confident: false,
    reason: 'no fee tag - defaulted to paid',
  };
}
