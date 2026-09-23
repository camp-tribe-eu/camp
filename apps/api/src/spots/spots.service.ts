import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CampingSpotAmenities } from '../osm/tag-mapping';
import { canonicalPath, readAmenities, slugifyRegion } from './canonical';

// Re-exported so existing importers keep working; the rules themselves
// live in canonical.ts, where a unit test can reach them.
export { canonicalPath, readAmenities, slugifyRegion };
import { SpotContext } from '../osm/spot-context';
import type { SpotSource } from '../entities/camping-spot.entity';

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
  /** CAMP-33: computed surroundings — the part no competitor publishes. */
  context: SpotContext;
  /** CAMP-101: the operator's own words, verbatim, in their own language. */
  description: string | null;
  descriptionLang: string | null;
  /** Official national classification, 1–5, where a source publishes one. */
  stars: number | null;
  website: string | null;
  /**
   * 🔴 Which source gave which field, and when it last changed it.
   *
   * This travels to the page because the page is where the attribution
   * has to appear: Licence Ouverte requires the source AND the date of
   * the last update of the information reused, and our records carry
   * dates from 2022 to today. A single line at the foot of the site
   * cannot say that.
   */
  sources: SpotSource[];
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
              amenities, owner_overrides, last_seen_at, missing_since,
              context, description, description_lang, stars, website,
              sources
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

  /**
   * CAMP-73/87: campsites that are gone for good, and where to send
   * someone who arrives at their old URL.
   *
   * 🔴 Gone is not the same as missing. An object deleted from OSM by
   * mistake usually reappears within a week, so CAMP-87 only declares it
   * gone after four consecutive imports without it. The column records a
   * timestamp rather than a count, and the import runs weekly, so four
   * imports is 28 days — written here because it is a derivation, not a
   * constant somebody chose.
   *
   * Everything else in this service filters `missing_since IS NULL`, so
   * these rows are already absent from the pages and the sitemap. What
   * they need is the right HTTP status at the old address: a 410 tells
   * Google the URL is intentionally gone, which 404 does not.
   */
  async gone(): Promise<
    {
      path: string;
      name: string | null;
      missingSince: Date;
      nearest: { path: string; name: string | null; metres: number } | null;
    }[]
  > {
    const rows = await this.db.query(
      `SELECT g.slug, g.name, g.country, g.region, g.missing_since,
              n.slug AS n_slug, n.name AS n_name,
              n.country AS n_country, n.region AS n_region,
              round(ST_Distance(g.location::geography,
                                n.location::geography)) AS n_metres
         FROM camping_spots g
         -- 🔴 LATERAL, so the nearest live campsite is found per row with
         -- the GiST index (<->) rather than by joining every pair.
         LEFT JOIN LATERAL (
           SELECT s.slug, s.name, s.country, s.region, s.location
             FROM camping_spots s
            WHERE s.missing_since IS NULL
              AND s.region IS NOT NULL
            ORDER BY s.location <-> g.location
            LIMIT 1
         ) n ON true
        WHERE g.missing_since IS NOT NULL
          AND g.missing_since < now() - interval '28 days'
          AND g.region IS NOT NULL
        ORDER BY g.country, g.region, g.slug`,
    );

    return rows.map((r: Record<string, unknown>) => ({
      path: canonicalPath(
        r.country as string,
        (r.region as string) ?? null,
        r.slug as string,
      ),
      name: (r.name as string) ?? null,
      missingSince: r.missing_since as Date,
      // 🔴 Offered as a link, never as a redirect. "The nearest campsite
      // to one that closed" is a guess, and a 301 would tell Google the
      // two are the same place. A reader can judge 400 metres for
      // themselves; a search engine cannot.
      nearest: r.n_slug
        ? {
            path: canonicalPath(
              r.n_country as string,
              (r.n_region as string) ?? null,
              r.n_slug as string,
            ),
            name: (r.n_name as string) ?? null,
            metres: Number(r.n_metres),
          }
        : null,
    }));
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
  async regions(
    country: string,
  ): Promise<
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
   * CAMP-41: the campsites the home page puts forward.
   *
   * 🔴 Not "featured" and not "best". We have no reviews, no ratings and
   * no visits, so any claim of quality would be invented — and inventing
   * one on the home page is exactly the misleading practice we refused
   * for photographs. The rule is instead **the ones we know most about**,
   * and the page says so in those words.
   *
   * Ranking, in order: how many of the five amenities are actually
   * recorded, then whether there is a named body of water, then how close
   * it is. All three are facts about our data, not opinions about the
   * place.
   */
  async notable(limit = 6): Promise<SpotCard[]> {
    return this.db.query(
      `SELECT slug, name, country, region, type, amenities, context
         FROM camping_spots
        WHERE missing_since IS NULL
          AND region IS NOT NULL
          AND name IS NOT NULL
        ORDER BY (
          SELECT count(*) FROM jsonb_each_text(amenities)
           WHERE value <> 'unknown'
        ) DESC,
        (context -> 'water' ->> 'name' IS NOT NULL) DESC,
        coalesce((context -> 'water' ->> 'm')::int, 999999) ASC,
        slug
        LIMIT $1`,
      [limit],
    );
  }

  /** Countries plus their campsite totals, for the home page. */
  async summary(): Promise<{
    spots: number;
    countries: number;
    regions: number;
  }> {
    const [row] = await this.db.query(
      `SELECT count(*)::int AS spots,
              count(DISTINCT country)::int AS countries,
              count(DISTINCT (country, region))::int AS regions
         FROM camping_spots
        WHERE missing_since IS NULL AND region IS NOT NULL`,
    );
    return row;
  }

  /**
   * Every publishable spot, for the sitemap and for static generation.
   * A spot without a region has no URL, so it is excluded here rather than
   * being given an invented one.
   */
  async allPublishable(): Promise<
    {
      country: string;
      region: string;
      slug: string;
      lastSeenAt: Date | null;
      contentChangedAt: Date | null;
    }[]
  > {
    const rows = await this.db.query(
      `SELECT country, region, slug, last_seen_at, content_changed_at
         FROM camping_spots
        WHERE region IS NOT NULL AND missing_since IS NULL
        ORDER BY country, region, slug`,
    );
    return rows.map((r: Record<string, unknown>) => ({
      country: String(r.country).toLowerCase(),
      region: slugifyRegion(r.region as string),
      slug: r.slug as string,
      lastSeenAt: (r.last_seen_at as Date) ?? null,
      // 🔴 What <lastmod> must be built from. See the column's migration:
      // last_seen_at ticks weekly whether or not anything changed.
      contentChangedAt: (r.content_changed_at as Date) ?? null,
    }));
  }

  /**
   * CAMP-67: everything the site search needs, in one pass.
   *
   * 🔴 Built here and downloaded once, rather than answered per
   * keystroke. The web app runs with this API switched off (CAMP-39) and
   * the map already works that way; a search that needed a live endpoint
   * would be the one feature that breaks when the backend does.
   *
   * 🔴 `near` is the part that makes the card's second criterion
   * possible — "results ordered by distance, not alphabetically". The
   * town, water and station in `context` were computed in CAMP-33 WITH
   * their distances, so a query naming a place already has a number to
   * sort by. Nothing is geocoded at search time.
   *
   * Unnamed campsites are included: 212 of the Croatian import have no
   * name, and they are still findable by their region and surroundings.
   */
  async searchDocuments(): Promise<
    {
      name: string | null;
      country: string;
      region: string;
      slug: string;
      lat: number;
      lon: number;
      near: { name: string; m: number }[];
    }[]
  > {
    const rows = await this.db.query(
      `SELECT name, country, region, slug,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lon,
              context
         FROM camping_spots
        WHERE region IS NOT NULL AND missing_since IS NULL
        ORDER BY country, region, slug`,
    );

    return rows.map((r: Record<string, unknown>) => {
      const ctx = (r.context ?? {}) as Record<
        string,
        { name?: string; m?: number } | undefined
      >;
      const near: { name: string; m: number }[] = [];
      // Only the features that carry a name — a river we know the
      // distance to but not the name of cannot be searched for.
      for (const key of ['town', 'water', 'supermarket', 'station']) {
        const f = ctx[key];
        if (f?.name && typeof f.m === 'number') {
          near.push({ name: f.name, m: f.m });
        }
      }

      return {
        name: (r.name as string) ?? null,
        country: String(r.country).toLowerCase(),
        region: slugifyRegion(r.region as string),
        slug: r.slug as string,
        lat: Number(r.lat),
        lon: Number(r.lon),
        near,
      };
    });
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
function toView(row: Record<string, unknown>): SpotView {
  const amenities = readAmenities(row.amenities);

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
    context: (row.context ?? {}) as SpotContext,
    description: (row.description as string) ?? null,
    descriptionLang: (row.description_lang as string) ?? null,
    stars:
      row.stars === null || row.stars === undefined ? null : Number(row.stars),
    website: (row.website as string) ?? null,
    sources: (row.sources ?? []) as SpotSource[],
  };
}
