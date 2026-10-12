import {
  correctRegion,
  isKnownRegion,
  FRENCH_DEPARTEMENTS,
  NATURAL_EARTH_FIXES,
} from './region-names';

// CAMP-288 — the two names Natural Earth spells wrong, and the many it
// does not.
//
// 🔴 Most of what follows asserts that NOTHING changes. A correction
// table is a licence to rewrite somebody's place name, and the damage
// of rewriting one that was already right is worse than the typo: a
// correct URL would move, and CAMP-87 says a published URL does not
// move without a redirect for it.

describe('the correction table itself', () => {
  it('🔴 every correction lands on a real département', () => {
    // Without this, a typo in the FIX table publishes a different
    // place name that nobody notices — the same defect one layer up.
    const known = new Set(FRENCH_DEPARTEMENTS);
    for (const [wrong, right] of Object.entries(NATURAL_EARTH_FIXES.FR)) {
      expect(known.has(right)).toBe(true);
      expect(wrong).not.toBe(right);
    }
  });

  it('🔴 no correction rewrites a name that is already correct', () => {
    const known = new Set(FRENCH_DEPARTEMENTS);
    for (const wrong of Object.keys(NATURAL_EARTH_FIXES.FR)) {
      expect(known.has(wrong)).toBe(false);
    }
  });

  it('holds the 101 départements, counted', () => {
    // 96 metropolitan + 5 overseas. A list that quietly loses an entry
    // turns a real département into an "unknown region".
    expect(FRENCH_DEPARTEMENTS).toHaveLength(101);
    expect(new Set(FRENCH_DEPARTEMENTS).size).toBe(101);
  });
});

describe('correctRegion', () => {
  it('fixes the two Natural Earth misspellings', () => {
    expect(correctRegion('FR', 'Haute-Rhin')).toBe('Haut-Rhin');
    expect(correctRegion('FR', 'Seien-et-Marne')).toBe('Seine-et-Marne');
  });

  it('🔴 leaves the département next door alone', () => {
    // Bas-Rhin is one letter from Haut-Rhin and is spelt correctly.
    expect(correctRegion('FR', 'Bas-Rhin')).toBe('Bas-Rhin');
  });

  it('🔴 does not apply a French fix to another country', () => {
    // `Rheinland-Pfalz` is a correct German Land and a wrong French
    // region; the table is keyed by country for exactly this.
    expect(correctRegion('DE', 'Rheinland-Pfalz')).toBe('Rheinland-Pfalz');
    expect(correctRegion('DE', 'Haute-Rhin')).toBe('Haute-Rhin');
  });

  it('is case-insensitive about the country code only', () => {
    expect(correctRegion('fr', 'Haute-Rhin')).toBe('Haut-Rhin');
    // …and never about the region: a differently-cased region is a
    // different name, and guessing which is meant is how a correction
    // table becomes a rewriter.
    expect(correctRegion('FR', 'haute-rhin')).toBe('haute-rhin');
  });

  it('passes every other region through untouched', () => {
    for (const d of FRENCH_DEPARTEMENTS) expect(correctRegion('FR', d)).toBe(d);
  });

  it('an absent region stays absent', () => {
    expect(correctRegion('FR', null)).toBeNull();
    expect(correctRegion('FR', '   ')).toBeNull();
    expect(correctRegion(null, 'Vendée')).toBe('Vendée');
  });
});

describe('isKnownRegion', () => {
  it('knows a département and a typo apart', () => {
    expect(isKnownRegion('FR', 'Vendée')).toBe(true);
    expect(isKnownRegion('FR', 'Haute-Rhin')).toBe(false);
  });

  it('🔴 says null, not false, for a country we hold no list for', () => {
    // 811 German campsites carry a correct Land. Reporting them as
    // unknown would bury the two real findings.
    expect(isKnownRegion('DE', 'Rheinland-Pfalz')).toBeNull();
    expect(isKnownRegion('ES', 'Gerona')).toBeNull();
  });

  it('🔴 catches a neighbour’s region flown under the French flag', () => {
    // Measured: 18 campsites with country=FR carry Valais, Vaud,
    // Gerona, Hainaut, Rheinland-Pfalz or West Flanders.
    for (const foreign of [
      'Valais',
      'Vaud',
      'Gerona',
      'Hainaut',
      'West Flanders',
    ]) {
      expect(isKnownRegion('FR', foreign)).toBe(false);
    }
  });

  it('has no opinion without both parts', () => {
    expect(isKnownRegion(null, 'Vendée')).toBeNull();
    expect(isKnownRegion('FR', null)).toBeNull();
  });
});
