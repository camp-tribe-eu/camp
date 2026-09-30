import {
  domainOf,
  domainOfEmail,
  judgeByIdentity,
  upperBoundPercent,
} from './link-evidence';

describe('domainOf', () => {
  it('reads the domain out of a URL', () => {
    expect(domainOf('https://www.camping-du-lac.fr/tarifs')).toBe(
      'camping-du-lac.fr',
    );
  });

  it('treats subdomains of one business as that business', () => {
    expect(domainOf('https://reservation.camping-x.fr')).toBe('camping-x.fr');
    expect(domainOf('http://www.camping-x.fr')).toBe('camping-x.fr');
  });

  it('accepts a bare host, because sources publish them', () => {
    expect(domainOf('camping-x.fr')).toBe('camping-x.fr');
  });

  it('returns null for a host that says nothing about who it is', () => {
    // 🔴 Not "disagrees". A site built on a free host and a campsite's
    // own domain are not two businesses, and counting them as a
    // disagreement would inflate the measured error with cases that
    // carry no information at all.
    expect(domainOf('https://camping-x.jimdofree.com')).toBeNull();
    expect(domainOf('https://www.google.com/maps/place/x')).toBeNull();
  });

  it('keeps a chain operator, which DOES identify a business', () => {
    // Deliberately not neutral: capfun.com really is somebody, it is
    // just not always the same somebody as the campsite. Dropping it
    // would tune the check towards agreeing with the rule it checks.
    expect(domainOf('https://www.capfun.com/fr/camping')).toBe('capfun.com');
  });

  it('returns null rather than guessing at nonsense', () => {
    expect(domainOf('')).toBeNull();
    expect(domainOf(null)).toBeNull();
    expect(domainOf('localhost')).toBeNull();
    expect(domainOf('not a url at all')).toBeNull();
  });
});

describe('domainOfEmail', () => {
  it('reads the domain behind an address', () => {
    expect(domainOfEmail('info@col-ibardin.com')).toBe('col-ibardin.com');
  });

  it('ignores a free mailbox, which names a provider not a campsite', () => {
    expect(domainOfEmail('camping.x@wanadoo.fr')).toBeNull();
    expect(domainOfEmail('someone@gmail.com')).toBeNull();
  });

  it('returns null when there is no address', () => {
    expect(domainOfEmail(null)).toBeNull();
    expect(domainOfEmail('not-an-address')).toBeNull();
  });
});

describe('judgeByIdentity', () => {
  it('counts a shared domain as agreement', () => {
    expect(
      judgeByIdentity([
        {
          aWebsite: 'https://camping-x.fr',
          bWebsite: 'http://www.camping-x.fr/',
        },
      ]),
    ).toEqual({ agree: 1, disagree: 0, noEvidence: 0 });
  });

  it('matches an email on one side against a website on the other', () => {
    // 🔴 The axis that stops 1 437 pairs being reported as "no
    // evidence": OSM carries an email for many campsites and
    // DATAtourisme carries none, so the website-only check would find
    // something on one side of the pair and nothing on the other.
    expect(
      judgeByIdentity([
        {
          aWebsite: null,
          aEmail: 'info@col-ibardin.com',
          bWebsite: 'https://col-ibardin.com',
        },
      ]),
    ).toEqual({ agree: 1, disagree: 0, noEvidence: 0 });
  });

  it('counts any overlap as agreement, not every domain matching', () => {
    expect(
      judgeByIdentity([
        {
          aWebsite: 'https://camping-x.fr',
          aEmail: 'contact@camping-x.fr',
          bWebsite: 'https://camping-x.fr',
          bEmail: 'booking@agency.example',
        },
      ]),
    ).toEqual({ agree: 1, disagree: 0, noEvidence: 0 });
  });

  it('counts two businesses naming themselves differently as disagreement', () => {
    expect(
      judgeByIdentity([
        { aWebsite: 'https://campeole.com', bWebsite: 'https://sandaya.fr' },
      ]),
    ).toEqual({ agree: 0, disagree: 1, noEvidence: 0 });
  });

  it('counts a silent side as no evidence, never as agreement', () => {
    expect(
      judgeByIdentity([{ aWebsite: 'https://camping-x.fr', bWebsite: null }]),
    ).toEqual({ agree: 0, disagree: 0, noEvidence: 1 });
  });
});

describe('upperBoundPercent', () => {
  it('is the share of judgeable pairs that disagree', () => {
    expect(
      upperBoundPercent({ agree: 8, disagree: 2, noEvidence: 90 }),
    ).toBeCloseTo(20);
  });

  it('is null when nothing could be judged, not zero', () => {
    // 🔴 "No pair carried evidence" and "no pair disagreed" are opposite
    // facts. A checker that prints 0.0% for both is claiming a clean
    // result it never measured — the exact shape of a blind alarm.
    expect(
      upperBoundPercent({ agree: 0, disagree: 0, noEvidence: 40 }),
    ).toBeNull();
  });
});
