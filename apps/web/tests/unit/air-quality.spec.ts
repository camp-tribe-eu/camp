import { expect, test } from '@playwright/test';
import { AirQualityPanel } from '../../src/components/air-quality';
import {
  AIR_ATTRIBUTION,
  AIR_BAND_LABELS,
  AIR_FRESH_FOR_HOURS,
  AIR_FRESHNESS,
  AIR_POLLUTANTS,
  AIR_RADIUS_M,
  AIR_SOURCE_ID,
  AIR_STATION_TYPES,
  ageHours,
  airState,
  basisOf,
  formatKm,
  hourLabel,
  isFresh,
  readAirQuality,
  readAtLabel,
  type AirState,
} from '../../src/lib/air-quality';
import { formatDistance } from '../../src/lib/api';
import { shouldFlagStale, SOURCES } from '../../src/lib/sources';
import { findForbiddenWords } from '../../src/lib/wording';
import {
  AIR_ATTRIBUTION as API_ATTRIBUTION,
  AIR_BAND_LABELS as API_BAND_LABELS,
  AIR_CADENCE as API_CADENCE,
  AIR_FRESH_FOR_HOURS as API_FRESH_FOR_HOURS,
  AIR_POLLUTANTS as API_POLLUTANTS,
  AIR_RADIUS_M as API_RADIUS_M,
  AIR_SOURCE_ID as API_SOURCE_ID,
  AIR_STATION_TYPES as API_STATION_TYPES,
} from '../../../api/src/air/source';
import { renderComponent } from './render-component';
import { everythingSaid, visibleText } from './rendered-text';

// CAMP-164 — the rules about what this section may say, checked against
// the words a reader is shown.
//
// 🔴 EVERY ASSERTION ABOUT WHAT THE PAGE SAYS READS THE HTML THE
// COMPONENT RENDERS, through `visibleText` — never a constant, a class,
// a `data-testid` or an sr-only caption. The same rules are read again in
// tests/e2e/air-quality.spec.ts out of the SERVED page, because a rule
// verified only against the function that generates the text is one the
// next hard-coded sentence walks straight past.
//
// 🔴 NO EXPECTED STRING IS BUILT FROM THE FUNCTION IT CHECKS. "Fair
// (level 2 of 6)" is typed here, not produced by `levelText(2)`: a test
// whose expectation grows from the field it checks agrees with any value
// at all.

/** 29.09.2026 19:35 UTC — the current hour is 19:00. */
const NOW = new Date('2026-09-29T19:35:00Z');

/** ISO instant of the hour `h` whole hours before the current one. */
const hourAgo = (h: number): string =>
  new Date(Date.UTC(2026, 8, 29, 19) - h * 3_600_000).toISOString();

const STATION = {
  code: 'DEBB021',
  name: 'Berlin Neukölln',
  municipality: 'Berlin',
  type: 'background',
  metres: 3200,
};

const P = (pollutant: string, band: number, value: number, modelled = false) => ({
  pollutant,
  band,
  value,
  modelled,
});

const READING = {
  hour: hourAgo(2),
  band: 2,
  basis: 'reported',
  culprit: 'PM10',
  pollutants: [P('PM10', 2, 23), P('NO2', 1, 14)],
  readAt: '2026-09-29T19:30:00.000Z',
};

const MIXED = {
  ...READING,
  band: 3,
  basis: 'mixed',
  culprit: 'NO2',
  pollutants: [P('PM10', 2, 23), P('NO2', 3, 40, true)],
};

const stationFacts = (reading: unknown) => ({
  kind: 'station',
  station: STATION,
  reading,
});

const MODELLED = {
  kind: 'modelled',
  modelled: { hour: hourAgo(0), band: 2, readAt: '2026-09-29T19:30:00.000Z' },
};

const render = (facts: unknown, now: Date = NOW): string =>
  renderComponent(AirQualityPanel, { state: airState(facts, now) });
const said = (facts: unknown, now: Date = NOW): string => visibleText(render(facts, now));

// ---------------------------------------------------------------------
// The clock.
// ---------------------------------------------------------------------

