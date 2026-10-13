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
  | 'unattributable'
  /**
   * 🔴 A warning we cannot PLACE, which is not the same as no warning.
   *
   * Matching a campsite to a warning is done on zone codes — the
   * `SCHEME:VALUE` pairs in `area.codes`. Measured against all 27 live
   * feeds on 12.10.2026: of 392 areas carrying 139 current warnings,
   * **59 areas had no codes at all** — only a polygon — and for 21 of
   * the 139 warnings that was true of every one of their areas. They
   * were Latvia (39 areas), Estonia (14) and Sweden (6).
   *
   * A code-only matcher answers "not applicable" for those, and that
   * answer is indistinguishable from "there is nothing here". For a
   * Latvian campsite during a Latvian storm that is the worst sentence
   * this panel could print — the same reasoning as `unattributable`
   * above, arrived at from the other direction: there the warning may
   * not be shown, here it cannot be located.
   */
  | 'unlocatable';

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
/**
 * ISO-3166-1 alpha-2, as our database spells a country, to the feed name
 * MeteoAlarm uses.
 *
 * 🔴 TWO VOCABULARIES, AND THE FIRST VERSION OF THIS FILE PRETENDED
 * THEY WERE ONE. `camping_spots.country` is `LV`; `Warning.country` is
 * `latvia`, the feed's own slug. Comparing them as strings is never
 * true, so the whole `unlocatable` branch below was dead on real data
 * while nine green tests said otherwise — they compared the author's
 * literal with the author's literal. Found by review.
 *
 * 🔴 WRITTEN OUT, not derived from `Intl.DisplayNames`. `countryName()`
 * would produce most of these, and it reads its answers from ICU, which
 * differs between Node builds. A mapping that changes with the runtime
 * would take this branch out again, silently, on some machine nobody
 * was looking at.
 *
 * 🔴 `AX` IS NOT A MEMBER STATE AND IS 19 CAMPSITES. Åland is a
 * subdivision of Finland and MeteoAlarm has no feed for it; its
 * warnings arrive under `finland`. The repository already states this
 * rule in `apps/api/src/osm/eu.ts` as `ISO_SUBDIVISION_OF`, and this
 * entry is that rule applied here rather than a second opinion.
 */
export const FEED_COUNTRY: Readonly<Record<string, string>> = {
  AT: 'austria', BE: 'belgium', BG: 'bulgaria', HR: 'croatia',
  CY: 'cyprus', CZ: 'czechia', DK: 'denmark', EE: 'estonia',
  FI: 'finland', FR: 'france', DE: 'germany', GR: 'greece',
  HU: 'hungary', IE: 'ireland', IT: 'italy', LV: 'latvia',
  LT: 'lithuania', LU: 'luxembourg', MT: 'malta', NL: 'netherlands',
  PL: 'poland', PT: 'portugal', RO: 'romania', SK: 'slovakia',
  SI: 'slovenia', ES: 'spain', SE: 'sweden',
  // Subdivision, not a member state. See above.
  AX: 'finland',
};

/**
 * Which of the feed's warnings cover this campsite, and which ones we
 * cannot decide about.
 *
 * 🔴 CODES, NEVER COUNTRY. A Croatian warning on every Croatian campsite
 * is an alarm where there is none, and the card that asked for this
 * panel forbids it in those words. The unit of truth is the zone the
 * issuing service named, which reaches us as `SCHEME:VALUE` in
 * `area.codes` — `EMMA_ID:HR012`, `NUTS3:FR712`, `WARNCELLID:107215000`.
 *
 * 🔴 CASE-INSENSITIVE, because foreign sources do not agree with
 * themselves about it. The comparison lower-cases both sides and keeps
 * the original strings; a zone written `EMMA_ID:FR123` in one feed and
 * `emma_id:fr123` in another is one zone, and treating them as two
 * would silently drop warnings for a reason nobody would ever look for.
 *
 * 🔴 THE SECOND RETURN VALUE IS THE POINT. `unlocatable` holds warnings
 * in THIS campsite's country that carry at least one area with no codes
 * and did not match by code. We cannot say they apply here, and we must
 * not say they do not. `warningState` turns a non-empty list into
 * `no-fresh-data`, never into `clear`.
 *
 * Scoped by country on purpose: a Latvian warning nobody can place is a
 * reason to stay quiet in Latvia, not in Portugal.
 */
