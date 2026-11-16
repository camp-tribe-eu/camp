import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { readPoint } from './bucket';
import { ForecastCache, type ForecastAnswer } from './cache';
import type { ForecastQuery } from './forecast';

@Injectable()
export class ForecastService {
  private readonly log = new Logger(ForecastService.name);
  private readonly cache = new ForecastCache({
    read: (lat, lon, nowSec) => readPoint(lat, lon, nowSec),
    now: () => Date.now(),
  });

  async forecast(q: ForecastQuery): Promise<ForecastAnswer> {
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