test.describe('freshness: decided against a clock that is passed in', () => {
  test('a reading within the budget is shown', () => {
    for (const age of [1, 2, 3, 4]) {
      expect(airState(stationFacts({ ...READING, hour: hourAgo(age) }), NOW).state, `${age} h`).toBe(
        'reported',
      );
    }
  });

  // 🔴 The boundary itself, on both sides. Four hours is fresh; five is
  // not — the measurement in api/src/air/source.ts says why four.
  test('a reading past the budget is not shown as current', () => {
    for (const age of [5, 6, 24, 24 * 300]) {
      const s = airState(stationFacts({ ...READING, hour: hourAgo(age) }), NOW);
      expect(s.state, `${age} h`).toBe('no-fresh-data');
      expect((s as Extract<AirState, { state: 'no-fresh-data' }>).reason).toBe('station-stale');
    }
  });

  // 🔴 A reading from an hour that has not happened by this clock is not
  // fresh: a skewed clock, or a fault. It must not be shown as current.
  test('a reading from the future is not fresh', () => {
    expect(airState(stationFacts({ ...READING, hour: hourAgo(-1) }), NOW).state).toBe('no-fresh-data');
    expect(airState(stationFacts({ ...READING, hour: hourAgo(-30) }), NOW).state).toBe('no-fresh-data');
    expect(isFresh(-1)).toBe(false);
    expect(isFresh(0)).toBe(true);
    expect(isFresh(4)).toBe(true);
    expect(isFresh(5)).toBe(false);
  });

  // 🔴 THE POINT OF PASSING THE CLOCK IN. The same facts are `reported`
  // when the page is built and `no fresh data` in a browser that is still
  // open five hours later — which is what the campsite page does on mount.
  test('the same facts turn into "no fresh data" when the clock moves on', () => {
    const facts = stationFacts(READING);
    expect(airState(facts, NOW).state).toBe('reported');
    expect(airState(facts, new Date('2026-09-29T21:35:00Z')).state).toBe('reported');
    expect(airState(facts, new Date('2026-09-30T00:35:00Z')).state).toBe('no-fresh-data');
  });

  test('is hour-granular: the minute inside the hour changes nothing', () => {
    const facts = stationFacts({ ...READING, hour: hourAgo(4) });
    expect(airState(facts, new Date('2026-09-29T19:00:00Z')).state).toBe('reported');
    expect(airState(facts, new Date('2026-09-29T19:59:59Z')).state).toBe('reported');
    expect(airState(facts, new Date('2026-09-29T20:00:00Z')).state).toBe('no-fresh-data');
    expect(ageHours(hourAgo(4), new Date('2026-09-29T19:59:59Z'))).toBe(4);
  });

  test('the model ages out too', () => {
    expect(airState(MODELLED, NOW).state).toBe('modelled');
    const late = airState(MODELLED, new Date('2026-09-30T00:35:00Z'));
    expect(late.state).toBe('no-fresh-data');
    expect((late as Extract<AirState, { state: 'no-fresh-data' }>).reason).toBe('model-stale');
  });

  // 🔴 A silent station is still the answer — it does not hand the page to
  // the model, and it is never fresh whatever the clock says.
  test('a station with no reading is "no fresh data", at any time', () => {
    for (const now of [NOW, new Date('2020-01-01T00:00:00Z'), new Date('2030-01-01T00:00:00Z')]) {
      const s = airState(stationFacts(null), now);
      expect(s.state).toBe('no-fresh-data');
      expect((s as Extract<AirState, { state: 'no-fresh-data' }>).reason).toBe('station-silent');
    }
  });
});

// ---------------------------------------------------------------------
// The payload is a promise; this is the check.
// ---------------------------------------------------------------------