export function applicableWarnings(
  country: string,
  codes: readonly string[],
  warnings: readonly Warning[],
): { applicable: readonly Warning[]; unlocatable: readonly Warning[] } {
  // 🔴 `typeof c === 'string'` before `.trim()`: a feed that put a null
  // in `codes` threw here, and a panel that throws renders nothing,
  // which on this card is the forbidden outcome wearing a stack trace.
  const mine = new Set(
    codes
      .filter((c): c is string => typeof c === 'string')
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean),
  );
  const here = FEED_COUNTRY[country.trim().toUpperCase()] ?? country.trim().toLowerCase();

  const applicable: Warning[] = [];
  const unlocatable: Warning[] = [];

  for (const w of warnings) {
    const areas = w.areas ?? [];
    const sameCountry = (w.country ?? '').trim().toLowerCase() === here;
    const codesOf = (a: (typeof areas)[number]) =>
      (a.codes ?? []).filter((c): c is string => typeof c === 'string');

    const matched = areas.some((a) =>
      codesOf(a).some((c) => mine.has(c.trim().toLowerCase())),
    );
    if (matched) {
      applicable.push(w);
      continue;
    }

    // 🔴 WE CANNOT PLACE THE CAMPSITE EITHER, AND THAT IS THE SAME DOUBT.
    //
    // `mine` is empty for every campsite until the zone codes exist on
    // the row (CAMP-287 step 1). A code-only matcher answers "nothing
    // applies" to all of them, which is `clear` for the whole of Europe
    // on the strength of having no data at all. Review measured that
    // state and it is the one this panel exists to prevent.
    if (mine.size === 0) {
      if (sameCountry) unlocatable.push(w);
      continue;
    }

    // 🔴 `some`, NOT `every`, and review proved the difference bites: a
    // warning naming one zone we can read and one we cannot is still a
    // warning we cannot rule out. `every` survived the first mutation
    // run because the only mixed-area case in the suite MATCHED, and a
    // match leaves this loop before reaching here.
    const placeless = areas.some((a) => codesOf(a).length === 0);
    if (placeless && sameCountry) unlocatable.push(w);
  }

  return { applicable, unlocatable };
}

/**
 * Чи це попередження ще ЧИННЕ, за його власним `expires`.
 *
 * 🔴 ДРУГИЙ ГОДИННИК, І ЙОГО ТУТ НЕ БУЛО. Вік ЗНІМКА і вік
 * ПОПЕРЕДЖЕННЯ — різні величини, і код знав лише перший. Фетчер
 * відсіює протерміновані блоки на момент ЗАБОРУ (`dropReason` →
 * `'expired'`), але знімок живе в памʼяті пʼять хвилин, плюс хвилина
 * HTTP-кешу, плюс скільки вкладка його тримає. Попередження, що
 * скінчилось одразу після забору, їхало до читача як чинне. Знайдено
 * рецензією; CAMP-151 називає це першим із трьох годинників і вимагає
 * викидати запис «на кожному читанні, ніколи не вірити фіду».
 *
 * 🔴 Нечитабельний `expires` — теж НЕ чинне. Ми не можемо стверджувати,
 * що діє те, чого не вміємо датувати.
 */
export function inForce(w: Warning, now: Date): boolean {
  const until = w.expires ? Date.parse(w.expires) : Number.NaN;
  return Number.isFinite(until) && until > now.getTime();
}

/**
 * Розділяє на чинні й ні — з ПРИЧИНОЮ, а не булевим прапорцем.
 *
 * Причина, а не булеве: «сьогодні нічого не протермінувалось» і
 * «перевірка на `expires` перестала працювати» виглядають однаково,
 * якщо рахувати лише те, що лишилось. Та сама вимога, що й у
 * `dropReason` фетчера.
 */
export function splitByForce(
  warnings: readonly Warning[],
  now: Date,
): { inForce: readonly Warning[]; expired: number; untimed: number } {
  const live: Warning[] = [];
  let expired = 0;
  let untimed = 0;
  for (const w of warnings) {
    if (inForce(w, now)) {
      live.push(w);
      continue;
    }
    if (w.expires && Number.isFinite(Date.parse(w.expires))) expired += 1;
    else untimed += 1;
  }
  return { inForce: live, expired, untimed };
}

export function warningState(
  feed: WarningFeed | null | undefined,
  applicable: readonly Warning[],
  now: Date,
  unlocatable: readonly Warning[] = [],
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

  // 🔴 ORDER, AND IT IS A SAFETY DECISION, NOT A STYLE ONE.
  //
  // `unattributable` above refuses to show a partial set, because the
  // licence forbids showing those records at all. This is the opposite
  // case: what we matched we MAY show, we simply cannot promise the set
  // is complete. Hiding a warning we did match, in order to admit there
  // may be another we could not place, would trade a certainty for a
  // doubt — so a matched warning is always shown.
  //
  // It is only when we matched NOTHING that the distinction bites, and
  // there it decides everything: `clear` is a measurement ("a fresh read
  // found nothing for this place"), and we have not made that
  // measurement for a warning we could not locate. Saying `clear` there
  // would be the panel's worst sentence, printed to the one reader it
  // was built for.
  if (credit) return { kind: 'warnings', warnings: showable, credit, fetchedAt };
  if (unlocatable.length > 0) {
    return { kind: 'no-fresh-data', reason: 'unlocatable', fetchedAt, ageMinutes };
  }
  return { kind: 'clear', fetchedAt };
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
    case 'unlocatable':
      return (
        'At least one current warning for this country names an area we ' +
        'cannot match to this campsite, so we cannot tell whether it ' +
        'applies here. This is not a statement that conditions are calm.'
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
