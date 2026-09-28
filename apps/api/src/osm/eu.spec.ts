import {
  EU_MEMBER_STATES,
  EU_MEMBER_STATES_AND_SUBDIVISIONS,
  ISO_SUBDIVISION_OF,
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
