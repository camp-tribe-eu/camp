/**
 * What colour a campsite is drawn in, and why each one.
 *
 * 🔴 THE DESIGN STATES THE RULE AND NOT THE PALETTE. `03-map.html` says
 * "the number says how many, the colour says which kind there are more
 * of", and assigns no colour to any type — every hex in that file is a
 * theme colour. So the five below are chosen from the theme's own label
 * shades, and the choice is MEASURED rather than argued: see
 * scripts/ci/check-map-palette.mjs, which fails the build if any of them
 * stops passing.
 *
 * 🔴 Why the markers were all one colour until now, and why that was
 * worse than it looked: the fill was `#C83D28`, which in the design
 * system is **Error**. Every campsite on the map was painted in the
 * colour the system reserves for something being wrong.
 *
 * 🔴 THE STROKE IS DARK, AND THAT IS THE LOAD-BEARING PART.
 *
 * The first version measured each fill against a WHITE stroke and
 * stopped there. Review called that the most favourable number
 * available rather than a conservative one, and it was right: white has
 * ~1.09 contrast against the map's paper, so on land the ring is
 * invisible and the fill is doing the work alone. Measured against real
 * basemap colours, FOUR of the five fills fell below 3:1 — `camper_stop`
 * reached 1.81 over water.
 *
 * A dark stroke fixes it at the source. `#181D26` has 9.67:1 against the
 * worst of paper, landuse, forest and water, so the marker is a visible
 * shape everywhere regardless of its fill, and the fill is then free to
 * do the only job left to it: telling the five kinds apart.
 *
 * 🔴 WHAT THE MEASUREMENT RULED OUT. The first candidates were the
 * headline theme colours — Success `#4BA883`, Brand `#FFC83C`, Active
 * `#7C92B7`. Against the marker's white stroke, which is the ADJACENT
 * colour WCAG 1.4.11 asks about, Success reaches 2.91 and Brand 1.55,
 * both under the 3.0 a non-text graphic needs. The design system says
 * the same thing about the yellow in words: "only fill, never text —
 * #FFC83C does not pass contrast". The label shades do pass, and they
 * are what this uses.
 *
 * 🔴 COLOUR IS NEVER THE ONLY CHANNEL (WCAG 1.4.1). The popup names the
 * type in words and the legend decodes every colour without a click. A
 * reader who cannot tell these five apart loses nothing but a shortcut.
 */

/** The five kinds OSM gives us, and the colour each is drawn in. */
export const TYPE_COLOUR: Record<string, string> = {
  // Label green. Free is the one fact a wild camper decides on, and the
  // design says so: "«Безкоштовно» — окреме слово, не €0".
  free: "#3A8266",
  // Label amber: something is being asked of you, but nothing is wrong.
  paid: "#AD6200",
  // Label red. Not "bad" — "look before you stay". Wild camping is
  // restricted or illegal across most of the EU, and the colour that
  // makes a reader pause is the honest one here.
  wild: "#D5412A",
  // Pale blue: formal infrastructure. Was heading navy until review
  // measured it at 1.55 against the new dark stroke — a dark dot inside
  // a dark ring is one shape, not two.
  rv_park: "#C9D3E4",
  // Light yellow — a tint, NOT the brand #FFC83C, which the design
  // system reserves for the emblem. A stop, not a stay.
  camper_stop: "#FFD36B",
};

/** Drawn for a type we have no colour for, so a new kind is visible rather than invisible. */
export const UNKNOWN_COLOUR = "#6E7889";

/** The stroke every marker carries. It is the colour the fills are measured against. */
export const MARKER_STROKE = "#181D26";

/** `['match', ['get','type'], 'free', '#3A8266', …, UNKNOWN]` for a paint property. */
export const typeColourExpression = (): unknown[] => [
  "match",
  ["get", "type"],
  ...Object.entries(TYPE_COLOUR).flat(),
  UNKNOWN_COLOUR,
];

