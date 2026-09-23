import { Controller, Get, Param, Query } from '@nestjs/common';
import { SpotsService } from './spots.service';
import { MapQueryService, parseBbox, parseFilters } from './map.service';

@Controller('spots')
export class SpotsController {
  constructor(
    private readonly spots: SpotsService,
    private readonly map: MapQueryService,
  ) {}

  // CAMP-32. 🔴 Both map routes are declared here, above every route with
  // a `:country` segment. Nest matches in declaration order, so moving
  // them below would make "map" a country and answer these with an empty
  // region listing and a 200 — a failure that looks like no data.

  /**
   * Campsites under the viewport. The client asks for this only once the
   * window is small enough that the answer is drawable; `truncated` says
   * when it guessed wrong and should go back to clusters.
   */
  /**
   * CAMP-35 / CAMP-25: `types`, `amenities` and `unknown` narrow both map
   * routes. They are read with `@Query()` as a whole object and handed to
   * `parseFilters`, which keeps only values this codebase defines — so an
   * old bookmark naming an amenity we have renamed still draws the map
   * instead of erroring, and nothing a caller invents reaches the SQL.
   */
  @Get('map/points')
  points(@Query() query: Record<string, string>) {
    return this.map.points(parseBbox(query.bbox), parseFilters(query));
  }

  /** Counts per grid cell, for a viewport too wide to draw point by point. */
  @Get('map/clusters')
  clusters(@Query() query: Record<string, string>) {
    return this.map.clusters(parseBbox(query.bbox), parseFilters(query));
  }

  /**
   * Everything the sitemap (CAMP-39) and static generation need, in one
   * call. Deliberately before the `:country/:region/:slug` route: Nest
   * matches in declaration order, and otherwise "index" would be read as
   * a country.
   */
  @Get('index')
  index() {
    return this.spots.allPublishable();
  }

  /** CAMP-67: the documents the static search index is built from. */
  @Get('search-index')
  searchIndex() {
    return this.spots.searchDocuments();
  }

  /** CAMP-41: real totals for the home page — never a rounded promise. */
  @Get('summary')
  summary() {
    return this.spots.summary();
  }

  /** CAMP-41: the campsites we know most about. */
  @Get('notable')
  notable() {
    return this.spots.notable();
  }

  /**
   * CAMP-73: campsites whose URL should now answer 410, and the nearest
   * live one to offer instead. Declared above the `:country` routes for
   * the same reason as the map ones.
   */
  @Get('gone')
  gone() {
    return this.spots.gone();
  }

  /** CAMP-71: countries for /camping. */
  @Get('countries')
  countries() {
    return this.spots.countries();
  }

  /** CAMP-71: regions of one country, thin ones included. */
  @Get(':country/regions')
  regions(@Param('country') country: string) {
    return this.spots.regions(country);
  }

  @Get(':country/:region')
  region(
    @Param('country') country: string,
    @Param('region') region: string,
    @Query('page') page?: string,
  ) {
    const n = Number(page);
    return this.spots.regionSpots(
      country,
      region,
      Number.isFinite(n) && n > 0 ? Math.floor(n) : 1,
    );
  }

  @Get(':country/:region/:slug')
  async one(
    @Param('country') country: string,
    @Param('region') region: string,
    @Param('slug') slug: string,
    @Query('nearby') nearby?: string,
  ) {
    const spot = await this.spots.findBySlug(country, region, slug);
    return {
      spot,
      nearby: nearby === '0' ? [] : await this.spots.nearby(slug),
    };
  }
}
