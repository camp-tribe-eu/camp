// CAMP-59: deciding whether we are healthy, separately from measuring it.
//
// 🔴 THE FOUR WAYS AN ALARM GOES BLIND, and how each is answered here.
//
// The card names them, all from real incidents. They are not abstract —
// every one of them has shipped in this project or the one before it:
//
//   1. A window shorter than the collector's pace. An alarm that asks
//      "anything in the last 5 minutes?" against a job that reports
//      hourly is red all the time, gets muted, and then is not there
//      when it matters. → Every freshness limit below is expressed
//      against the thing's OWN cadence, and written down beside it.
//
//   2. A "less than" condition on an empty result. `count < 10` is FALSE
//      when the query returns nothing at all, so a database that answers
//      with silence reads as healthy. → Every check here asserts a
//      POSITIVE fact: a number that must be present and above zero. An
//      absent field is a failure, never a pass.
//
//   3. A row written only on failure. Then "no rows" means either "fine"
//      or "the writer is dead", and nothing can tell them apart. → We
//      read the state of the world (how many campsites are there), not
//      a log of complaints.
//
//   4. A silent zero is not "nothing to report". → `null` and `0` are
//      different values here and are treated differently: null means we
//      could not measure, and that is a failure of the check itself.
//
// Kept pure so all of it can be tested without a database, which is the
// only way to drive the branches that matter — the ones that only happen
// when something is already broken.

export type Level = 'ok' | 'degraded' | 'down';

export interface Check {
  ok: boolean;
  /** Said in words, because an alarm is read by a person at a bad moment. */
  detail: string;
}

export interface Facts {
  /** Milliseconds for a trivial query, or null if it did not answer. */
  databaseMs: number | null;
  /** The PostGIS version string, or null if the extension did not answer. */
  postgis: string | null;
  /** Campsites currently published. */
  spots: number | null;
  /** Of those, how many carry computed surroundings. */
  withSurroundings: number | null;
  /** Hours since the STALEST country was last touched, or null if never. */
  importAgeHours: number | null;
  /**
   * 🔴 How many countries, and the smallest one's campsite count.
   *
   * A single total cannot notice a country disappearing. Measured
   * 24.09.2026: the floor was 1,000 while the site held 61,521 across 27
   * states — losing France and Germany outright would leave 28,450 and
   * still report "ok". A floor that does not track the data stops meaning
   * anything the moment the data grows.
   */
  countries: number | null;
  smallestCountry: number | null;
}

/**
 * How stale the campsite data may be before it is worth saying so.
 *
 * 🔴 Derived from the job's own cadence, not chosen. osm-weekly runs
 * every 7 days, and CAMP-103's watchdog already allows it 8 before
 * complaining. A health endpoint that shouted at 8 days while the
 * watchdog stayed quiet until 8 would be two guards disagreeing about
 * the same fact, which is how people learn to believe neither. Nine days
 * puts this one strictly after it.
 */
export const IMPORT_STALE_HOURS = 9 * 24;

/**
 * Below this, the database is answering but not usefully.
 *
 * 🔴 Not zero. Zero campsites is obviously broken; so is 580 on a site
 * with tens of thousands, which is exactly what the throttled build
 * produced when it shipped 580 pages and exited 0.
 *
 * ⚠️ But an ABSOLUTE floor decays. This was 1,000 when the site held
 * 9,830 — a tenth of it. One night later the site held 61,521 and the
 * same number was 1.6%, so losing France and Germany together would
 * still have read as healthy. The absolute floor is kept only as a
 * backstop against a genuinely empty database; the real check is per
 * country, below.
 */
export const MIN_SPOTS = 100;

/**
 * Every published country must have at least one campsite.
 *
 * 🔴 This is what actually catches a country vanishing, and it catches it
 * whatever the total is. A country with zero published campsites has
 * either lost its import or lost its rows, and both mean the site is
 * serving country pages that lead nowhere.
 */
export const MIN_PER_COUNTRY = 1;

/**
 * Fewer than this many countries means the import itself is broken.
 *
 * The EU-27 is the stated scope (CAMP-118). A database holding two or
 * three countries is the state this project was in before the import was
 * fixed on 24.09.2026 — and it looked entirely healthy at the time.
 */
export const MIN_COUNTRIES = 20;

/** Slow enough that a person would notice, measured on the cheapest query. */
export const SLOW_DB_MS = 2000;

