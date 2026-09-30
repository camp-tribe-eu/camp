import {
  formatInstant,
  wildfireNote,
  type WildfireState,
} from '@/lib/wildfires';

// The sentence-and-credit panel under the map, for the wildfire layer.
//
// 🔴 EXTRACTED FROM campsite-map.tsx FOR ONE REASON (CAMP-162): so that
// the words a reader is shown beside Copernicus data can be READ.
//
// It was thirty lines of JSX inside a 1 700-line client component whose
// panel only exists after a browser has fetched the feed, and the CEMS
// terms make what this panel says a licence matter — no "warning",
// "danger", "risk" or "alert" beside CEMS data, and the modified-data
// credit beside it. A check on that has to look at the panel a reader
// gets. Looked at through a constant, or through `wildfireNote`'s return
// value, it would keep passing over a panel that printed something else.
// As a component with props and no hooks, it renders to the same HTML the
// page does with one call — `tests/unit/cems-panels.spec.ts` does exactly
// that, for every state the layer can be in.
//
// Nothing about the markup changed in the move: `wildfire-layer.spec.ts`
// reads the same `data-testid`, `data-state` and `data-in-view` off it in
// a real browser, and still does.

/**
 * 🔴 CAMP-153. The fire layer always says something, and that is the
 * whole point of it.
 *
 * An empty map reads as "all clear". Here that misreading is the risk the
 * card exists to remove: a reader who sees no perimeter near a campsite
 * in Calabria concludes there is no fire, when what happened may be that
 * our last read of Copernicus failed three days ago. So every state —
 * loading, missing, stale, none recorded, none in view, some in view — has
 * its own sentence, and none of them is ever an empty element.
 *
 * 🔴 And the credit is HERE, next to the shapes, not in a footer constant
 * nobody checks. CC BY 4.0 asks for attribution to the source with the
 * data's date; both are rendered, and both come out of the feed rather
 * than out of this file, so a pipeline that started writing something
 * else could not keep saying Copernicus.
 *
 * `on` is whether the reader has the layer switched on, and `inView` is
 * how many of the fires we hold fall inside what they are looking at, or
 * null before the map has told us.
 */
export function WildfirePanel({
  state,
  on,
  inView,
}: {
  state: WildfireState;
  on: boolean;
  inView: number | null;
}) {
  const note = wildfireNote(state, inView);
  return (
    <div
      role="status"
      data-testid="wildfire-note"
      data-state={on ? state.kind : 'off'}
      data-in-view={inView === null ? '' : String(inView)}
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
        // Switched off by the reader, and said out loud all the same:
        // an empty map with a control they may have hit by accident is
        // still an empty map.
        <p>
          The wildfire layer is switched off, so no burnt areas are drawn —
          that is this control, not an all-clear.
        </p>
      ) : (
        <>
          <p className="font-semibold text-heading">{note.headline}</p>
          <p className="mt-1">{note.detail}</p>
          {state.kind === 'fresh' && (
            <p className="mt-1">
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
                href={state.meta.licenceUrl}
                className="underline"
                rel="license noopener noreferrer"
                target="_blank"
              >
                {state.meta.licence}
              </a>
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
              {/* The date of the DATA, which is what the licence asks
                  for — not the date this page was built. */}
              Read from Copernicus on{' '}
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
          )}
        </>
      )}
    </div>
  );
}
