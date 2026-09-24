// CAMP-55 — what a camper trip costs, and the line between what we know
// and what the reader knows.
//
// 🔴 THE WHOLE DESIGN IS ONE DISTINCTION.
//
// "How much does a camper trip cost" is a real search with a real
// answer, and almost every page answering it makes its numbers up. We
// can answer one part of it exactly: the European Commission publishes
// consumer fuel prices for all 27 member states every Thursday, and fuel
// is the largest volatile line in the budget.
//
// We cannot answer the other part at all. We hold no campsite prices —
// rental.entity.ts says so in its first line, and it is an architectural
// choice, not a gap waiting to be filled: the platform links to partners
// rather than mirroring their price feeds.
//
// So this file computes two things and keeps them apart everywhere:
//
//   MEASURED   the price of a litre, per country, with the week it was
//              measured and the licence it came under.
//   ASSUMED    consumption, nights, campsite fee — the reader's own
//              numbers, with a starting point offered and nothing
//              claimed about it.
//
// A calculator that blurs those two is the thing we are trying not to
// be. The sum is still shown, because a reader wants a total; it is
// labelled by which half it came from.

import data from '@/data/fuel-prices.json';

export type FuelType = 'petrol' | 'diesel';

export interface CountryFuel {
  name: string;
  petrol: number | null;
  diesel: number | null;
}

export interface FuelData {
  /** The Thursday the Commission published these, as ISO date. */
  bulletinDate: string;
  fetchedAt: string;
  unit: string;
  source: string;
  sourceFile: string;
  licence: string;
  attribution: string;
  euAverage: { petrol: number | null; diesel: number | null };
  countries: Record<string, CountryFuel>;
}

export const FUEL: FuelData = data as FuelData;

export const FUEL_COUNTRIES = Object.keys(FUEL.countries).sort();

export function countryFuel(code: string): CountryFuel | null {
  return FUEL.countries[code.toUpperCase()] ?? null;
}

export function priceFor(code: string, type: FuelType): number | null {
  return countryFuel(code)?.[type] ?? null;
}

/**
 * How old the figures are, in whole days, against a given "today".
 *
 * 🔴 Takes `now` rather than reading the clock, because a function that
 * reads the clock cannot be tested and this one guards a published
 * claim. Every page that prints a price prints the bulletin date beside
 * it, so age never turns into a false statement about today — but past a
 * few weeks the page should say so out loud rather than leave the reader
 * to do date arithmetic.
 */
export function ageInDays(now: Date, bulletinDate = FUEL.bulletinDate): number {
  const then = Date.parse(`${bulletinDate}T00:00:00Z`);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

/**
 * Past this, the page says the data is old instead of just dating it.
 *
 * Three weeks: the bulletin is weekly, so one or two missed refreshes is
 * a slow week and three is a broken pipeline.
 */
export const STALE_AFTER_DAYS = 21;

export const isStale = (now: Date) => ageInDays(now) > STALE_AFTER_DAYS;

/**
 * Starting points for consumption, and what they are NOT.
 *
 * 🔴 These are not measurements and the UI must never present them as
 * such. Real consumption depends on the vehicle, the load, the roof box,
 * the Alps and the driver; the honest thing is to offer a plausible
 * starting number, say where it sits in a range, and let the reader
 * replace it. The one number on the page that carries a source is the
 * price of a litre.
 *
 * The ranges are the ordinary spread quoted by rental fleets for these
 * vehicle classes. They are here to bound the input — a reader typing
 * `1.2` has mistyped, and a form that accepts it produces a confident
 * wrong answer.
 */
export interface VehicleShape {
  id: string;
  label: string;
  /** Litres per 100 km offered as the starting value. */
  start: number;
  min: number;
  max: number;
  note: string;
}

export const VEHICLES: VehicleShape[] = [
  {
    id: 'campervan',
    label: 'Campervan (up to ~6 m)',
    start: 9,
    min: 6,
    max: 14,
    note: 'A converted van — the lightest of the three and the easiest to park.',
  },
  {
    id: 'motorhome',
    label: 'Motorhome (6–7.5 m)',
    start: 12,
    min: 8,
    max: 18,
    note: 'A coachbuilt body on a van chassis. Heavier, taller, thirstier.',
  },
  {
    id: 'car-and-tent',
    label: 'Car and tent',
    start: 6,
    min: 4,
    max: 10,
    note: 'Cheapest to drive, and the one where the weather matters most.',
  },
];

export const vehicle = (id: string) =>
  VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];

