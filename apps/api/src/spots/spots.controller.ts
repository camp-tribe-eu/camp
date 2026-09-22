import { Controller, Get, Param, Query } from '@nestjs/common';
import { SpotsService } from './spots.service';

@Controller('spots')
export class SpotsController {
  constructor(private readonly spots: SpotsService) {}

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
