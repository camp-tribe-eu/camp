// «Report a problem» — what the campsite page sends when a reader says the
// data is wrong, and how it reads the answer.
//
// 🔴 PURE LOGIC, NO React AND NO NETWORK BY DEFAULT: `fetch` and the API
// address come in as parameters, so everything decided here is tested on
// data — the answers the API really gives — and not on a swapped function.
// The component (components/report-problem.tsx) only joins this to React.
//
// 🔴 WHAT GOES OVER THE WIRE IS BUILT BY `requestBody` AND NOWHERE ELSE: the
// campsite's slug, the kind, the reader's words, and the contact ONLY IF THEY
// TYPED ONE. No browser string, no page URL, no timing, no account — and the
// API refuses a body with a fifth field (`problem-reports.rules.ts`), so a
// later "helpful" addition here is a 400 on the first click, not a column of
// data nobody decided to collect.

/** The API's address from the browser. Empty — no request is made, and the form says so. */
export const REPORT_API = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/**
 * The kinds of problem a reader may choose from.
 *
 * 🔴 A COPY OF `PROBLEM_KINDS` IN apps/api/src/reports/problem-reports.rules.ts
 * — the two packages compile separately, so it cannot be imported. The spec
 * reads the API file and compares, so the two lists cannot drift apart
 * without a red test (the account page does the same with its limits).
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

/** What each kind says in the list. Plain words; the value is what is sent. */
export const KIND_LABEL: Record<ProblemKind, string> = {
  closed: 'The campsite is closed or no longer exists',
  wrong_location: 'The map pin is in the wrong place',
  wrong_facilities: 'The facilities are listed wrongly',
  wrong_price: 'The prices are wrong or out of date',
  wrong_name_or_contact: 'The name, website or phone number is wrong',
  not_a_campsite: 'This is not a campsite',
  other: 'Something else',
};

/** The same limits the API enforces (`LIMITS` in the rules file; the spec compares). */
export const MAX_DESCRIPTION = 2000;
export const MAX_CONTACT = 200;

/**
 * 🔴 WHY THE CONTACT FIELD EXISTS, in the words the reader sees beside it.
 * The card asks for exactly this sentence; it is exported so the spec can
 * assert the page shows it rather than a paraphrase.
 */
export const CONTACT_HINT =
  'Only so we can ask a follow-up question; leave it empty if you prefer.';

export type ReportDraft = {
  kind: ProblemKind | '';
  description: string;
  contact: string;
};

export const EMPTY_DRAFT: ReportDraft = { kind: '', description: '', contact: '' };

export type DraftProblem = {
  field: 'kind' | 'description' | 'contact';
  message: string;
};

/**
 * What the page checks before sending — the same rules as the API, so a
 * reader is told at the field, not by a 400. The server checks again.
 */
export function validateDraft(draft: ReportDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (!(PROBLEM_KINDS as readonly string[]).includes(draft.kind)) {
    problems.push({ field: 'kind', message: 'Choose what kind of problem this is.' });
  }
  const description = draft.description.trim();
  if (description === '') {
    problems.push({
      field: 'description',
      message: 'Say what is wrong, in a sentence or two.',
    });
  } else if (description.length > MAX_DESCRIPTION) {
    problems.push({
      field: 'description',
      message: `That is ${description.length} characters; at most ${MAX_DESCRIPTION} fit.`,
    });
  }
  if (draft.contact.trim().length > MAX_CONTACT) {
    problems.push({
      field: 'contact',
      message: `That is ${draft.contact.trim().length} characters; at most ${MAX_CONTACT} fit.`,
    });
  }
  return problems;
}

export type ReportBody = {
  slug: string;
  kind: ProblemKind;
  description: string;
  contact?: string;
};

/**
 * The body, and nothing else.
 *
 * 🔴 `contact` IS OMITTED, NOT SENT EMPTY, when the reader left it blank:
 * the key is absent from the JSON. The spec asserts on the serialised string.
 */
export function requestBody(slug: string, draft: ReportDraft): ReportBody {
  const body: ReportBody = {
    slug,
    kind: draft.kind as ProblemKind,
    description: draft.description.trim(),
  };
  const contact = draft.contact.trim();
  if (contact !== '') body.contact = contact;
  return body;
}

export type ReportOutcome =
  /** 201: stored. */
  | 'sent'
  /** 400: the server disagreed with the form — should not happen after validateDraft. */
  | 'invalid'
  /** 404: the campsite is not in the API's table (page older than the data). */
  | 'unknown_campsite'
  /** 429: this connection has sent enough for now. */
  | 'throttled'
  /** No API address configured: the form cannot send anything. */
  | 'unavailable'
  /** Network, 5xx, or an answer of the wrong shape. */
  | 'failed';

/** Status → outcome. `status` decides everything; no body is read. */
export function interpret(status: number): ReportOutcome {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 400) return 'invalid';
  if (status === 404) return 'unknown_campsite';
  if (status === 429) return 'throttled';
  return 'failed';
}

/** What each outcome says to the reader. One place, so tests and the page read the same. */
export function messageFor(outcome: ReportOutcome): string {
  switch (outcome) {
    case 'sent':
      return 'Thank you. We have your report and will look into it.';
    case 'invalid':
      return 'The form was not accepted. Check the fields and try again.';
    case 'unknown_campsite':
      return 'This campsite is no longer in our data, so there is nothing to correct. Thank you anyway.';
    case 'throttled':
      return 'Enough reports from this connection for now. Try again in a few minutes.';
    case 'unavailable':
      return 'Reporting is not available right now. Nothing was sent.';
    case 'failed':
      return 'We could not send that. Nothing was saved — try again in a moment.';
  }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Send one report.
 *
 * 🔴 AN EMPTY API ADDRESS SENDS NOTHING — `fetchImpl` is never called, and the
 * outcome says so. The CI build has no address; a form that tried would send
 * a person's words to a host that does not exist and show them "thank you".
 * No credentials, no cookies: `credentials: 'omit'`, said rather than left to
 * the default, because a reader's session must not travel with a report.
 */
export async function sendReport(
  body: ReportBody,
  api: string = REPORT_API,
  fetchImpl: Fetch = (i, init) => fetch(i, init),
): Promise<ReportOutcome> {
  if (api === '') return 'unavailable';
  try {
    const res = await fetchImpl(`${api}/problem-reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify(body),
    });
    return interpret(res.status);
  } catch {
    return 'failed';
  }
}