export interface BudgetInput {
  /** Total distance driven, kilometres. */
  km: number;
  /** Litres per 100 km — the reader's number. */
  litresPer100: number;
  /** Price of a litre, from the bulletin. */
  pricePerLitre: number;
  nights: number;
  /** Per night, for the whole party. The reader's number; we have none. */
  campsitePerNight: number;
  people: number;
  /** Anything else the reader wants counted, for the whole trip. */
  extras?: number;
}

export interface Budget {
  fuel: number;
  campsites: number;
  extras: number;
  total: number;
  perPerson: number;
  perNight: number;
  litres: number;
}

/** Two decimals, without the float dust that makes totals disagree. */
const money = (n: number) => Math.round(n * 100) / 100;

/**
 * The arithmetic, with no opinions in it.
 *
 * 🔴 Returns zeros rather than throwing on nonsense. This runs on every
 * keystroke of a form; a reader halfway through typing "12" has, for one
 * render, typed "1", and a mid-typing exception is a blank page. The
 * form validates; this computes.
 */
export function budget(input: BudgetInput): Budget {
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

  const km = n(input.km);
  const litres = (km / 100) * n(input.litresPer100);
  const fuel = money(litres * n(input.pricePerLitre));
  const nights = n(input.nights);
  const campsites = money(nights * n(input.campsitePerNight));
  const extras = money(n(input.extras ?? 0));
  const total = money(fuel + campsites + extras);
  const people = Math.max(1, Math.round(n(input.people)) || 1);

  return {
    fuel,
    campsites,
    extras,
    total,
    litres: Math.round(litres * 10) / 10,
    perPerson: money(total / people),
    // 🔴 Nights, not nights + 1. A seven-night trip has seven nights to
    // divide by; dividing by days would quietly flatter every total.
    perNight: nights > 0 ? money(total / nights) : 0,
  };
}

export interface RankedCountry {
  code: string;
  name: string;
  price: number;
}

/** Every country that has a price for this fuel, cheapest first. */
export function ranked(type: FuelType): RankedCountry[] {
  return Object.entries(FUEL.countries)
    .map(([code, c]) => ({ code, name: c.name, price: c[type] ?? NaN }))
    .filter((c) => Number.isFinite(c.price))
    .sort((a, b) => a.price - b.price);
}

/**
 * Where one country sits, as "3rd cheapest of 27".
 *
 * Returns null when that country has no price for this fuel, rather than
 * inventing a position — Malta reports no LPG, and a rank computed over
 * a shorter list would be a different claim than the one printed.
 */
export function rankOf(
  code: string,
  type: FuelType,
): { position: number; of: number; price: number } | null {
  const list = ranked(type);
  const i = list.findIndex((c) => c.code === code.toUpperCase());
  if (i < 0) return null;
  return { position: i + 1, of: list.length, price: list[i].price };
}

/**
 * EU land neighbours, by ISO code.
 *
 * 🔴 Only EU members, because the bulletin only covers them. Croatia
 * borders Bosnia and Serbia and Montenegro; none of them is here,
 * because we have no price for them and a neighbour we cannot price is
 * not useful on a page about where to fill up. Switzerland, Norway and
 * the UK are absent for the same reason, which is worth knowing before
 * anyone "fixes" France by adding CH.
 *
 * Ireland, Cyprus and Malta have no EU land border at all — Ireland's
 * only land border is with the United Kingdom — so their pages say so
 * rather than showing an empty section.
 *
 * Written out rather than computed: land borders are stable facts, and a
 * hand-checked table is auditable in a way that a geometry query over
 * simplified coastlines is not.
 */
export const NEIGHBOURS: Record<string, string[]> = {
  AT: ['DE', 'CZ', 'SK', 'HU', 'SI', 'IT'],
  BE: ['NL', 'DE', 'LU', 'FR'],
  BG: ['RO', 'GR'],
  HR: ['SI', 'HU'],
  CY: [],
  CZ: ['DE', 'PL', 'SK', 'AT'],
  DK: ['DE'],
  EE: ['LV'],
  FI: ['SE'],
  FR: ['BE', 'LU', 'DE', 'IT', 'ES'],
  DE: ['DK', 'NL', 'BE', 'LU', 'FR', 'AT', 'CZ', 'PL'],
  GR: ['BG'],
  HU: ['SK', 'AT', 'SI', 'HR', 'RO'],
  IE: [],
  IT: ['FR', 'AT', 'SI'],
  LV: ['EE', 'LT'],
  LT: ['LV', 'PL'],
  LU: ['BE', 'DE', 'FR'],
  MT: [],
  NL: ['BE', 'DE'],
  PL: ['DE', 'CZ', 'SK', 'LT'],
  PT: ['ES'],
  RO: ['HU', 'BG'],
  SK: ['CZ', 'PL', 'HU', 'AT'],
  SI: ['IT', 'AT', 'HU', 'HR'],
  ES: ['FR', 'PT'],
  SE: ['FI'],
};

