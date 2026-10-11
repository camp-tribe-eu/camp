// CAMP-150 — the shape `scripts/meteoalarm/fetch-warnings.mjs` writes.
//
// 🔴 A SEPARATE FILE SO THE PANEL'S LOGIC DOES NOT OWN THE FEED'S SHAPE.
// `warnings.ts` is about what a licence requires on screen; this is about
// what CAMP-148 hands it. They change for different reasons and on
// different cards.
//
// Every field here is one the fetcher keeps, and the comments say what
// the source means by it — because three of them are times and the
// difference between those times is the whole of clause 5.4.

/** One geographic area a warning is about, as the source gave it. */
export type WarningArea = {
  /** `areaDesc` — free text, in the language of the block. */
  name: string | null;
  /** Every geocode as `SCHEME:VALUE`. Six schemes are in use (CAMP-149). */
  codes: readonly string[];
  polygons: readonly string[];
  circles: readonly string[];
};

export type Warning = {
  id: string;
  /** Lower-case feed name, e.g. `croatia`. */
  country: string;

  // ---- what the service says about the hazard. None of it is ours. ----
  event: string | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  /** The source's own word for the hazard kind, passed through. */
  type: string | null;
  typeCode: string | null;
  /** 1–4, where 1 (green) never reaches us: green is not a warning. */
  level: number | null;
  /**
   * What the source calls that level, in its own words — the part of
   * `awareness_level` after the code, e.g. `yellow; Moderate`.
   *
   * 🔴 Kept because the level is otherwise invisible to a reader: only
   * 199 of the 610 published rows name it in `event` or `headline` —
   * 32.6%, measured across all 27 feeds on 06.10.2026, counted after the
   * language de-duplication so the denominator is rows a reader can
   * actually meet. The casing is the
   * source's own and varies between feeds (`yellow` and `Yellow` both
   * occur); it is passed through rather than tidied, because tidying
   * somebody else's warning is editing it.
   */
  levelLabel: string | null;

  // ---- three different times, and they are not interchangeable ----
  /**
   * 🔴 CAP `sent`: WHEN THE SERVICE ISSUED IT. This is the one clause 5.4
   * asks for, and the one the fetcher did not keep until CAMP-150.
   */
  sent: string | null;
  /** CAP `onset`: when the hazard is expected to begin. Not the issue time. */
  onset: string | null;
  /** CAP `effective`: present on no block measured; kept as itself. */
  effective: string | null;
  expires: string | null;

  areas: readonly WarningArea[];

  /**
   * CAP `senderName` — the readable name of the National Meteorological
   * and Hydrological Service. Clause 5.3 is about THIS field.
   *
   * 🔴 Not `senderId`. On the live feeds both are present on every block
   * and they differ on every block: Croatia's name is "DHMZ Državni
   * hidrometeorološki zavod" while its `sender` is "https://meteo.hr".
   * A URL is not the name of a service.
   */
  sender: string | null;
  /** CAP `sender` — the issuing identifier, often a URL. */
  senderId: string | null;
  language: string | null;
};

export type WarningFeed = {
  meta: {
    source: string;
    sourceUrl: string;
    /**
     * When WE read the feed. Clause 5.6 is measured against this and
     * nothing else, so a feed without it cannot be shown.
     */
    fetchedAt: string;
    [key: string]: unknown;
  };
  warnings: readonly Warning[];
};
