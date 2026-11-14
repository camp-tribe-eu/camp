import {
  mapTravelStyles,
  STYLE_SOURCE_PATTERN,
  TRAVEL_STYLE_KEYS,
} from './travel-styles';

// CAMP-520 — a travel style exists only when a tag STATES it, and it
// carries that tag. Pure: no database.

describe('mapTravelStyles: open in winter', () => {
  it.each([
    [{ seasonal: 'no' }, 'yes', 'osm:seasonal=no'],
    [{ opening_hours: '24/7' }, 'yes', 'osm:opening_hours=24/7'],
    [{ seasonal: 'winter;summer' }, 'yes', 'osm:seasonal=winter;summer'],
    [{ opening_hours: 'Nov-Mar' }, 'yes', 'osm:opening_hours=Nov-Mar'],
    [{ opening_hours: 'Jan-Dec' }, 'yes', 'osm:opening_hours=Jan-Dec'],
    [{ opening_hours: 'Apr-Oct' }, 'no', 'osm:opening_hours=Apr-Oct'],
    [
      { opening_hours: 'Apr 1 - Oct 31' },
      'no',
      'osm:opening_hours=Apr 1 - Oct 31',
    ],
    [{ seasonal: 'spring/summer' }, 'no', 'osm:seasonal=spring;summer'],
    [{ seasonal: 'summer' }, 'no', 'osm:seasonal=summer'],
  ])('%j → %s from %s', (tags, value, source) => {
    expect(mapTravelStyles(tags).winter).toEqual({ value, source });
  });

  it.each([
    // Says a season exists, not which one.
    [{ seasonal: 'yes' }],
    // Open for part of the winter: neither answer is true.
    [{ opening_hours: 'Feb-Nov' }],
    [{ opening_hours: 'Mar-Dec' }],
    // A grammar we do not read is not an answer.
    [{ opening_hours: 'Mo-Su 08:00-20:00' }],
    [{ opening_hours: 'Apr-Oct; Dec 20-Jan 5' }],
    [{ opening_hours: 'Apr-Oct "weather permitting"' }],
    [{ seasonal: 'dry_season' }],
    // Two tags that disagree are not an answer.
    [{ seasonal: 'no', opening_hours: 'Apr-Oct' }],
    [{}],
  ])('%j → no entry at all', (tags) => {
    expect(mapTravelStyles(tags)).not.toHaveProperty('winter');
  });
});

describe('mapTravelStyles: adults only', () => {
  it('min_age of 18 or more is the statement itself', () => {
    expect(mapTravelStyles({ min_age: '18' }).adultsOnly).toEqual({
      value: 'yes',
      source: 'osm:min_age=18',
    });
    expect(mapTravelStyles({ min_age: '21' }).adultsOnly?.value).toBe('yes');
  });
  it('a lower age is a recorded no; anything unreadable is nothing', () => {
    expect(mapTravelStyles({ min_age: '16' }).adultsOnly?.value).toBe('no');
    expect(mapTravelStyles({ min_age: 'adults' })).toEqual({});
    expect(mapTravelStyles({ min_age: '18+' })).toEqual({});
  });
});

describe('🔴 no style is invented from a neighbouring fact', () => {
  it('a playground, a curfew, a nudist beach and a road say nothing', () => {
    expect(
      mapTravelStyles({
        playground: 'yes',
        leisure: 'playground',
        quiet_time: '22:30-07:00',
        nudism: 'yes',
        group_only: 'yes',
        backcountry: 'yes',
        heating: 'stove',
        winter_storage: 'yes',
        highway: 'service',
      }),
    ).toEqual({});
  });

  it('every entry any rule can produce carries a source of the stored shape', () => {
    const produced = [
      { seasonal: 'no', min_age: '18' },
      { opening_hours: '24/7', min_age: '12' },
      { opening_hours: 'May 15 - Sep 15' },
      { seasonal: 'winter' },
    ].map((t) => mapTravelStyles(t));
    let entries = 0;
    for (const styles of produced) {
      for (const key of TRAVEL_STYLE_KEYS) {
        const e = styles[key];
        if (!e) continue;
        entries++;
        expect(e.source).toMatch(STYLE_SOURCE_PATTERN);
        expect(['yes', 'no']).toContain(e.value);
      }
    }
    // The loop above ran: 2 + 2 + 1 + 1.
    expect(entries).toBe(6);
  });
});
