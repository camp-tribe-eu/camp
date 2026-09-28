// CAMP-154: per-station fuel prices for Spain, France and Italy.
//
// 🔴 THE DISTINCTION THIS FILE EXISTS TO PROTECT.
//
// CAMP-55 gives a weekly NATIONAL AVERAGE per country. This file gives
// the price on ONE forecourt, measured at a stated moment. They are
// different claims and the site must never let one read as the other —
// lib/fuel.ts is built on that line and route-services.tsx repeats it.
// Everything here carries `measuredAt` and `source` for exactly that
// reason: a number without them is not a price, it is a rumour.
//
// 🔴 NO NEST IMPORTS IN THIS FILE, for the reason osm/route-poi.ts gives
// at its own head: the service layer pulls in @nestjs/typeorm, which
// ships ESM that Jest will not parse in this package, so anything
// reachable only through the service has no test while appearing to
// have one. The parsing below is exactly the code that must not quietly
// change, so it lives where a test can reach it.
//
// ── WHY THESE THREE, AND THE KEYS THEY DO NOT NEED ──────────────────────
//
// `docs/road-hazard-sources.md` §6 holds the licence quotations; they
// are not re-derived here. In one line each:
//
//   Spain   datos.gob.es general conditions — "permiten la reutilización
//           de los documentos sometidos a ellas para fines comerciales"
//   France  Licence Ouverte 2.0 — "de l'exploiter à titre commercial"
//   Italy   IODL 2.0 — "anche qualora la finalità da Te perseguita sia
//           di tipo commerciale"
//
// 🔴 NONE OF THE THREE TAKES A KEY, and that was checked rather than
// assumed, because `camp-tribe-eu/camp` is public and has leaked a
// token before. Measured 28.09.2026, anonymous GET, no header of any
// kind beyond `Accept`:
//
//   ES  200, 12 221 919 bytes, application/json, 16.7 s
//   FR  200,  4 618 859 bytes gzip (29 167 472 raw), 3.6 s
//   IT  200,  3 584 173 + 3 944 342 bytes, text/csv
//
// So there is no secret to put anywhere, which is the safest shape a
// credential can take.
//
// 🔴 AND THE SPANISH PATH IN §6 IS NOT THE ONE THAT ANSWERS.
//
// §6 records the host and not the full path. The obvious reconstruction
// — `/ServiciosRESTCarburantes/PrecioCarburantes/EstacionesTerrestres/`
// — returns **404** (measured 28.09.2026; `/ServiciosRESTCarburantes/`
// itself answers 403, so the application is there and that one path is
// not). The service is at **PreciosCarburantes**, plural, and with that
// letter it answers 200 with the 12.2 MB §6 measured. One letter, and
// the difference between a working import and an empty one — which is
// why the URL is a constant in this file with the measurement beside it
// rather than something each caller types.
//
// ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────
//
// Austria, whose endpoint answers 200 with no key and no rate limit and
// for which **no consumer licence exists** (§6: the only published
// Nutzungsbedingungen govern the stations supplying the prices, and
// `spritpreisrechner.at/nutzungsbedingungen.html` is a 404). Portugal
// and Hungary, both of which forbid commercial use in their own words.
// Belgium, Greece and Poland, which do not publish per station at all.
// Germany is a separate card (§6 item 9): its licence is fine and its
// rate limit — one request a minute — makes a national sweep the one
// thing we must not build.
//
// `SOURCES` below is a closed list and `fuel-sources.spec.ts` asserts
// that every refused country is absent from it. An import that reached
// for Austria would have to edit that test, in a diff a reviewer reads.

/** The two grades a page shows, mapped onto the EU bulletin's own pair. */
export type FuelGrade = 'diesel' | 'petrol';

export const FUEL_GRADES: readonly FuelGrade[] = ['diesel', 'petrol'];

