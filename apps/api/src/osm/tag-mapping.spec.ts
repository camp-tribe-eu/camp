import {
  AmenityValue,
  mapAmenities,
  mapSpotType,
  resolveAmenity,
} from './tag-mapping';

describe('CAMP-27 acceptance: synonyms land in the same filter', () => {
  // This is the exact case named in the card. If it ever breaks, the map
  // filter starts hiding real campsites and nobody notices for weeks.
  it('treats shower=yes and amenity=shower as the same thing', () => {
    expect(resolveAmenity('shower', { shower: 'yes' }).value).toBe(
      AmenityValue.YES,
    );
    expect(resolveAmenity('shower', { amenity: 'shower' }).value).toBe(
      AmenityValue.YES,
    );
  });

  it('reports which tag answered, so coverage can be tuned', () => {
    expect(resolveAmenity('shower', { amenity: 'shower' }).matchedBy).toBe(
      'amenity=shower',
    );
    expect(resolveAmenity('shower', { showers: 'yes' }).matchedBy).toBe(
      'showers=yes',
    );
  });
});

describe('missing tag is UNKNOWN, never NO', () => {
  // The whole reason this module exists. A boolean column would force
  // every unmapped site to claim "no shower", which we would then print on
  // the page as if we knew it.
  it('returns UNKNOWN when nothing says anything', () => {
    const amenities = mapAmenities({ tourism: 'camp_site', name: 'Nowhere' });
    expect(amenities.shower).toBe(AmenityValue.UNKNOWN);
    expect(amenities.electricity).toBe(AmenityValue.UNKNOWN);
    expect(amenities.water).toBe(AmenityValue.UNKNOWN);
    expect(amenities.wifi).toBe(AmenityValue.UNKNOWN);
    expect(amenities.dogFriendly).toBe(AmenityValue.UNKNOWN);
  });

  it('keeps UNKNOWN distinct from an explicit NO', () => {
    expect(resolveAmenity('shower', {}).value).toBe(AmenityValue.UNKNOWN);
    expect(resolveAmenity('shower', { shower: 'no' }).value).toBe(
      AmenityValue.NO,
    );
  });

  it('does not let one amenity answer for another', () => {
    // amenity=toilets says nothing about showers.
    expect(resolveAmenity('shower', { amenity: 'toilets' }).value).toBe(
      AmenityValue.UNKNOWN,
    );
  });

  it('treats an unseen value as unrecognised rather than guessing', () => {
    // Prompts a new rule; must not silently become NO.
    expect(resolveAmenity('shower', { shower: 'seasonal' }).value).toBe(
      AmenityValue.UNKNOWN,
    );
  });
});

describe('value vocabulary', () => {
  it.each([
    ['yes', AmenityValue.YES],
    ['1', AmenityValue.YES],
    ['true', AmenityValue.YES],
    ['designated', AmenityValue.YES],
    ['limited', AmenityValue.YES],
    ['customers', AmenityValue.YES],
    ['no', AmenityValue.NO],
    ['0', AmenityValue.NO],
    ['private', AmenityValue.NO],
  ])('reads shower=%s as %s', (raw, expected) => {
    expect(resolveAmenity('shower', { shower: raw }).value).toBe(expected);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(resolveAmenity('shower', { shower: '  YES ' }).value).toBe(
      AmenityValue.YES,
    );
  });

  it('ignores an empty tag value', () => {
    expect(resolveAmenity('shower', { shower: '' }).value).toBe(
      AmenityValue.UNKNOWN,
    );
  });
});

describe('per-amenity vocabularies', () => {
  it('counts dog=leashed as dog friendly', () => {
    // A leash is a condition, not a refusal - the dog may come.
    expect(resolveAmenity('dogFriendly', { dog: 'leashed' }).value).toBe(
      AmenityValue.YES,
    );
    expect(resolveAmenity('dogFriendly', { dog: 'no' }).value).toBe(
      AmenityValue.NO,
    );
  });

  it('counts internet_access=wlan as wifi but terminal as not wifi', () => {
    expect(resolveAmenity('wifi', { internet_access: 'wlan' }).value).toBe(
      AmenityValue.YES,
    );
    // A shared computer in reception is not wifi in the van.
    expect(resolveAmenity('wifi', { internet_access: 'terminal' }).value).toBe(
      AmenityValue.NO,
    );
  });

  it('accepts the caravan water-filling point as water', () => {
    expect(resolveAmenity('water', { water_point: 'yes' }).value).toBe(
      AmenityValue.YES,
    );
  });

  it('accepts power_supply as electricity', () => {
    expect(resolveAmenity('electricity', { power_supply: 'yes' }).value).toBe(
      AmenityValue.YES,
    );
  });
});

