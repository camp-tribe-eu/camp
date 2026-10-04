import { droughtNote, formatDay, type DroughtState } from '@/lib/drought';

// CAMP-163 — the EDO drought reading, beside the campsite it is about.
//
// 🔴 A component with props and no hooks, deliberately, like
// `WildfirePanel`. The CEMS terms make the WORDS on this panel a licence
// matter, so a check has to be able to read the panel a reader actually
// gets — `tests/unit/cems-panels.spec.ts` renders this with one call for
// every state the layer can be in. Thirty lines of JSX inside a page
// could not be read that way.
//
// 🔴 THIS PANEL IS NEVER EMPTY, AND NEVER SILENT.
//
// Same rule as the wildfire layer, for a sharper reason. Drought is the
// one hazard where the good news is worth printing: the indicator says
// "Normal conditions" about a specific place in a specific ten-day
// period, and that is a measurement, not an absence. A blank space where
// it should be reads as "nobody knows", which is both false and worse.
//
// So the three answers are three sentences, and the one that means "we
// do not cover this place" never borrows the words of the one that means
// "we looked and it is fine".

/**
 * `state` comes from `droughtState`, built once per render pass from the
 * two committed files. `lat`/`lon` are the campsite's.
 *
 * 🔴 The sampling happens at BUILD time, on the server. The grid is
 * 1 280 × 889 and the two files are 103 KB; shipping them to a browser
 * so it could look up one pixel would be 103 KB per page view for a
 * single byte of answer.
 */
export function DroughtPanel({
  state,
  lat,
  lon,
}: {
  state: DroughtState;
  lat: number;
  lon: number;
}) {
  const note = droughtNote(state, lat, lon);
  return (
    <section
      data-testid="drought-note"
      data-state={state.kind}
      data-tone={note.tone}
      aria-labelledby="drought-heading"
      className={
        'mt-4 rounded border p-3 text-sm ' +
        (note.tone === 'gap'
          ? 'border-line-2 bg-surface-2 text-ink-2'
          : 'border-line-2 bg-surface text-ink-2')
      }
    >
      <h3
        id="drought-heading"
        className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-2"
      >
        Drought
      </h3>
      <p className="mt-2 font-semibold text-heading">{note.headline}</p>
      <p className="mt-1">{note.detail}</p>

      {state.kind !== 'missing' && (
        <p className="mt-2">
          {/* 🔴 The dekad, always. This indicator is published every ten
              days and the reading is as old as its dekad; a panel that
              hid that would be presenting a three-week-old measurement
              as today's. */}
          {note.asOf ? (
            <>
              Ten-day period beginning{' '}
              <time dateTime={state.meta.dekad}>{note.asOf}</time>
              {'. '}
            </>
          ) : null}
          {state.meta.cadenceNote}
        </p>
      )}

      {state.kind === 'current' && (
        <p className="mt-2 text-xs">
          <a
            href={state.meta.sourceUrl}
            className="underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            {state.meta.source}
          </a>
          {' · '}
          {state.meta.indicator}
          {' · '}
          <a
            href={state.meta.termsUrl}
            className="underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            CEMS terms
          </a>
          {' · '}
          {/* Read on, not built on: the licence asks for the date of the
              DATA, and a build date would drift away from it every time
              anything else on the site changed. */}
          Read from Copernicus on{' '}
          <time dateTime={state.meta.fetchedAt}>
            {formatDay(state.meta.fetchedAt.slice(0, 10)) ?? state.meta.fetchedAt}
          </time>
          {'. '}
          {/* 🔴 The CEMS notice for modified data, word for word, with
              the year — carried by the data file rather than written
              here, so it cannot go stale in a component. */}
          {state.meta.attribution}
        </p>
      )}
    </section>
  );
}