/**
 * One price, on one forecourt, at one moment.
 *
 * 🔴 `product` is the SOURCE'S OWN NAME for what is in the tank, kept
 * verbatim, and it is not decoration. France sells 95-octane petrol as
 * both `SP95` and `E10`, which are different fuels at different prices;
 * measured 28.09.2026, 5 619 stations post an E10 price and no SP95 at
 * all, against 1 574 the other way. Folding them into one "petrol"
 * number would print E10's price under SP95's name at a third of the
 * country's stations. The grade says which row it goes in; the product
 * says what the reader would actually be buying, and the page prints it.
 */
export interface StationPrice {
  grade: FuelGrade;
  /** The source's own product name, unchanged. */
  product: string;
  /** Euros per litre. */
  price: number;
  /**
   * 🔴 When THE SOURCE says this price was set — never when we fetched.
   *
   * They are days apart in practice and the gap is the whole point.
   * Measured 28.09.2026 on France's 8 760 diesel prices: 3 350 under a
   * day old, 2 119 four to seven days, 1 193 eight to thirty, and 101
   * between one month and one year. Italy's 68 273 plain-grade prices
   * run 2 767 at one day, 51 201 at two to three, 805 at eight to
   * thirty and 241 beyond a month. A single "fetched today" stamp over
   * that spread would be a false statement on thousands of forecourts.
   */
  measuredAt: Date;
}

/** One forecourt, as a source describes it. */
export interface Station {
  /** Which feed this came from — `SOURCES[].id`. */
  source: string;
  /** The source's own station identifier. Stable within that source. */
  ref: string;
  country: 'es' | 'fr' | 'it';
  name: string | null;
  lat: number;
  lon: number;
  prices: StationPrice[];
}

/** One rejected record, with the reason, so a run reconciles by construction. */
export interface Rejection {
  source: string;
  ref: string;
  reason: string;
}

export interface ParseResult {
  stations: Station[];
  rejected: Rejection[];
  /** The source's own statement of when the snapshot was made, if it makes one. */
  snapshotAt: Date | null;
  /**
   * 🔴 How many records the FEED contained, counted before we touched it.
   *
   * The denominator of every coverage figure, and it is taken from the
   * feed rather than derived from what we kept, so `kept + rejected ===
   * feedRecords` is an assertion a run can fail rather than an identity
   * that holds by construction. A corpus must not share a field with
   * what it measures.
   */
  feedRecords: number;
}

export interface FuelSource {
  id: string;
  country: 'es' | 'fr' | 'it';
  /** For the attribution line the page prints. */
  attribution: string;
  licence: string;
  /** Where a reader goes to check us. */
  homepage: string;
  urls: string[];
}

/**
 * 🔴 A CLOSED LIST, AND THE ONLY PLACE A COUNTRY CAN ENTER THE IMPORT.
 *
 * `fuel-sources.spec.ts` asserts that `at`, `pt`, `hu`, `be`, `gr` and
 * `pl` appear in no `country`, no `id` and no URL host here. Austria in
 * particular is one convenient HTTP 200 away at all times, and §6's
 * rule is that an HTTP 200 is not permission.
 */
export const SOURCES: readonly FuelSource[] = [
  {
    id: 'es-minetur',
    country: 'es',
    attribution:
      'Ministerio para la Transición Ecológica y el Reto Demográfico, ' +
      'Geoportal de Gasolineras',
    licence: 'datos.gob.es general conditions — commercial reuse permitted',
    homepage:
      'https://sede.serviciosmin.gob.es/es-ES/datosabiertos/catalogo/precios-carburantes',
    // 🔴 PreciosCarburantes, plural. See the note at the head of this file.
    urls: [
      'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/',
    ],
  },
  {
    id: 'fr-data-economie',
    country: 'fr',
    attribution:
      'Ministère de l’Économie et des Finances, prix-carburants.gouv.fr',
    licence: 'Licence Ouverte 2.0 — commercial reuse permitted',
    homepage:
      'https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/',
    urls: [
      'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/exports/json',
    ],
  },
  {
    id: 'it-mimit',
    country: 'it',
    attribution: 'Ministero delle Imprese e del Made in Italy (MIMIT)',
    licence: 'IODL 2.0 — commercial reuse permitted',
    homepage:
      'https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti',
    // 🔴 Two files, and both are needed: the first has the coordinates
    // and no prices, the second the prices and no coordinates.
    urls: [
      'https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv',
      'https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv',
    ],
  },
];