export function evaluate(facts: Facts): {
  status: Level;
  checks: Record<string, Check>;
} {
  const checks: Record<string, Check> = {};

  // 🔴 null is not zero and not "fine". Every check starts by refusing to
  // interpret a measurement that did not happen.
  if (facts.databaseMs === null) {
    checks.database = { ok: false, detail: 'the database did not answer' };
  } else if (facts.databaseMs > SLOW_DB_MS) {
    checks.database = {
      ok: false,
      detail: `the database took ${facts.databaseMs} ms for a trivial query`,
    };
  } else {
    checks.database = {
      ok: true,
      detail: `answered in ${facts.databaseMs} ms`,
    };
  }

  checks.postgis = facts.postgis
    ? { ok: true, detail: `PostGIS ${facts.postgis}` }
    : {
        ok: false,
        detail: 'PostGIS did not answer — every map query depends on it',
      };

  // 🔴 A count must be a whole, non-negative number. NaN and Infinity are
  // not "absent", so the null checks do not catch them — and review
  // showed evaluate() calling NaN campsites healthy with a 200.
  const counted = (n: number | null): n is number =>
    typeof n === 'number' && Number.isInteger(n) && n >= 0;

  if (!counted(facts.spots)) {
    checks.spots = { ok: false, detail: 'could not count campsites' };
  } else if (facts.spots < MIN_SPOTS) {
    checks.spots = {
      ok: false,
      detail: `only ${facts.spots} campsites are published, expected at least ${MIN_SPOTS}`,
    };
  } else {
    checks.spots = { ok: true, detail: `${facts.spots} campsites published` };
  }

  // 🔴 The check that notices one country disappearing, whatever the total.
  if (!counted(facts.countries) || !counted(facts.smallestCountry)) {
    checks.countries = {
      ok: false,
      detail: 'could not count campsites per country',
    };
  } else if (facts.countries < MIN_COUNTRIES) {
    checks.countries = {
      ok: false,
      detail: `only ${facts.countries} countries are published, expected at least ${MIN_COUNTRIES}`,
    };
  } else if (facts.smallestCountry < MIN_PER_COUNTRY) {
    checks.countries = {
      ok: false,
      detail: 'a published country has no campsites at all',
    };
  } else {
    checks.countries = {
      ok: true,
      detail: `${facts.countries} countries, smallest has ${facts.smallestCountry}`,
    };
  }

  // Surroundings are the site's one real differentiator, so their
  // disappearance is worth noticing — but a shortfall degrades rather
  // than downs: the site still works, it is just less itself.
  if (!counted(facts.withSurroundings) || !counted(facts.spots)) {
    checks.surroundings = {
      ok: false,
      detail: 'could not count computed surroundings',
    };
  } else if (facts.withSurroundings > facts.spots) {
    // 🔴 An impossible number is a broken measurement, not good news.
    //
    // Surroundings are a subset of campsites, so this cannot happen
    // while both numbers count the same thing at the same moment. It
    // stays because the second half of that sentence is a property of
    // the query, not of the world: the service now reads both in one
    // scan (it used to use two, and review pointed out that the only
    // thing this rule could then catch was that race). If a later change
    // splits them again, adds a join that multiplies, or filters one
    // side and not the other, this is what says so — instead of a number
    // that looks better the more wrong it is. 999 999 of 61 521 would
    // have read as 1626% coverage and passed a `> 0` test with room.
    checks.surroundings = {
      ok: false,
      detail: `${facts.withSurroundings} campsites have surroundings but only ${facts.spots} exist — the two counts disagree`,
    };
  } else {
    const share = facts.spots > 0 ? facts.withSurroundings / facts.spots : 0;
    checks.surroundings = {
      ok: facts.withSurroundings > 0,
      detail: `${facts.withSurroundings} of ${facts.spots} campsites have surroundings (${(share * 100).toFixed(1)}%)`,
    };
  }

  if (facts.importAgeHours === null || !Number.isFinite(facts.importAgeHours)) {
    checks.osmImport = {
      ok: false,
      detail: 'no campsite has ever been seen by the import',
    };
  } else if (facts.importAgeHours < 0) {
    // 🔴 A row stamped in the future is a clock, not freshness, and a
    // negative age sails under every upper bound. check-schedule.mjs
    // learned the same thing and clamps; here it is said out loud.
    checks.osmImport = {
      ok: false,
      detail: `the newest campsite is stamped ${Math.abs(Math.floor(facts.importAgeHours))} h in the future — check the clock`,
    };
  } else if (facts.importAgeHours > IMPORT_STALE_HOURS) {
    checks.osmImport = {
      ok: false,
      detail: `the OSM import last touched anything ${Math.floor(facts.importAgeHours / 24)} days ago`,
    };
  } else {
    checks.osmImport = {
      ok: true,
      detail: `last import ${Math.floor(facts.importAgeHours)} h ago`,
    };
  }

  // 🔴 What makes this DOWN rather than merely unhappy.
  //
  // An uptime monitor reads the status code and nothing else. So the
  // things that mean "the site cannot serve" — no database, no PostGIS,
  // no data — must be the things that produce a non-200. Everything
  // else is worth saying in the body and not worth waking anybody for.
  const fatal =
    !checks.database.ok ||
    !checks.postgis.ok ||
    !checks.spots.ok ||
    !checks.countries.ok;
  const anyBad = Object.values(checks).some((c) => !c.ok);

  return {
    status: fatal ? 'down' : anyBad ? 'degraded' : 'ok',
    checks,
  };
}

/** 200 while we can serve, 503 when we cannot. Nothing in between. */
export const statusCode = (level: Level) => (level === 'down' ? 503 : 200);
