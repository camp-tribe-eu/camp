import { expect, test } from '@playwright/test';
import {
  ageInDays,
  borderPrices,
  budget,
  euros,
  FUEL,
  FUEL_COUNTRIES,
  isStale,
  longDate,
  NEIGHBOURS,
  ordinal,
  placeText,
  priceFor,
  ranked,
  rankOf,
  STALE_AFTER_DAYS,
  TANK_LITRES,
  VEHICLES,
  vehicle,
} from '../../src/lib/fuel';

// CAMP-55 — the budget calculator's arithmetic and its honesty rules.
//
// 🔴 Why a data file gets tests at all.
//
// fuel-prices.json is written by a script that talks to the European
// Commission. The script has its own self-test, but that proves the
// PARSER works, not that the file currently in the repository is sane.
// These run on every CI job and would catch a file that was hand-edited,
// half-written, or truncated by a failed fetch — the states in which the
// site would still build and would still print prices.

test('the shipped data covers all 27 member states', () => {
  expect(FUEL_COUNTRIES).toHaveLength(27);
  // A handful spot-checked by code so a wholesale renaming is loud.
  for (const code of ['DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'MT']) {
    expect(FUEL_COUNTRIES, `${code} missing from the fuel data`).toContain(code);
  }
});

test('every price is a plausible price for a litre', () => {
  for (const code of FUEL_COUNTRIES) {
    for (const type of ['petrol', 'diesel'] as const) {
      const p = priceFor(code, type);
      if (p === null) continue;
      // Not a unit check dressed up: the bulletin publishes per 1000 l,
      // and the one mistake that survives every other test is forgetting
      // to divide. €1925 a litre passes a "is it a number" check.
      expect(p, `${code} ${type} = ${p}`).toBeGreaterThan(0.5);
      expect(p, `${code} ${type} = ${p}`).toBeLessThan(4);
    }
  }
});

test('the data carries its own date, source and licence', () => {
  expect(FUEL.bulletinDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(FUEL.licence).toBe('CC BY 4.0');
  expect(FUEL.source).toContain('energy.ec.europa.eu');
  // 🔴 The attribution string is not decoration — CC BY is conditional on
  // it. A file without one must not be publishable.
  expect(FUEL.attribution).toContain('European Commission');
  expect(FUEL.attribution).toContain('CC BY 4.0');
});

test('a bulletin date in the future would be caught, not displayed', () => {
  // Clock skew, or a file edited by hand. Negative age is impossible for
  // a published bulletin and must not read as "fresh".
  const before = new Date(`${FUEL.bulletinDate}T00:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 3);
  expect(ageInDays(before)).toBeLessThan(0);
});

test('staleness is measured against a given day, not the clock', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  expect(ageInDays(day('2026-09-28'), '2026-09-21')).toBe(7);
  expect(isStale(day('2026-09-28'))).toBe(false);

  const late = day(FUEL.bulletinDate);
  late.setUTCDate(late.getUTCDate() + STALE_AFTER_DAYS + 1);
  expect(isStale(late), 'a month-old bulletin must announce itself').toBe(true);
});

test('fuel is distance times consumption times price', () => {
  // 1500 km at 12 l/100km = 180 litres; at €2.457 = €442.26.
  const b = budget({
    km: 1500,
    litresPer100: 12,
    pricePerLitre: 2.457,
    nights: 0,
    campsitePerNight: 0,
    people: 2,
  });
  expect(b.litres).toBe(180);
  expect(b.fuel).toBe(442.26);
});

test('the total is the sum of its parts, to the cent', () => {
  const b = budget({
    km: 1200,
    litresPer100: 9,
    pricePerLitre: 2.219,
    nights: 7,
    campsitePerNight: 28.5,
    people: 3,
    extras: 60,
  });
  expect(b.total).toBe(Math.round((b.fuel + b.campsites + b.extras) * 100) / 100);
  expect(b.campsites).toBe(199.5);
  expect(b.perPerson).toBe(Math.round((b.total / 3) * 100) / 100);
});

test('per-night divides by nights, not by days', () => {
  const b = budget({
    km: 0,
    litresPer100: 0,
    pricePerLitre: 0,
    nights: 7,
    campsitePerNight: 30,
    people: 2,
  });
  expect(b.campsites).toBe(210);
  // 210 / 7, not 210 / 8.
  expect(b.perNight).toBe(30);
});

test('half-typed input produces zeros, never a thrown render', () => {
  const messy = budget({
    km: Number.NaN,
    litresPer100: -3,
    pricePerLitre: Number.POSITIVE_INFINITY,
    nights: 0,
    campsitePerNight: Number.NaN,
    people: 0,
    extras: Number.NaN,
  });
  expect(messy.total).toBe(0);
  expect(messy.perNight).toBe(0);
  // People floors at one, so a total is never divided by zero.
  expect(messy.perPerson).toBe(0);
  expect(Number.isFinite(messy.perPerson)).toBe(true);
});

test('vehicle presets are starting points inside their own ranges', () => {
  for (const v of VEHICLES) {
    expect(v.min, `${v.id}`).toBeLessThan(v.max);
    expect(v.start, `${v.id} starts outside its own range`).toBeGreaterThanOrEqual(v.min);
    expect(v.start, `${v.id} starts outside its own range`).toBeLessThanOrEqual(v.max);
    // 🔴 A note is required. These numbers are assumptions, and an
    // assumption shown without a word of explanation reads as a fact.
    expect(v.note.length, `${v.id} has no note`).toBeGreaterThan(20);
  }
  expect(vehicle('nope').id, 'an unknown id falls back, not crashes').toBe(VEHICLES[0].id);
});

test('the ranking is complete, ordered, and refuses to invent a place', () => {
  const list = ranked('diesel');
  expect(list.length).toBeGreaterThan(20);
  for (let i = 1; i < list.length; i++) {
    expect(list[i].price).toBeGreaterThanOrEqual(list[i - 1].price);
  }
  const de = rankOf('DE', 'diesel');
  expect(de).not.toBeNull();
  expect(de!.of).toBe(list.length);
  expect(de!.position).toBeGreaterThan(0);
  expect(rankOf('XX', 'diesel'), 'a country we have no price for has no rank').toBeNull();
});

test('rank is case-insensitive, because URLs are lowercase', () => {
  expect(rankOf('de', 'petrol')?.position).toBe(rankOf('DE', 'petrol')?.position);
});

test('money and dates are formatted the way the pages promise', () => {
  expect(euros(1234.5)).toBe('€1,234.50');
  expect(euros(2.457, 3)).toBe('€2.457');
  expect(euros(Number.NaN)).toBe('—');
  expect(longDate('2026-09-21')).toBe('21 September 2026');
  expect(longDate('nonsense')).toBe('nonsense');
});


test('ordinals survive the teens, which the naive rule does not', () => {
  expect(ordinal(1)).toBe('1st');
  expect(ordinal(2)).toBe('2nd');
  expect(ordinal(3)).toBe('3rd');
  expect(ordinal(4)).toBe('4th');
  // 11th, 12th, 13th — not 11st, 12nd, 13rd.
  expect(ordinal(11)).toBe('11th');
  expect(ordinal(12)).toBe('12th');
  expect(ordinal(13)).toBe('13th');
  expect(ordinal(21)).toBe('21st');
  expect(ordinal(112)).toBe('112th');
  expect(ordinal(22)).toBe('22nd');
});

test('a place is counted from whichever end is nearer', () => {
  // The case that prompted this: Germany sat at 24 of 27.
  expect(placeText(24, 27)).toBe('4th most expensive');
  expect(placeText(1, 27)).toBe('1st cheapest');
  expect(placeText(27, 27)).toBe('1st most expensive');
  // The midpoint of an odd list counts as cheap, and does so every time.
  expect(placeText(14, 27)).toBe('14th cheapest');
  expect(placeText(15, 27)).toBe('13th most expensive');
});

test('every country gets a place that reads as English', () => {
  for (const type of ['petrol', 'diesel'] as const) {
    const list = ranked(type);
    for (let i = 1; i <= list.length; i++) {
      const text = placeText(i, list.length);
      expect(text, `position ${i}`).toMatch(/^\d+(st|nd|rd|th) (cheapest|most expensive)$/);
    }
  }
});


test('every member state has a neighbour list, and it is symmetric', () => {
  expect(Object.keys(NEIGHBOURS).sort()).toEqual(FUEL_COUNTRIES);
  // 🔴 If Austria borders Slovenia then Slovenia borders Austria. A
  // hand-written table is exactly where that stops being true, and a
  // one-sided border silently drops a row from one page only.
  for (const [code, list] of Object.entries(NEIGHBOURS)) {
    for (const other of list) {
      expect(NEIGHBOURS[other], `${other} is not a known member state`).toBeDefined();
      expect(
        NEIGHBOURS[other],
        `${code} lists ${other}, but ${other} does not list ${code}`,
      ).toContain(code);
    }
    expect(list, `${code} borders itself`).not.toContain(code);
    expect(new Set(list).size, `${code} lists a neighbour twice`).toBe(list.length);
  }
});

test('the islands and Ireland have no EU land border, deliberately', () => {
  // Cyprus and Malta are islands; Ireland's only land border is with the
  // United Kingdom, which the bulletin does not cover.
  for (const code of ['CY', 'MT', 'IE']) {
    expect(NEIGHBOURS[code], code).toEqual([]);
    expect(borderPrices(code, 'diesel'), code).toEqual([]);
  }
});

test('no neighbour is a country the bulletin does not price', () => {
  // Switzerland, Norway, the UK, Serbia, Bosnia, Ukraine — all real land
  // neighbours, none of them priced here. A code for one of them would
  // produce a row with no number.
  for (const list of Object.values(NEIGHBOURS)) {
    for (const code of list) {
      expect(FUEL_COUNTRIES, `${code} has no price`).toContain(code);
    }
  }
});

test('border prices are cheapest first, with the saving per tank', () => {
  const at = borderPrices('AT', 'diesel');
  expect(at.length).toBe(NEIGHBOURS.AT.length);
  for (let i = 1; i < at.length; i++) {
    expect(at[i].price).toBeGreaterThanOrEqual(at[i - 1].price);
  }
  const here = priceFor('AT', 'diesel')!;
  for (const n of at) {
    // The difference is the neighbour minus here, so cheaper is negative.
    expect(n.difference).toBeCloseTo(n.price - here, 3);
    expect(n.perTank).toBeCloseTo(n.difference * TANK_LITRES, 1);
  }
});

test('a country with no price of its own compares nothing', () => {
  expect(borderPrices('XX', 'diesel')).toEqual([]);
});