export const sourceById = (id: string): FuelSource | undefined =>
  SOURCES.find((s) => s.id === id);

/**
 * 🔴 The bounds a coordinate must fall inside to be believed.
 *
 * Not a nicety. A station at (0, 0) or with its latitude and longitude
 * transposed would be matched against whatever OSM fuel point happens
 * to be nearest to the wrong place, and would then print one forecourt's
 * price beside another's name — the single worst failure this card can
 * produce. Measured 28.09.2026: Italy publishes **116 of 23 998**
 * stations with a zero or unparsable coordinate, so this is a path the
 * data takes, not a hypothetical.
 *
 * 🔴 AND IT CAUGHT A TRANSPOSED PAIR ON THE FIRST RUN. Of the four
 * Spanish stations this rejects, three are at (0, 0) — Barcelona,
 * Piélagos and Valdemoro, all filed as Null Island — and the fourth,
 * IDEESS 16268 in Tui, Pontevedra, publishes
 *
 *     "Latitud": "-8,659472", "Longitud (WGS84)": "42,037472"
 *
 * which is its own coordinate written backwards. Tui is at 42.04 N,
 * -8.66 E. Believed, that station would have been placed 42 degrees
 * east of the Horn of Africa. It would have matched nothing there and
 * so done no visible harm — which is the point: the harm from a
 * transposed pair is invisible until the day one lands somewhere that
 * does have a fuel point, and then it is a real price under a real
 * name in the wrong country.
 *
 * The boxes are generous on purpose — they are a sanity filter, not a
 * border. Spain's includes the Canaries (27.6 N, -18.2 E) and Ceuta;
 * France's is metropolitan plus Corsica, which is what the v2 flux
 * actually carries; Italy's includes Lampedusa (35.5 N).
 */
export const COUNTRY_BOUNDS: Record<
  'es' | 'fr' | 'it',
  { minLat: number; maxLat: number; minLon: number; maxLon: number }
> = {
  es: { minLat: 27.0, maxLat: 44.0, minLon: -18.5, maxLon: 5.0 },
  fr: { minLat: 41.0, maxLat: 51.5, minLon: -5.5, maxLon: 10.0 },
  it: { minLat: 35.0, maxLat: 47.5, minLon: 6.0, maxLon: 19.0 },
};

export function inCountryBounds(
  country: 'es' | 'fr' | 'it',
  lat: number,
  lon: number,
): boolean {
  const b = COUNTRY_BOUNDS[country];
  return (
    lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon
  );
}

/**
 * 🔴 What counts as a believable price per litre, in euros.
 *
 * A bound, not a guess. Every one of these three countries prices in
 * euros per litre and has done throughout; a figure outside this range
 * is a units error or a decimal-comma error, and both of those print a
 * confident wrong number rather than failing. The floor is above zero
 * because `0` is how two of the three feeds spell "not sold here", and
 * a free litre of diesel on a route page would be believed by somebody.
 */
export const MIN_PRICE = 0.2;
export const MAX_PRICE = 9.999;

export function believablePrice(n: number): boolean {
  return Number.isFinite(n) && n >= MIN_PRICE && n <= MAX_PRICE;
}

/**
 * A number written with either a decimal comma or a decimal point.
 *
 * 🔴 Spain writes `"1,849"` and `"39,211417"`; France and Italy write
 * `2.429` and `37.333935`. A parser that assumed one of them would read
 * Spanish latitude 39,211417 as NaN and drop the whole country, or —
 * worse, via `parseFloat` — as **39**, which is 23 km out to sea.
 * `parseFloat` is never used in this file for that reason: it stops at
 * the first character it does not like and returns a plausible wrong
 * answer instead of a refusal.
 */
