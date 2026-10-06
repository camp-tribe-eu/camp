// CAMP-101: who gave us which fact, under which licence, and when.
//
// 🔴 This is a legal requirement, not a credit roll.
//
// Two databases now build one campsite page, and they do not ask the
// same thing of us:
//
//   OpenStreetMap        ODbL 1.0 — attribution AND share-alike. Any
//                        Derivative Database we make public carries the
//                        same licence. Where that boundary runs for us
//                        is still open (CAMP-87).
//
//   DATAtourisme         Licence Ouverte 2.0 (Etalab) — commercial reuse
//                        worldwide, attribution only. But the attribution
//                        must name the source AND the date the reused
//                        information was last updated:
//
//                          "La « Réutilisation » ne doit pas induire en
//                           erreur des tiers quant au contenu de
//                           l'« Information », sa source et sa date de
//                           mise à jour."
//
// 🔴 That date clause is why this is per-record and not a line in the
// footer. Measured on 23.09.2026, the records we hold were last touched
// anywhere between 2022-01-04 and the same morning. Printing them side
// by side with no dates, under one "data from DATAtourisme" notice,
// would be exactly the misleading the licence forbids — and it would
// also be a lie to the reader, who is deciding where to sleep.

// CAMP-168: one id for the EEA bathing water source, shared by the
// attribution below and by the component that renders the classification.
// CAMP-164: the same for the EEA air quality index.

export type SpotSource = {
  id: string;
  ref: string;
  /** ISO date the source last changed this record. */
  updatedAt: string;
  /** Our field names this source is responsible for. */
  fields: string[];
};

export type SourceInfo = {
  id: string;
  /** What a reader should see. */
  name: string;
  /** Where the source itself lives. */
  url: string;
  licence: string;
  licenceUrl: string;
  /** One sentence a reader can use to judge the data. */
  about: string;
  /**
   * 🔴 How to phrase the date, because the two sources mean different
   * things by it and conflating them would be a small lie repeated on
   * every page.
   *
   * DATAtourisme stamps each record with the day the tourist office last
   * changed it — that is genuinely "last updated by the source".
   * OpenStreetMap tells us no such thing: all we know is the day our own
   * import last still found the campsite there. Saying "last updated" of
   * that would claim knowledge we do not have.
   */
  dateLabel: string;
  /**
   * 🔴 CAMP-168: how often this source is EXPECTED to change.
   *
   * `continuous` — anybody may edit it any day, so a record nobody has
   *                touched in two years is worth saying out loud.
   *
   * `annual`     — the publisher issues one edition a year on purpose.
   *                A year-old record is then HEALTHY, and flagging it
   *                would train readers to ignore the flag. The EEA
   *                bathing water classification is the first of these:
   *                the 2025 season was published 02.06.2026 and the next
   *                edition is roughly a year away by design.
   *
   * 🔴 It replaces a string test. Staleness used to be gated on
   * `dateLabel.startsWith('Last updated')`, which happened to give the
   * right answer for the two sources that existed and was never a
   * statement about cadence at all — rewording a label would have
   * switched the flag on or off by accident. CAMP-166 generalises
   * freshness across all sources; this field is what it should read.
   *
   * 🔴 CAMP-164 added the third value, and it is the mirror image of
   * `annual`:
   *
   * `hourly`     — the EEA air quality index. A reading a few hours old is
   *                past its budget (AIR_FRESH_FOR_HOURS, lib/air-quality.ts)
   *                and the page says "no fresh data"; a reading two YEARS
   *                old is far past it. The 730-day flag below is about
   *                records nobody edits and must not be what decides this
   *                one, so `shouldFlagStale` never fires for it — the
   *                decision is per record, in `airState`, against the
   *                reader's clock.
   */
  cadence: 'continuous' | 'annual' | 'hourly';
};

/**
 * 🔴 CAMP-198: THE TWO IDs LIVE HERE, where they are the keys of
 * `SOURCES`, and their modules re-export them.
 *
 * They used to be declared in `bathing.ts` and `air-quality.ts` and
 * imported up into this file. That was one-way until those two modules
 * needed `shouldFlagStale` — the rule that decides whether their data has
 * gone stale — at which point the import became a cycle, and a cycle
 * through an object literal does not fail loudly. It fails like this:
 *
 *     import('@/lib/bathing') then import('@/lib/sources')
 *     Object.keys(SOURCES) → ["osm","datatourisme","undefined","eea-air-quality"]
 *
 * `bathing.ts` runs first, reaches its import of this file, this file
 * builds `SOURCES` before `BATHING_SOURCE_ID` has been assigned, and the
 * computed key is the string "undefined". The bathing source is then
 * absent from the registry, so `shouldFlagStale` is handed `null` and
 * answers `false` — a freshness check that cannot fire, which is the
 * exact failure CAMP-198 exists to remove, recreated by the fix for it.
 *
 * Whichever module is imported first now, this one has no imports of its
 * own and is complete before either body runs.
 */
