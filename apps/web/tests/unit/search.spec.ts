import { expect, test } from '@playwright/test';
import {
  editDistance,
  fold,
  search,
  searchText,
  slugFromName,
  packIndex,
  terms,
  tolerance,
  unpackIndex,
  type SearchDoc,
} from '../../src/lib/search';

// CAMP-67 — the search, checked without a browser.
//
// 🔴 The two tests the card names as its own acceptance criteria are
// marked below. Everything else exists to stop them passing by accident.

// 🔴 The haystack is BUILT, not written by hand.
//
// It used to be `fold(`${name} istria croatia`)` for every fixture,
// including the French ones — a document whose text did not match its
// own country or region, which cannot exist in real data. The round-trip
// test passed anyway, because `text` was carried verbatim through the
// packing; the moment CAMP-129 started deriving it, the fixture's own
// inconsistency surfaced. A fixture describing an impossible row proves
// nothing about the rows we have.
const doc = (over: Partial<SearchDoc> & { name: string }): SearchDoc => {
  const base = {
    kind: 'campsite' as const,
    path: `/camping/hr/istria/${fold(over.name).replace(/ /g, '-') || 'x'}`,
    country: 'hr',
    region: 'istria',
    near: [] as { name: string; m: number }[],
    ...over,
  };
  return { ...base, text: over.text ?? searchText(base) };
};

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

// CAMP-107 — the packed index format.
//
// 🔴 A mistake here is not a build failure, it is a search that returns
// the wrong campsite. The pack halves the file by removing the JSON
// keys and the two fields that are derivable from the others, so a
// wrong index arithmetic or a lost `near` array would produce documents
// that look perfectly well-formed and point at the wrong page.
test.describe('the packed index', () => {
  // 🔴 The path is built from country, region and slug here, exactly as
  // the real index route builds it — because that is the assumption the
  // packing rests on. The shared `doc()` helper hardcodes hr/istria in
  // the path, so using it with another country would describe a document
  // the site never produces, and the round-trip would "fail" on data
  // that cannot exist.
  const at = (
    country: string,
    region: string,
    slug: string,
    over: Partial<SearchDoc> & { name: string },
  ): SearchDoc => {
    // Country and region change here, so the haystack is rebuilt after
    // them — the order production uses.
    const base = { ...doc(over), country, region };
    return {
      ...base,
      path: `/camping/${country}/${region}/${slug}`,
      text: over.text ?? searchText(base),
    };
  };

  const docs: SearchDoc[] = [
    at('hr', 'istria', 'camping-du-lac', { name: 'Camping du Lac' }),
    at('si', 'bovec', 'autocamp-tabor', { name: 'Autocamp Tabor' }),
    at('fr', 'Finistère', 'camping-molene', {
      name: 'Camping Molène',
      near: [
        { name: 'Le Conquet', m: 1200 },
        { name: 'Brest', m: 24000 },
      ],
    }),
    // 🔴 The unnamed ones. 212 Croatian campsites have no name, and an
    // empty string must survive the trip as an empty string rather than
    // becoming undefined and then "undefined" on the page.
    at('hr', 'istria', 'unnamed-1', { name: '' }),
  ];

  test('every document comes back exactly as it went in', () => {
    const back = unpackIndex(packIndex(docs));
    expect(back).toEqual(docs);
  });

  test('a campsite with places near it keeps them, in order', () => {
    const back = unpackIndex(packIndex(docs));
    expect(back[2].near).toEqual([
      { name: 'Le Conquet', m: 1200 },
      { name: 'Brest', m: 24000 },
    ]);
  });

  test('a campsite with nothing near it gets an array, not undefined', () => {
    const back = unpackIndex(packIndex(docs));
    expect(back[0].near).toEqual([]);
  });

  test('the path is rebuilt, not stored', () => {
    const packed = packIndex(docs);
    // The saving only exists if the path really is absent from the file.
    expect(JSON.stringify(packed)).not.toContain('/camping/');
    expect(unpackIndex(packed)[2].path).toBe(docs[2].path);
  });

  test('countries and regions are stored once each', () => {
    const many = [...docs, ...docs, ...docs];
    const packed = packIndex(many);
    expect(packed.c.length).toBe(3); // hr, si, fr
    expect(new Set(packed.c).size).toBe(packed.c.length);
    expect(unpackIndex(packed)).toHaveLength(many.length);
  });

  // 🔴 A browser can hold a cached copy of the old file. Reading it as
  // the new format would silently produce documents with the wrong
  // fields; refusing is what makes the page say search is unavailable.
  test('an unknown format version is refused, not guessed at', () => {
    const packed = packIndex(docs) as unknown as { v: number };
    // 🔴 Version 1 specifically, because that is the file a browser may
    // still hold: it carried `text` in the slot the reader now reads as
    // `near`.
    packed.v = 1;
    expect(() => unpackIndex(packed as never)).toThrow(/not supported/);
    packed.v = 99;
    expect(() => unpackIndex(packed as never)).toThrow(/not supported/);
    expect(() => unpackIndex(undefined as never)).toThrow(/not supported/);
  });

  test('searching the unpacked index finds what searching the original does', () => {
    const back = unpackIndex(packIndex(docs));
    const a = search(docs, 'tabor').map((h) => h.doc.path);
    const b = search(back, 'tabor').map((h) => h.doc.path);
    expect(b).toEqual(a);
    expect(b.length).toBeGreaterThan(0);
  });

  test('an empty index packs and unpacks to an empty index', () => {
    expect(unpackIndex(packIndex([]))).toEqual([]);
  });
});

