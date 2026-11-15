import {
  AddressLimiter,
  PER_ADDRESS_PER_DAY,
  emailDomain,
  hostOfUrl,
  isFreeMail,
  linkTokenHash,
  maskForClaim,
  newLinkToken,
  ownerBasis,
  registrable,
  spotDomains,
  typedEmail,
} from './owner-email';

// CAMP-505 — правила «чи може ця адреса довести володіння кемпінгом».
//
// 🔴 КОЖЕН ВИПАДОК НИЖЧЕ ПРОВЕДЕНО ЧЕРЕЗ МУТАЦІЮ (див. опис PR): зламано
// правило — і саме цей випадок червоніє. Корпус тут — це чужі домени, які
// ВОРОЖІ до правила, а не повторення самого правила.

const camp = (
  website: string | null,
  contact: Record<string, unknown> = {},
) => ({
  website,
  contact,
});

describe('registrable domain (eTLD+1, with the private part of the PSL)', () => {
  it.each([
    ['www.camping-alpenblick.de', 'camping-alpenblick.de'],
    ['mail.camping-alpenblick.de', 'camping-alpenblick.de'],
    ['camping.co.uk', 'camping.co.uk'],
    ['www.camping.co.uk', 'camping.co.uk'],
    ['CAMPING.de.', 'camping.de'],
    ['plage.com.fr', 'plage.com.fr'],
  ])('%s -> %s', (host, want) => {
    expect(registrable(host)).toBe(want);
  });

  it('🔴 two blogspot sites are NOT the same domain (private suffix)', () => {
    // ICANN-only reading gives `blogspot.com` for both, and the owner of
    // one blog would confirm every campsite hosted on blogspot.
    expect(registrable('a.blogspot.com')).toBe('a.blogspot.com');
    expect(registrable('b.blogspot.com')).toBe('b.blogspot.com');
    expect(registrable('a.blogspot.com')).not.toBe(
      registrable('b.blogspot.com'),
    );
  });

  it('🔴 two co.uk sites are not the same domain (last-two-labels is wrong)', () => {
    expect(registrable('a.co.uk')).not.toBe(registrable('b.co.uk'));
  });

  it.each(['', '   ', 'localhost', '127.0.0.1', '[::1]'])(
    'refuses %j (no registrable domain)',
    (host) => {
      expect(registrable(host)).toBeNull();
    },
  );
});

describe('hostOfUrl', () => {
  it.each([
    ['https://www.camp.de/en?x=1', 'www.camp.de'],
    ['http://camp.de', 'camp.de'],
    ['www.camp.de', 'www.camp.de'],
    ['camp.de/path', 'camp.de'],
    ['camp.de:8080/x', 'camp.de'],
  ])('%s -> %s', (raw, want) => expect(hostOfUrl(raw)).toBe(want));

  it.each(['', 'javascript:alert(1)', 'ftp://camp.de', 'mailto:a@b.de'])(
    'refuses %j',
    (raw) => expect(hostOfUrl(raw)).toBeNull(),
  );
});

describe('typed address', () => {
  it('trims and lower-cases', () => {
    expect(typedEmail('  Info@Camp.DE ')).toBe('info@camp.de');
  });

  it.each([
    'a@b.de, c@d.de',
    'a@b.de;c@d.de',
    'Name <a@b.de>',
    '"a"@b.de',
    'a@b.de\r\nBcc: x@y.de',
    'a b@c.de',
    'no-at.de',
    'a@b',
    '',
    null,
    undefined,
    42,
    ['a@b.de'],
  ])('🔴 refuses %j (would become two recipients or none)', (v) => {
    expect(typedEmail(v)).toBeNull();
  });
});

