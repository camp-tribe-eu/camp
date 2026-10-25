import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EU_MEMBER_STATES_AND_SUBDIVISIONS, isEuMemberState } from '../osm/eu';
import { countrySql } from '../osm/route-poi-sql';
import { buildCorridor } from '../planner/corridor-source';
import type { LonLat } from '../planner/hard-constraints';
import { planItinerary } from '../planner/itinerary';
import { inReadOnlyTransaction, Queryable } from '../planner/read-only';
import { loadMeasuredScoring } from '../planner/scoring';
import { canonicalPath } from '../spots/canonical';
import { mergeAllLinked } from '../spots/links';
import { BUFFER_M, bandFor, samePlace } from './plan-policy';
import { outsideUnion, PlanProblem, PlanRequest } from './plan-request';
import { Place, PlanResponse, toPlanResponse } from './plan-response';

// CAMP-391: `POST /plan` — the one place the HTTP entry meets the database.
//
// 🔴 ONE READ ONLY, REPEATABLE READ TRANSACTION PER REQUEST, and it is a
// property of the server, not a promise in a comment. `inReadOnlyTransaction`
// (planner/read-only.ts) was written so the measuring scripts could not write
// to a database an import is writing to; here it is what makes "this entry
// stores nothing" TRUE — a coordinate pair that arrives in a request has no
// statement that could put it in a table, because Postgres refuses every
// write in the transaction. docs/GDPR-REGISTER.md says that sentence; a spec
// (plan.db.spec.ts) shows the first statement the connection sees and that an
// INSERT through it is refused. It also gives the whole request ONE snapshot:
// the country check, the corridor read, the contexts and the names are the
// same table, so a campsite cannot be a night and then have no row to name it.
//
// 🔴 A STATEMENT TIMEOUT, and the number is argued below at the constant.
//
// 🔴 THE DATABASE IS REACHED ON ITS OWN CONNECTION, not through a repository:
// the planner takes a `Queryable` (a `pg` client in its specs and measuring
// scripts), and a TypeORM query runner is one with a different result shape —
// the adapter is the four lines in `plan()`.

/**
 * How long one statement of a plan may run before Postgres cancels it.
 *
 * The slowest statement in a measured call is the corridor read, and the
 * whole call — that read, the programme and the rest — was 229 ms at the worst
 * of 80 across 14 journeys (cold, local copy, 25.10.2026), so a statement that
 * runs for ten seconds is not a slow plan, it is a stuck one: a lock, a
 * missing index, a corridor nobody foresaw. The cost of a FALSE cancel is one
 * reader seeing "the planner did not answer" and pressing the button again;
 * the cost of no limit is a pool connection held for as long as the question
 * takes, with ten of them in the pool.
 */
export const STATEMENT_TIMEOUT_MS = 10_000;

/** Postgres' code for "query_canceled", which is what a statement timeout raises. */
const QUERY_CANCELED = '57014';

/** The plan could not be made in the time allowed. The controller answers 503. */
export class PlanTimedOut extends Error {
  constructor() {
    super('plan: a statement exceeded the timeout');
    this.name = 'PlanTimedOut';
  }
}

export type PlanResult =
  { ok: true; response: PlanResponse } | { ok: false; problems: PlanProblem[] };

const lonLat = (p: { lat: number; lon: number }): LonLat => [p.lon, p.lat];

/**
 * 🔴 Placeholder band for the one request that never reads one: A and B at the
 * same spot. There is no corridor, so no length to take a share of, and the
 * algorithm answers `unsupported: round-trip` before it looks at the band
 * (itinerary.ts). A positive pair, because it validates the band first.
 */
const NO_CORRIDOR_BAND = { minM: 1, maxM: 1 } as const;

@Injectable()
export class PlanService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async plan(req: PlanRequest): Promise<PlanResult> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    const db: Queryable = {
      query: async (sql, params) => ({
        rows: (await runner.query(sql, params)) as Record<string, unknown>[],
      }),
    };
    try {
      return await inReadOnlyTransaction(db, async () => {
        await db.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
        return await this.within(db, req);
      });
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code === QUERY_CANCELED) {
        throw new PlanTimedOut();
      }
      throw err;
    } finally {
      await runner.release();
    }
  }

  private async within(db: Queryable, req: PlanRequest): Promise<PlanResult> {
    const problems = await outsideTheUnion(db, req);
    if (problems.length > 0) return { ok: false, problems };

    const from = lonLat(req.from);
    const to = lonLat(req.to);

    // The corridor is built here only to take a share of its length. The
    // algorithm builds its own from the same provider: it is a pure function
    // of two points, and the day a router makes it expensive is the day this
    // line gets a cache (corridor-source.ts says so).
    //
    // 🔴 Two points that are one place (policy: closer than a metre, not just
    // digit-for-digit equal) are handed over as the SAME point, so the
    // algorithm's own refusal answers and the corridor is never asked to draw
    // an arc that does not exist (it throws, and that was a 500).
    const roundTrip = samePlace(from, to);
    const target = roundTrip ? from : to;
    const band = roundTrip
      ? NO_CORRIDOR_BAND
      : bandFor((await buildCorridor({ from, to })).metres, req.days);

    // One load, used twice: the weights the plan is made with ARE the weights
    // the answer says it was ranked by.
    const scoring = loadMeasuredScoring();
    const outcome = await planItinerary(
      db,
      { from, to: target, days: req.days, band, bufferM: BUFFER_M },
      { scoring },
    );

    const slugs =
      outcome.status === 'ok'
        ? outcome.days.flatMap((d) => (d.night ? [d.night.slug] : []))
        : [];
    return {
      ok: true,
      response: toPlanResponse(
        outcome,
        await placesOf(db, slugs),
        scoring.components.map((c) => ({ id: c.id, weight: c.weight })),
      ),
    };
  }
}