// ── CAMP-129: the two fields that are no longer sent ───────────────────

test.describe('what the packed index stops sending', () => {
  const row = (over: { name: string; path: string; near?: { name: string; m: number }[] }): SearchDoc => ({
    kind: 'campsite',
    country: 'fr',
    region: 'vendee',
    near: over.near ?? [],
    name: over.name,
    path: over.path,
    text: searchText({
      name: over.name,
      region: 'vendee',
      country: 'fr',
      near: over.near ?? [],
    }),
  });

  test('a derivable slug is not stored, and comes back right', () => {
    const doc = row({ name: 'Camping du Lac', path: '/camping/fr/vendee/camping-du-lac' });
    const packed = packIndex([doc]);
    // 🔴 The saving only exists if the slug really is absent.
    expect(packed.d[0][3]).toBe(0);
    expect(unpackIndex(packed)[0].path).toBe(doc.path);
  });

  test('a slug the name cannot produce IS stored', () => {
    // Two campsites called "Camping Municipal": the second gets -2, and
    // nothing about the name says so. CAMP-87 forbids moving it.
    const doc = row({ name: 'Camping Municipal', path: '/camping/fr/vendee/camping-municipal-2' });
    expect(packIndex([doc]).d[0][3]).toBe('camping-municipal-2');
    expect(unpackIndex(packIndex([doc]))[0].path).toBe(doc.path);
  });

  test('an unnamed campsite keeps its slug', () => {
    // 26% of campsites have no name; theirs is `spot-<osm ref>`, which
    // no name could ever produce.
    const doc = row({ name: '', path: '/camping/fr/vendee/spot-node-123' });
    expect(packIndex([doc]).d[0][3]).toBe('spot-node-123');
    expect(unpackIndex(packIndex([doc]))[0].path).toBe(doc.path);
  });

  test('a name past the API cut predicts the truncated slug', () => {
    // import-spots.ts slices at 80. Without the same cut, the prediction
    // is longer than the real slug and never matches — correct, but it
    // pays for every long name.
    expect(slugFromName('a'.repeat(120))).toHaveLength(80);
  });

  test('a name with nothing usable in it predicts nothing', () => {
    expect(slugFromName('!!!')).toBeNull();
    expect(slugFromName('')).toBeNull();
  });

  test('the haystack is not stored either, and is rebuilt identically', () => {
    const doc = row({
      name: 'Camping Molène',
      path: '/camping/fr/vendee/camping-molene',
      near: [{ name: 'Le Conquet', m: 1200 }],
    });
    const packed = packIndex([doc]);
    expect(JSON.stringify(packed)).not.toContain(doc.text);
    expect(unpackIndex(packed)[0].text).toBe(doc.text);
  });

  test('and a search over the rebuilt index finds what the original did', () => {
    const docs = [
      row({ name: 'Camping Molène', path: '/camping/fr/vendee/camping-molene',
            near: [{ name: 'Le Conquet', m: 1200 }] }),
      row({ name: 'Camping du Lac', path: '/camping/fr/vendee/camping-du-lac' }),
    ];
    const back = unpackIndex(packIndex(docs));
    // Every field the haystack is built from, so a drift in any one of
    // them shows up here rather than as a search that quietly misses.
    for (const q of ['molene', 'conquet', 'vendee', 'france', 'lac']) {
      expect(search(back, q).map((h) => h.doc.path), `query "${q}"`)
        .toEqual(search(docs, q).map((h) => h.doc.path));
    }
  });
});

