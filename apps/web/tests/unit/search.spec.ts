import { expect, test } from '@playwright/test';
import {
  editDistance,
  fold,
  search,
  terms,
  tolerance,
  type SearchDoc,
} from '../../src/lib/search';

// CAMP-67 — the search, checked without a browser.
//
// 🔴 The two tests the card names as its own acceptance criteria are
// marked below. Everything else exists to stop them passing by accident.

const doc = (over: Partial<SearchDoc> & { name: string }): SearchDoc => ({
  kind: 'campsite',
  path: `/camping/hr/istria/${fold(over.name).replace(/ /g, '-') || 'x'}`,
  country: 'hr',
  region: 'istria',
  near: [],
  ...over,
  text: over.text ?? fold(`${over.name} istria croatia`),
});

test.describe('folding, on the letters our data actually contains', () => {
  test('strips the accents NFD knows about', () => {
    expect(fold('Kamp Kovač')).toBe('kamp kovac');
    expect(fold('Šibenik')).toBe('sibenik');
    expect(fold('Žumberak')).toBe('zumberak');
    expect(fold('Črnomelj')).toBe('crnomelj');
  });

  // 🔴 The measured gap. `đ` is a letter in its own right, not d plus a
  // mark, so NFD leaves it alone — verified, and two Croatian campsites
  // depend on it. Everything else on this list is the same class of
  // letter in the languages our market order reaches.
  test('strips the ones NFD leaves behind', () => {
    expect(fold('Đakovo')).toBe('dakovo');
    expect(fold('Łódź')).toBe('lodz');
    expect(fold('Straße')).toBe('strasse');
  });

  test('reduces punctuation to word boundaries', () => {
    expect(fold('Camp "Kovač" (Bovec) — 2')).toBe('camp kovac bovec 2');
    expect(terms('  Kamp   Kovač  ')).toEqual(['kamp', 'kovac']);
    expect(terms('   ')).toEqual([]);
  });
});

test.describe('edit distance', () => {
  test('counts the edits', () => {
    expect(editDistance('kovac', 'kovac')).toBe(0);
    expect(editDistance('kovac', 'kovak')).toBe(1);
    expect(editDistance('kovac', 'kovacs')).toBe(1);
    expect(editDistance('kovac', 'kvoac')).toBe(2);
  });

  test('stops counting past the cap, rather than walking the whole word', () => {
    // The answer above the cap is never acted on, so the exact number
    // does not matter — only that it is above it.
    expect(editDistance('abc', 'zzzzzzzzzz', 2)).toBeGreaterThan(2);
  });
});

test.describe('how much we forgive', () => {
  // 🔴 Nothing, for very short words. At three letters almost everything
  // is one edit from everything else — "krk" would match "park" — and a
  // search that answers with anything is worse than one that says no.
  test('a three-letter word must match exactly', () => {
    expect(tolerance('krk')).toBe(0);
    expect(search([doc({ name: 'Park Umag' })], 'krk')).toHaveLength(0);
    expect(search([doc({ name: 'Krk Beach' })], 'krk')).toHaveLength(1);
  });

  test('longer words get more room', () => {
    expect(tolerance('kovac')).toBe(1);
    expect(tolerance('campsite')).toBe(2);
  });
});

test.describe('🔴 the card: a query with a typo finds the right thing', () => {
  const docs = [
    doc({ name: 'Kamp Kovač' }),
    doc({ name: 'Camping Bled' }),
    doc({ name: 'Autocamp Slapić' }),
  ];

  test('one letter wrong still finds it', () => {
    expect(search(docs, 'kovak')[0].doc.name).toBe('Kamp Kovač');
    expect(search(docs, 'campin bled')[0].doc.name).toBe('Camping Bled');
  });

  test('the accent can be left out entirely', () => {
    expect(search(docs, 'slapic')[0].doc.name).toBe('Autocamp Slapić');
    expect(search(docs, 'kovac')[0].doc.name).toBe('Kamp Kovač');
  });

  test('an exact word still outranks a fuzzy one', () => {
    const both = [doc({ name: 'Bled' }), doc({ name: 'Bleda Vas' })];
    expect(search(both, 'bled')[0].doc.name).toBe('Bled');
  });

  test('nonsense finds nothing rather than something', () => {
    expect(search(docs, 'qwertyuiop')).toHaveLength(0);
  });
});

test.describe('🔴 the card: a place name orders by distance, not alphabet', () => {
  // Deliberately in alphabetical order that is the REVERSE of the
  // distance order, so a test that passed by accident would be visible.
  const docs = [
    doc({
      name: 'Alpha camp',
      near: [{ name: 'Bovec', m: 9000 }],
      text: fold('Alpha camp istria croatia Bovec'),
    }),
    doc({
      name: 'Beta camp',
      near: [{ name: 'Bovec', m: 1200 }],
      text: fold('Beta camp istria croatia Bovec'),
    }),
    doc({
      name: 'Gamma camp',
      near: [{ name: 'Bovec', m: 400 }],
      text: fold('Gamma camp istria croatia Bovec'),
    }),
  ];

  test('the nearest to the named place comes first', () => {
    const hits = search(docs, 'bovec');
    expect(hits.map((h) => h.doc.name)).toEqual([
      'Gamma camp',
      'Beta camp',
      'Alpha camp',
    ]);
    // And the distance is carried out, so the interface can show it.
    expect(hits[0].metres).toBe(400);
  });

  test('a misspelt place still orders by distance', () => {
    expect(search(docs, 'bovek')[0].doc.name).toBe('Gamma camp');
  });

  // 🔴 A distance is only meaningful when the query named a place.
  // Ordering "shower" by metres would be sorting on a number that
  // answers a question nobody asked.
  test('a query that names no place carries no distance', () => {
    const hits = search(docs, 'camp');
    expect(hits).toHaveLength(3);
    for (const h of hits) expect(h.metres).toBeUndefined();
  });
});

test.describe('several words narrow, they do not widen', () => {
  const docs = [
    doc({ name: 'Camping Bled' }),
    doc({ name: 'Camping Bovec' }),
  ];

  test('every term must match', () => {
    expect(search(docs, 'camping bled')).toHaveLength(1);
    expect(search(docs, 'camping')).toHaveLength(2);
    expect(search(docs, 'camping nonsense')).toHaveLength(0);
  });
});

test.describe('the answer is stable', () => {
  test('ties break on the path, so the same query gives the same order', () => {
    const same = [
      doc({ name: 'Camp', path: '/camping/hr/b/two' }),
      doc({ name: 'Camp', path: '/camping/hr/a/one' }),
    ];
    const first = search(same, 'camp').map((h) => h.doc.path);
    expect(first).toEqual(['/camping/hr/a/one', '/camping/hr/b/two']);
    // Re-running must not shuffle it.
    expect(search(same, 'camp').map((h) => h.doc.path)).toEqual(first);
  });

  test('an empty query answers with nothing, not with everything', () => {
    expect(search([doc({ name: 'Camp' })], '')).toHaveLength(0);
    expect(search([doc({ name: 'Camp' })], '   ')).toHaveLength(0);
  });

  test('the cap is respected', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      doc({ name: `Camp ${i}`, path: `/camping/hr/x/${i}` }),
    );
    expect(search(many, 'camp')).toHaveLength(20);
    expect(search(many, 'camp', { limit: 5 })).toHaveLength(5);
  });
});
