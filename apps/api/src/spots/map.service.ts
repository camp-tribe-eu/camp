import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CampingSpotAmenities } from '../osm/tag-mapping';
import { canonicalPath, readAmenities } from './spots.service';
import { slugifyRegion } from './canonical';
import { filterSql, NO_FILTERS, type MapFilters } from './filters';
import { gridFor, POINT_LIMIT, type Bbox } from './viewport';

export * from './viewport';
export * from './filters';

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
   *
   * 🔴 Null when the campsite has no page. A campsite with no region
   * gets no URL (CAMP-34 builds the URL from the region), and this used
   * to hand out `/camping/cy//arazi` — 135 markers on the map, every one
   * of them linking to a 404. The pin stays, because the location is
   * real; the link goes, because it was never a link.
   */
  path: string | null;
}

export interface MarkerResult {
  markers: SpotMarker[];
  /** True when the cap cut the answer short — the client must not draw it. */
  truncated: boolean;
  /**
   * CAMP-35. How many campsites in this viewport were left out *only*
   * because nobody has recorded the amenity being filtered on — not
   * because they lack it.
   *
   * 🔴 This number is the card's honesty requirement made operational.
   * Measured on our data, filtering for a shower returns 315 sites and
   * this says 874: without it the map would quietly claim three quarters
   * of Croatia has no shower, which is not something we know.
   *
   * Zero when no amenity is filtered, because then nothing is hidden.
   */
  unknownExcluded: number;
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

/**
 * CAMP-127: one region of the map, and the index that lists them.
 *
 * 🔴 Why the map stopped being one file.
 *
 * The whole-world snapshot carried a hard cap of 20 000 markers and
 * refused — correctly — to serve a truncated one. On 24.09.2026 the EU-27
 * import took the database from 9 830 campsites to 61 521, the cap fired,
 * and the map went from working to a 500. Raising the cap was never the
 * answer: 9 830 markers weighed 2.4 MB, so 61 521 is roughly 15 MB for a
 * phone to fetch, parse and cluster before it draws anything.
 *
 * So the map is cut into regions. Measured on the same data: 800 regions
 * hold campsites, the largest (Bayern) has 1 433 and the median has 26 —
 * which makes every chunk small and bounded, and lets the map fetch only
 * what the reader is looking at.
 */
/**
 * The chunk slug for a region, including the one that has no region.
 *
 * 🔴 `_unplaced` cannot collide with a real region, and that is a
 * property rather than a hope: slugifyRegion strips everything that is
 * not a letter or a digit, so no region name can ever produce a leading
 * underscore. It is a map-data address, not a page URL — those campsites
 * have no page, which is exactly why they are here.
 */
export const UNPLACED = '_unplaced';

export function regionChunkSlug(region: string | null): string {
  const slug = slugifyRegion(region);
  return slug === '' ? UNPLACED : slug;
}

export interface RegionSummary {
  country: string;
  region: string | null;
  /** The URL segment, from the same function the pages use. */
  slug: string;
  count: number;
  /** The corner points of everything in it, for deciding what is in view. */
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  /** Where to draw the one circle that stands for the whole region. */
  lon: number;
  lat: number;
}

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
  /**
   * Every region that holds a campsite, with its extent and its count.
   *
   * 🔴 One query, no filters, and deliberately so. This is the map's
   * table of contents: it decides which chunks exist and where they are,
   * and a filtered index would make the map forget that a region exists
   * the moment somebody ticks "showers". Filtering happens over the
   * markers, in the browser, exactly as it does today.
   *
   * A region with no campsites is absent rather than present with zero —
   * there is no chunk to fetch for it, and listing it would invite one.
   */
  async regions(): Promise<RegionSummary[]> {
    const rows = await this.db.query(
      `SELECT country,
              region,
              n AS count,
              ST_XMin(extent)  AS "minLon",
              ST_YMin(extent)  AS "minLat",
              ST_XMax(extent)  AS "maxLon",
              ST_YMax(extent)  AS "maxLat",
              ST_X(centre)     AS lon,
              ST_Y(centre)     AS lat
         FROM (
           SELECT country,
                  region,
                  ST_Extent(location::geometry) AS extent,
                  -- 🔴 The centroid of the POINTS, not of the region's
                  -- shape. A region whose campsites are all on one coast
                  -- would otherwise put its circle inland, in a place
                  -- where zooming in finds nothing.
                  ST_Centroid(ST_Collect(location::geometry)) AS centre,
                  count(*)::int AS n
             FROM camping_spots
            WHERE missing_since IS NULL
            -- 🔴 Region-less campsites are grouped too, not filtered out.
            --
            -- Measured 24.09.2026: 135 campsites carry no region, 36 of
            -- them on Cyprus where the boundary file gives no ISO code
            -- (CAMP-125). Chunking the map by region would have made
            -- every one of them vanish from it — a silent loss of real
            -- locations, which is the failure this whole card exists to
            -- prevent. They get a chunk of their own per country.
            GROUP BY country, region
         ) g
        -- 🔴 No second GROUP BY. The subquery has already grouped, and
        -- repeating it outside made Postgres try to group BY the extent
        -- itself: "could not identify an equality operator for type
        -- box2d". box2d has no equality operator, and it should not need
        -- one — nothing here is being grouped twice.
        ORDER BY country, region`,
    );
    return rows.map((r: Record<string, unknown>) => ({
      country: String(r.country),
      region: (r.region as string) ?? null,
      slug: regionChunkSlug(r.region as string | null),
      count: Number(r.count),
      minLon: Number(r.minLon),
      minLat: Number(r.minLat),
      maxLon: Number(r.maxLon),
      maxLat: Number(r.maxLat),
      lon: Number(r.lon),
      lat: Number(r.lat),
    }));
  }

