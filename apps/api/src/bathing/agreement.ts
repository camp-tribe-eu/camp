// CAMP-168: the arithmetic behind the radius argument, kept apart from the
// SQL so that the labels a report prints and the numbers under them are
// one thing a test can check.
//
// 🔴 WHY THIS FILE EXISTS. The first report printed, under the label
// "up to 2 000 m", the agreement of the 1 500–2 000 m BAND ALONE (63.3%).
// The share of campsites within 2 km whose nearest bathing water agrees
// with the kind of water we already name is 79.9%. Both numbers were
// right; the label made one of them the other. Here a band and a
// cumulative figure are different fields with different names, and the
// script that prints them asserts that its cumulative counts equal the
// coverage sweep's — the two come from different queries, so agreement
// between them is a check rather than a restatement.
//
// 🔴 AND WHY IT STANDARDISES. Agreement falls with distance in the raw
// figures, but the MIX of campsites falls with it too: the coastal share
// of a band drops from 45.7% to 7.5% between 0–500 m and 4.5–5 km while
// the river share rises from 20.0% to 54.3%, and rivers agree far less
// often than the sea does whatever the distance. A raw curve therefore
// mixes "how far" with "who is in the band". The standardised column
// takes each kind's own agreement in each band and re-weights it to one
// fixed mix — the innermost band's — so that only distance is left to
// move it.

/** Width of a distance band, metres. Band `b` covers (b − 500, b]. */
export const BAND_M = 500;

export const STRATA = ['sea', 'lake', 'river'] as const;
export type Stratum = (typeof STRATA)[number];

/**
 * CAMP-33's computed water kind → the stratum agreement is judged in.
 *
 * `reservoir` joins `lake`: the EEA files a reservoir's bathing waters as
 * Lake. Anything else (or nothing) is `null`, and is COUNTED as excluded,
 * never silently treated as a disagreement — every one of the 61 558
 * campsites carries one of the four kinds today, so the excluded count
 * printed beside the table is the proof that this branch costs nothing.
 */
export function stratumOf(kind: string | null | undefined): Stratum | null {
  switch (kind) {
    case 'sea':
      return 'sea';
    case 'lake':
    case 'reservoir':
      return 'lake';
    case 'river':
      return 'river';
    default:
      return null;
  }
}

/**
 * Whether an EEA category is what that kind of water would be filed as.
 * `Transitional` (an estuary) is both: it agrees with sea and with river.
 */
export function agrees(stratum: Stratum, category: string): boolean {
  switch (stratum) {
    case 'sea':
      return category === 'Coastal' || category === 'Transitional';
    case 'lake':
      return category === 'Lake';
    case 'river':
      return category === 'River' || category === 'Transitional';
  }
}

/** One (band, kind, category) cell of the query result. */
export interface CountRow {
  /** Upper edge of the band, metres: 500, 1000, … */
  band: number;
  kind: string | null;
  category: string;
  n: number;
}

export interface StratumCell {
  n: number;
  agree: number;
  /** Share of this band's classified-kind campsites that are this kind, 0–1. */
  share: number;
  /** Agreement inside this kind, percent; null when the kind has no campsites here. */
  pct: number | null;
}

export interface BandLine {
  from: number;
  to: number;
  /** THIS BAND ONLY. */
  n: number;
  agree: number;
  pct: number;
  /** Campsites in this band whose water kind is none of the four. */
  excluded: number;
  strata: Record<Stratum, StratumCell>;
  /**
   * Percent. Each kind's own agreement in this band, re-weighted to the
   * innermost band's mix. Null when a kind that mix needs has no
   * campsites in this band — undefined is not zero.
   */
  standardised: number | null;
  /**
   * Percent. What `standardised` would read if the category of the
   * nearest bathing water were unrelated to the campsite's water kind,
   * with the same weights: Σ weight(kind) × share of the band's nearest
   * waters that this kind would accept. It is a floor for "no signal",
   * not a claim about any campsite.
   */
  chance: number | null;
  /** EVERYTHING up to and including this band. */
  cumulative: { n: number; excluded: number; agree: number; pct: number };
}

export interface Summary {
  /** The fixed mix (innermost band) the standardised column uses. */
  weights: Record<Stratum, number>;
  lines: BandLine[];
}

const emptyStrata = (): Record<Stratum, { n: number; agree: number }> => ({
  sea: { n: 0, agree: 0 },
  lake: { n: 0, agree: 0 },
  river: { n: 0, agree: 0 },
});