test.describe('a payload that is not exactly a shape we know is never shown as a reading', () => {
  test('nothing at all and an explicit none are "no data", not an error', () => {
    for (const facts of [undefined, null, { kind: 'none' }]) {
      const s = airState(facts, NOW);
      expect(s).toEqual({ state: 'no-data', reason: 'nothing-covers' });
    }
  });

  for (const [name, facts] of [
    ['a string', 'reported'],
    ['a number', 42],
    ['an array', []],
    ['an unknown kind', { kind: 'forecast' }],
    ['a station with no station', { kind: 'station', reading: null }],
    ['a station with a bad distance', { kind: 'station', station: { ...STATION, metres: -5 }, reading: null }],
    ['a station of an unknown kind', { kind: 'station', station: { ...STATION, type: 'airport' }, reading: null }],
    ['a modelled value with no level', { kind: 'modelled', modelled: { hour: hourAgo(0), band: null, readAt: READING.readAt } }],
    ['a modelled level of 7', { kind: 'modelled', modelled: { hour: hourAgo(0), band: 7, readAt: READING.readAt } }],
    ['a modelled level of 2.5', { kind: 'modelled', modelled: { hour: hourAgo(0), band: 2.5, readAt: READING.readAt } }],
    ['a modelled hour that is not a time', { kind: 'modelled', modelled: { hour: 'soon', band: 2, readAt: READING.readAt } }],
  ] as [string, unknown][]) {
    test(`${name} is unreadable`, () => {
      expect(airState(facts, NOW)).toEqual({ state: 'no-data', reason: 'unreadable' });
    });
  }

  // 🔴 THE ONES THAT COULD PRINT "AS REPORTED" OVER A MODEL.
  test('a basis that is not what the pollutants imply is unreadable', () => {
    // Stored "reported", but one pollutant is modelled.
    expect(airState(stationFacts({ ...MIXED, basis: 'reported' }), NOW).state).toBe('no-data');
    // Stored "mixed", but none is.
    expect(airState(stationFacts({ ...READING, basis: 'mixed' }), NOW).state).toBe('no-data');
  });

  test('an hour in which EVERY pollutant is modelled is not a station reading', () => {
    const allModelled = { ...READING, pollutants: [P('PM10', 2, 23, true), P('NO2', 1, 14, true)] };
    for (const basis of ['reported', 'mixed', 'modelled']) {
      expect(airState(stationFacts({ ...allModelled, basis }), NOW).state, basis).toBe('no-data');
    }
    expect(basisOf([P('PM10', 2, 23, true), P('NO2', 1, 14, true)])).toBeNull();
    expect(basisOf([P('PM10', 2, 23, false), P('NO2', 1, 14, true)])).toBe('mixed');
    expect(basisOf([P('PM10', 2, 23, false)])).toBe('reported');
  });

  test('a missing or unknown basis is never read as "reported"', () => {
    const { basis: _drop, ...noBasis } = READING;
    expect(airState(stationFacts(noBasis), NOW).state).toBe('no-data');
    expect(airState(stationFacts({ ...READING, basis: 'measured' }), NOW).state).toBe('no-data');
    expect(airState(stationFacts({ ...READING, basis: undefined }), NOW).state).toBe('no-data');
  });

  // 🔴 `modelled` is a boolean. 0, 1, "no" and null are all refused —
  // reading anything but `true` as "not modelled" is how a model gets
  // filed as a report.
  for (const flag of [0, 1, 'false', 'no', null, undefined]) {
    test(`a pollutant whose modelled flag is ${JSON.stringify(flag)} is unreadable`, () => {
      const bad = { ...READING, pollutants: [{ ...P('PM10', 2, 23), modelled: flag }, P('NO2', 1, 14)] };
      expect(airState(stationFacts(bad), NOW).state).toBe('no-data');
    });
  }

  test('the headline level is the worst pollutant’s, and the culprit is one of them', () => {
    expect(airState(stationFacts({ ...READING, band: 3 }), NOW).state).toBe('no-data');
    expect(airState(stationFacts({ ...READING, culprit: 'O3' }), NOW).state).toBe('no-data');
    expect(airState(stationFacts({ ...READING, culprit: 'lead' }), NOW).state).toBe('no-data');
  });

  test('a pollutant listed twice, or with a level out of range, is unreadable', () => {
    expect(airState(stationFacts({ ...READING, pollutants: [P('PM10', 2, 23), P('PM10', 2, 24)] }), NOW).state).toBe('no-data');
    expect(airState(stationFacts({ ...READING, band: 7, pollutants: [P('PM10', 7, 400)] }), NOW).state).toBe('no-data');
    expect(airState(stationFacts({ ...READING, pollutants: [] }), NOW).state).toBe('no-data');
  });

  test('an hour or read time that is not an ISO instant is unreadable', () => {
    expect(airState(stationFacts({ ...READING, hour: '17' }), NOW).state).toBe('no-data');
    expect(airState(stationFacts({ ...READING, hour: '2026-09-29 17:00' }), NOW).state).toBe('no-data');
    expect(airState(stationFacts({ ...READING, readAt: undefined }), NOW).state).toBe('no-data');
  });

  test('readAirQuality keeps a good payload whole', () => {
    expect(readAirQuality(stationFacts(READING))).toEqual({
      kind: 'station',
      station: STATION,
      reading: READING,
    });
    expect(readAirQuality(MODELLED)).toEqual(MODELLED);
  });
});

