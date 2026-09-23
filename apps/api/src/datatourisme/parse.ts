// CAMP-101: one row of a DATAtourisme regional CSV, turned into our shape.
//
// 🔴 Every format decision below was read off the real files on
// 23.09.2026, not remembered. That matters here more than usual, because
// the fields are packed strings with three different separators and a
// plausible-looking guess is wrong in ways that pass silently:
//
//   Classements_du_POI   "4 étoiles#Classement officiel des hébergements
//                         touristiques|Accueil Vélo#France Vélo Tourisme"
//   Code_postal_et_commune "83400#Hyères"
//   Contacts_du_POI      "#https://a.example<>#https://b.example"
//   Categories_de_POI    "…#PlaceOfInterest|…#CampingAndCaravanning"
//
// `|` separates entries, `#` separates a value from its scheme, and `<>`
// separates contacts. A single regex for "N étoiles" over the whole
// classification field would happily read a star rating out of a cycling
// label, so the scheme is checked, not the number.
//
// Licence: Licence Ouverte 2.0 (Etalab), verified 23.09.2026 —
// commercial reuse allowed worldwide, attribution required INCLUDING the
// date the information was last updated. That is why `updatedAt` is not
// optional here: see the note on it.

/** The official French classification. Any other scheme is not stars. */
export const OFFICIAL_SCHEME =
  'Classement officiel des hébergements touristiques';

/** The accessibility mark, which is the other scheme worth keeping. */
export const ACCESSIBILITY_SCHEME = 'Marque Tourisme et Handicap';

export type DatatourismeRow = Record<string, string | undefined>;

export type ParsedSpot = {
  /** Stable identity in the source. The whole URI, not a fragment of it. */
  ref: string;
  name: string;
  lat: number;
  lon: number;
  /** 1–5 from the official scheme only, or null. */
  stars: number | null;
  /** The operator's own words, in French. Never translated by us. */
  description: string | null;
  address: string | null;
  postcode: string | null;
  commune: string | null;
  website: string | null;
  /**
   * 🔴 Required, and a row without it is refused.
   *
   * Licence Ouverte: "La « Réutilisation » ne doit pas induire en erreur
   * des tiers quant au contenu… sa source et sa date de mise à jour."
   * Measured across both southern regions: every row carries a valid
   * date, and they range from 2022-01-04 to 2026-09-23. Publishing a
   * four-year-old entry beside a fresh one without saying which is which
   * is exactly the misleading the licence forbids — so the date travels
   * with the record or the record does not travel.
   */
  updatedAt: string;
  /** Accessibility marks, e.g. "Tourisme & Handicap auditif". */
  accessibilityMarks: string[];
};

