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
  // Heading navy: formal infrastructure, the most built-up of the five.
  rv_park: "#343D50",
  // Active blue-grey: a stop, not a stay.
  camper_stop: "#7C92B7",
};

/** Drawn for a type we have no colour for, so a new kind is visible rather than invisible. */
export const UNKNOWN_COLOUR = "#5A5A5A";

/** The stroke every marker carries. It is the colour the fills are measured against. */
export const MARKER_STROKE = "#FFFFFF";

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
      ["all", ...others.map((o) => [">=", ["get", t], ["get", o]])],
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
