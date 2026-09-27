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
  | 'toilets'
  | 'dogFriendly'
  | 'wifi'
  | 'greyWater'
  | 'laundry'
  | 'wheelchair'
  | 'wheelchairFull';

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
 * 🔴 Priority between the two lists and the global sets, decided by
 * CAMP-25 and worth stating because it is not obvious.
 *
 *   rule.yes  >  rule.no  >  TRUTHY  >  namedVariantMeansYes  >  FALSY
 *
 * `rule.no` has to outrank TRUTHY because one word can mean opposite
 * things in different questions. `limited` is globally truthy — a shower
 * with restrictions is still a shower — but `wheelchair=limited` is
 * precisely NOT full step-free access, and telling a wheelchair user it
 * is would send them on a wasted journey. Measured in the Croatian and
 * Slovenian extract: 47 of the 144 positively-tagged sites say `limited`,
 * so this is a third of the answer, not an edge case.
 *
 * Existing rules are unaffected: `toilets:disposal` lists `none` (already
 * falsy) and `internet_access` lists `terminal`/`wired` (in neither set).
 */

/**
 * A rule where the key/value pair itself is the statement, e.g.
 * `amenity=shower`. Presence means yes; absence means nothing at all, never
 * "no" - another site's `amenity=toilets` says nothing about showers.
 */
interface PresenceRule {
  kind: 'presence';
  key: string;
  /**
   * Omit when the key EXISTING is the statement, whatever it says.
   *
   * `toilets:wheelchair=no` describes a toilet that is not accessible —
   * which still tells us there is a toilet. Reading its value would give
   * exactly the wrong answer, and measured on the Croatian extract it is
   * the only evidence of toilets on 8 sites.
   */
  value?: string;
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

