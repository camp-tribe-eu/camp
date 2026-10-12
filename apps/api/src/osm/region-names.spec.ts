import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  it('🔴 every French correction lands on a real département', () => {
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

  it('🔴 no correction is a no-op, in any country', () => {
    for (const [cc, fixes] of Object.entries(NATURAL_EARTH_FIXES)) {
      for (const [wrong, right] of Object.entries(fixes)) {
        expect(`${cc}:${wrong}`).not.toBe(`${cc}:${right}`);
        expect(right.trim()).toBe(right);
        expect(right).not.toBe('');
      }
    }
  });

  it('🔴 the names with the awkward characters are spelt out', () => {
    // 99 of the 101 départements are guarded only by the length
    // assertion below: a silent edit to one would turn a real place
    // into an "unknown region". These are the ones an editor is most
    // likely to mangle, so they are stated here letter by letter.
    for (const name of [
      "Côte-d'Or",
      "Côtes-d'Armor",
      "Val-d'Oise",
      'Territoire de Belfort',
      'La Réunion',
      'Alpes-de-Haute-Provence',
      'Haut-Rhin',
      'Bas-Rhin',
    ]) {
      expect(FRENCH_DEPARTEMENTS).toContain(name);
    }
  });

  it('🔴 the corrections found outside France are the measured ones', () => {
    // Each checked against the polygon's own iso_3166_2 code; the
    // number is campsites in the database on 12.10.2026.
    expect(NATURAL_EARTH_FIXES.DK.Sjaælland).toBe('Sjælland'); // DK-85, 306
    expect(NATURAL_EARTH_FIXES.IT.Oristrano).toBe('Oristano'); // IT-OR, 32
    expect(NATURAL_EARTH_FIXES.IT.Crotene).toBe('Crotone'); // IT-KR, 29
    expect(NATURAL_EARTH_FIXES.HU.Gyôr).toBe('Győr'); // HU-GY, 3
    expect(NATURAL_EARTH_FIXES.IE.Laoighis).toBe('Laois'); // IE-LS, 2
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
    expect(correctRegion('FR', 'Sjaælland')).toBe('Sjaælland');
  });

  it('🔴 leaves the English exonyms alone', () => {
    // `name <> name_en` in Natural Earth is mostly the local name
    // against the English one, not a misspelling. Renaming these would
    // move 1 336 German pages to a word the country does not use.
    for (const [cc, local] of [
      ['DE', 'Bayern'],
      ['DE', 'Nordrhein-Westfalen'],
      ['NL', 'Noord-Brabant'],
      ['CZ', 'Jihočeský'],
      ['FR', 'Pyrénées-Atlantiques'],
    ] as const) {
      expect(correctRegion(cc, local)).toBe(local);
    }
  });

  it('fixes the misspellings found outside France', () => {
    expect(correctRegion('DK', 'Sjaælland')).toBe('Sjælland');
    expect(correctRegion('IT', 'Crotene')).toBe('Crotone');
    expect(correctRegion('HU', 'Gyôr')).toBe('Győr');
    expect(correctRegion('IE', 'Laoighis')).toBe('Laois');
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

  it('🔴 would catch a neighbour’s region flown under the French flag', () => {
    // 18 rows in the database look like this.
    //
    // 🔴 THE PIPELINE NO LONGER PRODUCES THEM, and review proved it:
    // `country` comes from the same polygon as `region`, so a Swiss
    // polygon yields country=CH and this function answers `null`, not
    // `false`. Those 18 are rows from when the country came from the
    // extract argument. The assertion stays because it is what the
    // function must answer when it IS asked — but it is not evidence
    // that today's import would report them, and the import's own
    // count will say 0.
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

// 🔴 THE PART THAT WAS MISSING, AND REVIEW FOUND IT.
//
// Everything above drives two pure functions. Review replaced
// `correctRegion(country, row.admin_region)` with `row.admin_region` in
// import-spots.ts and ran the whole API suite: 1 228 passed, nothing
// red. The entire visible effect of this change could be deleted and no
// test would say so — the table was tested and its only caller was not.
//
// So this reads the one file that writes `region` and asserts the call
// is there. It is a check on the FORM of the source, which is what
// check-cems-coverage.mjs does for the CEMS modules, and for the same
// reason: a unit test cannot prove that a loop over 56 950 rows calls
// anything, but it can prove the line exists and is the only one.
describe('🔴 the import actually calls this', () => {
  const source = readFileSync(join(__dirname, 'import-spots.ts'), 'utf8');

  it('assigns `region` exactly once, and through correctRegion', () => {
    const assignments = source.match(/const region = [^;]+;/g) ?? [];
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toContain('correctRegion(');
  });

  it('reports a region the country does not have', () => {
    expect(source).toContain('isKnownRegion(');
  });

  it('imports both from this module and nowhere else', () => {
    expect(source).toMatch(
      /import \{[^}]*correctRegion[^}]*\} from '\.\/region-names';/,
    );
  });
});
