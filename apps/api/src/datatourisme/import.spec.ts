import { dedupeByRef, plan, slugify, uniqueSlug } from './import';
import type { ParsedSpot } from './parse';

// CAMP-107 — the pure parts of the importer.
//
// 🔴 This file exists because import.ts had no tests at all, and the
// first time anyone looked closely it turned out to write duplicate
// campsites. `slugify`, `uniqueSlug` and `plan` were exported — which
// usually means "meant to be tested" — and never were, through two live
// imports of French data.

const spot = (over: Partial<ParsedSpot> = {}): ParsedSpot =>
  ({
    ref: 'https://data.datatourisme.fr/13/abc',
    name: 'Camping du Lac',
    lat: 45.1,
    lon: 5.2,
    description: null,
    descriptionLang: null,
    stars: null,
    website: null,
    updatedAt: '2026-03-12',
    ...over,
  }) as ParsedSpot;

describe('🔴 the same POI twice in one file', () => {
  // Found in ara.csv on 24.09.2026: 14 URIs published twice, the rows
  // byte-identical. Candidates are fetched once before any insert, so
  // the second copy cannot see the first and both would be written.
  it('collapses records that share a source URI', () => {
    const rows = [
      spot({ ref: 'a' }),
      spot({ ref: 'b' }),
      spot({ ref: 'a' }),
      spot({ ref: 'a' }),
    ];
    expect(dedupeByRef(rows).map((r) => r.ref)).toEqual(['a', 'b']);
  });

  it('keeps the first occurrence, so two runs agree', () => {
    const rows = [
      spot({ ref: 'a', name: 'First' }),
      spot({ ref: 'a', name: 'Second' }),
    ];
    expect(dedupeByRef(rows)[0].name).toBe('First');
    // And again, because a rule that depends on iteration order of a map
    // is a rule that changes when the file does.
    expect(dedupeByRef([...rows])[0].name).toBe('First');
  });

  it('leaves a file with no repeats exactly as it was', () => {
    const rows = [spot({ ref: 'a' }), spot({ ref: 'b' }), spot({ ref: 'c' })];
    expect(dedupeByRef(rows)).toHaveLength(3);
  });

  it('does not treat different URIs as the same campsite', () => {
    // Same name, same point, different URI: that is the matcher's
    // decision to make, not this function's.
    const rows = [
      spot({ ref: 'a', name: 'Camping du Lac' }),
      spot({ ref: 'b', name: 'Camping du Lac' }),
    ];
    expect(dedupeByRef(rows)).toHaveLength(2);
  });
});

describe('slugs', () => {
  it('strips accents the way the campsite URLs do', () => {
    expect(slugify('Camping de l’Étang', 'x/1')).toBe('camping-de-l-etang');
  });

  it('falls back to the URI when a name produces nothing', () => {
    expect(slugify('!!!', 'https://data.datatourisme.fr/13/uuid-here')).toBe(
      'spot-uuid-here',
    );
  });

  it('never returns an empty slug', () => {
    expect(slugify('', 'x/abc').length).toBeGreaterThan(0);
  });

  it('gives a second campsite of the same name its own URL', () => {
    const used = new Set<string>();
    expect(uniqueSlug('camping-du-lac', used)).toBe('camping-du-lac');
    expect(uniqueSlug('camping-du-lac', used)).toBe('camping-du-lac-2');
    expect(uniqueSlug('camping-du-lac', used)).toBe('camping-du-lac-3');
  });

  // 🔴 Suffixes must not depend on what else is in the set, or a re-import
  // silently moves pages to different URLs.
  it('is stable for a given order', () => {
    const a = new Set<string>();
    const b = new Set<string>();
    const order = ['x', 'x', 'y', 'x'];
    expect(order.map((s) => uniqueSlug(s, a))).toEqual(
      order.map((s) => uniqueSlug(s, b)),
    );
  });
});

