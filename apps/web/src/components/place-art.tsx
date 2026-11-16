import { ART_H, ART_W, type DotMap, type LatLon } from '@/lib/mini-map';

/**
 * CAMP-441. The picture slot of a listing card: a drawing from our own
 * coordinates (lib/mini-map.ts), in the theme's colours.
 *
 * Decorative (`aria-hidden`): the card's own text names the place and
 * counts what is in it; a described map would say it twice.
 *
 * Drawn only when there is something to draw — the callers pass `null`
 * for "nothing", and this renders nothing then, so the card has no
 * picture slot rather than an empty one.
 */

const VIEW = `0 0 ${ART_W} ${ART_H}`;

// Not exported on purpose: a test reads the served HTML, not this string.
const ART_CSS = `
.ct-art{position:absolute;top:0;left:0;width:100%;height:100%}
.ct-art__dots{fill:none;stroke:var(--color-ink-2);stroke-linecap:round;opacity:.55}
.ct-art__mark{fill:var(--color-heading);stroke:var(--color-line-blue);stroke-width:2}
.ct-art__shape{fill:color-mix(in srgb,var(--color-line-blue) 22%,transparent);stroke:var(--color-line-blue);stroke-width:1.6;stroke-linejoin:round}
`;

/** The pictures' colours; React hoists it once per page. */
export function ArtStyle() {
  return (
    <style href="ct-art" precedence="ct-components">
      {ART_CSS}
    </style>
  );
}

/** One region's cloud of campsites; the whole picture of a region card. */
export function RegionArt({ map }: { map: DotMap | null }) {
  if (map === null) return null;
  return (
    <svg className="ct-art" viewBox={VIEW} aria-hidden="true" focusable="false">
      <path className="ct-art__dots" d={map.d} strokeWidth={map.dot} />
    </svg>
  );
}

/**
 * The outline of one campsite, fitted to the tile.
 */
export function OutlineArt({ d }: { d: string | null }) {
  if (d === null) return null;
  return (
    <svg className="ct-art" viewBox={VIEW} aria-hidden="true" focusable="false">
      <path className="ct-art__shape" d={d} fillRule="evenodd" />
    </svg>
  );
}

/**
 * The cloud of the campsite's region, drawn ONCE per page as a symbol, and
 * the cards that have no outline reference it. Twenty-four cards of one
 * region would otherwise repeat the same ~1 kB path twenty-four times.
 */
export function RegionSymbol({ id, map }: { id: string; map: DotMap | null }) {
  if (map === null) return null;
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <symbol id={id} viewBox={VIEW}>
        <path className="ct-art__dots" d={map.d} strokeWidth={map.dot} />
      </symbol>
    </svg>
  );
}

/** A campsite with no outline: its region's cloud, this campsite marked. */
export function MarkedArt({
  symbolId,
  map,
  at,
}: {
  symbolId: string;
  map: DotMap | null;
  at: LatLon | null;
}) {
  if (map === null) return null;
  const [x, y] = at ? map.project(at) : [null, null];
  return (
    <svg className="ct-art" viewBox={VIEW} aria-hidden="true" focusable="false">
      <use href={`#${symbolId}`} />
      {x !== null && y !== null && <circle className="ct-art__mark" cx={x} cy={y} r="4.5" />}
    </svg>
  );
}