  /**
   * Every campsite in one region, whatever the number.
   *
   * 🔴 No cap, and that is safe here in a way it is not for a bbox: a
   * region is a bounded set we measured (the largest is 1 433), while a
   * bbox is whatever the caller asks for. A cap here would reintroduce
   * the exact failure this card exists to fix — a chunk that is quietly
   * missing campsites, with the map looking perfectly healthy.
   *
   * Matched on the region NAME, not on a bounding box. Neighbouring
   * regions overlap at their corners, so bbox chunks would draw some
   * campsites twice and make every count wrong.
   */
  async regionMarkers(
    country: string,
    regionSlug: string,
  ): Promise<SpotMarker[]> {
    const rows = await this.db.query(
      `SELECT slug, name, country, region, type, amenities,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lon
         FROM camping_spots
        WHERE missing_since IS NULL
          AND lower(country) = lower($1)
        ORDER BY slug`,
      [country],
    );
    // 🔴 The slug comparison happens here rather than in SQL because
    // slugifyRegion is the one definition of that rule (CAMP-87: a
    // published URL does not move), and re-implementing it in Postgres
    // would be a second copy free to drift from the first.
    return rows
      .filter(
        (r: Record<string, unknown>) =>
          regionChunkSlug((r.region as string) ?? null) === regionSlug,
      )
      .map(toMarker);
  }

  async points(
    bbox: Bbox,
    filters: MapFilters = NO_FILTERS,
    limit = POINT_LIMIT,
  ): Promise<MarkerResult> {
    const box = [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat];
    const f = filterSql(filters, box.length);

    const rows = await this.db.query(
      `SELECT slug, name, country, region, type, amenities,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lon
         FROM camping_spots
        WHERE missing_since IS NULL
          AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)${f.where}
        -- 🔴 Deterministic, because the cap below may cut the list and
        -- an unordered LIMIT would return a different subset each run.
        -- Same lesson as the dedup in CAMP-39.
        ORDER BY slug
        LIMIT $${box.length + f.params.length + 1}`,
      [...box, ...f.params, limit + 1],
    );

    const truncated = rows.length > limit;
    return {
      markers: (truncated ? rows.slice(0, limit) : rows).map(toMarker),
      truncated,
      unknownExcluded: await this.countUnknownExcluded(box, f),
    };
  }

  /**
   * How many rows the strict filter dropped for want of data.
   *
   * 🔴 A second query rather than a window function over the first. The
   * first one carries a LIMIT, and a count taken alongside a truncated
   * list would count the truncation too — reporting "40 more where it is
   * unknown" when the real number is four hundred. Counting is the one
   * thing that must see the whole viewport.
   *
   * Both counts ride in one statement so the viewport is scanned once for
   * the pair, and it is skipped entirely when no amenity is filtered.
   */
  private async countUnknownExcluded(
    box: unknown[],
    f: ReturnType<typeof filterSql>,
  ): Promise<number> {
    if (!f.lenientWhere) return 0;

    const base = `FROM camping_spots
        WHERE missing_since IS NULL
          AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)`;

    const [row] = await this.db.query(
      `SELECT (SELECT COUNT(*)::int ${base}${f.where}) AS strict,
              (SELECT COUNT(*)::int ${base}${f.lenientWhere}) AS lenient`,
      [...box, ...f.params, ...f.lenientParams],
    );

    // Never negative: `lenient` is a superset of `strict` by construction,
    // but a clamp costs nothing and a negative count on screen would be
    // the kind of nonsense that destroys trust in the whole number.
    return Math.max(0, Number(row.lenient) - Number(row.strict));
  }

  /**
   * Counts per grid cell over the same viewport.
   *
   * The grid is in degrees, so a cell is physically narrower in Norway
   * than in Sicily. That is a real distortion and it is accepted: the
   * output is a count bubble, not a measurement, and correcting it would
   * mean reprojecting every row on every request.
   */
  async clusters(
    bbox: Bbox,
    filters: MapFilters = NO_FILTERS,
  ): Promise<Cluster[]> {
    const grid = gridFor(bbox);
    const box = [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat];
    // 🔴 The same fragment the point query uses, from the same builder.
    // Two hand-written copies of "what the filter means" is how a map
    // ends up showing a cluster of twelve that opens to three markers.
    const f = filterSql(filters, box.length);

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
          AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)${f.where}
        GROUP BY ST_SnapToGrid(location::geometry, $${box.length + f.params.length + 1}, $${box.length + f.params.length + 1})
        ORDER BY count DESC, lon, lat`,
      [...box, ...f.params, grid],
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
    // Read through the same normaliser as the page, so the two can
    // never disagree about which amenities exist.
    amenities: readAmenities(row.amenities),
    path: canonicalPath(
      row.country as string,
      (row.region as string) ?? null,
      row.slug as string,
    ),
  };
}
