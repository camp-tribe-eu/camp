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
