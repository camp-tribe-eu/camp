// CAMP-164: the EEA's European Air Quality Index, described once.
//
// Everything here is a fact about the SOURCE, read on 29.09.2026 from the
// endpoint it names. docs/emergency-sources.md §9 surveyed the same
// source the day before; where a number below differs from the survey,
// the survey's was one hour on one day and this one is a different hour.

/**
 * The public blob store behind the EEA's viewer
 * (`https://airindex.eea.europa.eu/AQI/index.html`). It answers
 * anonymously — no key, no header, nothing in this module reads an
 * environment variable, so there is nothing here to commit by accident.
 *
 * 🔴 The path segment `AQI-noRunningMeans` is what the viewer's own
 * script (`script/data.js`, `STATION_DATA_URL`) reads today, and it is
 * the reason this is not "the 24-hour index" the About text describes:
 * that paragraph's running-mean sentence sits inside an HTML comment in
 * the viewer's markup, and the folder name says the same thing. The
 * index in these files is built from HOURLY concentrations. The page
 * therefore says "hourly", never "24-hour".
 */
export const AIR_BLOB_BASE =
  'https://dis2datalake.blob.core.windows.net/airquality-derivated/AQI-noRunningMeans';

/**
 * Lists the roster files: four on 29.09.2026, one a week (the suffix is
 * yymmddNN — 26090400, 26091100, 26091800, 26092500, all Fridays).
 */
export const AIR_ROSTER_INDEX_URL = `${AIR_BLOB_BASE}/content/index.json`;

export const airRosterUrl = (file: string): string =>
  `${AIR_BLOB_BASE}/content/${file}`;

/**
 * One station's hourly file: about 305 slots, from eleven days back to
 * about a day and a half AHEAD.
 *
 * 🔴 The future slots are a forecast (CAMS, downscaled) and carry
 * `modelled_*: 1` on every pollutant that contributes — 39 slots ahead
 * of the current hour in 253 of the 255 files read on 29.09.2026 (the
 * other two are files of stations that stopped reporting and end in the
 * past), and every one of those slots fully modelled. They are never
 * read as observations; parse.ts refuses any slot that is not strictly
 * before the current hour, so a forecast slot with `modelled: 0` — which
 * no file has today — would still not become a reading.
 */
export const airStationUrl = (code: string): string =>
  `${AIR_BLOB_BASE}/current/${encodeURIComponent(code)}.json`;

/**
 * The 1 km modelled index, as an Esri ImageServer.
 *
 * 🔴 The year in `AQMobile_2025` is load-bearing, and it is the same
 * trap docs/emergency-sources.md §8 records for bathing water. The
 * viewer's script keeps the previous names as comments
 * (`AQMobile`, `AQMobile_Local`, `AQMobile_NEW`), the un-suffixed folder
 * still exists on the server, and ArcGIS answers a service that does not
 * exist with HTTP 200 — `GET …/services/AQMobile_2026?f=json` answered
 * 200 with an EMPTY service list on 29.09.2026. When the EEA rolls the year,
 * this service stops advancing rather than disappearing; `rasterWindow`
 * in fetch.ts reads `timeInfo.timeExtent` and the import refuses an hour
 * outside it, so the failure is a loud one instead of a page quoting
 * last December.
 *
 * Values are integers 1–6 (`pixelType U8`, `minValues [1]`,
 * `maxValues [6]`) — the index BAND, not the fractional index the
 * stations carry. Time window measured 29.09.2026: 2026-09-28T00:00Z to
 * 2026-10-01T12:00Z.
 */
export const AIR_RASTER_URL =
  'https://air.discomap.eea.europa.eu/arcgis/rest/services/AQMobile_2025/MOSAIC_GLOBAL_AQI/ImageServer';