export function decimal(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t === '') return null;
  // One separator, at most one, and nothing else but digits and a sign.
  if (!/^-?\d+(?:[.,]\d+)?$/.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** `28/09/2026 19:36:45` and `25/09/2026 20:00:07` — Spain and Italy. */
export function parseDmyDateTime(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const m =
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
      raw.trim(),
    );
  if (!m) return null;
  const [, d, mo, y, hh, mm, ss] = m;
  const day = Number(d);
  const month = Number(mo);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // 🔴 Built in UTC. These feeds state no zone; Madrid and Rome are
  // +01:00/+02:00, so reading them as local time on a machine in another
  // zone would move every timestamp by hours and could push a price
  // across the staleness line in either direction. One fixed zone is
  // wrong by at most two hours and is wrong the SAME way everywhere,
  // which is a thing the page can state and a reader can allow for.
  const dt = new Date(
    Date.UTC(
      Number(y),
      month - 1,
      day,
      Number(hh ?? 0),
      Number(mm ?? 0),
      Number(ss ?? 0),
    ),
  );
  if (Number.isNaN(dt.getTime())) return null;
  // Rejects 31/02: Date.UTC rolls it over rather than refusing.
  if (dt.getUTCDate() !== day || dt.getUTCMonth() !== month - 1) return null;
  return dt;
}

/** `2026-09-28T11:45:27+00:00` — France's flat columns, already ISO 8601. */
export function parseIsoDateTime(raw: unknown): Date | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── SPAIN ───────────────────────────────────────────────────────────────

/**
 * 🔴 The two Spanish fields we read, out of thirteen price columns.
 *
 * `Gasoleo A` is ordinary road diesel; `Gasoleo B` is the dyed
 * agricultural grade that a camper may not legally burn, and it is
 * cheaper, so publishing it as "diesel" would advertise the wrong
 * number AND the wrong fuel. `Gasolina 95 E5` is the EU bulletin's
 * Euro-super 95, which keeps the station price and the CAMP-55 country
 * average on the same product.
 *
 * Measured 28.09.2026 across 11 496 stations: 11 280 post Gasoleo A and
 * 10 891 post Gasolina 95 E5.
 */
const ES_FIELDS: { field: string; grade: FuelGrade; product: string }[] = [
  { field: 'Precio Gasoleo A', grade: 'diesel', product: 'Gasóleo A' },
  {
    field: 'Precio Gasolina 95 E5',
    grade: 'petrol',
    product: 'Gasolina 95 E5',
  },
];

