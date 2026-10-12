import { foldToAscii, slugifyRegion } from './canonical';

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

describe('🔴 the region slug and the campsite slug agree', () => {
  // They are two segments of one URL. When each had its own copy of the
  // same five lines, a change to one would have moved half the path.
  it('slugifyRegion is the fold', () => {
    for (const name of ['Sjælland', 'Skåne', 'Łódź', 'Haut-Rhin']) {
      expect(slugifyRegion(name)).toBe(foldToAscii(name));
    }
  });

  it('an absent region is still an empty segment, not "null"', () => {
    expect(slugifyRegion(null)).toBe('');
    expect(slugifyRegion('')).toBe('');
  });
});
