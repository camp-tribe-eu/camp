import {
  CDI_LEGEND,
  dekadPeriod,
  droughtNote,
  sampleAt,
  type DroughtPick,
  type DroughtState,
} from '@/lib/drought';
import { formatInstant } from '@/lib/wildfires';

// The sentence-and-credit panel under the map, for the drought layer.
//
// 🔴 A COMPONENT WITH PROPS AND NO HOOKS, FOR THE REASON WILDFIRE-PANEL
// IS ONE (CAMP-162): so that the words a reader is shown beside Copernicus
// data can be READ. EDO is a CEMS product, its terms bar "warning",
// "danger", "risk" and "alert" beside the data and dictate the credit, and
// a check on that has to look at the panel a reader gets — the HTML this
// renders to — not at a constant or at `droughtNote`'s return value.
// `tests/unit/cems-panels/drought.panel.ts` does exactly that, for every
// state, and the layer is tagged `terms: 'cems'` in `map-layers.ts` so the
// spec finds it.
//
// 🔴 THE CAMPSITE'S SENTENCE IS HERE AND NOT IN THE MAP POPUP. The popup is
// built with `document.createElement` inside MapLibre and needs a browser
// to be read; a class printed there would be text beside CEMS data that the
// spec cannot see. So the popup stays as it was, the click also sets
// `picked`, and what the indicator says at that campsite is said here.
//
// 🔴 NEVER AN EMPTY ELEMENT, AND A BLANK ON THE MAP IS NOT AN ALL-CLEAR.
// Every state — loading, missing, stale, switched off, a campsite the grid
// has no class for, one outside the grid — has its own sentence, and the
// legend says out loud that an undrawn cell means "no class recorded".
//
// 🔴 The period is named, and the age is stated as normal. The credit is
// HERE, beside the data, and comes out of the feed so that a pipeline that
// began writing something else could not keep saying Copernicus.

export function DroughtPanel({
  state,
  on,
  picked,
}: {
  state: DroughtState;
  on: boolean;
  picked: DroughtPick | null;
}) {
  const note = droughtNote(state, picked);
  const period = state.kind === 'fresh' ? dekadPeriod(state.meta.dekad) : null;
  const sample =
    state.kind === 'fresh' && picked ? sampleAt(state.grid, picked.lat, picked.lon) : null;
  return (
    <div
      role="status"
      data-testid="drought-note"
      data-state={on ? state.kind : 'off'}
      data-dekad={on && state.kind === 'fresh' ? state.meta.dekad : ''}
      data-days-old={on && (state.kind === 'fresh' || state.kind === 'stale') ? String(state.daysOld) : ''}
      data-sample={on && sample ? sample.kind : ''}
      className={
        'mt-2 rounded border p-3 text-sm ' +
        (!on
          ? 'border-line-2 bg-surface text-ink-2'
          : note.tone === 'gap'
          ? 'border-warn/40 bg-warn/5 text-ink-2'
          : 'border-line-2 bg-surface text-ink-2')
      }
    >
      {!on ? (
        // Switched off by the reader, and said out loud all the same: an
        // empty map with a control they may have hit by accident is still
        // an empty map.
        <p>
          The drought layer is switched off, so no drought classes are drawn —
          that is this control, not an all-clear.
        </p>
      ) : (
        <>
          <p className="font-semibold text-heading">{note.headline}</p>
          <p className="mt-1">{note.detail}</p>
          {state.kind === 'fresh' && (
            <>
              {/* What the colours are, and what their absence is. Read
                  from the same table the pixels are painted from. */}
              <ul aria-label="Drought layer colours" className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {CDI_LEGEND.map((entry) => (
                  <li key={entry.key} className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="inline-block h-3 w-3 rounded-sm border border-line-2"
                      style={{ backgroundColor: entry.colour }}
                    />
                    <span>{entry.label}</span>
                  </li>
                ))}
                <li className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block h-3 w-3 rounded-sm border border-dashed border-line-2"
                  />
                  <span>Not drawn: no class recorded, which is not the same as no drought</span>
                </li>
              </ul>
              <p className="mt-2">
                <a
                  href={state.meta.sourceUrl}
                  className="underline"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {state.meta.source}
                </a>
                {' · '}
                <a
                  href={state.meta.termsUrl}
                  className="underline"
                  rel="license noopener noreferrer"
                  target="_blank"
                >
                  CEMS terms
                </a>
                {' · '}
                {/* The period the data describes, which is what makes it
                    honest — and the moment WE last read it. */}
                {state.meta.product}, {period ? period.label : state.meta.dekad}, read from
                Copernicus on{' '}
                <time dateTime={state.meta.fetchedAt}>
                  {formatInstant(state.meta.fetchedAt) ?? state.meta.fetchedAt}
                </time>
                {'. '}
                {/* 🔴 The CEMS notice for modified data, word for word as
                    the terms write it, with the year. Rendered, because a
                    credit nobody can see is not a credit — and carried by
                    the feed, so it cannot go stale in a component. */}
                {state.meta.attribution}
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
