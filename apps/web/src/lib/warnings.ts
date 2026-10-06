// CAMP-150 — the official weather warning, beside the campsite it is about.
//
// 🔴 THE LICENCE IS THE SPECIFICATION. MeteoAlarm's terms permit
// commercial redistribution and then say, in seven clauses, what must be
// on the screen. Four of them are things a reader sees; this module is
// where those four become values a component cannot render without.
//
// Quoted from `https://meteoalarm.org/en/live/page/terms-and-conditions`
// (read 28.09.2026, the page itself dated 15/03/2024), argued in full in
// `docs/road-hazard-sources.md` §1:
//
//   clause 5.3  single country  → the National Meteorological and
//               Hydrological Service's own name
//   clause 5.2  more than one   → "EUMETNET – MeteoAlarm"
//   clause 5.4  the TIME OF ISSUE, as indicated when we extracted it
//   clause 5.5  a link to www.meteoalarm.org
//   clause 5.7  the disclaimer, published word for word
//
// Two more are ours, and they are the reason the card exists:
//
//   the decision is the driver's — we mirror a warning, we never make one
//   nothing fresh to show says so OUT LOUD, because a blank space reads
//   as "all clear", and that is the state a person drives a high-sided
//   van onto a pass in
//
// 🔴 WHAT WE NEVER DO. We do not write "it is dangerous here". That is
// our own assertion, no licence covers it and no disclaimer saves it.
// Every word about the weather on this panel comes from the service that
// issued the warning — `WARNING_WORDS` below is how a test can hold us
// to that.

import type { Warning, WarningFeed } from './warning-types';

export type { Warning, WarningFeed };

/** Clause 5.5: the link, spelled the way the clause spells it. */
export const METEOALARM_URL = 'https://www.meteoalarm.org';

/** Clause 5.2, for information spanning more than one country. */
export const AGGREGATOR = 'EUMETNET – MeteoAlarm';

/**
 * Clause 5.7, word for word.
 *
 * 🔴 NOT A PARAGRAPH TO EDIT. "All redistributors must publish the
 * following disclaimer" is followed by quoted text, so a tidier version
 * of it is a breach rather than an improvement. The test for this
 * compares the rendered page against its own copy of the sentence — see
 * `tests/unit/warning-licence.ts` — so that softening the constant
 * cannot soften the check in the same edit.
 */
export const DISCLAIMER =
  'Time delays between this website and the www.meteoalarm.org website are ' +
  'possible. For the most up-to-date awareness information as published by ' +
  'the participating National Meteorological and Hydrological Services, ' +
  'please refer to www.meteoalarm.org.';

/**
 * Ours, and marked as ours.
 *
 * 🔴 It says what we are NOT telling the reader. The warning above it is
 * somebody else's professional judgement about the weather; this line is
 * the only sentence on the panel we are answerable for, and it makes no
 * claim about conditions at all.
 */
export const OURS =
  'Whether to travel is your decision. We show what the national service ' +
  'published and nothing of our own.';

/** The sentence that must appear in place of silence. */
export const NO_FRESH_DATA = 'No fresh data.';

/**
 * Clause 5.6: "on average less than five minutes and never longer than
 * ten minutes".
 *
 * 🔴 THIS IS A LICENCE TERM BEFORE IT IS A UX CHOICE. Everywhere else on
 * this site the freshness budget is ours to pick — air quality takes four
 * hours, drought takes forty days. Here the number is written into the
 * grant, so showing an eleven-minute-old warning as current is not a
 * stale page, it is redistribution outside the terms.
 *
 * It also means this panel cannot be filled at build time. A page built
 * an hour ago carries hour-old warnings, and six times the budget is six
 * times the budget however good the HTML is. The feed therefore reaches
 * the reader at request time, and this constant is what decides whether
 * what arrived may be shown at all.
 */
export const FRESH_FOR_MINUTES = 10;

const MINUTE_MS = 60_000;

export type Credit =
  /** Clause 5.3 — one country, so the service itself is named. */
  | { kind: 'participant'; names: readonly string[] }
  /** Clause 5.2 — more than one country. */
  | { kind: 'aggregator'; name: typeof AGGREGATOR };

