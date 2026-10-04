import {
  hourStart,
  judgeStationCountry,
  newestSlotBasis,
  parseStation,
  pickStationReading,
  type RosterRow,
  type StationRejectReason,
} from './parse';

// CAMP-164, corrected by CAMP-195. This header used to assert that every
// test here fails if the line it covers is removed. 🔴 It was not true:
// eight lines could be deleted with all 59 tests still green, including
// both halves of the headline-disagreement check and both band bounds.
//
// The cause was redundancy, not sloppiness. Two guards that reject the
// same bad input pin each other, so deleting either alone changes
// nothing, and the one test that tripped both at once could not tell
// them apart. A test that cannot distinguish two guards is a test of
// neither.
//
// What is true now, and is the standard for anything added here: each
// guard has an input that reaches IT ALONE, and deleting that guard
// reddens EXACTLY ONE test. Two reds means the input is not isolating.
// Zero means there is no test. Mutations are named in the pull request.

/** A roster row exactly as the roster carries one. Overridden per test. */
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

function refusals(r: RosterRow): [StationRejectReason, string | undefined][] {
  const seen: [StationRejectReason, string | undefined][] = [];
  parseStation(r, (reason, detail) => seen.push([reason, detail]));
  return seen;
}

describe('parseStation', () => {
  it('reads a whole row into a storable station', () => {
    expect(parseStation(row())).toEqual({
      code: 'DEBB021',
      name: 'Berlin Neukölln',
      municipality: 'Berlin',
      country: 'de',
      type: 'background',
      area: 'Urban',
      lat: 52.4895,
      lon: 13.4386,
    });
  });

  // 🔴 THE ONE THAT COSTS A COUNTRY, kept honest in both directions.
  //
  // This roster spells Greece `GR` (58 stations, read 29.09.2026), but
  // the bathing water layer of the same agency spells it `EL` and lost
  // 1 734 of 22 010 rows to it. Nothing here may depend on which the
  // roster uses today.
  it('accepts Greece under the roster’s own GR', () => {
    expect(parseStation(row({ code: 'GR0010A' }))!.country).toBe('gr');
  });

  it('accepts Greece under the Eurostat code EL too, if the source ever changes', () => {
    expect(parseStation(row({ code: 'EL0010A' }))!.country).toBe('gr');
  });

  // The shared normaliser is what resolves a subdivision to its state;
  // this proves the air importer goes through it rather than through a
  // private list. (No Åland station carries `AX` today: FI stations
  // begin `FI`.)
  it('resolves a subdivision code that names a member state', () => {
    expect(parseStation(row({ code: 'AX0001A' }))!.country).toBe('fi');
  });

  // 🔴 The 13 prefixes found outside the Union are a DECISION, and are
  // refused as that — with the prefix, so the tally can say which.
  it.each([
    'AD',
    'AL',
    'BA',
    'CH',
    'GE',
    'IS',
    'ME',
    'MK',
    'NO',
    'RS',
    'TR',
    'UA',
    'XK',
  ])('refuses %s as outside the Union, naming the prefix', (prefix) => {
    expect(refusals(row({ code: `${prefix}0001A` }))).toEqual([
      ['outside-eu27', prefix],
    ]);
  });

  // 🔴 THE THIRD OUTCOME, AND THE ONE THAT MUST NEVER BE SILENT. A
  // prefix in neither list has not been decided about. Folding it into
  // "outside" is how a country vanishes with exit 0 — `UK`, `GB`, a typo,
  // a code the EEA invents.
  it.each(['UK', 'GB', 'ZZ', 'XX', 'LI'])(
    'refuses %s as UNRECOGNISED, not as outside the Union',
    (prefix) => {
      expect(refusals(row({ code: `${prefix}0001A` }))).toEqual([
        ['unrecognised-country', prefix],
      ]);
    },
  );

  it('judges the country before anything else about the row', () => {
    // Also malformed (no name): the prefix is still what gets reported.
    expect(refusals(row({ code: 'UK0001A', name: '' }))).toEqual([
      ['unrecognised-country', 'UK'],
    ]);
  });

  it('judgeStationCountry says which of the three it is', () => {
    expect(judgeStationCountry('FR')).toEqual({
      verdict: 'eu27',
      country: 'fr',
    });
    expect(judgeStationCountry('fr')).toEqual({
      verdict: 'eu27',
      country: 'fr',
    });
    expect(judgeStationCountry('EL')).toEqual({
      verdict: 'eu27',
      country: 'gr',
    });
    expect(judgeStationCountry('CH').verdict).toBe('outside-eu27');
    expect(judgeStationCountry('UK').verdict).toBe('unrecognised');
  });

  it('refuses a missing or malformed code', () => {
    expect(refusals(row({ code: undefined }))).toEqual([
      ['no-code', undefined],
    ]);
    expect(refusals(row({ code: '   ' }))).toEqual([['no-code', undefined]]);
    expect(refusals(row({ code: '12345' }))[0][0]).toBe('malformed-code');
    expect(refusals(row({ code: 'D' }))[0][0]).toBe('malformed-code');
    expect(refusals(row({ code: 'de0001a' }))[0][0]).toBe('malformed-code');
  });

  it('refuses a station that is not operational', () => {
    expect(refusals(row({ operational: 0 }))[0][0]).toBe('not-operational');
    expect(refusals(row({ operational: '1' }))[0][0]).toBe('not-operational');
    expect(refusals(row({ operational: undefined }))[0][0]).toBe(
      'not-operational',
    );
  });

  it('refuses a station with no name', () => {
    expect(refusals(row({ name: '' }))[0][0]).toBe('no-name');
    expect(refusals(row({ name: 7 }))[0][0]).toBe('no-name');
  });

  // 🔴 Refused, never defaulted. The page prints the kind beside the
  // distance because a traffic station's air is not a campsite's air; a
  // default of "background" would print the comfortable answer for a
  // kind nobody has looked at.
  it('refuses an unknown station kind instead of defaulting it', () => {
    expect(refusals(row({ station_type: 'Airport' }))).toEqual([
      ['unknown-station-type', 'Airport'],
    ]);
    expect(refusals(row({ station_type: undefined }))[0][0]).toBe(
      'unknown-station-type',
    );
  });

  it('reads the three kinds the roster carries', () => {
    expect(parseStation(row({ station_type: 'Traffic' }))!.type).toBe(
      'traffic',
    );
    expect(parseStation(row({ station_type: 'Industrial' }))!.type).toBe(
      'industrial',
    );
    expect(parseStation(row({ station_type: 'Background' }))!.type).toBe(
      'background',
    );
  });

  it('refuses no coordinates and coordinates that cannot be on Earth', () => {
    expect(refusals(row({ lat: null }))[0][0]).toBe('no-coordinates');
    expect(refusals(row({ lon: 'east' }))[0][0]).toBe('no-coordinates');
    expect(refusals(row({ lat: 91 }))[0][0]).toBe('coordinates-out-of-range');
    expect(refusals(row({ lon: -181 }))[0][0]).toBe('coordinates-out-of-range');
  });

  it('keeps a station whose optional fields are blank', () => {
    const s = parseStation(
      row({ municipality: '', area_classification: undefined }),
    );
    expect(s).not.toBeNull();
    expect(s!.municipality).toBeNull();
    expect(s!.area).toBeNull();
  });

  it('accepts coordinates given as numeric strings', () => {
    const s = parseStation(row({ lat: '52.4895', lon: '13.4386' }));
    expect(s!.lat).toBe(52.4895);
  });
});