describe('values found on the real Slovenian extract (448 sites)', () => {
  // Each of these was an "unrecognised value" line in the coverage report
  // before the rule existed. They are here so the next refactor cannot
  // quietly give those sites back to "unknown".

  it('reads a socket name as electricity present', () => {
    // Naming the socket is a stronger yes than power_supply=yes.
    expect(
      resolveAmenity('electricity', { power_supply: 'cee_17_blue' }).value,
    ).toBe(AmenityValue.YES);
    expect(
      resolveAmenity('electricity', { power_supply: 'cee_blue' }).value,
    ).toBe(AmenityValue.YES);
  });

  it('splits semicolon-separated values', () => {
    expect(
      resolveAmenity('electricity', { power_supply: 'yes;cee_17_blue' }).value,
    ).toBe(AmenityValue.YES);
  });

  it('reads drinking_water=conditional as water available', () => {
    expect(
      resolveAmenity('water', { drinking_water: 'conditional' }).value,
    ).toBe(AmenityValue.YES);
  });

  it('still refuses to guess from a non-committal value', () => {
    // namedVariantMeansYes must not turn "I don't know" into "yes".
    expect(
      resolveAmenity('electricity', { power_supply: 'unknown' }).value,
    ).toBe(AmenityValue.UNKNOWN);
  });

  it('only says NO when every part of a multi-value says no', () => {
    expect(
      resolveAmenity('wifi', { internet_access: 'no;terminal' }).value,
    ).toBe(AmenityValue.NO);
    expect(resolveAmenity('wifi', { internet_access: 'no;wlan' }).value).toBe(
      AmenityValue.YES,
    );
  });
});

describe('spot type inference', () => {
  it('reads fee=no as free and fee=yes as paid', () => {
    expect(mapSpotType({ tourism: 'camp_site', fee: 'no' })).toMatchObject({
      type: 'free',
      confident: true,
    });
    expect(mapSpotType({ tourism: 'camp_site', fee: 'yes' })).toMatchObject({
      type: 'paid',
      confident: true,
    });
  });

  it('reads caravan sites as rv_park, and overnight parking as camper_stop', () => {
    expect(mapSpotType({ tourism: 'caravan_site' })).toMatchObject({
      type: 'rv_park',
      confident: true,
    });
    expect(
      mapSpotType({
        tourism: 'caravan_site',
        caravan_site: 'overnight_parking',
      }),
    ).toMatchObject({ type: 'camper_stop', confident: true });
  });

  it('reads backcountry and basic sites as wild', () => {
    expect(
      mapSpotType({ tourism: 'camp_site', backcountry: 'yes' }),
    ).toMatchObject({ type: 'wild', confident: true });
    expect(
      mapSpotType({ tourism: 'camp_site', camp_site: 'basic' }),
    ).toMatchObject({ type: 'wild', confident: true });
  });

  it('flags the fallback so guesses stay countable', () => {
    // The enum column is NOT NULL so we must pick something, but we refuse
    // to pretend the pick was informed.
    const result = mapSpotType({ tourism: 'camp_site' });
    expect(result.type).toBe('paid');
    expect(result.confident).toBe(false);
    expect(result.reason).toMatch(/defaulted/);
  });
});

