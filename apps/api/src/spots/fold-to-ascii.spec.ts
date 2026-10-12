import { foldToAscii, slugifyRegion } from './canonical';
import { slugify } from '../osm/import-spots';

// CAMP-290 — the letters NFD cannot take apart.
//
// 🔴 Half of what follows asserts that NOTHING changed. A fold is a
// licence to rewrite somebody's name, and a published slug never moves
// without a redirect for it (CAMP-87): a case that quietly starts
// folding `å` differently would move 151 Swedish addresses.

describe('the letters that are letters, not letters-with-a-mark', () => {
  it('🔴 the four shapes measured in the database on 12.10.2026', () => {
    expect(foldToAscii('Søby Strand Camping')).toBe('soby-strand-camping');
    expect(foldToAscii('Großostheim')).toBe('grossostheim');
    expect(foldToAscii('Camping & Feriecenter Samsø')).toBe(
      'camping-feriecenter-samso',
    );
    expect(foldToAscii('Łódź')).toBe('lodz');
  });

  it('🔴 none of them leaves a hyphen where a letter was', () => {
    for (const name of [
      'Søby',
      'Großostheim',
      'Samsø',
      'Łódź',
      'Sjælland',
      'Ærø',
      'Đakovo',
      'Birżebbuġa',
    ]) {
      const slug = foldToAscii(name);
      expect(slug).not.toMatch(/-/);
      expect(slug).not.toBe('');
    }
  });

  it('æ reads the same in both traditions', () => {
    expect(foldToAscii('Sjælland')).toBe('sjaelland');
    expect(foldToAscii('ÆRØSKØBING')).toBe('aeroskobing');
  });

  it('ß has no second reading', () => {
    expect(foldToAscii('Straße')).toBe('strasse');
  });
});

describe('🔴 what must NOT change', () => {
  // Every one of these was already right, and 151 Swedish, 1 Åland and
  // every Croatian address depends on it staying right.
  it('combining marks still just come off', () => {
    expect(foldToAscii('Skåne')).toBe('skane');
    expect(foldToAscii('Vårdö')).toBe('vardo');
    expect(foldToAscii('Šibensko-Kninska')).toBe('sibensko-kninska');
    expect(foldToAscii('Ardèche')).toBe('ardeche');
    expect(foldToAscii('Nièvre')).toBe('nievre');
  });

  it('a name already in the allowed alphabet is untouched', () => {
    for (const name of [
      'vendee',
      'camping-les-pins',
      'dordogne',
      'spot-w123',
    ]) {
      expect(foldToAscii(name)).toBe(name);
    }
    // …and case still folds, which is what a URL wants.
    expect(foldToAscii('Vendee')).toBe('vendee');
  });

  it('punctuation still collapses to one hyphen, and the ends are bare', () => {
    expect(foldToAscii('  Camping   "Les Pins" !! ')).toBe('camping-les-pins');
    expect(foldToAscii('---')).toBe('');
  });
});

describe('🔴 every row of the table is reachable', () => {
  // Review deleted 7 of the 11 pairs one at a time and the spec stayed
  // green: `ħ`, `œ`, `þ`, `ð`, `ŋ`, `ŧ` and `ẞ` were carried by nothing.
  // `ħ` is not decoration — it is the Maltese letter, and Mellieħa and
  // Għajn Tuffieħa are the rows this card is fixing.
  const EACH: ReadonlyArray<readonly [string, string]> = [
    ['Mellieħa', 'mellieha'],
    ['Għajn Tuffieħa', 'ghajn-tuffieha'],
    ['Sjælland', 'sjaelland'],
    ['ÆRØ', 'aero'],
    ['Søby', 'soby'],
    ['Straße', 'strasse'],
    ['STRAẞE', 'strasse'],
    ['Łódź', 'lodz'],
    ['Đakovo', 'dakovo'],
    ['Cœur', 'coeur'],
    ['Þingvellir', 'thingvellir'],
    ['Ðalvík', 'dalvik'],
    ['Sámi ŋ', 'sami-n'],
    ['ŧ', 't'],
  ];

  it.each(EACH)('%s → %s', (from, to) => {
    expect(foldToAscii(from)).toBe(to);
  });

  it('🔴 and the decomposable ones still go through NFD, not the table', () => {
    // `ǿ` is ø + acute, `ǽ` is æ + acute. The table only sees them
    // because the decomposition runs first.
    expect(foldToAscii('ǿ')).toBe('o');
    expect(foldToAscii('ǽ')).toBe('ae');
  });
});

describe('🔴 the campsite slug, which is what this PR actually changes', () => {
  // Review replaced `.slice(0, 80)` with `.slice(0, 12)` and removed
  // the trailing-hyphen trim, and the whole 1 245-test suite stayed
  // green: the function this card rewrites was reached by nothing.
  it('folds the letters NFD cannot split', () => {
    expect(slugify('Søby Strand Camping', 'w1')).toBe('soby-strand-camping');
    expect(slugify('Großostheim', 'w1')).toBe('grossostheim');
    expect(slugify('Camping & Feriecenter Samsø', 'w1')).toBe(
      'camping-feriecenter-samso',
    );
  });

  it('🔴 still stops at 80 characters', () => {
    const long = `${'a'.repeat(100)} camping`;
    expect(slugify(long, 'w1')).toHaveLength(80);
  });

  it('🔴 and never ends on the hyphen the cut leaves behind', () => {
    // 'a'×79 + ' ' + … folds to 79 letters, a hyphen at 80.
    const onTheEdge = `${'a'.repeat(79)} pins`;
    expect(slugify(onTheEdge, 'w1')).toBe('a'.repeat(79));
  });

  it('a name with nothing a URL can carry falls back to the OSM id', () => {
    expect(slugify('', 'w123')).toBe('spot-w123');
    expect(slugify(null, 'w123')).toBe('spot-w123');
    expect(slugify('—— ——', 'w123')).toBe('spot-w123');
  });
});

describe('🔴 the region segment does NOT move yet', () => {
  // `canonicalPath` computes it live and the page is statically
  // exported with `dynamicParams = false`, so folding here would make
  // 350 published pages 404 rather than 301. CAMP-289 brings the fold
  // and the redirects together.
  it('still spells the undecomposable letters as a hyphen', () => {
    expect(slugifyRegion('Sjaælland')).toBe('sja-lland');
    expect(slugifyRegion('Łódź')).toBe('odz');
    expect(slugifyRegion('Mellieħa')).toBe('mellie-a');
  });

  it('…and is unchanged for everything else', () => {
    expect(slugifyRegion('Skåne')).toBe('skane');
    expect(slugifyRegion('Šibensko-Kninska')).toBe('sibensko-kninska');
    expect(slugifyRegion(null)).toBe('');
    expect(slugifyRegion('')).toBe('');
  });
});