// ---------------------------------------------------------------------
// Station files.
// ---------------------------------------------------------------------

/** 29.09.2026 19:35 UTC — the current hour is 19:00. */
const NOW = new Date('2026-09-29T19:35:00Z');

/** ISO key of the slot `h` whole hours before the current one. */
const key = (h: number): string =>
  new Date(hourStart(NOW) - h * 3_600_000).toISOString();

interface P {
  /** the pollutant's own index */
  aqi: number;
  val?: number;
  modelled?: 0 | 1;
}

/** One slot, built from per-pollutant values; the headline is the worst one. */
function slot(
  pollutants: Record<string, P>,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let worst = 0;
  let culprit = 'SO2';
  for (const [name, p] of Object.entries(pollutants)) {
    out[`aqi_${name}`] = p.aqi;
    out[`modelled_${name}`] = p.modelled ?? 0;
    out[`val_${name}`] = p.val ?? null;
    if (p.aqi > worst) {
      worst = p.aqi;
      culprit = name;
    }
  }
  out.culprit = culprit;
  out.aqi = worst;
  return { ...out, ...over };
}

const REPORTED = { PM10: { aqi: 2.2, val: 23 }, NO2: { aqi: 1.6, val: 14 } };
const MIXED = {
  PM10: { aqi: 2.2, val: 23 },
  NO2: { aqi: 2.7, val: 40, modelled: 1 as const },
};
const ALL_MODELLED = {
  PM10: { aqi: 2.2, val: 23, modelled: 1 as const },
  NO2: { aqi: 1.6, val: 14, modelled: 1 as const },
};