export function parseSpain(payload: unknown, now: Date): ParseResult {
  const stations: Station[] = [];
  const rejected: Rejection[] = [];
  const root = payload as Record<string, unknown> | null;
  const list = root?.['ListaEESSPrecio'];
  if (!Array.isArray(list)) {
    throw new Error('es-minetur: ListaEESSPrecio is not an array');
  }
  const snapshotAt = parseDmyDateTime(root?.['Fecha']);

  for (const raw of list) {
    const r = raw as Record<string, unknown>;
    const ref = typeof r['IDEESS'] === 'string' ? r['IDEESS'].trim() : '';
    // 🔴 One bad record costs one record. A single backwards date range
    // aborted a 12 402-row import on this project today; nothing below
    // throws, everything appends to `rejected`, and the caller
    // reconciles kept + rejected against the feed's own count.
    if (!ref) {
      rejected.push({
        source: 'es-minetur',
        ref: '(missing)',
        reason: 'no IDEESS',
      });
      continue;
    }
    const lat = decimal(r['Latitud']);
    const lon = decimal(r['Longitud (WGS84)']);
    if (lat === null || lon === null) {
      rejected.push({
        source: 'es-minetur',
        ref,
        reason: 'unparsable coordinate',
      });
      continue;
    }
    if (!inCountryBounds('es', lat, lon)) {
      rejected.push({
        source: 'es-minetur',
        ref,
        reason: `coordinate outside Spain (${lat}, ${lon})`,
      });
      continue;
    }

    const prices: StationPrice[] = [];
    for (const f of ES_FIELDS) {
      const v = decimal(r[f.field]);
      if (v === null) continue; // Empty string = not sold here. Not an error.
      if (!believablePrice(v)) {
        rejected.push({
          source: 'es-minetur',
          ref,
          reason: `${f.product} price out of range: ${v}`,
        });
        continue;
      }
      // 🔴 Spain stamps the SNAPSHOT, not the individual price — the
      // feed carries one `Fecha` for the whole file. So every Spanish
      // price is as old as the file and no older, which is an honest
      // thing to print and a different claim from France's and Italy's
      // per-price stamps. When the header is unreadable we fall back to
      // our own fetch time rather than inventing a fresher one.
      // 🔴 The three fields are named, not spread from `f`. Spreading
      // also carried `field` — the internal ministry column name — out
      // onto the wire and into the JSON the page receives. Caught by the
      // spec, not by review, which is the argument for asserting on the
      // whole object rather than on the keys one happens to think of.
      prices.push({
        grade: f.grade,
        product: f.product,
        price: v,
        measuredAt: snapshotAt ?? now,
      });
    }
    if (prices.length === 0) {
      rejected.push({
        source: 'es-minetur',
        ref,
        reason: 'no diesel or petrol price',
      });
      continue;
    }

    const label = typeof r['Rótulo'] === 'string' ? r['Rótulo'].trim() : '';
    stations.push({
      source: 'es-minetur',
      ref,
      country: 'es',
      name: label === '' ? null : label,
      lat,
      lon,
      prices,
    });
  }

  return { stations, rejected, snapshotAt, feedRecords: list.length };
}

// ── FRANCE ──────────────────────────────────────────────────────────────

/**
 * 🔴 France's petrol is two products, and we keep them apart.
 *
 * `SP95` is Euro-super 95, the EU bulletin's product. `E10` is also
 * 95-octane but with up to 10% ethanol, sold at a different price, and
 * it is now the majority: measured 28.09.2026, 6 799 stations post an
 * E10 price against 2 754 an SP95 one, overlapping on 1 180.
 *
 * Preferring SP95 where both exist keeps the station price and the
 * CAMP-55 country average on the same fuel wherever it is possible; the
 * 5 619 stations with only E10 get E10, **named E10 on the page**. What
 * is not done, anywhere, is putting E10's number under SP95's label.
 */
const FR_FIELDS: { key: string; grade: FuelGrade; product: string }[] = [
  { key: 'gazole', grade: 'diesel', product: 'Gazole' },
  { key: 'sp95', grade: 'petrol', product: 'SP95' },
  { key: 'e10', grade: 'petrol', product: 'E10' },
];

/**
 * 🔴 The flux writes coordinates in hundred-thousandths of a degree.
 *
 * `"latitude": "4818300"` is 48.183, not 4 818 300. This is the one
 * transformation in the file that silently produces a *number* rather
 * than a refusal if it is forgotten, and the number is off the planet,
 * so it gets its own named function and its own test.
 */
export const FR_COORD_SCALE = 100_000;

