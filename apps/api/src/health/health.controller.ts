import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';
import { statusCode } from './health.rules';

// CAMP-59: the one route an uptime monitor is meant to call.
//
// 🔴 It returns a STATUS CODE that means something, because that is all
// a free uptime monitor reads. 503 when we cannot serve, 200 otherwise —
// and the body says which check failed, for the person who then opens it.
//
// 🔴 What is deliberately NOT here. The API is public and unauthenticated,
// so this endpoint says nothing an attacker can use: no versions of our
// own software, no hostnames, no connection strings, no row contents, no
// stack traces. Counts and sentences. PostGIS's version is named because
// it is already visible in any spatial error message and because knowing
// the extension answered is the point of the check.
//
// 🔴 And it is exempt from rate limiting (throttle.ts). A monitor polling
// every minute is the one caller we WANT hitting us constantly, and an
// exemption for a route that did not exist was removed in CAMP-69 with a
// note saying it comes back when this card adds a real one. It has.

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async get(@Res() res: Response): Promise<void> {
    const report = await this.health.report();
    res
      .status(statusCode(report.status))
      // No caching: a cached health check is a health check of the past,
      // and the whole question is about now.
      .header('Cache-Control', 'no-store')
      .json(report);
  }
}
