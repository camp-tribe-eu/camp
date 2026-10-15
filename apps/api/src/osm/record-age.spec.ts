import {
  FUTURE_SLACK_SECONDS,
  loadDateVerdict,
  MAX_RECENT_SHARE,
  MIN_RECORDS_TO_JUDGE,
  OSM_EPOCH_SECONDS,
  readRecordAge,
  recentShare,
  RECENT_WINDOW_HOURS,
} from './record-age';

// CAMP-256 — the edit date of an OpenStreetMap record, read from staging.
//
// 🔴 EVERY EXPECTED VALUE BELOW IS TYPED, not derived. `1787953167` is what
// `osmium export -a timestamp` wrote for Rinella Scout Centre on Malta
// (15.10.2026), and `2026-08-28T21:39:27.000Z` is that instant written out
// separately — worked out with Python's calendar.timegm, which shares no
// code with `readRecordAge`. A test that built its expectation from the
// function's own constants would move with a mutation of them.

/** The importer's start, in every case that needs one. A Thursday. */
const RUN = new Date('2026-10-15T20:00:00.000Z');

describe('readRecordAge — one record, one date', () => {
  it('reads Unix seconds as the instant they are, in UTC', () => {
    const r = readRecordAge(1787953167, 4, RUN);
    expect(r.editedAt?.toISOString()).toBe('2026-08-28T21:39:27.000Z');
    expect(r.version).toBe(4);
    expect(r.problem).toBeNull();
  });

  it('🔴 is NOT the run date: the date it returns has nothing to do with `runStartedAt`', () => {
    // The card's named failure. The same stored value read at two
    // different run times gives the same date; only the future bound
    // moves.
    const a = readRecordAge(1560499200, 1, new Date('2026-10-15T00:00:00Z'));
    const b = readRecordAge(1560499200, 1, new Date('2027-01-01T00:00:00Z'));
    expect(a.editedAt?.toISOString()).toBe('2019-06-14T08:00:00.000Z');
    expect(b.editedAt?.toISOString()).toBe('2019-06-14T08:00:00.000Z');
  });

  it('reads the digit string pg returns for an int8 column', () => {
    const r = readRecordAge('1686737472', '7', RUN);
    expect(r.editedAt?.toISOString()).toBe('2023-06-14T10:11:12.000Z');
    expect(r.version).toBe(7);
  });

  it('a missing value is "not known" — null and undefined alike', () => {
    for (const raw of [null, undefined]) {
      const r = readRecordAge(raw, 4, RUN);
      expect(r).toEqual({ editedAt: null, version: null, problem: 'missing' });
    }
  });

  it.each([
    ['an ISO date string', '2026-08-28T21:39:27Z'],
    ['a decimal', 1787953167.5],
    ['exponent notation', '1.787953167e9'],
    ['a negative number', -1],
    ['NaN', Number.NaN],
    ['an empty string', ''],
    ['an object', {}],
  ])('refuses %s, and says it was not an integer', (_what, raw) => {
    const r = readRecordAge(raw, 4, RUN);
    expect(r.editedAt).toBeNull();
    expect(r.problem).toBe('not-an-integer');
  });

  it('🔴 zero is the year 1970, not a date: a failed cast must not become one', () => {
    const r = readRecordAge(0, 4, RUN);
    expect(r.editedAt).toBeNull();
    expect(r.problem).toBe('before-openstreetmap');
  });

  it('the first second of OpenStreetMap is accepted, the second before it is not', () => {
    // 2004-08-01T00:00:00Z = 1091318400, worked out separately.
    expect(OSM_EPOCH_SECONDS).toBe(1091318400);
    expect(readRecordAge(1091318400, 1, RUN).problem).toBeNull();
    expect(readRecordAge(1091318399, 1, RUN).problem).toBe(
      'before-openstreetmap',
    );
  });

  it('🔴 milliseconds read as seconds is a date in the future, and is refused', () => {
    const r = readRecordAge(1787953167000, 4, RUN);
    expect(r.editedAt).toBeNull();
    expect(r.problem).toBe('in-the-future');
  });

  it('a timestamp a day past the run is still an edit; one second more is not', () => {
    const runSeconds = RUN.getTime() / 1000; // 1792094400
    expect(runSeconds).toBe(1792094400);
    expect(FUTURE_SLACK_SECONDS).toBe(86400);
    expect(readRecordAge(1792094400 + 86400, 1, RUN).problem).toBeNull();
    expect(readRecordAge(1792094400 + 86401, 1, RUN).problem).toBe(
      'in-the-future',
    );
  });

  it('a bad date takes its version with it: a version of nothing is not stored', () => {
    expect(readRecordAge('nonsense', 9, RUN).version).toBeNull();
    expect(readRecordAge(0, 9, RUN).version).toBeNull();
    expect(readRecordAge(null, 9, RUN).version).toBeNull();
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['zero', 0],
    ['negative', -3],
    ['a decimal', 2.5],
    ['text', 'four'],
  ])(
    'a good date with a %s version keeps the date and drops only the version',
    (_w, v) => {
      const r = readRecordAge(1787953167, v, RUN);
      expect(r.editedAt?.toISOString()).toBe('2026-08-28T21:39:27.000Z');
      expect(r.version).toBeNull();
      expect(r.problem).toBeNull();
    },
  );
});

