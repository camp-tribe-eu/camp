// CAMP-150 — MeteoAlarm's terms, written out here from the licence.
//
// 🔴 DELIBERATELY NOT IMPORTED FROM `src/lib/warnings.ts`, for the reason
// `cems-panel.ts` gives about the CEMS notices: if the panel's constant
// and the check's expectation were one binding, softening the constant
// would soften the check in the same edit and the two would go on
// agreeing about a page that no longer complies. The spec asserts they
// are EQUAL instead, so they can only change together, on purpose, where
// a reviewer sees both.
//
// Source: `https://meteoalarm.org/en/live/page/terms-and-conditions`,
// clause 5, read 28.09.2026 (the page states "Last Updated: 15/03/2024").
// Quoted and argued in `docs/road-hazard-sources.md` §1.

/** Clause 5.7, word for word. */
export const DISCLAIMER_VERBATIM =
  'Time delays between this website and the www.meteoalarm.org website are ' +
  'possible. For the most up-to-date awareness information as published by ' +
  'the participating National Meteorological and Hydrological Services, ' +
  'please refer to www.meteoalarm.org.';

/** Clause 5.5 — the clause names this URL, so the page must carry it. */
export const REQUIRED_LINK = 'www.meteoalarm.org';

/** Clause 5.2 — the credit for information spanning more than one country. */
export const AGGREGATOR_CREDIT = 'EUMETNET – MeteoAlarm';

/** Clause 5.6 — "never longer than ten minutes". */
export const MAX_DELAY_MINUTES = 10;

/**
 * Every fixed word this panel is allowed to print.
 *
 * 🔴 THIS LIST IS THE "NO PHRASE OF OUR OWN" TEST. The card forbids us
 * writing "it is dangerous here" — our own assertion about conditions,
 * which no licence covers and no disclaimer saves. That is easy to agree
 * with and impossible to verify by reading the component once.
 *
 * So the spec renders the panel with sentinel data, removes everything
 * the data supplied and everything named here, and fails if any word is
 * left. A new sentence in the component is then red until somebody adds
 * it HERE — which is the moment to ask whether we are allowed to say it.
 */
export const PANEL_CHROME: readonly string[] = [
  'Official weather warnings',
  'Issued',
  // The severity line. The number and the colour word come from the
  // warning; "Level", "of 4" and "calls" are the frame around them, and
  // "calls" is doing real work — it attributes the judgement to the
  // service instead of making it ours.
  'Level',
  'of 4, which',
  'calls',
  'the issuing service',
  'Source:',
  'via',
  'No official warning was in force for this area when we last read the feed,',
  'No fresh data.',
  'Whether to travel is your decision. We show what the national service published and nothing of our own.',
  'Warnings are redistributed within 10 minutes of publication or not at all.',
  // The three reasons there is nothing to show. Each one ends by saying
  // what it is NOT, because the alternative reading is the dangerous one.
  'The last official warnings we hold were read',
  'ago, past the 10 minutes this feed may be redistributed within.',
  'At least one current warning for this area does not name the service that issued it, so we are not permitted to show it.',
  'We could not reach the official warning feed, so we have nothing to show you.',
  'This is not a statement that conditions are calm.',
  DISCLAIMER_VERBATIM,
  REQUIRED_LINK,
  AGGREGATOR_CREDIT,
];
