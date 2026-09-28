// CAMP-147: what a reader is shown about price, and what they are not.
//
// 🔴 THE RULE THIS FILE EXISTS TO ENFORCE.
//
// "From €13.50" with no season attached is forbidden. A tariff valid
// 01.04–30.10.2026, printed in November, is not a price — it is history,
// and a reader who checks will conclude we invent things. So every price
// that reaches the page carries its season and its source, and one that
// has run out says so instead of sitting there looking current.
//
// The API already refuses to send a tariff with no period at all
// (api/src/spots/tariffs.ts). This file answers the question the API
// deliberately does not: whether a period that exists has passed. That
// depends on the day the page is built, which is not a property of the
// data and must not be baked into a query whose output would then churn
// every midnight.
//
// 🔴 WHAT IS NOT HERE, ON PURPOSE.
//
// `textPriceSpecification` — 407 records that state the price in a
// sentence. They are parsed, counted and never stored, and no code path
// in this repository turns one into a number. CAMP-147 allows showing
// them verbatim with a marker or not showing them at all; not showing
// them is the option that cannot go wrong, because every one of those
// sentences describes a price with no season and printing it would
// breach the rule at the top of this file through the side door.

export interface Tariff {
  /** WHAT is priced — `BarePitch`, `CamperPitch`, `TouristTax`… */
  offer: string | null;
  /** HOW it is charged — `Overnight`, `PerWeek`, `PerPerson`… */
  mode: string | null;
  /** WHO it applies to — `BaseRateFullRate`, `ChildRate`, `Free`… */
  policy: string | null;
  /** 🔴 Strings. `numeric(10,2)::text`, so always two decimals, exact. */
  minPrice: string | null;
  maxPrice: string | null;
  currency: string;
  validFrom: string | null;
  validUntil: string | null;
  /** The operator's own words. Rendered verbatim, with `lang`. */
  label: string | null;
  labelLang: string | null;
  sourceUpdatedAt: string;
  sourceId: string;
}

/**
 * 🔴 The publisher's own English, not ours.
 *
 * Every token below was read out of the feed's `rdfs:label` in English,
 * measured across all 129 594 objects: 51 distinct tokens, every one of
 * them carrying an English label, and not one of them disagreeing with
 * itself anywhere in the feed. Translating a French tourism vocabulary
 * ourselves would have been invention of exactly the kind CAMP-101
 * forbids for descriptions.
 *
 * The one edit is `PerTent`, which DATAtourisme publishes as "Par tent"
 * — a typo in its own English, half-translated. It is written out here
 * as "Per tent", and that is the only word on this list that is ours.
 */
export const OFFER_LABEL: Record<string, string> = {
  Pitch: 'Pitch',
  BarePitch: 'Bare pitch',
  CamperPitch: 'Motorhome pitch',
  CamperServicePoint: 'Camper service point',
  RVSite: 'RV site',
  Accommodation: 'Accommodation',
  Bedroom: 'Bedroom',
  BungalowRental: 'Bungalow rental',
  BungalowTentRental: 'Bungatent rental',
  ChaletRental: 'Chalet rental',
  LeisureChaletRental: 'Leisure chalet rental',
  MobilHomeHire: 'Mobile home hire',
  CaravanRental: 'Caravan rental',
  TrailerRental: 'Trailer rental',
  TentHire: 'Tent hire',
  HutRental: 'Hut rental',
  TouristTax: 'Tourist tax',
  Ticket: 'Ticket, entry fee, pass',
  Breakfast: 'Breakfast',
  Meals: 'Meals',
  AdultMenu: 'Adult menu',
  Picnic: 'Picnic',
  FinalHousekeeping: 'Final housekeeping',
  SheetsAndTowels: 'Sheets and towels',
  SheetsRental: 'Sheets rental',
  BathroomLinenRental: 'Bathroom linen rental',
};