export function parseFrance(payload: unknown, now: Date): ParseResult {
  const stations: Station[] = [];
  const rejected: Rejection[] = [];
  if (!Array.isArray(payload)) {
    throw new Error('fr-data-economie: export is not an array');
  }

  for (const raw of payload) {
    const r = raw as Record<string, unknown>;
    const ref =
      r['id'] === undefined || r['id'] === null ? '' : String(r['id']).trim();
    if (ref === '') {
      rejected.push({
        source: 'fr-data-economie',
        ref: '(missing)',
        reason: 'no id',
      });
      continue;
    }
    const rawLat = decimal(r['latitude']);
    const rawLon = decimal(r['longitude']);
    if (rawLat === null || rawLon === null) {
      rejected.push({
        source: 'fr-data-economie',
        ref,
        reason: 'unparsable coordinate',
      });
      continue;
    }
    const lat = rawLat / FR_COORD_SCALE;
    const lon = rawLon / FR_COORD_SCALE;
    if (!inCountryBounds('fr', lat, lon)) {
      rejected.push({
        source: 'fr-data-economie',
        ref,
        reason: `coordinate outside France (${lat}, ${lon})`,
      });
      continue;
    }

    const prices: StationPrice[] = [];
    let havePetrol = false;
    for (const f of FR_FIELDS) {
      // SP95 is listed before E10 in FR_FIELDS, so this keeps SP95 when
      // a station posts both and takes E10 only when it is the only one.
      if (f.grade === 'petrol' && havePetrol) continue;
      const v = decimal(r[`${f.key}_prix`]);
      if (v === null) continue;
      if (!believablePrice(v)) {
        rejected.push({
          source: 'fr-data-economie',
          ref,
          reason: `${f.product} price out of range: ${v}`,
        });
        continue;
      }
      const measuredAt = parseIsoDateTime(r[`${f.key}_maj`]);
      if (measuredAt === null) {
        // 🔴 A price with no date is refused rather than stamped with
        // now(). "Every displayed price carries its measurement date" is
        // the card's rule, and a fabricated date is worse than a missing
        // price: it would make the oldest numbers look the freshest.
        rejected.push({
          source: 'fr-data-economie',
          ref,
          reason: `${f.product} price has no usable ${f.key}_maj`,
        });
        continue;
      }
      if (measuredAt.getTime() > now.getTime() + 86_400_000) {
        rejected.push({
          source: 'fr-data-economie',
          ref,
          reason: `${f.product} measured in the future: ${measuredAt.toISOString()}`,
        });
        continue;
      }
      prices.push({ grade: f.grade, product: f.product, price: v, measuredAt });
      if (f.grade === 'petrol') havePetrol = true;
    }
    if (prices.length === 0) {
      rejected.push({
        source: 'fr-data-economie',
        ref,
        reason: 'no diesel or petrol price',
      });
      continue;
    }

    // The flux has no brand column; `ville` is the best label it offers,
    // and the OSM point it matches usually carries the real name.
    const ville = typeof r['ville'] === 'string' ? r['ville'].trim() : '';
    stations.push({
      source: 'fr-data-economie',
      ref,
      country: 'fr',
      name: ville === '' ? null : ville,
      lat,
      lon,
      prices,
    });
  }

  return { stations, rejected, snapshotAt: null, feedRecords: payload.length };
}

// ── ITALY ───────────────────────────────────────────────────────────────

/**
 * 🔴 Exact names only, out of fifty-nine.
 *
 * Measured 28.09.2026, the price file uses **59 distinct**
 * `descCarburante` values, most of them brand names for a premium
 * additive blend: `Blue Diesel` (5 685 rows), `HVOlution` (2 433),
 * `Supreme Diesel` (1 592), `Hi-Q Diesel` (1 360), down to
 * `Gasolio Artico Igloo` at 2. They cost more than the plain grade and
 * several of them are not the same fuel at all — `HVO` is renewable
 * diesel, `Metano` and `GPL` are gas.
 *
 * A substring rule (`/diesel/i`, `/gasolio/`) would sweep most of those
 * into the "diesel" row and print a premium price as the pump price. So
 * this is an exact-match whitelist of the two plain grades, and a new
 * brand name appearing upstream changes nothing here — which is the
 * behaviour we want from a list of 59 that somebody else maintains.
 */
const IT_PRODUCTS: Record<string, { grade: FuelGrade; product: string }> = {
  Gasolio: { grade: 'diesel', product: 'Gasolio' },
  Benzina: { grade: 'petrol', product: 'Benzina' },
};

/**
 * 🔴 SELF-SERVICE, AND THE PAGE SAYS SO.
 *
 * Italy publishes both prices for the same pump: `isSelf=1` is the
 * self-service price and `isSelf=0` the served one, which is dearer.
 * Measured 28.09.2026: 51 203 self rows against 41 681 served, and most
 * stations file both. Picking whichever arrives first would give one
 * forecourt the self price and its neighbour the served one, with
 * nothing on the page to say which — a spread of 20-odd cents presented
 * as a difference between stations. So: prefer self-service, keep the
 * served price only where there is no self one, and record which in
 * `product` so the page can print it.
 */
