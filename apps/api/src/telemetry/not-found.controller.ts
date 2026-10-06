import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BULK_LIMIT } from '../throttle';
import { NotFoundService, REPORT_DAYS } from './not-found.service';

const BULK = { default: BULK_LIMIT };

// CAMP-235 — the register of broken links.
@Controller('not-found')
export class NotFoundController {
  constructor(private readonly service: NotFoundService) {}

  /**
   * Record one miss.
   *
   * 🔴 202, and no body. The caller is a 404 page being rendered; it has
   * nothing to do with the answer and must not wait on it or fail
   * because of it. The neighbouring client-errors endpoint answers the
   * same way for the same reason.
   */
  @Post()
  @HttpCode(202)
  async record(@Body() body: Record<string, unknown>) {
    await this.service.record(body?.path, body?.referrer);
  }

  /**
   * The report: which dead paths are still being asked for.
   *
   * 🔴 Bulk-limited. It is a grouped scan over a window, it is read by a
   * person once a week, and the ordinary 120-a-minute budget is for
   * routes a reader hits.
   */
  @Get('worst')
  @Throttle(BULK)
  worst(@Query('days') days?: string) {
    const n = Number(days);
    return this.service.worstPaths(
      Number.isFinite(n) && n > 0 && n <= 90 ? Math.floor(n) : REPORT_DAYS,
    );
  }
}
