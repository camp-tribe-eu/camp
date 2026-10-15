import {
  FUTURE_SLACK_SECONDS,
  loadDateVerdict,
  MAX_RECENT_SHARE,
  mergedRecord,
  MIN_RECORDS_TO_JUDGE,
  OSM_EPOCH_SECONDS,
  readRecordAge,
  recentShare,
  RECENT_WINDOW_HOURS,
  type RecordAge,
  type RecordEdit,
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

/** The object every record below is read from — a way, in `osm_ref`'s spelling. */
const REF = 'w4242';

describe('readRecordAge — one record, one date', () => {
  it('reads Unix seconds as the instant they are, in UTC', () => {
    const r = readRecordAge(1787953167, 4, RUN, REF);
    expect(r.edit?.editedAt.toISOString()).toBe('2026-08-28T21:39:27.000Z');
    expect(r.edit?.version).toBe(4);
    expect(r.problem).toBeNull();
  });

  it('🔴 is NOT the run date: the date it returns has nothing to do with `runStartedAt`', () => {
    // The card's named failure. The same stored value read at two
    // different run times gives the same date; only the future bound
    // moves.
    const a = readRecordAge(
      1560499200,
      1,
      new Date('2026-10-15T00:00:00Z'),
      REF,
    );
    const b = readRecordAge(
      1560499200,
      1,
      new Date('2027-01-01T00:00:00Z'),
      REF,
    );
    expect(a.edit?.editedAt.toISOString()).toBe('2019-06-14T08:00:00.000Z');
    expect(b.edit?.editedAt.toISOString()).toBe('2019-06-14T08:00:00.000Z');
  });

  it('reads the digit string pg returns for an int8 column', () => {
    const r = readRecordAge('1686737472', '7', RUN, REF);
    expect(r.edit?.editedAt.toISOString()).toBe('2023-06-14T10:11:12.000Z');
    expect(r.edit?.version).toBe(7);
  });

  it('a missing value is "not known" — null and undefined alike', () => {
    for (const raw of [null, undefined]) {
      const r = readRecordAge(raw, 4, RUN, REF);
      expect(r).toEqual({ edit: null, problem: 'missing' });
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
    const r = readRecordAge(raw, 4, RUN, REF);
    expect(r.edit).toBeNull();
    expect(r.problem).toBe('not-an-integer');
  });

  it('🔴 zero is the year 1970, not a date: a failed cast must not become one', () => {
    const r = readRecordAge(0, 4, RUN, REF);
    expect(r.edit).toBeNull();
    expect(r.problem).toBe('before-openstreetmap');
  });

  it('the first second of OpenStreetMap is accepted, the second before it is not', () => {
    // 2004-08-01T00:00:00Z = 1091318400, worked out separately.
    expect(OSM_EPOCH_SECONDS).toBe(1091318400);
    expect(readRecordAge(1091318400, 1, RUN, REF).problem).toBeNull();
    expect(readRecordAge(1091318399, 1, RUN, REF).problem).toBe(
      'before-openstreetmap',
    );
  });

  it('🔴 milliseconds read as seconds is a date in the future, and is refused', () => {
    const r = readRecordAge(1787953167000, 4, RUN, REF);
    expect(r.edit).toBeNull();
    expect(r.problem).toBe('in-the-future');
  });

  it('a timestamp a day past the run is still an edit; one second more is not', () => {
    const runSeconds = RUN.getTime() / 1000; // 1792094400
    expect(runSeconds).toBe(1792094400);
    expect(FUTURE_SLACK_SECONDS).toBe(86400);
    expect(readRecordAge(1792094400 + 86400, 1, RUN, REF).problem).toBeNull();
    expect(readRecordAge(1792094400 + 86401, 1, RUN, REF).problem).toBe(
      'in-the-future',
    );
  });

  it('a bad date takes its version with it: a version of nothing is not stored', () => {
    // "Not known" has no edit at all, so there is no version to be had from it.
    expect(readRecordAge('nonsense', 9, RUN, REF).edit).toBeNull();
    expect(readRecordAge(0, 9, RUN, REF).edit).toBeNull();
    expect(readRecordAge(null, 9, RUN, REF).edit).toBeNull();
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
      const r = readRecordAge(1787953167, v, RUN, REF);
      expect(r.edit?.editedAt.toISOString()).toBe('2026-08-28T21:39:27.000Z');
      expect(r.edit?.version).toBeNull();
      expect(r.problem).toBeNull();
    },
  );
});

describe('readRecordAge — the object a date belongs to', () => {
  it('🔴 the ref it returns is the one it was given, for each object — not a constant', () => {
    // Two different objects, two different refs: a function that returned a
    // fixed string, or the first ref it ever saw, would pass one of these.
    expect(readRecordAge(1787953167, 4, RUN, 'n7726104242').edit).toEqual({
      ref: 'n7726104242',
      editedAt: new Date('2026-08-28T21:39:27Z'),
      version: 4,
    });
    expect(readRecordAge(1787953167, 4, RUN, 'a37825860').edit?.ref).toBe(
      'a37825860',
    );
  });

  it.each([
    ['an empty string', ''],
    ['undefined', undefined],
    ['null', null],
    ['a number', 4242],
  ])(
    '🔴 a good date whose object is %s is NOT a date: no object to look it up on',
    (_what, ref) => {
      const r = readRecordAge(1787953167, 4, RUN, ref as unknown as string);
      expect(r).toEqual({ edit: null, problem: 'no-object' });
    },
  );
});

describe('🔴 an edit is one value: its ref cannot be left out', () => {
  // Checked by the compiler, and ts-jest runs it: each directive below is
  // itself an assertion. If the type ever lets the line through, "Unused
  // '@ts-expect-error' directive" stops this whole file from compiling.
  //
  // What these CANNOT show is `ref: null` or `editedAt: null` written out:
  // this workspace has `strictNullChecks: false`, where null is a value of
  // every type. That is why "not known" is the absence of the whole edit
  // (`edit: null`) rather than a half-filled one — and why readRecordAge
  // refuses a date whose ref is not a non-empty string (above).
  it('a date with no ref, a ref with no date, and a ref with no version are not values', () => {
    // @ts-expect-error a date and a version with no ref: a pair nobody can look up
    const noRef: RecordEdit = { editedAt: new Date(0), version: 1 };
    // @ts-expect-error a ref with no date
    const noDate: RecordEdit = { ref: 'w1', version: 1 };
    // @ts-expect-error the version is stated, even when it is "none"
    const noVersion: RecordEdit = { ref: 'w1', editedAt: new Date(0) };
    // @ts-expect-error the old flat shape: a date beside no edit at all
    const flat: RecordAge = { editedAt: new Date(0), problem: null };
    expect([noRef, noDate, noVersion, flat]).toHaveLength(4);
  });

  it('the two legal shapes compile: a whole edit, and no edit with the reason', () => {
    const dated: RecordAge = {
      edit: {
        ref: 'w2',
        editedAt: new Date('2012-03-04T05:06:07Z'),
        version: 9,
      },
      problem: null,
    };
    const unknown: RecordAge = { edit: null, problem: 'missing' };
    expect(dated.edit?.ref).toBe('w2');
    expect(unknown.edit).toBeNull();
  });
});

describe('mergedRecord — a row built from several objects', () => {
  /** A dated record, written out, for the object `ref`. */
  const rec = (
    ref: string,
    iso: string,
    version: number | null,
  ): RecordAge => ({
    edit: { ref, editedAt: new Date(iso), version },
    problem: null,
  });
  const UNDATED: RecordAge = { edit: null, problem: 'missing' };

  // Review's case, through the function that decides it. The way w2 holds the
  // row (its id is `osm_ref`); the node n1 is the newer object.
  const W2 = rec('w2', '2012-04-05T06:07:08Z', 9);
  const N1 = rec('n1', '2026-09-30T10:11:12Z', 2);

  it('🔴 the newer object is the WHOLE result — its date, its version and its ref, as one edit', () => {
    expect(mergedRecord(W2, N1)).toEqual({
      edit: {
        ref: 'n1',
        editedAt: new Date('2026-09-30T10:11:12Z'),
        version: 2,
      },
      problem: null,
    });
  });

  it('🔴 …and the older one is not: the kept object keeps its own ref when it is the newer', () => {
    expect(mergedRecord(N1, W2)).toEqual(N1);
    const newerWay = rec('w2', '2026-10-01T00:00:00Z', 9);
    expect(mergedRecord(newerWay, N1)).toEqual(newerWay);
  });

  it('a tie keeps the first argument — the kept object — so the ref stays osm_ref', () => {
    const twin = rec('n1', '2012-04-05T06:07:08Z', 4);
    expect(mergedRecord(W2, twin)).toEqual(W2);
    expect(mergedRecord(W2, twin)?.edit?.ref).toBe('w2');
  });

  it('three objects, merged one after another: the newest of all, with its own ref', () => {
    const n3 = rec('n3', '2024-01-02T03:04:05Z', 4);
    const first = mergedRecord(W2, n3);
    expect(first?.edit?.ref).toBe('n3');
    expect(mergedRecord(first, N1)).toEqual(N1);
    // …in the other order too.
    expect(mergedRecord(mergedRecord(W2, N1), n3)).toEqual(N1);
  });

  it('🔴 if ANY object is undated the result is not known — no date, no version, no ref', () => {
    for (const merged of [
      mergedRecord(W2, UNDATED),
      mergedRecord(UNDATED, W2),
      mergedRecord(UNDATED, UNDATED),
    ]) {
      expect(merged).toEqual({ edit: null, problem: 'missing' });
    }
  });

  it('keeps the first problem it is told about, and says nothing for two hand-built rows', () => {
    const bad: RecordAge = { edit: null, problem: 'in-the-future' };
    expect(mergedRecord(W2, bad)?.problem).toBe('in-the-future');
    expect(mergedRecord(undefined, undefined)).toBeUndefined();
  });

  it('🔴 PROPERTY: whatever the dates, the result is one input, whole — never a date of one object with the ref of another', () => {
    // A small deterministic generator (an LCG), so a failure repeats. 2 000
    // pairs of dated records: distinct refs, dates on 400 distinct days (so
    // ties happen), versions 1..40.
    let seed = 20261016;
    const next = (n: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      // The HIGH bits: an LCG's low bits cycle with a tiny period.
      return Math.floor(seed / 65536) % n;
    };
    const dated = (ref: string): RecordAge => ({
      edit: {
        ref,
        editedAt: new Date(Date.UTC(2025, 0, 1) + next(400) * 86_400_000),
        version: 1 + next(40),
      },
      problem: null,
    });
    let strictlyNewer = 0;
    let ties = 0;
    for (let i = 0; i < 2000; i++) {
      const a = dated(`w${i}`);
      const b = dated(`n${i}`);
      const merged = mergedRecord(a, b);
      const aT = a.edit!.editedAt.getTime();
      const bT = b.edit!.editedAt.getTime();
      // It IS the one with the later date — and on a tie, the first — and it
      // is that input itself, so its date, version and ref cannot have been
      // taken from two different objects.
      expect(merged).toBe(bT > aT ? b : a);
      if (bT > aT) strictlyNewer++;
      if (aT === bT) ties++;
    }
    // Anchor: the generator really produced both branches and some ties, or
    // "always the first argument" would pass.
    expect(strictlyNewer).toBeGreaterThan(800);
    expect(strictlyNewer).toBeLessThan(1200);
    expect(ties).toBeGreaterThan(0);
  });
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

  it('🔴 the floor is a property of the rule, not of any country: n identical fresh dates are refused for EVERY n from 10 to 400, and for no n below', () => {
    // It was "Malta has 13 dated records, and 13 identical dates are refused":
    // a number about live data (it moves, and the comments disagreed on it),
    // which says nothing about 11, 12 or 14. At a floor of 100 the smallest
    // countries were the one place a substituted date loaded unnoticed, so the
    // property is: whatever size a country has, from the floor up, it is judged.
    // 10 is typed here — the floor itself, not read from the module.
    const wrong: number[] = [];
    for (let n = 0; n <= 400; n++) {
      const refused =
        loadDateVerdict(
          Array.from({ length: n }, () => hoursBefore(1)),
          RUN,
        ) !== null;
      if (refused !== n >= 10) wrong.push(n);
    }
    expect(wrong).toEqual([]);
  });

  it('judges nothing below the minimum: nine identical dates are not a verdict', () => {
    expect(MIN_RECORDS_TO_JUDGE).toBe(10);
    const nine = Array.from({ length: 9 }, () => hoursBefore(1));
    expect(loadDateVerdict(nine, RUN)).toBeNull();
    const ten = Array.from({ length: 10 }, () => hoursBefore(1));
    expect(loadDateVerdict(ten, RUN)).not.toBeNull();
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

  it('records with no date are not in the sum: 9 dated and 5 000 not is too few to judge', () => {
    const dates = [
      ...Array.from({ length: 9 }, () => hoursBefore(1)),
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
