import {
  droughtLegend,
  formatDay,
  type DroughtLayerState,
} from '@/lib/drought';
import { DroughtCredit } from './drought-panel';

// CAMP-200 — the sentence, the legend and the credit under the map, for the
// drought layer.
//
// 🔴 A component with props and no hooks, deliberately, like
// `WildfirePanel` and `DroughtPanel`. The CEMS terms make the WORDS beside
// this data a licence matter, so `tests/unit/cems-panels.spec.ts` renders
// this with one call for every state the layer can be in and reads the HTML.
//
// 🔴 It exists only while the layer is on. The map does not mount it
// otherwise: a reader who never switched the layer on has asked for no
// drought, and a paragraph about a switch they did not touch is noise on a
// map whose whole rule for this layer is "not by default".
//
// 🔴 EVERY STATE SAYS SOMETHING, and none of them is an empty element. An
// empty map with the layer switched on reads as "no drought anywhere",
// which is the one thing it must never say by accident. So "still
// fetching", "could not read" and "the newest reading is too old to draw"
// each have a sentence, and each says that nothing is drawn.
//
// 🔴 And the key to the colours is HERE, beside the colours. The legend
// reads the class names out of the data file (they were checked for the
// four reserved words at the door), and says in words what a bare place
// means — "outside the area the indicator covers" — because "bare" and
// "no drought" must not be the same thing to the reader.

export function DroughtLayerPanel({ state }: { state: DroughtLayerState }) {
  return (
    <div
      role="status"
      data-testid="drought-layer-note"
      data-state={state.kind}
      data-tone={state.kind === 'current' ? 'quiet' : 'gap'}
      className={
        'mt-2 rounded border p-3 text-sm ' +
        (state.kind === 'current'
          ? 'border-line-2 bg-surface text-ink-2'
          : 'border-warn/40 bg-warn/5 text-ink-2')
      }
    >
      {state.kind === 'loading' && (
        <p>Loading the Copernicus drought indicator. Nothing is drawn yet.</p>
      )}

      {state.kind === 'missing' && (
        <>
          <p className="font-semibold text-heading">No drought reading</p>
          <p className="mt-1">
            We could not read the Copernicus drought indicator, so nothing is
            drawn on the map.
          </p>
        </>
      )}

      {state.kind === 'behind' && (
        <>
          <p className="font-semibold text-heading">No recent drought reading</p>
          <p className="mt-1">
            The newest reading we hold is from{' '}
            {formatDay(state.meta.dekad) ?? state.meta.dekad}, and at least one
            ten-day publication has not appeared since. Nothing is drawn on the
            map.
          </p>
        </>
      )}

      {state.kind === 'current' && (
        <>
          <p className="font-semibold text-heading">
            Drought, ten-day period beginning{' '}
            <time dateTime={state.meta.dekad}>
              {formatDay(state.meta.dekad) ?? state.meta.dekad}
            </time>
          </p>
          <p className="mt-1">{state.meta.cadenceNote}</p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" data-testid="drought-legend">
            {droughtLegend(state.meta).map((row) => (
              <li key={row.hex} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 rounded-sm border border-line-2"
                  style={{ backgroundColor: row.hex }}
                />
                {row.label}
              </li>
            ))}
            <li className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-sm border border-dashed border-line-2"
              />
              not coloured: outside the area the indicator covers
            </li>
          </ul>
          <DroughtCredit meta={state.meta} />
        </>
      )}
    </div>
  );
}
