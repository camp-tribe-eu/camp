import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CampingSpotAmenities } from '../osm/tag-mapping';
import { canonicalPath, readAmenities, slugifyRegion } from './canonical';
// 🔴 `mergedStarsSql` is deliberately NOT imported here. The only place
// this service surfaces a star rating is the detail page, which goes
// through `mergeLinked` — a second mechanism for the same field would be
// two answers to one question. The guides import it because their
// queries aggregate over campsites rather than rendering one.
import {
  GONE_AFTER_DAYS,
  GONE_LIST_SQL,
  GONE_PENDING_SQL,
  linkedSecondariesJoin,
  mergedNameSql,
  mergeAllLinked,
  notSecondarySql,
  REDIRECT_LIST_SQL,
} from './links';
import {
  REGIONS_IN_USE_SQL,
  regionRenames,
  type RegionRename,
} from './region-renames';
import { NOTHING_TO_SAY_SQL, SPOT_DETAIL_SQL } from './detail-query';
export { NOTHING_TO_SAY_SQL } from './detail-query';
import type { TariffView } from './tariffs';
export type { TariffView } from './tariffs';
// CAMP-168: the official bathing water classification for the season.
import type { BathingWaterView } from '../bathing/nearby';
export type { BathingWaterView } from '../bathing/nearby';
// CAMP-164: the EEA air quality index — facts only, freshness is decided
// where it is shown.
import type { WebcamView } from '../webcams/nearby';
import type { AirQualityFacts } from '../air/nearby';
export type { AirQualityFacts } from '../air/nearby';

// Re-exported so existing importers keep working; the rules themselves
// live in canonical.ts, where a unit test can reach them.
export { canonicalPath, readAmenities, slugifyRegion };
import { SpotContext } from '../osm/spot-context';
import {
  overnightStatusSql,
  toOvernightView,
  type OvernightView,
} from './overnight';
import type { SpotSource } from '../entities/camping-spot.entity';

