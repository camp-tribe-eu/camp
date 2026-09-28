import {
  parseBathingFeature,
  readProfileUrl,
  STATUS_OF_SOURCE_VALUE,
  type BathingFeatureAttributes,
  type BathingRejectReason,
} from './parse';
import {
  BATHING_SEASON,
  BATHING_STATUSES,
  BATHING_STATUS_SOURCE_VALUES,
} from './source';

// CAMP-168. Every test here fails if the line it covers is removed —
// checked by mutation, one at a time, and the mutations are named in the
// pull request. A test that passes over a deleted guard is the failure
// this repository has now found four times.

/** A feature exactly as the layer returns one. Overridden per test. */
function feature(
  over: Partial<BathingFeatureAttributes> = {},
): BathingFeatureAttributes {
  return {
    bathingWaterIdentifier: 'FRP01000001',
    bathingWaterName: 'PLAGE DU SILLON',
    countryCode: 'FR',
    EU27: 'EU-27',
    bwWaterCategory: 'Coastal',
    bwProfileLink: 'https://baignades.sante.gouv.fr/x',
    qualityStatus: 'Excellent',
    latitude: 48.6512,
    longitude: -2.0221,
    ...over,
  };
}

function refuse(attrs: BathingFeatureAttributes): BathingRejectReason[] {
  const reasons: BathingRejectReason[] = [];
  parseBathingFeature(attrs, BATHING_SEASON, (r) => reasons.push(r));
  return reasons;
}

describe('parseBathingFeature', () => {
  it('reads a whole feature into a storable record', () => {
    const r = parseBathingFeature(feature());
    expect(r).toEqual({
      ref: 'FRP01000001',
      name: 'PLAGE DU SILLON',
      country: 'fr',
      category: 'Coastal',
      season: BATHING_SEASON,
      status: 'excellent',
      profileUrl: 'https://baignades.sante.gouv.fr/x',
      lat: 48.6512,
      lon: -2.0221,
    });
  });

  // 🔴 THE ONE THAT COSTS A COUNTRY.
  //
  // The EEA labels Greece `EL` (Eurostat/NUTS). ISO 3166-1 calls it `GR`
  // and leaves `EL` unassigned, so `isEuMemberState('EL')` is a
  // confident no — and 1 734 of the layer's 22 010 EU-27 sites are
  // Greek. Without the alias in eu.ts this is a silent 8% data loss that
  // looks, in any summary, like Greece having no bathing waters.
  it("accepts Greece under the source's Eurostat code EL", () => {
    const r = parseBathingFeature(feature({ countryCode: 'EL' }));
    expect(r).not.toBeNull();
    expect(r!.country).toBe('gr');
  });

  it('accepts Greece under the ISO code too, if the source ever changes', () => {
    expect(parseBathingFeature(feature({ countryCode: 'GR' }))!.country).toBe(
      'gr',
    );
  });

  // 🔴 The alias must not become a door. It resolves one code; it does
  // not admit a non-member because somebody spelled it oddly.
  it.each(['CH', 'AL', 'GB', 'UK', 'NO', 'XX', ''])(
    'still refuses %s as a country',
    (code) => {
      expect(refuse(feature({ countryCode: code }))).toEqual([
        'unknown-country',
      ]);
    },
  );

  it('refuses a record the source does not flag EU-27', () => {
    expect(refuse(feature({ EU27: '' }))).toEqual(['not-eu27']);
  });

  // 🔴 Both gates, not one. The source's own flag and our membership
  // list must agree; a record flagged EU-27 with a country we do not
  // serve is a contradiction we refuse rather than resolve.
  it('refuses a record flagged EU-27 whose country we do not serve', () => {
    expect(refuse(feature({ EU27: 'EU-27', countryCode: 'CH' }))).toEqual([
      'unknown-country',
    ]);
  });

  it.each([
    ['no-ref', { bathingWaterIdentifier: '  ' }],
    ['no-name', { bathingWaterName: null }],
    ['no-coordinates', { latitude: null }],
    ['no-coordinates', { longitude: 'not a number' }],
    ['coordinates-out-of-range', { latitude: 91 }],
    ['coordinates-out-of-range', { longitude: -181 }],
    ['unknown-status', { qualityStatus: 'Pretty good' }],
    ['unknown-status', { qualityStatus: null }],
  ] as [BathingRejectReason, Partial<BathingFeatureAttributes>][])(
    'refuses with %s',
    (reason, over) => {
      expect(refuse(feature(over))).toEqual([reason]);
    },
  );

  // 🔴 "Not classified" is a VALUE the EEA publishes for 611 EU-27
  // sites, not an absence. Coercing it to null, or refusing it, would
  // make those pages indistinguishable from an import that dropped them.
  it('keeps "Not classified" as a stored status', () => {
    const r = parseBathingFeature(feature({ qualityStatus: 'Not classified' }));
    expect(r!.status).toBe('not_classified');
  });

  it('maps every status the source publishes, and nothing else', () => {
    expect(Object.keys(STATUS_OF_SOURCE_VALUE).sort()).toEqual(
      [...BATHING_STATUS_SOURCE_VALUES].sort(),
    );
    expect(Object.values(STATUS_OF_SOURCE_VALUE).sort()).toEqual(
      [...BATHING_STATUSES].sort(),
    );
  });

  it('keeps the record when the profile link is missing', () => {
    const r = parseBathingFeature(feature({ bwProfileLink: null }));
    expect(r!.profileUrl).toBeNull();
    expect(r!.ref).toBe('FRP01000001');
  });

  it('falls back to Unknown rather than dropping a record with no category', () => {
    expect(
      parseBathingFeature(feature({ bwWaterCategory: null }))!.category,
    ).toBe('Unknown');
  });
});

describe('readProfileUrl', () => {
  // 9 736 of the 22 010 EU-27 links are plain http. They are kept: a
  // working insecure link to a national authority beats no link.
  it('keeps http and https', () => {
    expect(readProfileUrl('http://akm.gov.al/x')).toBe('http://akm.gov.al/x');
    expect(readProfileUrl('https://a.example/x')).toBe('https://a.example/x');
  });

  // 🔴 The value is free text typed by 27 administrations and it lands
  // in an href we serve.
  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>x</script>',
    'file:///etc/passwd',
    'not a url at all',
    '',
    '   ',
  ])('refuses %s', (v) => {
    expect(readProfileUrl(v)).toBeNull();
  });

  it('refuses a non-string', () => {
    expect(readProfileUrl(42)).toBeNull();
    expect(readProfileUrl(null)).toBeNull();
    expect(readProfileUrl(undefined)).toBeNull();
  });
});
