import {
  count,
  measuredOn,
  share,
  type QualityFailure,
  type QualityGap,
  type QualityLine,
  type QualityReport,
} from '@/lib/data-quality';

/**
 * CAMP-522 — the data-quality report as a page.
 *
 * 🔴 THREE THINGS STAND BESIDE EVERY NUMBER, in the same block: what one
 * counted thing is, the population it is a share of, and the query that
 * produced both. The card's test is "swap the query, the number changes
 * and it shows" — so the query is on the page in full, not behind a
 * link, and it is the text the API ran, not a description of it.
 *
 * 🔴 NOTHING IS DRAWN EMPTY. A measure that failed is printed as a
 * failure, with the database's words; a question no column answers is
 * printed as "not measured", with the reason; a share over an empty
 * population is "nothing to divide by". None of them is a zero.
 *
 * A measure broken down (by source, by licence, by attribute) is one
 * block: its lines share the definition and the query, so those are
 * printed once, under the lines.
 */

type Measure = { key: string; lines: QualityLine[] };

/** Lines of one group, gathered per measure, in the order they arrived. */
function measuresOf(lines: QualityLine[]): Measure[] {
  const out: Measure[] = [];
  for (const line of lines) {
    const last = out.at(-1);
    if (last && last.key === line.key) last.lines.push(line);
    else out.push({ key: line.key, lines: [line] });
  }
  return out;
}

function Query({ sql }: { sql: string }) {
  return (
    <pre
      data-part="query"
      className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface p-3 text-xs text-ink-2"
    >
      <code>{sql}</code>
    </pre>
  );
}

function Figure({ line }: { line: QualityLine }) {
  const pct = share(line.n, line.of);
  return (
    <tr className="border-b border-line align-baseline" data-part="line">
      {line.label !== null && (
        <th scope="row" className="py-2 pr-4 text-left font-normal" data-part="label">
          {line.label}
        </th>
      )}
      <td className="py-2 pr-4 text-right text-lg text-heading tabular-nums" data-part="n">
        {count(line.n)}
      </td>
      <td className="py-2 pr-4 text-right tabular-nums text-ink-2" data-part="of">
        of {count(line.of)}
      </td>
      <td className="py-2 text-right tabular-nums" data-part="share">
        {pct ?? 'nothing to divide by'}
      </td>
    </tr>
  );
}

function MeasureBlock({ measure }: { measure: Measure }) {
  const first = measure.lines[0];
  const broken = first.label !== null;
  return (
    <article
      className="mt-6 rounded-lg border border-line-2 p-4"
      data-measure={measure.key}
    >
      <h3 className="text-base text-heading">{first.what}</h3>
      <p className="mt-1 text-sm text-ink-2" data-part="population">
        Out of: {first.ofWhat}.
      </p>
      <table className="mt-3 w-full max-w-2xl border-collapse text-sm">
        <thead>
          <tr className="border-b border-line-2 text-ink-2">
            {broken && (
              <th scope="col" className="py-1 pr-4 text-left font-normal">
                Line
              </th>
            )}
            <th scope="col" className="py-1 pr-4 text-right font-normal">
              Count
            </th>
            <th scope="col" className="py-1 pr-4 text-right font-normal">
              Population
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {measure.lines.map((line) => (
            <Figure key={`${line.key}/${line.label ?? ''}`} line={line} />
          ))}
        </tbody>
      </table>
      <Query sql={first.sql} />
    </article>
  );
}

function FailureBlock({ failure }: { failure: QualityFailure }) {
  return (
    <article
      className="mt-6 rounded-lg border border-line-2 p-4"
      data-failed={failure.key}
    >
      <h3 className="text-base text-heading">{failure.what}</h3>
      <p className="mt-2 text-sm">
        <strong>No figure.</strong> The query failed, and the database said:{' '}
        <span data-part="error">{failure.error}</span>
      </p>
      <Query sql={failure.sql} />
    </article>
  );
}

function GapBlock({ gap }: { gap: QualityGap }) {
  return (
    <article
      className="mt-6 rounded-lg border border-dashed border-line-2 p-4"
      data-gap={gap.key}
    >
      <h3 className="text-base text-heading">{gap.what}</h3>
      <p className="mt-2 text-sm text-ink-2">{gap.why}</p>
    </article>
  );
}

export function DataQualityView({ report }: { report: QualityReport }) {
  return (
    <div data-testid="data-quality">
      <p className="mt-2 text-sm text-ink-2" data-part="measured">
        Measured {measuredOn(report.measuredAt)} on database{' '}
        <code>{report.database}</code>, in one read-only snapshot. Each figure
        has the query that produced it underneath; run the query and you get
        the figure.
      </p>
      {report.groups.map(([group, title]) => {
        const lines = report.lines.filter((l) => l.group === group);
        const failures = report.failures.filter((f) => f.group === group);
        const gaps = report.notMeasured.filter((g) => g.group === group);
        return (
          <section key={group} className="mt-12" data-group={group}>
            <h2 className="text-xl text-heading">{title}</h2>
            {lines.length + failures.length + gaps.length === 0 && (
              <p className="mt-2 text-sm text-ink-2" data-part="nothing">
                Nothing is measured under this heading.
              </p>
            )}
            {measuresOf(lines).map((m) => (
              <MeasureBlock key={m.key} measure={m} />
            ))}
            {failures.map((f) => (
              <FailureBlock key={f.key} failure={f} />
            ))}
            {gaps.map((g) => (
              <GapBlock key={g.key} gap={g} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** The page when there is no report: the reason, and no figures at all. */
export function DataQualityUnavailable({ why }: { why: string }) {
  return (
    <div data-testid="data-quality-unavailable">
      <p className="mt-6 text-base">
        <strong>No measurement to show.</strong> {why}
      </p>
      <p className="mt-2 text-sm text-ink-2">
        No figure is printed in its place: a number here without the query
        that produced it would be a guess.
      </p>
    </div>
  );
}
