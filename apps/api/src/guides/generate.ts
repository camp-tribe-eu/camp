// CAMP-66 / CAMP-130: build the guides the data supports, and no others.
//
//   npx ts-node src/guides/generate.ts            # dry run
//   npx ts-node src/guides/generate.ts --apply
//
// 🔴 Dry run by default for the same reason the DATAtourisme importer is:
// this writes pages that get URLs, and a URL is a promise. It also
// REMOVES guides whose data has fallen below the threshold, which is the
// more dangerous half — see `retired` below.
//
// 🔴 CAMP-130 moved the weight of this file. It used to fetch three
// integers per region and hand them to a template. It now fetches what
// the region actually looks like — the named towns its campsites cluster
// around, the named rivers and lakes they sit beside, the named stations
// within walking distance, the spread of distances, the terrain and the
// height — because the measurement showed the pages were 0.59 similar to
// each other and no threshold on the integers was ever going to change
// that. `gatherFacts` is exported so the similarity measurement runs
// against the SAME rows this writes, rather than against a reconstruction
// of them.

import 'dotenv/config';
import { Client } from 'pg';
import {
  compose,
  dist,
  FAR,
  MIN_NAMED_FACTS,
  MIN_SUBJECTS,
  NEAR,
  slugFor,
  THEMES,
  worthPublishing,
} from './region-facts';
import type { Distances, NamedPlace, RegionFacts, Theme } from './region-facts';
import { mergedNameSql, mergedStarsSql, notSecondarySql } from '../spots/links';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/**
 * The name that goes in `guides.generator`.
 *
 * 🔴 Versioned on purpose. When the wording changes, the version changes,
 * and every page carries the version that produced it — so "which text
 * did a reader actually see in October" has an answer. Article 50 asks us
 * to disclose that a machine wrote it; being able to say WHICH machine
 * and when is the part that makes the disclosure worth anything.
 *
 * @2 is CAMP-130: the page speaks from the region's own measured
 * surroundings, and `unknown` stopped meaning "does not match".
 */
export const GENERATOR = 'region-facts@2';
export const CATEGORY = 'region';
export const LANGUAGE = 'en-GB';

/**
 * Rows live enough to count.
 *
 * 🔴 CAMP-144 folded a second source's rows into the campsites they
 * describe. A guide that says "Vaucluse has 214 campsites" is counting
 * pages a reader can open, so it counts what this predicate allows — and
 * because every guide query interpolates this one constant, the whole
 * file learned the rule in a single line. That is the only reason this
 * was cheap; the twenty queries in spots.service and map.service had to
 * be changed one at a time.
 *
 * Unqualified on purpose: `camping_spots` is the only table in every
 * statement that uses this. Adding a join to any of them means aliasing
 * it `s` and qualifying these two columns first.
 */
const LIVE = `region IS NOT NULL AND missing_since IS NULL
  AND ${notSecondarySql('camping_spots')}`;

/** How many named places a page lists per kind. */
const TOP = 5;
/** How many places the gap paragraph names. */
const TOP_GAP = 3;

