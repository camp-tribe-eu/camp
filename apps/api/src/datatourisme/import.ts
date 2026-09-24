// CAMP-101: put a DATAtourisme regional file into the database.
//
//   npx ts-node src/datatourisme/import.ts <file.csv>            # dry run
//   npx ts-node src/datatourisme/import.ts <file.csv> --apply
//
// 🔴 A dry run by default, and that is not caution for its own sake.
// This importer can MERGE a record into a campsite that already has a
// page and a URL. A wrong merge publishes one business's description and
// official star rating on another's page. The default therefore prints
// what it would do and writes nothing, and `--apply` is a deliberate act.
//
// 🔴 The merge rule, in one line: DATAtourisme FILLS GAPS, it never
// overwrites. The two sources are good at different things — measured,
// not assumed:
//
//               OSM (Slovenia, 448)     DATAtourisme (PACA, 478)
//   name        26% missing             100% present
//   stars       not carried at all      91%
//   description not carried at all      99%
//   website     sparse                  94%
//   email       ~10 000 across Europe   0%
//   geometry    real polygons           a single point
//
// So the point stays OSM's, the amenities stay OSM's, and a name we
// already have is left alone; description and stars can only come from
// here; name and website are filled only where we have none. Nothing
// that a human or an owner supplied is ever touched — `owner_overrides`
// is not read or written by this file at all.

import 'dotenv/config';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Client } from 'pg';
import { isCampsite, parseRow } from './parse';
import type { DatatourismeRow, ParsedSpot } from './parse';
import { decide, metresApart } from './match';
import type { Candidate, Decision } from './match';

/**
 * How close two records from one file must be before a person looks.
 *
 * 🔴 Deliberately much tighter than the matcher's 400 m outer radius,
 * because this is a different question. That radius asks "could these be
 * the same campsite seen by two sources"; this asks "did one publisher
 * list one place twice", and at 50 m in a single tourism feed the answer
 * is usually yes. Measured against the 11 French regional files on
 * 24.09.2026 — see the import report, which prints every pair it holds
 * back rather than counting them silently.
 */
const SAME_PLACE_METRES = 50;
import { splitCsvLine } from './report-coverage';

const SOURCE_ID = 'datatourisme';
const COUNTRY = 'FR';
const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/** Latin-ish slug, the same shape the OSM import produces. */
export function slugify(name: string, ref: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  // The ref is a URI; its last path segment is the stable uuid.
  return base || `spot-${ref.split('/').pop() ?? 'unknown'}`;
}

/**
 * One record per source URI, keeping the first.
 *
 * 🔴 The URI is DATAtourisme's own stable identifier for a POI, so two
 * rows carrying the same one are the same campsite however they differ.
 * Deduplicating here rather than at insert time means the counts printed
 * by a dry run are the counts a real run will write.
 */
export function dedupeByRef<T extends { ref: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.ref)) continue;
    seen.add(row.ref);
    out.push(row);
  }
  return out;
}

