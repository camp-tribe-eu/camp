// The rules that build a campsite's URL, and read its amenities.
//
// 🔴 Separate from spots.service.ts so they can be unit-tested. The
// service imports @nestjs/typeorm, which ships as ESM; Jest runs
// CommonJS here and will not parse it, so a spec that reached these
// through the service could not run at all. Measured on 22.09.2026:
// the whole query layer sat at 0% unit coverage for exactly this
// reason, and these two functions are the ones that must never change
// behaviour — CAMP-87 is explicit that a published URL does not move.

import {
  AMENITY_KEYS,
  AmenityValue,
  CampingSpotAmenities,
} from '../osm/tag-mapping';

/**
 * "Šibensko-Kninska" → "sibensko-kninska".
 *
 * 🔴 Accents are stripped rather than transliterated. Croatian and
 * Slovenian region names are full of them, and a URL with a literal Š in
 * it is percent-encoded by every client differently on the way into logs,
 * sitemaps and search consoles. An empty region gives an empty segment,
 * which the caller must not publish.
 */
export function slugifyRegion(region: string | null): string {
  if (!region) return '';
  return region
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The one address a campsite has. Built here, never assembled by hand. */
export function canonicalPath(
  country: string,
  region: string | null,
  slug: string,
): string {
  return `/camping/${country.toLowerCase()}/${slugifyRegion(region)}/${slug}`;
}

/**
 * The stored jsonb, read as a complete amenity set.
 *
 * A value we cannot read is unknown, never "no": a row written before an
 * amenity existed simply has no such key, and a missing key is not a
 * denial. Every read path goes through this, so the page and the map
 * cannot disagree about which amenities exist.
 */
export function readAmenities(stored: unknown): CampingSpotAmenities {
  const raw = (stored ?? {}) as Partial<CampingSpotAmenities>;
  return Object.fromEntries(
    AMENITY_KEYS.map((k) => [
      k,
      Object.values(AmenityValue).includes(raw[k] as AmenityValue)
        ? (raw[k] as AmenityValue)
        : AmenityValue.UNKNOWN,
    ]),
  ) as unknown as CampingSpotAmenities;
}