export type WarningState =
  | {
      kind: 'warnings';
      warnings: readonly Warning[];
      credit: Credit;
      fetchedAt: string;
    }
  /** A fresh read that found nothing for this place. A measurement. */
  | { kind: 'clear'; fetchedAt: string }
  | {
      kind: 'no-fresh-data';
      reason: NoFreshReason;
      fetchedAt: string | null;
      ageMinutes: number | null;
    };

export type NoFreshReason =
  /** Nothing arrived, or what arrived could not be read. */
  | 'nothing-arrived'
  /** It arrived, and it is older than clause 5.6 allows. */
  | 'stale'
  /**
   * 🔴 A warning we may not attribute, which we therefore may not show.
   *
   * Clause 5.3 requires the issuing service to be named. A record with no
   * `sender` cannot satisfy it, so it is withheld — and withholding a
   * live warning while printing "no warnings" would be the single worst
   * thing this panel could do. So the panel says it is not showing
   * everything instead.
   */
  | 'unattributable';

/** True when `fetchedAt` is inside the licence's ten minutes. */
export function isFresh(fetchedAt: string | null | undefined, now: Date): boolean {
  const age = ageInMinutes(fetchedAt, now);
  return age !== null && age >= 0 && age <= FRESH_FOR_MINUTES;
}

export function ageInMinutes(
  fetchedAt: string | null | undefined,
  now: Date,
): number | null {
  if (!fetchedAt) return null;
  const at = Date.parse(fetchedAt);
  if (!Number.isFinite(at)) return null;
  return (now.getTime() - at) / MINUTE_MS;
}

/**
 * Clause 5.2 against clause 5.3: who is credited depends on how many
 * countries the information on THIS panel spans, not on how many the
 * feed covers.
 *
 * 🔴 The single-country branch can name more than one service and still
 * be the single-country branch. Belgium publishes through more than one
 * participant; naming one of them would be naming the wrong one, and
 * reaching for "EUMETNET – MeteoAlarm" to avoid choosing would be using
 * the clause that does not apply. Every participant whose warning is on
 * screen is named.
 */
export function creditFor(warnings: readonly Warning[]): Credit | null {
  if (warnings.length === 0) return null;
  const countries = new Set(warnings.map((w) => w.country));
  if (countries.size > 1) return { kind: 'aggregator', name: AGGREGATOR };
  const names = [...new Set(warnings.map((w) => w.sender).filter(isNamed))].sort();
  if (names.length === 0) return null;
  return { kind: 'participant', names };
}

const isNamed = (s: string | null | undefined): s is string =>
  typeof s === 'string' && s.trim() !== '';

/**
 * What the panel shows, for one campsite, at one moment.
 *
 * `feed` is whatever arrived — `null` when the request failed, which is
 * the ordinary case while nothing refreshes it inside the budget.
 * `applicable` are the warnings already decided to cover this campsite.
 *
 * 🔴 Never returns "nothing to draw". Three kinds, and the component
 * renders all three; there is no fourth value meaning "render an empty
 * box", because the whole card is that emptiness is a lie here.
 */
export function warningState(
  feed: WarningFeed | null | undefined,
  applicable: readonly Warning[],
  now: Date,
): WarningState {
  const fetchedAt = feed?.meta?.fetchedAt ?? null;
  const ageMinutes = ageInMinutes(fetchedAt, now);

  // 🔴 A `fetchedAt` in the FUTURE is not a fresh read, it is a clock we
  // cannot reason about — and it used to fall through to the stale
  // branch, which then had no age to print and said "read some time ago".
  // Review found that phrase was neither measured by any test nor
  // declared anywhere. A read we cannot place in time is a read that did
  // not arrive, and this says so.
  if (
    !feed ||
    !Array.isArray(feed.warnings) ||
    fetchedAt === null ||
    ageMinutes === null ||
    ageMinutes < 0
  ) {
    return { kind: 'no-fresh-data', reason: 'nothing-arrived', fetchedAt, ageMinutes };
  }
  if (!isFresh(fetchedAt, now)) {
    return { kind: 'no-fresh-data', reason: 'stale', fetchedAt, ageMinutes };
  }

  // 🔴 Withheld BEFORE the "clear" branch, so that dropping an
  // unattributable warning can never be mistaken for there being none.
  const showable = applicable.filter((w) => isNamed(w.sender) && isNamed(w.sent));
  if (showable.length < applicable.length) {
    return { kind: 'no-fresh-data', reason: 'unattributable', fetchedAt, ageMinutes };
  }

  const credit = creditFor(showable);
  if (!credit) return { kind: 'clear', fetchedAt };
  return { kind: 'warnings', warnings: showable, credit, fetchedAt };
}