/** One campsite as a page needs it. Geometry is already reduced to lat/lon. */
/** Те, що віддає `ST_AsGeoJSON` для MultiPolygon-колонки. */
export type GeoJsonPolygon =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface SpotView {
  slug: string;
  name: string | null;
  country: string;
  region: string | null;
  type: string;
  lat: number;
  lon: number;
  /**
   * CAMP-352. Обрис ділянки як GeoJSON-геометрія, або `null`.
   *
   * 🔴 `null` означає «цей кемпінг у OSM позначений крапкою», а не
   * «ми не знаємо». Сторінка має малювати обрис лише там, де він є, і
   * мовчати там, де його немає, — вигадана межа ділянки гірша за її
   * відсутність.
   */
  outline: GeoJsonPolygon | null;
  amenities: CampingSpotAmenities;
  /** Owner-corrected fields win over OSM at read time (CAMP-86). */
  ownerOverrides: Record<string, unknown>;
  /**
   * The day OUR importer last found this campsite in OpenStreetMap.
   * 🔴 Not an edit date: it moves every week for every campsite.
   */
  lastSeenAt: Date | null;
  /**
   * CAMP-256: the day a MAPPER last edited the OpenStreetMap record.
   *
   * 🔴 The OTHER date, and the one the page labels "Record last edited".
   * `null` is "not known" — DATAtourisme rows have no OSM object, and an
   * OSM row loaded before the extract carried this has none until the next
   * import — and is never replaced by `lastSeenAt`, which would turn every
   * page into "edited this month".
   */
  osmRecordEditedAt: Date | null;
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
   * Коди зон попереджень цього кемпінга (CAMP-287).
   *
   * 🔴 `null` і `[]` — РІЗНІ відповіді. `null`: резолвер сюди не дійшов,
   * і ми не знаємо, у якій зоні цей кемпінг. `[]`: дійшов і зон не
   * знайшов — такий кемпінг попереджень не дістане ніколи, і сторінка
   * мусить сказати це інакше, ніж «попереджень немає».
   */
  warningAreas: string[] | null;
  /**
   * CAMP-255: may a motorhome stay the night here — `allowed`,
   * `forbidden` or `unknown`, with the source and the day beside every
   * answer that is not `unknown`.
   *
   * 🔴 `unknown` is the common case and is NEVER rewritten into either
   * answer on its way here: `toOvernightView` is total and falls back to
   * it, and the page prints it as a sentence rather than hiding it.
   */
  overnight: OvernightView;
  /**
   * CAMP-147: the campsite's price list — a table, never one number.
   *
   * 🔴 Every entry carries its own validity period, because the API
   * refuses to send one that does not. One campsite prices up to 83
   * different things (bare pitch, motorhome pitch, mobile home by the
   * week, the tourist tax, the dog), each in its own season; "from
   * €13.50" is one of those 83 and is a lie in August.
   */
  tariffs: TariffView[];
  /**
   * How many further tariffs the source publishes with no season.
   *
   * 🔴 On the page, not swallowed. 5 622 of the 12 402 tariffs imported
   * carry no period and cannot be shown; a page that prints the other
   * few and says nothing has misrepresented the price list by omission.
   */
  tariffsWithheld: number;
  /**
   * CAMP-168: the nearest officially designated bathing water, or null.
   *
   * 🔴 It carries its SEASON, always. The EEA publishes one
   * classification per bathing season — the 2025 season was published on
   * 02.06.2026 — and a class without its year reads as the state of the
   * water today, which we have not measured and nobody has: the
   * directive asks for four samples in a season. There is no shape of
   * this object without `season` in it, so no consumer can drop the year
   * by omission; one can only be written to hide it, and a test reads
   * the served HTML for the year.
   *
   * 🔴 null means "no designated bathing water within 2 km", a fact the
   * page states out loud. 42 953 of 61 558 campsites (69.8%) are in that
   * case, and silence there would read as reassurance.
   */
  bathingWater: BathingWaterView | null;
  /**
   * CAMP-164: what we hold about the air here — the nearest station's
   * latest reported hour, the 1 km modelled index where no station is
   * near, or an explicit `none`.
   *
   * 🔴 FACTS, NOT A VERDICT: there is no clock in the query, so nothing
   * here says whether a reading is still fresh. The page decides that
   * against the reader's clock (apps/web/src/lib/air-quality.ts) — a
   * statically built page outlives the import that fed it.
   *
   * 🔴 `reading.basis` is `reported` or `mixed`, never `modelled`: a
   * station row cannot hold an hour that is entirely a model estimate
   * (the column refuses it), and the pure model is the `modelled` kind,
   * a different branch that the page labels as a model.
   */
  airQuality: AirQualityFacts;
  /**
   * CAMP-190: the nearest public webcams, with OUR distance to each.
   *
   * 🔴 FACTS, NOT A FRAME. No image, no image URL and no history: the
   * Windy terms name "downloading of significant portions of the Webcam
   * image history" a material breach, and the picture is fetched by the
   * reader's browser from their CDN at the moment they look.
   *
   * 🔴 `metres` travels with every row and the page may not drop it. At
   * 25 km a camera is the next valley, and a page that implied it shows
   * the campsite would be inventing.
   */
  /**
   * 🔴 `null` MEANS WE HAVE NOT LOOKED, and `[]` means we looked and
   * found nothing. They are not the same sentence on the page.
   *
   * The catalogue is imported by `scripts/windy/fetch-webcams.mjs`, and
   * until it has run the table is empty — so every campsite in Europe
   * came back `[]` and the panel printed "No public webcam within 25 km
   * of this campsite. That is what the camera network covers", which
   * blames the camera network for an import we have not done. Measured
   * on the live API on 05.10.2026: the table is empty and 100% of pages
   * carried that sentence, over a continent where 88% of campsites have
   * a camera within 25 km (CAMP-189).
   *
   * Same defect as the stale-frame one review found, arriving from the
   * other end of the same hole: an empty array had two meanings.
   */
  webcams: WebcamView[] | null;
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
    const rows = await this.db.query(SPOT_DETAIL_SQL, [slug]);
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

    return toView(mergeAllLinked(row));
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
  /**
   * Чому список 410 саме такий — числа, із якими збірка його звіряє.
   *
   * 🔴 Це відповідь на питання «порожньо тому, що ще рано, чи тому, що
   * зламалось». CAMP-301: `gen-gone.mjs` відмовляється писати файл лише
   * коли відповідь НЕ ok, а порожній масив зі статусом 200 проходить і
   * записується. Сьогодні це правильно — найдавнішому зниклому рядку 18
   * днів із 28. Приблизно 22.10.2026 перший дозріє, і з того дня та сама
   * тиша означатиме, що впав імпорт, зламався запит або хтось зсунув
   * інтервал — без жодного симптому до звіту про обхід.
   *
   * `intervalDays` їде сюди ж, щоб збірка не носила власної копії числа.
   */
  /**
   * CAMP-289: регіони, чия адреса переїжджає, і куди саме.
   *
   * Вісім пар, 607 байт — проти 65 КБ, якби кожну сторінку вести
   * окремою парою. Це перейменування регіону, а не 668 окремих рішень,
   * і дешевше воно саме тому, що каже правду.
   *
   * 🔴 Числа, які легко сплутати (заміряно 13.10.2026): 762 рядки
   * лежать у цих регіонах, 721 із них живий, і лише 668 мають власну
   * сторінку — решта вторинні.
   */
  async regionRenames(): Promise<{
    regionsInUse: number;
    renames: RegionRename[];
  }> {
    const rows = await this.db.query(REGIONS_IN_USE_SQL);
    const mapped = rows.map((r: Record<string, unknown>) => ({
      country: String(r.country),
      region: String(r.region),
      pages: Number(r.pages),
    }));
    // 🔴 `regionsInUse` їде разом зі списком, бо порожній список буває
    // законним: на фікстурі CI регіонів, що потребують перейменування,
    // немає. Відрізнити «нема чого перейменовувати» від «запит зламався»
    // можна лише причиною — так само, як у CAMP-301.
    return { regionsInUse: mapped.length, renames: regionRenames(mapped) };
  }

  async gonePending(): Promise<{
    intervalDays: number;
    mature: number;
    pending: number;
    oldestDays: number | null;
  }> {
    const [row] = await this.db.query(GONE_PENDING_SQL);
    return {
      intervalDays: GONE_AFTER_DAYS,
      mature: Number(row?.mature ?? 0),
      pending: Number(row?.pending ?? 0),
      oldestDays:
        row?.oldest_days === null || row?.oldest_days === undefined
          ? null
          : Number(row.oldest_days),
    };
  }

  async gone(): Promise<
    {
      path: string;
      name: string | null;
      missingSince: Date;
      nearest: { path: string; name: string | null; metres: number } | null;
    }[]
  > {
    const rows = await this.db.query(GONE_LIST_SQL);

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
   *
   * 🔴 CAMP-279: which row redirects is decided by which one is
   * published, not by which one is the secondary. The pair is defined
   * once, in REDIRECT_PAIRS_SQL, and `gone()` subtracts the same rows —
   * so a URL cannot be told to redirect here and announced dead there.
   */
  async links(): Promise<{ from: string; to: string }[]> {
    const rows = await this.db.query(REDIRECT_LIST_SQL);
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
  async regions(country: string): Promise<
    {
      region: string;
      slug: string;
      spots: number;
      indexable: boolean;
      overnightAllowed: number;
      overnightForbidden: number;
      overnightReadAt: string | null;
    }[]
  > {
    const rows = await this.db.query(
      `SELECT region, count(*)::int AS spots,
              -- 🔴 CAMP-255. Counted through the ONE gate every reader
              -- uses, from OUR rows. Unknown is not counted here: it is
              -- spots - allowed - forbidden, derived where it is shown, so
              -- the three can never add up to something else.
              count(*) FILTER (WHERE ${overnightStatusSql('s')} = 'allowed')::int
                AS overnight_allowed,
              count(*) FILTER (WHERE ${overnightStatusSql('s')} = 'forbidden')::int
                AS overnight_forbidden,
              -- The day the figures above are a reading of: the last time
              -- an import found any of these campsites in OpenStreetMap.
              to_char(max(last_seen_at), 'YYYY-MM-DD') AS overnight_read_at
         FROM camping_spots s
        WHERE lower(country) = lower($1)
          AND region IS NOT NULL AND missing_since IS NULL
          AND ${notSecondarySql('s')}
        GROUP BY 1 ORDER BY 2 DESC, 1`,
      [country],
    );
    return rows.map(
      (r: {
        region: string;
        spots: number;
        overnight_allowed: number;
        overnight_forbidden: number;
        overnight_read_at: string | null;
      }) => ({
        region: r.region,
        slug: slugifyRegion(r.region),
        spots: r.spots,
        indexable: r.spots >= REGION_INDEX_THRESHOLD,
        overnightAllowed: r.overnight_allowed,
        overnightForbidden: r.overnight_forbidden,
        overnightReadAt: r.overnight_read_at,
      }),
    );
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
      `SELECT slug, ${mergedNameSql('s')} AS name,
              country, region, type, amenities
         FROM camping_spots s
        WHERE lower(country) = lower($1) AND region = $2
          AND missing_since IS NULL
          AND ${notSecondarySql('s')}
        ORDER BY (${mergedNameSql('s')} IS NULL), ${mergedNameSql('s')}, slug
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
      `SELECT slug, ${mergedNameSql('s')} AS name,
              country, region, type, amenities, context
         FROM camping_spots s
        WHERE missing_since IS NULL
          AND region IS NOT NULL
          -- 🔴 The merged name, not s.name. This asks "can we put this
          -- campsite on the home page", and a campsite named only by
          -- DATAtourisme has a name — it is printed on its own page.
          AND ${mergedNameSql('s')} IS NOT NULL
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
               OR linked.has_stars
               OR linked.has_description) AS indexable
         FROM camping_spots s${linkedSecondariesJoin()}
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
      `SELECT ${mergedNameSql('s')} AS name, country, region, slug,
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

/** Region names carry diacritics and spaces; URLs must not. */
/**
 * `ST_AsGeoJSON` віддає РЯДОК, і це важливо: без розбору він поїхав би на
 * сторінку як текст, а `JSON.stringify` обгорнув би його в лапки — мапа
 * отримала б рядок там, де чекає геометрію, і не намалювала б нічого, не
 * сказавши ані слова.
 *
 * 🔴 Непрочитане значення стає `null`, а не напівфабрикатом: краще не
 * намалювати обрис, ніж намалювати зіпсований.
 */
export function readOutline(value: unknown): GeoJsonPolygon | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'type' in parsed &&
      'coordinates' in parsed &&
      Array.isArray((parsed as { coordinates: unknown }).coordinates)
    ) {
      return parsed as GeoJsonPolygon;
    }
  } catch {
    /* не GeoJSON — мовчимо й не малюємо */
  }
  return null;
}

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
    outline: readOutline(row.outline),
    amenities,
    ownerOverrides: (row.owner_overrides ?? {}) as Record<string, unknown>,
    lastSeenAt: (row.last_seen_at as Date) ?? null,
    // 🔴 CAMP-256. Read from its OWN column and by its own name. `?? null`:
    // a query that did not select it knows nothing about edit dates, and
    // the page must say "not known" rather than print another date.
    osmRecordEditedAt: (row.osm_record_edited_at as Date) ?? null,
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
    warningAreas: Array.isArray(row.warning_areas)
      ? (row.warning_areas as string[])
      : null,
    // 🔴 CAMP-255. A query that did not select the columns reads as
    // `unknown`, which is the true answer about a page that never asked.
    overnight: toOvernightView(row),
    // 🔴 `?? []`, and the default is "no prices", never a partial list.
    // Every query that does not select these columns is a query that
    // knows nothing about prices; the failure must be a page with no
    // price table, not a page with somebody else's.
    tariffs: (row.tariffs ?? []) as TariffView[],
    tariffsWithheld: Number(row.tariffs_withheld ?? 0),
    // 🔴 CAMP-168. `?? null`, and null means exactly one thing: no
    // designated bathing water within BATHING_RADIUS_M of this campsite.
    // It never means "we did not look" — a query that does not select
    // the column produces a page that says there is none nearby, which
    // is a visible, reportable wrong answer rather than a silent one.
    bathingWater: (row.bathing_water as BathingWaterView) ?? null,
    // 🔴 CAMP-164. `?? { kind: 'none' }` says "we hold no station and no
    // model value for this place", which is true of any query that did
    // not select the column — and visible on the page as a sentence, not
    // as a section that quietly vanished.
    airQuality: (row.air_quality as AirQualityFacts) ?? { kind: 'none' },
    // 🔴 `webcams_imported` decides between the two empties. A query
    // that did not select it leaves the column undefined, and the page
    // then says nothing about cameras rather than making a claim — the
    // safe direction, as with `airQuality` above.
    webcams:
      row.webcams_imported === true && Array.isArray(row.webcams)
        ? (row.webcams as WebcamView[])
        : null,
    // 🔴 Defaults to indexable when the column is absent, not to hidden.
    // A query that forgot to select it must not silently noindex a page
    // that has plenty to say — the failure should be a page that ranks
    // when it should not, which somebody notices, rather than a page
    // that quietly disappears, which nobody does.
    indexable: row.indexable !== false,
  };
}
