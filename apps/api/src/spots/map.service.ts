import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CampingSpotAmenities } from '../osm/tag-mapping';
import { canonicalPath } from './spots.service';
import { gridFor, POINT_LIMIT, type Bbox } from './viewport';

export * from './viewport';

/** One campsite as a marker needs it — no geometry beyond the point. */
export interface SpotMarker {
  slug: string;
  name: string | null;
  country: string;
  region: string | null;
  type: string;
  lat: number;
  lon: number;
  amenities: CampingSpotAmenities;
  /**
   * 🔴 Built here, by the same function the pages use. The web app had
   * started re-deriving the region slug from the region name to make
   * this link, which is a second copy of a rule that already exists —
   * and the failure mode is a marker that looks right and links to a
   * 404.
   */
  path: string;
}

export interface MarkerResult {
  markers: SpotMarker[];
  /** True when the cap cut the answer short — the client must not draw it. */
  truncated: boolean;
}

export interface Cluster {
  lat: number;
  lon: number;
  count: number;
  /**
   * Present only when the cell holds exactly one campsite, so a lone
   * point at low zoom still links straight to its page instead of
   * pretending to be a cluster of one.
   */
  slug?: string;
  name?: string | null;
  country?: string;
  region?: string | null;
}

// CAMP-32: what the map asks the database for.
//
// 🔴 Two queries, not one, and the reason is the query plan rather than
// the visual design.
//
// Under a city-sized window the bbox filter selects a fraction of a
// percent of the table, Postgres uses the GiST index, and returning the
// rows is the right answer. Under a window covering Europe it selects
// everything: no index can help, and the honest response is not 55 000
// rows the browser cannot draw anyway — it is a count per grid cell,
// which Postgres computes in one pass without sending the rows at all.
//
// So "cluster at low zoom" is not only about the map looking like mush.
// It is the only shape of question that stays cheap when the answer is
// the whole table. scripts/explain-map-queries.ts measures both.

@Injectable()
export class MapQueryService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /**
   * Campsites whose point falls inside the viewport.
   *
   * 🔴 `&&` rather than ST_Intersects. For points against a rectangle the
   * two give the same answer, but `&&` is the bounding-box operator the
   * GiST index implements directly — it is the operator the index exists
   * for. ST_Intersects adds an exact-geometry recheck that means nothing
   * for a point and hides what the plan is really doing.
   */
  async points(bbox: Bbox, limit = POINT_LIMIT): Promise<MarkerResult> {
    const rows = await this.db.query(
      `SELECT slug, name, country, region, type, amenities,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lon
         FROM camping_spots
        WHERE missing_since IS NULL
          AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)
        -- 🔴 Deterministic, because the cap below may cut the list and
        -- an unordered LIMIT would return a different subset each run.
        -- Same lesson as the dedup in CAMP-39.
        ORDER BY slug
        LIMIT $5`,
      [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat, limit + 1],
    );

    const truncated = rows.length > limit;
    return {
      markers: (truncated ? rows.slice(0, limit) : rows).map(toMarker),
      truncated,
    };
  }

  /**
   * Counts per grid cell over the same viewport.
   *
   * The grid is in degrees, so a cell is physically narrower in Norway
   * than in Sicily. That is a real distortion and it is accepted: the
   * output is a count bubble, not a measurement, and correcting it would
   * mean reprojecting every row on every request.
   */
  async clusters(bbox: Bbox): Promise<Cluster[]> {
    const grid = gridFor(bbox);

    const rows = await this.db.query(
      `SELECT COUNT(*)::int AS count,
              AVG(ST_X(location::geometry)) AS lon,
              AVG(ST_Y(location::geometry)) AS lat,
              -- Only meaningful for a cell of one, and only read then.
              MIN(slug) AS slug,
              MIN(name) AS name,
              MIN(country) AS country,
              MIN(region) AS region
         FROM camping_spots
        WHERE missing_since IS NULL
          AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)
        GROUP BY ST_SnapToGrid(location::geometry, $5, $5)
        ORDER BY count DESC, lon, lat`,
      [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat, grid],
    );

    return rows.map((r: Record<string, unknown>) => {
      const count = Number(r.count);
      const cluster: Cluster = {
        count,
        lat: Number(r.lat),
        lon: Number(r.lon),
      };
      if (count === 1) {
        cluster.slug = r.slug as string;
        cluster.name = (r.name as string) ?? null;
        cluster.country = r.country as string;
        cluster.region = (r.region as string) ?? null;
      }
      return cluster;
    });
  }
}

function toMarker(row: Record<string, unknown>): SpotMarker {
  return {
    slug: row.slug as string,
    name: (row.name as string) ?? null,
    country: row.country as string,
    region: (row.region as string) ?? null,
    type: row.type as string,
    lat: Number(row.lat),
    lon: Number(row.lon),
    amenities: row.amenities as CampingSpotAmenities,
    path: canonicalPath(
      row.country as string,
      (row.region as string) ?? null,
      row.slug as string,
    ),
  };
}