/**
 * 🔴 `getSamples` SILENTLY IGNORES EVERY POINT PAST THE FIRST 1 000.
 *
 * Measured 29.09.2026 with 1 000, 1 001, 2 000 and 3 000 random points
 * over Europe: each response held exactly the same 496 samples, the
 * largest `locationId` in every one was 999, and there was no error, no
 * `exceededTransferLimit`, nothing. A batch of 3 000 costs 2 000 points
 * that look exactly like points outside the model's coverage — and a
 * page for one of those says the model does not cover it.
 *
 * So batches are 499 points plus ONE SENTINEL appended at the end. The
 * sentinel is a point inside the raster in every hour (Lake Balaton);
 * if its sample does not come back, the server dropped the tail of the
 * batch and fetch.ts throws instead of returning a partial answer.
 */
export const AIR_RASTER_BATCH = 499;
export const AIR_RASTER_SENTINEL = { lon: 17.74, lat: 46.83 } as const;

/** Where a READER is sent. Also where the About text below was read. */
export const AIR_VIEWER_URL = 'https://airindex.eea.europa.eu/AQI/index.html';

/** Short stable id of the publisher, as the web's SOURCES spells it. */
export const AIR_SOURCE_ID = 'eea-air-quality';

/**
 * 🔴 HOW OFTEN THIS SOURCE CHANGES — declared, and the opposite of the
 * bathing water's. That one is annual and a year-old value is healthy;
 * this one is hourly and a value a few hours old is not. The web reads
 * the same fact from `SOURCES['eea-air-quality'].cadence`; a unit test
 * compares the two so they cannot drift.
 */
export const AIR_CADENCE = 'hourly' as const;

/**
 * 🔴 HOW OLD A READING MAY BE AND STILL BE SHOWN — whole hours, measured
 * against the current hour.
 *
 * Not the 2–3 h docs/emergency-sources.md §12 guessed, and the
 * measurement is why. A station's NEWEST hour is never a measurement:
 * in a random sample of 240 of the 3 206 EU-27 stations that had an
 * index value in the 19:00 UTC map file (read 29.09.2026 19:35 UTC),
 * the newest slot was fully gap-filled by the model in 240 of 240.
 * Reports arrive late. The newest hour in which at least one pollutant
 * was REPORTED lay this many whole hours before the current one:
 *
 *      1 h    20        5 h     3       14 h    2
 *      2 h   134        6 h     1       19 h    4
 *      3 h    41        7 h     4      20–253 h  17
 *      4 h    13   ← budget    10 h    1
 *
 * So 195 of 240 (81.3%) were within 3 h and 208 (86.7%) within 4 h; then
 * a thin tail out to 253 h — the silent stations, not slow ones. Four
 * hours keeps the body of the distribution and stops where the tail
 * starts. A 3 h budget would have called the 13 of 240 that reported
 * with a four-hour lag "no fresh data", and they are not silent.
 *
 * ⚠️ One hour of one day, and the sample differs on every rerun (the
 * set of stations in the map file changes hourly). It is a constant in
 * ONE place because it will need re-measuring across a day;
 * `report-lag.ts` in this directory prints this table and is what to
 * rerun.
 *
 * The 1 km model has no reporting lag (it is computed for every hour, past
 * and forecast), so its age is the age of OUR last read of it, and the
 * same four hours means "the import has stopped".
 */
export const AIR_FRESH_FOR_HOURS = 4;

