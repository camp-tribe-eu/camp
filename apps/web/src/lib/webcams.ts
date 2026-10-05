// CAMP-190 — what the page may say about a webcam, and what it may not.
//
// 🔴 WE SHOW THE DAYLIGHT FRAME, AND THAT IS A MEASUREMENT, NOT A TASTE.
//
// Windy serves two frames per camera: `current` and `daylight`. Looked at
// on 04.10.2026 at 18:10 UTC, the Bovec camera's `current` preview was
// 1 233 bytes and, opened, a FLAT GREY RECTANGLE — not even a dark
// picture, just grey. Its `daylight` frame, 6 752 bytes, was the valley
// and the mountain.
//
// A grey rectangle on a campsite page is worse than no picture: the
// reader concludes our site is broken, not that the sun has set.
//
// File size cannot be the test — measured across 24 cameras, it flagged
// only 2, because a noisy dark frame compresses larger than a flat one.
// And "is the sun up there now" cannot be computed either: these pages
// are built once and read for days, so the build has no idea what time
// it will be when somebody looks.
//
// So: always `daylight`. During the day it IS the current frame; at
// night it is the last lit one. And we never put a time on it, because
// the API gives no timestamp for that frame — only for the camera.
//
// 🔴 WHAT THE PAGE MAY NOT SAY.
//
//   · never that the camera shows the campsite — at 25 km it is the next
//     valley, and `metres` is rendered for exactly that reason;
//   · never a time for the picture, only for the camera's last report;
//   · never the image without a link back to Windy's page for it, which
//     is their condition for showing it at all.

export interface Webcam {
  ref: string;
  title: string;
  categories: string[];
  detailUrl: string;
  providerUrl: string | null;
  lastFrameAt: string | null;
  metres: number;
}

/**
 * 🔴 Built from the camera's id, which is the one thing about this URL
 * we are sure of.
 *
 * The API returns image URLs in its payload and the tariff page says
 * "Image url validity is limited to 15 minutes". The URLs it returns
 * carry no token and answered fine, so the 15 minutes may be about a
 * different tier or a different form — we could not prove either way.
 *
 * What we do know: these pages are static and live for days, so a URL
 * that expires in fifteen minutes would be a broken image on every page
 * within the hour. The id-addressed form has answered every time we
 * asked, which is the only form that can work for a built page at all.
 * If it ever stops, the image breaks and the caption beside it still
 * reads true — which is why the caption never depends on the picture.
 */
export const frameUrl = (ref: string, size: 'thumbnail' | 'preview' = 'preview'): string =>
  `https://imgproxy.windy.com/_/${size}/plain/daylight/${encodeURIComponent(ref)}/original.jpg?v=2`;

/** The credit Windy's terms require, word for word. */
export const WINDY_CREDIT = 'Webcams provided by windy.com';

export const WEBCAM_RADIUS_M = 25_000;

/**
 * 1 234 m → "1.2 km". Straight-line, and the component says so once.
 *
 * 🔴 A FLOOR AT 50 m, because the rounding produced "0 m away".
 * Measured by review: 0, 12 and 24 metres all printed `0 m`, and "0 m
 * away" reads as a camera pointed at the pitch — the one claim this
 * panel exists to never make. Under the first rounding step the honest
 * sentence is a bound, not a figure.
 */
export function distance(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '';
  if (m < 25) return 'under 50 m';
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(1).replace(/\.0$/, '')} km`;
  return `${Math.round(m / 1000)} km`;
}

/**
 * The direction, where the camera's own title carries one.
 *
 * Windy writes titles like `Saint-Medard-d'Aunis › West: La Plaine`. The
 * part after `›` is the view direction, and it is the source's word, not
 * ours — so it is passed through and never translated or inferred.
 */
export function direction(title: string): string | null {
  const m = /›\s*([A-Za-z-]+)\s*(?::|$)/.exec(title);
  if (!m) return null;
  const word = m[1].toLowerCase();
  return /^(north|south|east|west|north-east|north-west|south-east|south-west)$/.test(word)
    ? word
    : null;
}

