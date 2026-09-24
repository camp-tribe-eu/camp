import {
  accessibilityOf,
  communeOf,
  isCampsite,
  parseRow,
  starsOf,
  urlsOf,
  websiteOf,
} from './parse';

// CAMP-101 — the parser, against the shapes the real files actually have.
//
// 🔴 Every fixture below is copied from apps' own measurement of
// datatourisme-reg-pac.csv and -occ.csv on 23.09.2026, not invented. The
// packed fields are the whole risk here: three separators, several
// schemes sharing one column, and a guess that looks right in a code
// review and is wrong on 69 rows.

const CAMPSITE =
  'https://www.datatourisme.fr/ontology/core#PlaceOfInterest|https://www.datatourisme.fr/ontology/core#CampingAndCaravanning';

const row = (over: Record<string, string> = {}) => ({
  URI_ID_du_POI:
    'https://data.datatourisme.fr/13/eb3a71b4-4b02-347b-b088-e1566d0cd566',
  Nom_du_POI: 'Camping Port Pothuau',
  Categories_de_POI: CAMPSITE,
  Latitude: '43.120449',
  Longitude: '6.184928',
  Adresse_postale: '101 chemin des Ourlèdes Les Salins',
  Code_postal_et_commune: '83400#Hyères',
  Classements_du_POI:
    '4 étoiles#Classement officiel des hébergements touristiques',
  Date_de_mise_a_jour: '2026-08-28',
  Description:
    'Situé à 1 km de la mer, le camping bénéficie d’un paysage naturel.',
  Contacts_du_POI: '#https://www.campingportpothuau.com/',
  ...over,
});

describe('🔴 the star rating comes from the official scheme only', () => {
  it('reads the official classification', () => {
    expect(
      starsOf('4 étoiles#Classement officiel des hébergements touristiques'),
    ).toBe(4);
    expect(
      starsOf('1 étoile#Classement officiel des hébergements touristiques'),
    ).toBe(1);
  });

  // The case a number-only regex gets wrong. 69 campsites in PACA carry
  // this label in the same column.
  it('is not fooled by another scheme in the same field', () => {
    expect(starsOf('Accueil Vélo#France Vélo Tourisme')).toBeNull();
    expect(
      starsOf(
        'Accueil Vélo#France Vélo Tourisme|3 étoiles#Classement officiel des hébergements touristiques',
      ),
    ).toBe(3);
    // And the reverse order, so the answer does not depend on position.
    expect(
      starsOf(
        '3 étoiles#Classement officiel des hébergements touristiques|Accueil Vélo#France Vélo Tourisme',
      ),
    ).toBe(3);
  });

  it('refuses a rating with no scheme at all', () => {
    expect(starsOf('4 étoiles')).toBeNull();
  });

  it('refuses a number outside 1–5', () => {
    expect(
      starsOf('7 étoiles#Classement officiel des hébergements touristiques'),
    ).toBeNull();
    expect(
      starsOf('0 étoile#Classement officiel des hébergements touristiques'),
    ).toBeNull();
  });

  it('is empty when there is no classification', () => {
    expect(starsOf('')).toBeNull();
    expect(starsOf(undefined)).toBeNull();
  });
});

describe('the accessibility mark is a different scheme in the same column', () => {
  it('is read separately from the stars', () => {
    const field =
      '4 étoiles#Classement officiel des hébergements touristiques|Tourisme & Handicap auditif#Marque Tourisme et Handicap';
    expect(starsOf(field)).toBe(4);
    expect(accessibilityOf(field)).toEqual(['Tourisme & Handicap auditif']);
  });

  it('is empty when absent', () => {
    expect(accessibilityOf('Accueil Vélo#France Vélo Tourisme')).toEqual([]);
  });
});