describe('free-mail providers', () => {
  it.each([
    'gmail.com',
    'googlemail.com',
    'outlook.com',
    'hotmail.com',
    'gmx.de',
    'gmx.at',
    'web.de',
    'orange.fr',
    'wanadoo.fr',
    'libero.it',
    'wp.pl',
    'seznam.cz',
    't-online.de',
    'telenet.be',
    'yahoo.com',
    // Not in the explicit list: caught by the label rule.
    'yahoo.com.br',
    'hotmail.gr',
    'outlook.sk',
    'live.nl',
    'gmx.pt',
  ])('%s is free mail', (d) => expect(isFreeMail(d)).toBe(true));

  it.each(['camping-alpenblick.de', 'camp.co.uk', 'mailhouse-camping.de'])(
    '%s is not',
    (d) => expect(isFreeMail(d)).toBe(false),
  );
});

describe('what a campsite says about itself', () => {
  it('takes the website from the column and from contact', () => {
    const d = spotDomains(
      camp('https://www.alpenblick.de', {
        website: 'https://alpenblick-camping.at',
        email: 'info@booking-agency.com',
      }),
    );
    expect([...d].sort()).toEqual(['alpenblick-camping.at', 'alpenblick.de']);
  });

  it('🔴 the domain of a contact EMAIL is not the campsite’s domain', () => {
    // An agency or a provider: `info@booking-agency.com` is a contact, not
    // proof that everyone at booking-agency.com runs the campsite.
    const d = spotDomains(camp(null, { email: 'info@booking-agency.com' }));
    expect(d.size).toBe(0);
  });

  it('🔴 never lists a mail provider or a shared platform as the campsite’s own domain', () => {
    const d = spotDomains(
      camp('https://www.facebook.com/alpenblick', {
        website: 'https://sites.google.com/view/alpenblick',
        email: 'alpenblick@gmail.com',
      }),
    );
    expect(d.size).toBe(0);
  });
});

describe('ownerBasis: the one decision', () => {
  const spot = camp('https://www.camping-alpenblick.de/', {
    email: 'info@camping-alpenblick.de;booking@reservierung-partner.com',
  });

  it('same registered domain as the website → website-domain', () => {
    expect(ownerBasis(spot, 'chef@camping-alpenblick.de')).toBe(
      'website-domain',
    );
  });

  it('a subdomain of the registered domain counts', () => {
    expect(ownerBasis(spot, 'chef@mail.camping-alpenblick.de')).toBe(
      'website-domain',
    );
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(ownerBasis(spot, '  Chef@Camping-Alpenblick.DE ')).toBe(
      'website-domain',
    );
  });

  it('the listed address word for word, on a domain that is not the website’s → listed-email', () => {
    expect(ownerBasis(spot, 'booking@reservierung-partner.com')).toBe(
      'listed-email',
    );
    expect(ownerBasis(spot, 'Booking@Reservierung-Partner.com')).toBe(
      'listed-email',
    );
  });

  it('🔴 another mailbox on the listed address’s domain gets nothing (only that address)', () => {
    expect(ownerBasis(spot, 'anyone@reservierung-partner.com')).toBeNull();
  });

  it('🔴 a campsite with only a listed email accepts that address and no other at its domain', () => {
    const s = camp(null, { email: 'info@alpenblick.de' });
    expect(ownerBasis(s, 'info@alpenblick.de')).toBe('listed-email');
    expect(ownerBasis(s, 'x@alpenblick.de')).toBeNull();
  });

  it('🔴 a stranger on a different domain gets nothing', () => {
    expect(ownerBasis(spot, 'someone@elsewhere.de')).toBeNull();
  });

  it.each([
    'chef@evil-camping-alpenblick.de',
    'chef@camping-alpenblick.de.evil.com',
    'chef@camping-alpenblick.com',
    'chef@xcamping-alpenblick.de',
    'chef@camping-alpenblick.de@evil.com',
  ])('🔴 look-alike %s gets nothing (substring is not a match)', (email) => {
    expect(ownerBasis(spot, email)).toBeNull();
  });

  it('🔴 gmail gets nothing even when it is word for word the listed contact', () => {
    const s = camp(null, { email: 'camping.alpenblick@gmail.com' });
    expect(ownerBasis(s, 'camping.alpenblick@gmail.com')).toBeNull();
  });

  it('🔴 gmail gets nothing even when the campsite’s “website” is gmail.com', () => {
    const s = camp('https://gmail.com', {});
    expect(ownerBasis(s, 'anyone@gmail.com')).toBeNull();
  });

  it.each([
    'a@gmx.de',
    'a@orange.fr',
    'a@outlook.com',
    'a@hotmail.it',
    'a@yahoo.co.uk',
    'a@t-online.de',
    'a@web.de',
  ])(
    '🔴 free provider %s never qualifies, whatever the campsite lists',
    (email) => {
      const domain = emailDomain(email)!;
      const s = camp(`https://${domain}`, {
        email,
        website: `https://${domain}`,
      });
      expect(ownerBasis(s, email)).toBeNull();
    },
  );

  it('🔴 a shared platform never qualifies', () => {
    const s = camp('https://www.facebook.com/alpenblick', {});
    expect(ownerBasis(s, 'x@facebook.com')).toBeNull();
  });

  it('🔴 two sites on one private suffix do not unlock each other', () => {
    const s = camp('https://alpenblick.blogspot.com', {});
    expect(ownerBasis(s, 'me@other.blogspot.com')).toBeNull();
  });

  it('🔴 a campsite with no site and no contact accepts nobody', () => {
    expect(ownerBasis(camp(null, {}), 'chef@camping-alpenblick.de')).toBeNull();
    expect(ownerBasis({ website: null, contact: null }, 'a@b.de')).toBeNull();
  });

  it('🔴 a malformed typed address accepts nobody', () => {
    expect(
      ownerBasis(spot, 'chef@camping-alpenblick.de, evil@x.de'),
    ).toBeNull();
    expect(ownerBasis(spot, 'camping-alpenblick.de')).toBeNull();
    expect(ownerBasis(spot, undefined)).toBeNull();
  });
});

