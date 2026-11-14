import { apiFetch } from './api';

// CAMP-522 — the data-quality report, as the internal page reads it.
//
// 🔴 THE PAGE HOLDS NO NUMBER OF ITS OWN. Every figure it prints, the
// population it is a share of, and the query that produced both arrive
// in one answer from `GET /ops/data-quality` (apps/api/src/ops/
// data-quality.ts), measured in one read-only snapshot. Nothing here
// computes, rounds up, or fills in.
//
// 🔴 AN ANSWER WE CANNOT READ IS NOT A REPORT. `readDataQuality` checks
// the shape field by field and returns `null` on anything else — it does
// not cast. A cast would print `undefined of undefined` the day the API
// renames a field, and a dashboard about trust is the last place for it.

export type QualityLine = {
  key: string;
  group: string;
  /** `null` for a measure with one line; the line's name in a breakdown. */
  label: string | null;
  what: string;
  ofWhat: string;
  n: number;
  of: number;
  sql: string;
};

export type QualityFailure = {
  key: string;
  group: string;
  what: string;
  sql: string;
  error: string;
};

export type QualityGap = {
  key: string;
  group: string;
  what: string;
  why: string;
};

export type QualityReport = {
  measuredAt: string;
  database: string;
  groups: [string, string][];
  lines: QualityLine[];
  failures: QualityFailure[];
  notMeasured: QualityGap[];
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

const texts = (o: Record<string, unknown>, keys: string[]): boolean =>
  keys.every((k) => isText(o[k]));

/** The API's answer as a report, or `null` when it is anything else. */
export function readDataQuality(json: unknown): QualityReport | null {
  if (!isRecord(json)) return null;
  const { measuredAt, database, groups, lines, failures, notMeasured } = json;
  if (!isText(measuredAt) || Number.isNaN(Date.parse(measuredAt))) return null;
  if (!isText(database)) return null;
  if (!Array.isArray(groups) || !Array.isArray(lines)) return null;
  if (!Array.isArray(failures) || !Array.isArray(notMeasured)) return null;

  for (const g of groups) {
    if (!Array.isArray(g) || g.length !== 2 || !isText(g[0]) || !isText(g[1])) {
      return null;
    }
  }
  for (const l of lines) {
    if (!isRecord(l)) return null;
    if (!texts(l, ['key', 'group', 'what', 'ofWhat', 'sql'])) return null;
    if (l.label !== null && !isText(l.label)) return null;
    if (!isCount(l.n) || !isCount(l.of)) return null;
  }
  for (const f of failures) {
    if (!isRecord(f) || !texts(f, ['key', 'group', 'what', 'sql', 'error'])) {
      return null;
    }
  }
  for (const x of notMeasured) {
    if (!isRecord(x) || !texts(x, ['key', 'group', 'what', 'why'])) return null;
  }
  // 🔴 A line under a heading the report does not carry would be dropped
  // by the page without a word. Refuse the whole answer instead.
  const known = new Set((groups as [string, string][]).map((g) => g[0]));
  for (const x of [...lines, ...failures, ...notMeasured] as { group: string }[]) {
    if (!known.has(x.group)) return null;
  }
  return json as unknown as QualityReport;
}

export type QualityAnswer =
  | { report: QualityReport; why?: undefined }
  | { report?: undefined; why: string };

/**
 * The report, or the reason there is none.
 *
 * 🔴 NEVER AN EMPTY REPORT. `getSummary` answers zeros when the API
 * fails, which suits a hero with an empty state. Here a zero is a claim
 * ("no duplicates"), so a failure is returned as a failure and the page
 * says so in words.
 *
 * `no-store`: the API keeps one measurement for ten minutes itself, and
 * a second cache in front of it would only make "measured at" lie about
 * how old the page is.
 */
export async function getDataQuality(): Promise<QualityAnswer> {
  let res: Response;
  try {
    res = await apiFetch('/ops/data-quality', { cache: 'no-store' });
  } catch {
    return { why: 'The API did not answer.' };
  }
  if (!res.ok) {
    return { why: `The API answered ${res.status} to the request for the report.` };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { why: 'The API answered with something that is not JSON.' };
  }
  const report = readDataQuality(json);
  return report
    ? { report }
    : { why: 'The API answered with a report this page cannot read.' };
}

/** `52645` → `52,645`. */
export const count = (n: number): string => n.toLocaleString('en-GB');

/**
 * `n` of `of` as a percentage, or `null` when there is nothing to divide by.
 *
 * 🔴 `null`, not `0%`. "0 of 0 pairs disagree" is not "no pair
 * disagrees": there was no pair to ask.
 */
export function share(n: number, of: number): string | null {
  return of > 0 ? `${((100 * n) / of).toFixed(1)}%` : null;
}

/** `2026-11-13T11:13:05Z` → `13 November 2026, 11:13 UTC`. */
export function measuredOn(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  return `${day}, ${time} UTC`;
}
