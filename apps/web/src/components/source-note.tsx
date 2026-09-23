import {
  describeSources,
  FIELD_LABEL,
  formatUpdated,
  isStale,
  type SpotSource,
} from '@/lib/sources';

// CAMP-101 — where the data on this page came from, per source, with the
// date each one last changed it.
//
// 🔴 A licence condition, not a credit. Licence Ouverte 2.0 requires the
// attribution to name the source and the date the reused information was
// last updated, and forbids misleading anyone about either. Our records
// were last touched anywhere between 2022-01-04 and this morning, so one
// undated notice in the footer would breach it — and would also be the
// most useful lie we could tell a reader who is choosing where to sleep
// tonight.
//
// 🔴 It also says WHICH FIELDS each source gave. Two licences meet on
// this page: ODbL asks for share-alike on what it touched, Licence
// Ouverte asks only for credit. "Sources: OpenStreetMap, DATAtourisme"
// attributes neither correctly, and would leave us unable to answer the
// one question CAMP-87 has to answer — what exactly is derived from what.

export default function SourceNote({ sources }: { sources: SpotSource[] }) {
  const described = describeSources(sources);
  if (described.length === 0) return null;

  return (
    <section
      data-testid="source-note"
      aria-labelledby="sources-heading"
      className="mt-8 rounded-card border border-line-2 bg-surface-2 p-4"
    >
      <h2
        id="sources-heading"
        className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-2"
      >
        Where this comes from
      </h2>

      <ul className="mt-3 space-y-3">
        {described.map(({ id, source, entry }) => {
          const when = formatUpdated(entry.updatedAt);
          const stale = isStale(entry.updatedAt);
          const gave = entry.fields
            .map((f) => FIELD_LABEL[f] ?? f)
            .join(', ');

          return (
            <li key={id} className="text-sm leading-6 text-ink-2">
              <span className="font-semibold text-heading">
                {source ? (
                  <a
                    href={source.url}
                    className="underline"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {source.name}
                  </a>
                ) : (
                  // An id we do not recognise. Shown rather than hidden:
                  // a missing attribution is the failure, a visibly odd
                  // one is a bug report.
                  id
                )}
              </span>
              {gave && <> — {gave}</>}
              {source && (
                <>
                  {' · '}
                  <a
                    href={source.licenceUrl}
                    className="underline"
                    rel="license noopener noreferrer"
                    target="_blank"
                  >
                    {source.licence}
                  </a>
                </>
              )}
              {when && (
                <>
                  <br />
                  <span data-testid={`updated-${id}`}>
                    {/* Phrased per source: see SourceInfo.dateLabel. */}
                    {source?.dateLabel ?? 'Source date'}{' '}
                    <time dateTime={entry.updatedAt}>{when}</time>
                    {/* 🔴 Said plainly rather than buried. A record
                        nobody has touched in over two years is not
                        wrong, but a reader deciding tonight deserves to
                        know that nobody has checked it since. */}
                    {/* 🔴 Only where the date means "the source changed
                        it". For OpenStreetMap the date is when we last
                        looked, and "nobody has updated this" would be a
                        claim about mappers we cannot make. */}
                    {stale && source?.dateLabel.startsWith('Last updated') && (
                      <strong className="font-semibold text-heading">
                        {' '}
                        — nobody has updated this in over two years.
                      </strong>
                    )}
                  </span>
                </>
              )}
              {source?.about && (
                <>
                  <br />
                  {/* 🔴 ink-2, not ink-3. On this panel's background
                      ink-3 measures 2.43:1 against the required 4.5:1 —
                      axe caught it the moment this block shipped. The
                      sentence explaining where data comes from is
                      exactly the sentence that must be readable. */}
                  <span className="text-ink-2">{source.about}</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