describe('recentShare — who claims to have been edited this week', () => {
  const hoursBefore = (h: number) => new Date(RUN.getTime() - h * 3_600_000);

  it('counts dated records only, and the window is forty-eight hours', () => {
    expect(RECENT_WINDOW_HOURS).toBe(48);
    const s = recentShare(
      [hoursBefore(1), hoursBefore(48), hoursBefore(48.01), null, null],
      RUN,
    );
    expect(s).toEqual({ dated: 3, recent: 2 });
  });

  it('a date up to a day after the run — the slack readRecordAge allows — is as recent as an edit gets', () => {
    const s = recentShare([new Date(RUN.getTime() + 3_600_000)], RUN);
    expect(s).toEqual({ dated: 1, recent: 1 });
  });
});

describe('loadDateVerdict — do these look like edit dates, or like today?', () => {
  const hoursBefore = (h: number) => new Date(RUN.getTime() - h * 3_600_000);

  /** `n` dates spread over eight years, none within the last 48 hours. */
  const spread = (n: number): Date[] =>
    Array.from({ length: n }, (_, i) => hoursBefore(100 + i * 14));

  it('🔴 refuses a country in which every record claims an edit this week', () => {
    // The load date written over every row: 200 records, all one hour old.
    const dates = Array.from({ length: 200 }, () => hoursBefore(1));
    const verdict = loadDateVerdict(dates, RUN);
    expect(verdict).not.toBeNull();
    expect(verdict).toContain('200 of 200');
    expect(verdict).toContain('load date');
  });

  it('lets a real spread of dates through', () => {
    expect(loadDateVerdict(spread(500), RUN)).toBeNull();
  });

  it('judges nothing below the minimum: ninety-nine identical dates are not a verdict', () => {
    expect(MIN_RECORDS_TO_JUDGE).toBe(100);
    const ninetyNine = Array.from({ length: 99 }, () => hoursBefore(1));
    expect(loadDateVerdict(ninetyNine, RUN)).toBeNull();
    const hundred = Array.from({ length: 100 }, () => hoursBefore(1));
    expect(loadDateVerdict(hundred, RUN)).not.toBeNull();
  });

  it('the line is 90%: 180 of 200 recent is refused, 179 of 200 is not', () => {
    expect(MAX_RECENT_SHARE).toBe(0.9);
    const mixed = (recent: number) => [
      ...Array.from({ length: recent }, () => hoursBefore(1)),
      ...spread(200 - recent),
    ];
    expect(loadDateVerdict(mixed(180), RUN)).not.toBeNull();
    expect(loadDateVerdict(mixed(179), RUN)).toBeNull();
  });

  it('records with no date are not in the sum: 50 dated and 5 000 not is too few to judge', () => {
    const dates = [
      ...Array.from({ length: 50 }, () => hoursBefore(1)),
      ...Array.from({ length: 5000 }, () => null),
    ];
    expect(loadDateVerdict(dates, RUN)).toBeNull();
  });

  it('…and 150 recent dates among 5 000 undated ones are judged on the 150', () => {
    const dates = [
      ...Array.from({ length: 150 }, () => hoursBefore(1)),
      ...Array.from({ length: 5000 }, () => null),
    ];
    expect(loadDateVerdict(dates, RUN)).not.toBeNull();
  });

  it('a country with no dates at all is not refused for it — that is a different, louder line', () => {
    expect(
      loadDateVerdict(
        Array.from({ length: 500 }, () => null),
        RUN,
      ),
    ).toBeNull();
    expect(loadDateVerdict([], RUN)).toBeNull();
  });
});
