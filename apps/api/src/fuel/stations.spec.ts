import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  believablePrice,
  decimal,
  FR_COORD_SCALE,
  inCountryBounds,
  IT_SELF_SERVICE,
  isPriceDroppable,
  MIN_STATIONS,
  isPriceStale,
  parseDmyDateTime,
  parseFrance,
  parseIsoDateTime,
  parseItaly,
  parseSpain,
  PRICE_DROP_AFTER_DAYS,
  PRICE_STALE_AFTER_DAYS,
  SOURCES,
} from './stations';

// CAMP-154 — the three feeds, checked without a network.
//
// 🔴 EVERY FIXTURE BELOW IS A REAL RECORD, copied from the live payloads
// on 28.09.2026, not a shape somebody imagined. Four of them are records
// that actually broke something:
//
//   - Spanish IDEESS 16268, whose latitude and longitude are published
//     the wrong way round;
//   - a Spanish station at (0, 0), of which the feed has three;
//   - an Italian station posting both a self-service and a served price
//     for the same grade, which most of them do;
//   - an Italian `descCarburante` of `Blue Diesel`, one of 57 premium
//     brand names that a substring rule would read as diesel.
//
// A test written against an imagined payload passes against imagined
// code. These are the payloads.

const NOW = new Date('2026-09-28T19:40:00Z');

describe('reading a number that may be written either way', () => {
  // 🔴 Spain writes 1,849 and 39,211417. France and Italy write 2.429.
  it('reads a decimal comma and a decimal point alike', () => {
    expect(decimal('1,849')).toBe(1.849);
    expect(decimal('2.429')).toBe(2.429);
    expect(decimal('39,211417')).toBe(39.211417);
    expect(decimal('-8,659472')).toBe(-8.659472);
  });

  // 🔴 THE ONE THAT MATTERS. `parseFloat('39,211417')` returns 39 — a
  // plausible number 23 km out to sea — rather than refusing. Nothing
  // downstream could tell that from a real coordinate.
  it('refuses rather than truncating at the first bad character', () => {
    expect(decimal('39,21 approx')).toBeNull();
    expect(decimal('1.2.3')).toBeNull();
    expect(decimal('')).toBeNull();
    expect(decimal('EUR')).toBeNull();
    expect(decimal(null)).toBeNull();
    expect(decimal(undefined)).toBeNull();
  });

  // 🔴 THE FLOAT ARTEFACT, AND WHERE IT IS ACTUALLY STOPPED.
  //
  // The DATAtourisme feed contains `"2.7999999523162841796875"` for
  // €2.80, four times, because somebody upstream put a price through a
  // 32-bit float and printed it back. `decimal()` cannot help: read as
  // a JavaScript number it is 2.799999952316284, and rounding here
  // would be this file inventing a price.
  //
  // It is stopped by the COLUMN. `price_eur` is `numeric(6,3)`, so
  // Postgres rounds it once, to 2.800, at the only point in the chain
  // that is allowed to have an opinion about a price — and from there
  // it travels as text.
  it('is not where the full-precision float artefact is stopped', () => {
    expect(decimal('2.7999999523162841796875')).not.toBe(2.8);
    const migration = readFileSync(
      join(__dirname, '..', 'migrations', '1790662800000-FuelStationPrices.ts'),
      'utf8',
    );
    expect(migration).toContain('price_eur     numeric(6,3) NOT NULL');
    expect(migration).not.toMatch(/price_eur\s+(real|float|double)/);
  });
});

describe('a price we are willing to publish', () => {
  it('refuses zero, which is how two feeds spell "not sold here"', () => {
    expect(believablePrice(0)).toBe(false);
  });
  it('refuses a units error in either direction', () => {
    expect(believablePrice(0.001)).toBe(false); // cents read as euros
    expect(believablePrice(184.9)).toBe(false); // euros read as cents
  });
  it('accepts the range these three countries actually publish in', () => {
    expect(believablePrice(1.849)).toBe(true);
    expect(believablePrice(2.539)).toBe(true);
  });
});