export const MODE_LABEL: Record<string, string> = {
  Overnight: 'per night',
  PerDay: 'per day',
  PerWeek: 'per week',
  PerMonth: 'per month',
  PerUnit: 'per unit',
  PerPerson: 'per person',
  AdditionalPerson: 'per additional person',
  TwoPeopleBAndB: 'for two people',
  FivePeople: 'for five people',
  PerAnimal: 'per animal',
  PerCar: 'per car',
  PerTent: 'per tent',
  PerCaravan: 'per caravan',
  PerCampingCar: 'per camping car',
  PerElectricalConnection: 'per electrical connection',
  SubscriptionPackage: 'as a package',
  Weekend: 'for a weekend',
  Weekend1Night: 'for a weekend (1 night)',
  MidWeek: 'mid-week',
};

export const POLICY_LABEL: Record<string, string> = {
  BaseRateFullRate: 'Base rate',
  ChildRate: 'Child rate',
  ExtraCharge: 'Extra charge',
  Group: 'Group rate',
  Free: 'Free',
};

/**
 * A token we have no wording for, made readable rather than dropped.
 *
 * 🔴 Dropped would be the tempting choice and it is the wrong one, for
 * the same reason `describeSources` keeps an unknown source id: the feed
 * is somebody else's and it will grow a 52nd token without telling us.
 * A row that silently vanishes from a price table is invisible; a row
 * labelled "Glamping pod" that we did not plan for is visibly imperfect
 * and therefore gets fixed.
 */
export function humaniseToken(token: string): string {
  const words = token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : token;
}

export function offerLabel(token: string | null): string | null {
  if (!token) return null;
  return OFFER_LABEL[token] ?? humaniseToken(token);
}

export function modeLabel(token: string | null): string | null {
  if (!token) return null;
  return MODE_LABEL[token] ?? humaniseToken(token).toLowerCase();
}

export function policyLabel(token: string | null): string | null {
  if (!token) return null;
  return POLICY_LABEL[token] ?? humaniseToken(token);
}

export type TariffStatus = 'current' | 'upcoming' | 'expired';

/** The day a date string names, at UTC midnight, or null. */
function day(iso: string | null): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

function todayUtc(now: Date): number {
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
}

/**
 * Where a tariff stands relative to the day the page is built.
 *
 * 🔴 `validUntil` is INCLUSIVE. A season ending 2026-09-26 is still a
 * price on the 26th; treating the end date as exclusive would print
 * "this price has expired" on the last day it is charged, which is a
 * false statement about a real business on the day it is most likely to
 * be read.
 */
export function tariffStatus(t: Tariff, now: Date = new Date()): TariffStatus {
  const today = todayUtc(now);
  const until = day(t.validUntil);
  if (until !== null && until < today) return 'expired';
  const from = day(t.validFrom);
  if (from !== null && from > today) return 'upcoming';
  return 'current';
}

/**
 * 🔴 The last line of defence, and it should never fire.
 *
 * The API filters these out in SQL, so a tariff with no period cannot
 * reach this page — today. The guard is here because that is one query
 * in one service, and a future caller that builds its own payload would
 * otherwise reintroduce the exact thing CAMP-147 forbids without a
 * single test going red. Two independent refusals, and the spec asserts
 * both of them.
 */
export function hasValidityPeriod(t: Tariff): boolean {
  return day(t.validFrom) !== null || day(t.validUntil) !== null;
}

export function displayableTariffs(tariffs: Tariff[]): Tariff[] {
  return tariffs.filter(hasValidityPeriod);
}

export type TariffGroups = {
  /** In season now, or starting later. Shown first. */
  current: Tariff[];
  /**
   * The most recently ended season. Shown, and labelled as over.
   */
  expired: Tariff[];
  /** Tariffs from seasons older than that, which are not shown. */
  olderExpired: number;
};

/**
 * Split a price list into what applies, what has just run out, and what
 * is old enough to be an archive.
 *
 * 🔴 Expired tariffs are KEPT, not hidden. The card asks for a page with
 * an expired tariff to say so rather than stay silent, and hiding them
 * outright would make a campsite whose only published season is last
 * year's look identical to one that publishes no price at all. Measured
 * after the import: 448 campsites have nothing but expired seasons, so
 * this is not a rare branch.
 *
 * 🔴 But only the LAST ended season, and that came out of looking at a
 * real page rather than out of taste. Camping Le Beaulieu publishes its
 * rates week by week: 79 tariffs, 14 of them current and 65 from seasons
 * that ended in July. Rendered in full the price panel was 7 315 pixels
 * tall — a metre and a half of last summer's weekly rates, below which
 * the neighbouring campsites and the attribution were unreachable.
 *
 * The reason to show an expired price at all is to say "this is the last
 * thing the operator published, and it has ended". The 64 before it say
 * nothing extra, and the count of them is printed so the omission is
 * visible rather than silent.
 */