// CAMP-32, added on the owner's call: "туалети дуже важливі, треба
// додавати точно бо людям без них ну ніяк". For a lot of people a site
// without toilets is simply not an option, which makes an honest
// "nobody wrote it down" worth more here than anywhere else.
describe('toilets', () => {
  it('reads the documented tag and the standalone object alike', () => {
    expect(resolveAmenity('toilets', { toilets: 'yes' }).value).toBe(
      AmenityValue.YES,
    );
    expect(resolveAmenity('toilets', { amenity: 'toilets' }).value).toBe(
      AmenityValue.YES,
    );
  });

  it('counts a named disposal method as a yes', () => {
    // Someone who wrote down how the waste is handled has seen a toilet.
    // Same reasoning as a named power socket being a stronger yes than
    // power_supply=yes.
    for (const how of ['flush', 'pitlatrine', 'chemical', 'bucket']) {
      expect(resolveAmenity('toilets', { 'toilets:disposal': how }).value).toBe(
        AmenityValue.YES,
      );
    }
  });

  it('reads toilets:disposal=none as an explicit NO', () => {
    // 🔴 The honest negative. This is a mapper stating there is nowhere
    // to go, which is exactly the fact the three-state model exists to
    // carry — and the one a camper most needs before arriving.
    expect(
      resolveAmenity('toilets', { 'toilets:disposal': 'none' }).value,
    ).toBe(AmenityValue.NO);
  });

  it('never invents an answer from a neighbouring tag', () => {
    expect(resolveAmenity('toilets', { shower: 'yes' }).value).toBe(
      AmenityValue.UNKNOWN,
    );
    // 🔴 A chemical-toilet disposal point is a place to EMPTY a toilet,
    // not a toilet. Treating it as one would tell a tent camper there is
    // a facility they cannot use.
    expect(
      resolveAmenity('toilets', { sanitary_dump_station: 'yes' }).value,
    ).toBe(AmenityValue.UNKNOWN);
  });

  it('is part of the full amenity set, not an afterthought', () => {
    // The set is built from AMENITY_KEYS; a key added to the type but
    // forgotten there would be missing from every imported row.
    expect(Object.keys(mapAmenities({}))).toContain('toilets');
    expect(mapAmenities({ toilets: 'yes' }).toilets).toBe(AmenityValue.YES);
  });
});

describe('toilets: values found on the real Croatian extract (1,189 sites)', () => {
  it('reads toilets=separated as a yes', () => {
    // Separate facilities for men and women. Not in the standard truthy
    // set, so it read as "unknown" until measured: 2 sites.
    expect(resolveAmenity('toilets', { toilets: 'separated' }).value).toBe(
      AmenityValue.YES,
    );
  });

  it('takes the accessibility tag as evidence that a toilet exists', () => {
    // 🔴 Including when it says "no". `toilets:wheelchair=no` means the
    // toilet is not wheelchair-accessible — reading that value as the
    // answer would turn the only evidence of a toilet into a denial of
    // one. Measured: the sole evidence on 8 sites.
    for (const v of ['yes', 'no', 'limited', 'designated']) {
      expect(resolveAmenity('toilets', { 'toilets:wheelchair': v }).value).toBe(
        AmenityValue.YES,
      );
    }
  });

  it('still lets an explicit toilets=no win, because it is more specific', () => {
    // Rule order matters: the direct tag is read first.
    expect(
      resolveAmenity('toilets', {
        toilets: 'no',
        'toilets:wheelchair': 'no',
      }).value,
    ).toBe(AmenityValue.NO);
  });

  it('ignores an empty tag value rather than reading it as presence', () => {
    expect(
      resolveAmenity('toilets', { 'toilets:wheelchair': '  ' }).value,
    ).toBe(AmenityValue.UNKNOWN);
  });
});

describe('toilets: which tag wins when they disagree', () => {
  it('reads a direct statement before an inference', () => {
    // 🔴 `toilets:disposal=none` is a mapper saying there is nowhere to
    // go. `toilets:wheelchair` only implies a toilet exists because
    // someone described its accessibility. When a site carries both, the
    // direct statement decides — otherwise the weaker signal would
    // silently overrule the stronger one.
    expect(
      resolveAmenity('toilets', {
        'toilets:disposal': 'none',
        'toilets:wheelchair': 'yes',
      }).value,
    ).toBe(AmenityValue.NO);
  });

  it('names the tag that decided, so coverage stays auditable', () => {
    expect(
      resolveAmenity('toilets', { 'toilets:wheelchair': 'no' }).matchedBy,
    ).toBe('toilets:wheelchair');
  });
});
