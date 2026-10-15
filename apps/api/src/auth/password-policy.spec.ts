import {
  COMMON_PASSWORDS,
  MAX_LENGTH,
  MIN_LENGTH,
  checkNewPassword,
} from './password-policy';

// CAMP-228 — what a new password must satisfy: length, and not the commonest.
//
// The numbers 10 and 128 are written out in the expectations, not read back
// from the constants: a test that builds "one short of the minimum" from
// MIN_LENGTH moves with a mutation of MIN_LENGTH and stays green.

const EMAIL = 'anna.camper@example.com';
const ok = (p: string) => checkNewPassword(p, EMAIL);

describe('length', () => {
  it('refuses nine characters and accepts ten', () => {
    expect(ok('k7#vQ2!mX')).toBe('too-short');
    expect(ok('k7#vQ2!mXp')).toBeNull();
  });

  it('counts the way the hash does: NFKC, in code points', () => {
    // Distinct, because ten of one character is refused as "common" instead.
    const emoji = ['🌲', '🏕', '⛺', '🔥', '🚐', '🌄', '🦌', '🥾', '🧭', '🌙'];
    // Nine emoji are 18 UTF-16 units: a naive `.length` would pass them.
    expect(ok(emoji.slice(0, 9).join(''))).toBe('too-short');
    // Ten are 20 units and still ten characters — accepted, not refused.
    expect(ok(emoji.join(''))).toBeNull();
  });

  it('refuses a password the hash would fold into a common one', () => {
    // Full-width digits NFKC-normalise to 1234567890.
    expect(ok('１２３４５６７８９０')).toBe('common');
  });

  it('accepts 128 and refuses 129', () => {
    // Not a repeat of one character (which is "common") and not on the list.
    const of = (n: number) =>
      ('k7#vQ2!mXp' + 'abcdefghi'.repeat(20)).slice(0, n);
    expect(of(128)).toHaveLength(128);
    expect(ok(of(128))).toBeNull();
    expect(ok(of(129))).toBe('too-long');
  });

  it('treats a non-string as too short rather than throwing', () => {
    expect(checkNewPassword(undefined, EMAIL)).toBe('too-short');
    expect(checkNewPassword({ length: 99 }, EMAIL)).toBe('too-short');
  });
});

describe('the common ones', () => {
  it.each(['1234567890', 'qwertyuiop', 'password123', 'iloveyou123'])(
    'refuses %s',
    (p) => {
      expect(ok(p)).toBe('common');
    },
  );

  it('refuses them in any case, as a person would type them', () => {
    expect(ok('QWERTYUIOP')).toBe('common');
    expect(ok('Password123')).toBe('common');
  });

  it('refuses one character repeated, which no list could hold', () => {
    expect(ok('aaaaaaaaaa')).toBe('common');
    expect(ok('ββββββββββββ')).toBe('common');
    // …but not a password that merely repeats something longer.
    expect(ok('abababababab')).toBeNull();
  });

  it('does not refuse a password that only CONTAINS a common one', () => {
    expect(ok('password123-and-then-some-more')).toBeNull();
  });

  // The list is a floor written by hand, and what is checked about it is
  // what can be checked: every entry could ever match, and none is a typo
  // of the shape the lookup uses.
  it('holds only entries the lookup can reach: lower-case, at least 10 long', () => {
    expect(COMMON_PASSWORDS.size).toBeGreaterThan(30);
    for (const entry of COMMON_PASSWORDS) {
      expect([...entry].length).toBeGreaterThanOrEqual(10);
      expect(entry).toBe(entry.toLowerCase());
    }
  });
});

describe('the address is not a password', () => {
  it('refuses the whole address and the part before the @', () => {
    expect(ok('anna.camper@example.com')).toBe('is-email');
    expect(ok('Anna.Camper@Example.com')).toBe('is-email');
    expect(ok('anna.camper')).toBe('is-email');
  });

  it('does not refuse a password that merely resembles it', () => {
    expect(ok('anna.camper.2026!')).toBeNull();
  });
});

it('the two numbers are the documented ones', () => {
  expect(MIN_LENGTH).toBe(10);
  expect(MAX_LENGTH).toBe(128);
});