export function groupTariffs(
  tariffs: Tariff[],
  now: Date = new Date(),
): TariffGroups {
  const shown = displayableTariffs(tariffs);
  const current = shown.filter((t) => tariffStatus(t, now) !== 'expired');
  const expired = shown.filter((t) => tariffStatus(t, now) === 'expired');
  if (expired.length === 0) return { current, expired, olderExpired: 0 };

  // Every expired tariff has a `validUntil` — that is what made it
  // expired — so this maximum always exists.
  const latestEnd = expired.reduce(
    (latest, t) => (t.validUntil! > latest ? t.validUntil! : latest),
    expired[0].validUntil!,
  );
  const lastSeason = expired.filter((t) => t.validUntil === latestEnd);
  return {
    current,
    expired: lastSeason,
    olderExpired: expired.length - lastSeason.length,
  };
}

/**
 * An amount, exactly as stored.
 *
 * 🔴 No `Number()` anywhere. The column is `numeric(10,2)` and arrives
 * as text with two decimals already; parsing it to a float to print it
 * again can only lose. The feed itself contains
 * "2.7999999523162841796875" — somebody upstream did exactly this with a
 * 32-bit float — which is the whole argument in one string.
 */
export function formatAmount(amount: string, currency: string): string {
  const bare = amount.replace(/\.00$/, '');
  return currency === 'EUR' ? `€${bare}` : `${bare} ${currency}`;
}

/** "€18–25", "€13.50", "from €18", "up to €25" — never a bare number. */
export function formatPrice(t: Tariff): string | null {
  const { minPrice: min, maxPrice: max, currency } = t;
  if (min !== null && max !== null) {
    if (min === max) return formatAmount(min, currency);
    // The unit is written once. "€18–25" for a symbol that leads,
    // "18–25 USD" for a code that trails — either way the reader is not
    // made to read the currency twice.
    const bare = (v: string) => v.replace(/\.00$/, '');
    return currency === 'EUR'
      ? `€${bare(min)}–${bare(max)}`
      : `${bare(min)}–${bare(max)} ${currency}`;
  }
  if (min !== null) return `from ${formatAmount(min, currency)}`;
  if (max !== null) return `up to ${formatAmount(max, currency)}`;
  // 🔴 Unreachable through the API, which refuses a tariff with no
  // amount, and null rather than "€" if it ever becomes reachable.
  return null;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/**
 * The season, in words a reader can check against a calendar.
 *
 * 🔴 Never returns an empty string. This string is the thing that makes
 * a price legitimate to publish, so a tariff whose period cannot be
 * rendered must produce null and be dropped by the caller, not rendered
 * as a price with a blank beside it.
 */
export function formatPeriod(t: Tariff): string | null {
  const from = t.validFrom && /^\d{4}-\d{2}-\d{2}$/.test(t.validFrom) ? t.validFrom : null;
  const until = t.validUntil && /^\d{4}-\d{2}-\d{2}$/.test(t.validUntil) ? t.validUntil : null;
  if (from && until) return `${shortDate(from)} – ${shortDate(until)}`;
  if (from) return `from ${shortDate(from)}`;
  if (until) return `until ${shortDate(until)}`;
  return null;
}

/** What the tariff is for, in one phrase: "Bare pitch, per night". */
export function describeTariff(t: Tariff): string {
  const parts = [offerLabel(t.offer), modeLabel(t.mode)].filter(Boolean);
  if (parts.length === 0) {
    const policy = policyLabel(t.policy);
    // A tariff that names neither what nor how is still a price for
    // staying here; saying so beats an empty cell.
    return policy && policy !== 'Base rate' ? policy : 'Stay';
  }
  return parts.join(', ');
}
