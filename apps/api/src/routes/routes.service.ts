import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { canonicalPath, readAmenities } from '../spots/canonical';
import type { CampingSpotAmenities } from '../osm/tag-mapping';
import type { SpotSource } from '../entities/camping-spot.entity';
// 🔴 The caps and the coordinate parsing live in a file with no Nest
// imports, so Jest can actually reach them. See route-points.ts.
import { notSecondarySql } from '../spots/links';
import {
  clamp,
  DEFAULT_PER_POINT,
  DEFAULT_RADIUS_M,
  type LatLon,
  MAX_PER_POINT,
  MAX_POINTS,
  MAX_RADIUS_M,
  MAX_TOTAL,
  MIN_RADIUS_M,
  OVERFETCH,
} from './route-points';
// CAMP-113: what a driver needs BETWEEN the campsites.
import {
  buildServicesSql,
  MAX_SERVICE_POINTS,
  MAX_SERVICES_TOTAL,
  servicesOverfetch,
  type RouteFuelStationPrice,
  type RouteService,
  type RouteServiceAnswer,
  type RouteServiceGroup,
} from './route-services';
import { SERVICES_PER_KIND, type RoutePoiKind } from '../osm/route-poi';

export * from './route-points';
export * from './route-services';

// CAMP-3 / CAMP-45: the campsites near a curated route's stages.
//
// 🔴 What this module is NOT.
//
// It is not "every campsite in the region". That distinction is the
// whole legal position of a route page. A route page is a Produced Work
// under ODbL §4.5(a) — we attribute OpenStreetMap, share-alike does not
// reach our prose, and the page stays ours. That holds because the page
// selects a small handful of objects by our own editorial criteria. A
// systematic dump of every campsite in a region is a Substantial extract
// of the database itself, which is a different act with a different
// licence consequence, and no amount of wrapping it in prose changes
// that.
//
// So the cap is enforced HERE, in the only place that can see the whole
// request, rather than trusted to each caller. See MAX_PER_POINT and
// MAX_TOTAL below.

/** One campsite, as a route stage needs it. */
export interface RouteNeighbour {
  slug: string;
  name: string | null;
  country: string;
  region: string | null;
  /**
   * 🔴 The campsite's canonical URL, built HERE by `canonicalPath`.
   *
   * Not rebuilt in the web layer, and that is not tidiness. The rule
   * strips accents — "Šibensko-Kninska" becomes "sibensko-kninska",
   * "Pyrénées-Atlantiques" becomes "pyrenees-atlantiques" — and a
   * second implementation that merely lower-cases and replaces spaces
   * produces a link that 404s on every accented region, which is most
   * of Croatia, Latvia, Estonia and a good deal of France. CAMP-87 is
   * explicit that a published URL does not move, so there is one
   * function that decides them.
   */
  path: string | null;
  type: string;
  lat: number;
  lon: number;
  /**
   * 🔴 Straight-line metres from the stage centre, on the spheroid.
   *
   * Named `metres` and never `distance`, and the web layer labels it
   * "in a straight line" on every surface it appears. There is no road
   * distance anywhere in this codebase yet (CAMP-42/CAMP-99) and a field
   * called `distance` is how one gets invented.
   */
  metres: number;
  amenities: CampingSpotAmenities;
  /**
   * 🔴 Which source gave this record, and when it last changed it.
   *
   * Carried to the route page because that is where the attribution has
   * to appear. 8 752 French campsites come from DATAtourisme under
   * Licence Ouverte 2.0 (measured), which requires the attribution to
   * name the source AND the date the reused information was last
   * updated — so a route page naming a French campsite cannot discharge
   * that with a footer line, any more than a campsite page can
   * (CAMP-101). The rest come from OpenStreetMap under ODbL, where the
   * date means "when we last looked", not "when a mapper last edited".
   */
  sources: SpotSource[];
}

export interface RouteNeighbourGroup {
  lat: number;
  lon: number;
  spots: RouteNeighbour[];
}

export interface RouteNeighbourAnswer {
  groups: RouteNeighbourGroup[];
  /** What the caller asked for after clamping — so a page can say so. */
  perPoint: number;
  radiusMetres: number;
  /** Total campsites returned across every group. */
  returned: number;
}

