import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import {
  ClientErrorsService,
  type IncomingReport,
} from './client-errors.service';

// CAMP-92 — the endpoint a broken page talks to.
//
// 🔴 The POST is open, and has to be: a browser that has just thrown
// cannot authenticate, and every visitor is anonymous. Everything that
// makes that safe lives in the service — validation, truncation and a
// rate limit keyed on the fingerprint rather than on an IP we refuse to
// store.
//
// 🔴 The GET is NOT open, and this is the asymmetry that matters. Stack
// traces name our files, our functions and our dependency versions. An
// endpoint that hands those to anybody who asks is a reconnaissance
// tool, and it would be one we built ourselves, on a public repo where
// the route name is readable. So reads need a token, and with no token
// configured the route does not exist at all — closed by default, the
// same rule as CORS in main.ts.

@Controller('client-errors')
export class ClientErrorsController {
  constructor(private readonly service: ClientErrorsService) {}

  @Post()
  // 202, not 201: we are accepting a report, and whether it was stored,
  // deduplicated or throttled is not the browser's business — and must
  // not be, or the answer becomes a way to probe what is stored.
  @HttpCode(202)
  async report(@Body() body: IncomingReport): Promise<{ ok: true }> {
    await this.service.accept(body ?? {});
    return { ok: true };
  }

  @Get()
  async recent(
    @Headers('x-error-token') token: string | undefined,
    @Query('limit') limit?: string,
  ) {
    const expected = process.env.CLIENT_ERRORS_READ_TOKEN ?? '';
    // 🔴 404 rather than 401. A 401 confirms the route exists and that
    // there is something behind it worth guarding; a 404 says nothing.
    if (expected === '' || token !== expected) throw new NotFoundException();

    const n = Number.parseInt(limit ?? '50', 10);
    const rows = await this.service.recent(Number.isFinite(n) ? n : 50);
    return { count: rows.length, errors: rows };
  }
}