describe('contacts', () => {
  it('reads the operator URL past the empty label', () => {
    expect(websiteOf('#https://www.closdebarbey.com/')).toBe(
      'https://www.closdebarbey.com/',
    );
  });

  // 🔴 Contacts are separated by `|` as well as `<>`. Splitting on `<>`
  // alone lost 418 campsites in Occitanie — website coverage read 47%
  // against 73% counted independently, and only that disagreement
  // exposed it. Both fixtures are real rows.
  it('reads contacts separated by a pipe, not only by <>', () => {
    expect(
      urlsOf(
        'CAMPING LE RANDONNEUR#https://www.campinglerandonneur.fr/|Mme Muriel CATALAN#https://www.campinglerandonneur.fr/',
      ),
    ).toHaveLength(2);
    expect(urlsOf('#https://a.example<>#https://b.example')).toHaveLength(2);
  });

  // 🔴 The case that would have sent readers into somebody else's
  // checkout: the tourist office lists the booking engine FIRST.
  it('skips a booking engine even when it is listed first', () => {
    expect(
      websiteOf(
        'C tout Vert#https://bookingpremium.secureholiday.net/fr/3532|Camping Municipal du Lauradiol#https://www.camping-lelauradiol.fr/',
      ),
    ).toBe('https://www.camping-lelauradiol.fr/');
    expect(
      websiteOf(
        '#https://www.campingportpothuau.com/<>https://campingportpothuau.premium.secureholiday.net/fr/4090/',
      ),
    ).toBe('https://www.campingportpothuau.com/');
  });

  it('stores nothing when every candidate is an aggregator', () => {
    expect(
      websiteOf('C Tout Vert#https://bookingpremium.secureholiday.net/fr/1'),
    ).toBeNull();
    expect(websiteOf('x#https://thelisresa.webcamp.fr/abc')).toBeNull();
  });

  // A chain's own domain IS the operator — 38 campsites are Capfun,
  // 12 are Huttopia. Excluding those would throw away real websites.
  it('keeps a chain domain, which is the operator', () => {
    expect(websiteOf('#https://europe.huttopia.com/site/foret-de-janas/')).toBe(
      'https://europe.huttopia.com/site/foret-de-janas/',
    );
    expect(websiteOf('#https://www.capfun.com/x')).toBe(
      'https://www.capfun.com/x',
    );
  });

  // 131 campsites list only a Facebook page. A page is not a website.
  it('does not call a social page a website', () => {
    expect(websiteOf('#https://www.facebook.com/campingx')).toBeNull();
  });

  it('is null when there is no URL', () => {
    expect(websiteOf('')).toBeNull();
    expect(websiteOf('#04 94 66 41 17')).toBeNull();
    expect(websiteOf(undefined)).toBeNull();
  });
});

describe('the commune column holds two values', () => {
  it('splits postcode from commune', () => {
    expect(communeOf('83400#Hyères')).toEqual({
      postcode: '83400',
      commune: 'Hyères',
    });
  });

  it('keeps a commune with no postcode', () => {
    expect(communeOf('Hyères')).toEqual({ postcode: null, commune: 'Hyères' });
  });

  it('refuses something that is not a French postcode', () => {
    expect(communeOf('ABC#Hyères').postcode).toBeNull();
  });

  it('survives an empty field', () => {
    expect(communeOf('')).toEqual({ postcode: null, commune: null });
  });
});

describe('what counts as a campsite', () => {
  it('accepts the two categories the source uses', () => {
    expect(isCampsite({ Categories_de_POI: CAMPSITE })).toBe(true);
    expect(isCampsite({ Categories_de_POI: 'x#HotellerieDePleinAir' })).toBe(
      true,
    );
  });

  it('rejects everything else', () => {
    expect(isCampsite({ Categories_de_POI: 'x#Restaurant' })).toBe(false);
    expect(isCampsite({})).toBe(false);
  });
});

describe('parseRow', () => {
  it('turns a real row into a spot', () => {
    const spot = parseRow(row())!;
    expect(spot.name).toBe('Camping Port Pothuau');
    expect(spot.stars).toBe(4);
    expect(spot.lat).toBeCloseTo(43.120449);
    expect(spot.commune).toBe('Hyères');
    expect(spot.website).toBe('https://www.campingportpothuau.com/');
    expect(spot.updatedAt).toBe('2026-08-28');
  });

  it('refuses a row that is not a campsite', () => {
    expect(parseRow(row({ Categories_de_POI: 'x#Restaurant' }))).toBeNull();
  });

  it('refuses a row with no name or no coordinates', () => {
    expect(parseRow(row({ Nom_du_POI: '' }))).toBeNull();
    expect(parseRow(row({ Latitude: '' }))).toBeNull();
    expect(parseRow(row({ Longitude: 'not a number' }))).toBeNull();
  });

  // 🔴 The licence condition, enforced as a parser rule rather than
  // remembered as a paragraph.
  it('refuses a row with no usable update date', () => {
    expect(parseRow(row({ Date_de_mise_a_jour: '' }))).toBeNull();
    expect(parseRow(row({ Date_de_mise_a_jour: '28/08/2026' }))).toBeNull();
    expect(parseRow(row({ Date_de_mise_a_jour: '2026' }))).toBeNull();
  });

  it('refuses coordinates that cannot be in France', () => {
    // The classic missing value written as a number.
    expect(parseRow(row({ Latitude: '0', Longitude: '0' }))).toBeNull();
    // Croatia, which would put a French record on the wrong map.
    expect(parseRow(row({ Latitude: '45.1', Longitude: '14.5' }))).toBeNull();
  });

  it('keeps a campsite that simply has no stars', () => {
    // Nearly half of Occitanie. Absent is not the same as bad, and a
    // parser that dropped them would throw away 47% of the region.
    const spot = parseRow(row({ Classements_du_POI: '' }))!;
    expect(spot).not.toBeNull();
    expect(spot.stars).toBeNull();
  });

  it('keeps a campsite with no description', () => {
    const spot = parseRow(row({ Description: '' }))!;
    expect(spot.description).toBeNull();
  });
});
