import {
  emptyReadingTally,
  emptyStationTally,
  planReading,
  readingTallyReconciles,
  rosterShrinkOk,
  selectStations,
  stationTallyReconciles,
} from './import';
import type { RosterRow } from './parse';

// CAMP-164: "one bad record costs one record" is a claim, so it is
// tested as one — with a roster that contains every kind of broken row
// and a good row after each of them.

function row(over: Partial<RosterRow> = {}): RosterRow {
  return {
    code: 'DEBB021',
    name: 'Berlin Neukölln',
    operational: 1,
    lon: 13.4386,
    lat: 52.4895,
    station_type: 'Background',
    area_classification: 'Urban',
    municipality: 'Berlin',
    ...over,
  };
}

describe('selectStations', () => {
  it('keeps the good rows and costs one record per bad one', () => {
    const { stations, tally } = selectStations([
      row({ code: 'DE0001A' }),
      row({ code: 'DE0002A', station_type: 'Airport' }),
      row({ code: 'DE0003A' }),
      row({ code: 'DE0004A', lat: null }),
      row({ code: 'DE0005A' }),
      row({ code: '' }),
      row({ code: 'DE0006A', name: '' }),
      row({ code: 'DE0007A' }),
      null,
      'not a row',
    ]);

    expect(stations.map((s) => s.code)).toEqual([
      'DE0001A',
      'DE0003A',
      'DE0005A',
      'DE0007A',
    ]);
    expect(tally.read).toBe(10);
    expect(tally.kept).toBe(4);
    expect(tally.refused['unknown-station-type']).toBe(1);
    expect(tally.refused['no-coordinates']).toBe(1);
    expect(tally.refused['no-code']).toBe(3);
    expect(tally.refused['no-name']).toBe(1);
  });

  // 🔴 The layer has no duplicate codes today. The guard exists so that
  // one future duplicate costs ONE row rather than the INSERT batch of
  // 500 it lands in — one bad record costing 499 good ones.
  it('drops a repeated code without losing its neighbours', () => {
    const { stations, tally } = selectStations([
      row({ code: 'DEDUP1', name: 'first' }),
      row({ code: 'DEDUP1', name: 'second' }),
      row({ code: 'DEOK12' }),
    ]);
    expect(stations.map((s) => s.name)).toEqual(['first', 'Berlin Neukölln']);
    expect(tally.refused['duplicate-code']).toBe(1);
  });

  // 🔴 A counter that does not add up is how an importer reports success
  // over data it silently threw away.
  it('produces a tally that reconciles', () => {
    const { tally } = selectStations([
      row({ code: 'DE0001A' }),
      row({ code: 'CH0001A' }),
      row({ code: 'UK0001A' }),
      row({ code: 'DE0002A', lon: 999 }),
    ]);
    expect(stationTallyReconciles(tally)).toBe(true);
    expect(
      tally.kept + Object.values(tally.refused).reduce((a, b) => a + b, 0),
    ).toBe(tally.read);
  });

  it('notices a tally that does not reconcile', () => {
    const tally = emptyStationTally();
    tally.read = 10;
    tally.kept = 4;
    tally.refused['no-code'] = 1;
    expect(stationTallyReconciles(tally)).toBe(false);
  });

  // 🔴 "A query for everything not in this list must return zero." The
  // tally is where that is asked, on every run: the prefixes declared
  // outside the Union are counted by name, and a prefix nobody has
  // classified is counted by name in a place of its own — a place the
  // importer prints and turns into a non-zero exit code.
  it('counts declared outsiders and UNRECOGNISED prefixes separately, by prefix', () => {
    const { tally } = selectStations([
      row({ code: 'CH0001A' }),
      row({ code: 'CH0002A' }),
      row({ code: 'TR0001A' }),
      row({ code: 'UK0001A' }),
      row({ code: 'UK0002A' }),
      row({ code: 'ZZ0001A' }),
      row({ code: 'DE0001A' }),
    ]);
    expect(tally.outsideEu27).toEqual({ CH: 2, TR: 1 });
    expect(tally.unrecognised).toEqual({ UK: 2, ZZ: 1 });
    expect(tally.refused['outside-eu27']).toBe(3);
    expect(tally.refused['unrecognised-country']).toBe(3);
    expect(tally.kept).toBe(1);
  });

  it('keeps Greece whichever way the source spells it', () => {
    const { stations, tally } = selectStations([
      row({ code: 'GR0010A' }),
      row({ code: 'EL0011A' }),
    ]);
    expect(stations.map((s) => s.country)).toEqual(['gr', 'gr']);
    expect(tally.unrecognised).toEqual({});
    expect(tally.outsideEu27).toEqual({});
  });
});