// ---------------------------------------------------------------------
// 1. A model is not a reading.
// ---------------------------------------------------------------------

test.describe('display requirement 1: a modelled value renders differently from a measurement', () => {
  test('a reported reading never says "modelled" anywhere on the page', () => {
    const text = said(stationFacts(READING));
    expect(text).toContain('Reported by the station');
    expect(text).not.toMatch(/modelled|model\b/i);
  });

  test('the 1 km model says, in words, that it is a model and not a measurement', () => {
    const text = said(MODELLED);
    expect(text).toContain('Modelled index for this location');
    expect(text).toContain('Modelled estimate, not a measurement');
    expect(text).toContain('a forecast model downscaled from Copernicus CAMS, not a reading');
    // …and it is NOT dressed as a report.
    expect(text).not.toContain('Reported by the station');
    expect(text).not.toContain('Nearest station');
  });

  test('the model is set in a container of its own, not only in different words', () => {
    const modelled = render(MODELLED);
    const reported = render(stationFacts(READING));
    expect(modelled).toContain('data-state="modelled"');
    expect(modelled).toContain('data-basis="modelled"');
    expect(reported).toContain('data-state="reported"');
    expect(reported).toContain('data-basis="reported"');
    expect(modelled).not.toContain('data-basis="reported"');
  });

  // The pollutant-level case: a mixed hour marks the modelled pollutant
  // and only that one.
  test('in a mixed hour the modelled pollutant is marked and the reported one is not', () => {
    const html = render(stationFacts(MIXED));
    const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => visibleText(m[1]));
    expect(items).toEqual([
      'PM10 — 23 µg/m³, Fair',
      'NO2 — 40 µg/m³, Moderate — modelled estimate',
    ]);
    const text = visibleText(html);
    expect(text).toContain('Partly modelled: 1 of 2 pollutants is a modelled estimate, not measurements');
  });

  test('when the pollutant that sets the level is the modelled one, it says so', () => {
    expect(said(stationFacts(MIXED))).toContain('The level is set by NO2, which is a modelled estimate.');
    // Modelled pollutant present, but not the one that sets the level:
    const other = {
      ...MIXED,
      band: 3,
      culprit: 'PM10',
      pollutants: [P('PM10', 3, 50), P('NO2', 2, 20, true)],
    };
    const text = said(stationFacts(other));
    expect(text).toContain('The level is set by PM10.');
    expect(text).not.toContain('which is a modelled estimate');
  });

  test('a mixed hour explains where its estimates come from', () => {
    expect(said(stationFacts(MIXED))).toContain(
      'The EEA fills the gap with a model (a Copernicus CAMS forecast, downscaled)',
    );
    expect(said(stationFacts(READING))).not.toContain('fills the gap');
  });
});

// ---------------------------------------------------------------------
// 2. The wording.
// ---------------------------------------------------------------------