/**
 * Which of the two points is outside the Union.
 *
 * 🔴 THE PROJECT'S OWN "WHICH COUNTRY IS THIS POINT IN" (`countrySql`,
 * osm/route-poi-sql.ts), not a second one: containment in a Natural Earth
 * admin-1 polygon, else the nearest polygon, never null, and a tie goes to the
 * non-member. It was written for the route-POI import, where a marina 7 m off
 * a generalised coastline must not be called foreign and a kiosk in Girne must
 * not be called Cypriot. A harbour is also where a trip starts.
 *
 * 🔴 The member list is `EU_MEMBER_STATES_AND_SUBDIVISIONS` and the test is
 * `isEuMemberState`, so `ax` (Åland) is Finland and `-1` (the Sovereign Base
 * Areas) is not a member — written down in osm/eu.ts, not re-derived.
 */
async function outsideTheUnion(
  db: Queryable,
  req: PlanRequest,
): Promise<PlanProblem[]> {
  const point = (lon: string, lat: string) =>
    `ST_SetSRID(ST_MakePoint(${lon}::float8, ${lat}::float8), 4326)`;
  const res = await db.query(
    `SELECT ${countrySql(point('$1', '$2'), '$5')} AS a,
            ${countrySql(point('$3', '$4'), '$5')} AS b`,
    [
      req.from.lon,
      req.from.lat,
      req.to.lon,
      req.to.lat,
      [...EU_MEMBER_STATES_AND_SUBDIVISIONS],
    ],
  );
  const row = res.rows[0] ?? {};
  const out: PlanProblem[] = [];
  if (!isEuMemberState(row.a as string | null)) out.push(outsideUnion('from'));
  if (!isEuMemberState(row.b as string | null)) out.push(outsideUnion('to'));
  return out;
}

/**
 * Name, page and sources of each campsite the plan chose, from the same
 * snapshot — read THROUGH ITS LINKS, the way the campsite's own page reads it.
 *
 * 🔴 A CAMPSITE IS OFTEN TWO ROWS. The OSM row is the primary and the French
 * tourist office's DATAtourisme row is its hidden secondary
 * (`notSecondarySql` keeps the secondary out of the candidates), and the
 * official star classification lives on the SECONDARY: of the linked pairs
 * here, 2 628 have a primary with no stars and a secondary with some, and the
 * night `blue-bayou` shows 5 stars that its own row does not hold. The ranking
 * already reads stars through the link (`mergedStarsSql`), so the answer says
 * 5 stars — and the licence on those stars (Licence Ouverte 2.0) asks for the
 * source AND the date of the record they came from. A `sources` read off the
 * primary alone lists OpenStreetMap and nothing else: the same fact printed
 * with the attribution missing, which is the quiet under-claim
 * `links.ts` spends four paragraphs on.
 *
 * So the read uses the project's own merge (`mergeAllLinked`) and not a second
 * one: the same order of secondaries, the same "a gap is filled, a value is
 * not overwritten", the same narrowing of a secondary's credit to what was
 * reused. It is handed ONLY the two fields the plan shows from a secondary —
 * the name and the stars — so it can only credit those: a secondary's
 * description, website or prices are not on this page, and crediting its
 * source for them would be the over-claim `links.ts` also names.
 *
 * `owner_overrides.name` wins, as on the page (CAMP-86).
 */
async function placesOf(
  db: Queryable,
  slugs: readonly string[],
): Promise<Map<string, Place>> {
  const places = new Map<string, Place>();
  if (slugs.length === 0) return places;
  const res = await db.query(
    `SELECT s.slug, s.name, s.country, s.region, s.stars, s.sources,
            s.owner_overrides,
            coalesce((
              SELECT jsonb_agg(jsonb_build_object(
                       'linked_id', x.id,
                       'linked_name', x.name,
                       'linked_stars', x.stars,
                       'linked_sources', x.sources
                     ) ORDER BY l.created_at, x.id)
                FROM spot_links l
                JOIN camping_spots x ON x.id = l.secondary_id
               WHERE l.primary_id = s.id AND l.unlinked_at IS NULL
            ), '[]'::jsonb) AS linked_rows
       FROM camping_spots s
      WHERE s.slug = ANY($1::text[])`,
    [[...slugs]],
  );
  for (const r of res.rows) {
    const slug = String(r.slug);
    const merged = mergeAllLinked({
      name: r.name,
      stars: r.stars,
      sources: r.sources,
      linked_rows: r.linked_rows,
    });
    const override = (r.owner_overrides as { name?: unknown } | null)?.name;
    const name =
      typeof override === 'string' && override !== ''
        ? override
        : (merged.name as unknown);
    places.set(slug, {
      name: typeof name === 'string' && name.trim() !== '' ? name : null,
      path: canonicalPath(
        String(r.country ?? ''),
        typeof r.region === 'string' ? r.region : null,
        slug,
      ),
      sources: merged.sources,
    });
  }
  return places;
}