/** Slug for a region, the same rule the campsite URLs use. */
export function regionSlug(region: string): string {
  return region
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const key = (country: string, region: string) => `${country}\u0000${region}`;

/** `context -> 'x' ->> 'm'` as an integer. */
const metres = (what: string) => `(context -> '${what}' ->> 'm')::int`;
const named = (what: string) => `context -> '${what}' ->> 'name'`;

// Counts come back as text on purpose: bigint in JSON is a rounding bug
// waiting for a region big enough to trigger it.
type Row = Record<string, string | boolean | null>;

function num(v: string | boolean | null | undefined): number {
  return typeof v === 'string' ? Number(v) : 0;
}

function str(v: string | boolean | null | undefined): string {
  return typeof v === 'string' ? v : '';
}

/** The three numbers that describe a distance across a group of rows. */
function distancesOf(r: Row, prefix: string): Distances {
  return {
    known: num(r[`${prefix}_known`]),
    within: num(r[`${prefix}_within`]),
    median: num(r[`${prefix}_median`]),
    beyond: num(r[`${prefix}_beyond`]),
  };
}

/**
 * The columns that turn one group of campsites into one page's numbers.
 *
 * 🔴 Every one of these is a count or a percentile over rows the
 * predicate already selected. Nothing here is derived from anything but
 * the table, which is why a page built from them can be labelled
 * `data-generated` without qualification.
 */
function aggregateColumns(theme: Theme): string {
  const spread = (what: string, near: number, far: number) => `
      count(*) FILTER (WHERE ${metres(what)} IS NOT NULL)::text AS ${what}_known,
      count(*) FILTER (WHERE ${metres(what)} <= ${near})::text AS ${what}_within,
      coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${metres(what)}), 0)::int::text AS ${what}_median,
      count(*) FILTER (WHERE ${metres(what)} > ${far})::text AS ${what}_beyond`;

  return [
    `count(*)::text AS subjects`,
    `count(DISTINCT ${named('town')})::text AS towns_named`,
    `count(DISTINCT ${named('water')})::text AS waters_named_distinct`,
    `count(*) FILTER (WHERE ${named('water')} IS NOT NULL)::text AS water_named`,
    `count(DISTINCT ${named('station')}) FILTER (WHERE ${metres('station')} <= ${NEAR.station})::text AS stations_named`,
    spread('town', NEAR.town, FAR.town),
    spread('water', NEAR.water, FAR.water),
    spread('station', NEAR.station, FAR.station),
    spread('supermarket', NEAR.shop, FAR.shop),
    `count(*) FILTER (WHERE context -> 'terrain' ->> 'type' IS NOT NULL)::text AS terrain_known`,
    `count(*) FILTER (WHERE context ->> 'elevation' IS NOT NULL)::text AS elevation_known`,
    `min((context ->> 'elevation')::int)::text AS elevation_low`,
    `max((context ->> 'elevation')::int)::text AS elevation_high`,
    `coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY (context ->> 'elevation')::int), 0)::int::text AS elevation_median`,
    ...theme.facets.map(
      (f, i) => `count(*) FILTER (WHERE ${f.predicate})::text AS facet_${i}`,
    ),
  ].join(',\n      ');
}

/** Most campsites first, then closest, then alphabetical — no ties left. */
function topPlaces(rows: Row[], limit: number): NamedPlace[] {
  return rows
    .map((r) => ({
      name: str(r.name),
      n: num(r.n),
      nearest: num(r.nearest),
      kind: typeof r.kind === 'string' ? r.kind : undefined,
      walk: r.walk === undefined ? undefined : num(r.walk),
    }))
    .sort(
      (a, b) =>
        b.n - a.n || a.nearest - b.nearest || a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

function bucket<T>(map: Map<string, T[]>, k: string, v: T): void {
  const list = map.get(k);
  if (list) list.push(v);
  else map.set(k, [v]);
}

export type GatherOptions = {
  /** Named example campsites cost one query per theme. Off for measuring. */
  withExamples?: boolean;
};

/**
 * Every (region, theme) pair the data can speak about, gated or not.
 *
 * 🔴 Returns the candidates, NOT the decision. `worthPublishing` is the
 * decision and the caller makes it, because CAMP-130's whole point is
 * that publishing 1359 pages is a choice somebody has to make on purpose
 * rather than a number a script arrived at.
 */
export async function gatherFacts(
  db: Client,
  opts: GatherOptions = {},
): Promise<RegionFacts[]> {
  const out: RegionFacts[] = [];

  for (const theme of THEMES) {
    const pred = theme.predicate;
    const rec = theme.recorded;

    // 1. The counts. `unknown` is rows where this question has NO
    //    recorded answer — not rows that fail the predicate. Those are
    //    different things and CAMP-130 found we had been printing the
    //    second while calling it the first.
    const counts = await db.query<Row>(`
      SELECT country, region,
             count(*) FILTER (WHERE ${pred})::text AS subjects,
             count(*)::text AS total,
             count(*) FILTER (WHERE NOT (${rec}) OR (${rec}) IS NULL)::text AS unknown
        FROM camping_spots
       WHERE ${LIVE}
       GROUP BY country, region`);

    // 2. The surroundings of the subjects, one row per region.
    const agg = await db.query<Row>(`
      SELECT country, region,
      ${aggregateColumns(theme)}
        FROM camping_spots
       WHERE ${LIVE} AND (${pred})
       GROUP BY country, region`);

    // 3-5. The named places, one row per place.
    const towns = await db.query<Row>(`
      SELECT country, region, ${named('town')} AS name,
             count(*)::text AS n, min(${metres('town')})::text AS nearest
        FROM camping_spots
       WHERE ${LIVE} AND (${pred}) AND ${named('town')} IS NOT NULL
       GROUP BY 1, 2, 3`);

    const waters = await db.query<Row>(`
      SELECT country, region, ${named('water')} AS name,
             context -> 'water' ->> 'kind' AS kind,
             count(*)::text AS n, min(${metres('water')})::text AS nearest,
             count(*) FILTER (WHERE ${metres('water')} <= ${NEAR.water})::text AS walk
        FROM camping_spots
       WHERE ${LIVE} AND (${pred}) AND ${named('water')} IS NOT NULL
       GROUP BY 1, 2, 3, 4`);

    const stations = await db.query<Row>(`
      SELECT country, region, ${named('station')} AS name,
             count(*)::text AS n, min(${metres('station')})::text AS nearest
        FROM camping_spots
       WHERE ${LIVE} AND (${pred})
         AND ${named('station')} IS NOT NULL
         AND ${metres('station')} <= ${NEAR.station}
       GROUP BY 1, 2, 3`);

    // 6-7. The breakdowns that are a fixed small vocabulary.
    const kinds = await db.query<Row>(`
      SELECT country, region, context -> 'water' ->> 'kind' AS kind,
             count(*)::text AS n
        FROM camping_spots
       WHERE ${LIVE} AND (${pred}) AND context -> 'water' ->> 'kind' IS NOT NULL
       GROUP BY 1, 2, 3`);

    const terrain = await db.query<Row>(`
      SELECT country, region, context -> 'terrain' ->> 'type' AS kind,
             count(*)::text AS n
        FROM camping_spots
       WHERE ${LIVE} AND (${pred}) AND context -> 'terrain' ->> 'type' IS NOT NULL
       GROUP BY 1, 2, 3`);

    // 8. Where the campsites that are NOT subjects sit, split by whether
    //    the question has an answer for them at all. The gap, located —
    //    see the honesty paragraph in region-facts.ts.
    const gaps = await db.query<Row>(`
      SELECT country, region, ${named('town')} AS name,
             (NOT (${rec}) OR (${rec}) IS NULL) AS unrecorded,
             count(*)::text AS n, min(${metres('town')})::text AS nearest
        FROM camping_spots
       WHERE ${LIVE}
         AND (NOT (${pred}) OR (${pred}) IS NULL)
         AND ${named('town')} IS NOT NULL
       GROUP BY 1, 2, 3, 4`);

    const at = (r: Row) => key(str(r.country), str(r.region));
    const byTown = new Map<string, Row[]>();
    for (const r of towns.rows) bucket(byTown, at(r), r);
    const byWater = new Map<string, Row[]>();
    for (const r of waters.rows) bucket(byWater, at(r), r);
    const byStation = new Map<string, Row[]>();
    for (const r of stations.rows) bucket(byStation, at(r), r);
    const byKind = new Map<string, Row[]>();
    for (const r of kinds.rows) bucket(byKind, at(r), r);
    const byTerrain = new Map<string, Row[]>();
    for (const r of terrain.rows) bucket(byTerrain, at(r), r);
    const byGap = new Map<string, Row[]>();
    const byOther = new Map<string, Row[]>();
    for (const r of gaps.rows)
      bucket(r.unrecorded === true ? byGap : byOther, at(r), r);
    const byAgg = new Map<string, Row>();
    for (const r of agg.rows) byAgg.set(at(r), r);

    for (const c of counts.rows) {
      const subjects = num(c.subjects);
      if (subjects === 0) continue;
      const k = at(c);
      const a = byAgg.get(k);
      if (!a) continue;

      const elevationKnown = num(a.elevation_known);
      out.push({
        country: str(c.country),
        region: str(c.region),
        theme,
        subjects,
        total: num(c.total),
        unknown: num(c.unknown),
        examples: [],
        surroundings: {
          towns: topPlaces(byTown.get(k) ?? [], TOP),
          townsNamed: num(a.towns_named),
          townDist: distancesOf(a, 'town'),

          waters: topPlaces(byWater.get(k) ?? [], TOP),
          waterNamed: num(a.water_named),
          waterKinds: (byKind.get(k) ?? [])
            .map((r) => ({ kind: str(r.kind), n: num(r.n) }))
            .sort((x, y) => y.n - x.n || x.kind.localeCompare(y.kind)),
          waterDist: distancesOf(a, 'water'),

          stations: topPlaces(byStation.get(k) ?? [], TOP),
          stationsNamed: num(a.stations_named),
          stationDist: distancesOf(a, 'station'),

          shopDist: distancesOf(a, 'supermarket'),

          terrain: (byTerrain.get(k) ?? [])
            .map((r) => ({ type: str(r.kind), n: num(r.n) }))
            .sort((x, y) => y.n - x.n || x.type.localeCompare(y.type)),
          terrainKnown: num(a.terrain_known),

          elevation:
            elevationKnown > 0
              ? {
                  low: num(a.elevation_low),
                  median: num(a.elevation_median),
                  high: num(a.elevation_high),
                }
              : null,
          elevationKnown,

          facets: theme.facets.map((f, i) => ({
            label: f.label,
            n: num(a[`facet_${i}`]),
          })),

          gapTowns: topPlaces(byGap.get(k) ?? [], TOP_GAP),
          otherTowns: topPlaces(byOther.get(k) ?? [], TOP_GAP),
        },
      });
    }

    if (opts.withExamples) {
      // One windowed query for the whole theme rather than one per page:
      // 5 queries, not 1359.
      const ex = await db.query<Row>(`
        SELECT country, region, name, slug, stars, town, town_m FROM (
          -- 🔴 CAMP-144: both read through the link. These are the five
          -- campsites a guide names, and "4 official stars" beside one of
          -- them is exactly the fact only the other source holds.
          SELECT country, region,
                 ${mergedNameSql('camping_spots')} AS name,
                 slug, ${mergedStarsSql('camping_spots')}::text AS stars,
                 ${named('town')} AS town, ${metres('town')}::text AS town_m,
                 row_number() OVER (
                   PARTITION BY country, region
                   ORDER BY (${mergedStarsSql('camping_spots')} IS NULL),
                            ${mergedStarsSql('camping_spots')} DESC,
                            ${mergedNameSql('camping_spots')}
                 ) AS rn
            FROM camping_spots
           WHERE ${LIVE} AND (${pred}) AND name IS NOT NULL
        ) ranked
         WHERE rn <= 5`);
      const byRegion = new Map<string, Row[]>();
      for (const r of ex.rows)
        bucket(byRegion, key(str(r.country), str(r.region)), r);
      for (const f of out) {
        if (f.theme.id !== theme.id) continue;
        f.examples = (byRegion.get(key(f.country, f.region)) ?? []).map((r) => {
          // 🔴 The detail is two facts or none. "4 official stars" is a
          // column; "near Gmunden, 900 m" is a column. Neither is a
          // description, because we do not have one to give.
          const bits: string[] = [];
          if (str(r.town)) {
            bits.push(`near ${str(r.town)}, ${dist(num(r.town_m))} out`);
          }
          if (str(r.stars)) bits.push(`${str(r.stars)} official stars`);
          return {
            name: str(r.name),
            slug: str(r.slug),
            detail: bits.length > 0 ? bits.join(', ') : null,
          };
        });
      }
    }
  }

  return out;
}

/**
 * `--min-subjects=N`, `--min-named=N`.
 *
 * 🔴 The defaults are the production rule and nothing here is meant to
 * relax it in production. They exist because the CI fixture is 72
 * campsites across five municipalities, and its richest region carries
 * five named facts against a gate of six — a gate sized for a 61 557-row
 * database. Rather than shrink the gate so a fixture can clear it, CI
 * says out loud which gate it is using. The gate itself is proved by
 * `region-facts.spec.ts`, not by the fixture.
 */
function flag(name: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const n = Number(arg.split('=')[1]);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`--${name} wants a number, got "${arg.split('=')[1]}"`);
  }
  return n;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const minSubjects = flag('min-subjects', MIN_SUBJECTS);
  const minNamed = flag('min-named', MIN_NAMED_FACTS);
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  try {
    const candidates = await gatherFacts(db, { withExamples: true });
    const wanted = new Map<string, RegionFacts>();
    for (const f of candidates) {
      if (!worthPublishing(f, minSubjects, minNamed)) continue;
      wanted.set(slugFor(f, regionSlug(f.region)), f);
    }

    const existing = await db.query<{ slug: string }>(
      `SELECT slug FROM guides WHERE generator LIKE 'region-facts@%'`,
    );
    const have = new Set<string>(existing.rows.map((r) => r.slug));

    const fresh = [...wanted.keys()].filter((s) => !have.has(s));
    /**
     * 🔴 Guides whose data fell below the threshold.
     *
     * These are RETIRED, not deleted: a published URL that starts
     * answering 404 is a broken promise to whoever linked to it, and
     * CAMP-87 has rules about that. Setting status to `archived` takes
     * the page out of the index and the sitemap while leaving the row —
     * the 410 path decides the rest.
     */
    const retired = [...have].filter((s) => !wanted.has(s));

    const bySubjects = candidates.filter((f) => f.subjects >= minSubjects);
    console.log(`themes          ${THEMES.length}`);
    console.log(`region/theme pairs with any data  ${candidates.length}`);
    console.log(
      `  with at least ${minSubjects} campsites      ${bySubjects.length}`,
    );
    console.log(`  and at least ${minNamed} named facts    ${wanted.size}`);
    if (minSubjects !== MIN_SUBJECTS || minNamed !== MIN_NAMED_FACTS) {
      console.log(
        `  ⚠ not the production gate (${MIN_SUBJECTS} campsites, ${MIN_NAMED_FACTS} named facts)`,
      );
    }
    console.log(`  new                             ${fresh.length}`);
    console.log(
      `  already published               ${wanted.size - fresh.length}`,
    );
    console.log(`  to retire                       ${retired.length}`);

    if (!apply) {
      console.log('\nfirst few:');
      for (const slug of fresh.slice(0, 8)) {
        console.log(`  ${slug}  —  ${compose(wanted.get(slug)!).title}`);
      }
      console.log('\n(dry run — nothing was written. Add --apply to write.)');
      return;
    }

    await db.query('BEGIN');
    for (const [slug, facts] of wanted) {
      const { title, summary, body } = compose(facts);
      // 🔴 provenance and generator are not optional here either: the
      // database refuses the row without them, and this is the only
      // place that writes these guides.
      const res = await db.query<{ id: string }>(
        `
        INSERT INTO guides (slug, category, status, provenance, generator,
                            reading_minutes, facts_checked_at, published_at)
        VALUES ($1, $2, 'published', 'data-generated', $3, 1, CURRENT_DATE, now())
        ON CONFLICT (slug) DO UPDATE SET
          status           = 'published',
          facts_checked_at = CURRENT_DATE,
          generator        = EXCLUDED.generator
        RETURNING id
        `,
        [slug, CATEGORY, GENERATOR],
      );
      const id = res.rows[0].id;

      await db.query(
        `
        INSERT INTO guide_translations (guide_id, language_code, title, summary, body)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (guide_id, language_code) DO UPDATE SET
          title = EXCLUDED.title, summary = EXCLUDED.summary, body = EXCLUDED.body
        `,
        [id, LANGUAGE, title, summary, body],
      );
    }

    if (retired.length > 0) {
      await db.query(
        `UPDATE guides SET status = 'archived' WHERE slug = ANY($1::text[])`,
        [retired],
      );
    }

    await db.query('COMMIT');
    console.log(`\n✓ ${wanted.size} published, ${retired.length} archived`);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
