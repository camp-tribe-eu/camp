import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { REPORT_LIMIT } from '../throttle';
import { parseReport, type ReportProblem } from './problem-reports.rules';
import { ProblemReportsService } from './problem-reports.service';

// 🔴 Its own bucket: REPORT_LIMIT sets the number, `REPORT_ROUTES` in
// throttle.ts sets the counter, and throttle.spec.ts reads this file to check
// the two agree — the CAMP-176 comparison, for a sixth route kind.
const REPORT = { default: REPORT_LIMIT };

/** The same `{ code, message, errors }` shape as `POST /plan` refusals. */
function invalid(problems: ReportProblem[]): HttpException {
  return new HttpException(
    {
      code: 'invalid_report',
      message:
        problems.length === 1
          ? problems[0].message
          : `${problems.length} things are wrong with this report; see \`errors\`.`,
      errors: problems,
    },
    400,
  );
}

/**
 * «Report a problem» — the endpoint the campsite page's form talks to.
 *
 * 🔴 OPEN TO ANYONE, and it has to be: the person who knows a campsite closed
 * is a passer-by, not an account holder. What makes that safe is all on this
 * side — the body is parsed by `parseReport` (four fields, bounded, nothing
 * else), the campsite must exist, and one caller gets REPORT_LIMIT reports
 * per window (throttle.ts says how many and why).
 *
 * 🔴 THERE IS NO GET. A report may carry a person's contact; a route that
 * listed reports would hand those to anyone who found it. Reading is done in
 * Directus, by a signed-in moderator, against the table directly.
 *
 *   POST /problem-reports
 *   { "slug": "camping-du-lac", "kind": "closed",
 *     "description": "Closed since 2024, the gate is chained.",
 *     "contact": "optional — an email, a phone, or nothing" }
 *
 *   201 { ok: true }                 stored
 *   400 { code: 'invalid_report', errors: [{ field, code, message }] }
 *   404 { code: 'unknown_campsite' } no campsite with that slug; nothing stored
 *   429                              the `report` bucket is spent
 */
@Controller('problem-reports')
export class ProblemReportsController {
  constructor(private readonly reports: ProblemReportsService) {}

  @Post()
  @HttpCode(201)
  @Throttle(REPORT)
  async report(@Body() body: unknown): Promise<{ ok: true }> {
    const parsed = parseReport(body);
    // `=== false`, not `!ok`: this package builds without strictNullChecks.
    if (parsed.ok === false) throw invalid(parsed.problems);
    const result = await this.reports.accept(parsed.report);
    if (result.outcome === 'unknown_campsite') {
      throw new HttpException(
        {
          code: 'unknown_campsite',
          message: 'There is no campsite at that address on this site.',
        },
        404,
      );
    }
    return { ok: true };
  }
}
