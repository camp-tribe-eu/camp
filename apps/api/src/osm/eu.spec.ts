import { EU_MEMBER_STATES, isEuMemberState } from './eu';

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
