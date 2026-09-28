// CAMP-153 — the wildfire layer's rules, with no React and no map in them.
//
// 🔴 THE ONE THING THIS FILE MUST NEVER DO IS RENDER NOTHING.
//
// An empty map reads as "all clear". On a fire layer that misreading is
// the whole risk: a reader who sees no perimeters near a campsite in
// Calabria concludes there are none, when what actually happened is that
// our last read of Copernicus failed three days ago. So every state this
// file can be in produces a sentence — including, and especially, the
// states where we have nothing to draw. `wildfireNote` returns a string
// for every input it can be given, and the test proves it by enumeration.
//
// 🔴 THE SECOND THING IT MUST NEVER DO IS SPEAK WITH SOMEBODY ELSE'S
// AUTHORITY.
//
// This stopped being an editorial preference when CAMP-117 read the CEMS
// terms, which bind EFFIS and GWIS by name
// (`https://drought.emergency.copernicus.eu/terms&conditions`, read
// 28.09.2026):
//
//   "Data from the CEMS early warning and monitoring systems is provided
//    for information purposes only. This means that the data does not
//    constitute in any way an early warning for which only
//    national/regional institutions are authorized within their region of
//    responsibility."
//
// So the words "warning", "danger", "risk" and "alert" are not ours to
// use about this data, and neither is any instruction. Every sentence
// below reports what Copernicus recorded, dates it, names whose job an
// official notice is, and leaves the decision with the driver.
// `tests/unit/wildfires.spec.ts` reads every sentence for all of it.
//
// 🔴 And the credit is dictated, not chosen. The same terms say that data
// which has been "adapted or modified" — ours is: EU-27 only, a 14-day
// window, coordinates rounded onto a ~110 m grid — must carry "Contains
// modified Copernicus Emergency Management Service information [Year]".
// `readFeed` refuses a feed whose attribution does not.
//
// 🔴 The data file is deliberately NOT imported here. This module is
// pulled into the map, which is a client component, and a 245 KB JSON
// import would be parsed into the page's JavaScript whether or not the
// reader ever switches the layer on. It is served as a file instead —
// app/data/wildfires.json/route.ts — and fetched.

export interface WildfireMeta {
  /** When WE last succeeded against EFFIS. ISO instant. */
  fetchedAt: string;
  source: string;
  sourceUrl: string;
  licence: string;
  licenceUrl: string;
  /** The CEMS terms, which govern the wording as well as the credit. */
  termsUrl: string;
  attribution: string;
  /** Whose job an official notice is — never ours. */
  authorityNote: string;
  layer: string;
  windowDays: number;
  /** First day of the window, YYYY-MM-DD. */
  since: string;
  euSeasonTotal: number;
  maxFeatures: number;
  kept: number;
  rejected: number;
  byCountry: Record<string, number>;
  latencyNote: string;
}

export interface WildfireProperties {
  id: string;
  /** The day the fire was recorded as starting, YYYY-MM-DD. */
  date: string;
  /** Our own ISO alpha-2 — EFFIS's EL comes back as GR. */
  country: string;
  /** Commune and province as EFFIS spells them. May be empty. */
  place: string;
  hectares: number;
}

export interface WildfireFeature {
  type: 'Feature';
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  properties: WildfireProperties;
}

export interface WildfireFeed {
  type: 'FeatureCollection';
  meta: WildfireMeta;
  features: WildfireFeature[];
}

/** Where the map fetches it from. */
export const WILDFIRE_URL = '/data/wildfires.json';

/**
 * 🔴 How old our own last successful read may be before the page stops
 * showing the layer and says "no fresh data" instead.
 *
 * EFFIS derives burnt-area perimeters daily, so three days is three
 * missed refreshes — the same reasoning fuel.ts uses for a weekly
 * bulletin at three weeks. Below this the layer is drawn with its date
 * beside it; above it, the perimeters come off the map entirely rather
 * than sitting there looking current.
 *
 * 🔴 It is measured against `fetchedAt` — OUR clock — and deliberately
 * NOT against the freshest LASTUPDATE in the set. §8 of
 * docs/road-hazard-sources.md keeps three clocks apart, and conflating
 * these two is the easy mistake: a quiet fortnight in which Copernicus
 * updated no record is not a broken pipeline, and a page that cried "no
 * fresh data" every calm week would train readers to ignore the words on
 * the week they matter.
 *
 * 🔴 It is also why this refresh has to be scheduled rather than run by
 * hand. Today it is a hand-run script, so the layer goes quiet three days
 * after anyone last ran it — which is the honest description of our
 * operations, and the reason the follow-up card exists.
 */
export const FRESH_FOR_HOURS = 72;

