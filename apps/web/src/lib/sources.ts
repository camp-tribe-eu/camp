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
import { BATHING_SOURCE_ID } from './bathing';

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
   */
  cadence: 'continuous' | 'annual';
};

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
 * 🔴 CAMP-168: should a reader be told this record has gone quiet?
 *
 * Only where going quiet means something. A source that anybody may edit
 * any day and has not been edited in two years is worth a sentence. A
 * source that publishes one edition per year is doing exactly what it
 * said it would, and an "out of date" flag on it is a false alarm we
 * would be training people to ignore.
 *
 * 🔴 Both halves matter and a test mutates each: `annual` must never
 * flag however old the record is, and `continuous` must still flag at
 * the same 730 days it always did.
 */
export function shouldFlagStale(
  source: SourceInfo | null,
  updatedAt: string,
  today = new Date(),
): boolean {
  if (!source) return false;
  if (source.cadence === 'annual') return false;
  return isStale(updatedAt, today);
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