describe('rosterShrinkOk', () => {
  // 🔴 Stations that fall out of the roster are DELETED. A truncated
  // read must not be able to authorise that.
  it.each([
    [0, 0, true], // a first import
    [0, 4018, true],
    [4018, 4018, true],
    [4018, 4100, true],
    [4018, 3617, true], // 90%: 3 616.2 rounds up to 3 617
    [4018, 3616, false],
    [4018, 3000, false],
    [4018, 0, false],
  ])('%i stored, %i kept → %s', (existing, kept, ok) => {
    expect(rosterShrinkOk(existing, kept)).toBe(ok);
  });
});

// ---------------------------------------------------------------------
// planReading
// ---------------------------------------------------------------------

const NOW = new Date('2026-09-29T19:35:00Z');
const goodFile = {
  '2026-09-29T17:00:00.000Z': {
    aqi: 2.2,
    aqi_PM10: 2.2,
    modelled_PM10: 0,
    val_PM10: 23,
    culprit: 'PM10',
  },
};

describe('planReading', () => {
  it('sets a reading from a file that has one', () => {
    const t = emptyReadingTally();
    const plan = planReading('DE1', { outcome: 'ok', body: goodFile }, NOW, t);
    expect(plan.action).toBe('set');
    expect(t.set).toBe(1);
    expect(t.basis.reported).toBe(1);
    expect(t.ageHours).toEqual({ '2': 1 });
  });

  // What a run costs the EEA's blob store is printed from this, so the
  // number in the importer's header is one somebody can rerun.
  it('counts the bytes it read', () => {
    const t = emptyReadingTally();
    planReading('A', { outcome: 'ok', body: goodFile, bytes: 1200 }, NOW, t);
    planReading('B', { outcome: 'ok', body: {}, bytes: 34 }, NOW, t);
    planReading('C', { outcome: 'no-file' }, NOW, t);
    planReading('D', { outcome: 'failed', detail: 'x' }, NOW, t);
    expect(t.bytes).toBe(1234);
  });

  it('clears the reading of a station that has no file', () => {
    const t = emptyReadingTally();
    expect(planReading('DE1', { outcome: 'no-file' }, NOW, t)).toEqual({
      action: 'clear',
      code: 'DE1',
      why: 'no-file',
    });
    expect(t.clear['no-file']).toBe(1);
  });

  // 🔴 THE ONE THAT MATTERS. A failed fetch says nothing about the
  // station. Stored as a clear, the page would say the station is not
  // reporting because OUR request timed out.
  it('KEEPS the previous reading when the fetch failed', () => {
    const t = emptyReadingTally();
    expect(
      planReading('DE1', { outcome: 'failed', detail: 'timeout' }, NOW, t),
    ).toEqual({
      action: 'keep',
      code: 'DE1',
    });
    expect(t.keep).toBe(1);
    expect(t.set + t.clear['no-file'] + t.clear['no-reported-hour']).toBe(0);
  });

  it('clears a file in which nothing was ever reported, and says why', () => {
    const t = emptyReadingTally();
    const modelledOnly = {
      '2026-09-29T17:00:00.000Z': {
        aqi: 2.2,
        aqi_PM10: 2.2,
        modelled_PM10: 1,
        val_PM10: 23,
        culprit: 'PM10',
      },
    };
    expect(
      planReading('DE1', { outcome: 'ok', body: modelledOnly }, NOW, t),
    ).toMatchObject({
      action: 'clear',
      why: 'no-reported-hour',
    });
  });

  it('calls a file that is nothing but unreadable slots unreadable, not silent', () => {
    const t = emptyReadingTally();
    const junk = {
      '2026-09-29T17:00:00.000Z': 'x',
      '2026-09-29T16:00:00.000Z': null,
    };
    expect(
      planReading('DE1', { outcome: 'ok', body: junk }, NOW, t),
    ).toMatchObject({
      action: 'clear',
      why: 'unreadable',
    });
    expect(t.malformedSlots).toBe(2);
  });

  it('files old readings under the buckets the report prints', () => {
    const t = emptyReadingTally();
    const at = (h: number) => ({
      [new Date(Date.UTC(2026, 8, 29, 19) - h * 3_600_000).toISOString()]:
        goodFile['2026-09-29T17:00:00.000Z'],
    });
    for (const h of [1, 4, 6, 7, 24, 25, 300]) {
      planReading('X', { outcome: 'ok', body: at(h) }, NOW, t);
    }
    expect(t.ageHours).toEqual({ '1': 1, '4': 1, '6': 1, '7-24': 2, '>24': 2 });
  });

  it('produces a tally that reconciles with the number of stations', () => {
    const t = emptyReadingTally();
    planReading('A', { outcome: 'ok', body: goodFile }, NOW, t);
    planReading('B', { outcome: 'no-file' }, NOW, t);
    planReading('C', { outcome: 'failed', detail: 'x' }, NOW, t);
    planReading('D', { outcome: 'ok', body: {} }, NOW, t);
    expect(readingTallyReconciles(t, 4)).toBe(true);
    expect(readingTallyReconciles(t, 5)).toBe(false);
  });
});
