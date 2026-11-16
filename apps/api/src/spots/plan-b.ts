import { publishedCountrySql } from './unpublished-countries';
import { notSecondarySql } from './links';
import { canonicalPath } from './canonical';
import { decide } from '../datatourisme/match';

// CAMP-524: «План Б» — «if it's full here».
//
// 🔴 WHAT THIS CLAIMS, AND WHAT IT DOES NOT. We hold NO availability data
// for any campsite, so this never says a place has room: it names up to
// three other places within 15 km and says in the same breath that it
// does not know. The page copy is the web's; the selection is here.
//
// 🔴 NOT A SECOND «CAMPSITES NEARBY». That list is "the six closest
// rows". This one answers a different question — "where would I go if
// this is full" — so it prefers places of a DIFFERENT character (camper
// stops, free and wild sites) and ground away from the coast or higher
// up, which is where the July–August crowd is not. Nothing here is
// popularity: we hold no such metric and invent none.
//
// 🔴 THE ORDER IS DISCLOSED (Dir. 2005/29/EC art. 7(4a)). `PLAN_B_RANKING`
// is built FROM the same list that builds the ORDER BY, so a criterion
// cannot be in the query and missing from the sentence, or the reverse.
// The web prints the sentence verbatim and draws NO block without it.
//
// NO NEST IMPORTS, like fuel/match.ts: the selection must be reachable
// by a test without the service layer.

/** Straight-line radius. 15 km is the card's figure, not a tuned one. */
export const PLAN_B_RADIUS_M = 15_000;
/** At most this many alternatives are shown. */
export const PLAN_B_LIMIT = 3;
/**
 * Rows read before the duplicate rule runs. `decide` is TypeScript, so
 * the duplicates are removed after the SQL; 30 is far above any real
 * cluster of second copies of one site (the fold files measured 2–3).
 */
const OVERFETCH = 30;
/** A water body this close, and it is the sea, makes a place coastal. */
export const COASTAL_M = 2_000;

/** Types that are a different character from a classic paid campsite. */
export const OTHER_CHARACTER_TYPES = ['camper_stop', 'free', 'wild'] as const;

interface Criterion {
  key: 'character' | 'inland' | 'higher' | 'nearer';
  /** The words the reader gets for this step. */
  words: string;
  /** ORDER BY fragment over the columns of the inner select. */
  order: string;
}

/**
 * First criterion wins; each later one only separates ties. The order of
 * this array IS the order of the sentence.
 */
export const PLAN_B_CRITERIA: readonly Criterion[] = [
  {
    key: 'character',
    words: 'camper stops, free and wild places before paid campsites',
    order: `(CASE WHEN type IN (${OTHER_CHARACTER_TYPES.map((t) => `'${t}'`).join(', ')}) THEN 0 ELSE 1 END)`,
  },
  {
    key: 'inland',
    words: `places not on the coast (sea within ${COASTAL_M / 1000} km) before coastal ones`,
    order: '(CASE WHEN coastal THEN 1 ELSE 0 END)',
  },
  {
    key: 'higher',
    words:
      'places higher than this campsite (where both heights are known) before the rest',
    order: '(CASE WHEN elevation > here_elevation THEN 0 ELSE 1 END)',
  },
  {
    key: 'nearer',
    words: 'then the nearest first',
    order: 'metres',
  },
];

/** The sentence printed beside the block. */
export const PLAN_B_RANKING = `Ranked by, in this order: ${PLAN_B_CRITERIA.map((c) => c.words).join('; ')}. Nothing else moves a place up.`;

export interface PlanBItem {
  slug: string;
  name: string | null;
  country: string;
  region: string | null;
  /** Canonical page path, built by the same function every link uses. */
  path: string;
  type: string;
  /** Straight-line metres, never a driving distance. */
  metres: number;
  /** Metres above sea level, only where we have it. */
  elevation: number | null;
  /** This place's height minus the current campsite's; null if either is unknown. */
  elevationDelta: number | null;
}

export interface PlanBView {
  /** Printed verbatim beside the block. No sentence, no block. */
  ranking: string;
  radiusM: number;
  items: PlanBItem[];
}

