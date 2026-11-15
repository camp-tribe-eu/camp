import type { AmenityKey, AmenityValue } from './api';
import { GENERAL_AMENITY_KEYS } from './api';
import { STALE_AFTER_DAYS, daysOld, type SpotSource } from './sources';

// CAMP-521 — Trust Layer: a fact, and separately where the fact came from.
//
// "Has electricity" is a property of the place. "The owner told us so" is a
// property of OUR KNOWLEDGE of the place. Until this file the second kind
// lived in prose — a sentence under a block, a line in "Where this comes
// from" — and nothing stopped a new figure from being printed with no word
// about its origin at all.
//
// 🔴 A STATUS IS DERIVED FROM AN ORIGIN, NEVER TYPED. Nobody writes
// `status: 'verified'`. A figure names what stands behind it (`Origin`), and
// `trustOf` turns that into one of the eight words. So the only way to print
// "Verified" is to hold a verification — a method and a date — and an
// imported value cannot be given one by renaming it.
//
// 🔴 FIVE OF THE EIGHT WORDS CANNOT BE PRINTED TODAY, AND THAT IS THE POINT.
// What our records can honestly produce on 13.11.2026:
//
//   imported         every value we took from OpenStreetMap, DATAtourisme …
//   owner-confirmed  a value the claimed owner set (`ownerOverrides`)
//   unknown          the source says nothing
//   outdated         imported, and the source record has not been edited
//                    for longer than `STALE_AFTER_DAYS`
//
// `verified`, `recently-updated`, `community-reported` and `conflicting`
// are in the vocabulary because the card names them, and have NO origin
// that produces them: we run no verification, we do not apply reader
// reports to the data, and we keep one value per field, so we cannot see
// two sources disagree. When one of those processes exists it adds an
// `Origin`, not a string.

export const TRUST_STATUSES = [
  'verified',
  'owner-confirmed',
  'recently-updated',
  'community-reported',
  'imported',
  'conflicting',
  'unknown',
  'outdated',
] as const;

export type TrustStatus = (typeof TRUST_STATUSES)[number];

/**
 * The word a reader sees. A fixed vocabulary, deliberately NOT in the CMS:
 * the guard compares these words with the origin of each value, and a label
 * an editor could retype from "Imported" to "Verified" would pass it. What
 * each word MEANS is prose, and that is in the CMS (page `trust-status`).
 *
 * 🔴 `unknown` reads "Not recorded" — the phrase the site already uses, and
 * the one our terms promise ("we show that it is unknown rather than
 * guessing"). One state must not have two names on one page.
 */
export const TRUST_LABEL: Readonly<Record<TrustStatus, string>> = {
  verified: 'Verified',
  'owner-confirmed': 'Owner confirmed',
  'recently-updated': 'Recently updated',
  'community-reported': 'Community reported',
  imported: 'Imported',
  conflicting: 'Conflicting',
  unknown: 'Not recorded',
  outdated: 'Outdated',
};

/** The CMS page that says what each word means; one section per status. */
export const TRUST_PAGE = 'trust-status';
export const trustSlot = (s: TrustStatus): string => `status-${s}`;

/** What stands behind one value. */
export type Origin =
  /** The source says nothing about it. */
  | { kind: 'none' }
  /** Taken from an outside source as it was. */
  | { kind: 'import'; sourceId: string | null; recordEditedAt?: string | null }
  /** Calculated by us from an imported source (a distance, a count). */
  | { kind: 'derived'; sourceId: string | null }
  /** Set by the claimed owner of the place. */
  | { kind: 'owner' }
  /** Checked by a named method on a named day. Nothing produces this yet. */
  | { kind: 'verification'; method: string; at: string };

export function trustOf(origin: Origin, today: Date = new Date()): TrustStatus {
  switch (origin.kind) {
    case 'none':
      return 'unknown';
    case 'owner':
      return 'owner-confirmed';
    case 'verification': {
      // 🔴 A verification with no method or no date is a word, not a check.
      const at = new Date(origin.at).getTime();
      if (origin.method.trim() === '' || Number.isNaN(at)) {
        throw new Error(
          'trust: "verified" needs a method and a date; got ' +
            JSON.stringify(origin),
        );
      }
      return 'verified';
    }
    case 'derived':
      return 'imported';
    case 'import': {
      const edited = origin.recordEditedAt;
      if (typeof edited === 'string') {
        const days = daysOld(edited, today);
        if (days !== null && days > STALE_AFTER_DAYS) return 'outdated';
      }
      return 'imported';
    }
  }
}

// ── A campsite's fields ─────────────────────────────────────────────────

