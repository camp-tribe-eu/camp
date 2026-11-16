import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import { parseQuery } from './forecast';
import { ForecastService } from './forecast.service';

@Controller('forecast')
export class ForecastController {
  constructor(private readonly forecast: ForecastService) {}

  /**
   * CAMP-477: seven days for one campsite.
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
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('country') country?: string,
  ) {
    const q = parseQuery({ lat, lng, country });
    if (!q) {
      throw new BadRequestException(
        'lat, lng and country: a point inside the EU-27 and its code',
      );
    }
    const answer = await this.forecast.forecast(q);
    res.setHeader('Cache-Control', 'public, max-age=900');
    return answer;
  }
}