export const IT_SELF_SERVICE = '1';

export interface ItalianCsvs {
  stations: string;
  prices: string;
}

/**
 * MIMIT's CSVs: a one-line "Estrazione del YYYY-MM-DD" banner, then a
 * header row, then pipe-separated data.
 */
export function parseItalianCsv(text: string): {
  extractedAt: Date | null;
  columns: string[];
  rows: string[][];
} {
  const lines = text.split(/\r?\n/);
  const banner = /Estrazione del\s+(\d{4})-(\d{2})-(\d{2})/.exec(
    lines[0] ?? '',
  );
  const extractedAt = banner
    ? new Date(Date.UTC(+banner[1], +banner[2] - 1, +banner[3]))
    : null;
  const columns = (lines[1] ?? '').split('|').map((c) => c.trim());
  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || line.trim() === '') continue;
    rows.push(line.split('|'));
  }
  return { extractedAt, columns, rows };
}

export function parseItaly(csvs: ItalianCsvs, now: Date): ParseResult {
  const rejected: Rejection[] = [];
  const anagrafica = parseItalianCsv(csvs.stations);
  const listino = parseItalianCsv(csvs.prices);

  if (!anagrafica.columns.includes('Latitudine')) {
    throw new Error('it-mimit: anagrafica has no Latitudine column');
  }
  if (!listino.columns.includes('descCarburante')) {
    throw new Error('it-mimit: price file has no descCarburante column');
  }

  const col = (cols: string[], name: string) => cols.indexOf(name);
  const aId = col(anagrafica.columns, 'idImpianto');
  const aName = col(anagrafica.columns, 'Nome Impianto');
  const aBrand = col(anagrafica.columns, 'Bandiera');
  const aLat = col(anagrafica.columns, 'Latitudine');
  const aLon = col(anagrafica.columns, 'Longitudine');

  const byId = new Map<string, Station>();
  for (const row of anagrafica.rows) {
    const ref = (row[aId] ?? '').trim();
    if (ref === '') {
      rejected.push({
        source: 'it-mimit',
        ref: '(missing)',
        reason: 'no idImpianto',
      });
      continue;
    }
    const lat = decimal(row[aLat]);
    const lon = decimal(row[aLon]);
    if (lat === null || lon === null || !inCountryBounds('it', lat, lon)) {
      // 116 of 23 998 land here, measured 28.09.2026 — mostly (0, 0).
      rejected.push({
        source: 'it-mimit',
        ref,
        reason: `coordinate missing or outside Italy (${row[aLat]}, ${row[aLon]})`,
      });
      continue;
    }
    const brand = (row[aBrand] ?? '').trim();
    const name = (row[aName] ?? '').trim();
    byId.set(ref, {
      source: 'it-mimit',
      ref,
      country: 'it',
      name: brand !== '' ? brand : name !== '' ? name : null,
      lat,
      lon,
      prices: [],
    });
  }

  const pId = col(listino.columns, 'idImpianto');
  const pDesc = col(listino.columns, 'descCarburante');
  const pPrice = col(listino.columns, 'prezzo');
  const pSelf = col(listino.columns, 'isSelf');
  const pWhen = col(listino.columns, 'dtComu');

  // grade -> chosen row, per station. Self-service wins; see IT_SELF_SERVICE.
  const chosen = new Map<
    string,
    Map<FuelGrade, { price: StationPrice; self: boolean }>
  >();

  for (const row of listino.rows) {
    const ref = (row[pId] ?? '').trim();
    const station = byId.get(ref);
    // A price for a station we dropped, or for one not in the register.
    if (!station) continue;
    const spec = IT_PRODUCTS[(row[pDesc] ?? '').trim()];
    if (!spec) continue; // A premium blend. Not an error; see IT_PRODUCTS.
    const v = decimal(row[pPrice]);
    if (v === null || !believablePrice(v)) {
      rejected.push({
        source: 'it-mimit',
        ref,
        reason: `${spec.product} price unusable: ${JSON.stringify(row[pPrice])}`,
      });
      continue;
    }
    const measuredAt = parseDmyDateTime(row[pWhen]);
    if (measuredAt === null) {
      rejected.push({
        source: 'it-mimit',
        ref,
        reason: `${spec.product} has no usable dtComu`,
      });
      continue;
    }
    if (measuredAt.getTime() > now.getTime() + 86_400_000) {
      rejected.push({
        source: 'it-mimit',
        ref,
        reason: `${spec.product} measured in the future: ${measuredAt.toISOString()}`,
      });
      continue;
    }
    const self = (row[pSelf] ?? '').trim() === IT_SELF_SERVICE;
    const price: StationPrice = {
      grade: spec.grade,
      product: self ? spec.product : `${spec.product} (servito)`,
      price: v,
      measuredAt,
    };

    let perStation = chosen.get(ref);
    if (!perStation) {
      perStation = new Map();
      chosen.set(ref, perStation);
    }
    const held = perStation.get(spec.grade);
    // Self beats served; among equals the more recent stamp wins, so the
    // choice does not depend on the order MIMIT happens to emit rows in.
    if (
      !held ||
      (self && !held.self) ||
      (self === held.self &&
        measuredAt.getTime() > held.price.measuredAt.getTime())
    ) {
      perStation.set(spec.grade, { price, self });
    }
  }

  const stations: Station[] = [];
  for (const [ref, station] of byId) {
    const picked = chosen.get(ref);
    if (!picked || picked.size === 0) {
      // 🔴 Recorded, not silently skipped, so the run reconciles.
      //
      // These are stations in the active register that filed no plain
      // Benzina or Gasolio price in today's file — 2 693 of 23 998,
      // measured 28.09.2026. Dropping them quietly would leave the
      // report showing 21 189 kept + 116 rejected against a register of
      // 23 998 and a 2 693-row hole nobody could account for. A
      // reconciliation that does not balance is one nobody checks.
      rejected.push({
        source: 'it-mimit',
        ref,
        reason: 'in the active register, no plain-grade price filed today',
      });
      continue;
    }
    station.prices = [...picked.values()].map((p) => p.price);
    stations.push(station);
  }

  return {
    stations,
    rejected,
    snapshotAt: anagrafica.extractedAt,
    feedRecords: anagrafica.rows.length,
  };
}

