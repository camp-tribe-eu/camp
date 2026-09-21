import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AmenityValue, CampingSpotAmenities } from '../osm/tag-mapping';

/** One campsite as a page needs it. Geometry is already reduced to lat/lon. */
export interface SpotView {
  slug: string;
  name: string | null;
  country: string;
  region: string | null;
  type: string;
  lat: number;
  lon: number;
  amenities: CampingSpotAmenities;
  /** Owner-corrected fields win over OSM at read time (CAMP-86). */
  ownerOverrides: Record<string, unknown>;
  lastSeenAt: Date | null;
  missingSince: Date | null;
}

/** The reduced shape a listing needs — no geometry, no owner data. */
export interface SpotCard {
  slug: string;
  name: string | null;
  country: string;
  region: string | null;
  type: string;
  amenities: CampingSpotAmenities;
}

export interface NearbySpot {
  slug: string;
  name: string | null;
  country: string;
  region: string | null;
  type: string;
  /** Straight-line metres. Honest: this is not a driving distance. */
  metres: number;
}

@Injectable()
export class SpotsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /**
   * A slug is unique across the whole table, so country and region are not
   * needed to find the row - but they are still checked. A page reachable
   * at more than one URL is duplicate content, and the wrong pair must 404
   * here rather than silently render (CAMP-87).
   */
  async findBySlug(
    country: string,
    region: string,
    slug: string,
  ): Promise<SpotView> {
    const rows = await this.db.query(
      `SELECT slug, name, country, region, type,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lon,
              amenities, owner_overrides, last_seen_at, missing_since
         FROM camping_spots
        WHERE slug = $1
        LIMIT 1`,
      [slug],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException(`No campsite with slug "${slug}"`);

    if (
      row.country.toLowerCase() !== country.toLowerCase() ||
      slugifyRegion(row.region) !== region.toLowerCase()
    ) {
      // The row exists but not at this address. The web layer turns this
      // into a 301 to the canonical URL, which is why it is a distinct
      // condition rather than a plain 404.
      throw new NotFoundException({
        message: 'Campsite exists at a different URL',
        canonical: canonicalPath(row.country, row.region, row.slug),
      });
    }

    return toView(row);
  }

  /**
   * Nearest neighbours by straight-line distance.
   *
   * `<->` on geography is a KNN operator: with the GiST index it walks the
   * tree instead of measuring every row, so this stays fast as the table
   * grows from 448 to tens of thousands.
   */
  async nearby(slug: string, limit = 6): Promise<NearbySpot[]> {
    return this.db.query(
      `WITH me AS (SELECT location FROM camping_spots WHERE slug = $1)
       SELECT s.slug, s.name, s.country, s.region, s.type,
              round(ST_Distance(s.location::geography,
                                (SELECT location FROM me)::geography)) AS metres
         FROM camping_spots s
        WHERE s.slug <> $1
          AND s.region IS NOT NULL
          AND s.missing_since IS NULL
        ORDER BY s.location <-> (SELECT location FROM me)
        LIMIT $2`,
      [slug, limit],
    );
  }

  /** Countries we actually hold data for, for /camping. */
  async countries(): Promise<
    { country: string; spots: number; regions: number }[]
  > {
    const rows = await this.db.query(
      `SELECT lower(country) AS country,
              count(*)::int AS spots,
              count(DISTINCT region)::int AS regions
         FROM camping_spots
        WHERE region IS NOT NULL AND missing_since IS NULL
        GROUP BY 1 ORDER BY 2 DESC`,
    );
    return rows;
  }

  /**
   * Regions of one country. Every region is returned, including the thin
   * ones — leaving them out would break the crawl path to their campsites.
   */
  async regions(country: string): Promise<
    { region: string; slug: string; spots: number; indexable: boolean }[]
  > {
    const rows = await this.db.query(
      `SELECT region, count(*)::int AS spots
         FROM camping_spots
        WHERE lower(country) = lower($1)
          AND region IS NOT NULL AND missing_since IS NULL
        GROUP BY 1 ORDER BY 2 DESC, 1`,
      [country],
    );
    return rows.map((r: { region: string; spots: number }) => ({
      region: r.region,
      slug: slugifyRegion(r.region),
      spots: r.spots,
      indexable: r.spots >= REGION_INDEX_THRESHOLD,
    }));
  }

  /**
   * Campsites of one region, a page at a time.
   *
   * Named sites first: a list that opens with six "Campsite" rows tells the
   * reader nothing, even though those rows are honest. `region` is matched
   * on the slug, because that is what the URL carries.
   */
  async regionSpots(
    country: string,
    regionSlug: string,
    page = 1,
    perPage = 24,
  ): Promise<{ region: string | null; total: number; items: SpotCard[] }> {
    // The slug is resolved in JS, not in SQL. Postgres cannot strip
    // diacritics without the `unaccent` extension, and "Šentilj" has to
    // become "sentilj" the same way here and in the URL the page was built
    // with. One function, used by both, cannot drift; two implementations
    // would eventually disagree and 404 a live page.
    const region =
      (await this.regions(country)).find((r) => r.slug === regionSlug)
        ?.region ?? null;
    if (!region) return { region: null, total: 0, items: [] };

    const [{ total }] = await this.db.query(
      `SELECT count(*)::int AS total FROM camping_spots
        WHERE lower(country) = lower($1) AND region = $2
          AND missing_since IS NULL`,
      [country, region],
    );

    const items = await this.db.query(
      `SELECT slug, name, country, region, type, amenities
         FROM camping_spots
        WHERE lower(country) = lower($1) AND region = $2
          AND missing_since IS NULL
        ORDER BY (name IS NULL), name, slug
        LIMIT $3 OFFSET $4`,
      [country, region, perPage, (page - 1) * perPage],
    );

    return { region, total, items };
  }

  /**
   * Every publishable spot, for the sitemap and for static generation.
   * A spot without a region has no URL, so it is excluded here rather than
   * being given an invented one.
   */
  async allPublishable(): Promise<
    { country: string; region: string; slug: string; lastSeenAt: Date | null }[]
  > {
    const rows = await this.db.query(
      `SELECT country, region, slug, last_seen_at
         FROM camping_spots
        WHERE region IS NOT NULL AND missing_since IS NULL
        ORDER BY country, region, slug`,
    );
    return rows.map((r: Record<string, unknown>) => ({
      country: String(r.country).toLowerCase(),
      region: slugifyRegion(r.region as string),
      slug: r.slug as string,
      lastSeenAt: (r.last_seen_at as Date) ?? null,
    }));
  }
}