describe('pickStationReading', () => {
  it('reads a reported hour into a reading', () => {
    const { reading, malformedSlots } = pickStationReading(
      { [key(2)]: slot(REPORTED) },
      NOW,
    );
    expect(malformedSlots).toBe(0);
    expect(reading).toEqual({
      hour: key(2),
      index: 2.2,
      band: 2,
      basis: 'reported',
      culprit: 'PM10',
      pollutants: [
        { pollutant: 'PM10', band: 2, value: 23, modelled: false },
        { pollutant: 'NO2', band: 1, value: 14, modelled: false },
      ],
    });
  });

  // 🔴 THE CENTRAL RULE OF THE CARD, ON THE DATA'S OWN SHAPE.
  //
  // 240 of 240 stations sampled had a fully gap-filled slot for the
  // current hour and for the hour before it: nobody has reported an hour
  // that is not over. Taking the newest slot would file a model output
  // under a station's name and let the page say "as reported to the EEA"
  // over it. The newest slot in which something was REPORTED wins, and
  // the fully modelled ones above it are not readings.
  it('reads back past fully modelled hours to the newest one anything reported', () => {
    const { reading } = pickStationReading(
      {
        [key(1)]: slot(ALL_MODELLED),
        [key(2)]: slot(ALL_MODELLED),
        [key(3)]: slot(REPORTED),
        [key(4)]: slot({ PM10: { aqi: 1.1, val: 9 } }),
      },
      NOW,
    );
    expect(reading!.hour).toBe(key(3));
    expect(reading!.basis).toBe('reported');
  });

  it('files an hour with some pollutants reported and some modelled as mixed', () => {
    const { reading } = pickStationReading({ [key(2)]: slot(MIXED) }, NOW);
    expect(reading!.basis).toBe('mixed');
    expect(reading!.culprit).toBe('NO2');
    expect(reading!.band).toBe(2);
    expect(reading!.pollutants.map((p) => [p.pollutant, p.modelled])).toEqual([
      ['PM10', false],
      ['NO2', true],
    ]);
  });

  // A station whose every recent hour is a model estimate has NO reading;
  // it is not an error, and it must not be stored as one.
  it('has no reading when every hour is fully modelled, and calls that nothing wrong', () => {
    const { reading, malformedSlots } = pickStationReading(
      { [key(1)]: slot(ALL_MODELLED), [key(5)]: slot(ALL_MODELLED) },
      NOW,
    );
    expect(reading).toBeNull();
    expect(malformedSlots).toBe(0);
  });

  // 🔴 The hour in progress and everything after it are never observations.
  it('never reads the current hour, whatever its flags say', () => {
    const { reading } = pickStationReading(
      { [key(0)]: slot(REPORTED), [key(3)]: slot(MIXED) },
      NOW,
    );
    expect(reading!.hour).toBe(key(3));
  });

  it('never reads a forecast slot, even one that claims to be reported', () => {
    const { reading } = pickStationReading(
      { [key(-1)]: slot(REPORTED), [key(-20)]: slot(REPORTED) },
      NOW,
    );
    expect(reading).toBeNull();
  });

  // 🔴 `aqi: 0` is NO DATA, not the best air there is. ES2100A's newest
  // slot is `{"aqi": 0.0, …, "val_SO2": null}`.
  it('treats an index of 0 as no data and reads on', () => {
    const { reading, malformedSlots } = pickStationReading(
      {
        [key(1)]: slot({ SO2: { aqi: 0, val: undefined, modelled: 1 } }),
        [key(4)]: slot(REPORTED),
      },
      NOW,
    );
    expect(malformedSlots).toBe(0);
    expect(reading!.hour).toBe(key(4));
  });

  // 🔴 `modelled_SO2: 1` sits beside `aqi_SO2: 0.0` and `val_SO2: null`
  // in 79.2% of the files sampled: the flag is 1 when there is nothing
  // to flag.
  // Counting it would make a station that reported every pollutant it
  // measures look partly modelled over one it never had.
  it('does not count a pollutant with no index as modelled', () => {
    const { reading } = pickStationReading(
      {
        [key(2)]: slot({
          PM10: { aqi: 2.2, val: 23 },
          SO2: { aqi: 0, val: undefined, modelled: 1 },
        }),
      },
      NOW,
    );
    expect(reading!.basis).toBe('reported');
    expect(reading!.pollutants).toHaveLength(1);
  });

  // 🔴 An unrecognised flag is refused, never defaulted to "reported".
  it('refuses a slot whose modelled flag is neither 0 nor 1', () => {
    const bad = slot(REPORTED, { modelled_PM10: 'yes' });
    const { reading, malformedSlots } = pickStationReading(
      { [key(2)]: bad, [key(3)]: slot(REPORTED) },
      NOW,
    );
    expect(malformedSlots).toBe(1);
    expect(reading!.hour).toBe(key(3));
  });

  it('refuses a slot with a missing flag', () => {
    const bad = slot(REPORTED);
    delete bad.modelled_PM10;
    expect(pickStationReading({ [key(2)]: bad }, NOW)).toEqual({
      reading: null,
      malformedSlots: 1,
    });
  });

  it('refuses a slot where a pollutant has an index and no value', () => {
    const bad = slot({ PM10: { aqi: 2.2, val: undefined } });
    expect(pickStationReading({ [key(2)]: bad }, NOW).malformedSlots).toBe(1);
  });

  // The headline is its culprit's own index — true in 74 649 of 74 649
  // slots read. A slot where it is not is a file we have misunderstood.
  it('refuses a slot whose headline is not its culprit’s index', () => {
    const bad = slot(REPORTED, { aqi: 3.4 });
    expect(pickStationReading({ [key(2)]: bad }, NOW)).toEqual({
      reading: null,
      malformedSlots: 1,
    });
  });

  // 🔴 CAMP-195. The test above trips BOTH halves of that condition at
  // once, so neither half was pinned: deleting either one on its own left
  // 59/59 green, and the file header above claims the opposite. The four
  // cases below each trip exactly one guard, so each mutation reddens
  // exactly one test.

  // Only the `worst` half: the headline agrees with its named culprit, but
  // a louder pollutant sits in the same slot. Deleting the `worst` line
  // stores this as band 2 while NO2 stands at band 3 — the page would show
  // a calmer level than the data carries.
  it('refuses a slot whose headline is quieter than its worst pollutant', () => {
    const bad = slot(
      { PM10: { aqi: 2.2, val: 23 }, NO2: { aqi: 3.0, val: 40 } },
      { culprit: 'PM10', aqi: 2.2 },
    );
    expect(pickStationReading({ [key(2)]: bad }, NOW)).toEqual({
      reading: null,
      malformedSlots: 1,
    });
  });

  // Only the culprit half: the headline equals the worst index, but the
  // pollutant the file NAMES carries a different one. We would print a
  // true level beside the wrong cause.
  it('refuses a slot whose named culprit does not carry the headline', () => {
    const bad = slot(
      { PM10: { aqi: 2.2, val: 23 }, NO2: { aqi: 3.0, val: 40 } },
      { culprit: 'PM10' },
    );
    expect(pickStationReading({ [key(2)]: bad }, NOW)).toEqual({
      reading: null,
      malformedSlots: 1,
    });
  });

  // 🔴 The two band guards — one per pollutant at parse.ts:274, one on the
  // headline at parse.ts:298 — are REDUNDANT for an obvious input, and
  // that is why neither was pinned. `slot({ PM10: { aqi: 7.5 } })` is
  // refused by whichever of the two is left standing, so deleting either
  // one alone kept 63/63 green. A test that cannot tell them apart is not
  // a test of either. The two below each reach exactly one.

  // Reaches parse.ts:274 only: a pollutant lands in band 0 while the
  // headline, set by a different pollutant, stays inside the range — so
  // the headline guard never looks at it.
  it('refuses a slot where one pollutant falls below the first band', () => {
    const bad = slot({
      PM10: { aqi: 0.5, val: 3 },
      NO2: { aqi: 3.0, val: 40 },
    });
    expect(pickStationReading({ [key(2)]: bad }, NOW)).toEqual({
      reading: null,
      malformedSlots: 1,
    });
  });

  // Reaches parse.ts:298 only, through the gap SAME_INDEX leaves: every
  // pollutant is a legal band 6, and the headline is within the 1e-6
  // tolerance of the worst — yet its own floor is 7. Narrow, and the only
  // input that separates the headline guard from the per-pollutant one.
  // The highest index across 56 150 live values is 6.3338, so this is a
  // file we have misread, not an hour to publish.
  it('refuses a headline whose floor leaves the range its pollutants kept', () => {
    const bad = slot({ PM10: { aqi: 6.9999995, val: 99 } }, { aqi: 7 });
    expect(pickStationReading({ [key(2)]: bad }, NOW)).toEqual({
      reading: null,
      malformedSlots: 1,
    });
  });

  it('refuses a slot whose culprit is not one of its pollutants', () => {
    const bad = slot(REPORTED, { culprit: 'O3' });
    expect(pickStationReading({ [key(2)]: bad }, NOW).malformedSlots).toBe(1);
  });

  it('refuses a level outside 1–6', () => {
    const bad = slot({ PM10: { aqi: 7.1, val: 400 } });
    expect(pickStationReading({ [key(2)]: bad }, NOW).malformedSlots).toBe(1);
  });

  it('takes the level as the whole part of the index', () => {
    const top = pickStationReading(
      { [key(2)]: slot({ PM10: { aqi: 6.99, val: 300 } }) },
      NOW,
    );
    expect(top.reading!.band).toBe(6);
    const edge = pickStationReading(
      { [key(2)]: slot({ PM10: { aqi: 3.0, val: 46 } }) },
      NOW,
    );
    expect(edge.reading!.band).toBe(3);
  });

  it('costs one slot, not the file, for a slot that is not an object', () => {
    const { reading, malformedSlots } = pickStationReading(
      { [key(1)]: null, [key(2)]: 'x', [key(3)]: slot(REPORTED) },
      NOW,
    );
    expect(malformedSlots).toBe(2);
    expect(reading!.hour).toBe(key(3));
  });

  it('counts a slot whose key is not a time', () => {
    const { reading, malformedSlots } = pickStationReading(
      { nonsense: slot(REPORTED), [key(3)]: slot(REPORTED) },
      NOW,
    );
    expect(malformedSlots).toBe(1);
    expect(reading!.hour).toBe(key(3));
  });

  it.each([null, undefined, 'text', 42, [], [slot(REPORTED)]])(
    'gives nothing for a file that is not an object of slots (%#)',
    (file) => {
      expect(pickStationReading(file, NOW).reading).toBeNull();
    },
  );

  it('normalises the hour to ISO UTC', () => {
    const { reading } = pickStationReading(
      { '2026-09-29T16:00:00.000Z': slot(REPORTED) },
      NOW,
    );
    expect(reading!.hour).toBe('2026-09-29T16:00:00.000Z');
  });

  it('returns the newest reported hour however old it is', () => {
    // How old a reading may be is decided where it is shown. The parser
    // hands back the newest reported hour even when it is months old.
    const { reading } = pickStationReading(
      { '2025-12-30T22:00:00.000Z': slot(REPORTED) },
      NOW,
    );
    expect(reading!.hour).toBe('2025-12-30T22:00:00.000Z');
  });
});

describe('hourStart', () => {
  it('is the start of the hour, in UTC', () => {
    expect(
      new Date(hourStart(new Date('2026-09-29T19:59:59.999Z'))).toISOString(),
    ).toBe('2026-09-29T19:00:00.000Z');
    expect(
      new Date(hourStart(new Date('2026-09-29T20:00:00.000Z'))).toISOString(),
    ).toBe('2026-09-29T20:00:00.000Z');
  });
});

describe('newestSlotBasis (the lag report’s reading of a file)', () => {
  it('says modelled where the newest slot is entirely a model', () => {
    const f = { [key(0)]: slot(ALL_MODELLED), [key(3)]: slot(REPORTED) };
    expect(newestSlotBasis(f, hourStart(NOW) + 3_600_000)).toBe('modelled');
    expect(newestSlotBasis(f, hourStart(NOW))).toBe('reported');
    expect(newestSlotBasis({}, hourStart(NOW))).toBeNull();
  });
});
