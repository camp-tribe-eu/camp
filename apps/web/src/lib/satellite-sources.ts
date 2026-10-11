import SATELLITE from "@/data/satellite-sources.json";

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
//       condiciones". Tile z14/8013/6180 (Madrid) → 200, image/jpeg, 18883 B.
//       🔴 The control tile used to be z14/8347/6168 — open Mediterranean,
//       200 and 1652 B of black. It proved the service answers, not that it
//       serves photographs. Re-measured on land 11.10.2026.
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
  /**
   * The name this provider credits itself by — "IGN", not the legal name
   * that begins "Institut national de l'information géographique…".
   *
   * 🔴 Declared here because the guard requires it and the data carries
   * it, while this interface did not: a field three places depend on and
   * one place describes is a field that drifts. Found when the new unit
   * test touched it and TypeScript said it does not exist.
   */
  providerShort: string;
  attribution: string;
  readFrom: string;
  readField: string;
  /** The tile we actually fetched, with its answer, so the claim is checkable. */
  verifiedTile?: string;
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
export function satelliteFor(
  countries: readonly string[],
): SatelliteSource | null {
  const seen = new Set(countries.map((c) => c.toLowerCase()));
  if (seen.size === 0) return null;
  // 🔴 ONE COUNTRY, FULL STOP — and the first version of this said so in
  // a comment while doing the opposite. It filtered SATELLITE_SOURCES by
  // the countries on screen and returned `covered[0]`, calling it "the
  // one the view is mostly in". There is no "mostly" here: `covered` is
  // in the order of the DATA FILE, so a view holding France and Spain
  // returned whichever entry was typed first.
  //
  // What that shipped, measured on the live services 11.10.2026:
  //
  //   ES service over a FRENCH tile  z14/8302/5745 → HTTP 200, 1561 B
  //   ES service over Madrid         z14/8013/6180 → HTTP 200, 18883 B
  //   FR service over Madrid                       → HTTP 404
  //
  // Both 256×256. The 1561-byte one is a flat green-brown fill, not a
  // photograph — I opened it. So driving Spain → France with the layer on
  // showed that fill CREDITED TO "© IGN España". Crediting a national
  // mapping agency with an image it never served is worse than showing
  // nothing, and CC BY makes it a licence problem as well as a lie.
  //
  // Two national rasters cannot be stacked into one layer, so a view that
  // crosses a border gets no imagery and a sentence saying why.
  if (seen.size > 1) return null;
  const [only] = [...seen];
  return SATELLITE_SOURCES.find((s) => s.country === only) ?? null;
}

/**
 * The MapLibre raster spec for a source.
 *
 * 🔴 IT LIVES HERE SO THE CREDIT CANNOT BE WRITTEN BY HAND. The guard
 * used to prove the component carried the attribution by grepping the
 * .tsx for `attribution: source.attribution` — and a commented-out line
 * still matches a grep. Building the spec in one tested function means
 * the component has nowhere to put a credit of its own.
 */
export function rasterSourceSpec(source: SatelliteSource) {
  return {
    type: "raster" as const,
    tiles: [source.tiles],
    tileSize: 256,
    maxzoom: source.maxzoom,
    attribution: source.attribution,
  };
}

/** Why satellite is unavailable here, in words a reader can act on. */
export function whySatelliteUnavailable(countries: readonly string[]): string {
  const seen = [...new Set(countries.map((c) => c.toLowerCase()))];
  if (seen.length === 0) return "Zoom in far enough to show one country.";
  if (seen.length > 1) {
    return (
      "This view crosses a border. Satellite imagery comes from one " +
      "national service at a time, and one service does not photograph " +
      "its neighbour — so we show none rather than one country's imagery " +
      "over another country's ground."
    );
  }
  const [only] = seen;
  if (SATELLITE_SOURCES.some((s) => s.country === only)) {
    return "Satellite imagery is available here.";
  }
  // 🔴 "WE LOOKED AND THERE IS NONE" AND "WE HAVE NOT LOOKED" ARE
  // DIFFERENT SENTENCES, and the first version printed the first one for
  // both. It said "No open orthophoto service we can use covers HR, SI
  // yet" for every country without a source — twenty-five of them — when
  // exactly one country had actually been researched. Claiming a negative
  // result nobody measured is the same fault this repository keeps
  // finding in its own guards, moved to the page.
  const researched = SATELLITE_NOT_YET.find((n) => n.country === only);
  if (researched) {
    return (
      `No orthophoto service we can use covers ${only.toUpperCase()} yet. ` +
      `${researched.whyNotEnabled} ` +
      "Esri, Bing and Google are closed to us by licence, so this layer is " +
      "national or it is nothing."
    );
  }
  return (
    `We have not yet looked for an open orthophoto service in ${only.toUpperCase()}. ` +
    "Esri, Bing and Google are closed to us by licence, so this layer is " +
    "national or it is nothing."
  );
}