/**
 * The camera's name without the `Place › Direction:` scaffolding, so the
 * caption reads as a place rather than as a database row.
 */
export function shortTitle(title: string): string {
  const afterColon = title.includes(':') ? title.slice(title.indexOf(':') + 1) : title;
  const cleaned = afterColon.replace(/›[^:]*/g, '').trim();
  return (cleaned || title.split('›')[0] || title).trim();
}

/**
 * How old the CAMERA's last report is, in whole minutes — never about
 * the picture on screen.
 *
 * Returns null when the catalogue gave no time, or gave one in the
 * future: a clock that read "-4 minutes" would otherwise print as fresh
 * for ever.
 */
export function reportedMinutesAgo(lastFrameAt: string | null, now: Date): number | null {
  if (!lastFrameAt) return null;
  const t = Date.parse(lastFrameAt);
  if (Number.isNaN(t)) return null;
  const mins = Math.floor((now.getTime() - t) / 60_000);
  return mins >= 0 ? mins : null;
}

/**
 * Past this, we do not show the camera at all.
 *
 * 🔴 Measured (CAMP-189, 327 cameras): the median frame is 8 minutes
 * old, 92% are under an hour and 100% under a day. A camera silent for
 * more than a day is not slow, it is off — and a picture from it would
 * be presented beside a live-looking caption.
 */
export const CAMERA_DEAD_AFTER_MINUTES = 24 * 60;

/**
 * 🔴 THE RESERVED-WORD RULE IS NOT HERE, AND THAT IS DELIBERATE.
 *
 * A camera whose own name says "warning", "danger", "risk" or "alert"
 * may not appear beside Copernicus data — but the place to stop it is
 * where the row ENTERS, not where it is drawn:
 *
 *   · `scripts/windy/fetch-webcams.mjs` drops it on import;
 *   · the `webcams` table REFUSES it with a CHECK constraint.
 *
 * An earlier version checked it here, importing `RESERVED_WORDS` from
 * `@/lib/cems`. That one import put this file — and therefore every
 * page that reaches it — inside the CEMS coverage guard's graph: it
 * flagged thirty-odd files as "showing CEMS data and nothing checks the
 * words on them". The guard was right about the graph and wrong about
 * the risk, which is a sign the import was in the wrong place rather
 * than that the guard needed an exemption.
 *
 * A row that cannot exist needs no filter at render time.
 */
export type WebcamVerdict = 'ok' | 'stale' | 'unusable';

/**
 * Why a row can or cannot be shown — the REASON, not just a boolean.
 *
 * 🔴 A boolean here is what let the panel print a false sentence.
 * `absence()` used to count the RAW list while the panel rendered the
 * filtered one, so three cameras dropped for a bad url or a missing
 * timestamp came out as "none of them has reported for more than a
 * day" — which is untrue of a row that never reported at all, and
 * untrue of one whose link we simply cannot use. Review found it.
 *
 * `stale` is the only reason that entitles the page to talk about the
 * age of our reading. Anything else means we hold nothing we can say
 * something honest about, and the page says nothing.
 */
export function verdict(cam: Webcam, now: Date): WebcamVerdict {
  if (!cam.detailUrl?.startsWith('https://')) return 'unusable';
  if (typeof cam.title !== 'string' || !cam.title) return 'unusable';
  if (!Number.isFinite(cam.metres) || cam.metres < 0) return 'unusable';
  const mins = reportedMinutesAgo(cam.lastFrameAt, now);
  // 🔴 No time at all is NOT a pass, and it is NOT staleness either.
  // The catalogue gives one for every active camera we measured; a row
  // without it is a row we cannot say anything honest about, including
  // how old it is.
  if (mins === null) return 'unusable';
  return mins <= CAMERA_DEAD_AFTER_MINUTES ? 'ok' : 'stale';
}