export interface BorderPrice {
  code: string;
  name: string;
  price: number;
  /** Negative when the neighbour is cheaper. */
  difference: number;
  /** What the difference is worth on one 100-litre fill. */
  perTank: number;
}

/**
 * What a litre costs on the other side of each land border.
 *
 * 🔴 This is the one thing on these pages that no competitor publishes
 * and that we can compute exactly: every price is measured, the
 * subtraction is arithmetic, and "fill up before you cross" is the most
 * practical sentence we are in a position to write. Cheapest first, so
 * the answer is the first row.
 *
 * A tank is taken as 100 litres — a round number stated on the page, not
 * a claim about anybody's vehicle, and the figure scales in the reader's
 * head without a calculator.
 */
export const TANK_LITRES = 100;

export function borderPrices(code: string, type: FuelType): BorderPrice[] {
  const here = priceFor(code, type);
  if (here === null) return [];
  return (NEIGHBOURS[code.toUpperCase()] ?? [])
    .map((n) => {
      const c = FUEL.countries[n];
      const price = c?.[type];
      if (!c || price === null || price === undefined) return null;
      const difference = Math.round((price - here) * 1000) / 1000;
      return {
        code: n,
        name: c.name,
        price,
        difference,
        perTank: Math.round(difference * TANK_LITRES * 100) / 100,
      };
    })
    .filter((x): x is BorderPrice => x !== null)
    .sort((a, b) => a.price - b.price);
}

/**
 * For a country with no land border: how it compares with the Union.
 *
 * 🔴 Written because the duplicate guard failed, and failed correctly.
 *
 * Ireland, Cyprus and Malta have no EU land neighbour, so their pages
 * lost the border table — the largest section the other twenty-four
 * have — and what remained was mostly shared wording. Measured:
 * ie ↔ cy came out at 82.3%, over the 80% line.
 *
 * The answer is not a lower threshold. It is that these pages have a
 * real question of their own — you cannot drive somewhere cheaper, so
 * what does a tank here cost against the rest of the Union? — and three
 * measured reference points answer it: the cheapest member state, the
 * weighted average, and the dearest. Every figure is from the same
 * bulletin and every difference is subtraction.
 */
export function unionComparison(code: string, type: FuelType): BorderPrice[] {
  const here = priceFor(code, type);
  const list = ranked(type);
  if (here === null || list.length === 0) return [];

  const average = FUEL.euAverage[type];
  const rows: { code: string; name: string; price: number }[] = [
    { code: list[0].code, name: `${list[0].name} — cheapest in the EU`, price: list[0].price },
  ];
  if (average !== null) {
    rows.push({ code: 'EU', name: 'EU average, weighted', price: average });
  }
  const dearest = list[list.length - 1];
  rows.push({ code: dearest.code, name: `${dearest.name} — dearest in the EU`, price: dearest.price });

  return rows
    .filter((r) => r.code !== code.toUpperCase())
    .map((r) => {
      const difference = Math.round((r.price - here) * 1000) / 1000;
      return {
        ...r,
        difference,
        perTank: Math.round(difference * TANK_LITRES * 100) / 100,
      };
    })
    .sort((a, b) => a.price - b.price);
}

/**
 * "3rd cheapest" or "4th most expensive", whichever a reader would say.
 *
 * 🔴 Not cosmetic. Germany came out as "the 24th cheapest of 27", which
 * is true and which nobody says out loud; a reader has to subtract to
 * learn that diesel there is dear. Counting from whichever end is nearer
 * states the same fact in the direction it matters.
 *
 * The midpoint rounds up so that on an odd-length list the exact middle
 * counts as cheap — an arbitrary tie-break, but a fixed one, so the same
 * country does not flip wording between two adjacent weeks at the same
 * rank.
 */
export function placeText(position: number, of: number): string {
  if (position <= Math.ceil(of / 2)) return `${ordinal(position)} cheapest`;
  return `${ordinal(of - position + 1)} most expensive`;
}

/** 1st, 2nd, 3rd, 4th — including the teens, which break the naive rule. */
export function ordinal(n: number): string {
  const rem100 = Math.abs(n) % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][Math.abs(n) % 10] ?? 'th'}`;
}

/** €1,234.50 — the form every price on these pages takes. */
export function euros(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—';
  return `€${n.toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** "21 September 2026" — dates are written out, never 09/21. */
export function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
