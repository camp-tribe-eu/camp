import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { canonicalPath, readAmenities } from '../spots/canonical';
import type { CampingSpotAmenities } from '../osm/tag-mapping';
import type { SpotSource } from '../entities/camping-spot.entity';
// 🔴 The caps and the coordinate parsing live in a file with no Nest
// imports, so Jest can actually reach them. See route-points.ts.
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

export * from './route-points';

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
}
