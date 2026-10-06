import SATELLITE from '@/data/satellite-sources.json';

// CAMP-221 — the satellite base layer, one national source at a time.
//
// 🔴 THE CARD'S FIRST CORRECTION IS ABOUT ITSELF. It says "there is no
// base-layer switcher at all — nought of three", and so did my own audit
// in `docs/design-audit.md`. Both were wrong: `campsite-map.tsx` has had
// one since it was written, labelled "Map style", a button per entry in
// `MAP_SOURCES`. What it offers is three cartographic styles from
// OpenFreeMap. So the mockup's three are Map ✓, Satellite ✗, Terrain ✗ —
// the mechanism exists and two of the three kinds of base layer do not.
//
// 🔴 AND THE LICENCES ARE THE WORK, not the plumbing. The mockup settled
// the policy: Esri, Bing and Google are closed to us, orthophotos come
// from national open sources. A policy is not a licence. Each entry in
// `satellite-sources.json` carries the licence VERBATIM, the attribution
// string, the URL it was read from and the date — because "open" is a
// word and "CC BY 4.0 scne.es" is a term somebody can check.
//
// Measured on 06.10.2026, from the services themselves:
//
//   ES  ows:AccessConstraints  "CC BY 4.0 scne.es",  Fees "No se aplican
//       condiciones". Tile z14/8347/6168 → 200, image/jpeg.
//   FR  the service points at cartes.gouv.fr/cgu, the CGU point at the
//       dataset record, and the record says "Licence Ouverte / Open
//       License (compatible ODC-BY, CC-BY 2.0)". Tile → 200, image/jpeg.
//   NL  the service says Fees "none" and AccessConstraints "none", which
//       is not a licence — see `notYet` in the data file. Not enabled.

export interface SatelliteSource {
  id: string;
  /** ISO 3166-1 alpha-2, lower case, as our own rows carry it. */
  country: string;
  label: string;
  provider: string;
  licence: string;
  licenceVerbatim: string;
  attribution: string;
  readFrom: string;
  readField: string;
  caveat?: string;
  tiles: string;
  maxzoom: number;
}

export const SATELLITE_SOURCES: SatelliteSource[] =
  SATELLITE.sources as SatelliteSource[];

/** Countries we have no orthophoto for, with the reason, for the UI to say. */
export const SATELLITE_NOT_YET = SATELLITE.notYet;

/**
 * The source to offer for what is currently on screen, or null.
 *
 * 🔴 DECIDED BY COUNTRY, NOT BY BOUNDING BOX, and the data file records
 * why: the French layer declares a worldwide extent (-180 -80 to 180 80)
 * for imagery that stops at the French border, and the Spanish one
 * declares none at the layer level. A bbox from the service would offer
 * Spanish orthophotos over Poland.
 *
 * The countries come from the features the map has already drawn, so
 * this needs no new request and no invented geometry.
 */
export function satelliteFor(countries: readonly string[]): SatelliteSource | null {
  const seen = new Set(countries.map((c) => c.toLowerCase()));
  // 🔴 Offered only when EVERY country on screen is covered. A view
  // straddling the Pyrenees would otherwise show France in photographs
  // and Spain as nothing, which is the grey field the card forbids: a
  // reader reads an empty half as "no campsites here", not as "no
  // imagery here".
  if (seen.size === 0) return null;
  const covered = SATELLITE_SOURCES.filter((s) => seen.has(s.country));
  if (covered.length !== seen.size) return null;
  // One source at a time: two national services cannot be stacked into
  // one raster layer, and the first is the one the view is mostly in.
  return covered[0] ?? null;
}

/** Why satellite is unavailable here, in words a reader can act on. */
export function whySatelliteUnavailable(countries: readonly string[]): string {
  const seen = [...new Set(countries.map((c) => c.toLowerCase()))];
  if (seen.length === 0) return 'Zoom in far enough to show one country.';
  const missing = seen.filter(
    (c) => !SATELLITE_SOURCES.some((s) => s.country === c),
  );
  if (missing.length === 0) {
    return 'This view crosses a border. Satellite imagery comes from one national service at a time.';
  }
  return (
    `No open orthophoto service we can use covers ${missing
      .map((c) => c.toUpperCase())
      .join(', ')} yet. ` +
    'Esri, Bing and Google are closed to us by licence, so this layer is ' +
    'national or it is nothing.'
  );
}
