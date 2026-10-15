import { isPlausibleEmail, normalizeEmail } from './email';

// CAMP-228 — one spelling of an address for every door.
//
// Every expectation below is a literal. The first draft of a test like this
// builds its expected value by calling the function it is checking.

describe('normalizeEmail', () => {
  it('trims and lower-cases, so every door looks the same account up', () => {
    expect(normalizeEmail('  Anna@Example.COM  ')).toBe('anna@example.com');
  });

  it('keeps everything else, including a + tag and dots', () => {
    expect(normalizeEmail('Anna.O+Camp@Example.com')).toBe(
      'anna.o+camp@example.com',
    );
  });

  it.each([undefined, null, 42, {}, ['a@b.co']])(
    'turns %p into the empty string, which is never plausible',
    (value) => {
      expect(normalizeEmail(value)).toBe('');
      expect(isPlausibleEmail(normalizeEmail(value))).toBe(false);
    },
  );
});

describe('isPlausibleEmail', () => {
  it.each([
    'a@b.co',
    'anna+camp@example.com',
    "o'neil@example.co.uk",
    'info@camping-du-lac.fr',
    'anna@mail.example.org',
    // International domains and local parts are people too.
    'jürgen@münchen.de',
  ])('accepts %s', (email) => {
    expect(isPlausibleEmail(email)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['no @', 'anna.example.com'],
    ['two @', 'a@b@example.com'],
    ['empty local part', '@example.com'],
    ['empty domain', 'anna@'],
    ['no dot in the domain', 'anna@localhost'],
    ['leading dot in the domain', 'anna@.example.com'],
    ['empty label in the domain', 'anna@example..com'],
    ['trailing dot', 'anna@example.'],
    ['a space inside', 'an na@example.com'],
    ['a tab', 'anna@exa\tmple.com'],
    // The line break is the point: in a header it starts a new header. One
    // @ only, and a dot in the domain part, so the OTHER rules pass and only
    // the control-character rule can refuse it (the first draft carried a
    // second @ and was refused for that instead).
    ['a line break (header injection)', 'anna@example.com\nBcc: x'],
    ['a carriage return', 'anna@example.com\rBcc: x'],
    ['a NUL', 'anna@exam\u0000ple.com'],
  ])('refuses %s', (_why, email) => {
    expect(isPlausibleEmail(email)).toBe(false);
  });

  // RFC 5321: 64 octets of local part, 254 in the whole address. Both edges,
  // from each side, because an off-by-one hides in exactly one of them.
  const label = (n: number) => 'd'.repeat(n);
  it('accepts a 64-character local part and refuses 65', () => {
    expect(isPlausibleEmail(`${'a'.repeat(64)}@example.com`)).toBe(true);
    expect(isPlausibleEmail(`${'a'.repeat(65)}@example.com`)).toBe(false);
  });

  it('accepts an address of exactly 254 characters and refuses 255', () => {
    const at254 = `${'a'.repeat(64)}@${label(61)}.${label(61)}.${label(61)}.com`;
    const at255 = `${'a'.repeat(64)}@${label(62)}.${label(61)}.${label(61)}.com`;
    expect(at254).toHaveLength(254);
    expect(at255).toHaveLength(255);
    expect(isPlausibleEmail(at254)).toBe(true);
    expect(isPlausibleEmail(at255)).toBe(false);
  });
});
