// CAMP-391: what `POST /plan` accepts, and every way it says no.
//
//   { "from": { "lat": 46.0569, "lon": 14.5058 },
//     "to":   { "lat": 43.5081, "lon": 16.4402 },
//     "days": 7 }
//
// 🔴 PURE, AND NO NEST IN IT. The checks are a function of one value, so a
// spec can hand it every shape a stranger's client can send without booting a
// server, and the controller is left with nothing to decide.
//
// 🔴 THE CHECK RUNS ON THE SERVER BECAUSE THE BROWSER'S ONE IS A COURTESY. The
// form (apps/web/src/lib/plan.ts) checks the same things first so a person is
// told at once; anything that is not the form — a script, a typo in a link, a
// future client — reaches this and gets the same answer. The two lists are
// kept in step by a spec on each side that reads the numbers, not by this
// comment.
//
// 🔴 STRICT, AND THE REASON IS A PROMISE. A field the planner does not read is
// a field a caller will believe it read. The first form of this page also
// asked for a vehicle; the algorithm has no use for one (there is no data on
// pitch sizes, CAMP-247), so a request that names a `vehicleId` is refused as
// an unknown field rather than answered as if the plan had been made for it.
// Same rule as `validateRequest` applies to an amenity nobody records: a typo
// that filters nothing looks exactly like a filter that works.
//
// 🔴 COORDINATES ARE NAMED, NOT ORDERED. GeoJSON — and everything under
// `planner/` — writes `[lon, lat]`; people, and every map's "copy
// coordinates", write latitude first. A pair has no way to say which it is, so
// there is no pair here: `{ lat, lon }`, and a number that would be a latitude
// only the other way round (a `lat` of 120) is refused as out of range
// instead of being planned from somewhere else.
//
// 🔴 NUMBERS ARE NUMBERS. `"7"` and `"46.05"` are strings and are refused:
// JSON has a number type, and a client that sends text where the API says
// number is a client with a bug that should hear about it, not one that
// should be quietly fixed — the next client's `"7 "` would not be.
//
// Whether a point is INSIDE THE UNION is not decided here: it needs the
// boundary table, so it is `PlanService`'s question, answered with the same
// `PlanProblem` shape.

import { MAX_DAYS } from '../planner/itinerary';

/** Where a trip starts or ends. Degrees, WGS84. */
export interface PlanPoint {
  lat: number;
  lon: number;
}

/** A request that passed. The only thing the planner is asked. */
export interface PlanRequest {
  from: PlanPoint;
  to: PlanPoint;
  /** Whole days, 1 to MAX_DAYS. D−1 nights between the two points. */
  days: number;
}

/**
 * Which part of the request a problem is about. `body` is the request as a
 * whole; the rest are the keys a caller wrote.
 */
export type PlanField =
  | 'body'
  | 'from'
  | 'from.lat'
  | 'from.lon'
  | 'to'
  | 'to.lat'
  | 'to.lon'
  | 'days';

/**
 * One word per way a request can be wrong — a caller branches on the word,
 * never on the sentence.
 */
export type PlanProblemCode =
  | 'not_an_object'
  | 'unknown_field'
  | 'missing'
  | 'not_a_number'
  | 'out_of_range'
  | 'not_whole_days'
  | 'days_out_of_range'
  | 'outside_union';

export interface PlanProblem {
  field: PlanField;
  code: PlanProblemCode;
  /** For a person. Says what is wrong and what would be right. */
  message: string;
}

