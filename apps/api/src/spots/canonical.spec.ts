import { canonicalPath, readAmenities, slugifyRegion } from './canonical';
import { AMENITY_KEYS, AmenityValue } from '../osm/tag-mapping';

// 🔴 The rule CAMP-87 is built on: a URL, once published, does not move.
//
// Nothing enforced that. `canonicalPath` and `slugifyRegion` decide every
// campsite address on the site, and the audit on 22.09.2026 measured the
// whole query layer at 0% unit coverage — these two included. A change
// here does not fail anything loudly; it quietly re-points a thousand
// pages, and the damage shows up months later as lost rankings.

describe('slugifyRegion', () => {
  it('strips the accents Croatian and Slovenian region names are full of', () => {
    // Real regions from the dataset, not invented examples.
    expect(slugifyRegion('Šibensko-Kninska')).toBe('sibensko-kninska');
    expect(slugifyRegion('Primorsko-Goranska')).toBe('primorsko-goranska');
    expect(slugifyRegion('Medimurska')).toBe('medimurska');
    expect(slugifyRegion('Ljutomer')).toBe('ljutomer');
  });

  it('collapses every run of punctuation and space into one hyphen', () => {
    expect(slugifyRegion('Dubrovacko - Neretvanska')).toBe(
      'dubrovacko-neretvanska',
    );
    expect(slugifyRegion('Mestna obcina  Ljubljana')).toBe(
      'mestna-obcina-ljubljana',
    );
  });

  it('never leaves a leading or trailing hyphen', () => {
    expect(slugifyRegion('  Bovec  ')).toBe('bovec');
    expect(slugifyRegion('—Brda—')).toBe('brda');
  });

  it('returns an empty string for no region, rather than a bare hyphen', () => {
    // 🔴 The caller must not publish this. An empty segment gives
    // /camping/si//slug, which is a different URL from every other page
    // and resolves to nothing — better to have no page than a broken one.
    expect(slugifyRegion(null)).toBe('');
    expect(slugifyRegion('')).toBe('');
    expect(slugifyRegion('---')).toBe('');
  });

  it('is idempotent: slugifying a slug changes nothing', () => {
    // The import stores the region name and the URL is derived on read,
    // so this runs on values that may already have been through it.
    for (const r of ['Šibensko-Kninska', 'Bovec', 'Mestna obcina Ljubljana']) {
      expect(slugifyRegion(slugifyRegion(r))).toBe(slugifyRegion(r));
    }
  });
});

describe('canonicalPath', () => {
  it('builds the one address a campsite has', () => {
    expect(canonicalPath('SI', 'Bovec', 'camp-bovec')).toBe(
      '/camping/si/bovec/camp-bovec',
    );
  });

  it('lowercases the country, whatever case the database holds', () => {
    // The column stores ISO codes uppercase; the URL is lowercase.
    expect(canonicalPath('HR', 'Zadarska', 'x')).toBe('/camping/hr/zadarska/x');
    expect(canonicalPath('hr', 'Zadarska', 'x')).toBe('/camping/hr/zadarska/x');
  });

  it('never rewrites the slug', () => {
    // 🔴 The slug is assigned once, on first insert, and is the part that
    // must survive an OSM rename. Normalising it here would move every
    // URL that already contains a character this function does not like.
    expect(canonicalPath('si', 'Bovec', 'spot-a702234012')).toContain(
      'spot-a702234012',
    );
    expect(canonicalPath('si', 'Bovec', 'camp-kovac')).toContain('camp-kovac');
  });
});

describe('readAmenities', () => {
  it('fills in every key, so callers never see a missing property', () => {
    const a = readAmenities({ shower: 'yes' });
    expect(a.shower).toBe(AmenityValue.YES);
    // 🔴 Added later than the rows in the database. Before this function
    // was shared, the page said "unknown" for such a key while the map
    // endpoint returned a set without the key at all — two shapes of the
    // same data, differing exactly on the newest amenity.
    expect(a.toilets).toBe(AmenityValue.UNKNOWN);
    // 🔴 Compared against AMENITY_KEYS rather than a list written out
    // here. The hand-written version failed the day CAMP-35 added four
    // amenities — not because anything was broken, but because the test
    // held a second copy of the list. A copy that has to be edited every
    // time the real one changes is not testing agreement, it is testing
    // whether somebody remembered.
    expect(Object.keys(a).sort()).toEqual([...AMENITY_KEYS].sort());
  });

  it('reads an unrecognised value as unknown, never as no', () => {
    // A row written before the three-state change could hold a boolean.
    const a = readAmenities({ shower: true, water: 'maybe', wifi: null });
    expect(a.shower).toBe(AmenityValue.UNKNOWN);
    expect(a.water).toBe(AmenityValue.UNKNOWN);
    expect(a.wifi).toBe(AmenityValue.UNKNOWN);
  });

  it('keeps an explicit no', () => {
    expect(readAmenities({ toilets: 'no' }).toilets).toBe(AmenityValue.NO);
  });

  it('survives null, undefined and rubbish', () => {
    for (const input of [null, undefined, 42, 'nonsense']) {
      const a = readAmenities(input);
      expect(a.electricity).toBe(AmenityValue.UNKNOWN);
    }
  });
});

// CAMP-127: the URL that was never a URL.
//
// 🔴 This returned `/camping/cy//arazi` — a double slash, a 404, and a
// link the map was handing out. Measured 24.09.2026: 135 campsites carry
// no region, every one of them with a broken link, 36 of those on Cyprus
// where the boundary file gives no ISO code (CAMP-125).
//
// A campsite with no region has no page, because CAMP-34 builds the page
// URL from the region. The pin stays on the map — the location is real —
// but the link goes, because it was never a link.
describe('a campsite with no page gets no address', () => {
  it.each([null, '', '   ', '!!!'])(
    'region %p yields null, not a path with a hole in it',
    (region) => {
      expect(canonicalPath('CY', region as string | null, 'arazi')).toBeNull();
    },
  );

  it('and so does a missing country or slug', () => {
    expect(canonicalPath('', 'Vendée', 'x')).toBeNull();
    expect(canonicalPath('FR', 'Vendée', '')).toBeNull();
  });

  it('a real one is unchanged, because CAMP-87 forbids moving it', () => {
    expect(canonicalPath('FR', 'Vendée', 'camping-du-lac')).toBe(
      '/camping/fr/vendee/camping-du-lac',
    );
  });

  it('never produces a double slash, whatever it is given', () => {
    for (const region of [null, '', '-', '///', 'Šibensko-Kninska']) {
      const path = canonicalPath('HR', region as string | null, 'x');
      if (path !== null) expect(path).not.toContain('//');
    }
  });
});
