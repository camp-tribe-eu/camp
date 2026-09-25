// CAMP-122: which datasets the map draws, as opposed to which campsites.
//
// 🔴 A LAYER IS NOT A FILTER, and keeping them apart is the whole point.
//
// The chips in map-filters.tsx are filters: they narrow ONE dataset, and
// their empty state means "all of it". A layer is a dataset that is drawn
// or not drawn, and its empty state means "nothing". Putting both behind
// one control makes "clear" ambiguous — does it show everything or
// nothing? — and that ambiguity is how a reader ends up staring at a
// blank map wondering whether the area is empty or the map is.
//
// 🔴 Why this exists before the layers do.
//
// Five cards want a dataset on this map: hazards (CAMP-112), POI along a
// route (CAMP-113), rest areas (CAMP-119), charging points (CAMP-120) and
// roadside assistance (CAMP-121). Without this, each one makes the map
// worse; with it, each makes it better. The competitor measurement says
// the same thing from the other side: park4night draws ~340 000 points
// and half of them are water taps, which is exactly the mess the owner
// does not want.
//
// So the registry is written first and the layers arrive as entries.

/** Everything that could be drawn, whether or not it can be drawn yet. */
export const LAYERS = [
  {
    id: 'campsites',
    label: 'Campsites',
    /** Said in the panel, so a reader knows what they are turning off. */
    description: 'Every campsite, camper stop and wild spot we hold.',
    status: 'live',
  },
  {
    id: 'hazards',
    label: 'Hazards',
    description: 'Official fire and severe-weather warnings.',
    status: 'planned',
    card: 'CAMP-112',
  },
  {
    id: 'rest-areas',
    label: 'Rest areas',
    description: 'Roadside stops, with toilets and showers where recorded.',
    status: 'planned',
    card: 'CAMP-119',
  },
  {
    id: 'charging',
    label: 'Charging',
    description: 'Charging points for electric campers.',
    status: 'planned',
    card: 'CAMP-120',
  },
  {
    id: 'assistance',
    label: 'Help on the road',
    description: 'Garages, official services and recovery.',
    status: 'planned',
    card: 'CAMP-121',
  },
] as const satisfies readonly {
  id: string;
  label: string;
  description: string;
  status: 'live' | 'planned';
  card?: string;
}[];

export type LayerId = (typeof LAYERS)[number]['id'];

/**
 * 🔴 What an id may look like, pinned rather than assumed.
 *
 * The URL joins them with commas, so an id containing one would split in
 * half on the way back and the layer would vanish from a shared link —
 * and, being absent from `active`, would not even be reported as empty.
 * Review demonstrated it with `fire, flood`. Nothing in the type stopped
 * it: `satisfies` only asks for a string.
 */
export const LAYER_ID = /^[a-z][a-z0-9-]*$|^_[a-z][a-z0-9-]*$/;

/**
 * 🔴 Only what we can actually draw is ever offered.
 *
 * A switch for a dataset that does not exist is a promise, and a greyed
 * one is a promise with an excuse. The registry keeps the planned ones so
 * that adding a layer is one word — `status: 'live'` — and so that a test
 * can assert none of them ever reaches a reader.
 */
export const liveLayers = (): LayerId[] =>
  LAYERS.filter((l) => l.status === 'live').map((l) => l.id);

export const isLive = (id: string): id is LayerId =>
  LAYERS.some((l) => l.id === id && l.status === 'live');

/** What a first-time reader sees. Every live layer, because hiding one
 *  by default means nobody discovers it. */
export const DEFAULT_LAYERS = (): LayerId[] => liveLayers();

/**
 * Turn a layer on or off, keeping the registry's order.
 *
 * 🔴 Unknown ids are dropped rather than carried. A link shared before a
 * layer was renamed should still open the map, on the same reasoning the
 * filter parser already uses.
 */
export function toggleLayer(active: readonly string[], id: string): LayerId[] {
  const live = liveLayers();
  const on = new Set(active.filter(isLive));
  if (on.has(id as LayerId)) on.delete(id as LayerId);
  else if (isLive(id)) on.add(id);
  return live.filter((l) => on.has(l));
}

export const allLayers = (): LayerId[] => liveLayers();
export const noLayers = (): LayerId[] => [];

/**
 * The layers in a URL, so a map somebody sends opens the way they saw it.
 *
 * 🔴 Absent means "the default", not "none". The difference matters: a
 * bare /map must show something, and `?layers=` with nothing after it is
 * how a reader asks for an empty map on purpose.
 */
export function layersToParam(active: readonly LayerId[]): string | null {
  const live = liveLayers();
  const on = live.filter((l) => active.includes(l));
  if (on.length === live.length) return null; // the default: leave it out
  return on.join(',');
}

export function layersFromParam(raw: string | null | undefined): LayerId[] {
  if (raw === null || raw === undefined) return DEFAULT_LAYERS();
  if (raw.trim() === '') return [];
  const asked = raw.split(',').map((s) => s.trim());
  return liveLayers().filter((l) => asked.includes(l));
}

/**
 * What to say when a layer is on and shows nothing.
 *
 * 🔴 The card's rule, and CAMP-112's: an empty map reads as "all clear",
 * which is the one thing it must never say by accident. Silence is not an
 * answer — every live layer that drew nothing is named out loud.
 */
export function emptyLayerNotice(
  active: readonly LayerId[],
  drawn: Readonly<Record<string, number>>,
): string | null {
  // 🔴 A count we cannot read is a count of nothing.
  //
  // `drawn[id] ?? 0` caught null and undefined and let NaN through — and
  // NaN is the shape `Number(element.getAttribute(...))` produces, which
  // is exactly how these numbers are read. So an unmeasured layer said
  // "we drew something" and the map stayed silent, which is the one
  // failure this function exists to prevent. Review found it.
  //
  // `Object.hasOwn`, because a bare index walks the prototype: a layer
  // called `toString` would have read as drawn.
  // `Object.hasOwn` is deliberately absent: review showed it can never
  // change an outcome, because nothing on Object.prototype is a positive
  // finite number and the type check below rejects every one of them.
  // A line that cannot fail is a line that misleads about what guards
  // what.
  const counted = (id: string): number => {
    const n: unknown = drawn[id];
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
  };
  const silent = active.filter((id) => counted(id) === 0);
  if (silent.length === 0) return null;
  const names = silent.map(
    (id) => LAYERS.find((l) => l.id === id)?.label ?? id,
  );
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list} ${names.length === 1 ? 'is' : 'are'} switched on but nothing is showing here — that means nothing in view, not that we checked and found none.`;
}