/**
 * 🔴 CAMP-71: below this, a region hub exists but is not indexed.
 *
 * Measured on the Slovenian import: of 106 regions, 26 (25%) hold exactly
 * one campsite and 31 more hold two — 54% of hubs would be thin pages, and
 * a hub listing one campsite is a duplicate of that campsite's own page
 * with nothing added. A hub earns its place by offering a choice.
 *
 * It is `noindex, follow`, never a 404 and never omitted: the page is the
 * parent of real campsite URLs and the target of their breadcrumb, and the
 * crawl path from the country page down to the campsite has to survive
 * (the card's criterion is four clicks without JavaScript). So the robot
 * still walks through it — it just does not compete as a landing page.
 */
export const REGION_INDEX_THRESHOLD = 3;

/** Region names carry diacritics and spaces; URLs must not. */
export function slugifyRegion(region: string | null): string {
  if (!region) return '';
  return region
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function canonicalPath(
  country: string,
  region: string | null,
  slug: string,
): string {
  return `/camping/${country.toLowerCase()}/${slugifyRegion(region)}/${slug}`;
}

function toView(row: Record<string, unknown>): SpotView {
  const stored = (row.amenities ?? {}) as Partial<CampingSpotAmenities>;
  // A row written before CAMP-27 could hold booleans. Nothing has been
  // imported that way, but a page must never crash on old data - and an
  // amenity we cannot read is unknown, never "no".
  const amenities = Object.fromEntries(
    (
      ['electricity', 'water', 'shower', 'dogFriendly', 'wifi'] as const
    ).map((k) => [
      k,
      Object.values(AmenityValue).includes(stored[k] as AmenityValue)
        ? (stored[k] as AmenityValue)
        : AmenityValue.UNKNOWN,
    ]),
  ) as unknown as CampingSpotAmenities;

  return {
    slug: row.slug as string,
    name: (row.name as string) ?? null,
    country: row.country as string,
    region: (row.region as string) ?? null,
    type: row.type as string,
    lat: Number(row.lat),
    lon: Number(row.lon),
    amenities,
    ownerOverrides: (row.owner_overrides ?? {}) as Record<string, unknown>,
    lastSeenAt: (row.last_seen_at as Date) ?? null,
    missingSince: (row.missing_since as Date) ?? null,
  };
}