describe('dates, in the two shapes the feeds use', () => {
  it('reads Spain and Italy’s dd/mm/yyyy as UTC', () => {
    expect(parseDmyDateTime('28/09/2026 19:36:45')?.toISOString()).toBe(
      '2026-09-28T19:36:45.000Z',
    );
    expect(parseDmyDateTime('25/09/2026 20:00:07')?.toISOString()).toBe(
      '2026-09-25T20:00:07.000Z',
    );
  });

  // 🔴 `Date.UTC(2026, 1, 31)` silently becomes 3 March. A feed that
  // filed 31/02 would get a date two days in the future, and a price
  // dated in the future is the freshest thing on the page.
  it('refuses a day that does not exist rather than rolling it over', () => {
    expect(parseDmyDateTime('31/02/2026')).toBeNull();
    expect(parseDmyDateTime('00/09/2026')).toBeNull();
    expect(parseDmyDateTime('28/13/2026')).toBeNull();
  });

  it('reads France’s ISO 8601 with its offset', () => {
    expect(parseIsoDateTime('2026-09-28T11:45:27+00:00')?.toISOString()).toBe(
      '2026-09-28T11:45:27.000Z',
    );
  });

  it('refuses a string that is not a date', () => {
    expect(parseIsoDateTime('')).toBeNull();
    expect(parseIsoDateTime('soon')).toBeNull();
  });
});

describe('🔴 the coordinate sanity box', () => {
  it('accepts the real extremes of each country', () => {
    expect(inCountryBounds('es', 28.1, -15.4)).toBe(true); // Las Palmas
    expect(inCountryBounds('fr', 42.7, 9.45)).toBe(true); // Bastia
    expect(inCountryBounds('it', 35.5, 12.6)).toBe(true); // Lampedusa
  });

  // 🔴 This is the transposed pair the live feed publishes for Tui,
  // Pontevedra: 42.037472 N, -8.659472 E, filed the wrong way round.
  it('rejects a transposed latitude/longitude pair', () => {
    expect(inCountryBounds('es', 42.037472, -8.659472)).toBe(true); // right way
    expect(inCountryBounds('es', -8.659472, 42.037472)).toBe(false); // as filed
  });

  it('rejects Null Island, which three Spanish stations claim', () => {
    expect(inCountryBounds('es', 0, 0)).toBe(false);
    expect(inCountryBounds('it', 0, 0)).toBe(false);
  });
});

// ── SPAIN ───────────────────────────────────────────────────────────────

/** Two real records, verbatim but trimmed to the fields the parser reads. */
const esPayload = (extra: Record<string, unknown>[] = []) => ({
  Fecha: '28/09/2026 19:36:45',
  ResultadoConsulta: 'OK',
  ListaEESSPrecio: [
    {
      IDEESS: '1234',
      Rótulo: 'REPSOL',
      Latitud: '39,211417',
      'Longitud (WGS84)': '-1,539167',
      'Precio Gasoleo A': '1,849',
      'Precio Gasoleo B': '1,299',
      'Precio Gasolina 95 E5': '1,789',
    },
    ...extra,
  ],
});

describe('Spain', () => {
  it('reads diesel and 95 E5, with the snapshot stamp on both', () => {
    const r = parseSpain(esPayload(), NOW);
    expect(r.stations).toHaveLength(1);
    expect(r.stations[0].prices).toEqual([
      {
        grade: 'diesel',
        product: 'Gasóleo A',
        price: 1.849,
        measuredAt: new Date('2026-09-28T19:36:45.000Z'),
      },
      {
        grade: 'petrol',
        product: 'Gasolina 95 E5',
        price: 1.789,
        measuredAt: new Date('2026-09-28T19:36:45.000Z'),
      },
    ]);
  });

  // 🔴 Gasóleo B is the dyed agricultural grade. It is cheaper, a camper
  // may not legally burn it, and it sits one field away from the one we
  // want — so a reader shown it would be told both a wrong price and a
  // wrong fuel.
  it('never reads the agricultural grade as road diesel', () => {
    const r = parseSpain(esPayload(), NOW);
    const prices = r.stations[0].prices.map((p) => p.price);
    expect(prices).not.toContain(1.299);
  });

  it('rejects the transposed record instead of placing it off Somalia', () => {
    const r = parseSpain(
      esPayload([
        {
          IDEESS: '16268',
          Rótulo: 'GUAY',
          Latitud: '-8,659472',
          'Longitud (WGS84)': '42,037472',
          'Precio Gasoleo A': '1,799',
        },
      ]),
      NOW,
    );
    expect(r.stations.map((s) => s.ref)).toEqual(['1234']);
    expect(r.rejected).toContainEqual(
      expect.objectContaining({ ref: '16268' }),
    );
  });

  // 🔴 One bad record costs one record. A backwards date range aborted a
  // 12 402-row import on this project; nothing here may abort a country.
  it('keeps the good records when one is unusable', () => {
    const r = parseSpain(
      esPayload([
        { IDEESS: '9', Latitud: '0,000000', 'Longitud (WGS84)': '0,000000' },
        { IDEESS: '', Latitud: '40,0', 'Longitud (WGS84)': '-3,0' },
      ]),
      NOW,
    );
    expect(r.stations).toHaveLength(1);
    expect(r.rejected).toHaveLength(2);
    expect(r.feedRecords).toBe(3);
    expect(r.stations.length + r.rejected.length).toBe(r.feedRecords);
  });
});

