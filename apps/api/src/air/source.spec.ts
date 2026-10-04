import { isEuMemberState } from '../osm/eu';
import {
  AIR_ATTRIBUTION,
  AIR_SOURCE_CREDIT,
  EEA_REUSE_SENTENCE,
  AIR_BAND_LABELS,
  AIR_BASES,
  AIR_BLOB_BASE,
  AIR_CADENCE,
  AIR_FRESH_FOR_HOURS,
  AIR_KNOWN_OUTSIDE_EU27,
  AIR_RASTER_BATCH,
  AIR_RASTER_SENTINEL,
  AIR_RASTER_URL,
  AIR_ROSTER_INDEX_URL,
  airStationUrl,
} from './source';

// CAMP-164: the facts about the source, pinned so the comments above
// them cannot stop describing the code without a test saying so.

describe('the countries this endpoint emits', () => {
  // 🔴 The "outside the Union" list is a DECISION about 13 prefixes. If
  // one of them were a member state under some spelling, listing it here
  // would make its stations disappear as "declared outsiders" — the same
  // silent loss as not knowing the code, with the tally saying it was
  // deliberate.
  it.each([...AIR_KNOWN_OUTSIDE_EU27])(
    '%s is not a member state under any spelling we translate',
    (p) => {
      expect(isEuMemberState(p)).toBe(false);
    },
  );

  it('is thirteen distinct upper-case two-letter prefixes, sorted', () => {
    expect(AIR_KNOWN_OUTSIDE_EU27).toHaveLength(13);
    expect(new Set(AIR_KNOWN_OUTSIDE_EU27).size).toBe(13);
    for (const p of AIR_KNOWN_OUTSIDE_EU27) expect(p).toMatch(/^[A-Z]{2}$/);
    expect([...AIR_KNOWN_OUTSIDE_EU27].sort()).toEqual([
      ...AIR_KNOWN_OUTSIDE_EU27,
    ]);
  });

  // The two decisions must not overlap on any prefix: a code that is in
  // both would be judged by whichever check ran first.
  it('does not list Greece, under either spelling', () => {
    expect(AIR_KNOWN_OUTSIDE_EU27).not.toContain('GR');
    expect(AIR_KNOWN_OUTSIDE_EU27).not.toContain('EL');
  });

  // The United Kingdom is the one somebody will one day want to add. It
  // is NOT decided, so it must stay unrecognised and loud.
  it('does not quietly decide the United Kingdom', () => {
    expect(AIR_KNOWN_OUTSIDE_EU27).not.toContain('UK');
    expect(AIR_KNOWN_OUTSIDE_EU27).not.toContain('GB');
  });
});

describe('the freshness budget and cadence', () => {
  it('is four whole hours, and hourly', () => {
    expect(AIR_FRESH_FOR_HOURS).toBe(4);
    expect(AIR_CADENCE).toBe('hourly');
  });
});

describe('the bases a station may carry', () => {
  it('are reported and mixed — a fully modelled hour is not one of them', () => {
    expect([...AIR_BASES]).toEqual(['reported', 'mixed']);
  });
});

describe('the endpoints', () => {
  it('read the year-suffixed raster and the viewer’s blob folder', () => {
    expect(AIR_RASTER_URL).toContain(
      '/AQMobile_2025/MOSAIC_GLOBAL_AQI/ImageServer',
    );
    expect(AIR_BLOB_BASE).toContain('/airquality-derivated/AQI-noRunningMeans');
    expect(AIR_ROSTER_INDEX_URL).toBe(`${AIR_BLOB_BASE}/content/index.json`);
    expect(airStationUrl('DEBB021')).toBe(
      `${AIR_BLOB_BASE}/current/DEBB021.json`,
    );
  });

  // 🔴 The repository is public and has leaked once. None of these needs
  // a key, and none may ever carry one.
  it.each([
    AIR_BLOB_BASE,
    AIR_ROSTER_INDEX_URL,
    AIR_RASTER_URL,
    airStationUrl('X1'),
  ])('carries no key or token (%#)', (url) => {
    expect(url).not.toMatch(/token|api[-_]?key|apikey|secret|sig=|\?/i);
  });

  it('sends batches well under the server’s silent cap of 1 000', () => {
    expect(AIR_RASTER_BATCH + 1).toBeLessThan(1000);
  });

  it('checks a sentinel that is inside the model', () => {
    expect(AIR_RASTER_SENTINEL).toEqual({ lon: 17.74, lat: 46.83 });
  });
});

describe('the index bands', () => {
  it('are the six the EEA names, level 1 to 6', () => {
    expect([...AIR_BAND_LABELS]).toEqual([
      'Good',
      'Fair',
      'Moderate',
      'Poor',
      'Very poor',
      'Extremely poor',
    ]);
  });
});

describe('the attribution', () => {
  // 🔴 Verbatim, including the typographic apostrophe of the EEA's page.
  // verify-attribution.ts reads the viewer and fails when this sentence
  // is no longer on it; this test fails when the constant stops being
  // that sentence.
  it('is the EEA’s own sentence, apostrophe included', () => {
    expect(AIR_ATTRIBUTION).toBe(
      'The European Air Quality Index was developed jointly by the European Commission’s Directorate General for Environment and the European Environment Agency to inform citizens and public authorities about the recent air quality status across Europe.',
    );
    expect(AIR_ATTRIBUTION).toContain('’');
    expect(AIR_ATTRIBUTION).not.toContain("'");
  });

  // docs/emergency-sources.md §9: the copyright holder differs between the
  // measurements and the EEA's processing of them, so it names both.
  it('names both bodies', () => {
    expect(AIR_ATTRIBUTION).toContain('European Commission');
    expect(AIR_ATTRIBUTION).toContain('European Environment Agency');
  });

  // 🔴 CAMP-177, EEA Enquiry Service case #309009, 01.10.2026. Their terms
  // ask to be "acknowledged as the original source", and the sentence
  // above never says the word source — it says who developed the index.
  // These two assertions are what stop the credit quietly collapsing back
  // into one string that satisfies neither obligation.
  test('the source credit names the EEA as the SOURCE, and is not the viewer sentence', () => {
    expect(AIR_SOURCE_CREDIT).toBe(
      'Source: European Environment Agency (EEA).',
    );
    expect(AIR_SOURCE_CREDIT).not.toBe(AIR_ATTRIBUTION);
    expect(EEA_REUSE_SENTENCE).toContain('acknowledged as the original source');
  });
});