export const BATHING_SOURCE_ID = 'eea-bathing-water';
export const AIR_SOURCE_ID = 'eea-air-quality';

export const SOURCES: Record<string, SourceInfo> = {
  osm: {
    id: 'osm',
    name: 'OpenStreetMap',
    url: 'https://www.openstreetmap.org/',
    licence: 'Open Database License (ODbL)',
    licenceUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    about:
      'Maintained by volunteers anywhere in the world. We re-import it weekly.',
    // We know when WE last looked, never when a mapper last edited.
    dateLabel: 'Last checked against this source on',
    cadence: 'continuous',
  },
  datatourisme: {
    id: 'datatourisme',
    name: 'DATAtourisme',
    url: 'https://www.datatourisme.fr/',
    licence: 'Licence Ouverte 2.0 (Etalab)',
    licenceUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
    about:
      'France’s national tourism data platform. The records are written by regional tourist offices, which is also why the star rating is the official one.',
    dateLabel: 'Last updated by the source on',
    cadence: 'continuous',
  },
  // CAMP-168. The EU's officially designated bathing waters and their
  // classification, one edition per bathing season.
  //
  // 🔴 The licence link points at CC BY 4.0, and that grant is on the
  // VERSIONED catalogue record — one per season. The parent Datahub
  // record, which is the URL below and the one a reader lands on,
  // returns null for every licence field; anyone checking only that page
  // would conclude the dataset has no licence. Recorded here so the next
  // person to verify us does not repeat the search
  // (docs/emergency-sources.md §8).
  [BATHING_SOURCE_ID]: {
    id: BATHING_SOURCE_ID,
    name: 'European Environment Agency — bathing water',
    url:
      'https://www.eea.europa.eu/en/datahub/datahubitem-view/' +
      'c3858959-90da-4c1b-b9ca-492db0e514df',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    about:
      'Reported by the member states under the EU Bathing Water Directive. ' +
      'One classification per bathing season, from at least four samples ' +
      'taken across that season.',
    // 🔴 Not "last updated". The date is the day the SEASON's edition was
    // published, which is a different fact from "somebody touched this
    // record" — and the season it describes is the year on the page.
    dateLabel: 'Classification for the season published on',
    cadence: 'annual',
  },
  // CAMP-164. The EEA's European Air Quality Index: an hourly index per
  // monitoring station, from data the member states report to the EEA,
  // plus a 1 km model for places with no station nearby.
  //
  // 🔴 The licence link is CC BY 4.0, which docs/emergency-sources.md §9
  // reads from the EEA catalogue for the concentrations download service
  // ("License CC-BY 4.0 … Copyright holder: European Environment Agency
  // (EEA)") and from the site-wide legal notice, which makes acknowledgement
  // of the EEA a condition of reuse. The index itself has no catalogue
  // record and its viewer prints no licence; nothing on it says otherwise.
  // Recorded here so the next person to verify us does not repeat the search.
  [AIR_SOURCE_ID]: {
    id: AIR_SOURCE_ID,
    name: 'European Environment Agency — European Air Quality Index',
    url: 'https://airindex.eea.europa.eu/AQI/index.html',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    about:
      'An hourly index per monitoring station, from concentrations the member ' +
      'states report to the EEA, and a 1 km model for places with no station nearby.',
    // 🔴 Two dates on the page and this is the second: the HOUR the value
    // describes is printed beside the value; this one is when we read the
    // EEA's file.
    dateLabel: 'Read from the EEA on',
    cadence: 'hourly',
  },
};

/** Human-readable names for the fields a source can contribute. */
export const FIELD_LABEL: Record<string, string> = {
  name: 'name',
  description: 'description',
  stars: 'official classification',
  website: 'website',
  location: 'location',
  amenities: 'facilities',
  // CAMP-147. Attribution for the price list is not optional: it is the
  // field a reader is most likely to act on, and Licence Ouverte asks
  // for the source and the date of what we reuse.
  tariffs: 'prices',
};

/**
 * 🔴 How stale is too stale to show without saying so.
 *
 * Not a cliff and not a judgement about the campsite — it is the point
 * past which "this is current" stops being a safe thing for a reader to
 * assume. Two years is deliberately generous: a campsite's name and
 * star rating change rarely, so flagging everything over six months
 * would train people to ignore the flag.
 */
export const STALE_AFTER_DAYS = 730;

/**
 * An hourly source that has not moved in this long is a stopped
 * pipeline, not a quiet hour. §12: "more than 2–3 h, or the station
 * drops off the hourly file" — a whole day is far past either.
 */