/**
 * The credit the CEMS terms dictate for data that has been changed, with
 * a four-digit year in the place they write "[Year]".
 *
 * 🔴 The year is matched, not merely the phrase. A notice frozen at 2026
 * is the same stale attribution the licence exists to prevent, and a
 * pattern that accepted "[Year]" verbatim would wave it through.
 */
export const CEMS_NOTICE =
  /Contains modified Copernicus Emergency Management Service information \d{4}\b/;

/**
 * 🔴 Words the CEMS terms reserve for national and regional services.
 *
 * Mirrored from scripts/effis/fetch-wildfires.mjs, which refuses to WRITE
 * them; this side refuses to let them be RENDERED. Two copies on purpose:
 * the script guards the data file and cannot see the page, and this one
 * guards the page and cannot see the fetch. Both are driven by tests.
 */
export const RESERVED_WORDS =
  /\b(warning|warnings|danger|dangerous|risk|risks|risky|alert|alerts|evacuate|evacuation)\b/i;

export type WildfireState =
  /** The fetch is still in flight. Not the same as having nothing. */
  | { kind: 'loading' }
  /** The file would not load or is not the shape we wrote. */
  | { kind: 'missing' }
  /** It loaded, and that is the dangerous case: a successful read of an archive. */
  | { kind: 'stale'; meta: WildfireMeta; hoursOld: number }
  | { kind: 'fresh'; meta: WildfireMeta; fires: WildfireFeature[] };

/**
 * Is this the file we wrote, or something else?
 *
 * 🔴 Tolerant on the way in and strict about what it admits. A deploy
 * where the data file is half-written, or served as an HTML error page by
 * a CDN, must reach `missing` — which SAYS SO — rather than throw inside
 * a React render and take the map down with it. The campsite source note
 * learned this the expensive way: one absent field blanked every campsite
 * page.
 */
/**
 * One feature from the file, or null if we cannot draw it.
 *
 * 🔴 ONE BAD RECORD COSTS ONE RECORD. `readFeed` used to wave the feature
 * array straight through after checking only that it WAS an array, which
 * made its own opening comment false: `features: [null]` reached `fresh`,
 * and `firesInView` then threw "Cannot read properties of null (reading
 * 'geometry')" out of an effect — the React unmount this function exists
 * to prevent, landing the reader on a blank map instead of on "No fresh
 * wildfire data". Review found it.
 *
 * 🔴 A name we may not print costs the NAME, not the fire. `place` comes
 * from EFFIS and is a proper name, so the script does not gate it — but
 * it is rendered on the popup, and a commune called something the CEMS
 * terms reserve would put that word on our page under our voice. Dropping
 * the perimeter over it would lose a real fire; dropping the label loses
 * nothing a reader needs, because `fireCard` already falls back to
 * "Burnt area in XX".
 */
export function readFire(input: unknown): WildfireFeature | null {
  if (!input || typeof input !== 'object') return null;
  const f = input as Partial<WildfireFeature>;
  const g = f.geometry as { type?: unknown; coordinates?: unknown } | undefined;
  if (!g || typeof g !== 'object') return null;
  if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') return null;
  if (!Array.isArray(g.coordinates) || g.coordinates.length === 0) return null;
  const p = f.properties as Partial<WildfireProperties> | undefined;
  if (!p || typeof p !== 'object') return null;
  if (typeof p.date !== 'string' || typeof p.country !== 'string') return null;
  if (typeof p.hectares !== 'number' || !Number.isFinite(p.hectares)) return null;
  const place = typeof p.place === 'string' ? p.place : '';
  return {
    type: 'Feature',
    geometry: f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
    properties: {
      id: typeof p.id === 'string' ? p.id : '',
      date: p.date,
      country: p.country,
      place: RESERVED_WORDS.test(place) ? '' : place,
      hectares: p.hectares,
    },
  };
}

