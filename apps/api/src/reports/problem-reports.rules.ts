// «Report a problem» — the rules a public write endpoint needs, with no Nest
// and no TypeORM in them (the client-errors.rules.ts reason: a rule beside a
// decorated class is a rule this jest setup cannot unit-test).
//
// 🔴 THE POST IS OPEN BY DESIGN. A reader who has spotted that a campsite
// closed last year cannot be asked to make an account first, so there is no
// caller we can trust. Every guard is therefore on this side: what a body may
// contain, how long each piece may be, and (in throttle.ts, bucket `report`)
// how many a caller may send.
//
// 🔴 WHAT IS COLLECTED, SAID IN FULL. Four things and nothing else: which
// campsite (its slug), what kind of problem (from a list), the reader's own
// words, and — ONLY IF THEY CHOOSE — a way to reach them. No IP, no browser
// string, no page timing, no account. There is no lawyer on the project, so
// the shape is the smallest one that still lets a person be answered; a field
// the browser sends that is not in this list is REFUSED (400), not dropped,
// so a later client cannot quietly start sending more than the table was
// meant to hold.

/**
 * The kinds of problem a reader may choose from.
 *
 * 🔴 A LIST, NOT FREE TEXT, because the moderator sorts by it, and because the
 * migration's CHECK constraint names the same seven values: an eighth one
 * added here alone would be accepted by the API and refused by the table.
 * `problem-reports.rules.spec.ts` reads the migration and compares.
 */
export const PROBLEM_KINDS = [
  'closed',
  'wrong_location',
  'wrong_facilities',
  'wrong_price',
  'wrong_name_or_contact',
  'not_a_campsite',
  'other',
] as const;

export type ProblemKind = (typeof PROBLEM_KINDS)[number];

/** What a moderator can set in Directus. The table's CHECK names the same three. */
export const REPORT_STATUSES = ['new', 'resolved', 'dismissed'] as const;

/**
 * Longest text accepted, in characters.
 *
 * Rejected, not truncated — unlike a crash report, this is a person's own
 * words and cutting them in half would keep a sentence they did not write.
 * 2 000 is roughly 300 words: a thorough description of what is wrong fits
 * several times over, and a payload designed to fill a disk does not.
 * A slug in the table is at most 80 characters (measured 30.10.2026 over
 * 63 159 rows); 200 leaves room and still refuses a body used as a bucket.
 */
export const LIMITS = { description: 2000, contact: 200, slug: 200 } as const;

/** Slugs are lower-case ASCII words and hyphens: 63 159 of 63 159 (30.10.2026). */
const SLUG = /^[a-z0-9-]+$/;

/** The only keys a body may carry. Anything else is refused, see above. */
const ALLOWED_KEYS = new Set(['slug', 'kind', 'description', 'contact']);

export type ReportProblem = {
  field: 'body' | 'slug' | 'kind' | 'description' | 'contact';
  code:
    | 'not_an_object'
    | 'unknown_field'
    | 'missing'
    | 'not_text'
    | 'too_long'
    | 'unknown';
  message: string;
};

export type ParsedReport = {
  slug: string;
  kind: ProblemKind;
  description: string;
  /** `null` when the reader left it empty — the normal case, and a valid one. */
  contact: string | null;
};

export type ParseResult =
  { ok: true; report: ParsedReport } | { ok: false; problems: ReportProblem[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Turn an untrusted body into a report, or into the list of what is wrong.
 *
 * 🔴 EVERY PROBLEM AT ONCE, not the first: a page shows them all beside the
 * fields, and a body with three faults answered one at a time is three
 * round trips.
 *
 * 🔴 `contact` IS OPTIONAL AND THAT IS A REQUIREMENT, NOT A DEFAULT. Absent,
 * `null`, or an empty / blank string all mean "no contact", and the report is
 * accepted. The spec's mutation for this file is "make it required" — and
 * `problem-reports.db.spec.ts` posts a report without one and expects a row.
 */
export function parseReport(body: unknown): ParseResult {
  if (!isRecord(body)) {
    return {
      ok: false,
      problems: [
        {
          field: 'body',
          code: 'not_an_object',
          message: 'The request body must be a JSON object.',
        },
      ],
    };
  }

  const problems: ReportProblem[] = [];

  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) {
      problems.push({
        field: 'body',
        code: 'unknown_field',
        message: `Unexpected field "${key}". A report carries slug, kind, description and an optional contact — nothing else.`,
      });
    }
  }

  const slug = text(body.slug);
  if (slug === null || slug === '') {
    problems.push({
      field: 'slug',
      code: 'missing',
      message: 'Which campsite this is about is missing.',
    });
  } else if (slug.length > LIMITS.slug || !SLUG.test(slug)) {
    problems.push({
      field: 'slug',
      code: 'unknown',
      message: 'That is not a campsite address on this site.',
    });
  }

  const kind = text(body.kind);
  if (kind === null || kind === '') {
    problems.push({
      field: 'kind',
      code: 'missing',
      message: 'Choose what kind of problem this is.',
    });
  } else if (!(PROBLEM_KINDS as readonly string[]).includes(kind)) {
    problems.push({
      field: 'kind',
      code: 'unknown',
      message: `"${kind.slice(0, 40)}" is not one of the kinds of problem we take.`,
    });
  }

  const description = text(body.description);
  if (description === null || description === '') {
    problems.push({
      field: 'description',
      code: 'missing',
      message: 'Say what is wrong, in a sentence or two.',
    });
  } else if (description.length > LIMITS.description) {
    problems.push({
      field: 'description',
      code: 'too_long',
      message: `The description is ${description.length} characters; at most ${LIMITS.description} are accepted.`,
    });
  }

  let contact: string | null = null;
  if (body.contact !== undefined && body.contact !== null) {
    const c = text(body.contact);
    if (c === null) {
      problems.push({
        field: 'contact',
        code: 'not_text',
        message: 'The contact must be text, or left empty.',
      });
    } else if (c.length > LIMITS.contact) {
      problems.push({
        field: 'contact',
        code: 'too_long',
        message: `The contact is ${c.length} characters; at most ${LIMITS.contact} are accepted.`,
      });
    } else if (c !== '') {
      contact = c;
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    report: {
      slug: slug as string,
      kind: kind as ProblemKind,
      description: description as string,
      contact,
    },
  };
}

/** A string, trimmed; `null` for anything that is not a string. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim();
}