export const HOURLY_DEAD_AFTER_DAYS = 1;

/** §12: an annual source is healthy "up to 12 months". */
export const ANNUAL_HEALTHY_DAYS = 365;

/** §12: stale for an annual source means "no new season by July". */
export const JULY = 6;

/**
 * Past this, an annual source is late in a way the season cannot
 * explain, and the month stops mattering.
 *
 * 🔴 This exists because the seasonal rule alone WAS the exemption,
 * rewritten. "Over a year old AND it is July or later" reads healthy
 * every January through June — so a bathing-water edition ten years
 * stale was reported as fine for half of each year, and a test in this
 * repo stated that outcome as the intended rule, in those words,
 * passing because all four of its dates fell in June.
 *
 * Two missed editions is not a question about when the season
 * publishes. It is a dead source, in March as much as in August.
 */
export const ANNUAL_LATE_DAYS = 2 * ANNUAL_HEALTHY_DAYS;

export function daysOld(updatedAt: string, today = new Date()): number | null {
  const then = new Date(updatedAt);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((today.getTime() - then.getTime()) / 86_400_000);
}

export function isStale(updatedAt: string, today = new Date()): boolean {
  const days = daysOld(updatedAt, today);
  return days !== null && days > STALE_AFTER_DAYS;
}

/**
 * 🔴 CAMP-166: a budget per source, not an exemption.
 *
 * `docs/emergency-sources.md` §12 is the table these numbers come from,
 * and its point is that **here, old is often correct**:
 *
 *     EEA air quality   ~1 h healthy; the viewer itself defaults to 3 h
 *     EEA bathing water up to 12 months; stale is "no new season by July"
 *     EDO CDI           up to 30 days — it is a dekadal product
 *     GFM flood extent  hours after a pass, and passes are days apart
 *
 * The previous version answered this by EXEMPTING the slow cadences
 * from the 730-day rule — `if (annual || hourly) return false`. That
 * removes the false alarm and the alarm together: an hourly feed dead
 * for a year and an annual edition five years old were both reported as
 * perfectly healthy, which is the second of the two failure modes §12
 * names. Exempting is not budgeting.
 *
 * 🔴 Both directions are the test, and a test that proves one of them
 * does not count. A year-old bathing-water classification must stay
 * quiet; the same record in its third summer must not.
 */
// 🔴 `Pick<…, 'cadence'>`, not `SourceInfo`, and CAMP-198 is why. The
// rule reads ONE field, and demanding the whole record forced
// `bathing.ts` to import the `SOURCES` object to call it — closing a
// cycle, since `SOURCES` is keyed by a constant that lives in
// `bathing.ts`. A cycle through an initialised object is the kind that
// works until module order changes. Every existing caller passes a
// `SourceInfo` and is unaffected.
export function shouldFlagStale(
  source: Pick<SourceInfo, 'cadence'> | null,
  updatedAt: string,
  today = new Date(),
): boolean {
  if (!source) return false;
  const days = daysOld(updatedAt, today);
  if (days === null) return false;

  switch (source.cadence) {
    // An hourly feed that has not moved in a DAY is not slow, it is
    // dead. The reading itself is already called "no fresh data" after
    // AIR_FRESH_FOR_HOURS; this is the record behind it, and the
    // distance between four hours and a day is deliberate — one is a
    // quiet station, the other is a stopped pipeline.
    case 'hourly':
      return days >= HOURLY_DEAD_AFTER_DAYS;

    // 🔴 Twelve months is healthy, and the season is what makes the
    // thirteenth suspicious. §12: "no new season by July". So a
    // year-old edition is fine in March and a question in August —
    // which is why this reads the month and not only the age.
    case 'annual':
      // One edition late is a question only once the season has had
      // time to arrive.
      if (days > ANNUAL_HEALTHY_DAYS && today.getMonth() >= JULY) return true;
      // Two editions late is not a seasonal question at all.
      return days > ANNUAL_LATE_DAYS;

    default:
      return isStale(updatedAt, today);
  }
}

/** The date as a reader reads it. Never invented when the source gave none. */
export function formatUpdated(updatedAt: string): string | null {
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Sources in the order a reader should meet them, with unknown ids kept.
 *
 * 🔴 An id we do not recognise is NOT dropped. Dropping it would silently
 * remove an attribution — the one failure this whole file exists to
 * prevent — so it is rendered with the id itself and no licence claim,
 * which is visibly wrong and therefore gets fixed.
 */
export function describeSources(
  sources: SpotSource[],
): { source: SourceInfo | null; id: string; entry: SpotSource }[] {
  return [...sources]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => ({
      id: entry.id,
      source: SOURCES[entry.id] ?? null,
      entry,
    }));
}