@Injectable()
export class RoutesService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /**
   * Campsites near each of a route's stages.
   *
   * One query per stage, each an index walk with a small LIMIT — the
   * shape `spots.nearby()` uses, which is the measured-fast one. The
   * alternative (one query with ST_DWithin over a geography cast) cannot
   * use the geometry GiST index and falls back to a sequential scan of
   * 61 422 rows; measured while writing this card, that form took over
   * two minutes for 67 points where this one takes milliseconds.
   */
  async near(
    points: LatLon[],
    perPointRequested = DEFAULT_PER_POINT,
    radiusRequested = DEFAULT_RADIUS_M,
  ): Promise<RouteNeighbourAnswer> {
    const pts = points.slice(0, MAX_POINTS);
    const perPoint = clamp(
      Math.trunc(perPointRequested) || DEFAULT_PER_POINT,
      1,
      MAX_PER_POINT,
    );
    const radiusMetres = clamp(
      Math.trunc(radiusRequested) || DEFAULT_RADIUS_M,
      MIN_RADIUS_M,
      MAX_RADIUS_M,
    );

    const groups: RouteNeighbourGroup[] = [];
    let returned = 0;

    for (const p of pts) {
      // 🔴 The total cap is checked before each stage, not after the
      // loop. Truncating a finished list would still have built it.
      if (returned >= MAX_TOTAL) {
        groups.push({ lat: p.lat, lon: p.lon, spots: [] });
        continue;
      }
      const room = Math.min(perPoint, MAX_TOTAL - returned);

      const rows = await this.db.query(
        `WITH here AS (
           SELECT ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326) AS g
         )
         SELECT * FROM (
           SELECT lower(s.country) AS country, s.slug, s.name, s.region, s.type,
                  ST_Y(s.location::geometry) AS lat,
                  ST_X(s.location::geometry) AS lon,
                  s.amenities, s.sources,
                  ST_Distance(s.location::geography,
                              (SELECT g FROM here)::geography) AS metres
             FROM camping_spots s
            WHERE s.missing_since IS NULL
              AND s.region IS NOT NULL
              -- 🔴 CAMP-144, and this is the dearest place a duplicate
              -- lands. A stop offers four campsites; when two of them
              -- are one campsite under two spellings the reader gets
              -- half the choice the page promises. It is the symptom
              -- that opened the card.
              AND ${notSecondarySql('s')}
            -- The index walk. Planar order, deliberately over-fetched;
            -- the true ordering is imposed by the outer query.
            ORDER BY s.location <-> (SELECT g FROM here)
            LIMIT $3
         ) c
          WHERE c.metres <= $4
          ORDER BY c.metres
          LIMIT $5`,
        [p.lon, p.lat, room * OVERFETCH, radiusMetres, room],
      );

      const spots: RouteNeighbour[] = rows.map(
        (r: Record<string, unknown>) => ({
          slug: r.slug as string,
          name: (r.name as string | null) ?? null,
          country: r.country as string,
          region: (r.region as string | null) ?? null,
          path: canonicalPath(
            r.country as string,
            (r.region as string | null) ?? null,
            r.slug as string,
          ),
          type: r.type as string,
          lat: Number(r.lat),
          lon: Number(r.lon),
          metres: Math.round(Number(r.metres)),
          amenities: readAmenities(r.amenities),
          // An absent column is an empty list, never undefined: the web
          // layer iterates this, and CAMP-101 has already had one release
          // where a missing `sources` took every page down with "a is not
          // iterable".
          sources: Array.isArray(r.sources) ? (r.sources as SpotSource[]) : [],
        }),
      );

      returned += spots.length;
      groups.push({ lat: p.lat, lon: p.lon, spots });
    }

    return { groups, perPoint, radiusMetres, returned };
  }

  /**
   * CAMP-113: the nearest fuel, charger, tap, dump point, shop, meal and
   * roof to each stage — what a driver needs between the campsites.
   *
   * 🔴 Scoped to OpenStreetMap alone, and that is a narrowing of the
   * card rather than the whole of it. The card depends on CAMP-111
   * (which sources, which licences), which is not done; OSM is already
   * imported and already licence-cleared here. Open Charge Map, the
   * national fuel portals and per-station prices wait for CAMP-111.
   *
   * 🔴 What is NOT here, and will not be until it can be: no rating, no
   * photograph. Neither exists in open data, and taking either from
   * Google is forbidden by its terms. Reviews arrive with CAMP-53,
   * photographs with CAMP-52, and from nobody else's site.
   *
   * One query per stage, each a UNION ALL of per-kind index scans — see
   * buildServicesSql for why the kind is a literal and what it cost to
   * find out.
   */
  async services(
    points: LatLon[],
    kinds: RoutePoiKind[],
    radiusRequested = DEFAULT_RADIUS_M,
  ): Promise<RouteServiceAnswer> {
    // 🔴 MAX_SERVICE_POINTS, not MAX_POINTS. A route page takes 4
    // campsites AND 7 services per stage, so nine stages is where the
    // ODbL floor of 100 objects actually lands — see route-services.ts.
    // Asking about more is refused with `truncated`, so the web layer
    // says "we could not look" rather than the page printing an absence
    // about stops nothing examined.
    const pts = points.slice(0, MAX_SERVICE_POINTS);
    const truncatedPoints = points.length > MAX_SERVICE_POINTS;
    const radiusMetres = clamp(
      Math.trunc(radiusRequested) || DEFAULT_RADIUS_M,
      MIN_RADIUS_M,
      MAX_RADIUS_M,
    );

    const sql = buildServicesSql(kinds);
    const groups: RouteServiceGroup[] = [];
    let returned = 0;
    let truncated = truncatedPoints;

    for (const p of pts) {
      // 🔴 Unreachable by construction now — MAX_SERVICES_TOTAL is the
      // arithmetic ceiling of an accepted request — and it SAYS SO when
      // it happens rather than returning a short answer that reads like
      // an absence. Review found the old cap (56) dropping whole kinds
      // past stage 8, and the page printing "our database holds none"
      // about stops nothing had looked at.
      if (returned >= MAX_SERVICES_TOTAL) {
        truncated = true;
        groups.push({ lat: p.lat, lon: p.lon, services: [] });
        continue;
      }

      const rows = await this.db.query(sql, [
        p.lon,
        p.lat,
        servicesOverfetch(SERVICES_PER_KIND),
        radiusMetres,
      ]);

      // 🔴 A partial stage is reported, not silently shortened. Slicing
      // a stage's list mid-way is how six kinds became "our database
      // holds none" on a page that had only asked about one.
      const room = MAX_SERVICES_TOTAL - returned;
      if (rows.length > room) truncated = true;

      const services: RouteService[] = rows
        .slice(0, room)
        .map((r: Record<string, unknown>) => ({
          kind: r.kind as RoutePoiKind,
          osmRef: r.osm_ref as string,
          name: (r.name as string | null) ?? null,
          lat: Number(r.lat),
          lon: Number(r.lon),
          metres: Math.round(Number(r.metres)),
          // 🔴 `?? null`, never `?? ''`. An empty string renders as a
          // blank cell that reads "none"; null is what the page turns
          // into the word "unknown", which is the card's acceptance
          // criterion and the difference between the two facts.
          phone: (r.phone as string | null) ?? null,
          website: (r.website as string | null) ?? null,
          openingHours: (r.opening_hours as string | null) ?? null,
          // CAMP-154. `json_agg` over no rows is SQL NULL, not `[]`, so
          // the overwhelming majority of fuel points and every non-fuel
          // kind arrive here as null — which is the honest shape: the
          // key is simply absent, and the page then says we hold no
          // price rather than rendering an empty space beside a pump.
          ...(Array.isArray(r.prices) && r.prices.length > 0
            ? { prices: r.prices as RouteFuelStationPrice[] }
            : {}),
        }));

      returned += services.length;
      groups.push({ lat: p.lat, lon: p.lon, services });
    }

    return {
      groups,
      radiusMetres,
      perKind: SERVICES_PER_KIND,
      returned,
      truncated,
    };
  }
}
