import {
  LEGEND_BACKING,
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

export function DroughtLayerPanel({
  state,
  pictureReady = true,
}: {
  state: DroughtLayerState;
  /**
   * 🔴 CAMP-530. The picture is painted in a worker, so there is a moment when
   * the data has arrived and the picture has not. The key to the colours must
   * not stand beside a map that has no colours yet: until `pictureReady`, the
   * panel says it is drawing. Defaults to true for the callers (and tests) that
   * render the panel with no picture to wait for.
   */
  pictureReady?: boolean;
}) {
  return (
    <div
      role="status"
      data-testid="drought-layer-note"
      data-state={state.kind}
      data-drawn={state.kind === 'current' ? (pictureReady ? 'yes' : 'no') : undefined}
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

      {state.kind === 'current' && !pictureReady && (
        <p>Drawing the drought layer…</p>
      )}

      {state.kind === 'current' && pictureReady && (
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
              <li key={row.swatch} className="inline-flex items-center gap-1.5">
                {/* 🔴 The colour the map really shows: the class's own, at
                    the strength it is drawn with, laid on the colour the
                    basemaps paint as land. It used to be the raw hex at full
                    strength, and class 0 — drawn at 22.9% — had a key about
                    four times stronger than the picture. The backing is
                    there because a translucent swatch looks like whatever is
                    behind it, and in dark mode that is not the map. */}
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 rounded-sm border border-line-2"
                  style={{ backgroundColor: LEGEND_BACKING }}
                >
                  <span
                    className="block h-full w-full rounded-sm"
                    data-swatch=""
                    style={{ backgroundColor: row.swatch }}
                  />
                </span>
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
          {/* 🔴 CAMP-530. The picture is smoothed (lone squares absorbed,
              edges between classes rounded); the class a campsite shows is
              read from the Copernicus data under its own point, never from
              the picture. Said where the key is, because a reader looking at
              a rounded edge would otherwise take it for the source's own. */}
          <p className="mt-2" data-testid="drought-smoothing-note">
            The colours are smoothed for display. The class shown for a campsite
            is read from the Copernicus data at its own location.
          </p>
          <DroughtCredit meta={state.meta} />
        </>
      )}
    </div>
  );
}