/** A slug nobody else is using. Suffixes are stable for a given order. */
export function uniqueSlug(wanted: string, used: Set<string>): string {
  if (!used.has(wanted)) {
    used.add(wanted);
    return wanted;
  }
  for (let n = 2; ; n++) {
    const candidate = `${wanted}-${n}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

export type Plan = {
  same: {
    spot: ParsedSpot;
    decision: Extract<Decision, { verdict: 'same' }>;
  }[];
  fresh: ParsedSpot[];
  review: {
    spot: ParsedSpot;
    decision: Extract<Decision, { verdict: 'review' }>;
  }[];
  /**
   * Records that duplicate another record from the SAME file.
   *
   * Kept apart from `same` because they are a different fact: `same`
   * means we already had this campsite, this means the source published
   * it twice under two identifiers.
   */
  duplicates: {
    spot: ParsedSpot;
    decision: Extract<Decision, { verdict: 'same' }>;
  }[];
};

/**
 * Work out what to do with every parsed record.
 *
 * Pure given a candidate lookup, so the whole decision layer can be
 * driven in a test without a database.
 *
 * 🔴 A record is matched against the database AND against the records
 * already accepted from this same file.
 *
 * The database half was all there was, and it has a blind spot with a
 * name: candidates are read once, before anything is written, so two
 * rows describing one campsite inside a single file never meet. The
 * matcher — the whole apparatus of distance and name similarity that
 * exists to answer exactly this question — was simply never asked.
 *
 * Found on 24.09.2026 by the near-duplicate page guard, not by this
 * importer: `Camping aux Prairies de Pacouinay` and
 * `Emplacement camping-car - Camping chez l'habitant Les Prairies de
 * Pacouinay`, 21 metres apart in the Vendée file, published as two pages
 * that are 84.5% identical. DATAtourisme lists a campsite and its
 * motorhome pitch as separate POIs with separate URIs, so dedupeByRef
 * cannot see them either.
 *
 * The rule applied is the same `decide` used against the database — not
 * a second, looser one invented here. A verdict of `same` collapses into
 * the record already accepted; `review` keeps both and says so, because
 * two campsites really can share a car park.
 */
export function plan(
  spots: ParsedSpot[],
  candidatesNear: (s: ParsedSpot) => Candidate[],
): Plan {
  const out: Plan = { same: [], fresh: [], review: [], duplicates: [] };
  /** Records accepted from this file, as candidates for the next one. */
  const accepted: Candidate[] = [];

  for (const spot of spots) {
    const d = decide(
      { name: spot.name, lat: spot.lat, lon: spot.lon },
      candidatesNear(spot),
    );
    if (d.verdict === 'same') {
      out.same.push({ spot, decision: d });
      continue;
    }
    if (d.verdict === 'review') {
      out.review.push({ spot, decision: d });
      continue;
    }

    // Nothing in the database matches. Does anything already taken from
    // this file?
    const withinFile = decide(
      { name: spot.name, lat: spot.lat, lon: spot.lon },
      accepted,
    );
    if (withinFile.verdict === 'same') {
      out.duplicates.push({ spot, decision: withinFile });
      continue;
    }
    if (withinFile.verdict === 'review') {
      out.review.push({ spot, decision: withinFile });
      continue;
    }

    // 🔴 One extra rule, and only inside a single file.
    //
    // `decide` was measured for OSM against DATAtourisme, where two
    // sources describe the world independently and a near-miss on the
    // name is ordinary. Its thresholds are not touched here.
    //
    // Within ONE publisher's own file the prior is different. The pair
    // that exposed this sits 21 m apart — `Camping aux Prairies de
    // Pacouinay` and `Emplacement camping-car - Camping chez l'habitant
    // Les Prairies de Pacouinay` — and decide's verdict was, correctly
    // by its own rules, "nearest is 21 m away and named differently".
    // Two independent businesses 21 m apart is possible; one tourist
    // office listing a campsite and its motorhome pitch twice is far
    // likelier, and only a person can tell which.
    //
    // So: too close to publish blind, not similar enough to merge
    // blind — that is precisely what the review pile is for. It costs
    // nothing when the answer is "genuinely two", and it is the only
    // thing that stops us publishing two pages about one business.
    const tooCloseToPublishBlind = accepted
      .map((c) => metresApart({ lat: spot.lat, lon: spot.lon }, c))
      .some((m) => m <= SAME_PLACE_METRES);
    if (tooCloseToPublishBlind) {
      out.review.push({
        spot,
        decision: {
          verdict: 'review',
          why: `another record in this same file is within ${SAME_PLACE_METRES} m`,
        } as Extract<Decision, { verdict: 'review' }>,
      });
      continue;
    }

    out.fresh.push(spot);
    accepted.push({
      id: spot.ref,
      name: spot.name,
      lat: spot.lat,
      lon: spot.lon,
    });
  }
  return out;
}

/** The source entry this import stamps on every record it touches. */
export function sourceEntry(spot: ParsedSpot, fields: string[]) {
  return {
    id: SOURCE_ID,
    ref: spot.ref,
    updatedAt: spot.updatedAt,
    fields,
  };
}