export interface TrustSubject {
  sources?: readonly SpotSource[] | null;
  ownerOverrides?: Record<string, unknown> | null;
  /** When a mapper last edited the OpenStreetMap entry, if we know. */
  osmRecordEditedAt?: string | null;
}

/** The source that says it gave us `field`, else the first one listed. */
function sourceOf(subject: TrustSubject, field: string): SpotSource | null {
  const all = subject.sources ?? [];
  return all.find((s) => s.fields.includes(field)) ?? all[0] ?? null;
}

/**
 * The day the source record itself was last edited, or `null`.
 *
 * 🔴 NOT `SpotSource.updatedAt` for OpenStreetMap: that is the day our
 * importer last looked (CAMP-256), this week for every campsite, and an
 * "outdated" computed from it could never fire.
 */
function editedAt(subject: TrustSubject, source: SpotSource | null): string | null {
  if (!source) return null;
  if (source.id === 'osm') return subject.osmRecordEditedAt ?? null;
  if (source.id === 'datatourisme') return source.updatedAt;
  return null;
}

const ownerAmenities = (subject: TrustSubject): Record<string, unknown> => {
  const a = subject.ownerOverrides?.amenities;
  return a && typeof a === 'object' ? (a as Record<string, unknown>) : {};
};

export function amenityOrigin(
  subject: TrustSubject,
  key: AmenityKey,
  value: AmenityValue,
): Origin {
  // 🔴 The owner's word first, and only for a value they actually gave:
  // `yes`/`no`. An override that is not one of those never reached the page.
  const told = ownerAmenities(subject)[key];
  if ((told === 'yes' || told === 'no') && told === value) return { kind: 'owner' };
  if (value === 'unknown') return { kind: 'none' };
  const source = sourceOf(subject, 'amenities');
  return {
    kind: 'import',
    sourceId: source?.id ?? null,
    recordEditedAt: editedAt(subject, source),
  };
}

export function amenityTrust(
  subject: TrustSubject,
  values: Readonly<Record<AmenityKey, AmenityValue>>,
  keys: readonly AmenityKey[],
  today: Date = new Date(),
): Record<AmenityKey, TrustStatus> {
  const out = {} as Record<AmenityKey, TrustStatus>;
  for (const k of keys) out[k] = trustOf(amenityOrigin(subject, k, values[k]), today);
  return out;
}

/**
 * The status of the "N recorded" count: it is a sum, so it is as good as
 * its weakest part. All counted facilities owner-confirmed → so is the
 * count; otherwise it is what the imported ones are.
 */
export function facilitiesCountOrigin(
  subject: TrustSubject,
  values: Readonly<Record<AmenityKey, AmenityValue>>,
): Origin {
  const counted = GENERAL_AMENITY_KEYS.filter((k) => values[k] === 'yes');
  const origins = counted.map((k) => amenityOrigin(subject, k, values[k]));
  if (origins.length > 0 && origins.every((o) => o.kind === 'owner')) {
    return { kind: 'owner' };
  }
  return { kind: 'derived', sourceId: sourceOf(subject, 'amenities')?.id ?? null };
}

/** An imported field of the record itself (its type, its name). */
export function fieldOrigin(subject: TrustSubject, field: string): Origin {
  if (field === 'name' && typeof subject.ownerOverrides?.name === 'string') {
    return { kind: 'owner' };
  }
  const source = sourceOf(subject, field);
  return {
    kind: 'import',
    sourceId: source?.id ?? null,
    recordEditedAt: editedAt(subject, source),
  };
}

/** A distance to the nearest something: we calculated it from OpenStreetMap. */
export const CONTEXT_ORIGIN: Origin = { kind: 'derived', sourceId: 'osm' };

// ── The legend ──────────────────────────────────────────────────────────

export interface TrustLegendRow {
  status: TrustStatus;
  label: string;
  meaning: string;
}

/**
 * What the words on THIS page mean, in the vocabulary's order, from the CMS.
 * A status with no sentence in the CMS has no row; no rows is `[]` and the
 * legend is not drawn. The words on the facts stay either way.
 */
export function trustLegend(
  present: Iterable<TrustStatus>,
  sections: ReadonlyArray<{ slot: string | null; body: string | null }> | null,
): TrustLegendRow[] {
  if (!sections) return [];
  const has = new Set(present);
  const out: TrustLegendRow[] = [];
  for (const status of TRUST_STATUSES) {
    if (!has.has(status)) continue;
    const meaning = sections.find((s) => s.slot === trustSlot(status))?.body?.trim();
    if (meaning) out.push({ status, label: TRUST_LABEL[status], meaning });
  }
  return out;
}
