// CAMP-31: where the map's tiles come from, and how to change that.
//
// 🔴 The switcher is not a feature for its own sake. The card names the
// real reason: it is the escape hatch. OpenFreeMap's own terms say they
// "may discontinue it at any time without notice" and carry no SLA
// (Facts/map-tiles-choice.md), so the day that matters we want to change
// one entry here rather than rewrite a map component under pressure.
//
// 🔴 What is deliberately NOT in this list, and why.
//
//   CARTO      the card suggested it. Their own page: "free to use up to
//              a fair use limit of 5 million tile requests a month — all
//              you need is an API key… for commercial use we'll talk
//              about an Enterprise license". A key is an owner action,
//              and the commercial position is ambiguous exactly where
//              OpenFreeMap's is explicit. Not wired in on a maybe.
//
//   VersaTiles serves tiles with no key and is FLOSS, but describes its
//              hosted instance as being for "newsrooms, NGOs, developers
//              and public institutions". That is not a grant of
//              commercial use, and we do not build on an inference.
//
//   our own    the honest second provider (CAMP-29 / CAMP-97). It is a
//              slot here already: set NEXT_PUBLIC_SELF_TILES_URL and it
//              appears in the switcher with no other change.
//
// So today the list is several verified styles from one verified
// provider, plus an empty slot. That is the truth about our supply, and
// the architecture the card asks for is what makes it cheap to change.

export interface MapSource {
  id: string;
  /** What the reader sees on the button. */
  label: string;
  /** MapLibre style URL. */
  style: string;
  /** Shown under the map — a licence condition, not decoration. */
  attribution: string;
  /** Who serves it, for the "one source is down" notice. */
  provider: string;
}

const OFM = process.env.NEXT_PUBLIC_TILES_URL ?? 'https://tiles.openfreemap.org';

/**
 * Attribution is required by OpenFreeMap and by ODbL underneath it.
 * MapLibre renders its own control, but we also state it in the page so
 * it survives the control being hidden on a narrow screen.
 */
const OFM_ATTRIBUTION =
  'OpenFreeMap © OpenMapTiles · Data from OpenStreetMap';

export const MAP_SOURCES: MapSource[] = [
  {
    id: 'liberty',
    label: 'Standard',
    style: `${OFM}/styles/liberty`,
    attribution: OFM_ATTRIBUTION,
    provider: 'OpenFreeMap',
  },
  {
    id: 'bright',
    label: 'Bright',
    style: `${OFM}/styles/bright`,
    attribution: OFM_ATTRIBUTION,
    provider: 'OpenFreeMap',
  },
  {
    id: 'positron',
    label: 'Muted',
    style: `${OFM}/styles/positron`,
    attribution: OFM_ATTRIBUTION,
    provider: 'OpenFreeMap',
  },
];

// The slot. Nothing else changes when it is filled.
if (process.env.NEXT_PUBLIC_SELF_TILES_URL) {
  MAP_SOURCES.push({
    id: 'self',
    label: 'CampTribe',
    style: process.env.NEXT_PUBLIC_SELF_TILES_URL,
    attribution: 'Data from OpenStreetMap',
    provider: 'CampTribe',
  });
}

export const DEFAULT_SOURCE_ID = MAP_SOURCES[0].id;

/**
 * Where the map opens — on what we actually hold, not on "Europe".
 *
 * 🔴 Derived from the data, and it moved once already. With Slovenia
 * alone the centre was 14.5, 46.1; adding Croatia pulled the campsites
 * down the Adriatic and the real extent became 13.45–19.38 °E,
 * 42.45–46.78 °N, centred on 15.14, 44.82. The old view opened north of
 * most of the dataset, which reads as "they have nothing down there".
 *
 * This is worth re-checking whenever a country is imported: a map that
 * opens away from its own data looks emptier than it is.
 */
export const INITIAL_VIEW = { lng: 15.1, lat: 44.8, zoom: 6.2 };
