import { emptyTally, selectRecords, tallyReconciles } from './import';
import type { BathingFeatureAttributes } from './parse';

// CAMP-168: "one bad record costs one record" is a claim, so it is
// tested as one — with a batch that contains every kind of broken row
// and a good row after each of them.

function feature(
  over: Partial<BathingFeatureAttributes> = {},
): BathingFeatureAttributes {
  return {
    bathingWaterIdentifier: 'FRP01000001',
    bathingWaterName: 'PLAGE',
    countryCode: 'FR',
    EU27: 'EU-27',
    bwWaterCategory: 'Coastal',
    bwProfileLink: 'https://example.test/x',
    qualityStatus: 'Excellent',
    latitude: 48.6,
    longitude: -2.0,
    ...over,
  };
}

describe('selectRecords', () => {
  it('keeps the good rows and costs one record per bad one', () => {
    const { records, tally } = selectRecords([
      feature({ bathingWaterIdentifier: 'A1' }),
      feature({ bathingWaterIdentifier: 'A2', qualityStatus: 'Nonsense' }),
      feature({ bathingWaterIdentifier: 'A3' }),
      feature({ bathingWaterIdentifier: 'A4', latitude: null }),
      feature({ bathingWaterIdentifier: 'A5' }),
      feature({ bathingWaterIdentifier: '', bathingWaterName: 'no ref' }),
      feature({ bathingWaterIdentifier: 'A6', EU27: '' }),
      feature({ bathingWaterIdentifier: 'A7' }),
    ]);

    expect(records.map((r) => r.ref)).toEqual(['A1', 'A3', 'A5', 'A7']);
    expect(tally.read).toBe(8);
    expect(tally.stored).toBe(4);
    expect(tally.refused['unknown-status']).toBe(1);
    expect(tally.refused['no-coordinates']).toBe(1);
    expect(tally.refused['no-ref']).toBe(1);
    expect(tally.refused['not-eu27']).toBe(1);
  });

  // 🔴 The layer has no duplicate identifiers today. The guard exists so
  // that one future duplicate costs ONE row rather than failing the
  // INSERT batch of 500 it happens to land in — one bad record costing
  // 499 good ones is the exact shape this rule forbids.
  it('drops a repeated identifier without losing its neighbours', () => {
    const { records, tally } = selectRecords([
      feature({ bathingWaterIdentifier: 'DUP', bathingWaterName: 'first' }),
      feature({ bathingWaterIdentifier: 'DUP', bathingWaterName: 'second' }),
      feature({ bathingWaterIdentifier: 'OK' }),
    ]);
    expect(records.map((r) => r.name)).toEqual(['first', 'PLAGE']);
    expect(tally.refused['duplicate-ref']).toBe(1);
  });

  // 🔴 A counter that does not add up is how an importer reports success
  // over data it silently threw away.
  it('produces a tally that reconciles', () => {
    const { tally } = selectRecords([
      feature({ bathingWaterIdentifier: 'A1' }),
      feature({ bathingWaterIdentifier: 'A2', countryCode: 'CH' }),
      feature({ bathingWaterIdentifier: 'A3', longitude: 999 }),
    ]);
    expect(tallyReconciles(tally)).toBe(true);
    expect(tally.stored + sum(tally)).toBe(tally.read);
  });

  it('notices a tally that does not reconcile', () => {
    const tally = emptyTally();
    tally.read = 10;
    tally.stored = 4;
    tally.refused['no-ref'] = 1;
    expect(tallyReconciles(tally)).toBe(false);
  });

  it('reads nothing out of nothing', () => {
    const { records, tally } = selectRecords([]);
    expect(records).toEqual([]);
    expect(tally.read).toBe(0);
    expect(tallyReconciles(tally)).toBe(true);
  });

  // 🔴 Greece, again, at the level the importer sees — because the alias
  // living in eu.ts is only useful if the path from a feature to a
  // stored row actually goes through it.
  it('stores Greek sites the source labels EL', () => {
    const { records } = selectRecords([
      feature({ bathingWaterIdentifier: 'GR1', countryCode: 'EL' }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].country).toBe('gr');
  });
});

function sum(tally: ReturnType<typeof emptyTally>): number {
  return Object.values(tally.refused).reduce((a, b) => a + b, 0);
}
