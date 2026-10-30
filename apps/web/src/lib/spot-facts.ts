import {
  formatDistance,
  GENERAL_AMENITY_KEYS,
  SPOT_TYPE_LABEL,
  TERRAIN_LABEL,
  WATER_LABEL,
  type NearestFeature,
  type Spot,
  type SpotContext,
} from './api';
import { RAILWAY_STOP, RAILWAY_STOP_TITLE } from './railway-stop';

// What a campsite page says in ONE LINE under its heading, and how far
// away things are drawn in "What's around it" (docs/design-audit.md §10).
//
// 🔴 THE MOCKUP ASKS FOR "from €/night · type · season · elevation", AND
// THREE OF THOSE FOUR DO NOT EXIST in our data (docs/region-insight-
// survey.md §1, local `camptribe_dev`, 63 159 rows): a datable nightly
// price is on 1 row of 52 549; there is no season column; elevation is
// on 2.0 %. Printing the line the mockup draws would mean printing it
// for nobody. So the line is built from what IS recorded, and only for
// the campsite in front of the reader.
//
// 🔴 A FACT THIS CAMPSITE DOES NOT HAVE IS NOT PRINTED — not "—", not
// "n/a", not "unknown". The same rule as `region-insights.ts`: a gap is
// said once, in the sections built to say it (Facilities: "Not
// recorded"), and never as a blank cell in a summary.
//
// 🔴 "NEAREST WATER" ONLY WITH A NAME AND A DISTANCE. `context.water` is
// the nearest water that survived our filter, so it exists for 97.5 % of
// rows and says nothing about the place: 47 % of it is "river" because
// Europe has rivers (survey §4), and 91 rows have it more than 10 km
// away. "By a river" is a property of the map; "Velika Paklenica, 293 m"
// is a fact. A nameless water is left to the sentence under "What's
// around it", which carries its distance.
//
// 🔴 A RAILWAY STOP BEYOND 100 km IS AN ARTEFACT, NOT A FACT. 561 live
// rows say so (the largest 1 888 km): the extract is cut by country and
// the real nearest stop sits across a border we do not hold. Survey §4
// drops them, and so does this line. The row in "What's around it" still
// prints its distance — with a bar that is full — because there the
// number stands next to its scale and cannot be mistaken for a headline.
//
// 🔴 FEWER THAN TWO FACTS AND THE LINE IS NOT PRINTED. Type is on every
// row, so a line of one is the eyebrow above the heading said twice.

/** A line of one is not a line. */
export const MIN_FACTS = 2;

/** Beyond this the "nearest" stop is a hole in our extract (survey §4). */
export const STOP_ARTEFACT_M = 100_000;

export type SpotFactKey = 'type' | 'water' | 'town' | 'stop' | 'facilities';

export interface SpotFact {
  key: SpotFactKey;
  label: string;
  value: string;
}

/** A distance we can say: a finite, non-negative number of metres. */
const usable = (f: NearestFeature | undefined | null): f is NearestFeature =>
  !!f && typeof f.m === 'number' && Number.isFinite(f.m) && f.m >= 0;

const named = (s: string | undefined | null): string | null =>
  typeof s === 'string' && s.trim() !== '' ? s.trim() : null;

/**
 * How many of the general facilities the source says are THERE.
 *
 * 🔴 `yes` only. "Known" would add the sites that recorded "no", and a
 * headline of "5 facilities" over three "no" and two "yes" says the
 * opposite of what was recorded. Zero is not a fact either: it is the
 * absence of a record, and a "0" in a summary would read as "has none".
 * Accessibility has its own group on the page and is not summed in.
 */
export function facilitiesPresent(amenities: Spot['amenities'] | undefined): number {
  if (!amenities) return 0;
  return GENERAL_AMENITY_KEYS.filter((k) => amenities[k] === 'yes').length;
}

/**
 * The facts of one campsite, in reading order, or `[]` when there are
 * fewer than `MIN_FACTS` of them.
 */
export function spotFacts(
  spot: Pick<Spot, 'type' | 'context' | 'amenities'>,
): SpotFact[] {
  const c: SpotContext = spot.context ?? {};
  const out: SpotFact[] = [];

  const type = SPOT_TYPE_LABEL[spot.type];
  if (type) out.push({ key: 'type', label: 'Type', value: type });

  const waterName = named(c.water?.name);
  if (usable(c.water) && waterName) {
    out.push({
      key: 'water',
      label: 'Nearest water',
      value: `${waterName}, ${formatDistance(c.water.m)}`,
    });
  }

  if (usable(c.town)) {
    const town = named(c.town.name);
    out.push({
      key: 'town',
      label: 'Nearest town',
      value: town ? `${town}, ${formatDistance(c.town.m)}` : formatDistance(c.town.m),
    });
  }

  if (usable(c.station) && c.station.m <= STOP_ARTEFACT_M) {
    const stop = named(c.station.name);
    out.push({
      key: 'stop',
      label: RAILWAY_STOP_TITLE,
      value: stop
        ? `${stop}, ${formatDistance(c.station.m)}`
        : formatDistance(c.station.m),
    });
  }

  const n = facilitiesPresent(spot.amenities);
  if (n > 0) {
    out.push({
      key: 'facilities',
      label: 'Facilities',
      value: `${n} recorded`,
    });
  }

  return out.length >= MIN_FACTS ? out : [];
}