test.describe('display requirement 2: "as reported to the EEA, not formally verified"', () => {
  test('a reported reading says exactly that', () => {
    expect(said(stationFacts(READING))).toContain('As reported to the EEA, not formally verified.');
  });

  test('a mixed reading says it too', () => {
    expect(said(stationFacts(MIXED))).toContain('As reported to the EEA, not formally verified.');
  });

  // 🔴 NOT under a model. "Reported to the EEA" is false of something
  // nobody reported.
  test('a pure model does not say it was reported', () => {
    const text = said(MODELLED);
    expect(text).not.toContain('As reported to the EEA');
    expect(text).not.toMatch(/reported to the EEA/i);
    expect(text).toContain('Not formally verified.');
  });

  test('no state says "the air quality is …"', () => {
    for (const facts of [
      stationFacts(READING),
      stationFacts(MIXED),
      MODELLED,
      stationFacts(null),
      stationFacts({ ...READING, hour: hourAgo(9) }),
      { kind: 'none' },
    ]) {
      expect(said(facts)).not.toMatch(/air quality is|air is (?:good|clean|safe|fine)|the air (?:here )?is/i);
    }
  });

  test('the index level names the hour it describes, in UTC', () => {
    const text = said(stationFacts(READING));
    expect(text).toContain('European Air Quality Index, 17:00 UTC, 29 September 2026');
    expect(text).toContain('Fair (level 2 of 6)');
  });
});

// ---------------------------------------------------------------------
// 3. No fresh data.
// ---------------------------------------------------------------------

