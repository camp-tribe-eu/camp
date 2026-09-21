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