export function summarise(rows: CountRow[]): Summary {
  const bands = [...new Set(rows.map((r) => r.band))].sort((a, b) => a - b);

  interface Acc {
    strata: Record<Stratum, { n: number; agree: number }>;
    excluded: number;
    /** Category counts over the band's classified-kind rows. */
    categories: Map<string, number>;
  }
  const acc = new Map<number, Acc>();
  for (const b of bands) {
    acc.set(b, { strata: emptyStrata(), excluded: 0, categories: new Map() });
  }
  for (const r of rows) {
    const a = acc.get(r.band)!;
    const stratum = stratumOf(r.kind);
    if (stratum === null) {
      a.excluded += r.n;
      continue;
    }
    a.strata[stratum].n += r.n;
    if (agrees(stratum, r.category)) a.strata[stratum].agree += r.n;
    a.categories.set(r.category, (a.categories.get(r.category) ?? 0) + r.n);
  }

  const first = bands.length ? acc.get(bands[0])! : null;
  const firstN = first ? STRATA.reduce((t, s) => t + first.strata[s].n, 0) : 0;
  const weights = Object.fromEntries(
    STRATA.map((s) => [s, first && firstN ? first.strata[s].n / firstN : 0]),
  ) as Record<Stratum, number>;

  let cumN = 0;
  let cumAgree = 0;
  let cumExcluded = 0;
  const lines: BandLine[] = [];

  for (const b of bands) {
    const a = acc.get(b)!;
    const n = STRATA.reduce((t, s) => t + a.strata[s].n, 0);
    const agree = STRATA.reduce((t, s) => t + a.strata[s].agree, 0);

    const strata = Object.fromEntries(
      STRATA.map((s) => [
        s,
        {
          n: a.strata[s].n,
          agree: a.strata[s].agree,
          share: n ? a.strata[s].n / n : 0,
          pct: a.strata[s].n ? (100 * a.strata[s].agree) / a.strata[s].n : null,
        },
      ]),
    ) as Record<Stratum, StratumCell>;

    // A kind the fixed mix needs, absent from this band, makes the
    // standardised figure undefined rather than quietly lower.
    const needed = STRATA.filter((s) => weights[s] > 0);
    const definable = needed.every((s) => a.strata[s].n > 0);

    const standardised = definable
      ? 100 *
        needed.reduce(
          (t, s) => t + (weights[s] * a.strata[s].agree) / a.strata[s].n,
          0,
        )
      : null;

    const accepted = (s: Stratum): number => {
      let k = 0;
      for (const [category, count] of a.categories) {
        if (agrees(s, category)) k += count;
      }
      return n ? k / n : 0;
    };
    const chance = definable
      ? 100 * needed.reduce((t, s) => t + weights[s] * accepted(s), 0)
      : null;

    cumN += n;
    cumAgree += agree;
    cumExcluded += a.excluded;

    lines.push({
      from: b - BAND_M,
      to: b,
      n,
      agree,
      pct: n ? (100 * agree) / n : 0,
      excluded: a.excluded,
      strata,
      standardised,
      chance,
      cumulative: {
        n: cumN,
        excluded: cumExcluded,
        agree: cumAgree,
        pct: cumN ? (100 * cumAgree) / cumN : 0,
      },
    });
  }

  return { weights, lines };
}

export interface Mismatch {
  radius: number;
  sweep: number;
  bands: number;
}

/**
 * The band table's cumulative counts against the radius sweep's.
 *
 * The two come from different queries. A band label that meant something
 * other than what it said, or an edge convention that put a campsite in
 * the wrong band, shows up here as a radius where they disagree. Radii
 * that are not a band edge (250 m) cannot be compared and are skipped;
 * the caller prints how many were.
 */
export function reconcile(
  lines: BandLine[],
  sweep: { radius: number; within: number }[],
): { compared: number; mismatches: Mismatch[] } {
  const byEdge = new Map(lines.map((l) => [l.to, l]));
  const mismatches: Mismatch[] = [];
  let compared = 0;
  for (const { radius, within } of sweep) {
    const line = byEdge.get(radius);
    if (!line) continue;
    compared++;
    const bands = line.cumulative.n + line.cumulative.excluded;
    if (bands !== within) mismatches.push({ radius, sweep: within, bands });
  }
  return { compared, mismatches };
}