test.describe('display requirement 3: a station missing from the current hour says "no fresh data"', () => {
  test('a silent station says it, and names the station, its kind and its distance', () => {
    const text = said(stationFacts(null));
    expect(text).toContain('No fresh data.');
    expect(text).toContain('Berlin Neukölln (background station, 3.2 km away)');
    expect(text).toContain('has not reported to the EEA recently');
    expect(text).not.toContain('Fair');
  });

  test('a reading that has aged past the budget says it, with the hour and the budget', () => {
    const text = said(stationFacts({ ...READING, hour: hourAgo(9) }));
    expect(text).toContain('No fresh data.');
    expect(text).toContain('is from 10:00 UTC, 29 September 2026, more than 4 hours ago');
    // The stale level is NOT printed as if it were current.
    expect(text).not.toContain('(level 2 of 6)');
  });

  test('a model we have not refreshed says it', () => {
    const text = said(MODELLED, new Date('2026-09-30T02:35:00Z'));
    expect(text).toContain('No fresh data.');
    expect(text).toContain('Our last read of the EEA’s modelled index for this location is from 19:00 UTC, 29 September 2026');
    expect(text).not.toContain('Modelled estimate');
  });

  test('no data at all says so, in its own words', () => {
    expect(said({ kind: 'none' })).toContain(
      'No air-quality data for this location: no monitoring station lies within 20 km and the EEA’s modelled index does not cover this spot.',
    );
    expect(said('garbage')).toContain('The air-quality data for this location could not be read.');
  });

  // 🔴 THE CARD'S OWN SENTENCE: never blank. Every state — including
  // every one built from garbage — prints words.
  test('no state ever renders an empty section', () => {
    const inputs: unknown[] = [
      undefined,
      null,
      '',
      0,
      {},
      [],
      { kind: 'station' },
      { kind: 'modelled' },
      stationFacts(null),
      stationFacts(READING),
      stationFacts(MIXED),
      MODELLED,
      { kind: 'none' },
    ];
    for (const facts of inputs) {
      const html = render(facts);
      expect(html, JSON.stringify(facts)).toContain('data-testid="air-quality"');
      expect(visibleText(html).length, JSON.stringify(facts)).toBeGreaterThan(60);
      expect(visibleText(html), JSON.stringify(facts)).toContain('Air quality');
    }
  });

  test('exactly one state per input, and they are all different sections of the same shape', () => {
    const states = new Set<string>();
    for (const [facts, expected] of [
      [stationFacts(READING), 'reported'],
      [stationFacts(MIXED), 'mixed'],
      [MODELLED, 'modelled'],
      [stationFacts(null), 'no-fresh-data'],
      [{ kind: 'none' }, 'no-data'],
    ] as [unknown, string][]) {
      const html = render(facts);
      expect([...html.matchAll(/data-state="([^"]+)"/g)].map((m) => m[1])).toEqual([expected]);
      states.add(expected);
    }
    expect(states.size).toBe(5);
  });
});

// ---------------------------------------------------------------------
// Attribution, and what else the page must carry.
// ---------------------------------------------------------------------

test.describe('the attribution the licence requires', () => {
  const ALL = [
    stationFacts(READING),
    stationFacts(MIXED),
    MODELLED,
    stationFacts(null),
    { kind: 'none' },
    'garbage',
  ];

  test('every state names the EEA, its licence and the EEA’s own sentence', () => {
    for (const facts of ALL) {
      const text = said(facts);
      expect(text, JSON.stringify(facts)).toContain('European Environment Agency');
      expect(text, JSON.stringify(facts)).toContain('CC BY 4.0');
      expect(text, JSON.stringify(facts)).toContain(AIR_ATTRIBUTION);
    }
    expect(render(stationFacts(READING))).toContain('creativecommons.org/licenses/by/4.0/');
    expect(render(stationFacts(READING))).toContain('https://airindex.eea.europa.eu/AQI/index.html');
  });

  // The date is where a reader sees how old what they are looking at is.
  test('a state that holds a value says when the EEA’s file was read', () => {
    for (const facts of [stationFacts(READING), stationFacts(MIXED), MODELLED]) {
      expect(said(facts)).toContain('Read from the EEA on 29 September 2026, 19:30 UTC.');
    }
  });

  test('a state that holds no value names no date it does not have', () => {
    for (const facts of [{ kind: 'none' }, 'garbage']) {
      expect(said(facts)).not.toContain('Read from the EEA on');
    }
  });

  test('the sentence is marked as boilerplate; the date, which varies, is not', () => {
    const html = render(stationFacts(READING));
    expect(html).toContain('data-boilerplate="air-attribution">' + AIR_ATTRIBUTION + '</span>');
    expect(html).not.toMatch(/data-boilerplate="[^"]*"[^>]*>[^<]*Read from the EEA/);
  });
});

test.describe('what else the page says', () => {
  test('a station with no particulate matter says so', () => {
    const noPm = { ...READING, band: 1, culprit: 'NO2', pollutants: [P('NO2', 1, 8), P('O3', 1, 40)] };
    expect(said(stationFacts(noPm))).toContain('This index includes no particulate matter (PM2.5 or PM10).');
    expect(said(stationFacts(READING))).not.toContain('no particulate matter');
    const pm25Only = { ...READING, culprit: 'PM2.5', pollutants: [P('PM2.5', 2, 9)] };
    expect(said(stationFacts(pm25Only))).not.toContain('no particulate matter');
  });

  test('the station kind is spelled out beside the distance', () => {
    for (const [type, words] of [
      ['traffic', 'traffic station'],
      ['industrial', 'industrial station'],
      ['background', 'background station'],
    ]) {
      const facts = { kind: 'station', station: { ...STATION, type }, reading: READING };
      expect(said(facts)).toContain(`${words}, 3.2 km from this campsite`);
    }
  });

  test('a station whose municipality is its name is not named twice', () => {
    const facts = { kind: 'station', station: { ...STATION, municipality: STATION.name }, reading: READING };
    expect(said(facts)).toContain('Berlin Neukölln — background station');
    expect(said(facts)).not.toContain('Berlin Neukölln, Berlin Neukölln');
    expect(said(stationFacts(READING))).toContain('Berlin Neukölln, Berlin — background station');
  });

  test('a distance under a kilometre is printed in metres', () => {
    const facts = { kind: 'station', station: { ...STATION, metres: 640 }, reading: READING };
    expect(said(facts)).toContain('640 m from this campsite');
  });

  // Station names are typed by 27 national networks.
  test('a hostile station name is text, not markup', () => {
    const facts = {
      kind: 'station',
      station: { ...STATION, name: '<img src=x onerror=alert(1)>', municipality: null },
      reading: READING,
    };
    const html = render(facts);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  // No colour carries the meaning: red means danger to every reader
  // alive, and the EEA has not said anything is.
  test('no level is painted', () => {
    for (const facts of [stationFacts(READING), stationFacts({ ...READING, band: 5, pollutants: [P('PM10', 5, 250)] }), MODELLED]) {
      expect(render(facts)).not.toMatch(/(?:bg|text|border)-(?:red|green|amber|yellow|orange|rose|lime|emerald|warn|danger)/);
    }
  });

  // Not because a licence binds it — CAMP-162's gate is about CEMS, and
  // this is an EEA source — but because air quality is where somebody
  // reaches for "clean" or "unsafe".
  test('our own words use none of the alarm or verdict words', () => {
    for (const facts of [
      stationFacts(READING),
      stationFacts(MIXED),
      MODELLED,
      stationFacts(null),
      stationFacts({ ...READING, hour: hourAgo(9) }),
      { kind: 'none' },
      'garbage',
    ]) {
      const html = render(facts);
      for (const chunk of everythingSaid(html)) {
        expect(findForbiddenWords(chunk), JSON.stringify(facts)).toEqual([]);
      }
    }
  });
});

test.describe('the hour is printed the same way on the server and in the browser', () => {
  test('in UTC, by hand', () => {
    expect(hourLabel('2026-09-29T17:00:00.000Z')).toBe('17:00 UTC, 29 September 2026');
    expect(hourLabel('2026-01-02T00:00:00Z')).toBe('00:00 UTC, 2 January 2026');
    expect(readAtLabel('2026-09-29T19:05:00.000Z')).toBe('29 September 2026, 19:05 UTC');
  });
});

// ---------------------------------------------------------------------
// The web's copies of the API's numbers.
// ---------------------------------------------------------------------

test.describe('the web and the API agree', () => {
  test('on the freshness budget, the radius and the source id', () => {
    expect(AIR_FRESH_FOR_HOURS).toBe(API_FRESH_FOR_HOURS);
    expect(AIR_RADIUS_M).toBe(API_RADIUS_M);
    expect(AIR_SOURCE_ID).toBe(API_SOURCE_ID);
    expect(AIR_FRESHNESS.freshForHours).toBe(API_FRESH_FOR_HOURS);
  });

  // 🔴 The attribution, verbatim in both places and against the literal.
  test('on the attribution, word for word', () => {
    expect(AIR_ATTRIBUTION).toBe(API_ATTRIBUTION);
    expect(AIR_ATTRIBUTION).toBe(
      'The European Air Quality Index was developed jointly by the European Commission’s Directorate General for Environment and the European Environment Agency to inform citizens and public authorities about the recent air quality status across Europe.',
    );
  });

  test('on the level names, the pollutants and the station kinds', () => {
    expect([...AIR_BAND_LABELS]).toEqual([...API_BAND_LABELS]);
    expect([...AIR_POLLUTANTS]).toEqual([...API_POLLUTANTS]);
    expect([...AIR_STATION_TYPES]).toEqual([...API_STATION_TYPES]);
  });

  test('on the cadence, declared as data about the source', () => {
    expect(SOURCES[AIR_SOURCE_ID].cadence).toBe(API_CADENCE);
    expect(SOURCES[AIR_SOURCE_ID].cadence).toBe('hourly');
    expect(AIR_FRESHNESS.cadence).toBe('hourly');
    expect(AIR_FRESHNESS.ageIsNormal).toBe(false);
  });

  test('on how a distance is written', () => {
    for (const m of [0, 640, 999, 1000, 3200, 18_400, 19_950]) {
      expect(formatKm(m)).toBe(formatDistance(m));
    }
  });
});

test.describe('the source registry treats an hourly source as neither stale nor healthy-when-old', () => {
  // 🔴 The 730-day flag is about records nobody edits. It must never be
  // what decides an hourly one.
  test('the two-year flag never fires for the air quality index', () => {
    const src = SOURCES[AIR_SOURCE_ID];
    expect(shouldFlagStale(src, '2019-01-01', new Date('2026-09-29'))).toBe(false);
  });

  test('and still fires for a continuous source at the same age', () => {
    expect(shouldFlagStale(SOURCES.datatourisme, '2019-01-01', new Date('2026-09-29'))).toBe(true);
  });

  test('names the EEA, CC BY 4.0 and the date it was read', () => {
    const s = SOURCES[AIR_SOURCE_ID];
    expect(s.name).toContain('European Environment Agency');
    expect(s.licence).toBe('CC BY 4.0');
    expect(s.licenceUrl).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(s.dateLabel).toBe('Read from the EEA on');
  });
});