/** The slice of a DataSource this file needs. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

const ELE = (col: string): string =>
  `(CASE WHEN jsonb_typeof(${col}.context->'elevation') = 'number'
         THEN round((${col}.context->>'elevation')::numeric)::int END)`;

const COASTAL = (col: string): string =>
  `(coalesce(${col}.context->'water'->>'kind' = 'sea'
        AND jsonb_typeof(${col}.context->'water'->'m') = 'number'
        AND (${col}.context->'water'->>'m')::numeric <= ${COASTAL_M}, false))`;

/**
 * `$1` slug, `$2` radius in metres, `$3` rows to read.
 *
 * Exported so the DB spec runs THIS TEXT. The first line of defence is
 * the bounding box (`&&`), which lets the GiST index bound the walk —
 * the exact test is the geography distance, the box only has to be
 * generous: 111 320 m per degree of latitude, shrunk by cos(lat) for
 * longitude, floored so a pole cannot divide by zero.
 */
export const PLAN_B_SQL = `
  WITH me AS (
    SELECT s.id, s.name, s.location,
           ST_Y(s.location) AS lat, ST_X(s.location) AS lon,
           ${ELE('s')} AS elevation
      FROM camping_spots s
     WHERE s.slug = $1 AND ${publishedCountrySql('s')}
  ), found AS (
    SELECT c.slug, c.name, c.country, c.region, c.type::text AS type,
           round(ST_Distance(c.location::geography, me.location::geography))::int AS metres,
           ${ELE('c')} AS elevation,
           me.elevation AS here_elevation,
           ${COASTAL('c')} AS coastal,
           me.name AS here_name, me.lat AS here_lat, me.lon AS here_lon,
           ST_Y(c.location) AS lat, ST_X(c.location) AS lon
      FROM me
      JOIN camping_spots c
        ON c.location && ST_Expand(me.location,
             $2 / (111320.0 * greatest(cos(radians(me.lat)), 0.05)))
       AND ST_DWithin(c.location::geography, me.location::geography, $2)
     WHERE c.id <> me.id
       AND c.region IS NOT NULL
       AND c.missing_since IS NULL
       AND ${publishedCountrySql('c')}
       -- The same hidden-secondary rule «Campsites nearby» uses.
       AND ${notSecondarySql('c')}
       -- And the recorded second copy of THIS campsite, whichever side of
       -- the link it is on (a secondary is hidden above only when its
       -- primary is publishable).
       AND NOT EXISTS (
             SELECT 1 FROM spot_links l
              WHERE l.unlinked_at IS NULL
                AND ((l.primary_id = me.id AND l.secondary_id = c.id)
                  OR (l.secondary_id = me.id AND l.primary_id = c.id)))
  )
  SELECT * FROM found
   ORDER BY ${PLAN_B_CRITERIA.map((c) => c.order).join(', ')}, slug
   LIMIT $3`;

interface Row {
  slug: string;
  name: string | null;
  country: string;
  region: string | null;
  type: string;
  metres: number;
  elevation: number | null;
  here_elevation: number | null;
  here_name: string | null;
  here_lat: number;
  here_lon: number;
  lat: number;
  lon: number;
}

/**
 * Is this row a second copy of the campsite being viewed?
 *
 * 🔴 The rule is `decide` from datatourisme/match.ts — the one that
 * merges records across sources (same core name, within 150 m; identical
 * name within 300 m). Anything it does not call `new` is dropped: an
 * "alternative" that might be the same place is worse than none, and
 * dropping a doubtful one costs one candidate out of up to thirty.
 */
export function isSecondCopy(row: Row): boolean {
  const verdict = decide(
    { name: row.here_name ?? '', lat: row.here_lat, lon: row.here_lon },
    [{ id: row.slug, name: row.name, lat: row.lat, lon: row.lon }],
  );
  return verdict.verdict !== 'new';
}

export async function planB(
  db: Queryable,
  slug: string,
  limit = PLAN_B_LIMIT,
): Promise<PlanBView | null> {
  const rows = (await db.query(PLAN_B_SQL, [
    slug,
    PLAN_B_RADIUS_M,
    OVERFETCH,
  ])) as Row[];
  const items: PlanBItem[] = [];
  for (const r of rows) {
    if (isSecondCopy(r)) continue;
    const path = canonicalPath(r.country, r.region, r.slug);
    if (!path) continue;
    const delta =
      r.elevation !== null && r.here_elevation !== null
        ? r.elevation - r.here_elevation
        : null;
    items.push({
      slug: r.slug,
      name: r.name,
      country: r.country,
      region: r.region,
      path,
      type: r.type,
      metres: Number(r.metres),
      elevation: r.elevation === null ? null : Number(r.elevation),
      elevationDelta: delta,
    });
    if (items.length === limit) break;
  }
  // Nothing to name is not drawn: no empty promise on the page.
  if (items.length === 0) return null;
  return { ranking: PLAN_B_RANKING, radiusM: PLAN_B_RADIUS_M, items };
}