/**
 * Which fields this record is allowed to contribute to an existing spot.
 *
 * 🔴 Gap-filling only. `stars` and `description` are unconditional
 * because no other source carries them; everything else is offered only
 * where we hold nothing.
 */
export function fieldsToFill(
  spot: ParsedSpot,
  existing: { name: string | null; website: string | null },
): string[] {
  const fields: string[] = [];
  if (spot.stars !== null) fields.push('stars');
  if (spot.description) fields.push('description');
  if (spot.name && !existing.name) fields.push('name');
  if (spot.website && !existing.website) fields.push('website');
  return fields;
}

// ---------------------------------------------------------------------

async function readCampsites(path: string): Promise<ParsedSpot[]> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let header: string[] | null = null;
  let pending = '';
  const out: ParsedSpot[] = [];

  for await (const line of rl) {
    pending = pending ? `${pending}\n${line}` : line;
    if ((pending.match(/"/g) ?? []).length % 2 !== 0) continue;
    const fields = splitCsvLine(pending);
    pending = '';
    if (!header) {
      header = fields.map((f) => f.trim());
      continue;
    }
    const row: DatatourismeRow = {};
    header.forEach((h, i) => (row[h] = fields[i]));
    if (!isCampsite(row)) continue;
    const spot = parseRow(row);
    if (spot) out.push(spot);
  }
  return out;
}

async function main() {
  const path = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!path) {
    console.error('usage: import.ts <file.csv> [--apply]');
    process.exit(1);
  }

  const parsed = await readCampsites(path);
  console.log(`${parsed.length} campsites parsed from ${path}`);
  if (parsed.length === 0) {
    console.error('✗ nothing parsed — refusing to continue');
    process.exit(1);
  }

  // 🔴 The same POI can appear twice in one regional file.
  //
  // Found on 24.09.2026 in ara.csv: 14 URIs published twice, the rows
  // byte-identical. Nothing downstream would have caught it. Candidates
  // are fetched once, BEFORE any insert, so the second copy never sees
  // the first and both get written — two campsites at one point with one
  // name, which is also exactly the pair the near-duplicate guard would
  // later flag as two pages saying the same thing.
  //
  // PACA and Occitanie happened to carry no repeats, so the importer has
  // run twice without meeting this. "It has not happened yet" is not the
  // same as "it cannot happen".
  //
  // First occurrence wins: the rows are identical where we have looked,
  // so there is nothing to choose between them, and picking the first is
  // the only rule that gives the same result on every run.
  const spots = dedupeByRef(parsed);
  if (spots.length !== parsed.length) {
    console.log(
      `  ${parsed.length - spots.length} duplicate record(s) in the file, collapsed`,
    );
  }

  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  try {
    // Candidates for every record in one query rather than 2000 of them.
    // 400 m is the matcher's outer radius; anything further can never be
    // the same campsite whatever it is called.
    const near = await db.query<{
      ref: string;
      id: string;
      name: string | null;
      lat: number;
      lon: number;
    }>(
      `
      WITH incoming AS (
        SELECT * FROM unnest($1::text[], $2::float8[], $3::float8[])
          AS t(ref, lat, lon)
      )
      SELECT i.ref,
             s.id::text AS id,
             s.name,
             ST_Y(s.location::geometry) AS lat,
             ST_X(s.location::geometry) AS lon
        FROM incoming i
        JOIN camping_spots s
          ON ST_DWithin(
               s.location::geography,
               ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)::geography,
               400)
      `,
      [
        spots.map((s) => s.ref),
        spots.map((s) => s.lat),
        spots.map((s) => s.lon),
      ],
    );

    const byRef = new Map<string, Candidate[]>();
    for (const r of near.rows) {
      const list = byRef.get(r.ref) ?? [];
      list.push({
        id: r.id,
        name: r.name,
        lat: Number(r.lat),
        lon: Number(r.lon),
      });
      byRef.set(r.ref, list);
    }

    const p = plan(spots, (s) => byRef.get(s.ref) ?? []);

    console.log('');
    console.log(`  merge into an existing campsite   ${p.same.length}`);
    console.log(`  new campsites                     ${p.fresh.length}`);
    console.log(`  the source published twice        ${p.duplicates.length}`);
    console.log(`  left for a human to look at       ${p.review.length}`);

    // Printed rather than counted silently: these are pages we chose not
    // to publish, and the reason is a judgement about somebody else's
    // data. It should be readable, not buried in a number.
    if (p.duplicates.length > 0) {
      console.log('\n  same campsite, listed twice in this file:');
      for (const { spot, decision } of p.duplicates.slice(0, 10)) {
        console.log(
          `    ${spot.name} — ${decision.metres} m from the one kept, ` +
            `${Math.round(decision.similarity * 100)}% alike`,
        );
      }
      if (p.duplicates.length > 10)
        console.log(`    … and ${p.duplicates.length - 10} more`);
    }

    if (p.review.length > 0) {
      console.log('\n  needs a look:');
      for (const { spot, decision } of p.review.slice(0, 15)) {
        console.log(
          `    ${spot.name.padEnd(42).slice(0, 42)} ${String(decision.metres).padStart(4)} m  sim ${decision.similarity}  ${decision.why}`,
        );
      }
      if (p.review.length > 15)
        console.log(`    … and ${p.review.length - 15} more`);
    }

    if (!apply) {
      console.log('\n(dry run — nothing was written. Add --apply to write.)');
      return;
    }

    const used = new Set<string>(
      (
        await db.query<{ slug: string }>('SELECT slug FROM camping_spots')
      ).rows.map((r) => r.slug),
    );

    await db.query('BEGIN');
    let merged = 0;
    let inserted = 0;

    for (const { spot, decision } of p.same) {
      const existing = await db.query<{
        name: string | null;
        website: string | null;
      }>(`SELECT name, website FROM camping_spots WHERE id = $1`, [
        decision.id,
      ]);
      const fields = fieldsToFill(
        spot,
        existing.rows[0] ?? { name: null, website: null },
      );
      if (fields.length === 0) continue;

      await db.query(
        `
        UPDATE camping_spots SET
          name             = COALESCE(name, $2),
          description      = COALESCE($3, description),
          description_lang = CASE WHEN $3 IS NULL THEN description_lang ELSE 'fr' END,
          stars            = COALESCE($4, stars),
          website          = COALESCE(website, $7),
          sources          = (
            SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) || $5::jsonb
              FROM jsonb_array_elements(sources) e
             WHERE e->>'id' <> $6
          ),
          content_changed_at = now()
        WHERE id = $1
        `,
        [
          decision.id,
          spot.name,
          spot.description,
          spot.stars,
          JSON.stringify([sourceEntry(spot, fields)]),
          SOURCE_ID,
          spot.website,
        ],
      );
      merged++;
    }

    for (const spot of p.fresh) {
      const slug = uniqueSlug(slugify(spot.name, spot.ref), used);
      const fields = fieldsToFill(spot, { name: null, website: null });
      fields.push('location');
      await db.query(
        `
        INSERT INTO camping_spots
          (name, country, region, slug, type, amenities, location,
           description, description_lang, stars, website, sources, last_seen_at)
        SELECT $1::text, $2::text,
               -- Natural Earth's admin-1 for France is the département
               -- (Var, Vaucluse…), not the région. That is the better
               -- unit for us anyway: it is how French readers search,
               -- and it keeps the hub pages the same size as elsewhere.
               -- 🔴 Containment first, then the nearest polygon within
               -- 15 km — a campsite on a spit, an island or right on a
               -- coastline falls outside every polygon, and a row with
               -- no region gets no page URL at all. The first run lost
               -- 9 of 478 French campsites exactly this way.
               --
               -- 🔴 15 km, not the 5 km this started with, and the
               -- number is measured rather than chosen.
               --
               -- 5 km left two real campsites with no page: Île Molène
               -- in the Iroise Sea and an island site off the Morbihan
               -- coast, 10.0 km and 10.5 km from the nearest polygon.
               -- Natural Earth's coastlines are simplified, so small
               -- islands are simply not in them.
               --
               -- Measured across all 9 441 French campsites on
               -- 24.09.2026: 433 fall outside every polygon, 431 of them
               -- within 5 km, exactly those 2 between 5 and 15 km, and
               -- NOTHING beyond 15 km at all — the furthest is 10.5 km.
               -- So this widening picks up precisely the two islands and
               -- can reach nothing else. Both resolve to the correct
               -- département (Finistère, Morbihan), which is also the
               -- administratively right answer for those islands.
               -- 🔴 The region's NAME, not a slug of it.
               --
               -- The first version slugified the name right here, which
               -- put French regions in a different shape from every
               -- other country: OSM stores
               -- "Primorsko-Goranska" and this stored "bouches-du-rh-ne":
               -- the accented letter became a dash, so both the page
               -- heading and the URL would have read "rh-ne", and the two
               -- sources would have disagreed about what a region even
               -- is. The web app slugifies for URLs; the database holds
               -- what a reader should see.
               --
               -- (The backticks that were in this comment terminated the
               -- template literal and broke the file. A comment can be a
               -- syntax error.)
               (SELECT a.name
                  FROM ne_admin1 a
                 -- 🔴 The bounding box must be WIDER than the radius, or
                 -- it silently becomes the real limit.
                 --
                 -- 0.1° looks like "about 11 km" and is not: that holds
                 -- for latitude, while a degree of longitude shrinks with
                 -- the cosine. At Brittany's 48°N, 0.1° east-west is
                 -- 7.4 km — narrower than the 5 km radius was generous,
                 -- and far narrower than 15 km. Widening ST_DWithin alone
                 -- would have changed nothing and looked like the radius
                 -- was not the problem.
                 --
                 -- 0.25° is 27.8 km north-south and 18.6 km east-west at
                 -- 48°N, so the index filter can never be what decides.
                 WHERE a.geom && ST_Expand(ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326), 0.25)
                   AND (ST_Contains(a.geom, ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326))
                        OR ST_DWithin(a.geom::geography,
                                      ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)::geography,
                                      15000))
                 -- Containment always wins; among near misses, the
                 -- closest, and the name breaks a tie so the answer
                 -- cannot change between runs.
                 ORDER BY ST_Contains(a.geom, ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)) DESC,
                          a.geom <-> ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326),
                          a.name
                 LIMIT 1),
               $5::text, 'paid', '{}'::jsonb,
               ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326),
               -- 🔴 Every placeholder is cast. Postgres could not infer
               -- the type of the description inside the CASE and refused
               -- the whole statement — "could not determine data type of
               -- parameter $6" — which is a compile error dressed as a
               -- runtime one, and only the real run finds it.
               $6::text,
               CASE WHEN $6::text IS NULL THEN NULL ELSE 'fr' END,
               $7::smallint, $9::text, $8::jsonb, now()
        `,
        [
          spot.name,
          COUNTRY,
          spot.lat,
          spot.lon,
          slug,
          spot.description,
          spot.stars,
          JSON.stringify([sourceEntry(spot, fields)]),
          spot.website,
        ],
      );
      inserted++;
    }

    // 🔴 A row with no region has no page URL, so it is invisible on the
    // site however good its data is. Counting it is the difference
    // between "478 imported" and the truth.
    const orphans = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM camping_spots
        WHERE country = $1 AND region IS NULL`,
      [COUNTRY],
    );
    await db.query('COMMIT');
    console.log(`\n✓ merged ${merged}, inserted ${inserted}`);
    const without = Number(orphans.rows[0]?.n ?? 0);
    if (without > 0) {
      console.log(
        `⚠ ${without} ${COUNTRY} campsites have no region and therefore no page URL`,
      );
    }
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
