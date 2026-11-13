import {
  Controller,
  Get,
  Header,
  Headers,
  NotFoundException,
} from '@nestjs/common';
import { BUILD_TOKEN_HEADER } from '../throttle';
import type { Report } from './data-quality';
import { mayReadQuality } from './data-quality.access';
import { DataQualityService } from './data-quality.service';

/**
 * CAMP-522 — `GET /ops/data-quality`, for `/internal/data-quality` on
 * the site and for nobody else.
 *
 * 🔴 404, NOT 401/403. A caller without the token is told what any
 * caller of a route that does not exist is told.
 */
@Controller('ops/data-quality')
export class DataQualityController {
  constructor(private readonly quality: DataQualityService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async get(
    @Headers(BUILD_TOKEN_HEADER) token: string | undefined,
  ): Promise<Report> {
    if (!mayReadQuality(token)) throw new NotFoundException();
    return this.quality.report();
  }
}
