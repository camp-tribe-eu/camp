import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CampingSpotAmenities } from '../osm/tag-mapping';
import { canonicalPath, readAmenities, slugifyRegion } from './canonical';
import { LINKED_SECONDARY_JOIN, mergeLinked, notSecondarySql } from './links';

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
  /** CAMP-141: how to reach the place, as OpenStreetMap records it. */
  contact: {
    website?: string;
    phone?: string;
    email?: string;
    operator?: string;
    openingHours?: string;
    capacity?: number;
    address?: { street?: string; city?: string; postcode?: string };
  };
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
  /**
   * CAMP-105: false when this page has nothing on it but a name.
   *
   * Decided in SQL (NOTHING_TO_SAY_SQL) so the page and the sitemap
   * cannot disagree about it.
   */
  indexable: boolean;
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
      `SELECT s.slug, s.name, s.country, s.region, s.type,
              ST_Y(s.location::geometry) AS lat,
              ST_X(s.location::geometry) AS lon,
              s.amenities, s.owner_overrides, s.last_seen_at, s.missing_since,
              s.context, s.description, s.description_lang, s.stars,
              s.website, s.contact, s.sources,
              -- 🔴 CAMP-144. The other source's row, joined in — not
              -- merged in SQL. Which field wins is a decision with
              -- reasons behind it (mergeLinked, below), and a reason
              -- cannot be written in a coalesce() list.
              linked.name AS linked_name,
              linked.stars AS linked_stars,
              linked.description AS linked_description,
              linked.description_lang AS linked_description_lang,
              linked.website AS linked_website,
              linked.contact AS linked_contact,
              linked.sources AS linked_sources,
              linked.owner_overrides AS linked_owner_overrides,
              (NOT ${NOTHING_TO_SAY_SQL}
               OR linked.stars IS NOT NULL
               OR linked.description IS NOT NULL) AS indexable
         FROM camping_spots s${LINKED_SECONDARY_JOIN}
        WHERE s.slug = $1
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

    return toView(mergeLinked(row));
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
          -- Otherwise "nearby campsites" opens with the same campsite the
          -- reader is already looking at, 49 m away under another name.
          AND ${notSecondarySql('s')}
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

  /**
   * CAMP-144: URLs that were a page of their own until the two rows were
   * linked, and the page that now carries their content.
   *
   * 🔴 A 301, not a 410 and not a 404 — and the difference is the whole
   * reason this endpoint exists rather than nothing.
   *
   * The campsite has not gone away. Its stars, its description and its
   * name are on the other page, which is why linking rather than
   * deleting was the requirement. A 404 would throw away whatever that
   * URL had earned and strand anybody who bookmarked it; a 410 would
   * tell a crawler the campsite no longer exists, which is a lie about a
   * business that is open. 301 says the true thing: this campsite is
   * over there now.
   *
   * 🔴 And it is the one case where a redirect is honest. CAMP-73
   * deliberately refuses to redirect a closed campsite to its nearest
   * neighbour, because "nearest" is a guess. This is not a guess about
   * proximity — it is the assertion the link already makes, that the two
   * rows are one campsite, and if that assertion is wrong the right fix
   * is to undo the link, which withdraws this redirect with it.
   */
  async links(): Promise<{ from: string; to: string }[]> {
    const rows = await this.db.query(
      `SELECT sec.country  AS from_country, sec.region  AS from_region,
              sec.slug     AS from_slug,
              pri.country  AS to_country,  pri.region  AS to_region,
              pri.slug     AS to_slug
         FROM spot_links l
         JOIN camping_spots sec ON sec.id = l.secondary_id
         JOIN camping_spots pri ON pri.id = l.primary_id
        WHERE l.unlinked_at IS NULL
          -- A row that never had a region never had a URL either, so
          -- there is nothing to redirect from. Same rule as everywhere
          -- else: no invented paths.
          AND sec.region IS NOT NULL
          -- 🔴 The same two conditions isSecondarySql uses, and they
          -- have to be the same two. (No backticks around that name:
          -- this comment is inside a template literal, and the repo has
          -- broken the build this way twice already.)
          --
          -- If the primary has gone missing
          -- from OSM, the secondary stops being hidden and becomes its
          -- own page again — so redirecting to the primary would send
          -- readers from a live page to one that is on its way to a
          -- 410. The two rules are what keep the site and its redirects
          -- describing the same world.
          AND pri.region IS NOT NULL
          AND pri.missing_since IS NULL
        ORDER BY sec.country, sec.region, sec.slug`,
    );
    return rows
      .map((r: Record<string, unknown>) => ({
        from: canonicalPath(
          r.from_country as string,
          r.from_region as string,
          r.from_slug as string,
        ),
        to: canonicalPath(
          r.to_country as string,
          r.to_region as string,
          r.to_slug as string,
        ),
      }))
      .filter(
        (r: { from: string | null; to: string | null }) =>
          r.from !== null && r.to !== null && r.from !== r.to,
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
         FROM camping_spots s
        WHERE region IS NOT NULL AND missing_since IS NULL
          -- 🔴 CAMP-144. "61 557 campsites" counted rows, and 2 986 of
          -- those rows were a second copy of a campsite already counted.
          -- The number on the home page and in every comparison with a
          -- competitor is this one.
          AND ${notSecondarySql('s')}
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
         FROM camping_spots s
        WHERE lower(country) = lower($1)
          AND region IS NOT NULL AND missing_since IS NULL
          AND ${notSecondarySql('s')}
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
      `SELECT count(*)::int AS total FROM camping_spots s
        WHERE lower(country) = lower($1) AND region = $2
          AND missing_since IS NULL
          AND ${notSecondarySql('s')}`,
      [country, region],
    );

    const items = await this.db.query(
      `SELECT slug, name, country, region, type, amenities
         FROM camping_spots s
        WHERE lower(country) = lower($1) AND region = $2
          AND missing_since IS NULL
          AND ${notSecondarySql('s')}
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
         FROM camping_spots s
        WHERE missing_since IS NULL
          AND region IS NOT NULL
          AND name IS NOT NULL
          AND ${notSecondarySql('s')}
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
         FROM camping_spots s
        WHERE missing_since IS NULL AND region IS NOT NULL
          AND ${notSecondarySql('s')}`,
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
      /** False when the page has nothing but a name — see NOTHING_TO_SAY_SQL. */
      indexable: boolean;
    }[]
  > {
    const rows = await this.db.query(
      `SELECT s.country, s.region, s.slug, s.last_seen_at,
              -- 🔴 The later of the two, because the page now shows both
              -- rows. A star rating that arrived in the DATAtourisme row
              -- yesterday changed what this URL says yesterday; a
              -- <lastmod> taken from the OSM row alone would tell every
              -- crawler the page has not moved since the last OSM
              -- import, which is the opposite of true.
              --
              -- 🔴 greatest() IGNORES NULLs — checked against this
              -- database, not assumed: greatest('2026-01-01', NULL) is
              -- '2026-01-01' and greatest(NULL, NULL) is NULL. That is
              -- exactly what is wanted here (an unlinked row has no
              -- linked date, and must keep its own), but it is the same
              -- behaviour that made this card's own OSM-type split come
              -- out backwards, so it is written down rather than
              -- rediscovered. If NULL had to mean "unknown, so the
              -- answer is unknown", this would need coalesce.
              greatest(s.content_changed_at, linked.content_changed_at)
                AS content_changed_at,
              -- 🔴 Either side having something to say is enough. The
              -- merged page carries both, so judging it by the primary
              -- alone would noindex a page that now has stars and a
              -- description on it.
              (NOT ${NOTHING_TO_SAY_SQL}
               OR linked.stars IS NOT NULL
               OR linked.description IS NOT NULL) AS indexable
         FROM camping_spots s${LINKED_SECONDARY_JOIN}
        WHERE s.region IS NOT NULL AND s.missing_since IS NULL
          -- 🔴 CAMP-144. This is the line that stops the second page
          -- existing at all: the static site generates exactly the URLs
          -- this returns.
          AND ${notSecondarySql('s')}
        ORDER BY s.country, s.region, s.slug`,
    );
    return rows.map((r: Record<string, unknown>) => ({
      country: String(r.country).toLowerCase(),
      region: slugifyRegion(r.region as string),
      slug: r.slug as string,
      lastSeenAt: (r.last_seen_at as Date) ?? null,
      // 🔴 What <lastmod> must be built from. See the column's migration:
      // last_seen_at ticks weekly whether or not anything changed.
      contentChangedAt: (r.content_changed_at as Date) ?? null,
      indexable: r.indexable === true,
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
         FROM camping_spots s
        WHERE region IS NOT NULL AND missing_since IS NULL
          AND ${notSecondarySql('s')}
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

/**
 * 🔴 CAMP-105: a campsite page with nothing on it but its name.
 *
 * The same idea as REGION_INDEX_THRESHOLD one level down, and it arrived
 * the same way: not from an opinion about thin content, but because the
 * near-duplicate guard kept nearly failing. Two campsites about which we
 * know only a name and a point produce two pages that differ by the name
 * — they are near-identical because there is nothing to differ.
 *
 * Measured 24.09.2026, after the French import: 2 354 of 9 830 campsites
 * (24%) have no amenity recorded, no surroundings computed, no
 * description and no star rating.
 *
 * Two different shapes of nothing, which is what made the first version
 * of this rule wrong: France stores a literal '{}' where nothing is
 * known, OpenStreetMap stores every key explicitly as "unknown". Asking
 * `amenities = '{}'` counted only the first and missed 482 of the
 * second.
 *
 * `noindex, follow`, never a 404 and never hidden:
 *
 *  - the page is honest — it says what is not recorded, which is exactly
 *    what this project promises to do;
 *  - it is reachable from the map and from its region hub, and somebody
 *    looking for that specific campsite should find it;
 *  - it just should not compete in a search result against pages that
 *    have something to say.
 *
 * 🔴 And it lifts by itself. The day CAMP-33 computes surroundings for a
 * campsite, or an owner adds one fact, the page has something and this
 * expression stops matching. No list to maintain, nothing to remember.
 *
 * Written as SQL rather than in the web app on purpose: the sitemap asks
 * this question about ten thousand pages at once and the page asks it
 * about one, and two implementations of the same rule drift.
 */
/**
 * 🔴 Every column here is qualified `s.`, so the table MUST be aliased
 * `s` wherever this is interpolated.
 *
 * It was unqualified until CAMP-144, which was fine while the only table
 * in the statement was `camping_spots`. The moment the linked row joined
 * in — and it carries `stars` and `description` too, by definition —
 * Postgres answers "column reference is ambiguous" and the query dies.
 * Unqualified would have been worse than an error if it had resolved: it
 * would have silently asked the question about the wrong row.
 */
export const NOTHING_TO_SAY_SQL = `(
  -- 🔴 "No amenity is KNOWN", not "the object is empty".
  --
  -- The first version of this asked \`amenities = '{}'\`, and it was wrong
  -- in a way only the CI fixture revealed. A campsite imported from
  -- OpenStreetMap stores every amenity explicitly, as
  -- {"wifi":"unknown","water":"unknown",…} — a full object that answers
  -- nothing. \`= '{}'\` is false for those rows, so 482 campsites that
  -- carry no fact whatsoever were counted as having something. Measured
  -- 24.09.2026: 1 872 by the old rule, 2 354 by this one.
  --
  -- The French rows happen to store a literal '{}', which is why the
  -- mistake produced a plausible number instead of an obvious one.
  NOT jsonb_path_exists(
    coalesce(s.amenities, '{}'::jsonb),
    '$.* ? (@ == "yes" || @ == "no")'
  )
  AND (s.context IS NULL OR s.context = '{}'::jsonb)
  AND s.description IS NULL
  AND s.stars IS NULL
)`;

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
    // 🔴 The column is NOT NULL DEFAULT '{}', so this is an object or
    // nothing went wrong. The ?? is for rows read before the migration
    // in a half-deployed state, not for a case the schema allows.
    contact: (row.contact as SpotView['contact']) ?? {},
    sources: (row.sources ?? []) as SpotSource[],
    // 🔴 Defaults to indexable when the column is absent, not to hidden.
    // A query that forgot to select it must not silently noindex a page
    // that has plenty to say — the failure should be a page that ranks
    // when it should not, which somebody notices, rather than a page
    // that quietly disappears, which nobody does.
    indexable: row.indexable !== false,
  };
}
