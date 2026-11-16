import {
  Injectable,
  NotFoundException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { readPoint } from './bucket';
import { ForecastCache, type ForecastAnswer } from './cache';

@Injectable()
export class ForecastService {
  private readonly log = new Logger(ForecastService.name);
  private readonly cache = new ForecastCache({
    read: (lat, lon, nowSec) => readPoint(lat, lon, nowSec),
    now: () => Date.now(),
  });

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /**
   * The forecast for one campsite, found by its slug. The point comes from
   * our own table: see `parseSlug` for why.
   */
  async forecast(slug: string): Promise<ForecastAnswer> {
    const rows: Array<{ lat: number; lon: number; country: string }> =
      await this.db.query(
        `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon,
                country FROM camping_spots WHERE slug = $1`,
        [slug],
      );
    if (rows.length === 0) throw new NotFoundException('no such campsite');
    const q = {
      lat: Number(rows[0].lat),
      lon: Number(rows[0].lon),
      country: String(rows[0].country).toLowerCase(),
    };
    try {
      const a = await this.cache.forecast(q);
      if (a) return a;
    } catch (e) {
      // The name, not the message: an upstream error can carry a URL.
      this.log.warn(`forecast read failed: ${(e as Error).name}`);
    }
    // No data, no section: the page treats this as "show nothing".
    throw new ServiceUnavailableException('forecast is not available');
  }
}
