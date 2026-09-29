import {
  EU_MEMBER_STATES,
  EU_MEMBER_STATES_AND_SUBDIVISIONS,
  ISO_SUBDIVISION_OF,
  NON_ISO_COUNTRY_CODE,
  isEuMemberState,
  normaliseCountry,
} from './eu';

// CAMP-118 — the guard that keeps the project's scope true in the data
// and not only in the documents.

describe('EU_MEMBER_STATES', () => {
  it('has twenty-seven members', () => {
    expect(EU_MEMBER_STATES).toHaveLength(27);
  });

  it('lists each one once, in lower case', () => {
    expect(new Set(EU_MEMBER_STATES).size).toBe(27);
    for (const c of EU_MEMBER_STATES) expect(c).toBe(c.toLowerCase());
    for (const c of EU_MEMBER_STATES) expect(c).toMatch(/^[a-z]{2}$/);
  });
});

describe('isEuMemberState', () => {
  // 🔴 The two that were actually in the database, and the ones most
  // likely to be added by a well-meaning hand later.
  it.each(['ba', 'rs', 'ch', 'no', 'gb', 'me', 'al', 'mk', 'xk', 'ua', 'tr'])(
    'refuses %s, which is not a member state',
    (code) => {
      expect(isEuMemberState(code)).toBe(false);
    },
  );

  it('accepts every member state', () => {
    for (const c of EU_MEMBER_STATES) expect(isEuMemberState(c)).toBe(true);
  });

  it('does not care about case, because sources disagree about it', () => {
    expect(isEuMemberState('FR')).toBe(true);
    expect(isEuMemberState('Fr')).toBe(true);
  });

  // 🔴 A missing country is not a member state. The import resolves the
  // country from a polygon, and a point in open water falls outside every
  // one of them — that row must not slip through on an empty string.
  it.each([null, undefined, '', ' ', 'europe', 'zz'])(
    'refuses %p rather than letting it through',
    (code) => {
      expect(isEuMemberState(code as string)).toBe(false);
    },
  );
});

// 🔴 CAMP-113. Åland is Finland, Natural Earth calls it AX, and the
// route-POI import deleted all 218 of its points because the member list
// is a list of STATES. These tests fail if the alias is removed.
describe('subdivision codes that are still a member state', () => {
  it('accepts ax, because Åland is Finland and inside the Union', () => {
    expect(isEuMemberState('ax')).toBe(true);
    expect(isEuMemberState('AX')).toBe(true);
    expect(normaliseCountry('AX')).toBe('fi');
  });

  // 🔴 The alias must not become a category. Measured across every
  // ne_admin1 code in the European window, AX is the ONLY one inside a
  // member state — these four are the ones a later hand is most likely
  // to add "for consistency", and every one of them is outside the Union.
  it.each(['gb', 'mc', 'gi', 'li'])('still refuses %s', (code) => {
    expect(isEuMemberState(code)).toBe(false);
    expect(normaliseCountry(code)).toBe(code);
  });

  it('is exactly one alias, not a table somebody grew', () => {
    expect(Object.keys(ISO_SUBDIVISION_OF)).toEqual(['ax']);
  });

  // Every alias must point AT a member state, or it is a hole rather
  // than a fix.
  it('every alias resolves to a real member state', () => {
    for (const [from, to] of Object.entries(ISO_SUBDIVISION_OF)) {
      expect(EU_MEMBER_STATES).toContain(to);
      expect(EU_MEMBER_STATES).not.toContain(from);
    }
  });

  // 🔴 The list SQL tests against. It must hold the aliases — a query
  // using EU_MEMBER_STATES alone is the bug this describes.
  it('the SQL list carries the members and the aliases', () => {
    expect(EU_MEMBER_STATES_AND_SUBDIVISIONS).toContain('ax');
    expect(EU_MEMBER_STATES_AND_SUBDIVISIONS).toContain('fi');
    expect(EU_MEMBER_STATES_AND_SUBDIVISIONS).not.toContain('gb');
    expect(EU_MEMBER_STATES_AND_SUBDIVISIONS).toHaveLength(
      EU_MEMBER_STATES.length + Object.keys(ISO_SUBDIVISION_OF).length,
    );
  });
});

// 🔴 CAMP-168. A THIRD source, a third dialect, and this time it is not a
// subdivision — it is a member state spelled in another code system.
//
// The EEA labels its countries the Eurostat way, so Greece arrives as
// `EL`. ISO 3166-1 leaves `EL` unassigned and this repository's list
// holds `gr`, so the membership check said no — to 1 734 of the 22 010
// EU-27 bathing waters, measured 28.09.2026, silently and with exit 0.
describe('country codes from other code systems', () => {
  it('resolves the Eurostat code for Greece', () => {
    expect(normaliseCountry('EL')).toBe('gr');
    expect(normaliseCountry('el')).toBe('gr');
    expect(isEuMemberState('EL')).toBe(true);
  });

  it('leaves the ISO code for Greece alone', () => {
    expect(normaliseCountry('GR')).toBe('gr');
    expect(isEuMemberState('GR')).toBe(true);
  });

  it('is exactly one alias, not a table somebody grew', () => {
    expect(Object.keys(NON_ISO_COUNTRY_CODE)).toEqual(['el']);
  });

  it('every alias resolves to a real member state', () => {
    for (const [from, to] of Object.entries(NON_ISO_COUNTRY_CODE)) {
      expect(EU_MEMBER_STATES).toContain(to);
      expect(EU_MEMBER_STATES).not.toContain(from);
    }
  });

  // 🔴 `UK` is the other famous Eurostat spelling and it is NOT here,
  // because the United Kingdom is not a member state. An alias table is
  // a translation of names, never a widening of the list.
  it.each(['uk', 'gb', 'ch', 'no'])('still refuses %s', (code) => {
    expect(isEuMemberState(code)).toBe(false);
  });

  // 🔴 The two alias tables stay separate and disjoint. Åland is a
  // subdivision of a member state; Greece is a member state under
  // another spelling. Merging them would make either name a lie about
  // half its contents.
  it('does not overlap the subdivision table', () => {
    for (const k of Object.keys(NON_ISO_COUNTRY_CODE)) {
      expect(ISO_SUBDIVISION_OF).not.toHaveProperty(k);
    }
  });

  // 🔴 And it stays OUT of the SQL list, deliberately. That list exists
  // for Natural Earth, which emits subdivision codes and never `EL`;
  // the bathing water importer normalises in TypeScript long before any
  // SQL sees a country. Adding `el` there would change route-POI
  // behaviour on no evidence at all.
  it('is not in the SQL membership list', () => {
    expect(EU_MEMBER_STATES_AND_SUBDIVISIONS).not.toContain('el');
  });
});
