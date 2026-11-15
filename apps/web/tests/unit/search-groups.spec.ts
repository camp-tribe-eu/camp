import { expect, test } from '@playwright/test';
import { fold, searchText, type SearchDoc } from '../../src/lib/search';
import {
  countryEntries,
  matchEntries,
  regionEntries,
  regionTitle,
} from '../../src/lib/search-groups';

// CAMP-455 — вкладки «Regions» і «Countries».
//
// 🔴 КОРПУС ВИПИСАНИЙ РУКАМИ, і кожне очікуване число пораховане з нього
// пальцем, а не повторним запуском функції. Корпус збудовано так, щоб
// кожна гілка правила мала свій рядок-пастку: префікс проти підрядка,
// країна в тексті регіону, регіон з однаковою назвою у двох країнах.

const doc = (
  name: string,
  country: string,
  region: string,
  slug = fold(name).replace(/ /g, '-'),
): SearchDoc => {
  const base = {
    kind: 'campsite' as const,
    name,
    path: `/camping/${country}/${region}/${slug}`,
    country,
    region,
    near: [] as { name: string; m: number }[],
  };
  return { ...base, text: searchText(base) };
};

const DOCS: SearchDoc[] = [
  doc('A', 'it', 'bari'),
  doc('B', 'it', 'bari'),
  doc('C', 'it', 'bari'),
  // «bari» — початок слова. П'ять кемпінгів, тобто БІЛЬШЕ, ніж у самого
  // Bari (3): без правила «точна назва першою» він стояв би вище.
  doc('D', 'it', 'bari-nord'),
  doc('D2', 'it', 'bari-nord'),
  doc('D3', 'it', 'bari-nord'),
  doc('D4', 'it', 'bari-nord'),
  doc('D5', 'it', 'bari-nord'),
  doc('E', 'it', 'barletta-andria-trani'),
  doc('F', 'hr', 'splitsko-dalmatinska'),
  doc('G', 'hr', 'splitsko-dalmatinska'),
  doc('H', 'es', 'valencia'),
  doc('I', 'it', 'valencia'), // та сама назва в іншій країні
];

test.describe('regionEntries', () => {
  test('one entry per (country, region), with the campsites counted by hand', () => {
    const regions = regionEntries(DOCS);
    // it/bari, it/bari-nord, it/barletta-…, hr/splitsko-…, es/valencia, it/valencia
    expect(regions).toHaveLength(6);
    const count = (c: string, r: string) =>
      regions.find((e) => e.country === c && e.region === r)?.count;
    expect(count('it', 'bari')).toBe(3);
    expect(count('hr', 'splitsko-dalmatinska')).toBe(2);
    expect(count('it', 'valencia')).toBe(1);
    expect(count('es', 'valencia')).toBe(1);
  });

  test('the title is read off the slug', () => {
    expect(regionTitle('splitsko-dalmatinska')).toBe('Splitsko Dalmatinska');
    expect(regionTitle('bari')).toBe('Bari');
  });
});

test.describe('matchEntries', () => {
  const regions = regionEntries(DOCS);
  const names = (q: string) =>
    matchEntries(regions, q, (r) => r.count).map(
      (r) => `${r.country}/${r.region}`,
    );

  test('a word is matched by its beginning, not by a piece of its middle', () => {
    // «bari» → Bari, Bari Nord; NOT «Barletta» (it only shares «bar»),
    // and the exact name goes first although Bari Nord has 5 campsites
    // against its 3.
    expect(names('bari')).toEqual(['it/bari', 'it/bari-nord']);
    // «ari» is the middle of «bari» and must find nothing.
    expect(names('ari')).toEqual([]);
    // «bar» is the beginning of three regions and the exact name of none:
    // the biggest first — Bari Nord (5), Bari (3), Barletta (1).
    expect(names('bar')).toEqual([
      'it/bari-nord',
      'it/bari',
      'it/barletta-andria-trani',
    ]);
  });

  test('the country is part of what a region is found by', () => {
    // «valencia spain» — Spain's Valencia only, not Italy's.
    expect(names('valencia spain')).toEqual(['es/valencia']);
    // «valencia» alone finds both, in a stable order.
    expect(names('valencia')).toEqual(['es/valencia', 'it/valencia']);
  });

  test('a query that folds to nothing finds nothing', () => {
    expect(names('')).toEqual([]);
    expect(names('   ')).toEqual([]);
    expect(names('!!!')).toEqual([]);
  });

  test('the answer is capped', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      doc(`n${i}`, 'it', `region-${String(i).padStart(2, '0')}`),
    );
    expect(
      matchEntries(regionEntries(many), 'region', (r) => r.count),
    ).toHaveLength(12);
  });

  test('countries are matched by name, and the count shown is the one given', () => {
    const countries = countryEntries([
      { country: 'hr', spots: 4321, regions: 21 },
      { country: 'it', spots: 9000, regions: 20 },
      { country: 'de', spots: 5, regions: 1 },
    ]);
    const hit = matchEntries(countries, 'croat', (c) => c.spots);
    expect(hit.map((c) => c.country)).toEqual(['hr']);
    expect(hit[0].spots).toBe(4321);
    // A two-letter query is the code of nothing here: «hr» is not a
    // word of «Croatia», so it must not find Croatia.
    expect(matchEntries(countries, 'hr', (c) => c.spots)).toEqual([]);
  });
});