// ── STALENESS, SHARED BY THE IMPORT AND THE PAGE ────────────────────────
//
// 🔴 These thresholds live here, beside the measurements that set them,
// and the web app re-exports them rather than choosing its own. Two
// copies of a staleness rule is one copy that will be wrong.

/**
 * Past this, the page stops presenting the number as the current price
 * and says how old it is instead.
 *
 * Seven days. The feeds refresh between every thirty minutes and once a
 * day, so a price a week old is not a slow refresh — it is a forecourt
 * that has stopped filing, and by then the number is a historical fact
 * rather than what a driver will pay.
 */
export const PRICE_STALE_AFTER_DAYS = 7;

/**
 * Past this the price is not shown at all and the row says we have none.
 *
 * Thirty days. Measured 28.09.2026, this discards 138 of France's 8 760
 * diesel prices and 1 046 of Italy's plain-grade rows. Those are the
 * stations that filed once and stopped; printing a number from last
 * spring beside a date does not repair it, because the number is what
 * gets read.
 */
export const PRICE_DROP_AFTER_DAYS = 30;

export const priceAgeDays = (measuredAt: Date, now: Date): number =>
  (now.getTime() - measuredAt.getTime()) / 86_400_000;

export const isPriceStale = (measuredAt: Date, now: Date): boolean =>
  priceAgeDays(measuredAt, now) > PRICE_STALE_AFTER_DAYS;

export const isPriceDroppable = (measuredAt: Date, now: Date): boolean =>
  priceAgeDays(measuredAt, now) > PRICE_DROP_AFTER_DAYS;