/**
 * 🔴 HOW FAR A STATION MAY BE AND STILL BE THIS CAMPSITE'S.
 *
 * Measured 29.09.2026 over all 61 557 campsites against all 4 018 EU-27
 * stations (nearest by geography distance, no sampling; the SQL is in
 * report-coverage.ts):
 *
 *      1 km      624    1.0%       15 km   22 273   36.2%
 *      2 km    1 755    2.9%       20 km   31 368   51.0%   <- chosen
 *      5 km    5 355    8.7%       25 km   39 104   63.5%
 *     10 km   12 913   21.0%       50 km   56 695   92.1%
 *
 * 🔴 That curve cannot choose the radius — it has no knee, and choosing
 * on "coverage" always argues for the biggest number. The radius is
 * examined on a DIFFERENT FIELD from the one it judges: the 1 km
 * modelled raster. It is downscaled CAMS and does not assimilate the
 * stations (the viewer's About text: "the downscaled CAMS model is used
 * for every hour"), so it shares no field with a station reading. For
 * 15 000 campsites (1 500 in each 5 km band out to 50 km) at six hours
 * spread over two days, how often is the modelled band AT THE CAMPSITE
 * the same as the modelled band AT ITS NEAREST STATION?
 *
 *      band      pairs   agree    pairs where either ≥ level 3   agree there
 *      0–5 km    8 838   91.4%             1 941                    69.7%
 *      5–10      8 862   88.5%             2 030                    61.3%
 *      10–15     8 874   88.0%             1 887                    57.8%
 *      15–20     8 850   87.4%             1 686                    53.3%
 *      20–25     8 886   86.3%             1 569                    53.3%
 *      25–30     8 886   85.4%             1 374                    48.3%
 *      30–50   35 256   85–87%           ~3 700                   48–57%
 *      shuffled campsite/station pairs (chance): 66.0%
 *
 * What that supports, and what it does not:
 *
 *   - The decline in the cases that matter (either end at level 3 or
 *     worse) runs out in the 15–20 km band and is flat, within the
 *     noise of ~1 000 pairs a band, from there to 50 km. 20 km is the
 *     last band in which distance still costs anything. It is a
 *     judgement placed where the decline stops, on the cautious side,
 *     not a distance the data imposes.
 *   - It does NOT say a station 40 km away is representative: the model
 *     is smooth (its native grid is coarser than the 1 km it is served
 *     on), so it agrees with itself at 85% across 50 km, 19 points above
 *     chance. It bounds how far a station could be trusted; it does not
 *     say a station is a good stand-in inside that bound.
 *   - It is a property of the MODEL's smoothness and says nothing about
 *     street-level air. Traffic stations agree least (84.1% against
 *     87.6% background, 88.0% industrial) and the page names the
 *     station type beside its distance for that reason.
 *
 * 🔴 The distance is RENDERED. A radius the reader cannot see is a
 * radius they cannot disagree with; "18.4 km from this campsite" is a
 * fact they can check against the map on the same page.
 */
export const AIR_RADIUS_M = 20_000;

/**
 * 🔴 EVERY country code this endpoint emits, enumerated — not the ones
 * we expected.
 *
 * The roster (`raw_stations.json.26092500`, 4 643 stations) carries no
 * country field: the country is the first two characters of the station
 * code. 40 distinct prefixes, read 29.09.2026:
 *
 *   EU-27 (27, stations): AT 178 · BE 302 · BG 41 · CY 3 · CZ 143 ·
 *     DE 439 · DK 17 · EE 9 · ES 614 · FI 58 · FR 510 · GR 58 · HR 29 ·
 *     HU 39 · IE 70 · IT 694 · LT 18 · LU 9 · LV 9 · MT 5 · NL 90 ·
 *     PL 242 · PT 71 · RO 197 · SE 95 · SI 24 · SK 54     (= 4 018)
 *   outside the Union (13, stations): AD 4 · AL 8 · BA 42 · CH 36 ·
 *     GE 7 · IS 46 · ME 9 · MK 21 · NO 77 · RS 32 · TR 323 · UA 7 ·
 *     XK 13                                                (= 625)
 *
 * 🔴 GREECE IS `GR` HERE, NOT `EL`. The bathing water layer of the same
 * agency spells it `EL` and cost 1 734 of 22 010 rows; this roster
 * spells it `GR` (58 stations). Nothing in this module relies on that
 * staying true: every prefix goes through `normaliseCountry`, which
 * resolves `EL` to `gr`, so either spelling is a member.
 *
 * 🔴 The list below is the 13 that were found OUTSIDE the Union, written
 * out — and it exists so that a prefix in NEITHER list is a loud third
 * outcome. "Outside the Union" is a decision we made about these 13; a
 * fourteenth prefix (`UK`, `GB`, a typo, a code the EEA invents) is one
 * nobody has made, and dropping it as if somebody had is exactly how a
 * country disappears with exit 0. parse.ts refuses it as
 * `unrecognised-country`, the importer prints the codes, and exits
 * non-zero after writing everything else.
 *
 * Written out, never derived: a rule that guessed which foreign codes
 * "really" mean somebody else's territory is a rule that will one day
 * admit `UK`.
 */