/**
 * Clauses 5.2 and 5.3 as one line of text.
 *
 * 🔴 A state with nothing to show still credits the feed we read — the
 * clauses bind what is redistributed, and crediting the aggregator for a
 * read that produced no warning claims nothing about anybody's data.
 */
export function creditLine(state: WarningState): string {
  if (state.kind !== 'warnings') return AGGREGATOR;
  return state.credit.kind === 'participant'
    ? state.credit.names.join(', ')
    : state.credit.name;
}

/**
 * Clause 5.4 — the time of issue, as the source stated it.
 *
 * 🔴 `sent`, NEVER `onset`. CAP's `onset` is when the hazard is expected
 * to begin; `sent` is when the service issued the warning, and the clause
 * asks for the second. Measured across all 27 feeds on 06.10.2026, on the
 * 610 published rows: both fields present on every one, DIFFERENT on
 * every one, median gap 1 028 minutes — seventeen hours — and up to 4.2
 * days. Printing `onset` under the words "issued at" would therefore be
 * wrong on every warning we have ever served, by most of a day.
 */
export const issuedAt = (w: Warning): string | null => w.sent ?? null;

/** A time a reader can read, in UTC, because the warning's own is UTC. */
export function timeLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function ageLabel(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes)) return null;
  if (minutes < 0) return null;
  if (minutes < 90) return `${Math.round(minutes)} minutes`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

/**
 * Why the panel is not showing warnings, in a sentence that never
 * borrows the words of "we looked and there is nothing".
 */
export function noFreshDataSentence(
  s: Extract<WarningState, { kind: 'no-fresh-data' }>,
): string {
  const age = ageLabel(s.ageMinutes);
  switch (s.reason) {
    case 'stale':
      return (
        `The last official warnings we hold were read ${age} ago, ` +
        `past the ${FRESH_FOR_MINUTES} minutes this feed may be redistributed within. ` +
        `This is not a statement that conditions are calm.`
      );
    case 'unattributable':
      return (
        'At least one current warning for this area does not name the service ' +
        'that issued it, so we are not permitted to show it. This is not a ' +
        'statement that conditions are calm.'
      );
    default:
      return (
        'We could not reach the official warning feed, so we have nothing to ' +
        'show you. This is not a statement that conditions are calm.'
      );
  }
}

/**
 * The words on this panel that describe weather — all of which must have
 * come from the source.
 *
 * 🔴 EXISTS FOR THE TEST, AND THE TEST IS THE POINT OF THE CARD. "We do
 * not write 'it is dangerous here'" is easy to agree with and impossible
 * to check by reading the component once. This lists the strings the
 * panel takes from a warning, so a spec can assert that every one of them
 * appears verbatim in the input and that the panel added none.
 */
export const WARNING_WORDS = (w: Warning): readonly string[] =>
  [w.event, w.headline, w.type, levelWord(w), ...w.areas.map((a) => a.name)].filter(
    isNamed,
  );

/**
 * The source's own word for how serious this warning is.
 *
 * 🔴 CHOSEN FROM THEIR STRING, NEVER WRITTEN BY US. `awareness_level`
 * arrives as `2; yellow; Moderate`, and the fetcher keeps everything
 * after the code. We take the first segment of that — the colour the
 * service itself published — rather than mapping 2 to a word of our own.
 * Casing is theirs too: both `yellow` and `Yellow` occur across the
 * feeds, and normalising it would be us editing a warning.
 *
 * It is shown because without it a reader cannot tell a red warning from
 * a yellow one: only 32.6% of published rows (199 of 610, measured
 * 06.10.2026 after language de-duplication) name their level in the event
 * text, so 411 of them do not.
 */
export function levelWord(w: Warning): string | null {
  const label = w.levelLabel;
  if (!isNamed(label)) return null;
  const first = label.split(';')[0]?.trim();
  return isNamed(first) ? first : null;
}

/** The area names this warning covers, as the source wrote them. */
export const areaNames = (w: Warning): readonly string[] =>
  [...new Set(w.areas.map((a) => a.name).filter(isNamed))];
