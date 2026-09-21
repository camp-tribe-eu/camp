// CAMP-33: the shape of a campsite's computed surroundings.
//
// 🔴 Why this is a differentiator and not a nice-to-have: Park4Night,
// Campercontact and ACSI do not publish any of it. It is original data we
// derive ourselves, it is exactly the kind of concrete fact an assistant
// quotes back to a person who asked "a campsite by a lake near Bled", and
// it is the only thing carrying our pages while we have no photographs.
//
// Everything here is nullable on purpose. A campsite with no railway
// station within reach is a fact worth showing; an invented number is
// not. Same rule as the tri-state amenities in CAMP-27.

/** Water worth mentioning — a drainage ditch is not a feature. */
export type WaterKind = 'sea' | 'lake' | 'reservoir' | 'river';

export interface NearestFeature {
  /** Straight-line metres. Never a driving distance, and never rounded up. */
  m: number;
  name?: string;
}

export interface NearestWater extends NearestFeature {
  kind: WaterKind;
}

/**
 * Relief is the height difference sampled around the site, not the
 * steepness under it. Thresholds are measured, not guessed — see
 * `classifyTerrain`.
 */
export type TerrainType = 'flat' | 'rolling' | 'hilly' | 'mountainous';

export interface SpotContext {
  /** Nearest lake, reservoir, river or coastline. */
  water?: NearestWater;
  /** Nearest place=city or place=town. Villages excluded: too many. */
  town?: NearestFeature;
  supermarket?: NearestFeature;
  station?: NearestFeature;
  /** Metres above sea level, from the Copernicus DEM. */
  elevation?: number;
  terrain?: { relief: number; type: TerrainType };
  /**
   * The coordinates these numbers were computed at. If the campsite moves
   * in a later OSM import, the stored context is about the old location
   * and has to be recomputed — without this there is no way to notice.
   */
  at?: { lat: number; lon: number };
}

/**
 * Relief in metres → a word a reader understands.
 *
 * Relief is max minus min elevation over eight points on a 1 km circle
 * plus the centre, so it describes the bowl the campsite sits in rather
 * than the slope of its own ground.
 *
 * 🔴 The thresholds are ABSOLUTE metres, deliberately not quantiles of
 * our own data. Quantiles were the obvious first idea and they are
 * wrong: each class would hold a quarter of whatever we happen to have
 * imported, so the same meadow would be described as "hilly" today and
 * "mountainous" the week we add the Netherlands. A label that moves when
 * a different country is loaded is not a fact about the campsite.
 *
 * The bands are physical instead. Over a 1 km radius: under 25 m is flat
 * ground, 25–70 m is gently rolling, 70–150 m is hilly, and a rise over
 * 150 m within a kilometre is a mountainside.
 *
 * Measured on Slovenia (292 sites, quartiles 64 / 134 / 252 m, range
 * 4–941) this yields flat 20, rolling 60, hilly 77, mountainous 135.
 * An alpine country skewing mountainous is the right answer, not a
 * miscalibration — and that is precisely what a quantile split would
 * have hidden.
 */
export function classifyTerrain(relief: number): TerrainType {
  if (relief < 25) return 'flat';
  if (relief < 70) return 'rolling';
  if (relief < 150) return 'hilly';
  return 'mountainous';
}

/** Human-facing distance. 98 m stays 98 m; 2616 m becomes 2.6 km. */
export function formatDistance(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

export const WATER_LABEL: Record<WaterKind, string> = {
  sea: 'sea',
  lake: 'lake',
  reservoir: 'reservoir',
  river: 'river',
};

export const TERRAIN_LABEL: Record<TerrainType, string> = {
  flat: 'Flat',
  rolling: 'Rolling',
  hilly: 'Hilly',
  mountainous: 'Mountainous',
};