describe('mask the database will accept', () => {
  it('masks a normal address', () => {
    expect(maskForClaim('info@camp.de')).toBe('i***@c***.de');
  });

  it('🔴 refuses a suffix the CHECK constraint would reject (instead of a 500 on INSERT)', () => {
    expect(maskForClaim('info@camp.xn--p1ai')).toBeNull();
    expect(maskForClaim('info@camp.c0m')).toBeNull();
  });
});

describe('link token', () => {
  it('is 256 bits of base64url and unique', () => {
    const a = newLinkToken();
    const b = newLinkToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('🔴 the stored value is a 64-hex hash and is not the token', () => {
    const t = newLinkToken();
    const h = linkTokenHash(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(t);
    expect(linkTokenHash(t)).toBe(h);
    expect(linkTokenHash(t + 'x')).not.toBe(h);
  });
});

describe('per-address limiter (memory only)', () => {
  it(`lets ${PER_ADDRESS_PER_DAY} through and refuses the next`, () => {
    const l = new AddressLimiter();
    for (let i = 0; i < PER_ADDRESS_PER_DAY; i++)
      expect(l.take('a@camp.de', 1000)).toBe(true);
    expect(l.take('a@camp.de', 1000)).toBe(false);
  });

  it('🔴 counts the address as written once folded, not as spelled', () => {
    const l = new AddressLimiter(1);
    expect(l.take('Info@Camp.de', 0)).toBe(true);
    expect(l.take('info@camp.DE', 0)).toBe(false);
  });

  it('is per address', () => {
    const l = new AddressLimiter(1);
    expect(l.take('a@camp.de', 0)).toBe(true);
    expect(l.take('b@camp.de', 0)).toBe(true);
  });

  it('frees the address when the window passes', () => {
    const l = new AddressLimiter(1, 1000);
    expect(l.take('a@camp.de', 0)).toBe(true);
    expect(l.take('a@camp.de', 999)).toBe(false);
    expect(l.take('a@camp.de', 1001)).toBe(true);
  });

  it('🔴 holds no raw address, and its memory is bounded', () => {
    const l = new AddressLimiter(1, 1000, 100);
    for (let i = 0; i < 500; i++) l.take(`u${i}@camp.de`, i);
    expect(l.size()).toBeLessThanOrEqual(100);
    expect(JSON.stringify([...(l as any).seen.keys()])).not.toContain('@');
  });
});