// ── CAMP-131: how well it matches, before how close it is ─────────────

test.describe('a strong match outranks a near miss', () => {
  // 🔴 The real case, with the real names.
  //
  // Searching "bled" put a French aire first, because the place beside
  // it is "Segré-en-Anjou Bleu" — "Bleu" is one letter from "bled" —
  // and it happened to be 416 m away while Camping Bled is 878 m from
  // Bled Jezero. Distance was the primary sort key, so a one-letter
  // typo match always beat a perfect one.
  const frenchAire = doc({
    name: "Aire l'Esplanade Antoine Glémain",
    country: 'fr',
    region: 'maine-et-loire',
    path: '/camping/fr/maine-et-loire/aire-esplanade',
    near: [
      { name: 'Segré-en-Anjou Bleu', m: 416 },
      { name: 'Lidl', m: 938 },
    ],
  });
  const campingBled = doc({
    name: 'Camping Bled',
    country: 'si',
    region: 'bled',
    path: '/camping/si/bled/camping-bled',
    near: [
      { name: 'Bled', m: 2606 },
      { name: 'Blejsko jezero', m: 352 },
      { name: 'Bled Jezero', m: 878 },
    ],
  });

  test('🔴 "bled" finds Camping Bled, not a French aire near Bleu', () => {
    // 🔴 CAMP-132 made this stronger than CAMP-131 left it.
    //
    // It used to assert the aire came SECOND. It now does not come back
    // at all, because something matched `bled` properly and a one-letter
    // near miss is not competing with that — it is noise. Measured on
    // the live index: `bled` matched 99 documents and the 20 shown held
    // 15 that were not Slovenian, 10 of them French. After this change
    // it matches 8, none of them French — which is what CAMP-132 asks
    // for.
    //
    // The near miss is NOT gone in general — see the test below, which
    // is the case fuzzy matching exists for.
    const hits = search([frenchAire, campingBled], 'bled');
    expect(hits.map((h) => h.doc.name)).toEqual(['Camping Bled']);
  });

  test('🔴 the typo band is still a band, when it is all there is', () => {
    // 🔴 What the edit above stops covering, covered here.
    //
    // The old test asserted 100 / 60 / 30 in one list, and that list no
    // longer exists: once something matches properly the near misses are
    // suppressed, so the fuzzy band is only observable when nothing
    // scores above it. The rule this must catch is the over-reaching
    // version of the same change — "drop every fuzzy match" — which
    // would leave this query with no answer at all.
    //
    // Absolute numbers cannot be asserted any more either, because every
    // score is multiplied by the term's rarity. The RATIO survives that,
    // because one term means one multiplier: one edit scores 30, two
    // score 20, so the first must be exactly half again as much.
    const one = doc({ name: 'Kamping', path: '/camping/fr/x/a', country: 'fr', region: 'x' });
    const two = doc({ name: 'Kampink', path: '/camping/fr/x/b', country: 'fr', region: 'x' });
    const hits = search([one, two], 'kampingx');
    expect(hits.map((h) => h.doc.name)).toEqual(['Kamping', 'Kampink']);
    expect(hits[0].score / hits[1].score).toBeCloseTo(30 / 20, 10);
  });

  test('the near miss is still found — it is ranked, not dropped', () => {
    // 🔴 Fuzzy matching earns its keep on real typos. The fix is about
    // ORDER, and silently dropping the weaker match would be a
    // different change that nobody asked for.
    const hits = search([frenchAire], 'bled');
    expect(hits).toHaveLength(1);
  });

  test('distance still orders results that match equally well', () => {
    // The reason distance is in the sort at all: "campsites near Bovec"
    // must come back nearest-first. All three name Bovec exactly, so
    // they score the same and distance decides.
    const near = (m: number, name: string) =>
      doc({ name, path: `/camping/si/bovec/${fold(name).replace(/ /g, '-')}`,
            region: 'bovec', country: 'si', near: [{ name: 'Bovec', m }] });
    const hits = search(
      [near(3000, 'Camp Far'), near(200, 'Camp Near'), near(1200, 'Camp Mid')],
      'bovec',
    );
    expect(hits.map((h) => h.doc.name)).toEqual([
      'Camp Near',
      'Camp Mid',
      'Camp Far',
    ]);
    expect(hits.map((h) => h.metres)).toEqual([200, 1200, 3000]);
  });

  test('🔴 a query that names no place is not ordered by distance', () => {
    // The original reasoning, kept: ordering "shower" results by metres
    // would be sorting on a number that answers a question nobody
    // asked. Equal scores fall through to the deterministic tiebreak.
    const a = doc({ name: 'Shower Camp A', path: '/camping/hr/istria/a' });
    const b = doc({ name: 'Shower Camp B', path: '/camping/hr/istria/b' });
    const hits = search([b, a], 'shower');
    expect(hits.map((h) => h.doc.path)).toEqual([
      '/camping/hr/istria/a',
      '/camping/hr/istria/b',
    ]);
    expect(hits.every((h) => h.metres === undefined)).toBe(true);
  });

  test('an exact name beats a prefix, and a typo is not shown beside them', () => {
    const exact = doc({ name: 'Bled', path: '/camping/si/bled/exact' });
    const prefix = doc({ name: 'Bledograd', path: '/camping/si/bled/prefix' });
    const typo = doc({ name: 'Bleu', path: '/camping/fr/x/typo', country: 'fr', region: 'x' });
    const hits = search([typo, prefix, exact], 'bled');
    // The typo is dropped, not ranked last: `bled` matched two documents
    // properly, so `Bleu` is a different word rather than a weak answer.
    expect(hits.map((h) => h.doc.name)).toEqual(['Bled', 'Bledograd']);
    // 🔴 The SCORES, not just the order.
    //
    // Review mutation-tested the first version of this test: raising
    // the prefix band from 60 to 100 left it green, because the three
    // fixture paths happen to sort in the asserted order and the path
    // tiebreak produced the expected result after the band this test is
    // named for had been erased. A test that passes when the thing it
    // names is gone is not a test.
    expect(hits.map((h) => h.score)).toEqual([100, 60]);
  });

  test('🔴 the distance says WHICH place it is from', () => {
    // «436 m from what you searched» was shown for a fuzzy match, so
    // "what you searched" was sometimes a different real place —
    // measured: `aire` showed "55 m" from the river La Vire. The
    // ordering may forgive a typo; the sentence may not.
    const near = doc({
      name: 'Camp Sava',
      path: '/camping/si/bled/sava',
      region: 'bled',
      country: 'si',
      near: [{ name: 'Bled Jezero', m: 878 }],
    });
    const [hit] = search([near], 'bled');
    expect(hit.metres).toBe(878);
    expect(hit.nearest).toBe('Bled Jezero');
  });
});

