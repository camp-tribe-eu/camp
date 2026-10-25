import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PLAN_LIMIT } from '../throttle';
import { parsePlanRequest, type PlanProblem } from './plan-request';
import type { PlanResponse } from './plan-response';
import { PlanService, PlanTimedOut } from './plan.service';

// 🔴 Its own bucket: PLAN_LIMIT sets the number, `PLAN_ROUTES` in throttle.ts
// sets the counter, and throttle.spec.ts reads this file to check the two
// agree — the CAMP-176 comparison, for a fifth route kind.
const PLAN = { default: PLAN_LIMIT };

/**
 * One body shape for every refusal of the input — `{ code, message, errors }`,
 * the `{ code, message }` of the account routes with the list of what is wrong
 * added — so a page branches on `code` and `errors[].code` and never on prose.
 */
export function invalid(problems: PlanProblem[]): HttpException {
  return new HttpException(
    {
      code: 'invalid_plan_request',
      message:
        problems.length === 1
          ? problems[0].message
          : `${problems.length} things are wrong with this request; see \`errors\`.`,
      errors: problems,
    },
    400,
  );
}

// CAMP-391: the HTTP entry to the planner (CAMP-46).
//
// 🔴 A POST, THOUGH IT CHANGES NOTHING, and the reason is the input: two
// coordinate pairs are a trip's start and end, which is somewhere a person
// plans to be. In a query string they go into every access log, every proxy's
// log and the browser's history; in a body they go nowhere but this process.
// The transaction is read-only (plan.service.ts), so the route stores nothing
// either — and answers 200, not 201, because nothing was created.
@Controller('plan')
export class PlanController {
  constructor(private readonly plans: PlanService) {}

  /**
   *   POST /plan
   *   { "from": { "lat": 46.0569, "lon": 14.5058 },
   *     "to":   { "lat": 43.5081, "lon": 16.4402 }, "days": 7 }
   *
   * 🔴 THREE KINDS OF ANSWER, AND NONE OF THEM IS A 500 FOR THE CALLER'S
   * MISTAKE.
   *   · 400 — the input is not a question: `{ code: 'invalid_plan_request',
   *     errors: [{ field, code, message }] }`. Every problem at once.
   *   · 200 — the planner answered. `status` is `ok`, or a REFUSAL that is an
   *     answer in its own right: `infeasible` (the campsites do not chain
   *     across the corridor) and `unsupported` (A and B are one place). A
   *     trip across open water is not an error; it is "no chain of campsites".
   *   · 429 — the PLAN bucket is spent (throttle.ts).
   * Anything else is ours: 503 when Postgres cancelled a statement, 500 for a
   * bug — with Nest's own body, which carries no stack and no SQL.
   */
  @Post()
  @HttpCode(200)
  @Throttle(PLAN)
  async plan(@Body() body: unknown): Promise<PlanResponse> {
    const parsed = parsePlanRequest(body);
    // `=== false`, not `!ok`: this package builds without strictNullChecks, where
    // only a comparison narrows a union on a boolean.
    if (parsed.ok === false) throw invalid(parsed.problems);
    try {
      const result = await this.plans.plan(parsed.request);
      if (result.ok === false) throw invalid(result.problems);
      return result.response;
    } catch (err) {
      if (err instanceof PlanTimedOut) {
        throw new HttpException(
          {
            code: 'planner_busy',
            message:
              'The planner could not finish this trip in time. Nothing was lost; try again in a moment.',
          },
          503,
        );
      }
      throw err;
    }
  }
}
