// CAMP-35 / CAMP-25: what the map filters ask the database for.
//
// 🔴 The hard part of this file is not SQL, it is the sentence in CAMP-35:
// "відсутній тег в OSM ≠ зручності немає, це невідомо. Фільтр не повинен
// ховати кемпінг лише тому, що мапер не заповнив поле."
//
// That rules out both obvious designs. Measured on our 1189 staged
// features:
//
//   shower = 'yes' only        → 315 sites, and 874 disappear because
//                                nobody wrote the tag down. The card
//                                forbids exactly this.
//   shower != 'no'             → 1182 sites. Honest, and useless — it is
//                                not a filter, it is a no-op.
//
// So neither set is the answer on its own, and picking one silently is
// how a filter becomes a liar. What we return instead is the strict set
// PLUS the number of sites that fell out only for want of data, so the
// interface can say "306 campsites have a shower · 874 more where nobody
// recorded it" and let the reader decide. `includeUnknown` is that
// decision coming back.
//
// Everything here is pure — filters in, SQL fragment and parameters out —
// so the self-test can drive every branch without a database, and
// filters.spec.ts checks the generated SQL against real rows.

import { AMENITY_KEYS, AmenityKey } from '../osm/tag-mapping';

/** Mirrors CampingSpotType; kept as a union so this file stays ORM-free. */
export const SPOT_TYPES = [
  'free',
  'paid',
  'wild',
  'camper_stop',
  'rv_park',
] as const;
export type SpotType = (typeof SPOT_TYPES)[number];

export interface MapFilters {
  /** Empty means every type — not "no types", which would return nothing. */
  types: SpotType[];
  /** Amenities that must be present. Empty means no amenity constraint. */
  amenities: AmenityKey[];
  /**
   * When true, a site whose answer is `unknown` still matches. The reader
   * asked for it after being told how many there are.
   */
  includeUnknown: boolean;
}

export const NO_FILTERS: MapFilters = {
  types: [],
  amenities: [],
  includeUnknown: false,
};

/**
 * Reads filters off a query string.
 *
 * 🔴 Unknown values are dropped, not rejected. A stale bookmark carrying
 * an amenity we have since renamed should show the map, not an error —
 * and the alternative, echoing the bad value back in a message, is how a
 * query parameter turns into reflected content. Everything that survives
 * is a member of a list defined in this codebase, which is also why the
 * SQL below can name columns without escaping anything.
 */
export function parseFilters(query: Record<string, unknown>): MapFilters {
  return {
    types: pickKnown(query.types, SPOT_TYPES as readonly string[]) as SpotType[],
    amenities: pickKnown(query.amenities, AMENITY_KEYS) as AmenityKey[],
    includeUnknown: isTruthy(query.unknown),
  };
}

function pickKnown(raw: unknown, allowed: readonly string[]): string[] {
  if (typeof raw !== 'string' || raw === '') return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const value = part.trim();
    // A repeated value must not repeat the SQL condition.
    if (allowed.includes(value)) seen.add(value);
  }
  return [...seen];
}

function isTruthy(raw: unknown): boolean {
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export interface FilterSql {
  /** ` AND ...` to append to a WHERE clause; empty when nothing is filtered. */
  where: string;
  params: unknown[];
  /**
   * The same filter with `unknown` counted as a match, for the count that
   * tells the reader what they are not being shown. Empty when no amenity
   * is filtered, because then nothing is hidden for want of data.
   */
  lenientWhere: string;
  lenientParams: unknown[];
}

/**
 * Builds the WHERE fragment.
 *
 * `next` is the number of parameters the caller has already used, so the
 * placeholders continue the caller's numbering rather than starting over
 * — the bbox occupies $1..$4 in every query here.
 */
export function filterSql(filters: MapFilters, next: number): FilterSql {
  const strict = build(filters, next, filters.includeUnknown);
  // 🔴 The lenient placeholders continue where the strict ones stopped,
  // because the count query below asks both questions in one statement
  // and therefore passes both parameter lists, concatenated, to one call.
  const lenient = build(filters, next + strict.params.length, true);
  return {
    where: strict.where,
    params: strict.params,
    // Nothing is excluded for want of data when no amenity is asked about,
    // so there is no second question to ask.
    lenientWhere: filters.amenities.length ? lenient.where : '',
    lenientParams: filters.amenities.length ? lenient.params : [],
  };
}

function build(
  filters: MapFilters,
  next: number,
  allowUnknown: boolean,
): { where: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let n = next;

  if (filters.types.length) {
    params.push(filters.types);
    parts.push(`type = ANY($${++n}::text[]::camping_spots_type_enum[])`);
  }

  for (const amenity of filters.amenities) {
    // 🔴 The key travels as a parameter, not as text spliced into the
    // query. It is already restricted to AMENITY_KEYS by parseFilters, so
    // this is belt and braces — but the belt is what stops the next
    // person adding a caller that skips the parser.
    params.push(amenity);
    const key = `amenities ->> $${++n}`;
    parts.push(
      allowUnknown
        ? // "not a no" rather than "yes or unknown": a row written before
          // this amenity existed has no such key at all, and `->>` gives
          // NULL for it. Spelling it as an explicit inequality with a NULL
          // guard keeps those rows in, where they belong.
          `(${key} IS DISTINCT FROM 'no')`
        : `${key} = 'yes'`,
    );
  }

  return {
    where: parts.length ? ` AND ${parts.join(' AND ')}` : '',
    params,
  };
}

/** Human-readable summary of what was asked for, for logs and tests. */
export function describeFilters(filters: MapFilters): string {
  const bits: string[] = [];
  if (filters.types.length) bits.push(`types=${filters.types.join('+')}`);
  if (filters.amenities.length)
    bits.push(`amenities=${filters.amenities.join('+')}`);
  if (filters.includeUnknown) bits.push('unknown=included');
  return bits.join(' ') || 'none';
}