// 🔴 The rules CAMP-132 added, tested at a size where they can fire.
//
// These need their own fixture, and it needs to be BIG. A word only
// stops being a requirement when it is in more than 5% of the index AND
// in at least 50 documents — the floor exists precisely so a handful of
// documents cannot switch the AND off. Every other fixture in this file
// is two or three documents, so none of them reaches this code at all:
// review measured that the whole feature had zero coverage on CI, where
// the only test of it skips for want of a 15 MB index file.
//
// So the fixture is generated. 120 campsites, of which 80 contain the
// word "camping" — 67%, which is the shape of the real index, where it
// is 31.3%.
const manyDocs = (): SearchDoc[] => {
  const docs: SearchDoc[] = [];
  for (let i = 0; i < 80; i++) {
    docs.push(
      doc({ name: `Camping Number ${i}`, path: `/camping/fr/loire/c${i}` }),
    );
  }
  for (let i = 0; i < 40; i++) {
    docs.push(doc({ name: `Kamp Number ${i}`, path: `/camping/hr/istria/k${i}` }));
  }
  return docs;
};

test.describe('a common word is a preference, a rare word is a requirement', () => {
  test('🔴 the answer may be a campsite that lacks the common word', () => {
    // The card's case, in miniature. "Camp Bovec" does not contain the
    // word "camping", and an AND over both words could never return it.
    const docs = [
      ...manyDocs(),
      doc({ name: 'Camp Bovec', path: '/camping/si/bovec/camp-bovec',
            country: 'si', region: 'bovec' }),
      doc({ name: 'Camping Boven', path: '/camping/nl/gelderland/boven',
            country: 'nl', region: 'gelderland' }),
    ];
    const hits = search(docs, 'camping bovec');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].doc.name).toBe('Camp Bovec');
  });

  test('a rare word still has to match — it is the one that narrows', () => {
    const docs = manyDocs();
    expect(search(docs, 'camping nonsenseword')).toHaveLength(0);
    // And the common word alone still answers with the ones that have it.
    expect(search(docs, 'camping', { limit: 500 })).toHaveLength(80);
  });

  test('when every word is common, all of them are required again', () => {
    // Otherwise `camping number` would answer with most of the index.
    const docs = manyDocs();
    const hits = search(docs, 'camping number', { limit: 500 });
    expect(hits).toHaveLength(80);
    expect(hits.every((h) => h.doc.name.startsWith('Camping'))).toBe(true);
  });

  test('🔴 a word in a quarter of a SMALL index is still a requirement', () => {
    // The absolute floor, which nothing covered: review deleted
    // `df >= COMMON_FLOOR` and the whole suite stayed green, because
    // every fixture smaller than 50 documents makes all words common,
    // which `allCommon` then turns back into all-required anyway.
    //
    // This fixture is big enough to tell the two apart. `kamp` is in 40
    // of 122 documents — 32.8%, far above the 5% share, but below the
    // floor of 50 — so it must still be a requirement. Without the
    // floor it would become a preference, and this query would answer
    // with a campsite that has no `kamp` in it at all.
    const docs = [
      ...manyDocs(),
      doc({ name: 'Camp Bovec', path: '/camping/si/bovec/camp-bovec',
            country: 'si', region: 'bovec' }),
    ];
    expect(search(docs, 'kamp bovec')).toHaveLength(0);
  });

  test('🔴 a prefix elsewhere does not switch typo tolerance off', () => {
    // Review's finding, and the reason `floor` asks for an EXACT match
    // rather than a prefix. On the live index one Hungarian campsite
    // called "Kovakő Camp" was enough to erase "Camp Kovač" from the
    // results for `kovak` — six hits became one — because "kovako"
    // starts with the typed word and was counted as matching properly.
    const docs = [
      ...manyDocs(),
      doc({ name: 'Kovako Camp', path: '/camping/hu/pest/kovako', country: 'hu', region: 'pest' }),
      doc({ name: 'Camp Kovac', path: '/camping/si/gorenjska/kovac', country: 'si', region: 'gorenjska' }),
    ];
    const hits = search(docs, 'kovak');
    expect(hits.map((h) => h.doc.name)).toContain('Camp Kovac');

    // 🔴 On the SCORE, not on the order.
    //
    // This asserted `names[0] === 'Kovako Camp'` and review showed it
    // passed for the wrong reason: with the fuzzy pass overwriting the
    // prefix score the two tied exactly, and `/camping/hu/pest/kovako`
    // simply sorts before `/camping/si/gorenjska/kovac` on the path
    // tiebreak. The test named the band and measured the alphabet.
    const prefix = hits.find((h) => h.doc.name === 'Kovako Camp')!;
    const typo = hits.find((h) => h.doc.name === 'Camp Kovac')!;
    expect(prefix.score).toBeGreaterThan(typo.score);
    expect(prefix.score / typo.score).toBeCloseTo(60 / 30, 10);
  });

  test('🔴 the near miss is dropped only when the word matched exactly', () => {
    const docs = [
      ...manyDocs(),
      doc({ name: 'Bled', path: '/camping/si/bled/bled', country: 'si', region: 'bled' }),
      doc({ name: 'Bleu', path: '/camping/fr/anjou/bleu', country: 'fr', region: 'anjou' }),
    ];
    expect(search(docs, 'bled').map((h) => h.doc.name)).toEqual(['Bled']);
    // Take the exact match away and the near miss comes back.
    const without = docs.filter((d) => d.name !== 'Bled');
    expect(search(without, 'bled').map((h) => h.doc.name)).toEqual(['Bleu']);
  });

  test('🔴 the three bands keep their sizes relative to each other', () => {
    // What the deleted `[100, 60, 30]` assertion used to pin. Review
    // mutated `40 - d * 10` to `400 - d * 100` — which keeps the 30:20
    // ratio the other test checks — and the whole suite stayed green
    // while an exact word started losing to a two-edit typo. One term
    // means one rarity multiplier, so within a query the ratios between
    // bands survive the weighting and can still be asserted.
    const exact = [
      doc({ name: 'Kovac', path: '/camping/si/a/exact' }),
      doc({ name: 'Kovacevo', path: '/camping/si/a/prefix' }),
    ];
    const [a, b] = search(exact, 'kovac');
    expect(a.score / b.score).toBeCloseTo(100 / 60, 10);

    // Prefix against a one-edit near miss, with no exact match present.
    const near = [
      doc({ name: 'Kovako', path: '/camping/si/a/prefix2' }),
      doc({ name: 'Kovar', path: '/camping/si/a/typo' }),
    ];
    const [c, d] = search(near, 'kovak');
    expect(c.score / d.score).toBeCloseTo(60 / 30, 10);
  });
});