/**
 * One counter per type, for the cluster source.
 *
 * MapLibre accumulates these over the points inside each cluster, so a
 * cluster arrives already knowing how many of each kind it holds.
 */
export const clusterCounts = (): Record<string, unknown> =>
  Object.fromEntries(
    Object.keys(TYPE_COLOUR).map((t) => [
      t,
      ["+", ["case", ["==", ["get", "type"], t], 1, 0]],
    ]),
  );

/**
 * The colour of a cluster: whichever type it holds most of.
 *
 * 🔴 Ties go to the EARLIER type in TYPE_COLOUR, and that is a decision
 * rather than an accident: a stable order means the same cluster does
 * not change colour when the map is panned away and back. The order is
 * free → paid → wild → rv_park → camper_stop, so a tie shows the
 * cheaper answer, which is the one a reader is deciding on.
 */
export function dominantColourExpression(): unknown[] {
  const types = Object.keys(TYPE_COLOUR);
  // case( count_a >= every other count, colour_a, … , UNKNOWN )
  const branches: unknown[] = [];
  for (const t of types) {
    const others = types.filter((o) => o !== t);
    branches.push(
      [
        "all",
        // 🔴 `> 0` FIRST, and review found what its absence cost. Without
        // it, a cluster holding none of any known type satisfies
        // `0 >= 0` for every comparison and takes the FIRST branch —
        // measured over all 1024 count vectors, that is the one input
        // where this expression and `dominantType` disagreed: MapLibre
        // answered free, the TypeScript answered null. Worse, it made
        // UNKNOWN_COLOUR unreachable in the cluster layer — a fallback
        // that cannot fire is not a fallback, and a cluster of a kind we
        // have no colour for would have been drawn as "free".
        [">", ["get", t], 0],
        ...others.map((o) => [">=", ["get", t], ["get", o]]),
      ],
      TYPE_COLOUR[t],
    );
  }
  return ["case", ...branches, UNKNOWN_COLOUR];
}

/** Which type a set of counts is mostly made of. The expression above, in TypeScript, so a test can drive it. */
export function dominantType(counts: Record<string, number>): string | null {
  const types = Object.keys(TYPE_COLOUR);
  for (const t of types) {
    const mine = counts[t] ?? 0;
    if (types.every((o) => o === t || mine >= (counts[o] ?? 0))) {
      return mine > 0 ? t : null;
    }
  }
  return null;
}

/**
 * The route line, and the dashed line that admits we do not know the road.
 *
 * 🔴 BOTH MEASURED AGAINST THE BASEMAP THEY CROSS (CAMP-237), because a
 * line has no outline to hide behind. The campsite markers can rely on
 * `MARKER_STROKE` carrying them at 11.23:1 and only need 3:1 against it;
 * a 2-pixel line sits directly on land, water, forest and road.
 *
 * What was here before:
 *
 *   `#2F6FDB` on the road line — a blue in no part of the design system,
 *   worst 3.16 against water. It also never draws: `road` is undefined
 *   until a routing provider is configured.
 *
 *   `#8A93A6` on the dashed leg line — also in no part of the system,
 *   worst **2.05 against water**, under the 3:1 of WCAG 1.4.11. That is
 *   the line that DOES draw today, so the failing colour was the live
 *   one and the blue the card was named after was the dead one.
 *
 * Measured against the design's own `--map-*` values, worst of five:
 *
 *   ROUTE_LINE  #C83D28   water 3.36   (the old blue gave 3.16)
 *   LINE_GUESS  #343D50   water 7.23
 *
 * ΔE between them is 79.5, far past the 25 this project uses, so "the
 * road we found" and "a straight line between stops" cannot be read as
 * two shades of one thing. The dash pattern says it too, which is WCAG
 * 1.4.1: colour is never the only channel.
 *
 * ⚠️ `ROUTE_LINE` is also `--warn`. Nothing on this map draws an error
 * state, so no frame shows both. If one is ever added, look again.
 */
export const ROUTE_LINE = "#C83D28";
export const LINE_GUESS = "#343D50";