export function readFeed(input: unknown): WildfireFeed | null {
  if (!input || typeof input !== 'object') return null;
  const feed = input as Partial<WildfireFeed>;
  if (!Array.isArray(feed.features)) return null;
  const meta = feed.meta as Partial<WildfireMeta> | undefined;
  if (!meta || typeof meta !== 'object') return null;
  if (typeof meta.fetchedAt !== 'string') return null;
  if (Number.isNaN(Date.parse(meta.fetchedAt))) return null;
  if (typeof meta.since !== 'string') return null;
  if (typeof meta.attribution !== 'string' || meta.attribution.length === 0) {
    // 🔴 A feed with no attribution is not a feed we may draw. CC BY 4.0
    // is a condition, not a credit line, and an empty string would render
    // as a blank space nobody notices.
    return null;
  }
  // 🔴 And not just ANY credit: the one the CEMS terms name for modified
  // data. A feed carrying only the CC BY line satisfies one licence and
  // breaches the other, which is exactly the kind of breach that stays
  // invisible until it is expensive.
  if (!CEMS_NOTICE.test(meta.attribution)) return null;
  if (typeof meta.authorityNote !== 'string' || meta.authorityNote.length === 0) {
    return null;
  }
  if (typeof meta.windowDays !== 'number' || !Number.isFinite(meta.windowDays)) {
    return null;
  }
  // 🔴 THE GATE THAT WAS NOT A GATE.
  //
  // `RESERVED_WORDS` existed, was unit-tested against itself, and was
  // never once applied to anything at runtime — the claim "the script
  // refuses to write them, the page refuses to render them" was half
  // true. `authorityNote` and `attribution` are rendered VERBATIM, so a
  // feed saying "official fire danger warning: extreme risk, evacuate"
  // went straight onto the page. Review proved it with a scratch feed.
  //
  // Refusing the whole feed rather than stripping the sentence, because
  // unlike a place name these are OUR words: a pipeline writing them is
  // broken in a way somebody has to look at, and "No fresh wildfire data"
  // is the honest thing to show while they do.
  if (RESERVED_WORDS.test(meta.authorityNote)) return null;
  if (RESERVED_WORDS.test(meta.attribution)) return null;

  const fires: WildfireFeature[] = [];
  for (const raw of feed.features) {
    const fire = readFire(raw);
    if (fire) fires.push(fire);
  }
  return { ...(feed as WildfireFeed), features: fires };
}

export function hoursSince(iso: string, now: Date): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - then) / 3_600_000;
}

/**
 * What state the layer is in, from the raw thing that arrived.
 *
 * 🔴 A read that SUCCEEDED and returned an archive is the realistic
 * failure here, not a fetch that errored — that is the finding §8 of the
 * hazard document is built on, and it is why `stale` is a state of its
 * own rather than a flag on `fresh`.
 *
 * 🔴 A `fetchedAt` in the future is stale too. A clock skew that reads as
 * "-4 hours old" would otherwise pass every budget for ever, which is the
 * shape of a guard that agrees with the bug.
 */
export function wildfireState(input: unknown, now: Date): WildfireState {
  const feed = readFeed(input);
  if (!feed) return { kind: 'missing' };
  const hoursOld = hoursSince(feed.meta.fetchedAt, now);
  if (!(hoursOld >= 0) || hoursOld > FRESH_FOR_HOURS) {
    return { kind: 'stale', meta: feed.meta, hoursOld };
  }
  return { kind: 'fresh', meta: feed.meta, fires: feed.features };
}