export function usable(cam: Webcam, now: Date): boolean {
  return verdict(cam, now) === 'ok';
}

/** The ones we will show, nearest first, already filtered. */
export function showable(cams: Webcam[] | null | undefined, now: Date): Webcam[] {
  if (!Array.isArray(cams)) return [];
  return cams.filter((c) => usable(c, now)).sort((a, b) => a.metres - b.metres || a.ref.localeCompare(b.ref));
}

/**
 * 🔴 WHY THE PANEL IS EMPTY, WHICH IS TWO DIFFERENT FACTS.
 *
 * Review measured this and it is the worst thing that was in here: the
 * page is built once and read for days, `usable()` is evaluated against
 * the READER's clock, and `CAMERA_DEAD_AFTER_MINUTES` is one day. So 25
 * hours after an import every campsite page in Europe fell to the empty
 * branch and said
 *
 *   "No public webcam within 25 km of this campsite. That is what the
 *    camera network covers, not a statement about the place."
 *
 * — which blames the camera network for OUR stale import, and is simply
 * untrue of a place that has four cameras. Every test passed because
 * every test handed it a `now` near the fixture timestamps.
 *
 * The two facts live in different places and always did:
 *
 *   `none`   the query returned no row. A fact about COVERAGE, settled
 *            at build time and still true next week — 12% of campsites
 *            (CAMP-189), Lithuania at every sampled site.
 *   `stale`  rows exist and every one of them is older than a day. A
 *            fact about OUR last reading, and the sentence must say so.
 *
 * A page may not blame the world for a gap of its own making.
 */
export type WebcamAbsence = 'unknown' | 'none' | 'stale';

/**
 * Why the panel is empty — or `null`, meaning it is not.
 *
 * 🔴 `null` IS AN ANSWER, not an omission. The first version of this
 * returned a `WebcamAbsence` unconditionally, so a campsite with three
 * perfectly good cameras came back `'unknown'` (nothing was stale) and
 * the panel returned early with nothing at all. A function that gives a
 * wrong answer when asked at the wrong moment is a trap; this one can
 * only be misread by ignoring the `null`.
 */
export function absence(cams: Webcam[] | null | undefined, now: Date): WebcamAbsence | null {
  // 🔴 `null` IS NOT `[]`, and conflating them put a false sentence on
  // every page in Europe.
  //
  // The API answers `null` until `scripts/windy/fetch-webcams.mjs` has
  // imported the catalogue, and `[]` once it has and found nothing
  // within the radius. Measured on the live API, 05.10.2026: the table
  // is empty, so every campsite came back `[]` and read
  //
  //   "No public webcam within 25 km of this campsite. That is what the
  //    camera network covers, not a statement about the place."
  //
  // — over a continent where 88% of campsites have a camera within
  // 25 km (CAMP-189). The sentence is a claim about COVERAGE and we had
  // not looked.
  //
  // `unknown` renders nothing. The panel's rule that it is never empty
  // is about campsites without a camera; it was never a licence to
  // speak when we have no data at all.
  if (!Array.isArray(cams)) return 'unknown';
  if (cams.length === 0) return 'none';
  // Something is showable: the panel has cards and is not absent.
  if (cams.some((c) => verdict(c, now) === 'ok')) return null;
  // 🔴 ASKED OF THE SAME ROWS THE PANEL DRAWS, with the same clock.
  // Only rows dropped for AGE entitle the page to say our reading is
  // old; a row we cannot use at all is a row we do not really hold, and
  // claiming either coverage or staleness over it would be inventing.
  return cams.some((c) => verdict(c, now) === 'stale') ? 'stale' : 'unknown';
}

/** "last reported 12 minutes ago" — about the camera, never the picture. */
export function reportedPhrase(mins: number): string {
  if (mins < 1) return 'reported in the last minute';
  if (mins === 1) return 'reported a minute ago';
  if (mins < 60) return `reported ${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  return hours === 1 ? 'reported an hour ago' : `reported ${hours} hours ago`;
}