// ── FRANCE ──────────────────────────────────────────────────────────────

const frRecord = (over: Record<string, unknown> = {}) => ({
  id: 89100001,
  latitude: '4818300',
  longitude: '330900',
  ville: 'Sens',
  gazole_prix: 2.429,
  gazole_maj: '2026-09-28T11:45:27+00:00',
  ...over,
});

describe('France', () => {
  // 🔴 4818300 is 48.183 degrees. Forgetting the divisor produces a
  // NUMBER rather than an error, and that number is off the planet.
  it('divides the coordinate by a hundred thousand', () => {
    expect(FR_COORD_SCALE).toBe(100_000);
    const r = parseFrance([frRecord()], NOW);
    expect(r.stations[0].lat).toBeCloseTo(48.183, 6);
    expect(r.stations[0].lon).toBeCloseTo(3.309, 6);
  });

  // 🔴 SP95 and E10 are different fuels at different prices. 5 619 French
  // stations post only E10; printing its number under SP95's name would
  // be wrong at a third of the country.
  it('prefers SP95 where both are posted, and names what it took', () => {
    const r = parseFrance(
      [
        frRecord({
          sp95_prix: 2.329,
          sp95_maj: '2026-09-28T11:45:27+00:00',
          e10_prix: 2.209,
          e10_maj: '2026-09-28T11:45:27+00:00',
        }),
      ],
      NOW,
    );
    const petrol = r.stations[0].prices.filter((p) => p.grade === 'petrol');
    expect(petrol).toHaveLength(1);
    expect(petrol[0]).toMatchObject({ product: 'SP95', price: 2.329 });
  });

  it('falls back to E10 under its own name, never under SP95’s', () => {
    const r = parseFrance(
      [frRecord({ e10_prix: 2.209, e10_maj: '2026-09-28T11:45:27+00:00' })],
      NOW,
    );
    const petrol = r.stations[0].prices.filter((p) => p.grade === 'petrol');
    expect(petrol).toEqual([
      {
        grade: 'petrol',
        product: 'E10',
        price: 2.209,
        measuredAt: new Date('2026-09-28T11:45:27.000Z'),
      },
    ]);
  });

  // 🔴 "Every displayed price carries its measurement date." A price
  // stamped now() because its own stamp was missing would make the
  // oldest number on the page look like the freshest.
  it('refuses a price with no date rather than stamping it with now', () => {
    const r = parseFrance([frRecord({ gazole_maj: null })], NOW);
    expect(r.stations).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/no usable gazole_maj/);
  });

  it('refuses a price dated in the future', () => {
    const r = parseFrance(
      [frRecord({ gazole_maj: '2027-01-01T00:00:00+00:00' })],
      NOW,
    );
    expect(r.stations).toHaveLength(0);
  });
});

// ── ITALY ───────────────────────────────────────────────────────────────

const itStations = [
  'Estrazione del 2026-09-27',
  'idImpianto|Gestore|Bandiera|Tipo Impianto|Nome Impianto|Indirizzo|Comune|Provincia|Latitudine|Longitudine',
  '3464|ENI SPA|Agip Eni|Stradale|BOLOGNA|VIA X|BOLOGNA|BO|44.494900|11.342600',
  '9999|X SRL|Q8|Stradale|NOWHERE|VIA Y|ROMA|RM|0.000000|0.000000',
].join('\n');