describe('plan', () => {
  it('sends a record with no candidate to the fresh pile', () => {
    const p = plan([spot({ ref: 'a' })], () => []);
    expect(p.fresh).toHaveLength(1);
    expect(p.same).toHaveLength(0);
    expect(p.review).toHaveLength(0);
    expect(p.duplicates).toHaveLength(0);
  });
});

// 🔴 The blind spot the near-duplicate page guard found, not this file.
//
// Candidates are read from the database once, before anything is
// written, so two rows describing one campsite inside a single file
// never met: the matcher existed and was never asked. The real pair, in
// the Vendée file on 24.09.2026, was published as two pages 84.5%
// identical.
describe('🔴 one campsite, listed twice in the same file', () => {
  // The real names and the real distance, so the case cannot be quietly
  // weakened into one that passes.
  const pacouinay = [
    spot({
      ref: 'uri-1',
      name: 'Camping aux Prairies de Pacouinay',
      lat: 46.38456,
      lon: -0.64864,
    }),
    spot({
      ref: 'uri-2',
      name: "Emplacement camping-car - Camping chez l'habitant Les Prairies de Pacouinay",
      lat: 46.38453,
      lon: -0.64837,
    }),
  ];

  it('publishes the first and holds the second back for a person', () => {
    const p = plan(pacouinay, () => []);
    expect(p.fresh).toHaveLength(1);
    expect(p.fresh[0].ref).toBe('uri-1');
    // 🔴 Review, not an automatic merge. The matcher's own verdict on
    // this pair is "21 m away and named differently" — and by its rules
    // that is right, because it was measured for two INDEPENDENT sources
    // describing the world. Inside one publisher's file the same facts
    // mean something else, and the only honest machine answer is "a
    // person should look".
    expect(p.review).toHaveLength(1);
    expect(p.review[0].spot.ref).toBe('uri-2');
    expect(p.fresh.map((s) => s.ref)).not.toContain('uri-2');
  });

  it('does not call it a merge into an existing campsite', () => {
    // 🔴 Different facts deserve different piles. "We already had this"
    // and "the source published it twice" lead to different questions,
    // and collapsing them would hide how dirty an incoming file is.
    const p = plan(pacouinay, () => []);
    expect(p.same).toHaveLength(0);
  });

  it('an exact-name repeat at the same point is collapsed without asking', () => {
    // When the matcher itself is confident, nobody needs to be woken up.
    const p = plan(
      [
        spot({ ref: 'a', name: 'Camping du Lac', lat: 46.3, lon: -0.6 }),
        spot({ ref: 'b', name: 'Camping du Lac', lat: 46.3, lon: -0.6 }),
      ],
      () => [],
    );
    expect(p.fresh).toHaveLength(1);
    expect(p.duplicates).toHaveLength(1);
    expect(p.review).toHaveLength(0);
  });

  it('two genuinely different campsites in one file both survive', () => {
    // A kilometre apart with unrelated names: the rule must not collapse
    // neighbours. Two campsites really can share a valley.
    const p = plan(
      [
        spot({ ref: 'a', name: 'Camping du Lac', lat: 46.3, lon: -0.6 }),
        spot({ ref: 'b', name: 'Camping de la Forêt', lat: 46.31, lon: -0.61 }),
      ],
      () => [],
    );
    expect(p.fresh).toHaveLength(2);
    expect(p.duplicates).toHaveLength(0);
  });

  it('a database match still wins over a same-file one', () => {
    // The database is asked first, and its answer stands: a record that
    // matches something already published is a merge, never a duplicate
    // of a row from this file.
    const p = plan([spot({ ref: 'a', name: 'Camping du Lac' })], () => [
      { id: 'existing', name: 'Camping du Lac', lat: 45.1, lon: 5.2 },
    ]);
    expect(p.same).toHaveLength(1);
    expect(p.duplicates).toHaveLength(0);
    expect(p.fresh).toHaveLength(0);
  });
});
