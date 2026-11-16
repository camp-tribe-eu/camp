import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { parseSlug } from './forecast';
import { ForecastService } from './forecast.service';

@Controller('forecast')
export class ForecastController {
  constructor(private readonly forecast: ForecastService) {}

  /**
   * CAMP-477: up to seven days for one campsite, named by its slug.
   *
   * 🔴 THE PAGE IS STATIC AND THIS ROUTE IS WHY A FORECAST CAN BE ON IT.
   * A forecast in the built HTML would be as old as the build. The browser
   * asks OUR server, which reads Open-Meteo's public bucket on AWS; the
   * reader's browser never talks to Open-Meteo or Amazon, so neither
   * receives the reader's address.
   *
   * 🔴 `max-age=900` ON AN ANSWER ONLY. A decorator would put it on the
   * 400 and the 503 too, and a browser or edge would then keep "there is
   * no forecast" for a quarter of an hour after one bad second. An error
   * carries no Cache-Control at all.
   */
  @Get()
  async one(
    @Res({ passthrough: true }) res: Response,
    @Query('slug') slug?: string,
  ) {
    const s = parseSlug(slug);
    if (!s) throw new BadRequestException('slug: the campsite slug');
    const answer = await this.forecast.forecast(s);
    res.setHeader('Cache-Control', 'public, max-age=900');
    return answer;
  }
}