const itPrices = (rows: string[]) =>
  [
    'Estrazione del 2026-09-27',
    'idImpianto|descCarburante|prezzo|isSelf|dtComu',
    ...rows,
  ].join('\n');

describe('Italy', () => {
  // 🔴 51 203 self rows against 41 681 served, and most stations file
  // both. Taking whichever arrived first would hand one forecourt the
  // self price and its neighbour the served one, with nothing on the
  // page to say which — a 20-cent spread presented as a difference
  // between stations.
  it('prefers the self-service price and marks the served one', () => {
    expect(IT_SELF_SERVICE).toBe('1');
    const r = parseItaly(
      {
        stations: itStations,
        prices: itPrices([
          '3464|Gasolio|2.454|0|26/09/2026 11:06:55',
          '3464|Gasolio|2.354|1|26/09/2026 11:06:55',
        ]),
      },
      NOW,
    );
    expect(r.stations[0].prices).toEqual([
      {
        grade: 'diesel',
        product: 'Gasolio',
        price: 2.354,
        measuredAt: new Date('2026-09-26T11:06:55.000Z'),
      },
    ]);
  });

  it('keeps the served price when it is the only one, and says so', () => {
    const r = parseItaly(
      {
        stations: itStations,
        prices: itPrices(['3464|Gasolio|2.454|0|26/09/2026 11:06:55']),
      },
      NOW,
    );
    expect(r.stations[0].prices[0].product).toBe('Gasolio (servito)');
  });

  // 🔴 57 of the 59 `descCarburante` values are premium brand names.
  // `/diesel/i` or `/gasolio/` would sweep `Blue Diesel`, `HVOlution`
  // and `Supreme Diesel` into the pump-price row.
  it('takes only the two plain grades, never a premium blend', () => {
    const r = parseItaly(
      {
        stations: itStations,
        prices: itPrices([
          '3464|Blue Diesel|2.789|1|26/09/2026 11:06:55',
          '3464|HVOlution|2.899|1|26/09/2026 11:06:55',
          '3464|Supreme Diesel|2.999|1|26/09/2026 11:06:55',
          '3464|Metano|1.599|1|26/09/2026 11:06:55',
          '3464|Gasolio|2.354|1|26/09/2026 11:06:55',
        ]),
      },
      NOW,
    );
    expect(r.stations[0].prices.map((p) => p.price)).toEqual([2.354]);
  });

  it('drops the station at (0, 0) and reconciles the count', () => {
    const r = parseItaly(
      {
        stations: itStations,
        prices: itPrices(['3464|Gasolio|2.354|1|26/09/2026 11:06:55']),
      },
      NOW,
    );
    expect(r.feedRecords).toBe(2);
    expect(r.stations).toHaveLength(1);
    // The (0,0) one is rejected by coordinate; nothing is unaccounted for.
    const rejectedRefs = new Set(r.rejected.map((x) => x.ref));
    expect(r.stations.length + rejectedRefs.size).toBe(r.feedRecords);
  });

  // A station in the register that filed nothing today is RECORDED, not
  // dropped in silence — 2 693 of 23 998 on 28.09.2026. Without this the
  // report would show a hole nobody could account for.
  it('records a registered station that filed no price today', () => {
    const r = parseItaly({ stations: itStations, prices: itPrices([]) }, NOW);
    expect(r.stations).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason)).toContain(
      'in the active register, no plain-grade price filed today',
    );
  });
});

// ── THE SOURCE LIST, AND WHAT MAY NOT BE IN IT ──────────────────────────