/** Split a packed field into its entries. */
function entries(value: string | undefined): string[] {
  return (value ?? '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `"4 étoiles#Classement officiel…"` → `{ label, scheme }`. */
function labelled(entry: string): { label: string; scheme: string } {
  const at = entry.indexOf('#');
  return at === -1
    ? { label: entry.trim(), scheme: '' }
    : { label: entry.slice(0, at).trim(), scheme: entry.slice(at + 1).trim() };
}

/**
 * The official star rating, or null.
 *
 * 🔴 The scheme is checked. In PACA, 69 campsites carry "Accueil Vélo"
 * from France Vélo Tourisme in the same field, and 11 carry a wine-route
 * label; a number-only regex over the field would be reading a rating
 * out of whichever entry happened to contain a digit.
 */
export function starsOf(classifications: string | undefined): number | null {
  for (const entry of entries(classifications)) {
    const { label, scheme } = labelled(entry);
    if (scheme !== OFFICIAL_SCHEME) continue;
    const m = /^([1-5])\s*étoiles?$/i.exec(label);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Accessibility marks, which are a different scheme in the same field. */
export function accessibilityOf(classifications: string | undefined): string[] {
  return entries(classifications)
    .map(labelled)
    .filter((e) => e.scheme === ACCESSIBILITY_SCHEME)
    .map((e) => e.label);
}

/**
 * Hosts that are a reservation system rather than a campsite's own site.
 *
 * 🔴 Measured across both southern regions, not guessed. The repeating
 * hosts are three different things and only one of them is a website:
 *
 *   booking engines   bookingpremium.secureholiday.net (70),
 *                     reservation.secureholiday.net (49),
 *                     thelisresa.webcamp.fr (34),
 *                     aireparkreservation.com (11)
 *   chains            capfun.com (38), sandaya.fr (15),
 *                     europe.huttopia.com (12) — these ARE the operator
 *   social            facebook.com (131) — a page, not a site
 *
 * A chain's own domain is the operator's site and is kept. A booking
 * engine is somebody else's funnel: linking to it while calling it "the
 * campsite's website" would send a reader into a third-party checkout
 * under our name, which is exactly what this project says it does not do.
 */
const BOOKING_HOST = /(booking|reservation|resa|secureholiday|webcamp)/i;

/** A social page is not a website either. */
const SOCIAL_HOST =
  /(^|\.)(facebook|instagram|twitter|x|tiktok|youtube|linkedin)\.[a-z.]+$/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Every http(s) contact, in the order the tourist office listed them.
 *
 * 🔴 Contacts are separated by `<>` AND by `|` — the first version of
 * this split on `<>` only and silently lost 418 campsites in Occitanie
 * alone, which showed up as website coverage of 47% against 73% measured
 * independently. A number that disagrees with an independent count is
 * the only reason that gap was noticed.
 *
 * 🔴 Only the value is read, never the label. Labels in this column
 * routinely contain a person's name ("Mme Muriel CATALAN"), which is
 * personal data we have no basis to import and no use for.
 */
export function urlsOf(contacts: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (contacts ?? '').split(/<>|\|/)) {
    const value = part.includes('#') ? part.slice(part.indexOf('#') + 1) : part;
    const url = value.trim();
    if (/^https?:\/\/\S+$/i.test(url)) out.push(url);
  }
  return out;
}

/**
 * The campsite's own site, or null.
 *
 * The order matters: the tourist office often lists a booking engine
 * FIRST and the campsite's own domain second, so "take the first URL"
 * would store the aggregator. When every candidate is an aggregator we
 * store nothing — a gap shown as a gap, which is the rule everywhere
 * else on this site.
 */
export function websiteOf(contacts: string | undefined): string | null {
  const urls = urlsOf(contacts);
  for (const url of urls) {
    const host = hostOf(url);
    if (!host) continue;
    if (BOOKING_HOST.test(host) || SOCIAL_HOST.test(host)) continue;
    return url;
  }
  return null;
}

/** `"83400#Hyères"` → both halves. */
export function communeOf(value: string | undefined): {
  postcode: string | null;
  commune: string | null;
} {
  const raw = (value ?? '').trim();
  if (!raw) return { postcode: null, commune: null };
  const at = raw.indexOf('#');
  if (at === -1) return { postcode: null, commune: raw };
  const postcode = raw.slice(0, at).trim();
  const commune = raw.slice(at + 1).trim();
  return {
    postcode: /^\d{5}$/.test(postcode) ? postcode : null,
    commune: commune || null,
  };
}

/** Is this row a campsite at all? */
export function isCampsite(row: DatatourismeRow): boolean {
  return /CampingAndCaravanning|HotellerieDePleinAir/i.test(
    row.Categories_de_POI ?? '',
  );
}

function number(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn a row into a spot, or into nothing.
 *
 * Returns null rather than a half-filled record. A campsite with no
 * coordinates cannot go on a map and a campsite with no name is exactly
 * what we already have too much of from OSM — neither is worth the row.
 */
export function parseRow(row: DatatourismeRow): ParsedSpot | null {
  if (!isCampsite(row)) return null;

  const ref = (row.URI_ID_du_POI ?? '').trim();
  const name = (row.Nom_du_POI ?? '').trim();
  const lat = number(row.Latitude);
  const lon = number(row.Longitude);
  const updatedAt = (row.Date_de_mise_a_jour ?? '').trim();

  if (!ref || !name || lat === null || lon === null) return null;
  // 🔴 No date, no record. See ParsedSpot.updatedAt.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedAt)) return null;
  // France, loosely — a coordinate outside it is a data error, and one at
  // 0,0 is the classic "missing value written as a number".
  if (lat < 41 || lat > 52 || lon < -6 || lon > 10) return null;

  const { postcode, commune } = communeOf(row.Code_postal_et_commune);
  const description = (row.Description ?? '').trim();

  return {
    ref,
    name,
    lat,
    lon,
    stars: starsOf(row.Classements_du_POI),
    description: description || null,
    address: (row.Adresse_postale ?? '').trim() || null,
    postcode,
    commune,
    website: websiteOf(row.Contacts_du_POI),
    updatedAt,
    accessibilityMarks: accessibilityOf(row.Classements_du_POI),
  };
}