/** 2026-09-14 → 14 September 2026. Never invented when the date is not one. */
export function formatDay(iso: string): string | null {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatInstant(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const n = (value: number) => value.toLocaleString('en-GB');

export interface WildfireNote {
  /** 'quiet' when there is something to draw, 'gap' when there is not. */
  tone: 'quiet' | 'gap';
  /** The one sentence a reader must not be able to miss. */
  headline: string;
  /** What the figure is and is not. Always present. */
  detail: string;
}

/**
 * The words under the map, for every state the layer can be in.
 *
 * `inView` is how many of the fires we hold fall inside what the reader
 * is looking at, or null before the map has told us.
 *
 * 🔴 Why this does NOT reuse `emptyLayerNotice` from map-layers.ts.
 *
 * That function says "nothing in view, not that we checked and found
 * none", and it is right for the campsites, which arrive region by region
 * as the reader moves: an empty view there genuinely might be an
 * unfetched chunk. The fires are different — we hold the WHOLE EU-27 set
 * for the window in one file — so an empty view here does mean none was
 * recorded, and borrowing the campsites' sentence would understate what
 * we know just as badly as overstating it. Two different epistemic
 * positions, two sentences.
 */
export function wildfireNote(
  state: WildfireState,
  inView: number | null,
): WildfireNote {
  if (state.kind === 'loading') {
    // 🔴 Said out loud, and it is not politeness. "Loading" and "we have
    // nothing" produce the same empty map, and the reader cannot tell
    // them apart by looking. The one thing this layer may never do is let
    // a blank area pass for an answer.
    return {
      tone: 'gap',
      headline: 'Loading the Copernicus EFFIS wildfire layer…',
      detail: 'Nothing is drawn yet. An empty map here means we are still fetching, not that nothing has burnt.',
    };
  }

  if (state.kind === 'missing') {
    return {
      tone: 'gap',
      headline:
        'No fresh wildfire data — we could not load the Copernicus EFFIS layer.',
      detail:
        'Nothing is drawn here, and that is a gap in what we hold, not a statement that nothing has burnt.',
    };
  }

  if (state.kind === 'stale') {
    const when = formatInstant(state.meta.fetchedAt);
    // 🔴 A timestamp from the future is not an age, and `Math.abs` turned
    // one into "4 hours ago" — a confident sentence about a clock that is
    // wrong. Said as what it is instead, because the reader's question is
    // "can I trust this", and "our copy is dated ahead of now" answers it.
    const ahead = state.hoursOld < 0;
    const age = Number.isFinite(state.hoursOld)
      ? `${Math.round(Math.abs(state.hoursOld))} hours`
      : 'an unknown time';
    const clock = ahead
      ? `is dated ${age} in the future, which means a clock somewhere is wrong`
      : `was ${age} ago, past our ${FRESH_FOR_HOURS}-hour budget`;
    return {
      tone: 'gap',
      headline: 'No fresh wildfire data.',
      detail:
        `We last read Copernicus EFFIS successfully ${when ? `on ${when}, and that ` : ''}` +
        `${clock}, so the perimeters are off the map rather than sitting there looking current. ` +
        'Nothing is drawn, and that is a gap in what we hold, not a statement that nothing has burnt.',
    };
  }

  const { meta } = state;
  // 🔴 What the figure is, what it is not, and whose job an official
  // notice is. The last sentence comes out of the FEED rather than out of
  // this file, for the same reason the credit does: it is a licence
  // obligation, and an obligation hard-coded in a component is one nobody
  // re-reads when the terms change.
  const caveat =
    'Copernicus maps burnt scars of roughly 30 hectares and up, a day or so behind the satellite, so this is context for planning a trip rather than a live picture — where to drive is your call. ' +
    meta.authorityNote;
  const total = state.fires.length;
  const from = formatDay(meta.since);
  const to = formatInstant(meta.fetchedAt);
  const period = from && to ? `between ${from} and ${to}` : `in the last ${meta.windowDays} days`;

  if (total === 0) {
    return {
      tone: 'gap',
      headline: `Copernicus EFFIS recorded no burnt areas across the EU-27 ${period}.`,
      detail: `That is what the published data says for this window, not an all-clear. ${caveat}`,
    };
  }

  if (inView === 0) {
    return {
      tone: 'quiet',
      headline: `None of the ${n(total)} burnt areas Copernicus EFFIS recorded across the EU-27 ${period} is in this view.`,
      detail: `We hold the whole EU-27 set for this window, so none was recorded here — pan or zoom out to see where they were. ${caveat}`,
    };
  }

  const here =
    inView === null
      ? ''
      : ` ${n(inView)} ${inView === 1 ? 'is' : 'are'} in this view.`;

  return {
    tone: 'quiet',
    headline: `Copernicus EFFIS recorded ${n(total)} burnt ${total === 1 ? 'area' : 'areas'} across the EU-27 ${period}.${here}`,
    detail: caveat,
  };
}

/** The bounding box of one fire, for "is it in this view". */
export function bboxOf(f: WildfireFeature): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      west = Math.min(west, c[0]);
      east = Math.max(east, c[0]);
      south = Math.min(south, c[1]);
      north = Math.max(north, c[1]);
      return;
    }
    for (const part of c) walk(part);
  };
  walk(f.geometry.coordinates);
  return [west, south, east, north];
}

/**
 * How many fires fall in the box the reader is looking at.
 *
 * 🔴 Counted from the geometry we hold rather than from what MapLibre
 * happened to have painted. `queryRenderedFeatures` answers about the
 * last frame, returns the same polygon once per tile it crosses, and is
 * empty for a moment after every move — three ways for the sentence under
 * the map to disagree with the map, and CAMP-133 is this project's
 * record of what that costs.
 */
export function firesInView(
  fires: readonly WildfireFeature[],
  view: { west: number; south: number; east: number; north: number } | null,
): number | null {
  if (!view) return null;
  const finite = [view.west, view.south, view.east, view.north].every((v) =>
    Number.isFinite(v),
  );
  if (!finite) return null;
  let count = 0;
  for (const f of fires) {
    const [w, s, e, nth] = bboxOf(f);
    if (!Number.isFinite(w)) continue;
    // A view that has wrapped past the antimeridian is two boxes; Europe
    // never is one, but a reader who spins the globe should not get a
    // silently wrong number.
    const lonHit =
      view.west <= view.east
        ? e >= view.west && w <= view.east
        : e >= view.west || w <= view.east;
    if (lonHit && nth >= view.south && s <= view.north) count++;
  }
  return count;
}