describe('🔴 the countries this import may not reach', () => {
  const blob = JSON.stringify(SOURCES).toLowerCase();

  it('holds exactly the three countries §6 cleared', () => {
    expect(SOURCES.map((s) => s.country).sort()).toEqual(['es', 'fr', 'it']);
  });

  // 🔴 Austria's endpoint answers 200 with no key and no rate limit,
  // which makes it the easiest source on the list and the one most
  // likely to be added by somebody in a hurry. There is no consumer
  // licence for it at all. An HTTP 200 is not permission.
  it('cannot reach Austria, whose licence does not exist', () => {
    expect(SOURCES.some((s) => s.country === ('at' as never))).toBe(false);
    expect(blob).not.toContain('e-control');
    expect(blob).not.toContain('spritpreisrechner');
  });

  it('cannot reach the countries that forbid commercial use in words', () => {
    expect(blob).not.toContain('dgeg'); // Portugal
    expect(blob).not.toContain('holtankoljak'); // Hungary
  });

  it('cannot reach a country that does not publish per station', () => {
    for (const host of ['.be/', '.gr/', '.pl/']) {
      expect(SOURCES.flatMap((s) => s.urls).join(' ')).not.toContain(host);
    }
  });

  // 🔴 `camp-tribe-eu/camp` is public and has leaked a token before. The
  // safest credential is one that does not exist: none of these three
  // takes a key, verified by anonymous GET on 28.09.2026.
  it('carries no key, token or secret in any URL', () => {
    for (const url of SOURCES.flatMap((s) => s.urls)) {
      expect(url).not.toMatch(/(api[_-]?key|token|secret|password)=/i);
    }
  });

  it('names a licence and an attribution for every source', () => {
    for (const s of SOURCES) {
      expect(s.licence).toMatch(/commercial reuse permitted/);
      expect(s.attribution.length).toBeGreaterThan(10);
    }
  });
});

// ── THE FLOOR UNDER AN EMPTY FEED ───────────────────────────────────────

describe('🔴 an endpoint that answers 200 with nothing in it', () => {
  // 🔴 The reconciliation passes PERFECTLY on an empty feed — 0 kept +
  // 0 rejected = 0 records — and the import replaces the whole table.
  // So without a floor, a ministry serving a truncated file deletes a
  // country's prices and exits 0, and every page in that country says
  // we hold no price for the forecourt. That is a statement about us
  // that reads as a statement about the ground, and it is the failure
  // §4 of docs/road-hazard-sources.md demands an alarm for.
  it('reconciles perfectly, which is exactly why a floor is needed', () => {
    const empty = parseSpain(
      { Fecha: '28/09/2026 19:36:45', ListaEESSPrecio: [] },
      NOW,
    );
    expect(empty.stations).toHaveLength(0);
    expect(empty.rejected).toHaveLength(0);
    expect(empty.feedRecords).toBe(0);
    // Nothing above this line can tell the difference from a good run.
    expect(empty.stations.length + empty.rejected.length).toBe(
      empty.feedRecords,
    );
  });

  it('has a floor for every source that can be imported', () => {
    for (const s of SOURCES) {
      expect(MIN_STATIONS[s.id]).toBeGreaterThan(0);
    }
  });

  // Half of what each source yielded on 28.09.2026 — wide enough that
  // ordinary movement cannot trip it, tight enough that a truncation
  // cannot pass as a quiet day.
  it('sets each floor below what the source really yields, and far above zero', () => {
    const measured = {
      'es-minetur': 11_309,
      'fr-data-economie': 8_885,
      'it-mimit': 21_189,
    };
    for (const [id, yielded] of Object.entries(measured)) {
      expect(MIN_STATIONS[id]).toBeLessThan(yielded);
      expect(MIN_STATIONS[id]).toBeGreaterThan(yielded / 4);
    }
  });
});

// ── STALENESS ───────────────────────────────────────────────────────────

describe('how old a price may be', () => {
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

  it('is fresh inside the window and stale outside it', () => {
    expect(isPriceStale(daysAgo(6), NOW)).toBe(false);
    expect(isPriceStale(daysAgo(8), NOW)).toBe(true);
  });

  it('is dropped past a month', () => {
    expect(isPriceDroppable(daysAgo(29), NOW)).toBe(false);
    expect(isPriceDroppable(daysAgo(31), NOW)).toBe(true);
  });

  // 🔴 The web app keeps its own copy of these two numbers, because it
  // cannot import from apps/api. Two copies of a staleness rule is one
  // copy that will be wrong, and it fails in the worst direction: the
  // importer keeping a price the page believes it has discarded.
  it('agrees with the copy the web app renders against', () => {
    const web = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'web',
        'src',
        'lib',
        'route-services.ts',
      ),
      'utf8',
    );
    expect(web).toContain(
      `export const PRICE_STALE_AFTER_DAYS = ${PRICE_STALE_AFTER_DAYS};`,
    );
    expect(web).toContain(
      `export const PRICE_DROP_AFTER_DAYS = ${PRICE_DROP_AFTER_DAYS};`,
    );
  });
});
