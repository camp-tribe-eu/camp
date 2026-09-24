import { expect, test } from '@playwright/test';
import {
  asText,
  countItems,
  packingList,
  SEASONS,
  VEHICLE_KINDS,
  type PackingInput,
} from '../../src/lib/packing';

const base: PackingInput = {
  vehicle: 'motorhome',
  nights: 7,
  people: 2,
  season: 'warm',
  cooking: true,
  electricity: true,
  children: false,
  dog: false,
};

const ids = (input: PackingInput) =>
  packingList(input).flatMap((g) => g.items.map((i) => i.id));

const labels = (input: PackingInput) =>
  packingList(input)
    .flatMap((g) => g.items.map((i) => `${i.label} ${i.note ?? ''}`))
    .join(' | ')
    .toLowerCase();

// 🔴 The test this file exists for.
//
// A packing list is the easiest place on the site to start giving legal
// advice by accident. What a driver must carry — vest, triangle,
// breathalyser, spare bulbs, winter tyres — differs by member state and
// changes, /guides refuses to write about jurisdictions we have not
// checked, and our terms disclaim exactly that advice. A helpful
// contributor adding "hi-vis vest (required in France)" would be making
// that claim in a checkbox.
test('the list never states a legal requirement', () => {
  const forbidden = [
    'hi-vis',
    'high-vis',
    'hi vis',
    'reflective vest',
    'warning triangle',
    'breathalyser',
    'breathalyzer',
    'spare bulb',
    'required by law',
    'legally required',
    'mandatory',
    'you must carry',
  ];
  for (const vehicle of VEHICLE_KINDS) {
    for (const season of SEASONS) {
      for (const children of [false, true]) {
        for (const dog of [false, true]) {
          const text = labels({
            ...base,
            vehicle: vehicle.id,
            season: season.id,
            children,
            dog,
          });
          for (const word of forbidden) {
            expect(text, `"${word}" appeared for ${vehicle.id}/${season.id}`).not.toContain(word);
          }
        }
      }
    }
  }
});

test('every combination produces a usable list with unique ids', () => {
  for (const vehicle of VEHICLE_KINDS) {
    for (const season of SEASONS) {
      for (const cooking of [false, true]) {
        for (const electricity of [false, true]) {
          const input = {
            ...base,
            vehicle: vehicle.id,
            season: season.id,
            cooking,
            electricity,
          };
          const list = packingList(input);
          expect(countItems(list), `${vehicle.id}/${season.id}`).toBeGreaterThan(12);
          const all = ids(input);
          expect(new Set(all).size, `duplicate id in ${vehicle.id}/${season.id}`).toBe(all.length);
          for (const group of list) {
            expect(group.items.length, `${group.id} is empty`).toBeGreaterThan(0);
          }
        }
      }
    }
  }
});

test('the vehicle changes the list, not just the wording', () => {
  const tent = ids({ ...base, vehicle: 'car-and-tent' });
  const van = ids({ ...base, vehicle: 'motorhome' });
  expect(tent).toContain('tent');
  expect(tent).toContain('mats');
  expect(tent).toContain('mallet');
  expect(van).not.toContain('tent');
  // A motorhome needs levelling ramps and a water hose; a tent does not.
  expect(van).toContain('levelling');
  expect(van).toContain('hose');
  expect(tent).not.toContain('hose');
});

test('a hook-up swaps the cable for a power bank, not both', () => {
  expect(ids({ ...base, electricity: true })).toContain('hookup');
  expect(ids({ ...base, electricity: true })).not.toContain('power');
  expect(ids({ ...base, electricity: false })).toContain('power');
  expect(ids({ ...base, electricity: false })).not.toContain('hookup');
});

test('winter adds warmth and drops the sun hat', () => {
  const cold = ids({ ...base, season: 'cold' });
  const warm = ids({ ...base, season: 'warm' });
  expect(cold).toContain('thermal');
  expect(cold).toContain('hat');
  expect(cold).not.toContain('sun');
  expect(warm).toContain('sun');
  expect(warm).not.toContain('thermal');
});

test('quantities follow the party, and are singular for one', () => {
  const two = packingList({ ...base, people: 2 })
    .flatMap((g) => g.items)
    .find((i) => i.id === 'pillows');
  const one = packingList({ ...base, people: 1 })
    .flatMap((g) => g.items)
    .find((i) => i.id === 'pillows');
  expect(two?.qty).toBe('2 pillows');
  expect(one?.qty).toBe('1 pillow');
});

test('a long trip adds laundry, a short one does not', () => {
  expect(ids({ ...base, nights: 14 })).toContain('laundry');
  expect(ids({ ...base, nights: 3 })).not.toContain('laundry');
});

test('children and dogs add their own sections only when asked', () => {
  const plain = packingList(base).map((g) => g.id);
  expect(plain).not.toContain('children');
  expect(plain).not.toContain('dog');
  const full = packingList({ ...base, children: true, dog: true }).map((g) => g.id);
  expect(full).toContain('children');
  expect(full).toContain('dog');
});

test('nonsense input still produces a list rather than throwing', () => {
  const list = packingList({
    ...base,
    people: Number.NaN,
    nights: -5,
  });
  expect(countItems(list)).toBeGreaterThan(12);
  // Clamped to one person, one night — not zero of everything.
  const pillows = list.flatMap((g) => g.items).find((i) => i.id === 'pillows');
  expect(pillows?.qty).toBe('1 pillow');
});

test('the plain-text form carries every item and a checkbox', () => {
  const list = packingList(base);
  const text = asText(list);
  for (const group of list) {
    expect(text).toContain(group.title);
    for (const item of group.items) expect(text).toContain(item.label);
  }
  expect(text.split('[ ]').length - 1).toBe(countItems(list));
});