export type ParsedPlanRequest =
  { ok: true; request: PlanRequest } | { ok: false; problems: PlanProblem[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const KEYS = ['from', 'to', 'days'] as const;
const POINT_KEYS = ['lat', 'lon'] as const;

/** The sentence for a point that lies outside the Union. One place, two callers. */
export const OUTSIDE_UNION_MESSAGE =
  'This point is outside the European Union (the 27 member states), which is where the planner works.';

export function outsideUnion(field: 'from' | 'to'): PlanProblem {
  return { field, code: 'outside_union', message: OUTSIDE_UNION_MESSAGE };
}

function readPoint(
  value: unknown,
  field: 'from' | 'to',
  problems: PlanProblem[],
): PlanPoint | undefined {
  if (value === undefined) {
    problems.push({
      field,
      code: 'missing',
      message: `\`${field}\` is required: { "lat": …, "lon": … } in degrees.`,
    });
    return undefined;
  }
  if (!isRecord(value)) {
    problems.push({
      field,
      code: 'not_an_object',
      message: `\`${field}\` must be an object { "lat": …, "lon": … } in degrees.`,
    });
    return undefined;
  }
  let ok = true;
  for (const key of Object.keys(value)) {
    if (!(POINT_KEYS as readonly string[]).includes(key)) {
      problems.push({
        field,
        code: 'unknown_field',
        message: `\`${field}.${key}\` is not something the planner reads; a point is \`lat\` and \`lon\`.`,
      });
      ok = false;
    }
  }
  const out: Partial<PlanPoint> = {};
  for (const key of POINT_KEYS) {
    const at = `${field}.${key}` as PlanField;
    const v = value[key];
    if (v === undefined) {
      problems.push({
        field: at,
        code: 'missing',
        message: `\`${at}\` is required, in degrees.`,
      });
      ok = false;
    } else if (!isNumber(v)) {
      problems.push({
        field: at,
        code: 'not_a_number',
        message: `\`${at}\` must be a number in degrees, not text.`,
      });
      ok = false;
    } else {
      const limit = key === 'lat' ? 90 : 180;
      if (Math.abs(v) > limit) {
        problems.push({
          field: at,
          code: 'out_of_range',
          message: `\`${at}\` must be between -${limit} and ${limit} degrees.`,
        });
        ok = false;
      } else {
        out[key] = v;
      }
    }
  }
  return ok ? (out as PlanPoint) : undefined;
}

/**
 * Everything wrong with a body, all at once, or the request it describes.
 *
 * 🔴 ALL AT ONCE, in the order the form shows its fields (`from`, `to`,
 * `days`): a caller with three mistakes learns of three, not of one per
 * round trip. And it never throws on what it is given — the body of an HTTP
 * request is whatever a stranger typed.
 */
export function parsePlanRequest(body: unknown): ParsedPlanRequest {
  if (!isRecord(body)) {
    return {
      ok: false,
      problems: [
        {
          field: 'body',
          code: 'not_an_object',
          message:
            'Send a JSON object: { "from": { "lat": …, "lon": … }, "to": { "lat": …, "lon": … }, "days": 7 }.',
        },
      ],
    };
  }

  const problems: PlanProblem[] = [];

  for (const key of Object.keys(body)) {
    if (!(KEYS as readonly string[]).includes(key)) {
      problems.push({
        field: 'body',
        code: 'unknown_field',
        message: `\`${key}\` is not something the planner reads; it takes \`from\`, \`to\` and \`days\`.`,
      });
    }
  }

  const from = readPoint(body.from, 'from', problems);
  const to = readPoint(body.to, 'to', problems);

  let days: number | undefined;
  const rawDays = body.days;
  if (rawDays === undefined) {
    problems.push({
      field: 'days',
      code: 'missing',
      message: `\`days\` is required: a whole number from 1 to ${MAX_DAYS}.`,
    });
  } else if (!isNumber(rawDays) || !Number.isInteger(rawDays)) {
    problems.push({
      field: 'days',
      code: isNumber(rawDays) ? 'not_whole_days' : 'not_a_number',
      message: `\`days\` must be a whole number from 1 to ${MAX_DAYS}.`,
    });
  } else if (rawDays < 1 || rawDays > MAX_DAYS) {
    problems.push({
      field: 'days',
      code: 'days_out_of_range',
      message: `\`days\` must be between 1 and ${MAX_DAYS}.`,
    });
  } else {
    days = rawDays;
  }

  if (problems.length > 0 || !from || !to || days === undefined) {
    return { ok: false, problems };
  }
  return { ok: true, request: { from, to, days } };
}