export const AIR_KNOWN_OUTSIDE_EU27: readonly string[] = [
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
];

/** The three station kinds the roster carries, as our column spells them. */
export const AIR_STATION_TYPES = [
  'traffic',
  'industrial',
  'background',
] as const;
export type AirStationType = (typeof AIR_STATION_TYPES)[number];

/** The source spells them capitalised. */
export const AIR_STATION_TYPE_OF_SOURCE: Readonly<
  Record<string, AirStationType>
> = {
  Traffic: 'traffic',
  Industrial: 'industrial',
  Background: 'background',
};

/**
 * The five pollutants, as the per-station files spell them (`aqi_PM2.5`,
 * `modelled_NO2`, `val_O3` …).
 */
export const AIR_POLLUTANTS = ['PM2.5', 'PM10', 'NO2', 'O3', 'SO2'] as const;
export type AirPollutant = (typeof AIR_POLLUTANTS)[number];

/**
 * The index bands, as the viewer's own script names them
 * (`script/data.js`, `var bands`). Level 1–6.
 */
export const AIR_BAND_LABELS: readonly string[] = [
  'Good',
  'Fair',
  'Moderate',
  'Poor',
  'Very poor',
  'Extremely poor',
];

/**
 * 🔴 A station row NEVER holds a fully modelled hour.
 *
 * `reported` — every pollutant that sets the index was reported.
 * `mixed`    — at least one was reported and at least one is a
 *              gap-filled model estimate (`modelled_<pollutant>: 1`).
 *
 * A third value — every contributing pollutant modelled — is what the
 * newest hour of nearly every station is, and it is a model output that
 * happens to be filed under a station's name. It is not stored: the
 * column refuses it (CHECK), the parser skips such an hour and reads
 * back to the newest one that was at least partly reported, and the
 * 1 km raster (a table of its own) is the one place a page shows a
 * pure model — labelled as one.
 */
export const AIR_BASES = ['reported', 'mixed'] as const;
export type AirBasis = (typeof AIR_BASES)[number];

/**
 * 🔴 The attribution, VERBATIM from the EEA — and there is no
 * `copyrightText` to take it from.
 *
 * The brief for this card said to take the attribution from the service,
 * because a retyped one was a real defect on the bathing water card. Read
 * 29.09.2026: `copyrightText` is the empty string on ALL FIVE image
 * services (`AQMobile_2025/MOSAIC_{GLOBAL,NO2,O3,PM10,PM25}_AQI`), the
 * blob store carries no metadata at all (`content/index.json` lists
 * roster files and one language), the viewer prints only base-map
 * credits, and the EEA catalogue has no record for the index (a title
 * search for it returns nothing; the nearest records are the
 * concentrations download service and the E1b modelling flow).
 *
 * So the string is the one sentence the service does say about who made
 * it — the first sentence under "Methodology documentation and further
 * information" on the viewer page, whose two links are the Commission's
 * DG Environment and the EEA. It names both bodies, as
 * docs/emergency-sources.md §9 requires (the copyright holder differs
 * between the measurements and the EEA's processing of them), and it is
 * a sentence the EEA wrote, not one of ours. The apostrophe is U+2019,
 * as on the page.
 *
 *   curl -s https://airindex.eea.europa.eu/AQI/index.html \
 *     | tr '\n' ' ' | sed 's/<[^>]*>//g' | tr -s ' ' \
 *     | grep -o 'The European Air Quality Index was developed jointly[^.]*\.'
 *
 * The web renders its own copy (apps/web/src/lib/air-quality.ts); a unit
 * test asserts the two are equal, and `verify-attribution.ts` in this
 * directory reads the viewer page and fails if the sentence is no longer
 * on it — which is the check a retyped string cannot pass.
 */
export const AIR_ATTRIBUTION =
  'The European Air Quality Index was developed jointly by the ' +
  'European Commission’s Directorate General for Environment and the ' +
  'European Environment Agency to inform citizens and public ' +
  'authorities about the recent air quality status across Europe.';