// ── "What's around it": the scale ──────────────────────────────────────

/**
 * 🔴 EACH SCALE IS A CONSTANT, NEVER A FUNCTION OF THE NEIGHBOURS.
 *
 * A bar normalised to the farthest of the other figures on the page
 * lies in exactly the place the reader needs it not to: in a remote
 * valley where the shop is 9 km and the stop 14 km, the nearer one
 * would be drawn as "far" and the farther as "full", and the bars would
 * look the same as in a village. Fixed ends mean 2.1 km of town is the
 * same width of bar on every page of the site.
 *
 * The ends were chosen once, from the distribution over the 55 542 live
 * local rows that have the figure (`camptribe_dev`, 29.10.2026,
 * `percentile_cont` over `context->X->>'m'`) and rounded to a number a
 * reader can hold: a bar is full only for the farthest tenth or so.
 *
 *   water        p50 373 m   p90 2.9 km   → 5 km
 *   town         p50 8.3 km  p90 22.8 km  → 20 km
 *   supermarket  p50 2.4 km  p90 9.3 km   → 10 km
 *   stop         p50 7.2 km  p90 25.4 km  → 30 km
 *
 * A distance past the end fills the bar and nothing more; the number is
 * printed beside it either way.
 */
export const SCALE_MAX_M = {
  water: 5_000,
  town: 20_000,
  supermarket: 10_000,
  stop: 30_000,
} as const;

export type ScaleKey = keyof typeof SCALE_MAX_M;

/** "5 km", for the right-hand end of a track. */
export const scaleEnd = (key: ScaleKey): string => `${SCALE_MAX_M[key] / 1000} km`;

/**
 * Width of the filled part, in percent of the track, rounded to two
 * places; 100 for anything at or beyond the end. `null` for a distance
 * we do not have — and then there is no track at all.
 */
export function scaleFill(key: ScaleKey, m: number | undefined | null): number | null {
  if (typeof m !== 'number' || !Number.isFinite(m) || m < 0) return null;
  const pct = (Math.min(m, SCALE_MAX_M[key]) / SCALE_MAX_M[key]) * 100;
  return Math.round(pct * 100) / 100;
}

export interface AroundRow {
  key: ScaleKey | 'elevation' | 'terrain';
  label: string;
  value: string;
  /** Present only where there is a distance to draw. */
  scale?: { fill: number; end: string };
}

/**
 * The rows of "What's around it", in reading order. A figure whose
 * distance is not a number is not a row — neither a line nor an empty
 * track — and the sentence above the rows is built from the same list of
 * what survived (`cleanContext`), so the two cannot disagree.
 */
export function aroundRows(ctx: SpotContext | undefined): AroundRow[] {
  // The one place a distance is judged usable: after this, every nearest
  // feature in `c` has a number of metres.
  const c = cleanContext(ctx);
  const rows: AroundRow[] = [];
  const dist = (key: ScaleKey, label: string, f: NearestFeature | undefined) => {
    if (!f) return;
    rows.push({
      key,
      label,
      value: formatDistance(f.m),
      scale: { fill: scaleFill(key, f.m) as number, end: scaleEnd(key) },
    });
  };

  if (c.water) dist('water', named(c.water.name) ?? WATER_LABEL[c.water.kind], c.water);
  dist('town', named(c.town?.name) ?? 'Nearest town', c.town);
  dist('supermarket', 'Supermarket', c.supermarket);
  dist(
    'stop',
    named(c.station?.name) ? `${named(c.station?.name)} ${RAILWAY_STOP}` : RAILWAY_STOP_TITLE,
    c.station,
  );
  if (c.elevation !== undefined) {
    rows.push({ key: 'elevation', label: 'Elevation', value: `${c.elevation} m` });
  }
  if (c.terrain) {
    rows.push({
      key: 'terrain',
      label: 'Terrain',
      value: `${TERRAIN_LABEL[c.terrain.type]} (${c.terrain.relief} m relief)`,
    });
  }
  return rows;
}

/**
 * The context with every nearest-feature that has no usable distance
 * taken out, so the sentence under "What's around it" cannot print
 * "undefined m from …" for a row that is not drawn.
 */
export function cleanContext(ctx: SpotContext | undefined): SpotContext {
  const c = { ...(ctx ?? {}) };
  if (!usable(c.water)) delete c.water;
  if (!usable(c.town)) delete c.town;
  if (!usable(c.supermarket)) delete c.supermarket;
  if (!usable(c.station)) delete c.station;
  return c;
}