  // CAMP-32: the owner's call, and he is right — for a lot of people a
  // site without toilets is simply not an option, so an unanswered
  // question here is worth more than a guess.
  //
  // 🔴 `toilets=yes` is the documented tag on a campsite. `amenity=toilets`
  // is a DIFFERENT statement: it marks a toilet block as its own object,
  // and on a campsite feature it means the same thing — this site has
  // toilets. Both are accepted.
  //
  // `toilets:disposal` names how waste is handled (flush, pitlatrine,
  // chemical, bucket). Somebody who wrote that has certainly seen a
  // toilet, so it counts as a yes in the same way a named power socket
  // does — but `none` is an explicit no, which is exactly the kind of
  // honest negative the three-state model exists to carry.
  toilets: [
    // `separated` means separate facilities for men and women — plainly a
    // yes, and not in the standard truthy set. Two sites in the Croatian
    // extract say exactly that, and were reading as "unknown".
    { kind: 'value', key: 'toilets', yes: ['separated'] },
    { kind: 'presence', key: 'amenity', value: 'toilets' },
    // How the waste is handled (flush, chemical, pitlatrine…). Someone
    // who wrote that has seen a toilet — and `none` is them saying there
    // is nowhere to go, which is the honest negative the three-state
    // model exists to carry.
    //
    // 🔴 Above the accessibility tag on purpose: this is a direct
    // statement about the toilet, that one is an inference from a tag
    // about something else. A site carrying both should be read by what
    // it states, not by what we deduce.
    {
      kind: 'value',
      key: 'toilets:disposal',
      namedVariantMeansYes: true,
      no: ['none'],
    },
    // 🔴 The key alone, not its value. Someone who recorded whether the
    // toilets are wheelchair-accessible has seen toilets, and
    // `toilets:wheelchair=no` means "not accessible", never "no toilet".
    // Measured: the only evidence of toilets on 8 Croatian sites.
    { kind: 'presence', key: 'toilets:wheelchair' },
    // Seen on caravan sites: the chemical-toilet disposal point. It is a
    // facility for emptying a toilet, not a toilet, so it is deliberately
    // NOT a match — the distinction matters to the person filtering.
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

  // CAMP-35 "злив сірої води". The best-covered of the new amenities and
  // the reason this one was worth adding first: measured on the Croatian
  // and Slovenian extract, `sanitary_dump_station` is set on 341 of 1739
  // sites (19.6%) — better coverage than wifi's `internet_access`, and
  // 52 of those are an explicit `no`, which is a real negative answer
  // rather than silence.
  //
  // 🔴 This is deliberately NOT part of `toilets` — see the note there.
  // A chemical-toilet disposal point is somewhere to empty a tank, not
  // somewhere to go, and to the camper filtering for one they are
  // different questions.
  greyWater: [
    { kind: 'value', key: 'sanitary_dump_station' },
    { kind: 'presence', key: 'amenity', value: 'sanitary_dump_station' },
    { kind: 'value', key: 'sanitary_dump_station:fee' },
  ],

  // CAMP-35 "пральня". The honest position on coverage: the documented
  // `laundry` key does not appear on a single campsite in our two
  // countries (measured: 0 of 1739). What people actually tag is
  // `washing_machine`, on 68 sites (3.9%), and `dryer` on 7.
  //
  // So this filter is thin, and the three-state model is what makes it
  // safe to ship anyway: 96% of sites answer "unknown" rather than
  // pretending to answer "no". The rules keep `laundry` first because it
  // is the correct tag and coverage elsewhere in Europe may differ.
  //
  // `dryer` is a value rule, not a presence rule: `dryer=no` plausibly
  // describes a laundry room without one, so its absence of a dryer is
  // not evidence either way — unlike `toilets:wheelchair`, where any
  // value at all proves a toilet exists.
  laundry: [
    { kind: 'value', key: 'laundry' },
    { kind: 'presence', key: 'amenity', value: 'laundry' },
    { kind: 'value', key: 'washing_machine' },
    { kind: 'value', key: 'dryer' },
  ],

  // CAMP-25. Kept as its own category rather than folded in with the
  // amenities above, which is what the card asks for and also what the
  // data deserves: `wheelchair` is set on 166 of 1739 sites here (9.5%),
  // and 4.0 million times across OSM.
  //
  // 🔴 Only the site-level `wheelchair` tag. `toilets:wheelchair` says the
  // toilet block is accessible, which is a statement about the toilet —
  // inferring from it that the *site* is reachable by wheelchair is
  // exactly the kind of guess that ends with somebody unable to get out
  // of their van. It stays where it belongs: as evidence of toilets.
  //
  // Two keys, because one would have to lie. Measured values here:
  // yes 91, limited 47, no 22, designated 6.
  wheelchair: [{ kind: 'value', key: 'wheelchair' }],

  // Full step-free access, with `limited` counted as a no. The distinction
  // is the whole point of CAMP-25: "accessible with restrictions" is
  // useful to many people and useless to a wheelchair user who needs the
  // real thing, and 47 of our 144 positives are exactly that case.
  wheelchairFull: [
    { kind: 'value', key: 'wheelchair', yes: ['designated'], no: ['limited'] },
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

function readValueRule(
  rule: ValueRule,
  tags: OsmTags,
): AmenityResolution | null {
  const raw = tags[rule.key];
  if (raw === undefined || raw === null || raw === '') return null;

  const parts = splitValues(raw);
  if (parts.length === 0) return null;

  const matchedBy = `${rule.key}=${parts.join(';')}`;

  // Any part saying yes wins: `yes;cee_17_blue` is a yes, and a site that
  // lists two socket types has not become less electrified.
  for (const value of parts) {
    if (rule.yes?.includes(value))
      return { value: AmenityValue.YES, matchedBy };
  }

  // Then this rule's own negatives, BEFORE the global truthy set — see the
  // priority note above `ValueRule`. This is the only place a rule can say
  // "for this question, that word means no".
  for (const value of parts) {
    if (rule.no?.includes(value)) return { value: AmenityValue.NO, matchedBy };
  }

  for (const value of parts) {
    if (TRUTHY.has(value)) return { value: AmenityValue.YES, matchedBy };
    if (
      rule.namedVariantMeansYes &&
      !NON_COMMITTAL.has(value) &&
      !FALSY.has(value)
    ) {
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
  const text = raw.trim().toLowerCase();
  if (text === '') return null;
  // No `value` means the key's existence is the whole statement.
  if (rule.value === undefined) {
    return { value: AmenityValue.YES, matchedBy: rule.key };
  }
  if (text !== rule.value) return null;
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
  'toilets',
  'dogFriendly',
  'wifi',
  'greyWater',
  'laundry',
  'wheelchair',
  'wheelchairFull',
];

/**
 * Accessibility is its own group, not an amenity among amenities —
 * CAMP-25 asks for that explicitly, and the reason is not cosmetic: a
 * camper scanning for a shower and a camper who cannot climb a step are
 * not doing the same thing, and burying the second inside a list of nine
 * tick-boxes is how it gets missed.
 */
export const ACCESSIBILITY_KEYS: AmenityKey[] = [
  'wheelchair',
  'wheelchairFull',
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
      return {
        type: 'camper_stop',
        confident: true,
        reason: 'caravan_site + fee=no',
      };
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

// ---------------------------------------------------------------------------
// Contact — CAMP-141
// ---------------------------------------------------------------------------

/**
 * What a reader needs to actually go, and what we were throwing away.
 *
 * 🔴 Measured 27.09.2026 through Overpass, before writing a line of this.
 * Of the campsites OSM holds, a contact of some kind exists for 75.4% in
 * Slovenia (171 sites) and 79.6% in Austria (598). We imported none of
 * it: `mapAmenities` above reads water, showers, electricity and pets,
 * and nothing that tells a reader how to reach the place. The 10.7% of
 * websites we did have came from DATAtourisme, which is France only.
 *
 *   website 61-72%   phone 40-49%   email 27-36%   addr:city 50-52%
 *
 * This is also the real answer to CAMP-114 ("their structured data has
 * 34 blocks, ours has 1"): the markup was never the constraint. We emit
 * what we can back with data, and there was no data.
 */
export interface SpotContact {
  website?: string;
  phone?: string;
  email?: string;
  operator?: string;
  openingHours?: string;
  /** Pitches, as OSM records them — a plain count. */
  capacity?: number;
  address?: { street?: string; city?: string; postcode?: string };
}

/** The first tag of a list that carries a non-empty value. */
const firstTag = (tags: OsmTags, keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = tags[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return undefined;
};

/**
 * 🔴 A URL we would put in an anchor and in JSON-LD, so it is checked.
 *
 * OSM is open data: the value of `website` is whatever a mapper typed.
 * Most of it is `https://…`, plenty of it is `www.example.com`, and a
 * `javascript:` or `data:` value is a cross-site scripting hole in a
 * page we render and in structured data Google reads. So only http and
 * https survive, a bare domain is given https, and everything else is
 * dropped rather than guessed at.
 */
/**
 * 🔴 An aggregator is not the campsite's own site.
 *
 * `datatourisme/parse.ts` already refuses these with a written reason —
 * "when every candidate is an aggregator we store nothing, a gap shown
 * as a gap" — and the same rule has to hold here, or the two sources
 * disagree about what "website" means. Review measured 28 live spots
 * whose OSM website was a Facebook page or booking.com: rendered as
 * "Website" and emitted as `sameAs`, which is a machine-readable claim
 * that a Facebook page IS the campsite.
 *
 * Kept as a literal copy rather than an import: this module is
 * deliberately free of the Nest runtime so the pipeline can load it
 * alone, and reaching into the DATAtourisme parser would drag it in.
 */
const AGGREGATOR_HOST =
  /(booking|reservation|resa|secureholiday|webcamp)|(^|\.)(facebook|instagram|twitter|x|tiktok|youtube|linkedin|tripadvisor|pinterest|whatsapp)\.[a-z.]+$/i;

export function cleanWebsite(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (v === '') return undefined;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return undefined;
  }
  // 🔴 No scheme check here, and there was one.
  //
  // It read `if (url.protocol !== 'http:' && …) return undefined`, and
  // review proved it unreachable: the line above gives every value
  // without a scheme an `https://`, so `new URL` either parses it as
  // http(s) or throws. Instrumented over 216 061 inputs — every staging
  // value plus an adversarial set plus 200 000 fuzz strings — it was
  // reached zero times. The protection is real and comes from the parse
  // failing, not from a branch that cannot run, so the branch is gone
  // and this paragraph says where the safety actually lives.
  //
  // A host with no dot is not a domain — "localhost", or a mapper's note.
  if (!url.hostname.includes('.')) return undefined;
  if (AGGREGATOR_HOST.test(url.hostname.replace(/^www\./, '')))
    return undefined;
  return url.toString();
}

/** OSM writes free text here; keep it printable and bounded. */
const cleanText = (
  raw: string | undefined,
  max: number,
): string | undefined => {
  if (!raw) return undefined;
  // eslint-disable-next-line no-control-regex
  const v = raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (v === '') return undefined;
  return v.length > max ? `${v.slice(0, max).trim()}…` : v;
};

export function mapContact(tags: OsmTags): SpotContact {
  const out: SpotContact = {};

  const website = cleanWebsite(
    firstTag(tags, ['website', 'contact:website', 'url', 'contact:url']),
  );
  if (website) out.website = website;

  // 🔴 OSM puts several numbers in one tag, separated by ';'.
  //
  // The page builds `tel:` by stripping everything but digits and '+',
  // so "+33 4 92 57 81 77 ; +33 6 80 13 39 50" became the undialable
  // `tel:+33492578177+33680133950` — review found 157 live phones doing
  // exactly that. Only the first number is kept: one number that works
  // beats two glued into a third that does not.
  const phoneRaw = firstTag(tags, ['phone', 'contact:phone', 'contact:mobile']);
  const phone = cleanText(phoneRaw?.split(';')[0], 40);
  // A phone with no digit at all is a note, not a number.
  if (phone && /\d/.test(phone)) out.phone = phone;

  const email = cleanText(firstTag(tags, ['email', 'contact:email']), 120);
  // A bare "@" test, not a full RFC one: the point is to refuse a note
  // like "ask at reception", not to validate deliverability.
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.email = email;

  const operator = cleanText(firstTag(tags, ['operator']), 120);
  if (operator) out.operator = operator;

  const openingHours = cleanText(firstTag(tags, ['opening_hours']), 200);
  if (openingHours) out.openingHours = openingHours;

  // 🔴 `capacity` is a count of pitches and is routinely mistyped. A
  // value that is not a plain positive integer is dropped rather than
  // coerced — "approx 120" becoming 120 is the kind of quiet invention
  // this project does not do.
  const capacityRaw = firstTag(tags, ['capacity']);
  if (capacityRaw !== undefined && /^\d{1,5}$/.test(capacityRaw)) {
    const n = Number(capacityRaw);
    if (n > 0) out.capacity = n;
  }

  // 🔴 A house number with no street is not a street address.
  //
  // The first version joined whatever existed, so `addr:housenumber=24`
  // alone became `streetAddress: "24"`. Review found 144 live rows like
  // that and 242 more waiting in staging. The number is only meaningful
  // attached to a street, so without one it is dropped.
  const streetName = firstTag(tags, ['addr:street']);
  const street = streetName
    ? cleanText(
        [streetName, firstTag(tags, ['addr:housenumber'])]
          .filter(Boolean)
          .join(' '),
        160,
      )
    : undefined;
  const city = cleanText(firstTag(tags, ['addr:city']), 120);
  const postcode = cleanText(firstTag(tags, ['addr:postcode']), 20);
  if (street || city || postcode) {
    out.address = {};
    if (street) out.address.street = street;
    if (city) out.address.city = city;
    if (postcode) out.address.postcode = postcode;
  }

  return out;
}
